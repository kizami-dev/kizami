import { describe, expect, it } from "vitest";
import { buildDailyBreakdown } from "../src/daily.js";
import { calculateFlexBalance } from "../src/flex.js";
import type { CalcSettings, SettingsSpan } from "../src/types.js";

const settings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  flex: { settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};

const timeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];
const period = { year: 2026, month: 4 }; // 30日 → frame = floor(2400*30/7) = 10285

describe("calculateFlexBalance — actualMinutes from paidLeave", () => {
  it("adds the sum of paid-leave minutes in the period, not days-count × standardDayMinutes", () => {
    const days = buildDailyBreakdown([], [], timeline, period, []);
    // 同日に複数エントリ(午前2時間+午後1時間 = 180分)。全休(480分)ではないことを確認する。
    const { flexBalance } = calculateFlexBalance(days, timeline, period, [
      { date: "2026-04-10", minutes: 120 },
      { date: "2026-04-10", minutes: 60 },
    ]);

    expect(flexBalance.actualMinutes).toBe(180);
    expect(flexBalance.frameMinutes).toBe(10285);
    expect(flexBalance.diffMinutes).toBe(180 - 10285);
  });

  it("a whole-day entry (minutes = standardDayMinutes) reproduces the pre-hourly-leave behavior", () => {
    const days = buildDailyBreakdown([], [], timeline, period, []);
    const { flexBalance } = calculateFlexBalance(days, timeline, period, [
      { date: "2026-04-10", minutes: 480 },
    ]);

    expect(flexBalance.actualMinutes).toBe(480);
  });

  it("ignores paid-leave entries outside the requested period", () => {
    const days = buildDailyBreakdown([], [], timeline, period, []);
    const { flexBalance } = calculateFlexBalance(days, timeline, period, [
      { date: "2026-03-31", minutes: 180 }, // 前月
      { date: "2026-04-01", minutes: 120 }, // 当月
    ]);

    expect(flexBalance.actualMinutes).toBe(120);
  });
});
