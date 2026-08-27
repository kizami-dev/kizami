/**
 * POST /auth/login, POST /auth/login/totp, POST /auth/logout
 *
 * 二要素認証(TOTP、2026-08-27)で **パスワードログインは2段階**になった。
 * 詳細は docs/design/two-factor-auth.md、本人による有効化/無効化は routes/auth-totp.ts。
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  authCredentials,
  consumeRecoveryCode,
  getTenantById,
  getUserById,
  getUserTotp,
  insertAuditLog,
  sessions,
  updateUserTotpLastUsedCounter,
  users,
  type Database,
} from "@kizami/db";
import { verifyTotp } from "@kizami/crypto";
import { verifyPassword } from "../auth/password.js";
import {
  clearSessionCookie,
  createSession,
  getSessionTokenFromCookie,
  sessionIdFromToken,
  setSessionCookie,
} from "../auth/session.js";
import {
  hashRecoveryCode,
  isTotpTransaction,
  normalizeTotpCode,
  TOTP_TX_COOKIE_NAME,
  TOTP_TX_TTL_MINUTES,
  TOTP_TX_TTL_SECONDS,
  type TotpTransaction,
} from "../auth/totp.js";
import { getClientIp } from "../lib/client-ip.js";
import { decryptSecret, type Encryptor } from "../lib/encryption.js";
import { rateLimitedResponse, type RateLimiter } from "../lib/rate-limit.js";
import { nowMinutes } from "../lib/time.js";

interface LoginBody {
  email?: unknown;
  password?: unknown;
  /** 複数テナントに同一メールが存在する場合のテナント指定(409 multiple_tenants への応答で使う) */
  tenantId?: unknown;
}

interface LoginTotpBody {
  /** 認証アプリが表示する6桁。`recoveryCode` とはどちらか一方。 */
  code?: unknown;
  /** リカバリコード(単回使用)。`code` とはどちらか一方。 */
  recoveryCode?: unknown;
}

/**
 * ユーザー列挙対策のダミーハッシュ。メール不存在・無効ユーザーでも
 * これに対する検証を実行し、応答時間を実在ユーザーと揃える。
 * (値は破棄するため中身は任意の well-formed な文字列でよい)
 */
const DUMMY_HASH = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export interface AuthRoutesOptions {
  secureCookies: boolean;
  /**
   * ログイン総当たり対策のレート制限(2026-08-24 追加、lib/rate-limit.ts)。
   * 省略時は制限なし(このルータを単体で組み立てるテスト用)。実アプリの配線は app.ts。
   */
  rateLimit?: {
    /** `ip|email`(メールは小文字化)ごとの制限。特定アカウントへの総当たりを止める。 */
    perIpEmail: RateLimiter;
    /** IP ごとの制限。多数のメールを横断的に試す総当たりを止める。 */
    perIp: RateLimiter;
    /**
     * 2FA コード検証(`ip|userId`)の制限。6桁は総当たりで当たりうる空間なので、
     * パスワードとは別に必ず頭を押さえる。routes/auth-totp.ts(有効化・無効化・再生成)と
     * **同じインスタンス**を共有する(経路を変えても回数が増えないように)。
     */
    perIpUser?: RateLimiter;
    /** 前段プロキシ(Cloudflare Tunnel)のヘッダを信頼するか。lib/client-ip.ts 参照。 */
    trustProxy: boolean;
  };
  /**
   * 2FA の共有鍵の復号と、ログイン第2段階を運ぶ Cookie(`kizami_totp_tx`)の暗号化に使う。
   *
   * **無い場合、2FA を有効にしているユーザーはログインできない**(503 encryption_unavailable)。
   * 「鍵が無いから 2FA を素通りさせる」は、鍵の設定を落とすだけで 2FA を無効化できる
   * ということであり、安全側ではない(判断点)。
   */
  encryptor?: Encryptor | null;
}

