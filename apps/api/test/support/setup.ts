/**
 * テスト専用のシードヘルパ。テナント1件・タイムゾーンJST固定・日界0時・
 * フレックス月清算(標準1日480分)・ユーザー1件を最小限で投入する。
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  authCredentials,
  migrateDb,
  permissionPresets,
  presetAssignments,
  tenantSettingVersions,
  tenants,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  workPolicyVersions,
  type Database,
} from "@kizami/db";
import { createEncryptor, type Encryptor } from "@kizami/crypto";
import type { BreakRule } from "@kizami/engine";
import { hashPassword } from "../../src/auth/password.js";

/**
 * テスト専用の固定鍵から Encryptor を作る(暗号化を有効にした状態を再現するため)。
 * settings-notifications.test.ts に元々あったものと同一実装 — 複数のテスト(個人通知設定を
 * 含む)から共有して使えるようここに集約する。
 */
export function testEncryptor(): Encryptor {
  const keyBytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of keyBytes) binary += String.fromCharCode(b);
  return createEncryptor(btoa(binary));
}

export interface SeededTenant {
  db: Database;
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  displayName: string;
}

/**
 * マイグレーション済みの空の DB を1つ作る(テナントもユーザーも入れない)。
 *
 * @libsql/client のローカル sqlite3 ドライバは `db.transaction()` 実行後、client 側の
 * ネイティブ接続を手放し次回アクセス時に遅延再接続する。`:memory:` だとその再接続が
 * 新規の空DBになりデータが失われる(修正申請の承認処理が db.transaction を使うため、
 * このテスト DB でそれ以降のリクエストが軒並み失敗する)。ファイルバックエンドにして回避する。
 */
export async function createTestDatabase(): Promise<Database> {
  const dbPath = join(tmpdir(), `kizami-api-test-${randomUUID()}.db`);
  const { db } = await migrateDb({ url: `file:${dbPath}` });
  return db;
}

/**
 * @param existingDb 既にマイグレーション済みの DB を使う場合に渡す(PostgreSQL 疎通の
 *   スモークテスト用。省略時は従来どおり一時ファイルの SQLite を作る)
 */
export async function setupTestDb(existingDb?: Database): Promise<SeededTenant> {
  const db = existingDb ?? (await createTestDatabase());
  const now = 0;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const email = "test@example.com";
  const password = "correct horse battery staple";
  const displayName = "Test User";

  await db.insert(tenants).values({ id: tenantId, name: "Test Tenant", createdAt: now });

  await db.insert(tenantSettingVersions).values({
    id: uuidv7(),
    tenantId,
    effectiveFrom: "1970-01-01",
    dayBoundaryMinutes: 0,
    legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
    breakRule: JSON.stringify({ mode: "punch" }),
    gpsEnabled: false,
    gpsRetentionDays: null,
    createdAt: now,
  });

  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId, name: "Flex", createdAt: now });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    settlementPeriod: "monthly",
    core: null,
    standardDayMinutes: 480,
    createdAt: now,
  });

  await db.insert(users).values({ id: userId, tenantId, email, name: displayName, isActive: true, createdAt: now });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId,
    userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: now,
  });

  return { db, tenantId, userId, email, password, displayName };
}

/**
 * setupTestDb() 済みのテナントを固定時間制へ切り替える(新しい work_policy_versions を追記する、
 * 原則6どおり追記専用)。
 *
 * 既定の effectiveFrom は "2000-01-01"(setupTestDb() が作るフレックスの初期版と同じ
 * "1970-01-01" にはしない — buildSettingsTimeline の latestAtOrBefore は effectiveFrom が
 * 同値の場合どちらを選ぶか未定義〔先勝ち〕になり、テストで使う 2026年の対象期間に対して
 * どちらの版が有効になるか不安定になるため、確実にフレックス版より後で・テスト対象期間より
 * 十分前の日付にしている)。
 */
export async function switchToFixedWorkPolicy(
  db: Database,
  params: { tenantId: string; standardDayMinutes: number; effectiveFrom?: string },
): Promise<void> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, params.tenantId)).limit(1);
  const workPolicyId = rows[0]?.id;
  if (!workPolicyId) {
    throw new Error("switchToFixedWorkPolicy: no work_policies row found for tenant (call setupTestDb() first)");
  }
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    workPolicyId,
    effectiveFrom: params.effectiveFrom ?? "2000-01-01",
    kind: "fixed",
    settlementPeriod: "monthly", // fixed では無視される列。プレースホルダとして "monthly" を入れる
    core: null,
    standardDayMinutes: params.standardDayMinutes,
    createdAt: 0,
  });
}

/**
 * `setupTestDb()` 済みのテナントを monthly_variable(シフト制)へ切り替える
 * (switchToFixedWorkPolicy と同じ形。settlementPeriod/standardDayMinutes は
 * monthly_variable では無視されるプレースホルダ — routes/settings/work-policy.ts の
 * VARIABLE_STANDARD_DAY_MINUTES_PLACEHOLDER と同じ理由)。
 */
