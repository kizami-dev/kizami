import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { applyAutoBreakDeduction } from "../src/auto-break.js";
import { checkBreakSufficiency } from "../src/break-check.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import { deriveSegments } from "../src/derive.js";
import { calculate } from "../src/index.js";
import type { AutoBreakRule, CalcSettings, EngineInput, LawTimelineSpan, SettingsSpan, ValidPunch } from "../src/types.js";

const baseSettings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  weekStartWeekday: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};

const lawTimeline: LawTimelineSpan[] = [
  {
    from: "1970-01-01",
    law: resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false }),
  },
];
const period = { year: 2026, month: 4 };

function localPunch(kind: ValidPunch["kind"], date: string, hour: number, minute: number): ValidPunch {
  return { kind, occurredAt: utcMinutesFromLocalDateTime(date, { hour, minute }, baseSettings.tzOffsetMinutes) };
}

function settingsWith(breakRule: CalcSettings["breakRule"]): SettingsSpan[] {
  return [{ from: "1970-01-01", settings: { ...baseSettings, breakRule } }];
}

function deduct(
  punches: ValidPunch[],
  breakRule: CalcSettings["breakRule"],
  waivedDates: string[] = [],
) {
  const timeline = settingsWith(breakRule);
  const { workedSegments, stretches } = deriveSegments(punches, timeline);
  return applyAutoBreakDeduction(workedSegments, stretches, timeline, waivedDates);
}

describe("applyAutoBreakDeduction — punch モード", () => {
  it("mode: punch なら一切控除しない(打刻休憩のみが実労働に反映される)", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 18, 0)];
    const result = deduct(punches, { mode: "punch" });
    expect(result.stretches[0]).toMatchObject({ workedMinutes: 540, autoDeductedBreakMinutes: 0 });
    expect(result.autoDeductedSegments).toEqual([]);
    expect(result.workedSegments).toEqual([{ start: punches[0]?.occurredAt, end: punches[1]?.occurredAt }]);
  });
});

describe("applyAutoBreakDeduction — auto モード: ルール選択(自己無矛盾性チェック)", () => {
  const rules: AutoBreakRule[] = [
    { overMinutes: 360, deductMinutes: 45 }, // 6h
    { overMinutes: 420, deductMinutes: 60 }, // 7h(テスト用。実際の法定閾値である必要はない)
  ];

  it("実労働9時間・打刻休憩0分 → より厳しい(overMinutes が大きい)有効なルールが採用され60分控除される", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 18, 0)]; // 9h
    const result = deduct(punches, { mode: "auto", rules });
    expect(result.stretches[0]).toMatchObject({ workedMinutes: 480, autoDeductedBreakMinutes: 60 });
  });

  it("拘束9時間 × 法定2段ルール(6h超45分・8h超60分)→ 60分控除・実労働8時間・警告なし(最も標準的な勤務形態)", () => {
    // 2026-08-23 の境界修正の回帰テスト: 判定が「超(>)」だと 540−60=480 が 480 超を満たさず
    // 45分控除に落ち、実労働8時間15分 → insufficient_break が毎日出てしまう。
    // 「以上(≥)」なら 60分ルールが採用され、9:00〜18:00・昼休憩60分の想定どおりになる。
    const legalRules: AutoBreakRule[] = [
      { overMinutes: 360, deductMinutes: 45 },
      { overMinutes: 480, deductMinutes: 60 },
    ];
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 18, 0)]; // 拘束9h
    const input = baseInput(settingsWith({ mode: "auto", rules: legalRules }), punches);
    const output = calculate(input);
    const day = output.days.find((d) => d.date === "2026-04-10");
    expect(day).toMatchObject({ workedMinutes: 480, autoDeductedBreakMinutes: 60 });
    expect(output.warnings).toEqual([]);
  });

  it("実労働8時間ちょうど・overMinutes=480 のルールは控除後も自身の閾値を超えられないため適用されない", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 17, 0)]; // 8h
    const result = deduct(punches, {
      mode: "auto",
      rules: [{ overMinutes: 480, deductMinutes: 60 }],
    });
    // 480 - 60 = 420 は 480 を超えない → 不採用 → 控除なし
    expect(result.stretches[0]).toMatchObject({ workedMinutes: 480, autoDeductedBreakMinutes: 0 });
  });

  it("6時間5分の勤務に45分ルール(over=360)を適用すると5時間20分まで下がり自身の閾値を割るため適用しない", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 15, 5)]; // 6h5m
    const result = deduct(punches, {
      mode: "auto",
      rules: [{ overMinutes: 360, deductMinutes: 45 }],
    });
    // 365 - 45 = 320 は 360 を超えない → 不採用(労働者不利な「割ったのにフル控除」を避ける)
    expect(result.stretches[0]).toMatchObject({ workedMinutes: 365, autoDeductedBreakMinutes: 0 });
  });

  it("auto モードでは打刻休憩があっても控除には使わず、ルールの deductMinutes を丸ごと控除する", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 12, 30), // 打刻休憩30分
      localPunch("clock_out", "2026-04-10", 18, 30), // 拘束9.5h、打刻休憩控除後の実労働9h
    ];
    const result = deduct(punches, { mode: "auto", rules: [{ overMinutes: 420, deductMinutes: 60 }] });
    // gross(打刻休憩控除後) = 540。auto は打刻休憩を無視して60分をまるごと控除する
    expect(result.stretches[0]).toMatchObject({
      breakMinutes: 30, // 打刻由来はそのまま残る
      workedMinutes: 480,
      autoDeductedBreakMinutes: 60,
    });
  });
});

