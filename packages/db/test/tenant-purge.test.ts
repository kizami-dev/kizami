/**
 * 退会したテナントの物理削除(queries/tenant-purge.ts、docs/design/tenant-withdrawal.md)。
 *
 * 取り返しのつかない操作なので、ここで守るのは次の4つ:
 *
 * 1. **漏れが無い** — スキーマから tenant_id を持つテーブル・tenants を参照するテーブルを列挙し、
 *    削除の一覧に載っていないテーブルがあれば落ちる。外部キーの順序もスキーマから検査する
 * 2. **消し残しが無い** — 削除の後、どのテーブルにも対象テナントの行が1行も無い
 * 3. **巻き添えが無い** — 別のテナント(とシステム表)の行は1行も変わらない。全テーブルの
 *    行数とチェックサムを削除の前後で比べる
 * 4. **途中で失敗しても再実行で完了する**(トランザクションあり / なし〔D1〕の両方)
 *
 * SQLite・PostgreSQL・D1 の3レグで同じファイルが走る(support/db.ts)。トランザクションを使う
 * ケースだけは D1 で skip する。
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, supportsTransactions, type Database } from "./support/db.js";
import { seedFullTenant, type FullTenant } from "./support/full-tenant.js";
import {
  cancelTenantWithdrawal,
  getTenantPurgeRecord,
  listTenantsDueForPurge,
  listTenantsDueForWithdrawalReminder,
  listWithdrawingTenantIds,
  markWithdrawalReminderSent,
  purgeTenant,
  requestTenantWithdrawal,
  tableNameOf,
  TENANT_PURGE_ORDER,
  TENANT_PURGE_SYSTEM_TABLES,
} from "../src/queries/index.js";
import * as schema from "../src/schema/index.js";
import { pendingSignups, signupInviteCodes, tenantPurgeRecords, tenants, users, workerHeartbeats, passwordResetRequests } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

const DAY = 24 * 60;

/** スキーマの全テーブル(SQLiteTable)。 */
function allTables(): SQLiteTable[] {
  return Object.values(schema as Record<string, unknown>).filter((v): v is SQLiteTable => v instanceof SQLiteTable);
}

function hasTenantIdColumn(table: SQLiteTable): boolean {
  return getTableConfig(table).columns.some((c) => c.name === "tenant_id");
}

/** table が外部キーで参照しているテーブル名(自己参照を除く)。 */
function referencedTableNames(table: SQLiteTable): string[] {
  const self = tableNameOf(table);
  return getTableConfig(table)
    .foreignKeys.map((fk) => getTableConfig(fk.reference().foreignTable as SQLiteTable).name)
    .filter((name) => name !== self);
}

/** 削除の記録そのもの(削除の対象ではなく、削除で作られる側)。 */
const RECORD_TABLE = "tenant_purge_records";

describe("TENANT_PURGE_ORDER — テーブルの漏れを防ぐ仕組み(スキーマから列挙して検査する)", () => {
  const purgeNames = TENANT_PURGE_ORDER.map(tableNameOf);
  const systemNames = TENANT_PURGE_SYSTEM_TABLES.map((s) => tableNameOf(s.table));

  it("tenant_id を持つテーブルはすべて、削除の一覧かシステム表の一覧に載っている", () => {
    const missing = allTables()
      .filter(hasTenantIdColumn)
      .map(tableNameOf)
      .filter((name) => name !== RECORD_TABLE && !purgeNames.includes(name) && !systemNames.includes(name));
    // ここで落ちたら: 新しいテーブルを queries/tenant-purge.ts の TENANT_PURGE_ORDER(テナント所有の表)か
    // TENANT_PURGE_SYSTEM_TABLES(システム表)に足し、エクスポートの扱い(TENANT_EXPORT_POLICY)も決めること
    expect(missing).toEqual([]);
  });

  it("tenants、または削除されるテーブルを外部キーで参照するテーブルは、すべて削除の対象になっている", () => {
    const deleted = new Set([...purgeNames, ...systemNames, "tenants"]);
    const dangling = allTables()
      .filter((t) => !deleted.has(tableNameOf(t)))
      .filter((t) => referencedTableNames(t).some((ref) => deleted.has(ref)))
      .map(tableNameOf);
    // tenant_id を持たないのにテナントの行を参照する表があると、削除が外部キー違反で止まるか、
    // 参照の切れた行が残る
    expect(dangling).toEqual([]);
  });

  it("一覧の各テーブルは tenant_id を持ち、重複が無い", () => {
    for (const table of TENANT_PURGE_ORDER) expect(hasTenantIdColumn(table), tableNameOf(table)).toBe(true);
    expect(new Set(purgeNames).size).toBe(purgeNames.length);
    expect(purgeNames).not.toContain("tenants");
  });

  it("外部キーの子を親より先に消す順になっている(スキーマの外部キーから検査)", () => {
    const position = new Map(purgeNames.map((name, i) => [name, i]));
    for (const table of TENANT_PURGE_ORDER) {
      const child = tableNameOf(table);
      for (const parent of referencedTableNames(table)) {
        const parentIndex = position.get(parent);
        if (parentIndex === undefined) continue; // tenants(最後に消す)
        expect(position.get(child)!, `${child} は ${parent} より先に消す必要がある`).toBeLessThan(parentIndex);
      }
    }
  });
});