export async function switchToMonthlyVariableWorkPolicy(
  db: Database,
  params: { tenantId: string; effectiveFrom?: string },
): Promise<void> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, params.tenantId)).limit(1);
  const workPolicyId = rows[0]?.id;
  if (!workPolicyId) {
    throw new Error("switchToMonthlyVariableWorkPolicy: no work_policies row found for tenant (call setupTestDb() first)");
  }
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    workPolicyId,
    effectiveFrom: params.effectiveFrom ?? "2000-01-01",
    kind: "monthly_variable",
    settlementPeriod: "monthly",
    core: null,
    standardDayMinutes: 480,
    createdAt: 0,
  });
}

/**
 * `setupTestDb()` 済みのテナントの variablePeriodStartDay を設定する(新しい
 * tenant_setting_versions を追記する、setBreakRule と同じ形)。
 */
export async function setVariablePeriodStartDay(
  db: Database,
  params: { tenantId: string; variablePeriodStartDay: number; effectiveFrom?: string },
): Promise<void> {
  await db.insert(tenantSettingVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    effectiveFrom: params.effectiveFrom ?? "2000-01-01",
    dayBoundaryMinutes: 0,
    legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
    breakRule: JSON.stringify({ mode: "punch" }),
    gpsEnabled: false,
    gpsRetentionDays: null,
    variablePeriodStartDay: params.variablePeriodStartDay,
    createdAt: 0,
  });
}

/**
 * `setupTestDb()` 済みのテナントの breakRule を切り替える(新しい tenant_setting_versions を
 * 追記する、switchToFixedWorkPolicy と同じ「原則6どおり追記専用」の形)。
 *
 * POST /settings/attendance ではなく直接 DB へ挿入する理由: そのエンドポイントは
 * 過去日への版追加を禁止する(`effectiveFrom < today` は 409)ため、テストで固定した
 * "今日"(FIXED_NOW)より前の対象月(例: 2026-04)に対して breakRule を効かせたい場合、
 * API 経由では実現できない。switchToFixedWorkPolicy と同じ理由で "1970-01-01"(setupTestDb
 * の初期版と同値)は避け、既定 "2000-01-01" にする。
 */
export async function setBreakRule(
  db: Database,
  params: { tenantId: string; breakRule: BreakRule; effectiveFrom?: string },
): Promise<void> {
  await db.insert(tenantSettingVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    effectiveFrom: params.effectiveFrom ?? "2000-01-01",
    dayBoundaryMinutes: 0,
    legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
    breakRule: JSON.stringify(params.breakRule),
    gpsEnabled: false,
    gpsRetentionDays: null,
    createdAt: 0,
  });
}

export interface SeededSecondUser {
  userId: string;
  email: string;
  password: string;
}

/**
 * `setupTestDb()` が作った同一テナントへ、もう1人ユーザーを追加する(修正申請の
 * 「他人のイベント」バリデーションテスト用)。work_policy 割当は行わない
 * (打刻・修正申請のテストのみが対象で、勤怠集計は使わないため)。
 */
export async function setupSecondUser(db: Database, tenantId: string): Promise<SeededSecondUser> {
  const now = 0;
  const userId = uuidv7();
  const email = "second@example.com";
  const password = "another horse battery staple";

  await db.insert(users).values({ id: userId, tenantId, email, name: "Second User", isActive: true, createdAt: now });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });

  return { userId, email, password };
}

/**
 * `setupSecondUser` と同じことを任意のメールアドレス・氏名で行う(3人目以降が要るテスト用)。
 * work_policy 割当は行わない(setupSecondUser と同じ)。
 */
export async function setupExtraUser(
  db: Database,
  params: { tenantId: string; email: string; name: string },
): Promise<SeededSecondUser> {
  const now = 0;
  const userId = uuidv7();
  const password = "yet another horse battery staple";

  await db.insert(users).values({ id: userId, tenantId: params.tenantId, email: params.email, name: params.name, isActive: true, createdAt: now });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    userId,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });

  return { userId, email: params.email, password };
}

export function extractCookie(res: Response): string {
  const setCookieHeader = res.headers.get("set-cookie");
  if (!setCookieHeader) {
    throw new Error("response has no set-cookie header");
  }
  return setCookieHeader.split(";")[0] as string;
}

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

export async function loginAndGetCookie(app: RequestLike, email: string, password: string): Promise<string> {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`login failed with status ${res.status}`);
  }
  return extractCookie(res);
}

/** ローカル JST の日時から UTC エポック分を計算する(テスト専用、tzOffset=540 固定)。 */
export function jstMinutes(year: number, month: number, day: number, hour: number, minute: number): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour - 9, minute) / 60_000);
}

/**
 * requirePermission のテスト用: 単一の権限を1件だけ持つ使い捨てプリセットを作り、
 * 指定ユーザーに割り当てる(@kizami/authz の Grant 形式ではなく DB の grants JSON 形式
 * `{ key, scope }[]` — apps/api/src/seed.ts と同じ形)。
 */
export async function grantPermission(
  db: Database,
  params: { tenantId: string; userId: string; permission: string; scope: string },
): Promise<void> {
  const presetId = uuidv7();
  await db.insert(permissionPresets).values({
    id: presetId,
    tenantId: params.tenantId,
    name: `test-grant:${params.permission}`,
    grants: JSON.stringify([{ key: params.permission, scope: params.scope }]),
    isSystem: false,
    createdAt: 0,
  });
  await db.insert(presetAssignments).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    userId: params.userId,
    presetId,
    createdAt: 0,
  });
}
