/**
 * セッション(Cookie ベース、DB 裏付け)。
 *
 * - セッショントークン = sessions.id(UUIDv7)
 * - Cookie 名 "kizami_session"、HttpOnly / SameSite=Lax / Path=/
 *   (Secure は本番のみ想定のため付けない)
 */

import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { sessions, uuidv7, type Database } from "@kizami/db";

export const SESSION_COOKIE_NAME = "kizami_session";

/** 30日(分単位)。 */
export const SESSION_TTL_MINUTES = 30 * 24 * 60;

export interface CreatedSession {
  id: string;
  expiresAt: number;
}

/** sessions 行を作成する。時刻は UTC エポック分。 */
export async function createSession(
  db: Database,
  params: { tenantId: string; userId: string; nowMinutes: number },
): Promise<CreatedSession> {
  const id = uuidv7();
  const expiresAt = params.nowMinutes + SESSION_TTL_MINUTES;
  await db.insert(sessions).values({
    id,
    tenantId: params.tenantId,
    userId: params.userId,
    createdAt: params.nowMinutes,
    expiresAt,
    revokedAt: null,
  });
  return { id, expiresAt };
}

export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

export function getSessionIdFromCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}
