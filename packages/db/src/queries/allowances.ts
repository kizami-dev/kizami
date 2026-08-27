/**
 * allowance_definitions / allowance_definition_versions(手当定義、effective-dated、追記専用)
 * に対する最小限のクエリ層。docs/design/allowances.md 参照。
 *
 * work-policies.ts と違い「テナントにつき1件」の前提が無い(手当は何件でも並行して存在しうる)
 * ため getOrCreate 的なヘルパーは持たず、素直に作成・一覧・版追加の CRUD を並べる。
 */

import { and, asc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { allowanceDefinitions, allowanceDefinitionVersions } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type AllowanceDefinition = typeof allowanceDefinitions.$inferSelect;
export type AllowanceDefinitionVersion = typeof allowanceDefinitionVersions.$inferSelect;

/** テナントの手当定義を一覧する(識別子のみ。名前・条件は版が持つので別途版を引く)。 */
export async function listAllowanceDefinitions(db: Database | Transaction, tenantId: string): Promise<AllowanceDefinition[]> {
  return db.select().from(allowanceDefinitions).where(eq(allowanceDefinitions.tenantId, tenantId)).orderBy(asc(allowanceDefinitions.createdAt));
}

export interface CreateAllowanceDefinitionParams {
  tenantId: string;
  /** 初版の適用開始日。ローカル日付 "YYYY-MM-DD" */
  effectiveFrom: string;
  name: string;
  /** AllowanceDefinition["conditions"](engine 側の型)の JSON 文字列。DB 層は中身を解釈しない */
  conditions: string;
  /** UTC エポック分 */
  createdAt: number;
}

/**
 * 手当定義を新規作成する(識別子行 + 初版を1回で作る)。以降の変更は
 * insertAllowanceDefinitionVersion で版を追記する(過去日禁止・重複禁止のバリデーションは
 * insertAllowanceDefinitionVersion 側と同じく呼び出し側 apps/api/src/routes/settings.ts が行う)。
 */
export async function createAllowanceDefinition(
  db: Database | Transaction,
  params: CreateAllowanceDefinitionParams,
): Promise<{ definition: AllowanceDefinition; version: AllowanceDefinitionVersion }> {
  const [definition] = await db
    .insert(allowanceDefinitions)
    .values({ id: uuidv7(), tenantId: params.tenantId, createdAt: params.createdAt })
    .returning();
  if (!definition) {
    throw new Error("createAllowanceDefinition: insert returned no row (definition)");
  }
  const [version] = await db
    .insert(allowanceDefinitionVersions)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      definitionId: definition.id,
      effectiveFrom: params.effectiveFrom,
      name: params.name,
      conditions: params.conditions,
      createdAt: params.createdAt,
    })
    .returning();
  if (!version) {
    throw new Error("createAllowanceDefinition: insert returned no row (version)");
  }
  return { definition, version };
}

/** 手当定義の全版を effective_from 昇順で返す(版の履歴表示用)。 */
export async function listAllowanceDefinitionVersions(
  db: Database | Transaction,
  params: { tenantId: string; definitionId: string },
): Promise<AllowanceDefinitionVersion[]> {
  return db
    .select()
    .from(allowanceDefinitionVersions)
    .where(and(eq(allowanceDefinitionVersions.tenantId, params.tenantId), eq(allowanceDefinitionVersions.definitionId, params.definitionId)))
    .orderBy(asc(allowanceDefinitionVersions.effectiveFrom));
}

export interface InsertAllowanceDefinitionVersionParams {
  tenantId: string;
  definitionId: string;
  /** ローカル日付 "YYYY-MM-DD"。この日から有効 */
  effectiveFrom: string;
  name: string;
  /** AllowanceDefinition["conditions"] の JSON 文字列 */
  conditions: string;
  /** UTC エポック分 */
  createdAt: number;
}

/** 新しい版を1件追記する(UPDATE ではない)。バリデーションは呼び出し側が行う。 */
export async function insertAllowanceDefinitionVersion(
  db: Database | Transaction,
  params: InsertAllowanceDefinitionVersionParams,
): Promise<AllowanceDefinitionVersion> {
  const [row] = await db
    .insert(allowanceDefinitionVersions)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      definitionId: params.definitionId,
      effectiveFrom: params.effectiveFrom,
      name: params.name,
      conditions: params.conditions,
      createdAt: params.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertAllowanceDefinitionVersion: insert returned no row");
  }
  return row;
}

/** rows の中から effectiveFrom <= date の最新行を返す(getSettingsTimeline と同じヘルパー)。 */
function latestAtOrBefore<T extends { effectiveFrom: string }>(rows: T[], date: string): T | undefined {
  let chosen: T | undefined;
  for (const row of rows) {
    if (row.effectiveFrom <= date && (chosen === undefined || row.effectiveFrom > chosen.effectiveFrom)) {
      chosen = row;
    }
  }
  return chosen;
}

export interface GetAllowanceDefinitionVersionsTimelineParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD"(期間初日) */
  fromDate: string;
  /** ローカル日付 "YYYY-MM-DD"(期間末日) */
  toDate: string;
}

/**
 * [fromDate, toDate] に関係する版を、**定義ごとに独立して** queries/settings.ts の
 * getSettingsTimeline と同じ規則(「fromDate 以前の最新版1件」+「期間内の版全部」)で集め、
 * 定義をまたいで結合した1本の配列を返す(apps/api 側の buildAllowanceTimeline が
 * engine の AllowanceTimelineSpan[] へ組み立てる際の入力になる — 「buildSettingsTimeline が
 * 使える形」という依頼の意図に沿い、tenant_setting_versions と同じ形で結果を返している)。
 *
 * tenant_setting_versions と違い手当定義は複数系列(definition_id ごと)が並行して存在するため、
 * 単純に「全体で最新版1件」を取るわけにはいかない — 系列ごとに個別解決してから合流させる。
 */
export async function getAllowanceDefinitionVersionsTimeline(
  db: Database | Transaction,
  params: GetAllowanceDefinitionVersionsTimelineParams,
): Promise<AllowanceDefinitionVersion[]> {
  // 追記専用テーブルなので全件取得しても件数は「手当定義の数 × 版更新の回数」に収まる想定
  // (tenant_setting_versions の listTenantSettingVersions と同じ前提)。
  const allVersions = await db
    .select()
    .from(allowanceDefinitionVersions)
    .where(eq(allowanceDefinitionVersions.tenantId, params.tenantId))
    .orderBy(asc(allowanceDefinitionVersions.effectiveFrom));

  const byDefinition = new Map<string, AllowanceDefinitionVersion[]>();
  for (const version of allVersions) {
    const list = byDefinition.get(version.definitionId);
    if (list) {
      list.push(version);
    } else {
      byDefinition.set(version.definitionId, [version]);
    }
  }

  const result: AllowanceDefinitionVersion[] = [];
  for (const versions of byDefinition.values()) {
    const latestBeforeOrOnFrom = latestAtOrBefore(versions, params.fromDate);
    const withinPeriod = versions.filter((v) => v.effectiveFrom >= params.fromDate && v.effectiveFrom <= params.toDate);
    const alreadyIncluded = latestBeforeOrOnFrom !== undefined && withinPeriod.some((v) => v.id === latestBeforeOrOnFrom.id);
    if (latestBeforeOrOnFrom !== undefined && !alreadyIncluded) {
      result.push(latestBeforeOrOnFrom);
    }
    result.push(...withinPeriod);
  }

  return result.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}
