/**
 * POST /auth/login, POST /auth/logout
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { authCredentials, getTenantById, sessions, users, type Database } from "@kizami/db";
import { verifyPassword } from "../auth/password.js";
import {
  clearSessionCookie,
  createSession,
  getSessionTokenFromCookie,
  sessionIdFromToken,
  setSessionCookie,
} from "../auth/session.js";
import { getClientIp } from "../lib/client-ip.js";
import { rateLimitedResponse, type RateLimiter } from "../lib/rate-limit.js";
import { nowMinutes } from "../lib/time.js";

interface LoginBody {
  email?: unknown;
  password?: unknown;
  /** 複数テナントに同一メールが存在する場合のテナント指定(409 multiple_tenants への応答で使う) */
  tenantId?: unknown;
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
    /** 前段プロキシ(Cloudflare Tunnel)のヘッダを信頼するか。lib/client-ip.ts 参照。 */
    trustProxy: boolean;
  };
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

    const session = await createSession(db, {
      tenantId: activeUser.tenantId,
      userId: activeUser.id,
      nowMinutes: nowMinutes(),
    });
    setSessionCookie(c, session.token, { secure: options.secureCookies });

    return c.json({ user: { id: activeUser.id, email: activeUser.email, displayName: activeUser.name } }, 200);
  });

  app.post("/logout", async (c) => {
    const token = getSessionTokenFromCookie(c);
    if (token) {
      const sessionId = await sessionIdFromToken(token);
      await db.update(sessions).set({ revokedAt: nowMinutes() }).where(eq(sessions.id, sessionId));
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  return app;
}
