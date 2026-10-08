/**
 * GET /signup/config, POST /signup, GET /signup/verify/:token, POST /signup/verify/:token
 *
 * セルフサインアップ(KIZAMI Cloud、docs/design/saas.md「サインアップ」)。未認証・公開エンドポイント。
 * 環境変数 `SIGNUP_MODE`(off / invite / open)でゲートされ、off(既定)では
 * `GET /signup/config`(`{ mode: "off" }`)以外のすべてが 404 — セルフホストの体験を変えない。
 *
 * ## フロー
 *
 * 1. `POST /signup`(組織名・氏名・メール・招待コード・Turnstile・任意の locale): 入力検証 → Turnstile →
 *    (invite モードなら)招待コードの**有効性チェックのみ** → `pending_signups` に保存 → 確認メール送信。
 *    **パスワードはここでは受け取らない**(下記「アカウント乗っ取り対策」)。
 * 2. `GET /signup/verify/:token`: 確認画面の表示用(組織名・氏名・メール)。
 * 3. `POST /signup/verify/:token`(body `{ password }`): パスワードを検証・ハッシュ化したうえで、
 *    1単位(packages/db の atomic plan `confirmPendingSignup`。D1 でも動く)で pending 消費・招待コード消費・
 *    テナント作成(`bootstrapTenantStatements`)・監査ログを行い、
 *    セッションを発行してログイン済みで返す。
 *
 * ## アカウント乗っ取り対策: パスワードは確認時に設定させる(判断点)
 *
 * 登録時にパスワードを受け取ると、攻撃者が「被害者のメール+攻撃者が決めたパスワード」で登録でき、
 * 被害者が(心当たりのない確認メールのリンクでも)踏んだ時点で、攻撃者がパスワードを知るテナントが
 * 被害者名義で作られてしまう。そこでパスワードはリンクを踏んだ本人が確認画面で設定する
 * (招待受諾 routes/invitations.ts と同じ作法)。pending_signups にパスワード列は無い。
 * 攻撃者が登録時に決められるのは組織名・氏名だけで、確認画面に表示されるので本人が見て判断できる。
 *
 * ## メール本文にユーザー入力を入れない(判断点)
 *
 * 確認メールは未認証で誰でも任意の宛先に出させられる。本文に組織名のような自由入力を入れると、
 * KIZAMI(運用者)名義で任意の文面・URL をフィッシングとして送れてしまう。そのため本文は
 * **固定文面+確認 URL だけ**にし、組織名は確認画面(GET /verify)で見せる。
 *
 * ## ログイン CSRF 対策(判断点)
 *
 * POST /verify/:token は成功時にセッション Cookie を発行する。攻撃者が自分の確認トークンを使った
 * フォームを被害者のブラウザから自動送信させると、被害者が攻撃者のテナントにログインさせられる。
 * そこで signup の全 POST に (1) `Content-Type: application/json` の必須化(クロスオリジンからの
 * JSON POST はプリフライトが要るため、フォームの自動送信では送れない)と (2) Origin ヘッダの検証
 * (あれば APP_BASE_URL のオリジンと一致すること。ブラウザはクロスオリジンの POST に必ず Origin を付ける。
 * 無いのは curl 等の非ブラウザ)を掛ける。既存の POST /auth/login 等には無い(今回は signup だけ)。
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
 * ただし**直近5分以内に同じメール宛の申請があれば何もしない**(202 は同じ。メールも出さない):
 * 他人のメール宛に確認メールを連打して迷惑をかけたり、本人が受け取った直後のリンクを置き換えて
 * 無効にする妨害を、IP を変えながらでも1回/5分に抑える(IP レート制限だけでは受信者単位の上限が無い)。
 * 照合キーは trim + 小文字化したメール(`Victim@Example.com` でもすり抜けられない)。判定と書き込みは
 * `upsertPendingSignupUnlessRecent` の1文(部分 UNIQUE + ON CONFLICT DO UPDATE ... WHERE)で原子的に
 * 行うので、同時に何本来てもメールが出るのは1通(判断の背景は packages/db/src/queries/signup.ts)。
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
 * 入口(POST /signup)では有効性を見るだけで消費しない。消費は確認完了の計画の中の
 * 条件付き UPDATE(used_count + 1 を、失効・期限・上限を WHERE に含めて行う)なので、複数の
 * pending が同じコードを持っていても、実際に作れるテナント数は max_uses を超えない。
 * 確認時点でコードが使えなくなっていれば 409 invite_code_unavailable(ガードで計画全体が
 * 巻き戻され、pending は未消費のまま残る。packages/db/src/queries/signup.ts の confirmPendingSignup)。
 */

