/**
 * listAuditLogs の部署スコープ絞り込み(セキュリティ指摘 M7、2026-10-22)。
 *
 * 絞り込みは SQL(持ち主を引く相関サブクエリ + substr)で書いているので、SQLite /
 * PostgreSQL / D1 の3レグで同じ結果になることをここで確かめる(apps/api のテストは SQLite だけ)。
 * D1 は1文の束縛パラメータが100個までなので、ユーザー・部署が多いスコープ(分割して問い合わせる)
 * も含める。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, type Database } from "./support/db.js";
import { insertAuditLog, listAuditLogs } from "../src/queries/audit.js";
import {
  autoBreakWaivers,
  correctionRequests,
  leaveGrantProposals,
  leaveGrants,
  leaveRequests,
  shiftPlans,
  tenants,
  users,
} from "../src/schema/index.js";
import { chunkRowsForInsert } from "../src/atomic.js";
import { uuidv7 } from "../src/uuid.js";

describe("listAuditLogs scope", () => {
  let db: Database;
  const tenantId = uuidv7();
  const otherTenantId = uuidv7();
  const inScope = uuidv7();
  const outScope = uuidv7();
  let occurredAt = 0;

  beforeEach(async () => {
    ({ db } = await migrateDb());
    occurredAt = 0;
    await db.insert(tenants).values([
      { id: tenantId, name: "Tenant A", createdAt: 0 },
      { id: otherTenantId, name: "Tenant B", createdAt: 0 },
    ]);
    await db.insert(users).values([
      { id: inScope, tenantId, email: "in@example.com", name: "In", createdAt: 0 },
      { id: outScope, tenantId, email: "out@example.com", name: "Out", createdAt: 0 },
    ]);
  });

  async function log(actorId: string, action: string, targetType: string, targetId: string) {
    occurredAt += 1;
    await insertAuditLog(db, { tenantId, actorId, action, targetType, targetId, detail: "{}", occurredAt });
  }

  /** 持ち主の表がある targetType ごとに、in/out それぞれの持ち主の行を作って監査ログを書く。 */
  async function seedOwnedTargets() {
    for (const [owner, tag] of [
      [inScope, "in"],
      [outScope, "out"],
    ] as const) {
      const cr = uuidv7();
      await db.insert(correctionRequests).values({ id: cr, tenantId, userId: owner, requestedBy: owner, status: "pending", reason: "r", createdAt: 0 });
      await log(outScope, `correction_request-${tag}`, "correction_request", cr);

      const lr = uuidv7();
      await db.insert(leaveRequests).values({
        id: lr,
        tenantId,
        userId: owner,
        requestedBy: owner,
        status: "pending",
        leaveDate: "2026-04-01",
        unit: "full_day",
        leaveType: "annual",
        reason: "r",
        createdAt: 0,
      });
      await log(outScope, `leave_request-${tag}`, "leave_request", lr);

      const lg = uuidv7();
      await db.insert(leaveGrants).values({ id: lg, tenantId, userId: owner, leaveType: "annual", grantedOn: "2026-04-01", days: 10, expiresOn: "2028-04-01", source: "manual", createdAt: 0 });
      await log(outScope, `leave_grant-${tag}`, "leave_grant", lg);

      const lgp = uuidv7();
      await db.insert(leaveGrantProposals).values({
        id: lgp,
        tenantId,
        userId: owner,
        leaveType: "annual",
        grantedOn: "2026-04-01",
        days: 10,
        expiresOn: "2028-04-01",
        attendanceRate: "{}",
        status: "proposed",
        proposedAt: 0,
        createdAt: 0,
      });
      await log(outScope, `leave_grant_proposal-${tag}`, "leave_grant_proposal", lgp);

      const abw = uuidv7();
      await db.insert(autoBreakWaivers).values({ id: abw, tenantId, userId: owner, requestedBy: owner, status: "pending", waiveDate: "2026-04-01", reason: "r", createdAt: 0 });
      await log(outScope, `auto_break_waiver-${tag}`, "auto_break_waiver", abw);

      const sp = uuidv7();
      await db.insert(shiftPlans).values({ id: sp, tenantId, userId: owner, periodStart: "2026-04-01", periodEnd: "2026-04-30", createdAt: 0 });
      await log(outScope, `shift_plans-${tag}`, "shift_plans", sp);

      await log(outScope, `user-${tag}`, "user", owner);
      await log(outScope, `users-${tag}`, "users", owner);
      await log(outScope, `slack_user_links-${tag}`, "slack_user_links", owner);
    }
  }

  it("resolves the owner of every user-attributable target type", async () => {
    await seedOwnedTargets();
    const rows = await listAuditLogs(db, { tenantId, limit: 100, scope: { userIds: [inScope], departmentIds: [] } });
    expect(rows.map((r) => r.action).sort()).toEqual(
      [
        "correction_request-in",
        "leave_request-in",
        "leave_grant-in",
        "leave_grant_proposal-in",
        "auto_break_waiver-in",
        "shift_plans-in",
        "user-in",
        "users-in",
        "slack_user_links-in",
      ].sort(),
    );
  });

  it("shows rows acted by an in-scope user only when the target is a user or department; tenant-level rows never", async () => {
    const deptIn = uuidv7();
    const deptOut = uuidv7();
    await log(inScope, "in-on-out-user", "user", outScope);
    await log(inScope, "in-on-out-dept", "department", deptOut);
    await log(inScope, "in-on-tenant", "tenant", tenantId);
    await log(inScope, "in-on-closing", "closing", "2026-04");
    await log(outScope, "out-on-in-dept", "department", deptIn);
    await log(outScope, "out-on-out-dept", "department", deptOut);
    await log(outScope, "out-on-tenant", "tenant", tenantId);
    // 持ち主の行が見つからない(削除済み等)対象は帰属不明 = テナント単位扱い
    await log(inScope, "in-on-missing-request", "correction_request", uuidv7());

    const rows = await listAuditLogs(db, { tenantId, limit: 100, scope: { userIds: [inScope], departmentIds: [deptIn] } });
    expect(rows.map((r) => r.action).sort()).toEqual(["in-on-out-user", "in-on-out-dept", "out-on-in-dept"].sort());

    const all = await listAuditLogs(db, { tenantId, limit: 100 });
    expect(all).toHaveLength(8);
  });

  it("splits large user/department sets into several queries (D1 bound-parameter limit) and merges them newest-first", async () => {
    const many: string[] = [];
    for (let i = 0; i < 130; i++) many.push(uuidv7());
    // テストの投入自体も D1 の上限に収まるよう分けて書く
    const rows = many.map((id, i) => ({ id, tenantId, email: `m${i}@example.com`, name: `M${i}`, createdAt: 0 }));
    for (const chunk of chunkRowsForInsert(users, rows)) await db.insert(users).values(chunk);
    const depts: string[] = [];
    for (let i = 0; i < 170; i++) depts.push(uuidv7());

    // ユーザーとチャンクが入り混じる順で書く
    for (let i = 0; i < many.length; i++) {
      const id = many[(i * 53) % many.length] as string;
      await log(id, `u-${i}`, "user", id);
      await log(outScope, `hidden-${i}`, "user", outScope);
    }
    for (let i = 0; i < 5; i++) await log(outScope, `d-${i}`, "department", depts[(i * 41) % depts.length] as string);

    // すべての絞り込み条件も同時に付けて、1文あたりの束縛パラメータが最大になる形で叩く
    const scope = { userIds: [inScope, ...many], departmentIds: depts };
    const page1 = await listAuditLogs(db, { tenantId, limit: 51, scope, fromMinutes: 0, toMinutes: 1_000_000, cursor: "ffffffff-ffff-7fff-bfff-ffffffffffff" });
    expect(page1.map((r) => r.action)).toEqual([...Array.from({ length: 5 }, (_, i) => `d-${4 - i}`), ...Array.from({ length: 46 }, (_, i) => `u-${129 - i}`)]);

    const page2 = await listAuditLogs(db, { tenantId, limit: 200, scope, cursor: page1[page1.length - 1]?.id as string });
    expect(page2.map((r) => r.action)).toEqual(Array.from({ length: 84 }, (_, i) => `u-${83 - i}`));

    const filtered = await listAuditLogs(db, {
      tenantId,
      limit: 10,
      scope,
      actorId: many[0] as string,
      action: "u-0",
      targetType: "user",
      targetId: many[0] as string,
      fromMinutes: 0,
      toMinutes: 1_000_000,
      cursor: "ffffffff-ffff-7fff-bfff-ffffffffffff",
    });
    expect(filtered.map((r) => r.action)).toEqual(["u-0"]);
  });

  it("never crosses tenants even when the scope lists another tenant's users", async () => {
    const foreign = uuidv7();
    await db.insert(users).values({ id: foreign, tenantId: otherTenantId, email: "f@example.com", name: "F", createdAt: 0 });
    await insertAuditLog(db, { tenantId: otherTenantId, actorId: foreign, action: "foreign", targetType: "user", targetId: foreign, detail: "{}", occurredAt: 1 });
    const rows = await listAuditLogs(db, { tenantId, limit: 10, scope: { userIds: [foreign], departmentIds: [] } });
    expect(rows).toEqual([]);
  });
});
