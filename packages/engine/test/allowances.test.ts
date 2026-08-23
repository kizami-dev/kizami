import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import type { AllowanceTimelineSpan, CalcSettings, EngineInput, SettingsSpan, ValidPunch } from "../src/types.js";

const flexSettings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  weekStartWeekday: 0, // 日曜起算(法定休日=日曜と揃える)
  legalHoliday: { kind: "weekday", weekday: 0 }, // 日曜が法定休日
  workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};

const settingsTimeline: SettingsSpan[] = [{ from: "1970-01-01", settings: flexSettings }];
const lawTimeline = [
  {
    from: "1970-01-01",
    law: resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false }),
  },
];

function localPunch(kind: ValidPunch["kind"], date: string, hour: number, minute: number): ValidPunch {
  return { kind, occurredAt: utcMinutesFromLocalDateTime(date, { hour, minute }, flexSettings.tzOffsetMinutes) };
}

function baseInput(overrides: Partial<EngineInput>): EngineInput {
  return {
    punches: [],
    settingsTimeline,
    lawTimeline,
    period: { year: 2026, month: 4 },
    paidLeave: [],
    ...overrides,
  };
}

describe("allowances — timeBand のみ", () => {
  it("時間帯条件との重なり分だけを算出する", () => {
    // 6:00-8:00 の早朝手当。9:00-18:00 勤務は重ならないので0分
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "early", name: "早朝手当", conditions: { timeBand: { startMinutes: 360, endMinutes: 480 } } } },
    ];
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 18, 0)];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    const day = output.days.find((d) => d.date === "2026-04-10");
    expect(day?.allowances).toEqual([]);
  });

  it("6:30-9:30 勤務(6:00-8:00 早朝手当)は 1.5h = 90分が対象", () => {
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "early", name: "早朝手当", conditions: { timeBand: { startMinutes: 360, endMinutes: 480 } } } },
    ];
    const punches = [localPunch("clock_in", "2026-04-10", 6, 30), localPunch("clock_out", "2026-04-10", 9, 30)];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    const day = output.days.find((d) => d.date === "2026-04-10");
    expect(day?.allowances).toEqual([{ definitionId: "early", minutes: 90 }]);
    expect(output.allowanceTotals).toEqual([{ definitionId: "early", minutes: 90 }]);
  });
});

describe("allowances — 特定日のみ(dates)", () => {
  it("固定日付 '2026-04-10' に一致する日だけ対象になる", () => {
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "special", name: "特別出勤手当", conditions: { dates: ["2026-04-10"] } } },
    ];
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("clock_out", "2026-04-10", 18, 0),
      localPunch("clock_in", "2026-04-11", 9, 0),
      localPunch("clock_out", "2026-04-11", 18, 0),
    ];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    expect(output.days.find((d) => d.date === "2026-04-10")?.allowances).toEqual([{ definitionId: "special", minutes: 540 }]);
    expect(output.days.find((d) => d.date === "2026-04-11")?.allowances).toEqual([]);
  });

  it("毎年の月日 '--12-31' は年を無視して月日だけ一致すればよい", () => {
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "nye", name: "年末手当", conditions: { dates: ["--12-31"] } } },
    ];
    const punches = [localPunch("clock_in", "2026-12-31", 9, 0), localPunch("clock_out", "2026-12-31", 18, 0)];
    const output = calculate(
      baseInput({ punches, period: { year: 2026, month: 12 }, allowances: timeline }),
    );

    expect(output.days.find((d) => d.date === "2026-12-31")?.allowances).toEqual([{ definitionId: "nye", minutes: 540 }]);
  });
});

describe("allowances — 曜日のみ(weekdays)", () => {
  it("指定曜日(土曜=6)の勤務だけ対象になる", () => {
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "sat", name: "土曜出勤手当", conditions: { weekdays: [6] } } },
    ];
    // 2026-04-11 は土曜、2026-04-13 は月曜
    const punches = [
      localPunch("clock_in", "2026-04-11", 9, 0),
      localPunch("clock_out", "2026-04-11", 18, 0),
      localPunch("clock_in", "2026-04-13", 9, 0),
      localPunch("clock_out", "2026-04-13", 18, 0),
    ];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    expect(output.days.find((d) => d.date === "2026-04-11")?.allowances).toEqual([{ definitionId: "sat", minutes: 540 }]);
    expect(output.days.find((d) => d.date === "2026-04-13")?.allowances).toEqual([]);
  });
});

