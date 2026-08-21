/**
 * POST /auth/login, POST /auth/logout
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { authCredentials, sessions, users, type Database } from "@kizami/db";
import { verifyPassword } from "../auth/password.js";
import {
  clearSessionCookie,
  createSession,
  getSessionTokenFromCookie,
  sessionIdFromToken,
  setSessionCookie,
} from "../auth/session.js";
import { nowMinutes } from "../lib/time.js";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/**
 * ユーザー列挙対策のダミーハッシュ。メール不存在・無効ユーザーでも
 * これに対する検証を実行し、応答時間を実在ユーザーと揃える。
 * (値は破棄するため中身は任意の well-formed な文字列でよい)
 */
const DUMMY_HASH = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export function createAuthRoutes(db: Database, options: { secureCookies: boolean }) {
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
    const { email, password } = body as LoginBody;
    if (typeof email !== "string" || typeof password !== "string" || email === "" || password === "") {
      return c.json({ error: "invalid_body" }, 400);
    }

    const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = userRows[0];

    let cred: { passwordHash: string } | undefined;
    if (user) {
      const credRows = await db.select().from(authCredentials).where(eq(authCredentials.userId, user.id)).limit(1);
      cred = credRows[0];
    }

    // ユーザー不存在・無効・資格情報なしでも必ず1回ハッシュ検証を行い、応答時間を揃える
    const usable = user !== undefined && user.isActive && cred !== undefined;
    const ok = await verifyPassword(password, usable ? (cred as { passwordHash: string }).passwordHash : DUMMY_HASH);
    if (!usable || !ok) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    const activeUser = user as NonNullable<typeof user>;

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
