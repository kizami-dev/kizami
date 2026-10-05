/**
 * フレックスの契約上の枠と不足の繰越(2026-10-05、時短勤務の第2段階)の結合テスト。
 *
 * 制度の作成・割当・所定休日のカレンダーはすべて API 経由で行い、月次・締め・エクスポートが
 * 契約上の枠を使うこと、前月の繰越を「締め前はその場で計算・締め済みはスナップショット」から
 * 取ること、既定(法定の枠)の制度の人の数字が変わらないことを固定する。
 *
 * カレンダー(既定 = 土日・国民の祝日):
 * - 2026-07: 31日・所定22日(7/20 海の日)→ 契約上の枠 22 × 360 = 7920、法定の枠 10628
 * - 2026-08: 31日・所定20日(8/11 山の日)→ 7200、法定の枠 10628、上乗せの余地 3428
 * - 2026-09: 30日・所定19日(9/21〜23)→ 6840、法定の枠 10285、上乗せの余地 3445
 * 計算の根拠は packages/engine/fixtures/flex-contract/09-carry-two-months.yaml と同じ。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAuditLogs } from "@kizami/db";
import { listScheduledWorkDates } from "@kizami/engine";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

/** 制度・割当を作る「今日」(JST 2026-07-01 00:30)。割当は過去日にできないため対象の最初の月の初日 */
const SETUP_NOW = new Date("2026-06-30T15:30:00.000Z");
/** 打刻・集計を確認する「今日」(JST 2026-10-05 12:00) */
const CHECK_NOW = new Date("2026-10-05T03:00:00.000Z");

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function postJson(app: RequestLike, cookie: string, path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
}

/** 既定のカレンダー(土日・祝日、法定休日は日曜)でのその月の所定労働日 */
function scheduledDays(year: number, month: number): number[] {
  const settings = {
    tzOffsetMinutes: 540,
    dayBoundaryMinutes: 0,
    weekStartWeekday: 0 as const,
    legalHoliday: { kind: "weekday" as const, weekday: 0 as const },
    workSystem: { kind: "flex" as const, settlement: "monthly" as const, core: null, standardDayMinutes: 360 },
    breakRule: { mode: "punch" as const },
  };
  return listScheduledWorkDates([], [{ from: "1970-01-01", settings }], { year, month }).dates.map((d) => Number(d.slice(8)));
}

/** 所定労働日すべてに、9:00 から minutes 分の勤務を打刻する(休憩なし。6時間以内なので休憩不足にならない) */
async function workScheduledDays(app: RequestLike, cookie: string, year: number, month: number, minutes: number) {
  for (const day of scheduledDays(year, month)) {
    const start = jstMinutes(year, month, day, 9, 0);
    expect((await postJson(app, cookie, "/punches", { kind: "clock_in", occurredAt: start })).status).toBe(201);
    expect((await postJson(app, cookie, "/punches", { kind: "clock_out", occurredAt: start + minutes })).status).toBe(201);
  }
}

interface FlexBalanceJson {
  frameMinutes: number;
  actualMinutes: number;
  diffMinutes: number;
  statutoryFrameMinutes: number;
  contractFrameMinutes: number | null;
  carryInMinutes: number;
  withinStatutoryExcessMinutes: number;
  carryOutMinutes: number;
  confirmedShortfallMinutes: number;
}

interface MonthlyJson {
  workSystem: string;
  warnings: Array<{ kind: string }>;
  figures: { source: string; flexBalance: FlexBalanceJson | null; totals: { statutory: number; overtime: number } };
}

