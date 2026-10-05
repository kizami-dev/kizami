/**
 * GET /password-resets/:token, POST /password-resets/:token/use
 * GET /password-resets/config, POST /password-resets(本人用の「パスワードを忘れた」、下記)
 *
 * パスワードリセットの使用フロー(未認証・公開エンドポイント、Tier 0)。
 * POST /members/:id/password-resets(routes/members.ts)が発行した**管理者発行**のトークンと、
 * POST /password-resets が発行する**本人発行**のトークンの、どちらも同じ画面・同じ API で
 * 検証し、新しいパスワードを設定する。設計・判断点は routes/invitations.ts(招待受諾)と同型:
 *
 * - 404 と 410 の使い分け: トークンが無効な理由(存在しない・失効済み・使用済み・期限切れ)は
 *   原則として区別せず 404 にする(トークン総当たりへの情報最小化)。期限切れだけは 410 で
 *   区別する(有用な「再発行を依頼してください」の導線のため、情報最小化とのトレードオフを
 *   あえて取る)。routes/invitations.ts 冒頭コメントと同じ判断。
 * - 使用成功後はそのままログイン状態にする(セッション発行 + Cookie)。パスワードを
 *   再設定した直後にもう一度ログインを要求するのは無駄という、招待受諾と同じ判断。
 * - 使用すると、そのユーザーの**全セッション**と**ほかの未決着の再設定トークン**(本人発行・管理者発行の
 *   どちらも)が失効する(queries/password-resets.ts の usePasswordResetToken)。
 * - **2FA は解除しない**: 使用が触るのは auth_credentials(パスワードハッシュ)だけで、user_totp には
 *   一切触れない。さらに、**2FA を有効にしているユーザーには使用の直後のセッションを発行しない**
 *   (`{ passwordUpdated: true, status: "login_required" }` を返し、ログイン画面から通常どおりパスワード +
 *   TOTP でログインさせる)。以前の実装は使用の直後に無条件でセッションを張っていたため、リセットリンク
 *   (= メールボックスの持ち主という1要素)だけで 2FA を迂回できてしまった。本人用の再設定は
 *   メールを読めるだけの第三者でも要求できる経路なので、ここを塞がないと 2FA の意味がなくなる
 *   (2FA を失った人の救済は管理者の `member.totp.reset`)。2FA を使っていないユーザーの挙動は従来どおり。
 *
 * ## 本人用の「パスワードを忘れた」(2026-10-04 追加、システムメールがある配備のみ)
 *
 * `selfService`(SYSTEM_SMTP_URL / SYSTEM_MAIL_FROM / APP_BASE_URL が揃っているとき node.ts が渡す。
 * SIGNUP_MODE とは独立)があるときだけ有効。無い配備(セルフホスト・Workers)では
 * `GET /config` が `{ selfService: false }`、`POST /` は 404 で、**従来の体験を一切変えない**。
 *
 * - **ユーザー列挙対策**: `POST /` は、そのメールのユーザーが居ても居なくても、退職者でも資格情報なしでも、
 *   スロットルで抑止されても、常に 202 + 同一ボディ。
 *   メールアドレスの形式不正・Turnstile 失敗は列挙に関係しないので 400 / 503 で明示する。
 * - **応答時間を該当者の有無から独立させる**(判断): ボディが同じでも、該当者がいるときだけ対象の探索
 *   + トークン発行(トランザクション・監査ログ)が応答の前に走ると、応答時間の差で登録の有無が分かる。
 *   そこで応答の前に行うのは、入力検証・Origin/JSON ガード・Turnstile・**メール単位スロットルの取得**
 *   (全メール共通のコスト = 実在しないメールにも同じ 1 回の書き込み)までにし、**対象の探索・
 *   トークン発行・メール送信はすべて応答の後のバックグラウンド**で行う(signup のメール送信と同じく
 *   応答を待たない。失敗はログのみ)。その代償として、スロットル行(password_reset_requests)は
 *   実在しないメールにも作られるため、定期ジョブ(signup-cleanup.ts)で掃除する。
 * - **対象**: そのメールを持つ有効な(退職処理されていない)ユーザーで、パスワード資格情報を持つ人を
 *   全テナントから探す(POST /auth/login と同じ users.email 完全一致)。SSO だけの人にはパスワードが
 *   無いので出さない。該当者が居なければメールは送らない。
 * - **メール単位のスロットル**: 同じメール宛は 5 分に 1 回(IP を変えても効く)。判定と記録は
 *   `acquirePasswordResetRequestSlot` の 1 文で原子的(同時リクエストでもメールは 1 通)。照合キーは
 *   trim + 小文字化。
 * - **TTL 1 時間**(lib: auth/password-reset-token.ts に理由)。同じユーザーの本人発行の古いトークンは失効する。
 * - **メール本文にユーザー入力もテナント名も入れない**(固定文面 + リンクのみ。複数テナントに該当すれば
 *   リンクを番号付きで並べる)。テナント名は攻撃者が決められる自由入力(組織名)なので、本文に入れると
 *   運用者名義のフィッシングの踏み台になる。どの組織のアカウントかは、リンク先の受諾画面
 *   (GET /:token の tenantName)で見せる。
 * - Origin 検証と `Content-Type: application/json` の必須化は signup と同じ(lib/json-post-guard.ts)。
 *   **`POST /` にだけ**掛ける(既存の `/:token/use` の挙動は変えない)。
 */

