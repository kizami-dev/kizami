import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, users, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-08-22T03:00:00.000Z"); // JST 2026-08-22 12:00

async function setHireDate(db: Database, userId: string, hireDate: string): Promise<void> {
  await db.update(users).set({ hireDate }).where(eq(users.id, userId));
}

/** 比例付与の区分(users.leave_grant_class)を直接書き換える。API 経由の検証は members.test.ts が持つ。 */
async function setLeaveGrantClass(db: Database, userId: string, leaveGrantClass: string): Promise<void> {
  await db.update(users).set({ leaveGrantClass }).where(eq(users.id, userId));
}

/** テナントの有給設定を法定(入社日基準)で保存する。 */
async function configureStatutoryLeaveSettings(app: ReturnType<typeof createApp>, cookie: string): Promise<void> {
  const res = await app.request("/settings/leave", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      grantMethod: "statutory",
      hourlyLeaveEnabled: false,
      hourlyLeaveMaxDays: 5,
      halfDayLeaveEnabled: true,
      stockConversionEnabled: false,
      stockMaxDays: 40,
      stockExpiresMonths: null,
    }),
  });
  if (res.status !== 200) throw new Error(`configureStatutoryLeaveSettings failed: ${res.status}`);
}

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

interface LeaveGrantJson {
  id: string;
  userId: string;
  leaveType: string;
  grantedOn: string;
  days: number;
  expiresOn: string;
  source: string;
}

describe("leave grants API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("POST /leave/grants requires leave.grant.manage (403 without it)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/grants", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId, grantedOn: "2024-01-01", days: 5 }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /leave/grants creates a manual grant, defaults leaveType to annual and expiresOn to +2y, and logs an audit entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/grants", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId, grantedOn: "2024-01-01", days: 5, note: "調整分" }),
    });
    expect(res.status).toBe(201);
    const grant = ((await res.json()) as { grant: LeaveGrantJson }).grant;
    expect(grant.leaveType).toBe("annual");
    expect(grant.expiresOn).toBe("2026-01-01");
    expect(grant.source).toBe("manual");

    expect(await auditActionsFor(db, tenantId)).toContain("leave_grant.manual_create");
  });

  it("POST /leave/grants/auto requires the target user to have hireDate set (400 hire_date_not_set)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "hire_date_not_set" });
  });

  it("POST /leave/grants/auto computes statutory grants from hireDate and is idempotent on re-run", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    await setHireDate(db, userId, "2020-01-01");

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // テナントの有給設定を法定方式で保存
    const settingsRes = await app.request("/settings/leave", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        grantMethod: "statutory",
        hourlyLeaveEnabled: false,
        hourlyLeaveMaxDays: 5,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: false,
        stockMaxDays: 40,
        stockExpiresMonths: null,
      }),
    });
    expect(settingsRes.status).toBe(200);

    // asOf は現在時刻(2026-08-22)。入社2020-01-01から6年6ヶ月以上経過しているため、
    // 6ヶ月/1年6ヶ月/.../6年6ヶ月の7回分が付与されるはず。
    const firstRes = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(firstRes.status).toBe(201);
    const firstBody = (await firstRes.json()) as { created: LeaveGrantJson[]; skipped: number };
    expect(firstBody.created).toHaveLength(7);
    expect(firstBody.created.map((g) => g.days)).toEqual([10, 11, 12, 14, 16, 18, 20]);

    // 再実行しても重複付与しない(冪等)
    const secondRes = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(secondRes.status).toBe(201);
    const secondBody = (await secondRes.json()) as { created: LeaveGrantJson[]; skipped: number };
    expect(secondBody.created).toHaveLength(0);
    expect(secondBody.skipped).toBe(7);
  });

  /**
   * 比例付与(労基法39条3項・労基法施行規則24条の3、2026-08-24 追加)。
   * users.leave_grant_class が "days3" の人には週3日の表(5,6,6,8,9,10,11)が適用される。
   */
  it("POST /leave/grants/auto applies the proportional table when the user's leave_grant_class is not 'full'", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    await setHireDate(db, userId, "2020-01-01");
    await setLeaveGrantClass(db, userId, "days3");

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureStatutoryLeaveSettings(app, cookie);

    const res = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { created: LeaveGrantJson[] };
    // 同じ基準日・同じ時効で、日数だけが週3日の表になる(フルタイムなら 10,11,12,14,16,18,20)
    expect(body.created.map((g) => g.days)).toEqual([5, 6, 6, 8, 9, 10, 11]);
    expect(body.created.map((g) => g.grantedOn)).toEqual([
      "2020-07-01",
      "2021-07-01",
      "2022-07-01",
      "2023-07-01",
      "2024-07-01",
      "2025-07-01",
      "2026-07-01",
    ]);
  });

  it("POST /leave/grants/auto falls back to the full table when leave_grant_class holds an unexpected value", async () => {
    // 少なく付与する方向へ倒さない(packages/leave/src/statutory.ts の判断点)。
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    await setHireDate(db, userId, "2020-01-01");
    await setLeaveGrantClass(db, userId, "days9");

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureStatutoryLeaveSettings(app, cookie);

    const res = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
    const body = (await res.json()) as { created: LeaveGrantJson[] };
    expect(body.created.map((g) => g.days)).toEqual([10, 11, 12, 14, 16, 18, 20]);
  });

  it("scope is enforced: an actor with department_and_descendants scope but no department membership can only target themself (403 on others)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId);
    // actor は無所属(部署未設定)。department_and_descendants スコープの場合、
    // resolveAccessibleUserIds は「本人のみ」を返す(apps/api/src/lib/scope.ts の判断点)。
    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "department_and_descendants" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/grants", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId: second.userId, grantedOn: "2024-01-01", days: 5 }),
    });
    expect(res.status).toBe(403);
  });
});
