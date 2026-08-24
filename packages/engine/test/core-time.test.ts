/**
 * コアタイム警告(labor law §32-3、packages/engine/src/core-time.ts)の単体テスト。
 *
 * 対象日はすべて 2026-04 の平日/土日を意図して選んでいる(2026-04-01 は水曜、
 * 04-04 は土曜、04-05 は日曜)。既定のコアタイム適用曜日は月〜金。
 */

import { describe, expect, it } from "vitest";
import { computeCoreTimeWarnings } from "../src/core-time.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import type { CalcSettings, CoreTime, DailyBreakdown, SettingsSpan, WorkStretch } from "../src/types.js";

/** 10:00〜15:00 のコアタイム(既定の曜日 = 月〜金)。 */
const CORE_10_15: CoreTime = { startMinutes: 600, endMinutes: 900 };

function settingsWithCore(core: CoreTime | null): CalcSettings {
  return {
    tzOffsetMinutes: 540,
    dayBoundaryMinutes: 0,
    weekStartWeekday: 0,
    legalHoliday: { kind: "weekday", weekday: 0 },
    workSystem: { kind: "flex", settlement: "monthly", core, standardDayMinutes: 480 },
    breakRule: { mode: "punch" },
  };
}

function timeline(core: CoreTime | null): SettingsSpan[] {
  return [{ from: "1970-01-01", settings: settingsWithCore(core) }];
}

function baseDay(date: string, overrides: Partial<DailyBreakdown> = {}): DailyBreakdown {
  return {
    date,
    workedMinutes: 0,
    breakMinutes: 0,
    autoDeductedBreakMinutes: 0,
    lateNightMinutes: 0,
    isLegalHoliday: false,
    legalHolidayMinutes: 0,
    isPaidLeave: false,
    paidLeaveMinutes: 0,
    stretches: [],
    scheduledMinutes: 0,
    withinScheduledMinutes: 0,
    extraWithinStatutoryMinutes: 0,
    statutoryOvertimeMinutes: 0,
    allowances: [],
    ...overrides,
  };
}

/** ローカル "HH:MM" を UTC エポック分に(JST 固定)。 */
function at(date: string, hour: number, minute: number): number {
  return utcMinutesFromLocalDateTime(date, { hour, minute }, 540);
}

function completedStretch(clockInAt: number, clockOutAt: number): WorkStretch {
  return { clockInAt, clockOutAt, workedMinutes: clockOutAt - clockInAt, breakMinutes: 0, autoDeductedBreakMinutes: 0 };
}

/** date の 09:00-18:00 に1区間だけ働いた日(コアタイムを完全に含む)。 */
function workedDay(date: string, stretches: WorkStretch[]): DailyBreakdown {
  const workedMinutes = stretches.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
  return baseDay(date, { workedMinutes, stretches });
}