export function createAuthRoutes(db: Database, options: AuthRoutesOptions) {
  const app = new Hono();

  app.post("/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { email, password, tenantId } = body as LoginBody;
    if (typeof email !== "string" || typeof password !== "string" || email === "" || password === "") {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (tenantId !== undefined && (typeof tenantId !== "string" || tenantId === "")) {
      return c.json({ error: "invalid_body" }, 400);
    }

    // レート制限(2026-08-24、公開デモインスタンス公開に伴う前倒し実装)。
    // パスワード検証(pbkdf2 600k回)より前に判定することで、総当たりの CPU コストも遮断する。
    // 形式不正(400)は制限の対象外にしてある — 総当たりの手数にならない上、
    // 実装ミスのクライアントを締め出しても得が無いため。
    if (options.rateLimit) {
      const { perIpEmail, perIp, trustProxy } = options.rateLimit;
      const ip = getClientIp(c, trustProxy);

      // 先に広い方(IP のみ)を見る。ここで弾かれた場合は IP+メール側のカウントを消費しない。
      const ipResult = perIp.check(ip);
      if (!ipResult.allowed) return rateLimitedResponse(c, ipResult.retryAfterSeconds);

      // メールは小文字化してキーにする。DB 側の照合は大文字小文字を区別する(users.email の
      // 完全一致)ため、"A@x" と "a@x" は別アカウント扱いになりうるが、レート制限のキーとしては
      // まとめる方が安全側(大文字小文字を変えるだけで制限を回避されない)。仮にすり抜けても
      // 上の IP のみの制限(30回/15分)が最終的な蓋になる。
      const emailResult = perIpEmail.check(`${ip}|${email.toLowerCase()}`);
      if (!emailResult.allowed) return rateLimitedResponse(c, emailResult.retryAfterSeconds);
    }

    // email のユニーク制約は (tenant_id, email) であり、同じメールアドレスが複数テナントに
    // 存在しうる(顧問社労士が複数社に登録される等、意図的に許容している)。以前は
    // LIMIT 1 で最初の1行を拾っており、複数テナント同居時にどこへログインするかが
    // 行の並び順まかせ(未定義)だった(2026-08-23 修正)。email に一致する全アカウントを
    // 照合し、パスワード一致が複数あればテナント選択を求める(409 multiple_tenants)。
    const userRows = tenantId
      ? await db.select().from(users).where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
      : await db.select().from(users).where(eq(users.email, email));
    const candidates = userRows.filter((u) => u.isActive);

    // 候補それぞれのパスワードを検証する(早期打ち切りせず全件)。候補0件でも必ず1回
    // ダミー検証を行い、メール不存在との応答時間差を抑える。候補が複数ある場合の
    // 検証回数の差(k回 vs 1回)による存在推測は残るが、複数テナント登録は本人が知っている
    // 情報であり、列挙対策としては1件時の等時性が保てていれば十分と判断する。
    const matches: typeof candidates = [];
    if (candidates.length === 0) {
      await verifyPassword(password, DUMMY_HASH);
    } else {
      for (const candidate of candidates) {
        const credRows = await db.select().from(authCredentials).where(eq(authCredentials.userId, candidate.id)).limit(1);
        const cred = credRows[0];
        const ok = await verifyPassword(password, cred ? cred.passwordHash : DUMMY_HASH);
        if (ok && cred) matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    if (matches.length > 1) {
      // パスワード検証を通過した相手にだけテナントの一覧(id と社名)を開示する。
      // 未認証の相手にテナント名が漏れることはない。
      const tenants = await Promise.all(
        matches.map(async (m) => {
          const tenant = await getTenantById(db, m.tenantId);
          return { id: m.tenantId, name: tenant?.name ?? null };
        }),
      );
      return c.json({ error: "multiple_tenants", tenants }, 409);
    }
    const activeUser = matches[0] as (typeof matches)[number];

    // ---- 二要素認証(2026-08-27)------------------------------------------
    // パスワードが通っても、2FA が有効なら**セッションは発行しない**。代わりに
    // 「パスワードは通った」という事実だけを暗号化 Cookie(kizami_totp_tx、5分)に載せ、
    // POST /auth/login/totp でコードを検証してから初めてセッションを張る。
    //
    // 判断点(状態を DB に持たない): OIDC の認可リクエスト状態(routes/auth-oidc.ts の
    // kizami_oidc_tx)と同じ作法。中間状態テーブルを作ると放置行の掃除という運用が増える。
    // Cookie は AES-256-GCM で暗号化するので、クライアントは userId を差し替えられない。
    const totp = await getUserTotp(db, { tenantId: activeUser.tenantId, userId: activeUser.id });
    if (totp?.enabledAt != null) {
      const encryptor = options.encryptor;
      if (!encryptor) {
        // 鍵が無ければ共有鍵を復号できず、コードの検証自体が成立しない。
        // ここで素通りさせると「鍵を消せば 2FA が外れる」ことになるので、ログインを止める。
        console.error(`login: user ${activeUser.id} has 2FA enabled but no encryption key is configured`);
        return c.json({ error: "encryption_unavailable" }, 503);
      }
      const tx: TotpTransaction = { tenantId: activeUser.tenantId, userId: activeUser.id, issuedAt: nowMinutes() };
      setCookie(c, TOTP_TX_COOKIE_NAME, await encryptor.encrypt(JSON.stringify(tx)), {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        secure: options.secureCookies,
        maxAge: TOTP_TX_TTL_SECONDS,
      });
      // 200 で返すのは「認証情報は正しかった」ことの表明。401 にすると Web 側が
      // 「パスワードが違う」と区別できない。ユーザーの情報(メール・氏名)は載せない
      // — まだ本人だと確定していないため。
      return c.json({ status: "totp_required" }, 200);
    }

    const session = await createSession(db, {
      tenantId: activeUser.tenantId,
      userId: activeUser.id,
      nowMinutes: nowMinutes(),
    });
    setSessionCookie(c, session.token, { secure: options.secureCookies });

    return c.json({ user: { id: activeUser.id, email: activeUser.email, displayName: activeUser.name } }, 200);
  });

  // ---- POST /auth/login/totp ------------------------------------------------
  /**
   * ログインの第2段階。`kizami_totp_tx` Cookie(POST /auth/login が発行)と、
   * 認証アプリのコード `{ code }` またはリカバリコード `{ recoveryCode }` を受け取り、
   * 通ればセッションを発行する。
   *
   * 失敗しても tx Cookie は消さない(打ち間違いのたびにパスワードからやり直させるのは
   * 過剰。総当たりはレート制限=10回/15分で止める)。期限切れ・改竄時のみ消す。
   */
  app.post("/login/totp", async (c) => {
    const encryptor = options.encryptor;
    if (!encryptor) return c.json({ error: "encryption_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
    const { code, recoveryCode } = body as LoginTotpBody;
    const hasCode = typeof code === "string" && code !== "";
    const hasRecovery = typeof recoveryCode === "string" && recoveryCode !== "";
    // どちらか一方だけ。両方来た場合は実装ミス/総当たりの試みとして弾く(片方が通れば
    // もう片方を無視する、のような曖昧な挙動を作らない)。
    if (hasCode === hasRecovery) return c.json({ error: "invalid_body" }, 400);

    const cookieValue = getCookie(c, TOTP_TX_COOKIE_NAME);
    if (!cookieValue) return c.json({ error: "totp_expired" }, 401);
    const decrypted = await encryptor.decrypt(cookieValue);
    if (decrypted === null) {
      deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });
      return c.json({ error: "totp_expired" }, 401);
    }
    let tx: unknown;
    try {
      tx = JSON.parse(decrypted);
    } catch {
      deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });
      return c.json({ error: "totp_expired" }, 401);
    }
    if (!isTotpTransaction(tx)) {
      deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });
      return c.json({ error: "totp_expired" }, 401);
    }
    // Cookie の Max-Age はクライアント任せなので、サーバー側でも期限を確認する
    // (routes/auth-oidc.ts の OIDC_TX と同じ理由)。
    if (nowMinutes() - tx.issuedAt > TOTP_TX_TTL_MINUTES) {
      deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });
      return c.json({ error: "totp_expired" }, 401);
    }

    // レート制限(6桁の総当たり対策)。tx が正しいことを確認した後に数える
    // — 壊れた Cookie で正規利用者の枠を減らさないため。
    if (options.rateLimit?.perIpUser) {
      const ip = getClientIp(c, options.rateLimit.trustProxy);
      const result = options.rateLimit.perIpUser.check(`${ip}|${tx.userId}`);
      if (!result.allowed) return rateLimitedResponse(c, result.retryAfterSeconds);
    }

    const user = await getUserById(db, { tenantId: tx.tenantId, id: tx.userId });
    // 第1段階の後に無効化(退職処理)されている可能性がある。ここでも必ず確認する。
    if (!user || !user.isActive) {
      deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });
      return c.json({ error: "totp_expired" }, 401);
    }
    const row = await getUserTotp(db, { tenantId: tx.tenantId, userId: tx.userId });
    if (!row || row.enabledAt == null) {
      // 第1段階の後に 2FA が外された(本人が無効化 / 管理者がリセット)。もう一度
      // 最初からログインしてもらう(この Cookie だけでセッションは張らせない)。
      deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });
      return c.json({ error: "totp_expired" }, 401);
    }

    const now = nowMinutes();
    let method: "totp" | "recovery_code";

    if (hasCode) {
      const secret = await decryptSecret(encryptor, row.secretEncrypted);
      if (secret === null) {
        console.error(`login/totp: cannot decrypt secret for user ${tx.userId} (encryption key missing or mismatched)`);
        return c.json({ error: "encryption_unavailable" }, 503);
      }
      const verified = await verifyTotp({
        secret,
        code: normalizeTotpCode(code as string),
        unixSeconds: Math.floor(Date.now() / 1000),
        // リプレイ防止: 既に受理済みのカウンタ(およびそれ以前)は拒否する。
        minCounterExclusive: row.lastUsedCounter,
      });
      if (!verified) return c.json({ error: "invalid_code" }, 401);
      await updateUserTotpLastUsedCounter(db, { userId: tx.userId, lastUsedCounter: verified.counter });
      method = "totp";
    } else {
      const consumed = await consumeRecoveryCode(db, {
        tenantId: tx.tenantId,
        userId: tx.userId,
        codeHash: await hashRecoveryCode(recoveryCode as string),
        consumedAt: now,
      });
      if (!consumed) return c.json({ error: "invalid_code" }, 401);
      method = "recovery_code";
    }

    const session = await createSession(db, { tenantId: tx.tenantId, userId: tx.userId, nowMinutes: now });
    setSessionCookie(c, session.token, { secure: options.secureCookies });
    deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });

    // 監査ログ: SSO(routes/auth-oidc.ts)と同じ `auth.login` + detail.method。
    // 素のパスワードログインは従来どおり記録しないが、**2FA を通った/リカバリコードを
    // 使った**という事実は事後調査の材料になるため残す(特にリカバリコードの使用は
    // 「端末を失くした」か「攻撃者が使った」かを見分ける唯一の手掛かりになる)。
    await insertAuditLog(db, {
      tenantId: tx.tenantId,
      actorId: tx.userId,
      action: "auth.login",
      targetType: "users",
      targetId: tx.userId,
      detail: JSON.stringify({ method }),
      occurredAt: now,
    });

    return c.json({ user: { id: user.id, email: user.email, displayName: user.name } }, 200);
  });

  app.post("/logout", async (c) => {
    const token = getSessionTokenFromCookie(c);
    if (token) {
      const sessionId = await sessionIdFromToken(token);
      await db.update(sessions).set({ revokedAt: nowMinutes() }).where(eq(sessions.id, sessionId));
    }
    clearSessionCookie(c);
    // ログインの第2段階が中断されたまま残っている可能性がある(パスワードは通ったが
    // コードを入れずに離脱した後、別タブでログアウトした等)。掃除しておく。
    deleteCookie(c, TOTP_TX_COOKIE_NAME, { path: "/" });
    return c.body(null, 204);
  });

  return app;
}