import {
  acquirePasswordResetRequestSlot,
  findPasswordResetTokenByHash,
  findSelfServiceResetTargetsByEmail,
  issueSelfServicePasswordResetToken,
  getTenantById,
  getUserById,
  getUserTotp,
  usePasswordResetToken,
  type Database,
} from "@kizami/db";
import { Hono } from "hono";
import { sha256Hex } from "../auth/api-key.js";
import { hashPassword } from "../auth/password.js";
import { isAcceptablePassword, MIN_PASSWORD_LENGTH } from "../auth/password-policy.js";
import {
  generatePasswordResetToken,
  SELF_SERVICE_PASSWORD_RESET_THROTTLE_MINUTES,
  SELF_SERVICE_PASSWORD_RESET_TTL_MINUTES,
} from "../auth/password-reset-token.js";
import { createSession, setSessionCookie } from "../auth/session.js";
import { getClientIp } from "../lib/client-ip.js";
import { jsonPostGuard } from "../lib/json-post-guard.js";
import type { TenantQuotas } from "../lib/tenant-quotas.js";
import type { SystemMailSendFn } from "../lib/system-mail.js";
import { nowMinutes } from "../lib/time.js";
import { verifyTurnstile } from "../lib/turnstile.js";

const MAX_EMAIL_LENGTH = 255;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** createApp に渡す、本人用「パスワードを忘れた」の設定(渡さない = 無効)。 */
export interface SelfServiceResetDeps {
  /** リセットリンクのベース URL(`${appBaseUrl}/reset/<token>`)。末尾スラッシュ無し */
  appBaseUrl: string;
  /** システムメールの送信関数(実装は node.ts が渡す。テストは偽実装) */
  sendMail: SystemMailSendFn;
  /**
   * 利用上限(招待・再設定のメールの1日の送信数、lib/tenant-quotas.ts)。省略 = 無制限。上限に達したテナントの
   * アカウントは、トークンを発行せずメールにも含めない(応答は変えない — 列挙の手掛かりにしない)。
   */
  quotas?: TenantQuotas;
  /** Turnstile(secret / site key の両方が設定されている配備のみ。無ければ不要) */
  turnstile?: { secretKey: string; siteKey: string };
  /** Turnstile siteverify に使う fetch(テストの差し替え用。省略時は globalThis.fetch) */
  fetchFn?: typeof fetch;
  /**
   * 応答の後に走らせる処理(対象の探索・トークン発行・メール送信)の実行方法。**応答を返してから**
   * 呼ぶこと(thunk を受け取り、始めるのは実行側)。既定は次のマクロタスクで投げっぱなし。テストは
   * thunk を集めて、応答の直後の状態を確認してから実行・完了待ちする。Workers では本人用再設定自体が
   * 無効なので waitUntil は考えない。
   */
  runInBackground?: (task: () => Promise<void>) => void;
}

/**
 * 本人用再設定メールの本文(日本語の平文テキスト)。**ユーザー入力もテナント名も含めない**
 * (このファイル冒頭「メール本文に…」)。リンクが複数あるときは番号だけで区別する。
 */
export function buildSelfServiceResetMail(params: { to: string; resetUrls: string[] }) {
  const lines = ["KIZAMI のパスワード再設定のご依頼を受け付けました。", ""];
  if (params.resetUrls.length === 1) {
    lines.push("次のリンクを開いて、新しいパスワードを設定してください(1時間有効)。", "", params.resetUrls[0]!);
  } else {
    lines.push(
      "このメールアドレスで登録されているアカウントが複数あります。再設定したいアカウントのリンクを開いて、",
      "新しいパスワードを設定してください(いずれも1時間有効)。どの組織のアカウントかはリンク先の画面に表示されます。",
    );
    params.resetUrls.forEach((url, i) => lines.push("", `アカウント${i + 1}`, url));
  }
  lines.push(
    "",
    "このメールに心当たりがない場合は、何もせずに破棄してください。リンクを開かない限り、パスワードは変わりません。",
  );
  return { to: params.to, subject: "【KIZAMI】パスワード再設定のご案内", text: lines.join("\n") };
}