describe("computeCoreTimeWarnings", () => {
  it("コアタイム未設定(core: null)なら警告を一切出さない", () => {
    const days = [baseDay("2026-04-01")];
    expect(computeCoreTimeWarnings(days, timeline(null))).toEqual([]);
  });

  it("コアタイムを内包する勤務なら警告は出ない", () => {
    const days = [workedDay("2026-04-01", [completedStretch(at("2026-04-01", 9, 0), at("2026-04-01", 18, 0))])];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([]);
  });

  it("境界: コアタイム開始ちょうどの出勤は遅刻にならない", () => {
    const days = [workedDay("2026-04-01", [completedStretch(at("2026-04-01", 10, 0), at("2026-04-01", 18, 0))])];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([]);
  });

  it("境界: コアタイム終了ちょうどの退勤は早退にならない", () => {
    const days = [workedDay("2026-04-01", [completedStretch(at("2026-04-01", 9, 0), at("2026-04-01", 15, 0))])];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([]);
  });

  it("core_time_late_arrival: コアタイム開始より遅い出勤(乖離分数つき)", () => {
    const clockIn = at("2026-04-01", 10, 30);
    const days = [workedDay("2026-04-01", [completedStretch(clockIn, at("2026-04-01", 18, 0))])];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([
      { kind: "core_time_late_arrival", date: "2026-04-01", punchAt: clockIn, core: { deltaMinutes: 30 } },
    ]);
  });

  it("core_time_early_leave: コアタイム終了より早い退勤(乖離分数つき)", () => {
    const clockOut = at("2026-04-01", 14, 0);
    const days = [workedDay("2026-04-01", [completedStretch(at("2026-04-01", 9, 0), clockOut)])];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([
      { kind: "core_time_early_leave", date: "2026-04-01", punchAt: clockOut, core: { deltaMinutes: 60 } },
    ]);
  });

  it("遅刻・早退は同じ日に両方出る(コアタイムの内側だけ働いた場合)", () => {
    const clockIn = at("2026-04-01", 11, 0);
    const clockOut = at("2026-04-01", 14, 0);
    const days = [workedDay("2026-04-01", [completedStretch(clockIn, clockOut)])];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15)).map((w) => w.kind)).toEqual([
      "core_time_late_arrival",
      "core_time_early_leave",
    ]);
  });

  it("乖離分数はコアタイムの長さで頭打ちになる(帯の外側は遅刻・早退ではない)", () => {
    // コアタイム(10:00-15:00)より完全に後の 16:00-19:00 勤務。遅刻は最大でも帯の長さ(300分)。
    const days = [workedDay("2026-04-01", [completedStretch(at("2026-04-01", 16, 0), at("2026-04-01", 19, 0))])];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([
      { kind: "core_time_late_arrival", date: "2026-04-01", punchAt: at("2026-04-01", 16, 0), core: { deltaMinutes: 300 } },
    ]);
  });

  it("中抜け(複数区間)は最初の出勤・最後の退勤だけで判定する", () => {
    const firstIn = at("2026-04-01", 9, 0);
    const lastOut = at("2026-04-01", 18, 0);
    const days = [
      workedDay("2026-04-01", [
        completedStretch(firstIn, at("2026-04-01", 11, 0)),
        // 11:00〜16:00 はコアタイムのど真ん中だが不在。first-in/last-out 方式では検知しない
        completedStretch(at("2026-04-01", 16, 0), lastOut),
      ]),
    ];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([]);
  });

  it("core_time_absence: 実労働0・有給なしの適用日", () => {
    const days = [baseDay("2026-04-01")];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([
      { kind: "core_time_absence", date: "2026-04-01", core: { deltaMinutes: 300 } },
    ]);
  });

  it("有給取得日は不在にも遅刻・早退にもならない", () => {
    const clockIn = at("2026-04-01", 13, 0);
    const days = [
      baseDay("2026-04-01", { isPaidLeave: true, paidLeaveMinutes: 480 }),
      // 時間単位年休で午前を休み、13:00 出勤した日(遅刻ではない)
      baseDay("2026-04-02", {
        isPaidLeave: true,
        paidLeaveMinutes: 240,
        workedMinutes: 300,
        stretches: [completedStretch(clockIn, at("2026-04-02", 18, 0))],
      }),
    ];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([]);
  });

  it("法定休日は対象外(実労働があってもコアタイム警告は出ない)", () => {
    const days = [
      // 2026-04-05 は日曜 = 法定休日。そもそも既定の適用曜日(月〜金)にも入らない
      baseDay("2026-04-05", { isLegalHoliday: true, legalHolidayMinutes: 300 }),
      // 曜日は平日だが暦日指定などで法定休日になっている日
      baseDay("2026-04-03", { isLegalHoliday: true }),
    ];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([]);
  });

  it("既定(月〜金)では土日に不在警告を出さない", () => {
    const days = [baseDay("2026-04-04"), baseDay("2026-04-05", { isLegalHoliday: true })];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([]);
  });

  it("weekdays を指定すると、その曜日だけがコアタイムの対象になる", () => {
    // 水曜のみ。2026-04-01 は水曜、2026-04-02 は木曜
    const core: CoreTime = { ...CORE_10_15, weekdays: [3] };
    const days = [baseDay("2026-04-01"), baseDay("2026-04-02")];
    expect(computeCoreTimeWarnings(days, timeline(core))).toEqual([
      { kind: "core_time_absence", date: "2026-04-01", core: { deltaMinutes: 300 } },
    ]);
  });

  it("asOfDate を渡すと、当日以降は不在警告を出さない(未来日の誤報防止)", () => {
    const days = [baseDay("2026-04-01"), baseDay("2026-04-02"), baseDay("2026-04-03")];
    const warnings = computeCoreTimeWarnings(days, timeline(CORE_10_15), "2026-04-02");
    expect(warnings.map((w) => w.date)).toEqual(["2026-04-01"]);
  });

  it("未退勤(clockOutAt が null)の日は早退にならない", () => {
    const clockIn = at("2026-04-01", 9, 0);
    const days = [
      baseDay("2026-04-01", {
        workedMinutes: 0,
        // missing_clock_out で集計除外された区間も stretches には残る。
        // workedMinutes は 0 だが打刻はあるため、不在扱いにはしたくない…が、
        // 現行の判定は workedMinutes を基準にするため不在警告が出る(後段の期待値参照)。
        stretches: [{ clockInAt: clockIn, clockOutAt: null, workedMinutes: null, breakMinutes: null, autoDeductedBreakMinutes: null }],
      }),
    ];
    // 実労働0なので不在として1件だけ。早退(core_time_early_leave)は出ない
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15)).map((w) => w.kind)).toEqual(["core_time_absence"]);
  });

  it("退勤打刻がある区間と未退勤の区間が混在する日は、退勤済みの最後の退勤で早退を判定する", () => {
    const lastOut = at("2026-04-01", 14, 0);
    const days = [
      baseDay("2026-04-01", {
        workedMinutes: 300,
        stretches: [
          completedStretch(at("2026-04-01", 9, 0), lastOut),
          { clockInAt: at("2026-04-01", 16, 0), clockOutAt: null, workedMinutes: null, breakMinutes: null, autoDeductedBreakMinutes: null },
        ],
      }),
    ];
    expect(computeCoreTimeWarnings(days, timeline(CORE_10_15))).toEqual([
      { kind: "core_time_early_leave", date: "2026-04-01", punchAt: lastOut, core: { deltaMinutes: 60 } },
    ]);
  });

  it("帯として成立しない core(end <= start)は「コアタイムなし」として扱う", () => {
    const days = [baseDay("2026-04-01")];
    expect(computeCoreTimeWarnings(days, timeline({ startMinutes: 900, endMinutes: 600 }))).toEqual([]);
    expect(computeCoreTimeWarnings(days, timeline({ startMinutes: 600, endMinutes: 600 }))).toEqual([]);
  });

  it("フレックス以外の制度(固定時間制)ではコアタイム警告を出さない", () => {
    const fixedTimeline: SettingsSpan[] = [
      {
        from: "1970-01-01",
        settings: { ...settingsWithCore(CORE_10_15), workSystem: { kind: "fixed", standardDayMinutes: 480 } },
      },
    ];
    expect(computeCoreTimeWarnings([baseDay("2026-04-01")], fixedTimeline)).toEqual([]);
  });

  it("effective-dated: コアタイムを追加した版の適用開始日より前の日には警告が出ない", () => {
    const spans: SettingsSpan[] = [
      { from: "1970-01-01", settings: settingsWithCore(null) },
      { from: "2026-04-02", settings: settingsWithCore(CORE_10_15) },
    ];
    const days = [baseDay("2026-04-01"), baseDay("2026-04-02")];
    expect(computeCoreTimeWarnings(days, spans).map((w) => w.date)).toEqual(["2026-04-02"]);
  });
});
