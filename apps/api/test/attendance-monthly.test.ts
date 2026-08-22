import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculate, type CalcSettings, type EngineInput, type LawTimelineSpan, type ValidPunch } from "@kizami/engine";
import { buildLawTimeline } from "@kizami/law";
import { createApp } from "../src/app.js";
import { jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

// setupTestDb() が作るテナントの法令プロファイル既定値(中小企業・特例措置対象外)と同じもので
// 2026-04 の lawTimeline を組み立てる(apps/api/src/routes/attendance.ts が実際に使う
// buildLawTimelineForTenant と同じ結果になる — この月は現行法1本のみ)。
const LAW_TIMELINE: LawTimelineSpan[] = buildLawTimeline("2026-04-01", "2026-04-30", {
  isSmallOrMediumEnterprise: true,
  isSpecialProvisionWorkplace: false,
});

// テスト対象期間(2026-04)の内側、日界・月境界から十分離れた安全な時刻に固定する。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

const SETTINGS: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  flex: { settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};

describe("GET /attendance/monthly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches a direct engine.calculate() call over the same punches", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 3日分: 09:00-18:00 JST(休憩なし、9時間)
    const punches: ValidPunch[] = [
      { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 1, 9, 0) },
      { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 1, 18, 0) },
      { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 2, 9, 0) },
      { kind: "break_start", occurredAt: jstMinutes(2026, 4, 2, 12, 0) },
      { kind: "break_end", occurredAt: jstMinutes(2026, 4, 2, 13, 0) },
      { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 2, 18, 0) },
      // 4/5 は日曜(法定休日)に出勤
      { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 5, 9, 0) },
      { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 5, 18, 0) },
      // 深夜勤務(22:00-24:00 が深夜帯にかかる)
      { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 10, 20, 0) },
      { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 10, 23, 0) },
    ];

    for (const p of punches) {
      const res = await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind: p.kind, occurredAt: p.occurredAt }),
      });
      expect(res.status).toBe(201);
    }

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();

    const expected = calculate({
      punches,
      settingsTimeline: [{ from: "1970-01-01", settings: SETTINGS }],
      lawTimeline: LAW_TIMELINE,
      period: { year: 2026, month: 4 },
      paidLeave: [],
    } satisfies EngineInput);

    expect(body.totals).toEqual(expected.totals);
    expect(body.flexBalance).toEqual(expected.flexBalance);
    expect(body.warnings).toEqual(expected.warnings);
    expect(body.days).toEqual(expected.days);
  });

  it("returns an all-zero month when there are no punches", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();

    const expected = calculate({
      punches: [],
      settingsTimeline: [{ from: "1970-01-01", settings: SETTINGS }],
      lawTimeline: LAW_TIMELINE,
      period: { year: 2026, month: 4 },
      paidLeave: [],
    } satisfies EngineInput);

    expect(body.totals).toEqual(expected.totals);
    expect(body.flexBalance).toEqual(expected.flexBalance);
  });

  it("rejects a malformed month query with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/attendance/monthly?month=not-a-month", { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/attendance/monthly?month=2026-04");
    expect(res.status).toBe(401);
  });
});
