/**
 * GET /signup/config, POST /signup, GET /signup/verify/:token, POST /signup/verify/:token
 *
 * セルフサインアップ(KIZAMI Cloud、docs/design/saas.md「サインアップ」)。未認証・公開エンドポイント。
 * 環境変数 `SIGNUP_MODE`(off / invite / open)でゲートされ、off(既定)では
 * `GET /signup/config`(`{ mode: "off" }`)以外のすべてが 404 — セルフホストの体験を変えない。
 *
 * ## フロー
 *
 * 1. `POST /signup`: 入力検証 → Turnstile → (invite モードなら)招待コードの**有効性チェックのみ**
 *    → `pending_signups` に保存(パスワードはこの時点でハッシュ化)→ 確認メール送信。
 * 2. `GET /signup/verify/:token`: 確認画面の表示用(組織名・氏名・メール)。
 * 3. `POST /signup/verify/:token`: 確認。1トランザクションで pending 消費・招待コード消費・
 *    テナント作成(`bootstrapTenant`)・監査ログを行い、セッションを発行してログイン済みで返す。
 *
 * **テナントは確認後に作る**(判断点): 未確認の空テナントを作ると、メールを間違えた登録や
 * ボットの登録がテナントとして残り続ける。確認前は pending_signups の1行だけで、掃除ジョブが消す。
 *
 * ## ユーザー列挙対策(判断点)
 *
 * `POST /signup` は**既存ユーザーのテーブルを一切引かない**。同じメールのユーザーが既にいても
 * 応答は常に 202 + 同一ボディで、処理も同じ(pending を作って確認メールを送る)。KIZAMI は
 * 同じメールアドレスが複数テナントに存在することを意図して許容している(顧問社労士が複数社に
 * 登録される等、docs/design/multi-tenancy.md)ので、「既存メールは登録不可」にする理由が無く、
 * 区別しなければ列挙の経路そのものが無い。確認メールは宛先本人しか読めないので、他人のメールで
 * 登録してもテナントは作れない。応答時間も揃うよう、パスワードのハッシュ化は常に行い、
 * メール送信は応答を待たない(失敗はログに残す)。
 * 同一メールの未消費 pending がある場合は新しいトークンで置き換える(古いリンクは無効になる)。
 * 招待コード不正・Turnstile 失敗は列挙に関係しないので 400 で明示する。
 *
 * ## トークン経路のステータス(招待受諾 routes/invitations.ts と同じ作法)
 *
 * 存在しない・消費済み(=二重送信の2回目を含む)は区別せず 404、期限切れだけ 410。
 * 「消費済み」を区別して返すと、そのトークンが過去に実在したことが漏れるため(invitations.ts 冒頭の
 * 判断点と同じ)。ただし確認の POST が同時に2本来た場合の敗者も 404 になる。
 *
 * ## 招待コードの消費タイミング
 *
 * 入口(POST /signup)では有効性を見るだけで消費しない。消費は確認完了のトランザクション内の
 * 条件付き UPDATE(used_count + 1 を、失効・期限・上限を WHERE に含めて行う)なので、複数の
 * pending が同じコードを持っていても、実際に作れるテナント数は max_uses を超えない。
 * 確認時点でコードが使えなくなっていれば 409 invite_code_unavailable(トランザクション全体が
 * ロールバックされ、pending は未消費のまま残る)。
 */

import {
  consumePendingSignup,
  consumeSignupInviteCode,
  findPendingSignupByTokenHash,
  findSignupInviteCodeByHash,
  getUserById,
  insertAuditLog,
  isSignupInviteCodeUsable,
  replacePendingSignup,
  setPendingSignupTenant,
  type Database,
} from "@kizami/db";
import { Hono } from "hono";
import { sha256Hex } from "../auth/api-key.js";
import { generateInvitationToken } from "../auth/invitation-token.js";
import { hashPassword } from "../auth/password.js";
import { isAcceptablePassword, MIN_PASSWORD_LENGTH } from "../auth/password-policy.js";
import { createSession, setSessionCookie } from "../auth/session.js";
import { getClientIp } from "../lib/client-ip.js";
import { hashSignupInviteCode } from "../lib/signup-invite-code.js";
import type { SystemMailSendFn } from "../lib/system-mail.js";
import { bootstrapTenant } from "../lib/tenant-bootstrap.js";
import { nowMinutes } from "../lib/time.js";
import { verifyTurnstile } from "../lib/turnstile.js";

/** 確認リンクの有効期間(24時間、分単位)。 */
export const SIGNUP_TOKEN_TTL_MINUTES = 24 * 60;

const MAX_EMAIL_LENGTH = 255;
const MAX_NAME_LENGTH = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** createApp に渡す、有効化されたサインアップの設定(無効なら渡さない)。 */
export interface SignupDeps {
  mode: "invite" | "open";
  turnstileSecretKey: string;
  turnstileSiteKey: string;
  /** 確認リンクのベース URL(`${appBaseUrl}/signup/verify/<token>`)。末尾スラッシュ無し */
  appBaseUrl: string;
  /** システムメールの送信関数(実装は node.ts が渡す。テストは偽実装) */
  sendMail: SystemMailSendFn;
  /** Turnstile siteverify に使う fetch(テストの差し替え用。省略時は globalThis.fetch) */
  fetchFn?: typeof fetch;
}

