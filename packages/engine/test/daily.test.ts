import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { buildDailyBreakdown } from "../src/daily.js";
import { deriveSegments } from "../src/derive.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import type { CalcSettings, LawTimelineSpan, SettingsSpan, ValidPunch } from "../src/types.js";

const settings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  weekStartWeekday: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};

const timeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];
// 現行法(十分新しい日付)の版を使う既定プロファイル(load-fixture.ts のデフォルトと同じ方針)。
const lawTimeline: LawTimelineSpan[] = [
  { from: "1970-01-01", law: resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false }) },
];
const period = { year: 2026, month: 4 };

describe("buildDailyBreakdown — paidLeave", () => {
  it("sums multiple paid-leave entries on the same date (morning + afternoon)", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, [
      { date: "2026-04-10", minutes: 120 }, // 午前2時間
      { date: "2026-04-10", minutes: 60 }, // 午後1時間
    ]);

    const day = days.find((d) => d.date === "2026-04-10");
    expect(day?.paidLeaveMinutes).toBe(180);
    expect(day?.isPaidLeave).toBe(true);
  });

  it("treats a whole-day entry (minutes = standardDayMinutes) as isPaidLeave = true", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, [{ date: "2026-04-10", minutes: 480 }]);

    const day = days.find((d) => d.date === "2026-04-10");
    expect(day?.paidLeaveMinutes).toBe(480);
    expect(day?.isPaidLeave).toBe(true);
  });

  it("days without any paid-leave entry have paidLeaveMinutes = 0 and isPaidLeave = false", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, [{ date: "2026-04-10", minutes: 180 }]);

    const other = days.find((d) => d.date === "2026-04-11");
    expect(other?.paidLeaveMinutes).toBe(0);
    expect(other?.isPaidLeave).toBe(false);
  });

  it("an entry with minutes = 0 does not mark the day as paid leave", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, [{ date: "2026-04-10", minutes: 0 }]);

    const day = days.find((d) => d.date === "2026-04-10");
    expect(day?.paidLeaveMinutes).toBe(0);
    expect(day?.isPaidLeave).toBe(false);
  });
});

function localPunch(kind: ValidPunch["kind"], date: string, hour: number, minute: number): ValidPunch {
  return {
    kind,
    occurredAt: utcMinutesFromLocalDateTime(date, { hour, minute }, settings.tzOffsetMinutes),
  };
}

describe("buildDailyBreakdown — stretches (打刻の事実の日別配賦)", () => {
  it("a normal single-day stretch is attributed to that day", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 18, 0)];
    const { workedSegments, breakSegments, stretches } = deriveSegments(punches, timeline);
    const days = buildDailyBreakdown(workedSegments, breakSegments, timeline, lawTimeline, period, [], stretches);

    const day = days.find((d) => d.date === "2026-04-10");
    expect(day?.stretches).toHaveLength(1);
    expect(day?.stretches[0]?.clockOutAt).not.toBeNull();
  });

  it("中抜け(複数回の出退勤)は同じ日に複数 stretch として並ぶ", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("clock_out", "2026-04-10", 12, 0),
      localPunch("clock_in", "2026-04-10", 13, 0),
      localPunch("clock_out", "2026-04-10", 18, 0),
    ];
    const { workedSegments, breakSegments, stretches } = deriveSegments(punches, timeline);
    const days = buildDailyBreakdown(workedSegments, breakSegments, timeline, lawTimeline, period, [], stretches);

    const day = days.find((d) => d.date === "2026-04-10");
    expect(day?.stretches).toHaveLength(2);
  });

  it("未退勤の区間も clockOutAt: null でその日の stretches に含まれる(集計には含まれない)", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0)];
    const { workedSegments, breakSegments, stretches } = deriveSegments(punches, timeline);
    const days = buildDailyBreakdown(workedSegments, breakSegments, timeline, lawTimeline, period, [], stretches);

    const day = days.find((d) => d.date === "2026-04-10");
    expect(day?.stretches).toEqual([
      { clockInAt: punches[0]?.occurredAt, clockOutAt: null, workedMinutes: null, breakMinutes: null },
    ]);
    expect(day?.workedMinutes).toBe(0);
  });

  it("日界をまたぐ夜勤は「出勤した日」の行に出て、退勤時刻は翌日になる", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 22, 0), localPunch("clock_out", "2026-04-11", 7, 0)];
    const { workedSegments, breakSegments, stretches } = deriveSegments(punches, timeline);
    const days = buildDailyBreakdown(workedSegments, breakSegments, timeline, lawTimeline, period, [], stretches);

    const dayIn = days.find((d) => d.date === "2026-04-10");
    const dayOut = days.find((d) => d.date === "2026-04-11");
    expect(dayIn?.stretches).toHaveLength(1);
    expect(dayIn?.stretches[0]?.clockInAt).toBe(punches[0]?.occurredAt);
    expect(dayIn?.stretches[0]?.clockOutAt).toBe(punches[1]?.occurredAt);
    // 退勤した日(4/11)の行には出勤扱いの stretch は乗らない(区間は分割しない)
    expect(dayOut?.stretches).toHaveLength(0);
  });
});