describe("applyAutoBreakDeduction — both モード: 打刻休憩優先", () => {
  it("打刻休憩30分・ルール60分 → 差分の30分だけ追加控除される", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 12, 30), // 打刻休憩30分
      localPunch("clock_out", "2026-04-10", 16, 30), // 拘束7.5h、打刻休憩控除後の実労働7h(420分)
    ];
    const result = deduct(punches, { mode: "both", rules: [{ overMinutes: 360, deductMinutes: 60 }] });
    // deductionForRule = max(0, 60 - 30) = 30。420 - 30 = 390 > 360 なので採用される
    expect(result.stretches[0]).toMatchObject({
      breakMinutes: 30,
      workedMinutes: 390,
      autoDeductedBreakMinutes: 30,
    });
  });

  it("打刻休憩75分・ルール60分 → 打刻休憩が上回っているため追加控除なし", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 13, 15), // 打刻休憩75分
      localPunch("clock_out", "2026-04-10", 17, 15), // 拘束8.25h、打刻休憩控除後の実労働7h(420分)
    ];
    const result = deduct(punches, { mode: "both", rules: [{ overMinutes: 360, deductMinutes: 60 }] });
    expect(result.stretches[0]).toMatchObject({
      breakMinutes: 75,
      workedMinutes: 420,
      autoDeductedBreakMinutes: 0,
    });
  });
});

describe("applyAutoBreakDeduction — waiver(打ち消し)", () => {
  const rules: AutoBreakRule[] = [{ overMinutes: 360, deductMinutes: 45 }];

  it("waiver された日に始まる区間は自動控除しない", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 16, 0)]; // 7h
    const result = deduct(punches, { mode: "auto", rules }, ["2026-04-10"]);
    expect(result.stretches[0]).toMatchObject({ workedMinutes: 420, autoDeductedBreakMinutes: 0 });
  });

  it("waiver 日は自動控除が無いぶん休憩不足検知(labor law §34-1)の対象に自然に戻る", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 16, 0)]; // 7h、打刻休憩0
    const timeline = settingsWith({ mode: "auto", rules });
    const { stretches } = deriveSegments(punches, timeline);
    const waivedResult = applyAutoBreakDeduction(
      deriveSegments(punches, timeline).workedSegments,
      stretches,
      timeline,
      ["2026-04-10"],
    );
    const combined = waivedResult.stretches.map((s) => ({
      ...s,
      breakMinutes: (s.breakMinutes ?? 0) + (s.autoDeductedBreakMinutes ?? 0),
    }));
    const warnings = checkBreakSufficiency(combined, timeline, lawTimeline, period);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "insufficient_break", date: "2026-04-10" });

    // 対照: waiver していなければ自動控除で休憩が充足したことになり警告は出ない
    const notWaived = applyAutoBreakDeduction(
      deriveSegments(punches, timeline).workedSegments,
      stretches,
      timeline,
      [],
    );
    const combinedNotWaived = notWaived.stretches.map((s) => ({
      ...s,
      breakMinutes: (s.breakMinutes ?? 0) + (s.autoDeductedBreakMinutes ?? 0),
    }));
    expect(checkBreakSufficiency(combinedNotWaived, timeline, lawTimeline, period)).toEqual([]);
  });
});