import {
  confirmPendingSignup,
  findPendingSignupByTokenHash,
  findSignupInviteCodeByHash,
  getUserById,
  isSignupInviteCodeUsable,
  upsertPendingSignupUnlessRecent,
  type Database,
} from "@kizami/db";
import { Hono } from "hono";
import { sha256Hex } from "../auth/api-key.js";
import { generateInvitationToken } from "../auth/invitation-token.js";
import { hashPassword } from "../auth/password.js";
import { isAcceptablePassword, MIN_PASSWORD_LENGTH } from "../auth/password-policy.js";
import { createSession, setSessionCookie } from "../auth/session.js";
import { getClientIp } from "../lib/client-ip.js";
import { jsonPostGuard } from "../lib/json-post-guard.js";
import { resolveLocale, type Locale } from "../lib/locale.js";
import { hashSignupInviteCode } from "../lib/signup-invite-code.js";
import type { SystemMailSendFn } from "../lib/system-mail.js";
import { signupVerificationContent } from "../lib/system-mail-i18n.js";
import { bootstrapTenantStatements } from "../lib/tenant-bootstrap.js";
import { nowMinutes } from "../lib/time.js";
import { verifyTurnstile } from "../lib/turnstile.js";

/** 確認リンクの有効期間(24時間、分単位)。 */
export const SIGNUP_TOKEN_TTL_MINUTES = 24 * 60;

const MAX_EMAIL_LENGTH = 255;
const MAX_NAME_LENGTH = 200;
/** 同一メール宛の登録(確認メール送信)を受け付ける最小間隔(分)。 */
export const SIGNUP_RESEND_THROTTLE_MINUTES = 5;
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

/** トークンから pending を探し、有効性を判定する(理由の区別は 404 / 410 の使い分けのためだけ)。 */
async function resolvePending(db: Database, token: string) {
  const hash = await sha256Hex(token);
  const pending = await findPendingSignupByTokenHash(db, hash);
  const now = nowMinutes();
  if (!pending || pending.consumedAt !== null) return { status: "not_found" as const, now };
  if (pending.expiresAt <= now) return { status: "expired" as const, now };
  return { status: "valid" as const, now, pending };
}

/**
 * 確認メールの本文(平文テキスト。言語は `locale`、文面は lib/system-mail-i18n.ts)。**ユーザー入力を
 * 一切含めない**(宛先 `to` は送信先であって本文ではない)。組織名・氏名は確認画面で見せる
 * (このファイル冒頭「メール本文に…」)。
 */
