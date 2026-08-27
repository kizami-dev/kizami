/**
 * SQLite → PostgreSQL データ移行ツール(src/migrate-data.ts)のエンドツーエンド。
 *
 * このファイルだけは**両ダイアレクトのハンドルを同時に**必要とするので、他のテストのように
 * test/support/db.ts の分岐に乗らない:
 * - コピー元は `src/migrate.ts` の `migrateDb` を直接呼んで作る(常に libSQL の in-memory)
 * - コピー先は test/support/db.ts の `migrateDb`(PostgreSQL レグでは専用スキーマを切る)
 *
 * したがってコピーの検証は **PostgreSQL レグ(TEST_PG_URL 設定時)でだけ**走る。
 * SQLite レグでは、ダイアレクトに依存しないコピー順(FK グラフ)の検証だけを走らせる。
 */

import { describe, expect, it, vi } from "vitest";
import { buildTablePlans, copyDatabase } from "../src/migrate-data.js";
import { migrateDb as migrateRealDb } from "../src/migrate.js";
import {
  closingEvents,
  closingSnapshots,
  departments,
  leaveGrants,
  memberships,
  notifications,
  punchEvents,
  tenantLeaveSettings,
  tenants,
  users,
  userTotp,
} from "../src/schema/index.js";
import type { DatabaseHandle } from "../src/types.js";
import { uuidv7 } from "../src/uuid.js";
import { isPostgresTestRun, migrateDb } from "./support/db.js";

// 1件のテストが 43 テーブル分のコピー + 検証(数百往復)を回すため、既定の 5 秒では
// 他のテストファイルと並列に走ったときに足りない。
vi.setConfig({ testTimeout: 60_000 });

describe("migrate-data: コピー順(FK グラフ)", () => {
  it("参照先が必ず先に来る順序を作る", () => {
    const plans = buildTablePlans();
    const position = new Map(plans.map((plan, index) => [plan.name, index]));
    expect(position.get("tenants")).toBeLessThan(position.get("users") as number);
    expect(position.get("users")).toBeLessThan(position.get("punch_events") as number);
    expect(position.get("closing_events")).toBeLessThan(position.get("closing_snapshots") as number);
    expect(position.get("departments")).toBeLessThan(position.get("memberships") as number);
    expect(plans.length).toBeGreaterThan(40);
  });

  it("自己参照 FK を「後から埋める列」として拾う", () => {
    const plans = new Map(buildTablePlans().map((plan) => [plan.name, plan]));
    expect(plans.get("punch_events")?.selfRefKeys).toEqual(["supersedesId"]);
    expect(plans.get("departments")?.selfRefKeys).toEqual(["parentId"]);
    expect(plans.get("shift_days")?.selfRefKeys).toEqual(["supersedesId"]);
    expect(plans.get("users")?.selfRefKeys).toEqual([]);
  });
});