/** トークンからリセットトークンを探し、有効性を判定する。無効の理由まで返すのはこのファイル内部の利用のみ。 */
async function resolvePasswordReset(db: Database, token: string) {
  const hash = await sha256Hex(token);
  const resetToken = await findPasswordResetTokenByHash(db, hash);
  const now = nowMinutes();

  if (!resetToken || resetToken.revokedAt !== null || resetToken.usedAt !== null) {
    return { status: "not_found" as const, hash, now };
  }
  if (resetToken.expiresAt <= now) {
    return { status: "expired" as const, hash, now };
  }
  return { status: "valid" as const, hash, now, resetToken };
}

/** 既定のバックグラウンド実行: 応答を返した後(次のマクロタスク)に始め、投げっぱなしにする。 */
function defaultRunInBackground(task: () => Promise<void>): void {
  setTimeout(() => void task(), 0);
}

/**
 * 応答の後に走る本体: 対象の探索 → 本人発行トークンの発行(各ユーザー)→ メール送信。
 * 該当者がいなければ何もしない(メールも送らない)。失敗はログに残すだけ(応答は返し済み。メールが
 * 届かなければ 5 分後に再要求できる)。この関数は例外を投げない。
 */
async function processSelfServiceRequest(
  db: Database,
  deps: SelfServiceResetDeps,
  params: { email: string; now: number },
): Promise<void> {
  try {
    const targets = await findSelfServiceResetTargetsByEmail(db, params.email);
    if (targets.length === 0) return;

    const resetUrls: string[] = [];
    for (const target of targets) {
      // テナントごとの1日のメール上限。断ったテナントのアカウントは飛ばす(1通のメールに載せる分も数える)
      if (deps.quotas && !(await deps.quotas.consumeInviteResetMail(db, target.tenantId))) continue;
      const { token, hash } = await generatePasswordResetToken();
      await issueSelfServicePasswordResetToken(db, {
        tenantId: target.tenantId,
        userId: target.userId,
        tokenHash: hash,
        expiresAt: params.now + SELF_SERVICE_PASSWORD_RESET_TTL_MINUTES,
        createdAt: params.now,
      });
      resetUrls.push(`${deps.appBaseUrl}/reset/${token}`);
    }
    if (resetUrls.length === 0) return;
    await deps.sendMail(buildSelfServiceResetMail({ to: params.email, resetUrls }));
  } catch (err) {
    console.error("password-reset: self-service request failed:", err);
  }
}

export interface PasswordResetsRoutesOptions {
  secureCookies: boolean;
  /** null / 省略 = 本人用の再設定は無効(config は selfService:false、POST / は 404) */
  selfService?: SelfServiceResetDeps | null;
  /** 前段プロキシのヘッダを信頼するか(Turnstile の remoteip 用。lib/client-ip.ts) */
  trustProxy?: boolean;
}

