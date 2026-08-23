import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { buildDailyBreakdown } from "../src/daily.js";
import { deriveSegments } from "../src/derive.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import { calculateVariableTotals } from "../src/variable.js";
import type { CalcSettings, LawTimelineSpan, SettingsSpan, ShiftDay, ValidPunch } from "../src/types.js";

function variableSettings(periodStartDay: number, weekStartWeekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1): CalcSettings {
  return {
    tzOffsetMinutes: 540,
    dayBoundaryMinutes: 0,
    weekStartWeekday,
    legalHoliday: { kind: "weekday", weekday: 0 }, // 日曜(ShiftDay が無い日へのフォールバックのみで使う)
    workSystem: { kind: "monthly_variable", periodStartDay },
    breakRule: { mode: "punch" },
  };
}

const lawTimeline: LawTimelineSpan[] = [
  {
    from: "1970-01-01",
    law: resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false }),
  },
];

function punch(kind: ValidPunch["kind"], date: string, hour: number, minute: number, tzOffsetMinutes: number): ValidPunch {
  return { kind, occurredAt: utcMinutesFromLocalDateTime(date, { hour, minute }, tzOffsetMinutes) };
}

/** date に startHour から hours 時間ぶんの clock_in/clock_out ペアを作る(休憩打刻なし) */
function workday(date: string, startHour: number, hours: number, tzOffsetMinutes: number): ValidPunch[] {
  const endMinutesTotal = startHour * 60 + hours * 60;
  const endHour = Math.floor(endMinutesTotal / 60);
  const endMinute = Math.round(endMinutesTotal % 60);
  return [
    punch("clock_in", date, startHour, 0, tzOffsetMinutes),
    punch("clock_out", date, endHour, endMinute, tzOffsetMinutes),
  ];
}

function shiftDay(
  date: string,
  dayType: ShiftDay["dayType"],
  startHour: number,
  endHour: number,
  breakMinutes: number,
): ShiftDay {
  return { date, dayType, startMinutes: startHour * 60, endMinutes: endHour * 60, breakMinutes };
}

function runVariable(
  settings: CalcSettings,
  punches: ValidPunch[],
  shifts: ShiftDay[],
  period: { year: number; month: number } = { year: 2026, month: 4 },
) {
  const timeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];
  const { workedSegments, breakSegments, stretches } = deriveSegments(punches, timeline);
  const days = buildDailyBreakdown(workedSegments, breakSegments, timeline, lawTimeline, period, [], stretches);
  return calculateVariableTotals(days, workedSegments, shifts, timeline, lawTimeline, period);
}

describe("calculateVariableTotals — ①日次(所定と法定8hの大きい方、shift-work.md)", () => {
  it("所定9h の日に9h勤務 → 時間外0、10h勤務 → 時間外1h", () => {
    const settings = variableSettings(1);
    const shifts = [shiftDay("2026-04-06", "work", 9, 19, 60)]; // 09:00-19:00, 休憩60 = 所定9h(540分)

    const nine = runVariable(settings, workday("2026-04-06", 9, 9, settings.tzOffsetMinutes), shifts);
    const nineDay = nine.days.find((d) => d.date === "2026-04-06");
    expect(nineDay?.scheduledMinutes).toBe(540);
    expect(nineDay?.withinScheduledMinutes).toBe(540);
    expect(nineDay?.extraWithinStatutoryMinutes).toBe(0);
    expect(nineDay?.statutoryOvertimeMinutes).toBe(0);

    const ten = runVariable(settings, workday("2026-04-06", 9, 10, settings.tzOffsetMinutes), shifts);
    const tenDay = ten.days.find((d) => d.date === "2026-04-06");
    expect(tenDay?.statutoryOvertimeMinutes).toBe(60);
    expect(tenDay?.withinScheduledMinutes).toBe(540);
    expect(tenDay?.extraWithinStatutoryMinutes).toBe(0);
  });

  it("所定7h の日に8.5h勤務 → 時間外0.5h(閾値は法定8h)", () => {
    const settings = variableSettings(1);
    const shifts = [shiftDay("2026-04-06", "work", 9, 17, 60)]; // 09:00-17:00, 休憩60 = 所定7h(420分)

    const { days } = runVariable(settings, workday("2026-04-06", 9, 8.5, settings.tzOffsetMinutes), shifts);
    const day = days.find((d) => d.date === "2026-04-06");
    expect(day?.scheduledMinutes).toBe(420);
    expect(day?.withinScheduledMinutes).toBe(420);
    expect(day?.extraWithinStatutoryMinutes).toBe(60); // 420(所定)〜480(法定8h)の間
    expect(day?.statutoryOvertimeMinutes).toBe(30); // 480分(8h)を超えた30分のみ
  });

  it("法定休日(ShiftDay.dayType=legal_holiday)の労働は①②から除外され legalHolidayMinutes に計上される", () => {
    const settings = variableSettings(1);
    const shifts = [shiftDay("2026-04-12", "legal_holiday", 0, 0, 0)]; // 日曜、法定休日
    const { days, totals } = runVariable(settings, workday("2026-04-12", 9, 8, settings.tzOffsetMinutes), shifts);
    const day = days.find((d) => d.date === "2026-04-12");
    expect(day?.isLegalHoliday).toBe(true);
    expect(day?.legalHolidayMinutes).toBe(480);
    expect(day?.workedMinutes).toBe(0);
    expect(day?.withinScheduledMinutes).toBe(0);
    expect(day?.extraWithinStatutoryMinutes).toBe(0);
    expect(day?.statutoryOvertimeMinutes).toBe(0);
    expect(totals.statutoryHoliday).toBe(480);
    expect(totals.overtime).toBe(0);
  });
});