/** テスト用の代表データ(打刻の supersedes 連鎖・締めスナップショット・通知・暗号化風の文字列)。 */
async function seedSource(handle: DatabaseHandle): Promise<{ punchIds: string[] }> {
  const db = handle.db;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const otherUserId = uuidv7();
  const rootDeptId = uuidv7();
  const childDeptId = uuidv7();

  await db.insert(tenants).values({
    id: tenantId,
    name: "株式会社きざみ",
    // boolean モードの列(pg 側でも integer の 0/1)
    isSmallOrMediumEnterprise: false,
    specialClauseEnabled: true,
    workRulesUrl: null,
    createdAt: 100,
  });
  await db.insert(users).values([
    { id: userId, tenantId, email: "a@example.com", name: "山田 太郎", hireDate: "2024-04-01", createdAt: 100 },
    { id: otherUserId, tenantId, email: "b@example.com", name: "B", isActive: false, createdAt: 100 },
  ]);
  // 自己参照 FK(parent_id)のある木
  await db.insert(departments).values([
    { id: rootDeptId, tenantId, parentId: null, name: "本社", createdAt: 100 },
    { id: childDeptId, tenantId, parentId: rootDeptId, name: "開発部", createdAt: 100 },
  ]);
  await db.insert(memberships).values({ id: uuidv7(), tenantId, userId, departmentId: childDeptId, title: "課長", createdAt: 100 });

  // 打刻: clock_in → (訂正で無効化) → 新しい clock_in、および void で取り消した clock_out
  const first = uuidv7();
  const corrected = uuidv7();
  const clockOut = uuidv7();
  const voided = uuidv7();
  await db.insert(punchEvents).values([
    {
      id: first,
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: 29_000_000,
      recordedAt: 29_000_001,
      source: "web",
      actorId: userId,
      // real 列(pg では double precision)
      metaGpsLat: 35.681236,
      metaGpsLng: 139.767125,
      metaIp: "203.0.113.10",
      note: "通常出勤",
    },
    {
      id: corrected,
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: 29_000_010,
      recordedAt: 29_000_020,
      source: "api",
      actorId: otherUserId,
      supersedesId: first,
      note: "訂正: 実際は10分遅れ",
    },
    { id: clockOut, tenantId, userId, kind: "clock_out", occurredAt: 29_000_500, recordedAt: 29_000_500, source: "web", actorId: userId },
    { id: voided, tenantId, userId, kind: "void", occurredAt: 29_000_600, recordedAt: 29_000_600, source: "web", actorId: userId, supersedesId: clockOut },
  ]);

  const closingEventId = uuidv7();
  await db.insert(closingEvents).values({ id: closingEventId, tenantId, period: "2025-04", event: "close", actorId: otherUserId, occurredAt: 29_100_000 });
  await db.insert(closingSnapshots).values([
    { id: uuidv7(), tenantId, closingEventId, userId, category: "statutory", minutes: 9600 },
    { id: uuidv7(), tenantId, closingEventId, userId, category: "overtime", minutes: 320 },
    // 負値(flexDiff)も通ること
    { id: uuidv7(), tenantId, closingEventId, userId, category: "flexDiff", minutes: -45 },
  ]);

  await db.insert(leaveGrants).values([
    { id: uuidv7(), tenantId, userId, leaveType: "annual", grantedOn: "2024-10-01", days: 10, expiresOn: "2026-10-01", source: "auto", createdAt: 29_000_000 },
    { id: uuidv7(), tenantId, userId, leaveType: "stocked", grantedOn: "2025-04-01", days: 5, expiresOn: "2027-04-01", source: "conversion", note: "失効分の積立", createdAt: 29_100_000 },
  ]);
  await db.insert(tenantLeaveSettings).values({
    tenantId,
    grantMethod: "fixed_date",
    fixedDateMmDd: "04-01",
    hourlyLeaveEnabled: true,
    stockConversionEnabled: true,
    updatedAt: 29_100_000,
    updatedBy: otherUserId,
  });

  await db.insert(notifications).values([
    { id: uuidv7(), tenantId, userId, type: "missing_clock_out", subjectDate: "2025-04-10", title: "打刻忘れ", body: "退勤打刻がありません", createdAt: 29_100_100, readAt: null },
    { id: uuidv7(), tenantId, userId, type: "leave_granted", subjectDate: null, title: "有給付与", body: "10日付与されました", createdAt: 29_100_200, readAt: 29_100_300 },
  ]);

  // 暗号化して保存される列("enc:v1:..." の不透明な文字列)
  await db.insert(userTotp).values({
    userId,
    tenantId,
    secretEncrypted: "enc:v1:Zm9vYmFyL2Jhego=:YmFzZTY0LWxvb2tpbmc9PQ==",
    enabledAt: 29_000_000,
    lastUsedCounter: 966_666,
    createdAt: 29_000_000,
  });

  return { punchIds: [first, corrected, clockOut, voided] };
}

