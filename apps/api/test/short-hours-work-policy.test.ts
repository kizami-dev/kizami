/**
 * 時短勤務(固定時間制・所定6時間)の法令面の確認と、一般(所定8時間)の人が同じ月に混在する
 * ケースの結合テスト(2026-10-05、名前付きの制度 = 時短勤務対応の第1段階)。
 *
 * 制度の作成・割当はすべて API(POST /settings/work-policies・POST /members/:id/work-policy)
 * 経由で行い、月次・有給・エクスポート(未締め・締め済み)の各経路が「割り当てられた制度の版」から
 * 所定を解決していることを固定する。kind で制度を探す経路が残っていると、時短の人の計算が
 * 黙って一般の人の所定(8時間)で行われるため、ここで両者を同じテナント・同じ月に並べて検証する。
 *
 * 期待値の根拠(労基法32条・37条、packages/engine/src/fixed.ts):
 * - 所定内 = min(実労働, 所定, 8時間)、法定内残業 = 所定超〜8時間以内、法定外 = 8時間超
 * - 週40時間(中小企業・特例措置対象外の既定)は、日次の法定外を除いた実労働の累積で判定する。
 *   所定が6時間でも週の判定は法定どおり(所定の合計30時間ではない)
 * - 有給1日は、その人の所定(6時間)で換算する
 *
 * 2026-04 のカレンダー: 4/1 は水曜。週の起算は日曜(setupTestDb の既定)、法定休日は日曜。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertLeaveGrant, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

/** 制度の作成・割当を行う「今日」。割当は過去日にできないため、対象月の初日にしておく。 */
const SETUP_NOW = new Date("2026-03-31T15:30:00.000Z"); // JST 2026-04-01 00:30
/** 打刻・集計を確認する「今日」(対象月 2026-04 の翌月)。 */
const CHECK_NOW = new Date("2026-05-15T03:00:00.000Z"); // JST 2026-05-15 12:00

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function postJson(app: RequestLike, cookie: string, path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
}

async function work(app: RequestLike, cookie: string, day: number, from: [number, number], to: [number, number]) {
  const inRes = await postJson(app, cookie, "/punches", { kind: "clock_in", occurredAt: jstMinutes(2026, 4, day, from[0], from[1]) });
  expect(inRes.status).toBe(201);
  const outRes = await postJson(app, cookie, "/punches", { kind: "clock_out", occurredAt: jstMinutes(2026, 4, day, to[0], to[1]) });
  expect(outRes.status).toBe(201);
}