describe("calculateVariableTotals — ②週次(週の所定合計と週法定の大きい方)", () => {
  it("所定合計42h の週に42h勤務 → 週次時間外0、44h勤務 → 週次時間外2h", () => {
    const settings = variableSettings(1, 1); // 月曜起算
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11"];
    const shifts = dates.map((d) => shiftDay(d, "work", 9, 16, 0)); // 09:00-16:00 = 所定7h/日 × 6日 = 42h

    const exact = runVariable(
      settings,
      dates.flatMap((d) => workday(d, 9, 7, settings.tzOffsetMinutes)), // 各日ちょうど7h(所定通り)
      shifts,
    );
    expect(exact.totals.overtime).toBe(0);

    // 各日 7h20分(所定7h+20分)× 6日 = 44h。1日あたり420分(実労働440分)は
    // 法定8h(480分)未満のため、①(日次)だけでは1分も時間外にならない
    // (②が週次超過分をまとめて最後の日に帰属させるまでは、全日 statutoryOvertimeMinutes=0 のはず)。
    const over = runVariable(
      settings,
      dates.flatMap((d) => [
        punch("clock_in", d, 9, 0, settings.tzOffsetMinutes),
        punch("clock_out", d, 16, 20, settings.tzOffsetMinutes),
      ]),
      shifts,
    );
    // ①との二重計上が無いことの確認: 週次超過分(120分)は必ずどこかの1日にまとめて
    // 帰属する(fixed.ts と同じ「後ろから削って時間外へ移す」実装)ため、
    // 全日の statutoryOvertimeMinutes の合計はちょうど週次超過分と一致し、
    // 日次判定で個別に発生した分(今回は0)と重複しない。
    const overtimeSum = dates.reduce(
      (sum, d) => sum + (over.days.find((day) => day.date === d)?.statutoryOvertimeMinutes ?? 0),
      0,
    );
    expect(overtimeSum).toBe(120); // 44h - 42h(所定合計) = 2h
    expect(over.totals.overtime).toBe(120);
    // 実労働合計と内訳合計が一致すること(取りこぼし・二重計上がない)
    const totalWorked = dates.reduce((sum, d) => sum + (over.days.find((day) => day.date === d)?.workedMinutes ?? 0), 0);
    expect(over.totals.statutory + over.totals.overtime).toBe(totalWorked);
  });

  it("所定合計36h の週に41h勤務 → 週次時間外1h(週法定40hが閾値になる)", () => {
    const settings = variableSettings(1, 1);
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11"];
    const shifts = dates.map((d) => shiftDay(d, "work", 9, 15, 0)); // 09:00-15:00 = 所定6h/日 × 6日 = 36h

    // 各日 6h50分 × 6日 = 41h
    const { totals, days } = runVariable(
      settings,
      dates.flatMap((d) => [
        punch("clock_in", d, 9, 0, settings.tzOffsetMinutes),
        punch("clock_out", d, 15, 50, settings.tzOffsetMinutes),
      ]),
      shifts,
    );
    // 各日 6h50分(410分)は法定8h未満のため①では時間外にならない。週次超過分(60分)が
    // どこかの1日にまとめて帰属し、日次判定と重複しないことを合計で確認する。
    const overtimeSum = dates.reduce((sum, d) => sum + (days.find((day) => day.date === d)?.statutoryOvertimeMinutes ?? 0), 0);
    expect(overtimeSum).toBe(60);
    expect(totals.overtime).toBe(60); // 41h - 40h(週法定、所定合計36h<40hなので週法定が閾値)
  });
});

