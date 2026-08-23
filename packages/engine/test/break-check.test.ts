import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { checkBreakSufficiency } from "../src/break-check.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import { deriveSegments } from "../src/derive.js";
import type { CalcSettings, LawTimelineSpan, SettingsSpan, ValidPunch } from "../src/types.js";

const settings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  weekStartWeekday: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};
const settingsTimeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];

const lawTimeline: LawTimelineSpan[] = [
  {
    from: "1970-01-01",
    law: resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false }),
  },
];

const period = { year: 2026, month: 4 };

function localPunch(kind: ValidPunch["kind"], date: string, hour: number, minute: number): ValidPunch {
  return { kind, occurredAt: utcMinutesFromLocalDateTime(date, { hour, minute }, settings.tzOffsetMinutes) };
}

function warn(punches: ValidPunch[]) {
  const { stretches } = deriveSegments(punches, settingsTimeline);
  return checkBreakSufficiency(stretches, settingsTimeline, lawTimeline, period);
}

describe("checkBreakSufficiency — 境界(6時間・8時間ちょうどは義務なし)", () => {
  it("実労働ちょうど6時間0分・休憩0分 → 警告なし(「超える」の厳密性)", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 15, 0)];
    expect(warn(punches)).toEqual([]);
  });

  it("実労働6時間1分・休憩0分 → 45分必要で45分不足", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 15, 1)];
    const warnings = warn(punches);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "insufficient_break",
      date: "2026-04-10",
      break: { requiredMinutes: 45, actualMinutes: 0 },
    });
  });

  it("実労働6時間1分・休憩45分 → 警告なし", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 12, 45),
      localPunch("clock_out", "2026-04-10", 15, 46), // 9:00-15:46 拘束、休憩45分 → 実労働6:01
    ];
    expect(warn(punches)).toEqual([]);
  });

  it("実労働8時間ちょうど・休憩45分 → 警告なし(8時間は「超える」ではない)", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 12, 45),
      localPunch("clock_out", "2026-04-10", 17, 45), // 実労働 = 8:45 - 0:45 = 8:00
    ];
    expect(warn(punches)).toEqual([]);
  });

  it("実労働8時間1分・休憩45分 → 60分必要で15分不足", () => {
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("break_start", "2026-04-10", 12, 0),
      localPunch("break_end", "2026-04-10", 12, 45),
      localPunch("clock_out", "2026-04-10", 17, 46), // 実労働 = 8:46 - 0:45 = 8:01
    ];
    const warnings = warn(punches);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "insufficient_break",
      date: "2026-04-10",
      break: { requiredMinutes: 60, actualMinutes: 45 },
    });
  });
});

describe("checkBreakSufficiency — 単独区間(チェーンの要素が1つだけの日)", () => {
  it("9:00〜15:20(6時間20分)単独・休憩なし → 警告あり", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 15, 20)];
    const warnings = warn(punches);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "insufficient_break",
      date: "2026-04-10",
      break: { requiredMinutes: 45, actualMinutes: 0 },
    });
  });

  it("退勤後(チェーン末尾の後)の空白は休憩として数えない → 同じ勤務でも警告が出る", () => {
    // 上のケースと同じ構成。退勤の 15:20 から日付が変わるまでまだ長い時間が残っているが、
    // その後にもう一つ区間が続くわけではないので、この「退勤後」の時間は休憩に算入されない
    // (休憩は労働時間の"途中"に与えるものであり、末尾の後は帰宅であって休憩ではない)。
    // もし退勤後の残り時間まで休憩として数えてしまうと、退勤するだけでどんな勤務も
    // 休憩要件を満たしたことになってしまい、34条の意味が失われる。
    const punches = [localPunch("clock_in", "2026-04-10", 9, 0), localPunch("clock_out", "2026-04-10", 15, 20)];
    const warnings = warn(punches);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.break).toEqual({ requiredMinutes: 45, actualMinutes: 0 });
  });
});