describe("allowances — AND 組み合わせ・日跨ぎ時間帯", () => {
  it("特定日(12/31〜1/1) × 22:00〜翌5:00(日跨ぎ)の AND 条件", () => {
    const timeline: AllowanceTimelineSpan[] = [
      {
        from: "1970-01-01",
        definition: {
          id: "nye-night",
          name: "年末年始深夜手当",
          conditions: { dates: ["2026-12-31", "2027-01-01"], timeBand: { startMinutes: 1320, endMinutes: 300 } },
        },
      },
    ];
    // 12/31 22:00 に出勤し 1/1 6:00 に退勤する日跨ぎ勤務
    const punches = [localPunch("clock_in", "2026-12-31", 22, 0), localPunch("clock_out", "2027-01-01", 6, 0)];
    const output = calculate(
      baseInput({ punches, period: { year: 2026, month: 12 }, allowances: timeline }),
    );

    // clockInAt が属する勤怠日(dayBoundary=0なので暦日そのまま)は 12/31 なので
    // stretch は 12/31 の行に出るが、実労働セグメントは attendance day で分割されるため
    // 12/31 分(22:00-24:00 = 120分)と 1/1 分(00:00-05:00 = 300分、ただし period=2026-12 なので
    // 1/1 は集計対象外)に分かれる。12/31 側の 120分だけが今月の対象。
    const day3112 = output.days.find((d) => d.date === "2026-12-31");
    expect(day3112?.allowances).toEqual([{ definitionId: "nye-night", minutes: 120 }]);
  });

  it("dates と weekdays の両方を満たす日だけ対象になる(AND)", () => {
    // 2026-04-11(土)と 2026-04-04(土)のうち、dates は 04-11 のみ指定
    const timeline: AllowanceTimelineSpan[] = [
      {
        from: "1970-01-01",
        definition: { id: "combo", name: "特定土曜手当", conditions: { dates: ["2026-04-11"], weekdays: [6] } },
      },
    ];
    const punches = [
      localPunch("clock_in", "2026-04-04", 9, 0),
      localPunch("clock_out", "2026-04-04", 18, 0),
      localPunch("clock_in", "2026-04-11", 9, 0),
      localPunch("clock_out", "2026-04-11", 18, 0),
    ];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    expect(output.days.find((d) => d.date === "2026-04-04")?.allowances).toEqual([]);
    expect(output.days.find((d) => d.date === "2026-04-11")?.allowances).toEqual([{ definitionId: "combo", minutes: 540 }]);
  });
});

describe("allowances — 法定深夜との重複", () => {
  it("同じ1分が法定深夜(lateNightMinutes)と手当(allowances)の両方に計上される", () => {
    const timeline: AllowanceTimelineSpan[] = [
      // 会社独自の深夜手当(法定と別枠)。法定深夜(22:00-5:00)と重なる 23:00-24:00 を対象にする
      { from: "1970-01-01", definition: { id: "company-night", name: "深夜手当(社内)", conditions: { timeBand: { startMinutes: 1380, endMinutes: 1440 } } } },
    ];
    const punches = [localPunch("clock_in", "2026-04-10", 22, 0), localPunch("clock_out", "2026-04-11", 0, 0)];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    const day = output.days.find((d) => d.date === "2026-04-10");
    // 22:00-24:00 = 120分が法定深夜(22:00-5:00 の一部)としても計上される
    expect(day?.lateNightMinutes).toBe(120);
    // 23:00-24:00 = 60分が会社の深夜手当としても独立に計上される(重複を排除しない)
    expect(day?.allowances).toEqual([{ definitionId: "company-night", minutes: 60 }]);
  });
});

describe("allowances — 有給日は対象外", () => {
  it("有給のみ(打刻なし)の日は allowances が空", () => {
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "any", name: "全時間対象(テスト用)", conditions: {} } },
    ];
    const output = calculate(
      baseInput({ paidLeave: [{ date: "2026-04-10", minutes: 480 }], allowances: timeline }),
    );

    const day = output.days.find((d) => d.date === "2026-04-10");
    expect(day?.isPaidLeave).toBe(true);
    expect(day?.allowances).toEqual([]);
  });
});

describe("allowances — 法定休日労働には付く", () => {
  it("法定休日(日曜)の実労働にも手当が付く", () => {
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "any", name: "全時間対象(テスト用)", conditions: {} } },
    ];
    // 2026-04-12 は日曜(法定休日)
    const punches = [localPunch("clock_in", "2026-04-12", 9, 0), localPunch("clock_out", "2026-04-12", 18, 0)];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    const day = output.days.find((d) => d.date === "2026-04-12");
    expect(day?.isLegalHoliday).toBe(true);
    expect(day?.legalHolidayMinutes).toBe(540);
    expect(day?.workedMinutes).toBe(0); // 法定休日の実労働は workedMinutes ではなく legalHolidayMinutes に計上される
    expect(day?.allowances).toEqual([{ definitionId: "any", minutes: 540 }]);
  });
});

describe("allowances — effective-dated の版切り替え", () => {
  it("手当定義の版が有効になる日から新条件が適用される", () => {
    const timeline: AllowanceTimelineSpan[] = [
      { from: "1970-01-01", definition: { id: "d1", name: "旧: 全時間", conditions: {} } },
      { from: "2026-04-15", definition: { id: "d1", name: "新: 土曜のみ", conditions: { weekdays: [6] } } },
    ];
    // 4/10(金、4/15より前)は旧版(全時間対象)が有効。4/18(土、4/15以降)は新版(土曜のみ)が有効。
    // 4/20(月、4/15以降)は新版が有効だが土曜ではないので対象外。
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("clock_out", "2026-04-10", 18, 0),
      localPunch("clock_in", "2026-04-18", 9, 0),
      localPunch("clock_out", "2026-04-18", 18, 0),
      localPunch("clock_in", "2026-04-20", 9, 0),
      localPunch("clock_out", "2026-04-20", 18, 0),
    ];
    const output = calculate(baseInput({ punches, allowances: timeline }));

    expect(output.days.find((d) => d.date === "2026-04-10")?.allowances).toEqual([{ definitionId: "d1", minutes: 540 }]);
    expect(output.days.find((d) => d.date === "2026-04-18")?.allowances).toEqual([{ definitionId: "d1", minutes: 540 }]);
    expect(output.days.find((d) => d.date === "2026-04-20")?.allowances).toEqual([]);
    expect(output.allowanceTotals).toEqual([{ definitionId: "d1", minutes: 1080 }]);
  });

  it("手当を定義していない(allowances 未指定)なら allowances は常に空、allowanceTotals も空配列", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 18, 0)];
    const output = calculate(baseInput({ punches }));

    expect(output.days.every((d) => d.allowances.length === 0)).toBe(true);
    expect(output.allowanceTotals).toEqual([]);
  });
});
