/**
 * テナントの全データのエクスポート(機械可読な部分、queries/tenant-export.ts)。
 *
 * - 扱いの決まっていないテーブルがあれば落ちる(TENANT_EXPORT_POLICY は全テーブル分を明示する)
 * - 秘密(パスワード・2FA・API キー・トークンのハッシュ、暗号化した秘密情報)が出力のどこにも無い
 * - 別のテナントの行が混ざらない
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { SECRET_MARKER, seedFullTenant, type FullTenant } from "./support/full-tenant.js";
import {
  exportTenantData,
  iterateTenantExportTable,
  listTenantExportTables,
  tableNameOf,
  TENANT_EXPORT_POLICY,
  TENANT_PURGE_ORDER,
} from "../src/queries/index.js";
import { helpOverrides, punchEvents, tenants } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

/** 列名がこれに当たる列は、出すか出さないかを必ず意識して決める(出してよい列はここに当たらない)。 */
const SECRET_LIKE_COLUMN = /hash|secret|encrypted|password|token|p256dh|keys_auth|endpoint|webhook_url/;

describe("TENANT_EXPORT_POLICY", () => {
  const exported = [tenants, ...TENANT_PURGE_ORDER];

  it("削除の対象の全テーブル + tenants に扱いが明示されていて、余分なキーが無い", () => {
    const names = exported.map(tableNameOf).sort();
    expect(Object.keys(TENANT_EXPORT_POLICY).sort()).toEqual(names);
  });

  it("出さない列は実在する列で、秘密らしい名前の列はすべて出さない側にある", () => {
    for (const table of exported) {
      const name = tableNameOf(table);
      const policy = TENANT_EXPORT_POLICY[name]!;
      if ("excludeReason" in policy) continue;
      const columns = getTableConfig(table).columns.map((c) => c.name);
      for (const omitted of policy.omitColumns) expect(columns, `${name}.${omitted}`).toContain(omitted);
      const leaked = columns.filter((c) => SECRET_LIKE_COLUMN.test(c) && !policy.omitColumns.includes(c));
      expect(leaked, name).toEqual([]);
    }
  });
});

describe("exportTenantData", () => {
  let db: Database;
  let target: FullTenant;
  let other: FullTenant;

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    target = await seedFullTenant(db, "target");
    other = await seedFullTenant(db, "other");
  });

  it("秘密を含まない(fixture の秘密の値が出力のどこにも現れない)", async () => {
    const data = await exportTenantData(db, target.tenantId);
    expect(data).not.toBeNull();
    const text = JSON.stringify(data);
    expect(text).not.toContain(SECRET_MARKER);
    // 出さなかったテーブルと理由が分かる
    expect(data!.excludedTables.map((t) => t.name).sort()).toEqual(["auth_credentials", "sessions", "tenant_usage_counters", "user_totp_recovery_codes"]);
    const totp = data!.tables.find((t) => t.name === "user_totp");
    expect(totp?.omittedColumns).toContain("secret_encrypted");
    expect(totp?.rows[0]).not.toHaveProperty("secret_encrypted");
    expect(totp?.rows[0]).toHaveProperty("enabled_at");
  });

  it("業務データは列名(snake_case)のまま全テーブル分出て、別テナントの行は混ざらない", async () => {
    const data = (await exportTenantData(db, target.tenantId))!;
    const byName = new Map(data.tables.map((t) => [t.name, t]));
    expect(data.tables[0]?.name).toBe("tenants");
    expect(byName.get("tenants")?.rows).toEqual([expect.objectContaining({ id: target.tenantId, name: target.tenantName })]);
    expect(byName.get("users")?.rows.map((r) => r.email).sort()).toEqual([target.adminEmail, target.memberEmail].sort());
    expect(byName.get("punch_events")?.rows).toHaveLength(2);
    expect(byName.get("punch_events")?.rows[0]).toHaveProperty("occurred_at");
    // API キーは名前とスコープは出るがハッシュは出ない
    expect(byName.get("api_keys")?.rows[0]).toMatchObject({ name: "IC カード", scopes: '["punch"]' });
    expect(byName.get("api_keys")?.rows[0]).not.toHaveProperty("key_hash");
    for (const table of data.tables) {
      for (const row of table.rows) {
        const owner = table.name === "tenants" ? row.id : row.tenant_id;
        expect(owner, table.name).toBe(target.tenantId);
      }
    }
    expect(JSON.stringify(data)).not.toContain(other.adminEmail);
  });

  it("存在しないテナントは null", async () => {
    expect(await exportTenantData(db, uuidv7())).toBeNull();
  });
});