/** CRLF 区切り・先頭行=ヘッダの CSV を、列名で引ける形にする(引用符を含むフィールドは無い前提)。 */
function parseCsvByHeader(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
  const [headerLine, ...rest] = lines;
  const header = (headerLine ?? "").split(",");
  return rest.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

interface DayJson {
  date: string;
  withinScheduledMinutes: number;
  extraWithinStatutoryMinutes: number;
  statutoryOvertimeMinutes: number;
  paidLeaveMinutes: number;
}

function pickDay(days: DayJson[], date: string) {
  const d = days.find((x) => x.date === date);
  if (!d) throw new Error(`day ${date} not found`);
  return {
    within: d.withinScheduledMinutes,
    extra: d.extraWithinStatutoryMinutes,
    overtime: d.statutoryOvertimeMinutes,
    paidLeave: d.paidLeaveMinutes,
  };
}

/**
 * 同じテナントに「固定(8時間)」「固定・時短(6時間)」を作り、管理者(setupTestDb のユーザー)を
 * 時短に、2人目を8時間に、どちらも 2026-04-01 から割り当てる。
 */
async function setupMixedTenant(): Promise<{
  db: Database;
  app: ReturnType<typeof createApp>;
  tenantId: string;
  shortUser: { userId: string; email: string; password: string };
  fullUser: { userId: string; email: string; password: string };
  shortPolicyId: string;
  fullPolicyId: string;
}> {
  vi.setSystemTime(SETUP_NOW);
  const { db, tenantId, userId, email, password } = await setupTestDb();
  const second = await setupSecondUser(db, tenantId);
  for (const permission of ["tenant_settings.flex.manage", "export.attendance.run", "closing.execute", "leave.request.approve"]) {
    await grantPermission(db, { tenantId, userId, permission, scope: "tenant" });
  }
  const app = createApp({ db });
  const cookie = await loginAndGetCookie(app, email, password);

  const fullRes = await postJson(app, cookie, "/settings/work-policies", {
    name: "固定(8時間)",
    kind: "fixed",
    effectiveFrom: "2000-01-01",
    standardDayMinutes: 480,
  });
  expect(fullRes.status).toBe(201);
  const fullPolicyId = ((await fullRes.json()) as { policy: { id: string } }).policy.id;

  const shortRes = await postJson(app, cookie, "/settings/work-policies", {
    name: "固定・時短(6時間)",
    kind: "fixed",
    effectiveFrom: "2000-01-01",
    standardDayMinutes: 360,
  });
  expect(shortRes.status).toBe(201);
  const shortPolicyId = ((await shortRes.json()) as { policy: { id: string } }).policy.id;

  const assignShort = await postJson(app, cookie, `/members/${userId}/work-policy`, { workPolicyId: shortPolicyId, effectiveFrom: "2026-04-01" });
  expect(assignShort.status).toBe(201);
  const assignFull = await postJson(app, cookie, `/members/${second.userId}/work-policy`, { workPolicyId: fullPolicyId, effectiveFrom: "2026-04-01" });
  expect(assignFull.status).toBe(201);

  vi.setSystemTime(CHECK_NOW);
  return {
    db,
    app,
    tenantId,
    shortUser: { userId, email, password },
    fullUser: { userId: second.userId, email: second.email, password: second.password },
    shortPolicyId,
    fullPolicyId,
  };
}

/** 2人に同じ打刻をする: 4/1 7時間、4/2 9時間、4/6〜4/10 8時間×5日、4/11(土)3時間。 */
async function punchSameMonth(app: RequestLike, cookie: string) {
  await work(app, cookie, 1, [9, 0], [16, 0]); // 7h
  await work(app, cookie, 2, [9, 0], [18, 0]); // 9h
  for (const day of [6, 7, 8, 9, 10]) {
    await work(app, cookie, day, [9, 0], [17, 0]); // 8h
  }
  await work(app, cookie, 11, [9, 0], [12, 0]); // 3h(この週の累積が40時間を超える)
}

describe("時短勤務(固定時間制・所定6時間)と一般(所定8時間)の混在", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("月次: 時短の人は6時間が所定内・8時間までが法定内残業・週40時間は法定どおり、8時間の人は従来どおり", async () => {
    const { app, shortUser, fullUser } = await setupMixedTenant();
    const shortCookie = await loginAndGetCookie(app, shortUser.email, shortUser.password);
    const fullCookie = await loginAndGetCookie(app, fullUser.email, fullUser.password);
    await punchSameMonth(app, shortCookie);
    await punchSameMonth(app, fullCookie);

    const shortRes = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie: shortCookie } });
    expect(shortRes.status).toBe(200);
    const shortBody = await shortRes.json();
    expect(shortBody.workSystem).toBe("fixed");

    // 7時間働いた日: 6時間が所定内、1時間が法定内残業、法定外は0
    expect(pickDay(shortBody.days, "2026-04-01")).toMatchObject({ within: 360, extra: 60, overtime: 0 });
    // 9時間働いた日: 6時間が所定内、2時間が法定内残業、1時間が法定外
    expect(pickDay(shortBody.days, "2026-04-02")).toMatchObject({ within: 360, extra: 120, overtime: 60 });
    // 週40時間: 月〜金の8時間×5日で法定内の累積がちょうど40時間(所定の合計30時間ではない)
    for (const date of ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"]) {
      expect(pickDay(shortBody.days, date)).toMatchObject({ within: 360, extra: 120, overtime: 0 });
    }
    // 土曜の3時間は週40時間を超えるので、丸ごと法定外(日次では8時間以内でも)
    expect(pickDay(shortBody.days, "2026-04-11")).toMatchObject({ within: 0, extra: 0, overtime: 180 });
    expect(shortBody.figures.fixedBreakdown).toEqual({ withinScheduledMinutes: 360 * 7, extraWithinStatutoryMinutes: 60 + 120 + 120 * 5 });
    expect(shortBody.figures.totals.overtime).toBe(60 + 180);

    // 同じテナント・同じ打刻の8時間の人(回帰): 所定=法定なので法定内残業は出ない
    const fullRes = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie: fullCookie } });
    expect(fullRes.status).toBe(200);
    const fullBody = await fullRes.json();
    expect(fullBody.workSystem).toBe("fixed");
    expect(pickDay(fullBody.days, "2026-04-01")).toMatchObject({ within: 420, extra: 0, overtime: 0 });
    expect(pickDay(fullBody.days, "2026-04-02")).toMatchObject({ within: 480, extra: 0, overtime: 60 });
    for (const date of ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"]) {
      expect(pickDay(fullBody.days, date)).toMatchObject({ within: 480, extra: 0, overtime: 0 });
    }
    expect(pickDay(fullBody.days, "2026-04-11")).toMatchObject({ within: 0, extra: 0, overtime: 180 });
    expect(fullBody.figures.fixedBreakdown).toEqual({ withinScheduledMinutes: 420 + 480 * 6, extraWithinStatutoryMinutes: 0 });
    expect(fullBody.figures.totals.overtime).toBe(60 + 180);
    // 法定外・深夜・法定休日の5区分のうち、所定の違いで変わるのは所定内と法定内残業の内訳だけ
    expect(fullBody.figures.totals.statutory).toBe(shortBody.figures.totals.statutory);
  });

  it("有給: 1日の有給は、時短の人は所定6時間、8時間の人は8時間で換算される(月次の日別・残高の両方)", async () => {
    const { db, app, tenantId, shortUser, fullUser } = await setupMixedTenant();
    for (const u of [shortUser, fullUser]) {
      await insertLeaveGrant(db, {
        tenantId,
        userId: u.userId,
        leaveType: "annual",
        grantedOn: "2026-01-01",
        days: 10,
        expiresOn: "2028-01-01",
        source: "manual",
        createdAt: 0,
      });
    }
    // 管理者(= 時短の人)が承認者を兼ねる
    const approverCookie = await loginAndGetCookie(app, shortUser.email, shortUser.password);
    const fullCookie = await loginAndGetCookie(app, fullUser.email, fullUser.password);

    for (const cookie of [approverCookie, fullCookie]) {
      const createRes = await postJson(app, cookie, "/leave/requests", { leaveDate: "2026-04-13", reason: "私用のため" });
      expect(createRes.status).toBe(201);
      const id = ((await createRes.json()) as { request: { id: string } }).request.id;
      const approveRes = await postJson(app, approverCookie, `/leave/requests/${id}/approve`, {});
      expect(approveRes.status).toBe(200);
    }

    const shortMonthly = await (await app.request("/attendance/monthly?month=2026-04", { headers: { cookie: approverCookie } })).json();
    expect(pickDay(shortMonthly.days, "2026-04-13").paidLeave).toBe(360);
    const fullMonthly = await (await app.request("/attendance/monthly?month=2026-04", { headers: { cookie: fullCookie } })).json();
    expect(pickDay(fullMonthly.days, "2026-04-13").paidLeave).toBe(480);

    const shortBalance = await (await app.request("/leave/balance", { headers: { cookie: approverCookie } })).json();
    expect(shortBalance.standardDayMinutes).toBe(360);
    expect(shortBalance.annual.usedMinutes).toBe(360);
    expect(shortBalance.annual.remainingMinutes).toBe(360 * 9);

    const fullBalance = await (await app.request("/leave/balance", { headers: { cookie: fullCookie } })).json();
    expect(fullBalance.standardDayMinutes).toBe(480);
    expect(fullBalance.annual.usedMinutes).toBe(480);
    expect(fullBalance.annual.remainingMinutes).toBe(480 * 9);
  });

  it("エクスポート: 未締め・締め済みのどちらでも、時短の人と8時間の人がそれぞれの所定で出る", async () => {
    const { app, shortUser, fullUser } = await setupMixedTenant();
    const adminCookie = await loginAndGetCookie(app, shortUser.email, shortUser.password);
    const fullCookie = await loginAndGetCookie(app, fullUser.email, fullUser.password);
    await punchSameMonth(app, adminCookie);
    await punchSameMonth(app, fullCookie);

    const expectRows = (rows: Record<string, string>[], closed: string) => {
      const shortRow = rows.find((r) => r.user_id === shortUser.userId);
      const fullRow = rows.find((r) => r.user_id === fullUser.userId);
      expect(shortRow).toMatchObject({
        work_system: "fixed",
        fixed_within_scheduled_minutes: String(360 * 7),
        fixed_extra_within_statutory_minutes: String(60 + 120 + 120 * 5),
        overtime_minutes: String(60 + 180),
        closed,
      });
      expect(fullRow).toMatchObject({
        work_system: "fixed",
        fixed_within_scheduled_minutes: String(420 + 480 * 6),
        fixed_extra_within_statutory_minutes: "0",
        overtime_minutes: String(60 + 180),
        closed,
      });
    };

    const openRes = await app.request("/exports/attendance.csv?month=2026-04", { headers: { cookie: adminCookie } });
    expect(openRes.status).toBe(200);
    expectRows(parseCsvByHeader(await openRes.text()), "false");

    // 締め(テナント全員分を同じ TenantMonthlyContext で計算する経路)でも、人ごとの所定が保たれる
    const closeRes = await postJson(app, adminCookie, "/closings/2026-04/close", {});
    expect(closeRes.status).toBe(200);

    const closedRes = await app.request("/exports/attendance.csv?month=2026-04", { headers: { cookie: adminCookie } });
    expect(closedRes.status).toBe(200);
    expectRows(parseCsvByHeader(await closedRes.text()), "true");
  });

  it("制度の版を足すと、その制度の人だけが適用開始日から変わる(同じ kind の別の制度の人は変わらない)", async () => {
    const { app, shortUser, fullUser, shortPolicyId } = await setupMixedTenant();
    const adminCookie = await loginAndGetCookie(app, shortUser.email, shortUser.password);

    // 時短を 2026-06-01 から5時間にする(過去の集計は変わらない)
    const versionRes = await postJson(app, adminCookie, `/settings/work-policies/${shortPolicyId}/versions`, {
      effectiveFrom: "2026-06-01",
      kind: "fixed",
      standardDayMinutes: 300,
    });
    expect(versionRes.status).toBe(201);

    vi.setSystemTime(new Date("2026-06-15T03:00:00.000Z"));
    const shortCookie = await loginAndGetCookie(app, shortUser.email, shortUser.password);
    const fullCookie = await loginAndGetCookie(app, fullUser.email, fullUser.password);
    const shortCaps = await (await app.request("/leave/capabilities", { headers: { cookie: shortCookie } })).json();
    expect(shortCaps.standardDayMinutes).toBe(300);
    const fullCaps = await (await app.request("/leave/capabilities", { headers: { cookie: fullCookie } })).json();
    expect(fullCaps.standardDayMinutes).toBe(480);
  });
});