export function buildSignupVerificationMail(params: { to: string; verifyUrl: string; locale: Locale }) {
  return { to: params.to, ...signupVerificationContent(params.locale, { verifyUrl: params.verifyUrl }) };
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

  app.use("*", jsonPostGuard(signup.appBaseUrl));

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
    const { email, organizationName, adminName, inviteCode, turnstileToken, locale } = body as Record<string, unknown>;

    // ---- 入力検証(招待・メンバー追加と同じ検証の流儀)----
    if (typeof email !== "string" || email.trim().length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email.trim())) {
      return c.json({ error: "invalid_email" }, 400);
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
    const now = nowMinutes();
    const normalizedEmail = email.trim();
    // メールの言語(2026-10-07): リクエストの `locale`(Web の表示言語)→ 無効・省略なら ja。
    // 判断点: ここは**メール本文の言語を選ぶだけ**で、入力検証・スロットル・pending の作成・応答には
    // 一切関与させない(不正な locale で 400 にもしない — 応答が locale で変わらないことが列挙対策の前提。
    // 値は許可リストで検証済みなので、任意の文字列が本文に入ることもない)。
    const mailLocale = resolveLocale(locale);

    const { token, hash } = await generateInvitationToken();
    const created = await upsertPendingSignupUnlessRecent(
      db,
      {
        email: normalizedEmail,
        emailKey: normalizedEmail.toLowerCase(),
        organizationName: organizationName.trim(),
        adminName: adminName.trim(),
        tokenHash: hash,
        inviteCodeId,
        expiresAt: now + SIGNUP_TOKEN_TTL_MINUTES,
        createdAt: now,
      },
      { throttleMinutes: SIGNUP_RESEND_THROTTLE_MINUTES },
    );

    // 直近の申請から間もなければ何も作られず(created = null)、メールも送らない(メール連打・
    // 他人のリンクの置き換え妨害の抑止)。応答は通常と同一の 202 で、区別できない。
    if (created) {
      // 送信は応答を待たない(SMTP の遅さ・失敗が応答に出ると、利用者への不可解な 500 になるため)。
      // 失敗はログに残す。メールが届かなければ、5分後に再登録できる(同一メールの pending は置き換わる)。
      const mail = buildSignupVerificationMail({
        to: normalizedEmail,
        verifyUrl: `${signup.appBaseUrl}/signup/verify/${token}`,
        locale: mailLocale,
      });
      void signup.sendMail(mail).catch((err: unknown) => {
        console.error("signup: failed to send verification mail:", err);
      });
    }

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

    // パスワードは確認時に受け取る(このファイル冒頭「アカウント乗っ取り対策」)。トークンの検証の後・
    // pending の消費の前に検証するので、入力ミス(400)でトークンが消費されることはない。
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { password } = body as { password?: unknown };
    if (!isAcceptablePassword(password)) {
      return c.json({ error: "invalid_password", minLength: MIN_PASSWORD_LENGTH }, 400);
    }

    // invite モードで運用中に、open で受け付けた(= 招待コードの無い)pending が確認されても
    // テナントは作らない。モードを絞ったあとに古い申請で作れてしまうのを防ぐ。
    if (signup.mode === "invite" && pending.inviteCodeId === null) {
      return c.json({ error: "invite_code_unavailable" }, 409);
    }

    // PBKDF2(重い)は書き込みロックを持つトランザクションの外で済ませる。
    const passwordHash = await hashPassword(password);

    // 1単位: pending 消費 → 招待コード消費 → テナント作成 → 記録 → 監査ログ(packages/db の
    // confirmPendingSignup。atomic plan なので D1 でも動く)。どれかが失敗すれば全体を巻き戻す
    // (招待コードだけ減ってテナントが無い、を作らない)。最初の pending 消費が条件付き UPDATE
    // (未消費・未期限)+ ガードなので、同じトークンの二重確認は片方だけが通り、負けた側は
    // 招待コードもテナントも書かない。
    const boot = bootstrapTenantStatements({
      tenantName: pending.organizationName,
      adminEmail: pending.email,
      adminName: pending.adminName,
      adminPasswordHash: passwordHash,
      now,
    });
    const created = boot.result;
    const confirmed = await confirmPendingSignup(db, {
      pendingId: pending.id,
      inviteCodeId: pending.inviteCodeId,
      nowMinutes: now,
      tenantId: created.tenantId,
      tenantStatements: boot.statements,
      audit: {
        tenantId: created.tenantId,
        actorId: created.userId,
        action: "tenant.signup",
        targetType: "tenant",
        targetId: created.tenantId,
        detail: JSON.stringify({ inviteCodeId: pending.inviteCodeId, mode: signup.mode }),
        occurredAt: now,
      },
    });
    if (!confirmed.ok) {
      return confirmed.reason === "pending_unavailable" ? c.json({ error: "not_found" }, 404) : c.json({ error: "invite_code_unavailable" }, 409);
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