describe("calculateVariableTotals — ③期間(periodStartDay 起点の1ヶ月、決定事項3の帰属)", () => {
  it("総枠は週法定 × 期間の暦日数 / 7 を日割り按分する(16日〜翌15日、31暦日)", () => {
    const settings = variableSettings(16);
    // 前月(3月)からシフト制が有効(1970年から同じ設定)なので、期間 3/16〜4/15 は
    // 完結した期間として扱われる(attributedToThisMonth: true)。
    const { variablePeriod } = runVariable(settings, [], []);
    expect(variablePeriod.periodStart).toBe("2026-03-16");
    expect(variablePeriod.periodEnd).toBe("2026-04-15");
    // 3/16〜4/15 は3月16日分(16日)+4月15日分(15日)=31暦日。週法定2400分(現行法・特例なし)。
    // floor(31 * 2400 / 7) = floor(74400 / 7) = floor(10628.57...) = 10628
    expect(variablePeriod.statutoryFrameMinutes).toBe(10628);
    expect(variablePeriod.attributedToThisMonth).toBe(true);
  });

  it("monthly_variable をこの月から採用した場合(前期間が存在しない) → attributedToThisMonth は false", () => {
    const timeline: SettingsSpan[] = [
      { from: "1970-01-01", settings: { ...variableSettings(16), workSystem: { kind: "fixed", standardDayMinutes: 480 } } },
      { from: "2026-04-01", settings: variableSettings(16) }, // 4月からシフト制を導入
    ];
    const period = { year: 2026, month: 4 };
    const { workedSegments, breakSegments, stretches } = deriveSegments([], timeline);
    const days = buildDailyBreakdown(workedSegments, breakSegments, timeline, lawTimeline, period, [], stretches);
    const { variablePeriod } = calculateVariableTotals(days, workedSegments, [], timeline, lawTimeline, period);

    // periodStartDay=16 なので期間は 3/16〜4/15 と計算されるが、3/16 時点ではまだ
    // monthly_variable が導入されていない(fixed のまま)ため、期間として完結していない
    // 扱いになり、4月の締めには加算されない。
    expect(variablePeriod.periodStart).toBe("2026-03-16");
    expect(variablePeriod.periodEnd).toBe("2026-04-15");
    expect(variablePeriod.attributedToThisMonth).toBe(false);
  });

  it("期間が完結している月(periodStartDay=1)は attributedToThisMonth: true になる", () => {
    const settings = variableSettings(1);
    const { variablePeriod } = runVariable(settings, [], []);
    expect(variablePeriod.periodStart).toBe("2026-04-01");
    expect(variablePeriod.periodEnd).toBe("2026-04-30");
    expect(variablePeriod.attributedToThisMonth).toBe(true);
  });
});

describe("calculateVariableTotals — 不変条件", () => {
  it("withinScheduled + extra + overtime = workedMinutes(法定休日を除く)", () => {
    const settings = variableSettings(1, 1);
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08"];
    const shifts = [
      shiftDay("2026-04-06", "work", 9, 18, 60),
      shiftDay("2026-04-07", "non_working", 0, 0, 0),
      shiftDay("2026-04-08", "work", 9, 20, 60),
    ];
    const { days } = runVariable(
      settings,
      [
        ...workday("2026-04-06", 9, 9, settings.tzOffsetMinutes),
        ...workday("2026-04-07", 9, 3, settings.tzOffsetMinutes), // 予定外労働
        ...workday("2026-04-08", 9, 11, settings.tzOffsetMinutes),
      ],
      shifts,
    );
    for (const date of dates) {
      const day = days.find((d) => d.date === date);
      expect(day, date).toBeDefined();
      if (!day || day.isLegalHoliday) continue;
      expect(
        day.withinScheduledMinutes + day.extraWithinStatutoryMinutes + day.statutoryOvertimeMinutes,
        date,
      ).toBe(day.workedMinutes);
    }
  });
});
