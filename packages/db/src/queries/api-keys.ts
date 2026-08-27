/**
 * api_keys に対するクエリ層。
 *
 * - insertApiKey: 発行(scopes は文字列配列で受け取り、JSON文字列にして保存する)
 * - findApiKeyByHash: 認証用。revoked_at が null かつ(expires_at が null または未来)のものだけ返す
 * - listApiKeys: 一覧用。key_hash は含めない(平文はもちろん、ハッシュも一覧APIでは返さない)
 * - revokeApiKey: 失効(行は消さず revoked_at を立てる)。既に失効済みなら null を返す(冪等呼び出しの検出用)
 * - touchApiKeyLastUsed: 最終使用日時を更新する。呼ぶかどうか(間引き)の判断は呼び出し側の責務
 */

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { apiKeys } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type ApiKey = typeof apiKeys.$inferSelect;

/** 一覧APIで返してよい列のみ(key_hash を含まない)。 */
export type ApiKeySummary = Omit<ApiKey, "keyHash">;

const SUMMARY_COLUMNS = {
  id: apiKeys.id,
  tenantId: apiKeys.tenantId,
  userId: apiKeys.userId,
  name: apiKeys.name,
  scopes: apiKeys.scopes,
  expiresAt: apiKeys.expiresAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  createdBy: apiKeys.createdBy,
  createdAt: apiKeys.createdAt,
} as const;

export interface NewApiKeyInput {
  id?: string;
  tenantId: string;
  userId: string;
  name: string;
  /** トークンの SHA-256(hex)。平文はここでは受け取らない(呼び出し側が生成・表示済み) */
  keyHash: string;
  scopes: string[];
  /** UTC エポック分。null = 無期限 */
  expiresAt: number | null;
  createdBy: string;
  createdAt: number;
}

/** api_keys へ1件追記する。id を渡さなければ UUIDv7 を生成する。 */
export async function insertApiKey(db: Database | Transaction, input: NewApiKeyInput): Promise<ApiKey> {
  const id = input.id ?? uuidv7();
  const [row] = await db
    .insert(apiKeys)
    .values({
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      name: input.name,
      keyHash: input.keyHash,
      scopes: JSON.stringify(input.scopes),
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertApiKey: insert returned no row");
  }
  return row;
}

/**
 * トークンのハッシュから有効なキーを1件探す(認証用)。
 * revoked_at が null かつ(expires_at が null または nowMinutes より未来)のものだけを返す。
 * それ以外(未失効だが失効済み・期限切れ・そもそも存在しない)は null。
 */
export async function findApiKeyByHash(db: Database, keyHash: string, nowMinutes: number): Promise<ApiKey | null> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, keyHash),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, nowMinutes)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getApiKeyById(db: Database, params: { tenantId: string; id: string }): Promise<ApiKey | null> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, params.tenantId), eq(apiKeys.id, params.id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ListApiKeysParams {
  tenantId: string;
  /** 省略時はテナント全体(呼び出し側で api_key.manage の確認を済ませてから呼ぶこと)。 */
  userId?: string;
}

/** key_hash を含まない一覧を作成日時の新しい順で返す。 */
export async function listApiKeys(db: Database, params: ListApiKeysParams): Promise<ApiKeySummary[]> {
  const conditions = params.userId
    ? and(eq(apiKeys.tenantId, params.tenantId), eq(apiKeys.userId, params.userId))
    : eq(apiKeys.tenantId, params.tenantId);

  return db.select(SUMMARY_COLUMNS).from(apiKeys).where(conditions).orderBy(desc(apiKeys.createdAt));
}

export interface RevokeApiKeyParams {
  tenantId: string;
  id: string;
  /** UTC エポック分 */
  revokedAt: number;
}

/** 失効させる(行は消さず revoked_at を立てる)。既に失効済み・存在しない場合は null。 */
export async function revokeApiKey(db: Database, params: RevokeApiKeyParams): Promise<ApiKey | null> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: params.revokedAt })
    .where(and(eq(apiKeys.tenantId, params.tenantId), eq(apiKeys.id, params.id), isNull(apiKeys.revokedAt)))
    .returning();
  return row ?? null;
}

export interface TouchApiKeyLastUsedParams {
  id: string;
  /** UTC エポック分 */
  lastUsedAt: number;
}

/** 最終使用日時を更新する。呼ぶかどうか(直近1時間以内は呼ばない等)の間引きは呼び出し側の責務。 */
export async function touchApiKeyLastUsed(db: Database, params: TouchApiKeyLastUsedParams): Promise<void> {
  await db.update(apiKeys).set({ lastUsedAt: params.lastUsedAt }).where(eq(apiKeys.id, params.id));
}