// ---- 行の比較(削除の前後で、対象テナント以外の行が1行も変わらないこと) ----

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 全テーブルについて「対象テナントの行を除いた行」の行数とチェックサム。削除の記録の表は除く
 * (削除によって1行増えるのが正しい表)。
 */
async function fingerprintExcluding(db: Database, excludedTenantId: string): Promise<Record<string, { rows: number; sha256: string }>> {
  const result: Record<string, { rows: number; sha256: string }> = {};
  for (const table of allTables()) {
    const name = tableNameOf(table);
    if (name === RECORD_TABLE) continue;
    const config = getTableConfig(table);
    const keyOf = (column: string) => config.columns.find((c) => c.name === column);
    const rows = (await db.select().from(table)) as Record<string, unknown>[];
    const tenantKey = name === "tenants" ? "id" : keyOf("tenant_id") ? "tenantId" : null;
    const kept = rows.filter((row) => tenantKey === null || row[tenantKey] !== excludedTenantId);
    const lines = kept.map(canonical).sort();
    result[name] = { rows: kept.length, sha256: await sha256(lines.join("\n")) };
  }
  return result;
}

/** 対象テナントの行数(tenant_id を持つ全テーブル + tenants)。 */
async function rowsOfTenant(db: Database, tenantId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of allTables()) {
    const name = tableNameOf(table);
    if (name === RECORD_TABLE) continue;
    const column = name === "tenants" ? tenants.id : getTableConfig(table).columns.find((c) => c.name === "tenant_id");
    if (!column) continue;
    const rows = await db.select().from(table).where(eq(column, tenantId));
    result[name] = rows.length;
  }
  return result;
}

