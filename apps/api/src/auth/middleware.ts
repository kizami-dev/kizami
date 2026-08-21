/**
 * Cookie セッションによる認証ミドルウェア。
 *
 * Cookie → sessions 検索(revoked_at null かつ未失効)→ c.set("user", …)。
 * 未認証は 401 { error: "unauthorized" }。
 *
 * v0.2: 認証に続けて実効権限(preset_assignments → permission_presets.grants を合成・
 * 展開したもの)もリクエストごとに1回だけ評価し、`c.set("permissions", …)` にキャッシュする
 * (apps/api/src/authz.ts の loadEffectivePermissions / requirePermission を参照)。
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { PermissionKey, Scope } from "@kizami/authz";
import { sessions, users, type Database } from "@kizami/db";
import { loadEffectivePermissions } from "../authz.js";
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
  Variables: { user: AuthUser; permissions: Map<PermissionKey, Scope> };
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
    c.set("permissions", await loadEffectivePermissions(db, authUser));
    await next();
  };
}
