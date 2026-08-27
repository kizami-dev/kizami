/**
 * Slack連携(tenant_slack_settings / slack_user_links / slack_link_tokens)に対するクエリ層。
 *
 * - tenant_slack_settings: テナントにつき1行。getTenantSlackSettingsByTeamId が
 *   POST /slack/commands のテナント特定(team_id → tenant_id 逆引き)に使う唯一の経路。
 * - slack_user_links: 明示連携(ワンタイムトークン)の結果。1kizamiユーザーにつき1Slackアカウント
 *   まで(UNIQUE(tenant_id, user_id))。
 * - slack_link_tokens: `/punch link` が発行する短命トークン。findValidSlackLinkTokenByHash は
 *   used_at が null かつ expires_at が未来のものだけを返す(api_keys.findApiKeyByHash と同じ形)。
 */

import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Database } from "../types.js";
import { slackLinkTokens, slackUserLinks, tenantSlackSettings } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type TenantSlackSettings = typeof tenantSlackSettings.$inferSelect;

/** 指定テナントのSlack連携設定を返す(未設定なら null)。 */
export async function getTenantSlackSettings(db: Database, tenantId: string): Promise<TenantSlackSettings | null> {
  const rows = await db.select().from(tenantSlackSettings).where(eq(tenantSlackSettings.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Slack ワークスペースID(team_id)からテナントのSlack連携設定を逆引きする。
 * POST /slack/commands がテナントを特定する唯一の経路(「1テナント=1ワークスペース」前提)。
 */
export async function getTenantSlackSettingsByTeamId(db: Database, teamId: string): Promise<TenantSlackSettings | null> {
  const rows = await db.select().from(tenantSlackSettings).where(eq(tenantSlackSettings.teamId, teamId)).limit(1);
  return rows[0] ?? null;
}

export interface UpsertTenantSlackSettingsInput {
  tenantId: string;
  teamId: string | null;
  signingSecret: string | null;
  enabled: boolean;
  updatedAt: number;
  updatedBy: string;
}

/** テナントのSlack連携設定を作成、または既存行を丸ごと置き換える(部分更新ではない)。 */
export async function upsertTenantSlackSettings(
  db: Database,
  input: UpsertTenantSlackSettingsInput,
): Promise<TenantSlackSettings> {
  const values = {
    tenantId: input.tenantId,
    teamId: input.teamId,
    signingSecret: input.signingSecret,
    enabled: input.enabled,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };

  const [row] = await db
    .insert(tenantSlackSettings)
    .values(values)
    .onConflictDoUpdate({ target: tenantSlackSettings.tenantId, set: values })
    .returning();
  if (!row) {
    throw new Error("upsertTenantSlackSettings: insert/update returned no row");
  }
  return row;
}

export type SlackUserLink = typeof slackUserLinks.$inferSelect;

/** (tenantId, slackUserId) から連携済みkizamiユーザーを探す(打刻コマンドの主体特定に使う)。 */
export async function getSlackUserLinkBySlackUserId(
  db: Database,
  params: { tenantId: string; slackUserId: string },
): Promise<SlackUserLink | null> {
  const rows = await db
    .select()
    .from(slackUserLinks)
    .where(and(eq(slackUserLinks.tenantId, params.tenantId), eq(slackUserLinks.slackUserId, params.slackUserId)))
    .limit(1);
  return rows[0] ?? null;
}

/** (tenantId, userId) から既存の連携を探す(1人が複数のSlackアカウントを紐付けないための事前チェック用)。 */
export async function getSlackUserLinkByUserId(
  db: Database,
  params: { tenantId: string; userId: string },
): Promise<SlackUserLink | null> {
  const rows = await db
    .select()
    .from(slackUserLinks)
    .where(and(eq(slackUserLinks.tenantId, params.tenantId), eq(slackUserLinks.userId, params.userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface LinkSlackUserInput {
  tenantId: string;
  slackUserId: string;
  userId: string;
  linkedAt: number;
}

/**
 * Slackユーザーとkizamiユーザーの連携を作成する(`/punch link` で発行したトークンの確定時に呼ぶ)。
 *
 * このテーブルは2つのUNIQUE制約(PK (tenant_id, slack_user_id) と UNIQUE(tenant_id, user_id))を
 * 同時に満たす必要があり、`onConflictDoUpdate` は一方のターゲットしか指定できないため使えない
 * (例: 既に別のkizamiユーザーに連携済みのSlackアカウントを新しいユーザーが再連携しようとした場合、
 * PK 側の競合は解決できても user_id 側のUNIQUE制約には触れられない)。そのため、事前に
 * 「同じslack_user_id」または「同じuser_id」を持つ既存行をすべて削除してから挿入する
 * (依頼: 1人が複数のSlackアカウントを紐付けない → 再連携は「最後に確定した組が勝つ」)。
 * トランザクションで行うのは削除と挿入の間に他のリクエストが割り込んで一時的に制約違反の
 * 状態になるのを避けるため。
 */
export async function linkSlackUser(db: Database, input: LinkSlackUserInput): Promise<SlackUserLink> {
  return db.transaction(async (tx) => {
    await tx
      .delete(slackUserLinks)
      .where(
        and(
          eq(slackUserLinks.tenantId, input.tenantId),
          or(eq(slackUserLinks.slackUserId, input.slackUserId), eq(slackUserLinks.userId, input.userId)),
        ),
      );
    const [row] = await tx
      .insert(slackUserLinks)
      .values({
        tenantId: input.tenantId,
        slackUserId: input.slackUserId,
        userId: input.userId,
        linkedAt: input.linkedAt,
      })
      .returning();
    if (!row) {
      throw new Error("linkSlackUser: insert returned no row");
    }
    return row;
  });
}

export type SlackLinkToken = typeof slackLinkTokens.$inferSelect;

export interface InsertSlackLinkTokenInput {
  id?: string;
  tenantId: string;
  slackUserId: string;
  /** トークンの SHA-256(hex)。平文はここでは受け取らない */
  tokenHash: string;
  /** UTC エポック分 */
  expiresAt: number;
  createdAt: number;
}

/** slack_link_tokens へ1件追記する(`/punch link`)。id を渡さなければ UUIDv7 を生成する。 */
export async function insertSlackLinkToken(db: Database, input: InsertSlackLinkTokenInput): Promise<SlackLinkToken> {
  const id = input.id ?? uuidv7();
  const [row] = await db
    .insert(slackLinkTokens)
    .values({
      id,
      tenantId: input.tenantId,
      slackUserId: input.slackUserId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: input.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertSlackLinkToken: insert returned no row");
  }
  return row;
}

/**
 * トークンのハッシュから有効なトークンを1件探す(連携用)。
 * used_at が null かつ expires_at が nowMinutes より未来のものだけを返す。
 * それ以外(使用済み・期限切れ・そもそも存在しない)は null。
 */
export async function findValidSlackLinkTokenByHash(
  db: Database,
  tokenHash: string,
  nowMinutes: number,
): Promise<SlackLinkToken | null> {
  const rows = await db
    .select()
    .from(slackLinkTokens)
    .where(and(eq(slackLinkTokens.tokenHash, tokenHash), isNull(slackLinkTokens.usedAt), gt(slackLinkTokens.expiresAt, nowMinutes)))
    .limit(1);
  return rows[0] ?? null;
}

/** トークンを使用済みにする(冪等ではない — 呼び出し側は findValidSlackLinkTokenByHash で存在確認済みのものだけを渡すこと)。 */
export async function markSlackLinkTokenUsed(db: Database, params: { id: string; usedAt: number }): Promise<void> {
  await db.update(slackLinkTokens).set({ usedAt: params.usedAt }).where(eq(slackLinkTokens.id, params.id));
}
