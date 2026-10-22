/**
 * 人事属性の自己編集の禁止(2026-10、セキュリティ診断)。
 *
 * 入社日・有給付与の区分・所属部署・労働時間制の割当・有給の付与は、テナント全体スコープの
 * 管理者であっても自分の分は変えられない(apps/api/src/authz.ts の rejectOwnHrAttributeEdit)。
 * 別の管理者なら従来どおり変えられる。
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, insertLeaveGrant, leaveGrants, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, loginAsHrEditor, setupTestDb } from "./support/setup.js";

// JST 2026-06-15 12:00(日界・月境界から離れた時刻)。
const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");

const HR_PERMISSIONS = ["member.profile.edit", "member.view", "department.manage", "tenant_settings.flex.manage", "leave.grant.manage"];

async function auditActions(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

async function setupAdmin() {
  const seeded = await setupTestDb();
  const { db, tenantId, userId, email, password } = seeded;
  for (const permission of HR_PERMISSIONS) {
    await grantPermission(db, { tenantId, userId, permission, scope: "tenant" });
  }
  const app = createApp({ db });
  const cookie = await loginAndGetCookie(app, email, password);
  return { ...seeded, app, cookie };
}

function send(app: ReturnType<typeof createApp>, cookie: string, method: string, path: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("人事属性の自己編集の禁止", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["入社日", { hireDate: "2000-04-01" }],
    ["有給付与の区分", { leaveGrantClass: "days4" }],
  ])("テナント全体の管理者でも、自分の%sは PATCH /members/:id で変えられない(403)", async (_label, body) => {
    const { db, tenantId, userId, app, cookie } = await setupAdmin();
    const before = await auditActions(db, tenantId);

    const res = await send(app, cookie, "PATCH", `/members/${userId}`, body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cannot_edit_own_hr_attributes" });
    expect(await auditActions(db, tenantId)).toEqual(before);
  });

  it("自分の所属部署も変えられない(403)", async () => {
    const { userId, app, cookie } = await setupAdmin();
    const deptRes = await send(app, cookie, "POST", "/departments", { name: "営業部" });
    const dept = ((await deptRes.json()) as { department: { id: string } }).department;

    const res = await send(app, cookie, "PATCH", `/members/${userId}`, { departmentId: dept.id });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cannot_edit_own_hr_attributes" });
  });

  it("自分への労働時間制の割当はできない(403)", async () => {
    const { userId, app, cookie } = await setupAdmin();
    const res = await send(app, cookie, "POST", `/members/${userId}/work-policy`, { kind: "fixed", effectiveFrom: "2026-07-01" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cannot_edit_own_hr_attributes" });
  });

  it("自分への有給の手動付与・自動付与・積立振替はできず、付与も作られない(403)", async () => {
    const { db, tenantId, userId, app, cookie } = await setupAdmin();

    const manual = await send(app, cookie, "POST", "/leave/grants", { userId, grantedOn: "2026-06-01", days: 20 });
    expect(manual.status).toBe(403);
    expect(await manual.json()).toEqual({ error: "cannot_edit_own_hr_attributes" });

    const auto = await send(app, cookie, "POST", "/leave/grants/auto", { userId });
    expect(auto.status).toBe(403);
    expect(await auto.json()).toEqual({ error: "cannot_edit_own_hr_attributes" });

    const convert = await send(app, cookie, "POST", "/leave/grants/convert-expired", { userId });
    expect(convert.status).toBe(403);
    expect(await convert.json()).toEqual({ error: "cannot_edit_own_hr_attributes" });

    const grants = await db.select().from(leaveGrants).where(eq(leaveGrants.userId, userId));
    expect(grants).toHaveLength(0);
    expect(await auditActions(db, tenantId)).not.toContain("leave_grant.manual_create");
  });

  it("別の管理者なら、同じ人の入社日・付与区分・労働時間制・有給の付与を従来どおり変えられる", async () => {
    const { db, tenantId, userId, app } = await setupAdmin();
    const hrCookie = await loginAsHrEditor(app, db, { tenantId, fromUserId: userId });

    expect((await send(app, hrCookie, "PATCH", `/members/${userId}`, { hireDate: "2020-04-01", leaveGrantClass: "full" })).status).toBe(200);
    expect((await send(app, hrCookie, "POST", `/members/${userId}/work-policy`, { kind: "fixed", effectiveFrom: "2026-07-01" })).status).toBe(201);
    expect((await send(app, hrCookie, "POST", "/leave/grants", { userId, grantedOn: "2026-06-01", days: 3 })).status).toBe(201);

    const actions = await auditActions(db, tenantId);
    expect(actions).toContain("member.update");
    expect(actions).toContain("member.work_policy.assign");
    expect(actions).toContain("leave_grant.manual_create");
  });

  it("管理者が自分しかいないテナントでは、自分の人事属性は誰も変えられない(決定どおり)", async () => {
    const { db, tenantId, userId, app, cookie } = await setupAdmin();
    // 既存の付与があっても、自分では増やせない(別の管理者を置いて依頼する)
    await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2026-04-01",
      days: 10,
      expiresOn: "2028-04-01",
      source: "manual",
      note: null,
      createdAt: 0,
    });
    const res = await send(app, cookie, "POST", "/leave/grants", { userId, grantedOn: "2026-06-01", days: 10 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cannot_edit_own_hr_attributes" });
    const grants = await db.select().from(leaveGrants).where(eq(leaveGrants.userId, userId));
    expect(grants).toHaveLength(1);
  });
});
