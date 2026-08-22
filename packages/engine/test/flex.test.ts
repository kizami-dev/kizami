import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { buildDailyBreakdown } from "../src/daily.js";
import { calculateFlexBalance } from "../src/flex.js";
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
const period = { year: 2026, month: 4 }; // 30日 → frame = floor(2400*30/7) = 10285

describe("calculateFlexBalance — actualMinutes from paidLeave", () => {
  it("adds the sum of paid-leave minutes in the period, not days-count × standardDayMinutes", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, []);
    // 同日に複数エントリ(午前2時間+午後1時間 = 180分)。全休(480分)ではないことを確認する。
    const { flexBalance } = calculateFlexBalance(days, timeline, lawTimeline, period, [
      { date: "2026-04-10", minutes: 120 },
      { date: "2026-04-10", minutes: 60 },
    ]);

    expect(flexBalance.actualMinutes).toBe(180);
    expect(flexBalance.frameMinutes).toBe(10285);
    expect(flexBalance.diffMinutes).toBe(180 - 10285);
  });

  it("a whole-day entry (minutes = standardDayMinutes) reproduces the pre-hourly-leave behavior", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, []);
    const { flexBalance } = calculateFlexBalance(days, timeline, lawTimeline, period, [
      { date: "2026-04-10", minutes: 480 },
    ]);

    expect(flexBalance.actualMinutes).toBe(480);
  });

  it("ignores paid-leave entries outside the requested period", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, []);
    const { flexBalance } = calculateFlexBalance(days, timeline, lawTimeline, period, [
      { date: "2026-03-31", minutes: 180 }, // 前月
      { date: "2026-04-01", minutes: 120 }, // 当月
    ]);

    expect(flexBalance.actualMinutes).toBe(120);
  });
});

describe("calculateFlexBalance — 総枠は日割りで按分する", () => {
  /**
   * 週法定労働時間が期間の途中で変わった場合、総枠は「その日に有効だった値 ÷ 7」の
   * 積み上げになる(docs/design/v01-data-model.md「法令の適用時点」)。
   *
   * 実際の日本の労働法の施行日は4月1日(月初)がほとんどで、月中に切り替わる改正は
   * 現時点で存在しないため、ここでは合成した法令タイムラインで規則自体を固定する。
   */
  it("prorates the frame when the statutory weekly hours change mid-period", () => {
    const baseLaw = resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false });
    const splitTimeline: LawTimelineSpan[] = [
      { from: "1970-01-01", law: baseLaw }, // 週2400分
      { from: "2026-04-16", law: { ...baseLaw, weeklyStatutoryMinutes: 2640 } }, // 4/16から週2640分
    ];

    const days = buildDailyBreakdown([], [], timeline, splitTimeline, period, []);
    const { flexBalance } = calculateFlexBalance(days, timeline, splitTimeline, period, []);

    // 4/1-4/15の15日 × 2400/7 + 4/16-4/30の15日 × 2640/7
    //   = 5142.857... + 5657.142... = 10800.0 → floor 10800
    // (期間全体が2400なら10285、全体が2640なら11314。その中間になる)
    expect(flexBalance.frameMinutes).toBe(10800);
  });

  it("matches the simple formula when the statutory weekly hours are constant", () => {
    const days = buildDailyBreakdown([], [], timeline, lawTimeline, period, []);
    const { flexBalance } = calculateFlexBalance(days, timeline, lawTimeline, period, []);
    // floor(2400 × 30 / 7) = 10285。日割り按分でも同じ値になること
    expect(flexBalance.frameMinutes).toBe(10285);
  });
});
