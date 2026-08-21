/**
 * Cookie セッションによる認証ミドルウェア。
 *
 * Cookie → sessions 検索(revoked_at null かつ未失効)→ c.set("user", …)。
 * 未認証は 401 { error: "unauthorized" }。
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import { sessions, users, type Database } from "@kizami/db";
import {
  getSessionTokenFromCookie,
  renewSession,
  sessionIdFromToken,
  setSessionCookie,
  shouldRenew,
} from "./session.js";

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
}

export interface AppEnv {
  Variables: { user: AuthUser };
}

export function authMiddleware(db: Database, options: { secureCookies: boolean }): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const token = getSessionTokenFromCookie(c);
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const sessionId = await sessionIdFromToken(token);

    const nowMinutes = Math.floor(Date.now() / 60_000);

    const rows = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .limit(1);

    const row = rows[0];
    if (!row || row.session.expiresAt <= nowMinutes || !row.user.isActive) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // 使い続けている限りログアウトさせない(残り期限が半分を切ったら延長)
    if (shouldRenew(row.session.expiresAt, nowMinutes)) {
      await renewSession(db, { sessionId, nowMinutes });
      setSessionCookie(c, token, { secure: options.secureCookies });
    }

    const authUser: AuthUser = {
      id: row.user.id,
      tenantId: row.user.tenantId,
      email: row.user.email,
      displayName: row.user.name,
    };
    c.set("user", authUser);
    await next();
  };
}
