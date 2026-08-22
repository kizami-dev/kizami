/**
 * 公開打刻API用のAPIキー認証(`Authorization: Bearer kzm_...`)。
 *
 * セッション(auth/session.ts)と同じ方式を踏襲する:
 * - キー = 32バイト乱数の base64url に固定プレフィクス `kzm_` を付けたもの。クライアントにのみ渡す
 * - DB(api_keys.key_hash)にはトークン全体(プレフィクス込み)の SHA-256(hex)のみ保存する。
 *   DB が読み出されても有効なトークンを復元できない
 * - プレフィクスを付けるのは、漏洩時に検出しやすくする・他のトークン種別と取り違えないため
 *   (依頼どおり)。プレフィクス自体は秘密ではなく固定文字列なので、エントロピーは32バイト分のまま
 *
 * セッションと異なりCookieを使わないため延長(スライディング期限)の概念はない。
 * 有効期限は発行時に固定(expires_at, null=無期限)。
 */

import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import { findApiKeyByHash, touchApiKeyLastUsed, users, type Database } from "@kizami/db";
import type { AppEnv, AuthUser } from "./middleware.js";
import { API_KEY_SCOPES, type ApiKeyScope } from "./api-key-scopes.js";

export const API_KEY_PREFIX = "kzm_";

const TOKEN_BYTES = 32;

/** 最終使用日時を更新する間隔(分)。毎リクエスト書き込むと更新が増えすぎるため間引く。 */
const LAST_USED_TOUCH_INTERVAL_MINUTES = 60;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 文字列の SHA-256(hex)。session.ts の sessionIdFromToken と同じアルゴリズムをキー用に汎用化したもの。 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GeneratedApiKey {
  /** クライアントへ渡すトークン("kzm_"付き)。DB には保存しない。発行時に1度だけ表示する */
  token: string;
  /** DB に保存する SHA-256(hex) */
  hash: string;
}

/** 新しいAPIキーのトークンとハッシュを生成する。 */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const raw = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(raw);
  const token = API_KEY_PREFIX + base64url(raw);
  const hash = await sha256Hex(token);
  return { token, hash };
}

/** `Authorization` ヘッダから `Bearer kzm_...` のトークンを取り出す。形式が違えば undefined。 */
export function extractApiKeyToken(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.startsWith(API_KEY_PREFIX) ? token : undefined;
}

function parseScopes(json: string): Set<ApiKeyScope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((s): s is ApiKeyScope => (API_KEY_SCOPES as readonly string[]).includes(s)));
}

/**
 * APIキー認証ミドルウェア。`c.set("user", …)` と `c.set("apiKeyScopes", …)` を設定する。
 * セッション認証(authMiddleware)とは独立しており、どちらを使うかは
 * auth/middleware.ts の authOrApiKeyMiddleware が Authorization ヘッダの有無で振り分ける。
 *
 * 失敗時のレスポンス形は authMiddleware と揃えて `{ error: "unauthorized" }` / 401 にする
 * (呼び出し側からは認証方式を区別する必要がないため)。
 */
export function apiKeyMiddleware(db: Database): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const token = extractApiKeyToken(c);
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const hash = await sha256Hex(token);
    const nowMin = Math.floor(Date.now() / 60_000);

    const row = await findApiKeyByHash(db, hash, nowMin);
    if (!row) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const userRows = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    const userRow = userRows[0];
    if (!userRow || !userRow.isActive || userRow.tenantId !== row.tenantId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // 最終使用日時: 直近 LAST_USED_TOUCH_INTERVAL_MINUTES 分以内に更新済みなら書き込みを省略する。
    if (row.lastUsedAt === null || nowMin - row.lastUsedAt >= LAST_USED_TOUCH_INTERVAL_MINUTES) {
      await touchApiKeyLastUsed(db, { id: row.id, lastUsedAt: nowMin });
    }

    const authUser: AuthUser = {
      id: userRow.id,
      tenantId: userRow.tenantId,
      email: userRow.email,
      displayName: userRow.name,
    };
    c.set("user", authUser);
    // APIキーはその時点のテナント全権限を継承しない(依頼:「そのユーザーの全権限を継承させない」)。
    // requirePermission を呼ぶエンドポイント(他者への操作等)は常に forbidden になる。
    c.set("permissions", new Map());
    c.set("apiKeyScopes", parseScopes(row.scopes));
    await next();
  };
}