export function createPasswordResetsRoutes(db: Database, options: PasswordResetsRoutesOptions) {
  const app = new Hono();
  const selfService = options.selfService ?? null;

  /**
   * 「パスワードを忘れた」リンクを出すかどうかの判定用(ログイン画面が使う)。無効でも 200。
   * `/:token` より前に登録する(`config` はトークンとして解釈させない。トークンは 43 文字の乱数)。
   */
  app.get("/config", (c) => {
    if (!selfService) return c.json({ selfService: false });
    return c.json({ selfService: true, ...(selfService.turnstile ? { turnstileSiteKey: selfService.turnstile.siteKey } : {}) });
  });

  /**
   * 本人用の再設定の要求。このファイル冒頭「本人用の…」のとおり、結果に関係なく 202 + 同一ボディ。
   * 無効な配備では 404(機能の有無まで「そんなパスは無い」を貫く)。
   */
  app.post("/", async (c, next) => {
    if (!selfService) return c.json({ error: "not_found" }, 404);
    return jsonPostGuard(selfService.appBaseUrl)(c, next);
  }, async (c) => {
    // selfService は上の最初のハンドラで非 null を確認済み
    const deps = selfService!;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { email, turnstileToken } = body as Record<string, unknown>;
    if (typeof email !== "string" || email.trim().length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email.trim())) {
      return c.json({ error: "invalid_email" }, 400);
    }

    // ---- Turnstile(キーが設定されている配備では必須)----
    if (deps.turnstile) {
      if (typeof turnstileToken !== "string" || turnstileToken === "") {
        return c.json({ error: "turnstile_failed" }, 400);
      }
      const turnstile = await verifyTurnstile({
        secret: deps.turnstile.secretKey,
        token: turnstileToken,
        remoteIp: getClientIp(c, options.trustProxy ?? true),
        ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
      });
      if (!turnstile.ok) {
        return turnstile.reason === "failed" ? c.json({ error: "turnstile_failed" }, 400) : c.json({ error: "turnstile_unavailable" }, 503);
      }
    }

    const normalizedEmail = email.trim();
    const now = nowMinutes();

    // 応答の前に行うのは、メール単位スロットルの取得(`acquirePasswordResetRequestSlot`)まで。これは
    // **メールが実在するかに関係なく全リクエスト共通**のコスト(1回の DB 書き込み)で、応答時間に差が出ない。
    // 対象の探索・トークン発行・メール送信はすべて応答の後のバックグラウンドで行う(このファイル冒頭
    // 「応答時間」)。スロットルで抑止された(直近 5 分以内に同じメールで要求があった)ときは何もしない。
    let acquired = false;
    try {
      acquired = await acquirePasswordResetRequestSlot(db, {
        emailKey: normalizedEmail.toLowerCase(),
        nowMinutes: now,
        throttleMinutes: SELF_SERVICE_PASSWORD_RESET_THROTTLE_MINUTES,
      });
    } catch (err) {
      // 内部エラーを 500 で返すと、全リクエスト共通の経路なので列挙にはならないが、
      // 利用者に不可解な失敗を見せないよう、ログに残して通常と同じ 202 を返す(5 分後に再要求できる)。
      console.error("password-reset: failed to acquire the request slot:", err);
    }
    if (acquired) {
      (deps.runInBackground ?? defaultRunInBackground)(() => processSelfServiceRequest(db, deps, { email: normalizedEmail, now }));
    }

    return c.json({ status: "reset_requested" }, 202);
  });

  /** トークン検証(パスワード再設定画面の表示用)。有効なら対象の表示情報のみ返す。 */
  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    const resolved = await resolvePasswordReset(db, token);

    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);

    const { resetToken } = resolved;
    const [user, tenant] = await Promise.all([
      getUserById(db, { tenantId: resetToken.tenantId, id: resetToken.userId }),
      getTenantById(db, resetToken.tenantId),
    ]);
    // リセットトークンは既存の user/tenant 行に紐づくため理論上は必ず見つかるが、防御的に404にする。
    if (!user || !tenant) return c.json({ error: "not_found" }, 404);

    return c.json({ tenantName: tenant.name, userName: user.name, email: user.email });
  });

  /** 使用: 新しいパスワードを設定し、そのままログイン状態にする。 */
  app.post("/:token/use", async (c) => {
    const token = c.req.param("token");

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

    const resolved = await resolvePasswordReset(db, token);
    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);

    const passwordHash = await hashPassword(password);
    const result = await usePasswordResetToken(db, { tokenHash: resolved.hash, passwordHash, nowMinutes: resolved.now });
    if (!result) {
      // resolvePasswordReset の判定から usePasswordResetToken の実行までの間に、別リクエストが
      // 先に使用・失効させた(競合)。理由は区別せず404にする(このファイル冒頭の判断点どおり)。
      return c.json({ error: "not_found" }, 404);
    }
    // ここまでで usePasswordResetToken のトランザクションはコミット済み: auth_credentials の
    // 更新・全セッション失効・監査ログはどれも確定している。

    // 2FA を有効にしているユーザーには、使用の直後のセッションを張らない(このファイル冒頭「2FA は解除しない」)。
    // パスワードはすでに更新・全セッション失効済みなので、ログイン画面からパスワード + TOTP で入り直す。
    const totp = await getUserTotp(db, { tenantId: result.tenantId, userId: result.userId });
    if (totp?.enabledAt != null) {
      return c.json({ passwordUpdated: true, status: "login_required" }, 200);
    }

    // セッション発行はパスワード更新とは別のトランザクション・別の関心事として意図的に分離する
    // (routes/invitations.ts の POST /:token/accept と同じ理由)。ここが失敗しても
    // 「パスワード再設定自体が失敗した」という誤ったメッセージ(500 internal_error)は返さない。
    let session: Awaited<ReturnType<typeof createSession>>;
    try {
      session = await createSession(db, { tenantId: result.tenantId, userId: result.userId, nowMinutes: resolved.now });
    } catch {
      return c.json(
        {
          passwordUpdated: true,
          error: "session_issuance_failed",
          message: "パスワードは更新済みです。お手数ですが、ログイン画面から改めてログインしてください。",
        },
        200,
      );
    }
    setSessionCookie(c, session.token, { secure: options.secureCookies });

    const user = await getUserById(db, { tenantId: result.tenantId, id: result.userId });
    return c.json({ user: { id: result.userId, email: user?.email ?? null, displayName: user?.name ?? null } }, 200);
  });

  return app;
}
