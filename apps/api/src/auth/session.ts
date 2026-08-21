/**
 * セッション(Cookie ベース、DB 裏付け)。
 *
 * - セッショントークン = 32バイト乱数の base64url(クライアントにのみ渡す)
 * - DB(sessions.id)にはトークンの SHA-256(hex)のみ保存する。
 *   DB が読み出されても有効なトークンを復元できない
 * - Cookie 名 "kizami_session"、HttpOnly / SameSite=Lax / Path=/。
 *   Secure はデプロイ設定で付与(node.ts 既定 ON、COOKIE_SECURE=false で無効化)
 */

import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { sessions, type Database } from "@kizami/db";

export const SESSION_COOKIE_NAME = "kizami_session";

/** 30日(分単位)。 */
export const SESSION_TTL_MINUTES = 30 * 24 * 60;

const TOKEN_BYTES = 32;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** トークン → sessions.id(SHA-256 hex)。 */
export async function sessionIdFromToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CreatedSession {
  /** クライアントへ渡すトークン。DB には保存しない */
  token: string;
  expiresAt: number;
}

/** sessions 行を作成する。時刻は UTC エポック分。 */
export async function createSession(
  db: Database,
  params: { tenantId: string; userId: string; nowMinutes: number },
): Promise<CreatedSession> {
  const raw = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(raw);
  const token = base64url(raw);
  const id = await sessionIdFromToken(token);

  const expiresAt = params.nowMinutes + SESSION_TTL_MINUTES;
  await db.insert(sessions).values({
    id,
    tenantId: params.tenantId,
    userId: params.userId,
    createdAt: params.nowMinutes,
    expiresAt,
    revokedAt: null,
  });
  return { token, expiresAt };
}

export function setSessionCookie(c: Context, token: string, options: { secure: boolean }): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: options.secure,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

export function getSessionTokenFromCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}