describe("checkBreakSufficiency — 夜勤(日界をまたぐ1区間)はチェーン化後も保護される", () => {
  it("日界をまたぐ夜勤(22:00出勤〜翌7:00退勤、休憩なし)は区間全体で判定され警告が出る", () => {
    // 実労働 = 9時間。勤怠日で分割すると 04-10 は2時間・04-11 は7時間になり、
    // どちらの日だけを見ても8時間超の要件(60分)に届かない=見落とす。
    // 夜勤の1区間はそもそも複数区間に分割されず、開始日のチェーンに丸ごと属するため、
    // チェーン化後もこの保護は変わらない。
    const punches = [localPunch("clock_in", "2026-04-10", 22, 0), localPunch("clock_out", "2026-04-11", 7, 0)];
    const warnings = warn(punches);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "insufficient_break",
      // 開始日(勤怠日)に帰属する
      date: "2026-04-10",
      break: { requiredMinutes: 60, actualMinutes: 0 },
    });
  });

  it("夜勤の開始日と同じ日の午後にも別区間があれば同一チェーンとして合算される", () => {
    // 午後区間(14:00-16:00、実労働2時間)と夜勤(22:00出勤〜翌7:00退勤、実労働9時間)は
    // どちらも開始日が 2026-04-10 なので同一チェーンに属する。
    // 仮にチェーン化されず区間ごとに独立判定していれば、夜勤単独(9時間・休憩0分)は
    // 60分必要・0分実際で警告になるはずだが、間の6時間(16:00〜22:00)の空白が休憩として
    // 合算されるため、チェーンでは要件を満たし警告は出ない。
    const punches = [
      localPunch("clock_in", "2026-04-10", 14, 0),
      localPunch("clock_out", "2026-04-10", 16, 0),
      localPunch("clock_in", "2026-04-10", 22, 0),
      localPunch("clock_out", "2026-04-11", 7, 0),
    ];
    expect(warn(punches)).toEqual([]);
  });
});

describe("checkBreakSufficiency — 同一勤怠日の中抜け(チェーン化, 2026-08-23 改定)", () => {
  it("6.5時間勤務 → 1.5時間の中抜け → 1時間勤務 → 警告なし(中抜けの空白が休憩相当)", () => {
    // 実労働 = 6:30 + 1:00 = 7:30。旧実装(区間単位)では最初の区間(6:30・休憩0分)が
    // 単独で「6時間超・45分不足」として警告になっていたが、これは過剰検知だった。
    // 中抜けの1.5時間(90分)は労働から完全に解放された時間であり、実態としては休憩そのもの。
    // チェーン化後は 90分 >= 必要45分(実労働7:30は8時間以下なので45分要件)となり警告なし。
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("clock_out", "2026-04-10", 15, 30), // 6:30 勤務
      localPunch("clock_in", "2026-04-10", 17, 0), // 1.5h の中抜け
      localPunch("clock_out", "2026-04-10", 18, 0), // 1:00 勤務
    ];
    expect(warn(punches)).toEqual([]);
  });

  it("6.5時間勤務 → 中抜け10分 → 1時間勤務(打刻休憩なし) → 警告あり(必要45・実際10)", () => {
    // 実労働は同じく7:30(45分要件)だが、中抜けが10分しかなく休憩相当が足りない。
    // 空白を合算しても要件を満たせない場合はきちんと警告になることを確認する
    // (「空白があれば常に警告が消える」わけではない)。
    const punches = [
      localPunch("clock_in", "2026-04-10", 9, 0),
      localPunch("clock_out", "2026-04-10", 15, 30), // 6:30 勤務
      localPunch("clock_in", "2026-04-10", 15, 40), // 10分の中抜け
      localPunch("clock_out", "2026-04-10", 16, 40), // 1:00 勤務
    ];
    const warnings = warn(punches);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "insufficient_break",
      date: "2026-04-10",
      break: { requiredMinutes: 45, actualMinutes: 10 },
    });
  });

  it("旧実装では区間ごとに独立警告だったケースも、チェーン化により合算され警告が消える", () => {
    // 午前区間(3時間・休憩0分、単独では6時間以内なので無警告)と
    // 午後区間(7時間・休憩0分、単独では6時間超45分不足で警告)を、
    // 間の空白(9:00〜10:00 = 60分)を挟んで同日に行う。
    // 実労働合計 = 3:00 + 7:00 = 10:00(8時間超のため必要60分)。
    // 空白60分がそのまま休憩として合算されるため 60 >= 60 で警告は出ない。
    // (この期待値は仕様変更前は「午後区間単独で45分不足」の警告ありだったが、
    // 中抜けの空白を休憩として算入する新設計では正しく警告なしに変わる)
    const punches = [
      localPunch("clock_in", "2026-04-10", 6, 0),
      localPunch("clock_out", "2026-04-10", 9, 0),
      localPunch("clock_in", "2026-04-10", 10, 0),
      localPunch("clock_out", "2026-04-10", 17, 0),
    ];
    expect(warn(punches)).toEqual([]);
  });
});

describe("checkBreakSufficiency — 未退勤の区間", () => {
  it("退勤打刻がない区間(workedMinutes: null)は判定されない", () => {
    const punches = [localPunch("clock_in", "2026-04-10", 6, 0)]; // 退勤なし、8時間超相当が経過していても未確定
    expect(warn(punches)).toEqual([]);
  });
});

describe("checkBreakSufficiency — 期間外", () => {
  it("期間より前に開始した区間は判定対象外", () => {
    const punches = [localPunch("clock_in", "2026-03-31", 22, 0), localPunch("clock_out", "2026-04-01", 7, 0)];
    expect(warn(punches)).toEqual([]);
  });
});
