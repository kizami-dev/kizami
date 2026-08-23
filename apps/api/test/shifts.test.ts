import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  grantPermission,
  jstMinutes,
  loginAndGetCookie,
  setupSecondUser,
  setupTestDb,
  setVariablePeriodStartDay,
  switchToMonthlyVariableWorkPolicy,
} from "./support/setup.js";

const SHIFT_MANAGE_PERMISSION = "shift.manage";

// JST 2026-04-15 12:00。effectiveFrom は "今日" 以降のみ許可されるルートは使わない
// (このテストは全て DB 直挿入 + API のシフト系エンドポイントのみを使う)。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");

describe("shift-patterns / shifts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET/POST /settings/shift-patterns", () => {
    it("権限が無ければ 403、あれば作成・一覧・アーカイブができる", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const forbidden = await app.request("/settings/shift-patterns", { headers: { cookie } });
      expect(forbidden.status).toBe(403);

      await grantPermission(db, { tenantId, userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });

      const createRes = await app.request("/settings/shift-patterns", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "早番", dayType: "work", startMinutes: 480, endMinutes: 1020, breakMinutes: 60 }),
      });
      expect(createRes.status).toBe(201);
      const created = ((await createRes.json()) as { pattern: { id: string } }).pattern;

      const restRes = await app.request("/settings/shift-patterns", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "休み", dayType: "non_working", startMinutes: 999, endMinutes: 999, breakMinutes: 999 }),
      });
      expect(restRes.status).toBe(201);
      const rest = ((await restRes.json()) as { pattern: { startMinutes: number; endMinutes: number; breakMinutes: number } }).pattern;
      // work 以外は 0 に固定される(リクエストの値は無視)。
      expect(rest).toMatchObject({ startMinutes: 0, endMinutes: 0, breakMinutes: 0 });

      const listRes = await app.request("/settings/shift-patterns", { headers: { cookie } });
      const listed = ((await listRes.json()) as { patterns: Array<{ id: string }> }).patterns;
      expect(listed.map((p) => p.id).sort()).toEqual([created.id, listed[1]?.id].sort());

      const archiveRes = await app.request(`/settings/shift-patterns/${created.id}/archive`, {
        method: "POST",
        headers: { cookie },
      });
      expect(archiveRes.status).toBe(200);

      const afterArchive = await app.request("/settings/shift-patterns", { headers: { cookie } });
      const afterArchiveList = ((await afterArchive.json()) as { patterns: Array<{ id: string }> }).patterns;
      expect(afterArchiveList.map((p) => p.id)).not.toContain(created.id);

      // 二重アーカイブは 404。
      const doubleArchive = await app.request(`/settings/shift-patterns/${created.id}/archive`, {
        method: "POST",
        headers: { cookie },
      });
      expect(doubleArchive.status).toBe(404);
    });
  });

  describe("POST /shifts/plans", () => {
    it("period_start が variable_period_start_day と一致しなければ 400、一致すれば作成できる。重複は409", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });
      await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 16 });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const mismatch = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId, periodStart: "2026-04-01" }),
      });
      expect(mismatch.status).toBe(400);
      expect((await mismatch.json()) as { error: string }).toMatchObject({ error: "period_start_mismatch" });

      const created = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId, periodStart: "2026-03-16" }),
      });
      expect(created.status).toBe(201);
      const plan = ((await created.json()) as { plan: { periodStart: string; periodEnd: string; publishedAt: null } }).plan;
      expect(plan).toMatchObject({ periodStart: "2026-03-16", periodEnd: "2026-04-15", publishedAt: null });

      const duplicate = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId, periodStart: "2026-03-16" }),
      });
      expect(duplicate.status).toBe(409);
    });

    it("権限を持たないユーザーが他者のプランを作ろうとすると 403、スコープ外なら404", async () => {
      const { db, tenantId, userId: managerId, email, password } = await setupTestDb();
      const second = await setupSecondUser(db, tenantId);
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const noPermission = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId: second.userId, periodStart: "2026-04-01" }),
      });
      expect(noPermission.status).toBe(403);

      // department スコープでは無所属の actor は「自分のみ」しかスコープに入らない
      // (apps/api/src/lib/scope.ts の resolveAccessibleUserIds の判断点)。
      await grantPermission(db, { tenantId, userId: managerId, permission: SHIFT_MANAGE_PERMISSION, scope: "department" });
      const outOfScope = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId: second.userId, periodStart: "2026-04-01" }),
      });
      expect(outOfScope.status).toBe(404);
    });
  });

  describe("PUT /shifts/plans/:id/days + POST publish + GET history", () => {
    async function createPlan(app: ReturnType<typeof createApp>, cookie: string, userId: string) {
      const res = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId, periodStart: "2026-04-01" }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { plan: { id: string; periodStart: string; periodEnd: string } }).plan;
    }

    it("パターン指定・個別指定の両方で一括設定でき、確定前の再設定は supersede として積まれる", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);
      const plan = await createPlan(app, cookie, userId);

      const patternRes = await app.request("/settings/shift-patterns", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "早番", dayType: "work", startMinutes: 480, endMinutes: 1020, breakMinutes: 60 }),
      });
      const pattern = ((await patternRes.json()) as { pattern: { id: string } }).pattern;

      const putRes = await app.request(`/shifts/plans/${plan.id}/days`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          days: [
            { date: "2026-04-01", patternId: pattern.id },
            { date: "2026-04-05", dayType: "legal_holiday" },
            { date: "2026-04-02", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60 },
          ],
        }),
      });
      expect(putRes.status).toBe(200);
      const firstDays = ((await putRes.json()) as { days: Array<{ date: string; supersedesId: string | null }> }).days;
      expect(firstDays).toHaveLength(3);
      expect(firstDays.every((d) => d.supersedesId === null)).toBe(true);

      // 日付範囲外は400
      const outOfRange = await app.request(`/shifts/plans/${plan.id}/days`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ days: [{ date: "2026-05-01", dayType: "work", startMinutes: 0, endMinutes: 100, breakMinutes: 0 }] }),
      });
      expect(outOfRange.status).toBe(400);
      expect((await outOfRange.json())).toMatchObject({ error: "date_out_of_period" });

      // 同じ日付を再設定 → supersede
      const secondPutRes = await app.request(`/shifts/plans/${plan.id}/days`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ days: [{ date: "2026-04-01", dayType: "work", startMinutes: 600, endMinutes: 1140, breakMinutes: 60 }] }),
      });
      expect(secondPutRes.status).toBe(200);
      const secondDays = ((await secondPutRes.json()) as { days: Array<{ date: string; startMinutes: number; supersedesId: string | null }> }).days;
      const updated = secondDays.find((d) => d.date === "2026-04-01");
      expect(updated?.startMinutes).toBe(600);
      expect(updated?.supersedesId).not.toBeNull();

      const historyRes = await app.request(`/shifts/plans/${plan.id}/history`, { headers: { cookie } });
      expect(historyRes.status).toBe(200);
      const history = ((await historyRes.json()) as { history: Array<{ date: string }> }).history;
      // 2026-04-01 は2行(初回+supersede後)、2026-04-02・2026-04-05 は1行ずつ = 計4行
      expect(history).toHaveLength(4);
      expect(history.filter((h) => h.date === "2026-04-01")).toHaveLength(2);
    });

    it("週1日を満たさないプランの確定は 409 legal_holiday_shortage、満たせば公開できる", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);
      const plan = await createPlan(app, cookie, userId);

      // 平日勤務のみ、法定休日を1日も設定しない。
      await app.request(`/shifts/plans/${plan.id}/days`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ days: [{ date: "2026-04-01", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60 }] }),
      });

      const shortagePublish = await app.request(`/shifts/plans/${plan.id}/publish`, { method: "POST", headers: { cookie } });
      expect(shortagePublish.status).toBe(409);
      expect(await shortagePublish.json()).toMatchObject({ error: "legal_holiday_shortage" });

      // 4つの完全な週それぞれに日曜日を法定休日として追加する(4/1は水曜)。
      await app.request(`/shifts/plans/${plan.id}/days`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          days: [
            { date: "2026-04-05", dayType: "legal_holiday" },
            { date: "2026-04-12", dayType: "legal_holiday" },
            { date: "2026-04-19", dayType: "legal_holiday" },
            { date: "2026-04-26", dayType: "legal_holiday" },
          ],
        }),
      });

      const publishRes = await app.request(`/shifts/plans/${plan.id}/publish`, { method: "POST", headers: { cookie } });
      expect(publishRes.status).toBe(200);
      const published = ((await publishRes.json()) as { plan: { publishedAt: number | null; publishedBy: string | null } }).plan;
      expect(published.publishedAt).not.toBeNull();
      expect(published.publishedBy).toBe(userId);

      // 二重確定は409
      const doublePublish = await app.request(`/shifts/plans/${plan.id}/publish`, { method: "POST", headers: { cookie } });
      expect(doublePublish.status).toBe(409);
      expect(await doublePublish.json()).toMatchObject({ error: "already_published" });
    });
  });

  describe("GET /shifts/me, GET /shifts/plans(セルフサービス)", () => {
    it("本人は権限無しで自分のシフトを閲覧できるが、他者は権限が要る", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const planRes = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId, periodStart: "2026-04-01" }),
      });
      const plan = ((await planRes.json()) as { plan: { id: string } }).plan;
      await app.request(`/shifts/plans/${plan.id}/days`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ days: [{ date: "2026-04-10", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60 }] }),
      });

      const meRes = await app.request("/shifts/me?from=2026-04-01&to=2026-04-30", { headers: { cookie } });
      expect(meRes.status).toBe(200);
      const mine = ((await meRes.json()) as { shifts: Array<{ date: string }> }).shifts;
      expect(mine.map((s) => s.date)).toEqual(["2026-04-10"]);

      const selfPlans = await app.request("/shifts/plans", { headers: { cookie } });
      expect(selfPlans.status).toBe(200);

      const second = await setupSecondUser(db, tenantId);
      const secondCookie = await loginAndGetCookie(app, second.email, second.password);
      const forbidden = await app.request(`/shifts/plans?userId=${userId}`, { headers: { cookie: secondCookie } });
      expect(forbidden.status).toBe(403);
    });
  });

  describe("GET /attendance/monthly for monthly_variable users", () => {
    it("variablePeriod を含み、workSystem が monthly_variable になる", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await switchToMonthlyVariableWorkPolicy(db, { tenantId });
      await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });
      await grantPermission(db, { tenantId, userId, permission: SHIFT_MANAGE_PERMISSION, scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const planRes = await app.request("/shifts/plans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ userId, periodStart: "2026-04-01" }),
      });
      expect(planRes.status).toBe(201);
      const plan = ((await planRes.json()) as { plan: { id: string } }).plan;

      await app.request(`/shifts/plans/${plan.id}/days`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          days: [{ date: "2026-04-01", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60 }],
        }),
      });

      // シフトの所定(9:00-18:00, 休憩60分=8h)を超える実労働にする(9:00-20:00)。
      await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind: "clock_in", occurredAt: jstMinutes(2026, 4, 1, 9, 0) }),
      });
      await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind: "clock_out", occurredAt: jstMinutes(2026, 4, 1, 20, 0) }),
      });

      const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        workSystem: string;
        figures: { variablePeriod: { periodStart: string; periodEnd: string; attributedToThisMonth: boolean } | null; totals: { overtime: number } };
      };
      expect(body.workSystem).toBe("monthly_variable");
      expect(body.figures.variablePeriod).not.toBeNull();
      expect(body.figures.variablePeriod).toMatchObject({ periodStart: "2026-04-01", periodEnd: "2026-04-30" });
      // 所定8h(9-18, 休憩60分)に対し実働は10h(9-20, 休憩60分)なので、日次段階で2h時間外。
      expect(body.figures.totals.overtime).toBeGreaterThanOrEqual(120);
    });
  });
});