describe("purgeTenant", () => {
  let db: Database;
  let target: FullTenant;
  let other: FullTenant;

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    target = await seedFullTenant(db, "target");
    other = await seedFullTenant(db, "other");
    // テナントに属さないシステム表にも行を置き、削除で変わらないことを確かめる
    await db.insert(signupInviteCodes).values({ id: uuidv7(), codeHash: "invite-code-hash", createdAt: 1 });
    await db.insert(pendingSignups).values({
      id: uuidv7(),
      email: "someone@example.com",
      emailKey: "someone@example.com",
      organizationName: "未確認の申込み",
      adminName: "誰か",
      tokenHash: "pending-token",
      expiresAt: 10,
      createdAt: 1,
    });
    await db.insert(passwordResetRequests).values({ emailKey: "someone@example.com", requestedAt: 1 });
    await db.insert(workerHeartbeats).values({ jobName: "reminder", lastRunAt: 1, lastResult: "success" });
  });

  async function withdraw(tenantId: string, requestedAt = 1000) {
    const row = await requestTenantWithdrawal(db, { tenantId, requestedAt, scheduledPurgeAt: requestedAt + 30 * DAY });
    expect(row).not.toBeNull();
  }

  it("fixture が削除の対象の全テーブルを埋めている(新しいテーブルが削除のテストを素通りしないように)", async () => {
    const counts = await rowsOfTenant(db, target.tenantId);
    const empty = [...TENANT_PURGE_ORDER, ...TENANT_PURGE_SYSTEM_TABLES.map((s) => s.table)]
      .map(tableNameOf)
      .filter((name) => (counts[name] ?? 0) === 0);
    // ここで落ちたら test/support/full-tenant.ts の seedFullTenant に、そのテーブルの行を足すこと
    expect(empty).toEqual([]);
  });

  it("退会を申請していないテナントは消さない(not_withdrawing)", async () => {
    const before = await rowsOfTenant(db, target.tenantId);
    const result = await purgeTenant(db, { tenantId: target.tenantId, now: 5000, transactional: supportsTransactions });
    expect(result.status).toBe("not_withdrawing");
    expect(await rowsOfTenant(db, target.tenantId)).toEqual(before);
    expect(await getTenantPurgeRecord(db, target.tenantId)).toBeNull();
  });

  it("存在しないテナントは not_found", async () => {
    const result = await purgeTenant(db, { tenantId: uuidv7(), now: 5000, transactional: supportsTransactions });
    expect(result.status).toBe("not_found");
  });

  for (const transactional of [true, false]) {
    describe.skipIf(transactional && !supportsTransactions)(transactional ? "1トランザクションで" : "トランザクションなし(D1 と同じ経路)で", () => {
      it("対象テナントの行はどのテーブルにも残らず、別テナントとシステム表の行は1行も変わらない", async () => {
        await withdraw(target.tenantId);
        const before = await rowsOfTenant(db, target.tenantId);
        const otherBefore = await fingerprintExcluding(db, target.tenantId);

        const result = await purgeTenant(db, { tenantId: target.tenantId, now: 99_000, transactional });
        expect(result.status).toBe("purged");

        const after = await rowsOfTenant(db, target.tenantId);
        expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
        expect(await fingerprintExcluding(db, target.tenantId)).toEqual(otherBefore);
        // 別テナントは自分の行を全部持ったまま
        const otherRows = await rowsOfTenant(db, other.tenantId);
        expect(otherRows.tenants).toBe(1);
        expect(otherRows.users).toBe(2);

        // 削除の記録: テーブルごとの行数が削除前の行数と一致し、個人情報を含まない
        if (result.status !== "purged") throw new Error("unreachable");
        const record = result.record;
        expect(record.tenantId).toBe(target.tenantId);
        expect(record.withdrawalRequestedAt).toBe(1000);
        expect(record.purgedAt).toBe(99_000);
        const counts = JSON.parse(record.deletedCounts) as Record<string, number>;
        for (const [name, n] of Object.entries(before)) {
          if (n > 0) expect(counts[name], name).toBe(n);
        }
        expect(counts.tenants).toBe(1);
        expect(counts.pending_signups).toBe(1);
        const recordText = JSON.stringify(record);
        for (const leaked of [target.tenantName, target.adminEmail, target.memberEmail, "target"]) {
          expect(recordText).not.toContain(leaked);
        }
      });

      it("2回目は already_purged で何もしない(冪等)", async () => {
        await withdraw(target.tenantId);
        await purgeTenant(db, { tenantId: target.tenantId, now: 99_000, transactional });
        const otherBefore = await fingerprintExcluding(db, target.tenantId);
        const second = await purgeTenant(db, { tenantId: target.tenantId, now: 100_000, transactional });
        expect(second.status).toBe("already_purged");
        if (second.status === "already_purged") expect(second.record.purgedAt).toBe(99_000);
        expect(await fingerprintExcluding(db, target.tenantId)).toEqual(otherBefore);
      });

      it("削除の後、同じメールアドレスで新しくテナントを作れる", async () => {
        await withdraw(target.tenantId);
        await purgeTenant(db, { tenantId: target.tenantId, now: 99_000, transactional });
        const newTenantId = uuidv7();
        await db.insert(tenants).values({ id: newTenantId, name: target.tenantName, createdAt: 99_001 });
        await db.insert(users).values({ id: uuidv7(), tenantId: newTenantId, email: target.adminEmail, name: "新しい管理者", createdAt: 99_001 });
        await db.insert(pendingSignups).values({
          id: uuidv7(),
          email: target.adminEmail,
          emailKey: target.adminEmail,
          organizationName: target.tenantName,
          adminName: "新しい管理者",
          tokenHash: "new-signup-token",
          expiresAt: 99_100,
          createdAt: 99_001,
        });
        expect((await rowsOfTenant(db, newTenantId)).users).toBe(1);
      });
    });
  }

  it.skipIf(!supportsTransactions)("1トランザクションで途中で失敗すると何も消えず、再実行で完了する", async () => {
    await withdraw(target.tenantId);
    const before = await rowsOfTenant(db, target.tenantId);
    const otherBefore = await fingerprintExcluding(db, target.tenantId);

    await expect(
      purgeTenant(db, {
        tenantId: target.tenantId,
        now: 99_000,
        afterTableDeleted: (name) => {
          if (name === "audit_logs") throw new Error("simulated failure");
        },
      }),
    ).rejects.toThrow("simulated failure");
    expect(await rowsOfTenant(db, target.tenantId)).toEqual(before);
    expect(await getTenantPurgeRecord(db, target.tenantId)).toBeNull();

    const retried = await purgeTenant(db, { tenantId: target.tenantId, now: 99_500 });
    expect(retried.status).toBe("purged");
    expect(Object.values(await rowsOfTenant(db, target.tenantId)).every((n) => n === 0)).toBe(true);
    expect(await fingerprintExcluding(db, target.tenantId)).toEqual(otherBefore);
    if (retried.status === "purged") expect(JSON.parse(retried.record.deletedCounts).punch_events).toBe(before.punch_events);
  });

  it("トランザクションなしで途中で失敗すると、続きから再実行して完了し、行数は足し合わされる", async () => {
    await withdraw(target.tenantId);
    const before = await rowsOfTenant(db, target.tenantId);
    const otherBefore = await fingerprintExcluding(db, target.tenantId);

    await expect(
      purgeTenant(db, {
        tenantId: target.tenantId,
        now: 99_000,
        transactional: false,
        afterTableDeleted: (name) => {
          if (name === "notifications") throw new Error("simulated failure");
        },
      }),
    ).rejects.toThrow("simulated failure");

    // 途中まで消えている: 子の側は消え、親(users・tenants)は残る = 外部キー違反の状態ではない
    const partial = await rowsOfTenant(db, target.tenantId);
    expect(partial.punch_events).toBe(0);
    expect(partial.users).toBe(2);
    expect(partial.tenants).toBe(1);
    // テナントは「退会手続き中」のまま残る(再実行の対象になる)
    expect(await listWithdrawingTenantIds(db)).toContain(target.tenantId);
    const inProgress = await getTenantPurgeRecord(db, target.tenantId);
    expect(inProgress?.purgedAt).toBeNull();

    const retried = await purgeTenant(db, { tenantId: target.tenantId, now: 99_500, transactional: false });
    expect(retried.status).toBe("purged");
    expect(Object.values(await rowsOfTenant(db, target.tenantId)).every((n) => n === 0)).toBe(true);
    expect(await fingerprintExcluding(db, target.tenantId)).toEqual(otherBefore);
    if (retried.status !== "purged") throw new Error("unreachable");
    // 1回目と2回目に分かれて消した行数を足し合わせると、削除前の行数に一致する
    const counts = JSON.parse(retried.record.deletedCounts) as Record<string, number>;
    for (const [name, n] of Object.entries(before)) {
      if (n > 0) expect(counts[name], name).toBe(n);
    }
    expect(retried.record.purgeStartedAt).toBe(99_000);
    expect(retried.record.purgedAt).toBe(99_500);
  });

  it("トランザクションなしで tenants 行を消した直後に止まっても、再実行で記録を完了にする", async () => {
    await withdraw(target.tenantId);
    await expect(
      purgeTenant(db, {
        tenantId: target.tenantId,
        now: 99_000,
        transactional: false,
        afterTableDeleted: (name) => {
          if (name === "tenants") throw new Error("simulated failure");
        },
      }),
    ).rejects.toThrow("simulated failure");
    expect((await getTenantPurgeRecord(db, target.tenantId))?.purgedAt).toBeNull();

    const retried = await purgeTenant(db, { tenantId: target.tenantId, now: 99_500, transactional: false });
    expect(retried.status).toBe("purged");
    if (retried.status === "purged") {
      expect(retried.record.purgedAt).toBe(99_500);
      expect(JSON.parse(retried.record.deletedCounts).tenants).toBe(1);
    }
    expect(await db.select().from(tenantPurgeRecords)).toHaveLength(1);
  });
});