describe("applyAutoBreakDeduction — 末尾からの控除(workedSegments への反映)", () => {
  it("日界をまたぐ区間で、末尾控除が深夜帯の重なりを正しく減らす", () => {
    // 23:00出勤 〜 翌6:00退勤(7h、打刻休憩なし)。深夜帯は22:00〜翌5:00。
    // 元の深夜重なり: 23:00-05:00 の6時間(360分)。05:00-06:00(60分)は深夜ではない。
    const punches = [localPunch("clock_in", "2026-04-10", 23, 0), localPunch("clock_out", "2026-04-11", 6, 0)];
    const timeline = settingsWith({ mode: "auto", rules: [{ overMinutes: 300, deductMinutes: 90 }] });
    const { workedSegments, stretches } = deriveSegments(punches, timeline);
    const result = applyAutoBreakDeduction(workedSegments, stretches, timeline, []);

    // gross = 420(7h)。420 - 90 = 330 > 300 なので採用、90分を末尾(04:30-06:00)から控除
    expect(result.stretches[0]).toMatchObject({ workedMinutes: 330, autoDeductedBreakMinutes: 90 });
    expect(result.workedSegments).toEqual([{ start: punches[0]?.occurredAt, end: (punches[1]?.occurredAt ?? 0) - 90 }]);

    // 控除後は 23:00-04:30 のみが残り、全区間が深夜帯(22:00-05:00)に収まる → 330分
    // (控除前は360分だったので、深夜外だった60分のうち30分だけが実際に削れて減少幅は30分に留まる。
    // これは末尾控除が「実際に削られた時刻」ベースで深夜重なりを再計算していることの確認)
    const settings = timeline[0]?.settings as CalcSettings;
    const kept = result.workedSegments[0];
    expect(kept).toBeDefined();
    if (!kept) throw new Error("unreachable");
    const localStart = kept.start + settings.tzOffsetMinutes;
    const localEnd = kept.end + settings.tzOffsetMinutes;
    expect(localEnd - localStart).toBe(330);
  });
});

function baseInput(settingsTimeline: SettingsSpan[], punches: ValidPunch[], waived?: string[]): EngineInput {
  return {
    punches,
    settingsTimeline,
    lawTimeline,
    period,
    paidLeave: [],
    ...(waived ? { autoBreakWaivedDates: waived } : {}),
  };
}

describe("calculate — DailyBreakdown で breakMinutes と autoDeductedBreakMinutes が分離している", () => {
  it("both モード: 打刻休憩と自動控除が別フィールドに出る", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 12, 30), // 打刻休憩30分
      localPunch("clock_out", "2026-04-10", 19, 30), // 拘束10.5h、打刻休憩控除後の実労働10h(600分)
    ];
    const timeline = settingsWith({ mode: "both", rules: [{ overMinutes: 360, deductMinutes: 60 }] });
    const output = calculate(baseInput(timeline, punches));

    const day = output.days.find((d) => d.date === "2026-04-10");
    expect(day?.breakMinutes).toBe(30);
    expect(day?.autoDeductedBreakMinutes).toBe(30);
    expect(day?.workedMinutes).toBe(570); // 600 - 30
  });

  it("punch モード: autoDeductedBreakMinutes は常に0で、既存の挙動を変えない", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 12, 30),
      localPunch("clock_out", "2026-04-10", 19, 30),
    ];
    const timeline = settingsWith({ mode: "punch" });
    const output = calculate(baseInput(timeline, punches));

    const day = output.days.find((d) => d.date === "2026-04-10");
    expect(day?.breakMinutes).toBe(30);
    expect(day?.autoDeductedBreakMinutes).toBe(0);
    expect(day?.workedMinutes).toBe(600);
  });
});
