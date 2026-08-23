import { describe, expect, it } from "vitest";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import { computeShiftVarianceWarnings } from "../src/shift-variance.js";
import type { CalcSettings, DailyBreakdown, SettingsSpan, ShiftDay, WorkStretch } from "../src/types.js";

const settings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  weekStartWeekday: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  workSystem: { kind: "monthly_variable", periodStartDay: 1 },
  breakRule: { mode: "punch" },
};
const settingsTimeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];

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

function completedStretch(clockInAt: number, clockOutAt: number): WorkStretch {
  return { clockInAt, clockOutAt, workedMinutes: clockOutAt - clockInAt, breakMinutes: 0, autoDeductedBreakMinutes: 0 };
}

function shift(
  date: string,
  dayType: ShiftDay["dayType"],
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  breakMinutes = 0,
): ShiftDay {
  return {
    date,
    dayType,
    startMinutes: startHour * 60 + startMinute,
    endMinutes: endHour * 60 + endMinute,
    breakMinutes,
  };
}

describe("computeShiftVarianceWarnings", () => {
  it("missing_shift: monthly_variable なのに ShiftDay が無い日に実労働がある", () => {
    const days = [baseDay("2026-04-13", { workedMinutes: 180 })];
    const warnings = computeShiftVarianceWarnings([], days, settingsTimeline);
    expect(warnings).toEqual([{ kind: "missing_shift", date: "2026-04-13", shift: { actualMinutes: 180 } }]);
  });

  it("ShiftDay が無くても実労働が0なら missing_shift は出ない", () => {
    const days = [baseDay("2026-04-13", { workedMinutes: 0 })];
    expect(computeShiftVarianceWarnings([], days, settingsTimeline)).toEqual([]);
  });

  it("shift_absence: 勤務日(dayType=work)なのに実労働0、有給もない", () => {
    const shifts = [shift("2026-04-09", "work", 9, 0, 18, 0, 60)]; // 所定480分
    const days = [baseDay("2026-04-09", { workedMinutes: 0 })];
    const warnings = computeShiftVarianceWarnings(shifts, days, settingsTimeline);
    expect(warnings).toEqual([
      { kind: "shift_absence", date: "2026-04-09", shift: { scheduledMinutes: 480, actualMinutes: 0, deltaMinutes: 480 } },
    ]);
  });

  it("有給を取得した日は shift_absence にならない", () => {
    const shifts = [shift("2026-04-09", "work", 9, 0, 18, 0, 60)];
    const days = [baseDay("2026-04-09", { workedMinutes: 0, isPaidLeave: true, paidLeaveMinutes: 480 })];
    expect(computeShiftVarianceWarnings(shifts, days, settingsTimeline)).toEqual([]);
  });

  it("shift_unplanned_work: dayType が work 以外(non_working)の日に実労働がある", () => {
    const shifts = [shift("2026-04-08", "non_working", 0, 0, 0, 0, 0)];
    const days = [baseDay("2026-04-08", { workedMinutes: 240 })];
    const warnings = computeShiftVarianceWarnings(shifts, days, settingsTimeline);
    expect(warnings).toEqual([
      { kind: "shift_unplanned_work", date: "2026-04-08", shift: { actualMinutes: 240, deltaMinutes: 240 } },
    ]);
  });

  it("shift_unplanned_work: dayType が legal_holiday の日に実労働がある(法定休日労働も対象)", () => {
    const shifts = [shift("2026-04-12", "legal_holiday", 0, 0, 0, 0, 0)];
    const days = [baseDay("2026-04-12", { isLegalHoliday: true, legalHolidayMinutes: 240 })];
    const warnings = computeShiftVarianceWarnings(shifts, days, settingsTimeline);
    expect(warnings).toEqual([
      { kind: "shift_unplanned_work", date: "2026-04-12", shift: { actualMinutes: 240, deltaMinutes: 240 } },
    ]);
  });

  it("shift_late_arrival / shift_early_leave: 開始より遅い出勤・終了より早い退勤", () => {
    const shifts = [shift("2026-04-10", "work", 9, 0, 18, 0, 60)];
    const clockIn = utcMinutesFromLocalDateTime("2026-04-10", { hour: 9, minute: 30 }, settings.tzOffsetMinutes);
    const clockOut = utcMinutesFromLocalDateTime("2026-04-10", { hour: 17, minute: 0 }, settings.tzOffsetMinutes);
    const days = [
      baseDay("2026-04-10", {
        workedMinutes: clockOut - clockIn,
        stretches: [completedStretch(clockIn, clockOut)],
      }),
    ];
    const shiftStart = utcMinutesFromLocalDateTime("2026-04-10", { hour: 9, minute: 0 }, settings.tzOffsetMinutes);
    const shiftEnd = utcMinutesFromLocalDateTime("2026-04-10", { hour: 18, minute: 0 }, settings.tzOffsetMinutes);

    const warnings = computeShiftVarianceWarnings(shifts, days, settingsTimeline);
    expect(warnings).toContainEqual({
      kind: "shift_late_arrival",
      date: "2026-04-10",
      punchAt: clockIn,
      shift: { scheduledMinutes: 480, deltaMinutes: clockIn - shiftStart },
    });
    expect(warnings).toContainEqual({
      kind: "shift_early_leave",
      date: "2026-04-10",
      punchAt: clockOut,
      shift: { scheduledMinutes: 480, deltaMinutes: shiftEnd - clockOut },
    });
    expect(warnings).toHaveLength(2);
  });

  it("休憩打刻の有無は late/early の判定に影響しない(stretch は clock_in〜clock_out のみ)", () => {
    const shifts = [shift("2026-04-10", "work", 9, 0, 18, 0, 60)];
    // 中抜け(2つの stretch)があっても、最初の出勤・最後の退勤だけで判定する
    const morningIn = utcMinutesFromLocalDateTime("2026-04-10", { hour: 9, minute: 0 }, settings.tzOffsetMinutes);
    const morningOut = utcMinutesFromLocalDateTime("2026-04-10", { hour: 12, minute: 0 }, settings.tzOffsetMinutes);
    const afternoonIn = utcMinutesFromLocalDateTime("2026-04-10", { hour: 13, minute: 0 }, settings.tzOffsetMinutes);
    const afternoonOut = utcMinutesFromLocalDateTime("2026-04-10", { hour: 18, minute: 0 }, settings.tzOffsetMinutes);
    const days = [
      baseDay("2026-04-10", {
        workedMinutes: 480,
        stretches: [completedStretch(morningIn, morningOut), completedStretch(afternoonIn, afternoonOut)],
      }),
    ];
    const warnings = computeShiftVarianceWarnings(shifts, days, settingsTimeline);
    expect(warnings).toEqual([]); // 09:00出勤・18:00退勤とも定時通り
  });

  it("日跨ぎシフト(22:00〜翌6:00)の遅刻判定はエポック分に変換して行う", () => {
    const shifts = [shift("2026-04-20", "work", 22, 0, 6, 0, 60)]; // 22:00〜翌6:00、所定420分
    const shiftStartAt = utcMinutesFromLocalDateTime("2026-04-20", { hour: 22, minute: 0 }, settings.tzOffsetMinutes);
    const clockIn = shiftStartAt + 30; // 30分遅刻
    const clockOut = utcMinutesFromLocalDateTime("2026-04-21", { hour: 6, minute: 0 }, settings.tzOffsetMinutes); // 定時退勤
    const days = [
      baseDay("2026-04-20", {
        workedMinutes: clockOut - clockIn,
        stretches: [completedStretch(clockIn, clockOut)],
      }),
    ];

    const warnings = computeShiftVarianceWarnings(shifts, days, settingsTimeline);
    expect(warnings).toEqual([
      { kind: "shift_late_arrival", date: "2026-04-20", punchAt: clockIn, shift: { scheduledMinutes: 420, deltaMinutes: 30 } },
    ]);
  });

  it("日跨ぎシフトで定時通り出勤すれば late_arrival は出ない(境界の誤検知が無いことの確認)", () => {
    const shifts = [shift("2026-04-20", "work", 22, 0, 6, 0, 60)];
    const clockIn = utcMinutesFromLocalDateTime("2026-04-20", { hour: 22, minute: 0 }, settings.tzOffsetMinutes);
    const clockOut = utcMinutesFromLocalDateTime("2026-04-21", { hour: 6, minute: 0 }, settings.tzOffsetMinutes);
    const days = [
      baseDay("2026-04-20", {
        workedMinutes: clockOut - clockIn,
        stretches: [completedStretch(clockIn, clockOut)],
      }),
    ];
    expect(computeShiftVarianceWarnings(shifts, days, settingsTimeline)).toEqual([]);
  });
});
