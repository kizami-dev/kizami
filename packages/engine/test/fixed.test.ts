import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { buildDailyBreakdown } from "../src/daily.js";
import { deriveSegments } from "../src/derive.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import { calculateFixedTotals } from "../src/fixed.js";
import type { CalcSettings, LawTimelineSpan, SettingsSpan, ValidPunch } from "../src/types.js";

function fixedSettings(standardDayMinutes: number, weekStartWeekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1): CalcSettings {
  return {
    tzOffsetMinutes: 540,
    dayBoundaryMinutes: 0,
    weekStartWeekday,
    legalHoliday: { kind: "weekday", weekday: 0 }, // 日曜が法定休日
    workSystem: { kind: "fixed", standardDayMinutes },
    breakRule: { mode: "punch" },
  };
}

// 現行法(十分新しい日付)の版を使う既定プロファイル(load-fixture.ts のデフォルトと同じ方針)。
const lawTimeline: LawTimelineSpan[] = [
  {
    from: "1970-01-01",
    law: resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false }),
  },
];

const period = { year: 2026, month: 4 };
// 2026-04-01 は水曜日。weekStartWeekday: 1(月曜)だと 4/6(月)〜4/12(日) が期間内に完結する最初の週。

function punch(kind: ValidPunch["kind"], date: string, hour: number, minute: number, tzOffsetMinutes: number): ValidPunch {
  return { kind, occurredAt: utcMinutesFromLocalDateTime(date, { hour, minute }, tzOffsetMinutes) };
}

/** 指定した日付・時間(時)ぶんの clock_in/clock_out ペアを作る(09:00始業) */
function workday(date: string, hours: number, tzOffsetMinutes: number): ValidPunch[] {
  const startHour = 9;
  const endMinutesTotal = startHour * 60 + hours * 60;
  const endHour = Math.floor(endMinutesTotal / 60);
  const endMinute = endMinutesTotal % 60;
  return [
    punch("clock_in", date, startHour, 0, tzOffsetMinutes),
    punch("clock_out", date, endHour, endMinute, tzOffsetMinutes),
  ];
}

function runFixed(settings: CalcSettings, punches: ValidPunch[]) {
  const timeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];
  const { workedSegments, breakSegments, stretches } = deriveSegments(punches, timeline);
  const days = buildDailyBreakdown(workedSegments, breakSegments, timeline, lawTimeline, period, [], stretches);
  return calculateFixedTotals(days, timeline, lawTimeline, period, []);
}

describe("calculateFixedTotals — 日次法定時間外(1日8時間、労基法32条2項)", () => {
  it("1日9時間・所定8時間 → 法定時間外60分、所定内480分", () => {
    const settings = fixedSettings(8 * 60);
    const punches = workday("2026-04-06", 9, settings.tzOffsetMinutes); // 月曜
    const { totals, days } = runFixed(settings, punches);

    const day = days.find((d) => d.date === "2026-04-06");
    expect(day?.withinScheduledMinutes).toBe(480);
    expect(day?.extraWithinStatutoryMinutes).toBe(0);
    expect(day?.statutoryOvertimeMinutes).toBe(60);
    expect(totals.statutory).toBe(480);
    expect(totals.overtime).toBe(60);
  });

  it("所定7時間・実労働7.5時間 → 所定内420・法定内残業30・法定時間外0", () => {
    const settings = fixedSettings(7 * 60);
    const punches = workday("2026-04-06", 7.5, settings.tzOffsetMinutes);
    const { days } = runFixed(settings, punches);

    const day = days.find((d) => d.date === "2026-04-06");
    expect(day?.withinScheduledMinutes).toBe(420);
    expect(day?.extraWithinStatutoryMinutes).toBe(30);
    expect(day?.statutoryOvertimeMinutes).toBe(0);
  });
});

describe("calculateFixedTotals — 週次法定時間外(週40時間、労基法32条1項)", () => {
  it("週6日×7時間=42時間 → 日次法定外0、週次法定外120分", () => {
    const settings = fixedSettings(7 * 60);
    // 月曜(4/6)〜土曜(4/11)、各7時間。日曜(4/12)は法定休日で働かない。
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11"];
    const punches = dates.flatMap((d) => workday(d, 7, settings.tzOffsetMinutes));
    const { totals, days } = runFixed(settings, punches);

    for (const d of dates) {
      const day = days.find((day) => day.date === d);
      expect(day?.statutoryOvertimeMinutes, `${d} should have no daily overtime`).toBeLessThanOrEqual(120);
    }
    // 週次超過は120分。日次からは発生しない(各日7h<8h)ので、
    // 週次のみで発生したことを totals で確認する。
    expect(totals.overtime).toBe(120);
    expect(totals.statutory).toBe(6 * 420 - 120); // 2400
  });

  it("日次と週次が両方出ても、実労働時間の合計を超えて二重計上されない", () => {
    const settings = fixedSettings(8 * 60);
    // 月曜〜土曜、毎日9時間(日次法定外1時間ずつ)。週合計54時間で週次法定(40h)も超える。
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11"];
    const punches = dates.flatMap((d) => workday(d, 9, settings.tzOffsetMinutes));
    const { totals, days } = runFixed(settings, punches);

    const totalWorked = dates.reduce((sum, d) => sum + (days.find((day) => day.date === d)?.workedMinutes ?? 0), 0);
    expect(totalWorked).toBe(6 * 540); // 3240

    // statutory + overtime は実労働の合計と一致するはず(二重計上も取りこぼしもない)
    expect(totals.statutory + totals.overtime).toBe(totalWorked);
    // 日次だけなら 6*60=360分のはずだが、週次超過も乗るのでそれより多い
    expect(totals.overtime).toBeGreaterThan(6 * 60);
  });
});

describe("calculateFixedTotals — 法定休日の除外", () => {
  it("法定休日(日曜)の労働は日次/週次の計算から除外され statutoryHoliday に計上される", () => {
    const settings = fixedSettings(8 * 60);
    // 日曜(4/12, 法定休日)に8時間出勤
    const punches = workday("2026-04-12", 8, settings.tzOffsetMinutes);
    const { totals, days } = runFixed(settings, punches);

    const day = days.find((d) => d.date === "2026-04-12");
    expect(day?.isLegalHoliday).toBe(true);
    expect(day?.legalHolidayMinutes).toBe(480);
    expect(day?.withinScheduledMinutes).toBe(0);
    expect(day?.extraWithinStatutoryMinutes).toBe(0);
    expect(day?.statutoryOvertimeMinutes).toBe(0);
    expect(totals.statutory).toBe(0);
    expect(totals.overtime).toBe(0);
    expect(totals.statutoryHoliday).toBe(480);
  });
});

describe("calculateFixedTotals — 深夜(固定時間制でも daily.ts の値をそのまま合算する)", () => {
  it("22:00〜翌5:00 の重なりが lateNight として totals に出る", () => {
    const settings = fixedSettings(8 * 60);
    const punches = [
      punch("clock_in", "2026-04-06", 20, 0, settings.tzOffsetMinutes),
      punch("clock_out", "2026-04-06", 23, 0, settings.tzOffsetMinutes),
    ];
    const { totals, days } = runFixed(settings, punches);

    const day = days.find((d) => d.date === "2026-04-06");
    expect(day?.lateNightMinutes).toBe(60); // 22:00-23:00
    expect(totals.lateNight).toBe(60);
  });
});
