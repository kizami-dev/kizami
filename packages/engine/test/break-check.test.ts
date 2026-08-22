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

describe("checkBreakSufficiency — 判定単位は勤務区間(勤怠日ではない)", () => {
  it("日界をまたぐ夜勤(22:00出勤〜翌7:00退勤、休憩なし)は区間全体で判定され警告が出る", () => {
    // 実労働 = 9時間。勤怠日で分割すると 04-10 は2時間・04-11 は7時間になり、
    // どちらの日だけを見ても8時間超の要件(60分)に届かない=見落とす。区間単位ならちゃんと引っかかる。
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
});

describe("checkBreakSufficiency — 中抜け(1日に複数区間)", () => {
  it("区間ごとに独立して判定される(片方だけ不足)", () => {
    const punches = [
      // 午前区間: 実労働3時間、休憩なし → 6時間以内なので義務なし
      localPunch("clock_in", "2026-04-10", 6, 0),
      localPunch("clock_out", "2026-04-10", 9, 0),
      // 午後区間: 実労働7時間、休憩なし → 6時間超で45分必要、丸ごと不足
      localPunch("clock_in", "2026-04-10", 10, 0),
      localPunch("clock_out", "2026-04-10", 17, 0),
    ];
    const warnings = warn(punches);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "insufficient_break",
      punchAt: punches[2]?.occurredAt,
      break: { requiredMinutes: 45, actualMinutes: 0 },
    });
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