describe("iterateTenantExportTable(ページングして読む)", () => {
  let db: Database;
  let target: FullTenant;

  beforeEach(async () => {
    const dbPath = join(tmpdir(), `kizami-db-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    target = await seedFullTenant(db, "target");
    await seedFullTenant(db, "other");
    // ページの境目をまたがせる: 単一の主キー(punch_events)と複合の主キー(help_overrides)の両方で、
    // 1ページ(3行)より多い行を持たせる。打刻は id の順と時刻の順を逆にして、並びが主キーで決まることも見る
    const ids = Array.from({ length: 8 }, () => uuidv7());
    for (const [i, id] of ids.entries()) {
      await db.insert(punchEvents).values({
        id,
        tenantId: target.tenantId,
        userId: target.memberId,
        kind: i % 2 === 0 ? "clock_in" : "clock_out",
        occurredAt: 30_000_000 - i,
        recordedAt: 30_000_000 - i,
        source: "web",
        actorId: target.memberId,
      });
    }
    for (const key of ["a.one", "b.two", "c.three", "d.four", "e.five", "f.six"]) {
      await db.insert(helpOverrides).values({ tenantId: target.tenantId, helpKey: key, bodyMd: key, updatedBy: target.adminId, updatedAt: 1 });
    }
  });

  it("ページの大きさを行数より小さくしても、全テーブルで exportTenantData と同じ行が同じ順で出る", async () => {
    const whole = (await exportTenantData(db, target.tenantId))!;
    const { tables, excludedTables } = listTenantExportTables();
    expect(tables.map((t) => t.name)).toEqual(whole.tables.map((t) => t.name));
    expect(excludedTables).toEqual(whole.excludedTables);

    const batchCounts = new Map<string, number>();
    for (const { name } of tables) {
      const rows: Record<string, unknown>[] = [];
      let batches = 0;
      for await (const batch of iterateTenantExportTable(db, target.tenantId, name, { batchSize: 3 })) {
        expect(batch.length, name).toBeGreaterThan(0);
        expect(batch.length, name).toBeLessThanOrEqual(3);
        rows.push(...batch);
        batches += 1;
      }
      batchCounts.set(name, batches);
      expect(rows, name).toEqual(whole.tables.find((t) => t.name === name)!.rows);
    }
    // 実際に複数ページに分かれている(10行 → 4ページ、7行 → 3ページ)
    expect(whole.tables.find((t) => t.name === "punch_events")!.rows).toHaveLength(10);
    expect(batchCounts.get("punch_events")).toBe(4);
    expect(whole.tables.find((t) => t.name === "help_overrides")!.rows).toHaveLength(7);
    expect(batchCounts.get("help_overrides")).toBe(3);
    // 主キーの昇順(時刻の順ではない)
    const punchIds = whole.tables.find((t) => t.name === "punch_events")!.rows.map((r) => r.id as string);
    expect(punchIds).toEqual([...punchIds].sort());
  });

  it("ページの大きさがちょうど行数で割り切れても、行を落とさず重複もしない", async () => {
    const rows: Record<string, unknown>[] = [];
    for await (const batch of iterateTenantExportTable(db, target.tenantId, "punch_events", { batchSize: 5 })) rows.push(...batch);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.id)).size).toBe(10);
  });

  it("出さないテーブル・知らないテーブルはエラー(秘密のテーブルを誤って流さない)", async () => {
    await expect(iterateTenantExportTable(db, target.tenantId, "auth_credentials").next()).rejects.toThrow(/excluded/);
    await expect(iterateTenantExportTable(db, target.tenantId, "no_such_table").next()).rejects.toThrow(/unknown table/);
  });
});
