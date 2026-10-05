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
import { exportTenantData, tableNameOf, TENANT_EXPORT_POLICY, TENANT_PURGE_ORDER } from "../src/queries/index.js";
import { tenants } from "../src/schema/index.js";
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