async function monthly(app: RequestLike, cookie: string, month: string): Promise<MonthlyJson> {
  const res = await app.request(`/attendance/monthly?month=${month}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as MonthlyJson;
}

function parseCsvByHeader(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
  const [headerLine, ...rest] = lines;
  const header = (headerLine ?? "").split(",");
  return rest.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

/** 時短フレックス(標準6時間・契約上の枠・繰り越す)を作り、管理者自身に 2026-07-01 から割り当てる */
async function setupShortHoursFlex(options: { carryOverShortfall: boolean } = { carryOverShortfall: true }) {
  vi.setSystemTime(SETUP_NOW);
  const { db, tenantId, userId, email, password } = await setupTestDb();
  for (const permission of ["tenant_settings.flex.manage", "tenant_settings.calendar.manage", "export.attendance.run", "closing.execute"]) {
    await grantPermission(db, { tenantId, userId, permission, scope: "tenant" });
  }
  const app = createApp({ db });
  const cookie = await loginAndGetCookie(app, email, password);

  const createRes = await postJson(app, cookie, "/settings/work-policies", {
    name: "フレックス・時短(6時間)",
    kind: "flex",
    settlementPeriod: "monthly",
    effectiveFrom: "2000-01-01",
    standardDayMinutes: 360,
    totalHoursBasis: "scheduled_days",
    carryOverShortfall: options.carryOverShortfall,
  });
  expect(createRes.status).toBe(201);
  const policy = ((await createRes.json()) as { policy: { id: string; effective: { totalHoursBasis: string; carryOverShortfall: boolean } } }).policy;
  expect(policy.effective).toMatchObject({ totalHoursBasis: "scheduled_days", carryOverShortfall: options.carryOverShortfall });

  const assignRes = await postJson(app, cookie, `/members/${userId}/work-policy`, { workPolicyId: policy.id, effectiveFrom: "2026-07-01" });
  expect(assignRes.status).toBe(201);

  vi.setSystemTime(CHECK_NOW);
  // 時刻を3か月進めるとセッションの有効期限を過ぎるので、確認用の「今日」でログインし直す
  const checkCookie = await loginAndGetCookie(app, email, password);
  return { db, app, tenantId, userId, cookie: checkCookie };
}

describe("フレックスの契約上の枠と不足の繰越(API)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("月次: 過不足は契約上の枠と比べ、締め前の前月の不足はその場で計算して繰り越す(2か月連続)", async () => {
    const { app, cookie } = await setupShortHoursFlex();
    await workScheduledDays(app, cookie, 2026, 7, 330); // 5時間30分 × 22日 = 7260(不足 660)
    await workScheduledDays(app, cookie, 2026, 8, 360); // 6時間 × 20日 = 7200

    const july = await monthly(app, cookie, "2026-07");
    expect(july.workSystem).toBe("flex");
    expect(july.figures.flexBalance).toEqual({
      frameMinutes: 7920,
      actualMinutes: 7260,
      diffMinutes: -660,
      statutoryFrameMinutes: 10628,
      contractFrameMinutes: 7920,
      carryInMinutes: 0, // 6月は既定(法定の枠)の制度なので繰越は無い
      withinStatutoryExcessMinutes: 0,
      carryOutMinutes: 660, // 8月の余地 3428 以内
      confirmedShortfallMinutes: 0,
    });

    // 8月: 7月の繰越 660 を上乗せ(7月は締め前なのでその場で計算)。実績 7200 → 不足 660 を9月へ
    const august = await monthly(app, cookie, "2026-08");
    expect(august.figures.flexBalance).toMatchObject({
      frameMinutes: 7860,
      contractFrameMinutes: 7200,
      carryInMinutes: 660,
      diffMinutes: -660,
      carryOutMinutes: 660,
      confirmedShortfallMinutes: 0,
    });

    // 9月: 打刻なし。8月の繰越 660 を上乗せ → 枠 7500。10月の余地まで繰り越し、残りを確定
    const september = await monthly(app, cookie, "2026-09");
    expect(september.figures.flexBalance).toMatchObject({ contractFrameMinutes: 6840, carryInMinutes: 660, frameMinutes: 7500, actualMinutes: 0 });
    const sep = september.figures.flexBalance as FlexBalanceJson;
    expect(sep.carryOutMinutes + sep.confirmedShortfallMinutes).toBe(7500);
    expect(september.warnings.map((w) => w.kind)).not.toContain("flex_carry_chain_truncated");
  });

  it("締め: 前月が締め済みならスナップショットの繰越を使い、エクスポートに契約上の枠の列が出る", async () => {
    const { app, cookie, userId } = await setupShortHoursFlex();
    await workScheduledDays(app, cookie, 2026, 7, 330);

    const closeRes = await postJson(app, cookie, "/closings/2026-07/close", {});
    expect(closeRes.status).toBe(200);

    // 8月が受け取る繰越は、締めた7月のスナップショット(flexCarryOut)から読む
    const august = await monthly(app, cookie, "2026-08");
    expect(august.figures.flexBalance).toMatchObject({ carryInMinutes: 660, contractFrameMinutes: 7200, frameMinutes: 7860 });

    const july = await monthly(app, cookie, "2026-07");
    expect(july.figures.source).toBe("snapshot");
    expect(july.figures.flexBalance).toMatchObject({ contractFrameMinutes: 7920, carryOutMinutes: 660, confirmedShortfallMinutes: 0 });

    const csvRes = await app.request("/exports/attendance.csv?month=2026-07", { headers: { cookie } });
    expect(csvRes.status).toBe(200);
    const row = parseCsvByHeader(await csvRes.text()).find((r) => r.user_id === userId);
    expect(row).toMatchObject({
      work_system: "flex",
      flex_frame_minutes: "7920",
      flex_diff_minutes: "-660",
      flex_statutory_frame_minutes: "10628",
      flex_contract_frame_minutes: "7920",
      flex_carry_in_minutes: "0",
      flex_within_statutory_excess_minutes: "0",
      flex_carry_out_minutes: "660",
      flex_confirmed_shortfall_minutes: "0",
      closed: "true",
    });

    // freee 形式の不足時間は「この月の不足として確定した分」(繰り越した分は控除しない)
    const freeeRes = await app.request("/exports/attendance.csv?month=2026-07&format=freee", { headers: { cookie } });
    const freeeRow = parseCsvByHeader(await freeeRes.text())[0];
    expect(freeeRow?.["不足時間（分）"]).toBe("0");
  });

  it("繰り越さない制度では不足はその月で確定し、法定内超過は給与ソフト形式の法定内残業に出る", async () => {
    const { app, cookie } = await setupShortHoursFlex({ carryOverShortfall: false });
    await workScheduledDays(app, cookie, 2026, 8, 390); // 6時間30分 × 20日 = 7800(法定内超過 600)
    const august = await monthly(app, cookie, "2026-08");
    expect(august.figures.flexBalance).toMatchObject({ frameMinutes: 7200, withinStatutoryExcessMinutes: 600, carryOutMinutes: 0 });
    expect(august.figures.totals).toMatchObject({ statutory: 7800, overtime: 0 });

    const freeeRes = await app.request("/exports/attendance.csv?month=2026-08&format=freee", { headers: { cookie } });
    const freeeRow = parseCsvByHeader(await freeeRes.text())[0];
    expect(freeeRow?.["所定労働時間（分）"]).toBe("7200");
    expect(freeeRow?.["法定内残業時間（分）"]).toBe("600");
    expect(freeeRow?.["時間外労働時間（分）"]).toBe("0");
  });

  it("既定(法定の枠)の制度の月は従来どおり(契約上の枠は null・枠は法定の枠)", async () => {
    const { app, cookie } = await setupShortHoursFlex();
    // 6月はシードの既定の制度(フレックス・法定の枠)
    const june = await monthly(app, cookie, "2026-06");
    expect(june.figures.flexBalance).toEqual({
      frameMinutes: 10285,
      actualMinutes: 0,
      diffMinutes: -10285,
      statutoryFrameMinutes: 10285,
      contractFrameMinutes: null,
      carryInMinutes: 0,
      withinStatutoryExcessMinutes: 0,
      carryOutMinutes: 0,
      confirmedShortfallMinutes: 10285,
    });
  });

  it("繰越を遡る深さの上限: 締めずに4か月以上さかのぼると警告し、前月を締めれば消える", async () => {
    const { app, cookie } = await setupShortHoursFlex();
    // 7〜10月はすべて打刻なし(毎月不足を出して、翌月の余地いっぱいまで繰り越す)
    const november = await monthly(app, cookie, "2026-11");
    expect(november.warnings.map((w) => w.kind)).toContain("flex_carry_chain_truncated");

    expect((await postJson(app, cookie, "/closings/2026-07/close", {})).status).toBe(200);
    const after = await monthly(app, cookie, "2026-11");
    expect(after.warnings.map((w) => w.kind)).not.toContain("flex_carry_chain_truncated");
  });

  it("制度の入力: 繰越は契約上の枠のときだけ受け付ける", async () => {
    const { app, cookie } = await setupShortHoursFlex();
    const bad = await postJson(app, cookie, "/settings/work-policies", {
      name: "フレックス(繰越だけ)",
      kind: "flex",
      settlementPeriod: "monthly",
      effectiveFrom: "2026-11-01",
      standardDayMinutes: 480,
      carryOverShortfall: true,
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "carry_over_requires_scheduled_days" });

    const badBasis = await postJson(app, cookie, "/settings/work-policies", {
      name: "フレックス(不明)",
      kind: "flex",
      settlementPeriod: "monthly",
      effectiveFrom: "2026-11-01",
      standardDayMinutes: 480,
      totalHoursBasis: "weekly",
    });
    expect(badBasis.status).toBe(400);
    expect(await badBasis.json()).toEqual({ error: "invalid_total_hours_basis" });
  });
});

describe("所定休日のカレンダー(GET/POST /settings/holiday-calendar)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CHECK_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("版が無ければ既定(土日・祝日)を返し、所定労働日数の目安を3か月分出す", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "tenant_settings.calendar.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/holiday-calendar", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective).toBeNull();
    expect(body.history).toEqual([]);
    expect(body.defaults).toEqual({ weekdays: [0, 6], nationalHolidays: true, extraHolidays: [], extraWorkdays: [] });
    expect(body.nationalHolidayDataRange.firstYear).toBe(2000);
    // 2026-10: 31日・土日9日・スポーツの日(10/12)→ 21日 / 11月: 土日9日・祝日2日(11/3・11/23)→ 19日
    expect(body.preview.slice(0, 2)).toEqual([
      { month: "2026-10", scheduledWorkDays: 21, nationalHolidayDataUnavailable: false },
      { month: "2026-11", scheduledWorkDays: 19, nationalHolidayDataUnavailable: false },
    ]);
  });

  it("版を足すと監査ログに残り、目安の日数に反映される。検証エラーと権限も確かめる", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 権限なし
    expect((await app.request("/settings/holiday-calendar", { headers: { cookie } })).status).toBe(403);
    await grantPermission(db, { tenantId, userId, permission: "tenant_settings.calendar.manage", scope: "tenant" });

    const base = { effectiveFrom: "2026-11-01", weekdays: [0, 6], nationalHolidays: true };
    expect((await postJson(app, cookie, "/settings/holiday-calendar", { ...base, weekdays: [0, 1, 2, 3, 4, 5, 6] })).status).toBe(400);
    const conflict = await postJson(app, cookie, "/settings/holiday-calendar", { ...base, extraHolidays: ["2026-11-02"], extraWorkdays: ["2026-11-02"] });
    expect(conflict.status).toBe(400);
    expect(await conflict.json()).toEqual({ error: "calendar_date_conflict" });
    const past = await postJson(app, cookie, "/settings/holiday-calendar", { ...base, effectiveFrom: "2026-10-01" });
    expect(past.status).toBe(409);
    expect(await past.json()).toEqual({ error: "effective_from_in_past" });

    const created = await postJson(app, cookie, "/settings/holiday-calendar", {
      ...base,
      extraHolidays: ["2026-11-02", "2026-11-02"], // 重複は1つにまとめる
    });
    expect(created.status).toBe(201);
    expect((await created.json()).version).toMatchObject({ effectiveFrom: "2026-11-01", weekdays: [0, 6], extraHolidays: ["2026-11-02"], extraWorkdays: [] });
    const dup = await postJson(app, cookie, "/settings/holiday-calendar", base);
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "version_already_exists" });

    const body = await (await app.request("/settings/holiday-calendar", { headers: { cookie } })).json();
    expect(body.effective).toBeNull(); // 2026-11-01 からなので今日(10/5)時点ではまだ
    expect(body.history).toHaveLength(1);
    expect(body.preview[1]).toEqual({ month: "2026-11", scheduledWorkDays: 18, nationalHolidayDataUnavailable: false });

    const logs = await listAuditLogs(db, { tenantId, limit: 10 });
    const log = logs.find((l) => l.action === "scheduled_holiday_calendar_version.create");
    expect(log?.target).toMatch(/^scheduled_holiday_calendar_versions:/);
  });
});
