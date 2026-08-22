/**
 * work_policies / work_policy_versions(労働時間制の設定。フレックスタイム制/固定時間制。
 * effective-dated, 追記専用)に対する最小限のクエリ層。
 *
 * v0.1〜v0.2 のアプリは「テナント1つにつき work_policy 1件」で運用する(seed.ts が常に1件だけ
 * 作成し、複数の制度を切り替えるUIは無い)。このファイルもその前提に立ち、
 * `getOrCreateTenantWorkPolicy` で「無ければ作る」形にして、seed を経由していないテナント
 * (テスト DB 等)でも GET/POST /settings/work-policy が動く形にしている(判断点)。
 */

import { and, asc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { workPolicies, workPolicyVersions } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type WorkPolicy = typeof workPolicies.$inferSelect;
export type WorkPolicyVersion = typeof workPolicyVersions.$inferSelect;

/** テナントの work_policy を1件返す(複数ある場合は createdAt が最も古いもの)。無ければ null。 */
export async function getTenantWorkPolicy(db: Database | Transaction, tenantId: string): Promise<WorkPolicy | null> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId)).orderBy(asc(workPolicies.createdAt)).limit(1);
  return rows[0] ?? null;
}

export interface GetOrCreateTenantWorkPolicyParams {
  tenantId: string;
  /** 新規作成時のみ使う名前 */
  name: string;
  /** 新規作成時のみ使う UTC エポック分 */
  createdAt: number;
}

/** テナントの work_policy を返す。無ければ新規作成する(通常運用では seed 済みで既に存在する)。 */
export async function getOrCreateTenantWorkPolicy(db: Database | Transaction, params: GetOrCreateTenantWorkPolicyParams): Promise<WorkPolicy> {
  const existing = await getTenantWorkPolicy(db, params.tenantId);
  if (existing) return existing;
  const [row] = await db
    .insert(workPolicies)
    .values({ id: uuidv7(), tenantId: params.tenantId, name: params.name, createdAt: params.createdAt })
    .returning();
  if (!row) {
    throw new Error("getOrCreateTenantWorkPolicy: insert returned no row");
  }
  return row;
}

/** work_policy の全版を effective_from 昇順で返す(版の履歴表示用)。 */
export async function listWorkPolicyVersions(
  db: Database | Transaction,
  params: { tenantId: string; workPolicyId: string },
): Promise<WorkPolicyVersion[]> {
  return db
    .select()
    .from(workPolicyVersions)
    .where(and(eq(workPolicyVersions.tenantId, params.tenantId), eq(workPolicyVersions.workPolicyId, params.workPolicyId)))
    .orderBy(asc(workPolicyVersions.effectiveFrom));
}

export interface InsertWorkPolicyVersionParams {
  tenantId: string;
  workPolicyId: string;
  /** ローカル日付 "YYYY-MM-DD"。この日から有効 */
  effectiveFrom: string;
  /** 労働時間制の種別: "flex"(フレックスタイム制) | "fixed"(固定時間制)。呼び出し側が明示する */
  kind: string;
  /** 清算期間。flex 専用("monthly" 固定)。kind = "fixed" のときは無視される */
  settlementPeriod: string;
  standardDayMinutes: number;
  /** UTC エポック分 */
  createdAt: number;
}

/**
 * 新しい版を1件追記する(UPDATE ではない)。過去日禁止・重複禁止のバリデーションは
 * 呼び出し側(apps/api/src/routes/settings.ts)が行う。
 */
export async function insertWorkPolicyVersion(db: Database | Transaction, params: InsertWorkPolicyVersionParams): Promise<WorkPolicyVersion> {
  const [row] = await db
    .insert(workPolicyVersions)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      workPolicyId: params.workPolicyId,
      effectiveFrom: params.effectiveFrom,
      kind: params.kind,
      settlementPeriod: params.settlementPeriod,
      core: null,
      standardDayMinutes: params.standardDayMinutes,
      createdAt: params.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertWorkPolicyVersion: insert returned no row");
  }
  return row;
}