export interface SignupRoutesOptions {
  /** null = サインアップ無効(config 以外は 404) */
  signup: SignupDeps | null;
  secureCookies: boolean;
  trustProxy: boolean;
}

/** トランザクションを巻き戻して呼び出し側へ失敗理由を伝えるための内部用の例外。 */
class SignupConfirmError extends Error {
  constructor(readonly reason: "not_found" | "invite_code_unavailable") {
    super(reason);
  }
}

/** トークンから pending を探し、有効性を判定する(理由の区別は 404 / 410 の使い分けのためだけ)。 */
async function resolvePending(db: Database, token: string) {
  const hash = await sha256Hex(token);
  const pending = await findPendingSignupByTokenHash(db, hash);
  const now = nowMinutes();
  if (!pending || pending.consumedAt !== null) return { status: "not_found" as const, now };
  if (pending.expiresAt <= now) return { status: "expired" as const, now };
  return { status: "valid" as const, now, pending };
}

/** 確認メールの本文(日本語。KIZAMI のメール通知と同じく平文テキスト)。 */
export function buildSignupVerificationMail(params: { to: string; organizationName: string; verifyUrl: string }) {
  return {
    to: params.to,
    subject: "【KIZAMI】メールアドレスの確認",
    text: [
      "KIZAMI にご登録いただきありがとうございます。",
      "",
      `組織名: ${params.organizationName}`,
      "",
      "次のリンクを開いて、メールアドレスの確認を完了してください(24時間有効)。",
      "確認が完了すると、組織(テナント)が作成されます。",
      "",
      params.verifyUrl,
      "",
      "このメールに心当たりがない場合は、何もせずに破棄してください。リンクを開かない限り、何も作成されません。",
    ].join("\n"),
  };
}

