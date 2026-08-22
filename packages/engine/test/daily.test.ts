import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { buildDailyBreakdown } from "../src/daily.js";
import type { CalcSettings, LawTimelineSpan, SettingsSpan } from "../src/types.js";

const settings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  flex: { settlement: "monthly", core: null, standardDayMinutes: 480 },
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