describe("退会の申請・取り消し・期限の判定", () => {
  let db: Database;
  let target: FullTenant;
  let other: FullTenant;

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    target = await seedFullTenant(db, "target");
    other = await seedFullTenant(db, "other");
  });

  it("二重の申請・二重の取り消しは null(条件付き UPDATE)", async () => {
    expect(await requestTenantWithdrawal(db, { tenantId: target.tenantId, requestedAt: 10, scheduledPurgeAt: 10 + 30 * DAY })).not.toBeNull();
    expect(await requestTenantWithdrawal(db, { tenantId: target.tenantId, requestedAt: 20, scheduledPurgeAt: 20 + 30 * DAY })).toBeNull();
    const [row] = await db.select().from(tenants).where(eq(tenants.id, target.tenantId));
    expect(row?.withdrawalRequestedAt).toBe(10);

    expect(await cancelTenantWithdrawal(db, { tenantId: target.tenantId })).not.toBeNull();
    expect(await cancelTenantWithdrawal(db, { tenantId: target.tenantId })).toBeNull();
    const [cleared] = await db.select().from(tenants).where(eq(tenants.id, target.tenantId));
    expect(cleared?.withdrawalRequestedAt).toBeNull();
    expect(cleared?.withdrawalScheduledPurgeAt).toBeNull();
    expect(cleared?.withdrawalReminderSentAt).toBeNull();
  });

  it("削除予定の時刻の前は削除の対象に入らず、過ぎたら入る。取り消せば外れる", async () => {
    await requestTenantWithdrawal(db, { tenantId: target.tenantId, requestedAt: 0, scheduledPurgeAt: 30 * DAY });
    expect((await listTenantsDueForPurge(db, { now: 30 * DAY - 1 })).map((t) => t.id)).toEqual([]);
    expect((await listTenantsDueForPurge(db, { now: 30 * DAY })).map((t) => t.id)).toEqual([target.tenantId]);
    expect(await listWithdrawingTenantIds(db)).toEqual([target.tenantId]);

    await cancelTenantWithdrawal(db, { tenantId: target.tenantId });
    expect(await listTenantsDueForPurge(db, { now: 60 * DAY })).toEqual([]);
    expect(await listWithdrawingTenantIds(db)).toEqual([]);
    expect(other.tenantId).not.toBe(target.tenantId);
  });

  it("再通知は削除の7日前から削除予定の時刻の前まで、1回だけ", async () => {
    await requestTenantWithdrawal(db, { tenantId: target.tenantId, requestedAt: 0, scheduledPurgeAt: 30 * DAY });
    const lead = 7 * DAY;
    expect(await listTenantsDueForWithdrawalReminder(db, { now: 23 * DAY - 1, leadMinutes: lead })).toEqual([]);
    expect((await listTenantsDueForWithdrawalReminder(db, { now: 23 * DAY, leadMinutes: lead })).map((t) => t.id)).toEqual([target.tenantId]);
    expect(await markWithdrawalReminderSent(db, { tenantId: target.tenantId, sentAt: 23 * DAY })).toBe(true);
    expect(await markWithdrawalReminderSent(db, { tenantId: target.tenantId, sentAt: 23 * DAY + 1 })).toBe(false);
    expect(await listTenantsDueForWithdrawalReminder(db, { now: 24 * DAY, leadMinutes: lead })).toEqual([]);
    // 削除予定の時刻を過ぎたら再通知ではなく削除の対象
    await cancelTenantWithdrawal(db, { tenantId: target.tenantId });
    await requestTenantWithdrawal(db, { tenantId: target.tenantId, requestedAt: 0, scheduledPurgeAt: 30 * DAY });
    expect(await listTenantsDueForWithdrawalReminder(db, { now: 30 * DAY, leadMinutes: lead })).toEqual([]);
  });
});