export function createSignupRoutes(db: Database, options: SignupRoutesOptions) {
  const app = new Hono();
  const { signup } = options;

  /** 登録リンクを出すかどうかの判定用(Web が使う)。無効でも 200 で `{ mode: "off" }`。 */
  app.get("/config", (c) => {
    if (!signup) return c.json({ mode: "off" });
    return c.json({ mode: signup.mode, turnstileSiteKey: signup.turnstileSiteKey });
  });

  // 無効な配備では「そんなパスは無い」を貫く(routes は生やすが、config 以外は 404 で返し切る)。
  // 何も登録しないと後段の authed に流れて 401 が返り、機能の有無が分かってしまう。
  if (!signup) {
    app.all("*", (c) => c.json({ error: "not_found" }, 404));
    return app;
  }

  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { email, password, organizationName, adminName, inviteCode, turnstileToken } = body as Record<string, unknown>;

    // ---- 入力検証(招待・メンバー追加と同じ検証の流儀)----
    if (typeof email !== "string" || email.trim().length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email.trim())) {
      return c.json({ error: "invalid_email" }, 400);
    }
    if (!isAcceptablePassword(password)) {
      return c.json({ error: "invalid_password", minLength: MIN_PASSWORD_LENGTH }, 400);
    }
    if (typeof organizationName !== "string" || organizationName.trim() === "" || organizationName.length > MAX_NAME_LENGTH) {
      return c.json({ error: "invalid_organization_name" }, 400);
    }
    if (typeof adminName !== "string" || adminName.trim() === "" || adminName.length > MAX_NAME_LENGTH) {
      return c.json({ error: "invalid_name" }, 400);
    }

    // ---- Turnstile(サーバー側検証)----
    if (typeof turnstileToken !== "string" || turnstileToken === "") {
      return c.json({ error: "turnstile_failed" }, 400);
    }
    const turnstile = await verifyTurnstile({
      secret: signup.turnstileSecretKey,
      token: turnstileToken,
      remoteIp: getClientIp(c, options.trustProxy),
      ...(signup.fetchFn !== undefined ? { fetchFn: signup.fetchFn } : {}),
    });
    if (!turnstile.ok) {
      return turnstile.reason === "failed" ? c.json({ error: "turnstile_failed" }, 400) : c.json({ error: "turnstile_unavailable" }, 503);
    }

    // ---- 招待コード(invite モードのみ。有効性を見るだけで消費しない)----
    let inviteCodeId: string | null = null;
    if (signup.mode === "invite") {
      if (typeof inviteCode !== "string" || inviteCode.trim() === "") {
        return c.json({ error: "invalid_invite_code" }, 400);
      }
      const code = await findSignupInviteCodeByHash(db, await hashSignupInviteCode(inviteCode));
      if (!code || !isSignupInviteCodeUsable(code, nowMinutes())) {
        return c.json({ error: "invalid_invite_code" }, 400);
      }
      inviteCodeId = code.id;
    }

    // ---- pending 作成 → 確認メール ----
    // パスワードのハッシュ化は常に行う(応答時間を既存メール・新規メールで揃える意味もある)。
    const passwordHash = await hashPassword(password);
    const { token, hash } = await generateInvitationToken();
    const now = nowMinutes();
    const normalizedEmail = email.trim();
    const trimmedOrganizationName = organizationName.trim();
    await replacePendingSignup(db, {
      email: normalizedEmail,
      organizationName: trimmedOrganizationName,
      adminName: adminName.trim(),
      passwordHash,
      tokenHash: hash,
      inviteCodeId,
      expiresAt: now + SIGNUP_TOKEN_TTL_MINUTES,
      createdAt: now,
    });

    // 送信は応答を待たない(SMTP の遅さ・失敗が応答に出ると、列挙の手掛かりにも、利用者への
    // 不可解な 500 にもなるため)。失敗はログに残す。メールが届かなければ利用者は再登録できる
    // (同一メールの pending は置き換わる)。
    const mail = buildSignupVerificationMail({
      to: normalizedEmail,
      organizationName: trimmedOrganizationName,
      verifyUrl: `${signup.appBaseUrl}/signup/verify/${token}`,
    });
    void signup.sendMail(mail).catch((err: unknown) => {
      console.error("signup: failed to send verification mail:", err);
    });

    return c.json({ status: "verification_sent" }, 202);
  });

  /** 確認画面の表示用。有効なら登録内容(パスワード以外)を返す。 */
  app.get("/verify/:token", async (c) => {
    const resolved = await resolvePending(db, c.req.param("token"));
    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);
    const { pending } = resolved;
    return c.json({ organizationName: pending.organizationName, adminName: pending.adminName, email: pending.email });
  });

  /** 確認: テナントを作り、そのままログイン状態にする。 */
  app.post("/verify/:token", async (c) => {
    const resolved = await resolvePending(db, c.req.param("token"));
    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);
    const { pending, now } = resolved;

    // invite モードで運用中に、open で受け付けた(= 招待コードの無い)pending が確認されても
    // テナントは作らない。モードを絞ったあとに古い申請で作れてしまうのを防ぐ。
    if (signup.mode === "invite" && pending.inviteCodeId === null) {
      return c.json({ error: "invite_code_unavailable" }, 409);
    }

    let created: { tenantId: string; userId: string };
    try {
      // 1トランザクション: pending 消費 → 招待コード消費 → テナント作成 → 記録 → 監査ログ。
      // どれかが失敗すれば全体を巻き戻す(招待コードだけ減ってテナントが無い、を作らない)。
      // 最初の pending 消費が条件付き UPDATE(未消費・未期限)なので、同じトークンの二重確認は
      // 片方だけがここを通る。
      created = await db.transaction(async (tx) => {
        const consumed = await consumePendingSignup(tx, { id: pending.id, nowMinutes: now });
        if (!consumed) throw new SignupConfirmError("not_found");

        if (pending.inviteCodeId !== null) {
          const ok = await consumeSignupInviteCode(tx, { id: pending.inviteCodeId, nowMinutes: now });
          if (!ok) throw new SignupConfirmError("invite_code_unavailable");
        }

        const boot = await bootstrapTenant(tx, {
          tenantName: pending.organizationName,
          adminEmail: pending.email,
          adminName: pending.adminName,
          adminPasswordHash: pending.passwordHash,
          now,
        });
        await setPendingSignupTenant(tx, { id: pending.id, tenantId: boot.tenantId });
        await insertAuditLog(tx, {
          tenantId: boot.tenantId,
          actorId: boot.userId,
          action: "tenant.signup",
          targetType: "tenant",
          targetId: boot.tenantId,
          detail: JSON.stringify({ inviteCodeId: pending.inviteCodeId, mode: signup.mode }),
          occurredAt: now,
        });
        return { tenantId: boot.tenantId, userId: boot.userId };
      });
    } catch (err) {
      if (err instanceof SignupConfirmError) {
        return err.reason === "not_found" ? c.json({ error: "not_found" }, 404) : c.json({ error: "invite_code_unavailable" }, 409);
      }
      throw err;
    }

    // セッション発行はテナント作成とは別の関心事(招待受諾と同じ分離。失敗してもテナントは
    // 作成済みなので、500 ではなくログイン画面への誘導を返す)。
    let session: Awaited<ReturnType<typeof createSession>>;
    try {
      session = await createSession(db, { tenantId: created.tenantId, userId: created.userId, nowMinutes: now });
    } catch {
      return c.json(
        {
          accountActivated: true,
          error: "session_issuance_failed",
          message: "アカウントは作成済みです。お手数ですが、ログイン画面から改めてログインしてください。",
        },
        200,
      );
    }
    setSessionCookie(c, session.token, { secure: options.secureCookies });

    const user = await getUserById(db, { tenantId: created.tenantId, id: created.userId });
    return c.json({ user: { id: created.userId, email: user?.email ?? null, displayName: user?.name ?? null } }, 200);
  });

  return app;
}