describe.skipIf(!isPostgresTestRun)("migrate-data: SQLite → PostgreSQL", () => {
  /** コピー元は常に libSQL の in-memory(test/support/db.ts を経由しない)。 */
  async function createSource(): Promise<DatabaseHandle> {
    return migrateRealDb({ url: ":memory:" });
  }

  const silent = { log: () => {} };

  it("代表データを移し、行数とチェックサムが一致する", async () => {
    const source = await createSource();
    const { punchIds } = await seedSource(source);
    const target = await migrateDb();

    const report = await copyDatabase(source, target, { ...silent, batchSize: 2 });

    // 行数はテーブル単位で全件一致(0 行のテーブルも含めて突き合わせている)
    expect(report.tables.every((t) => t.sourceRows === t.targetRows)).toBe(true);
    const byTable = new Map(report.tables.map((t) => [t.table, t]));
    expect(byTable.get("punch_events")?.targetRows).toBe(4);
    expect(byTable.get("closing_snapshots")?.targetRows).toBe(3);
    expect(byTable.get("leave_grants")?.targetRows).toBe(2);
    expect(byTable.get("notifications")?.targetRows).toBe(2);
    expect(byTable.get("departments")?.targetRows).toBe(2);
    expect(byTable.get("sessions")?.targetRows).toBe(0);
    expect(report.totalRows).toBe(report.tables.reduce((sum, t) => sum + t.sourceRows, 0));

    // 中核3テーブルのチェックサム(件数・整数列の合計・id の最小最大)
    expect(report.checksums.map((c) => c.table)).toEqual(["punch_events", "leave_grants", "closing_snapshots"]);
    expect(report.checksums.every((c) => c.matched)).toBe(true);
    expect(report.checksums[0]?.target.sum).toBe(29_000_000 + 29_000_010 + 29_000_500 + 29_000_600);
    expect(report.checksums[2]?.target.sum).toBe(9600 + 320 - 45);

    // 値がそのまま移っていること(boolean は 0/1、real、日本語テキスト、暗号化文字列、null)
    const copiedTenants = await target.db.select().from(tenants);
    expect(copiedTenants[0]?.name).toBe("株式会社きざみ");
    expect(copiedTenants[0]?.isSmallOrMediumEnterprise).toBe(false);
    expect(copiedTenants[0]?.specialClauseEnabled).toBe(true);
    expect(copiedTenants[0]?.workRulesUrl).toBeNull();

    const copiedPunches = await target.db.select().from(punchEvents);
    const superseding = copiedPunches.find((row) => row.id === punchIds[1]);
    // 自己参照 FK が「後から UPDATE」で正しく埋まっていること
    expect(superseding?.supersedesId).toBe(punchIds[0]);
    expect(copiedPunches.find((row) => row.id === punchIds[3])?.supersedesId).toBe(punchIds[2]);
    const firstPunch = copiedPunches.find((row) => row.id === punchIds[0]);
    expect(firstPunch?.metaGpsLat).toBeCloseTo(35.681236, 6);
    expect(firstPunch?.supersedesId).toBeNull();
    expect(firstPunch?.note).toBe("通常出勤");

    const copiedDepartments = await target.db.select().from(departments);
    expect(copiedDepartments.find((row) => row.name === "開発部")?.parentId).toBe(
      copiedDepartments.find((row) => row.name === "本社")?.id,
    );

    const copiedTotp = await target.db.select().from(userTotp);
    expect(copiedTotp[0]?.secretEncrypted).toBe("enc:v1:Zm9vYmFyL2Jhego=:YmFzZTY0LWxvb2tpbmc9PQ==");
    expect(copiedTotp[0]?.lastUsedCounter).toBe(966_666);

    const copiedSettings = await target.db.select().from(tenantLeaveSettings);
    expect(copiedSettings[0]?.hourlyLeaveEnabled).toBe(true);
    expect(copiedSettings[0]?.halfDayLeaveEnabled).toBe(true);

    await source.client.close();
    await target.client.close();
  });

  it("空の DB 同士でも成功する(全テーブル 0 行)", async () => {
    const source = await createSource();
    const target = await migrateDb();
    const report = await copyDatabase(source, target, silent);
    expect(report.totalRows).toBe(0);
    expect(report.checksums.every((c) => c.matched && c.target.count === 0)).toBe(true);
    await source.client.close();
    await target.client.close();
  });

  it("移行先が空でなければ拒否する(マージはしない)", async () => {
    const source = await createSource();
    await seedSource(source);
    const target = await migrateDb();
    await copyDatabase(source, target, silent);

    const second = await createSource();
    await seedSource(second);
    await expect(copyDatabase(second, target, silent)).rejects.toThrow(/target database is not empty/);
    // 1回目のデータが壊れていないこと
    expect((await target.db.select().from(punchEvents)).length).toBe(4);

    await source.client.close();
    await second.client.close();
    await target.client.close();
  });

  it("コピー元に知らないテーブルがあれば、何もコピーせずに拒否する", async () => {
    const source = await createSource();
    await seedSource(source);
    await source.client.execute("CREATE TABLE legacy_punches (id text primary key)");
    const target = await migrateDb();

    await expect(copyDatabase(source, target, silent)).rejects.toThrow(/unknown table\(s\).*legacy_punches/s);
    expect((await target.db.select().from(tenants)).length).toBe(0);

    await source.client.close();
    await target.client.close();
  });

  it("コピー元のスキーマ版が違えば拒否する(列の欠落)", async () => {
    const source = await createSource();
    await source.client.execute("ALTER TABLE notifications DROP COLUMN read_at");
    const target = await migrateDb();

    await expect(copyDatabase(source, target, silent)).rejects.toThrow(/missing column\(s\): read_at/);

    await source.client.close();
    await target.client.close();
  });

  it("マイグレーション未適用のコピー元は拒否する", async () => {
    // migrateDb を通さない = __drizzle_migrations が無い
    const { createDatabase } = await import("../src/migrate.js");
    const source = await createDatabase(":memory:");
    const target = await migrateDb();

    await expect(copyDatabase(source, target, silent)).rejects.toThrow(/no __drizzle_migrations table/);

    await source.client.close();
    await target.client.close();
  });

  it("コピー先が PostgreSQL でなければ拒否する", async () => {
    const source = await createSource();
    const alsoSqlite = await createSource();
    await expect(copyDatabase(source, alsoSqlite, silent)).rejects.toThrow(/target must be PostgreSQL/);
    await source.client.close();
    await alsoSqlite.client.close();
  });
});
