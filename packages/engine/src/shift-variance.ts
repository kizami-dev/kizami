/**
 * シフト予実の乖離警告(docs/design/shift-work.md「予実の突合」)。
 *
 * シフト(ShiftDay、予定)と打刻由来の実績(DailyBreakdown、variable.ts が
 * ShiftDay.dayType を反映させた後の値)を突き合わせ、乖離を警告として出す。
 * 集計(totals)には一切反映しない — 遅刻控除等の賃金処理は給与側の責任という
 * 既存の原則(docs/design/breaks.md「自動控除は便利機能ではなく危険な機能」と同じ考え方)を踏襲する。
 *
 * 呼び出し側の契約: `days` は `period`(締めている暦月)の日のみを渡すこと
 * (variable.ts の出力する `EngineOutput.days` をそのまま渡す想定)。期間段(③)と違い、
 * 乖離警告はすべて「その日」単体で完結する判定のため、月をまたぐ変形期間全体を
 * 見る必要はない。
 *
 * 判定の詳細:
 * - missing_shift: ShiftDay が無い日に実労働(workedMinutes + legalHolidayMinutes)がある。
 *   シフトが無いと dayType が分からないため、法定休日かどうかに関わらず「シフト不在」として
 *   一括で警告する(variable.ts 側は所定0として保守的に判定済み)。
 * - shift_unplanned_work: ShiftDay はあるが dayType が work 以外(legal_holiday/non_working)
 *   なのに実労働がある。legal_holiday(法定休日)側の労働も対象に含める —
 *   シフトが「休むべき日」と定めた日に働いた事実そのものを知らせる警告であり、
 *   割増区分(legalHolidayMinutes に計上済み)とは独立な関心事のため。
 * - shift_absence: dayType が work の日に実労働が0分、かつ有給取得もない
 *   (day.isPaidLeave が false)。
 * - shift_late_arrival / shift_early_leave: dayType が work の日について、
 *   最初の出勤(day.stretches の最小 clockInAt)がシフト開始より遅い/
 *   最後の退勤(退勤済みの stretch の最大 clockOutAt)がシフト終了より早い。
 *   休憩打刻(break_start/break_end)は stretches に現れない(WorkStretch は
 *   clock_in〜clock_out の1まとまり)ため、比較対象から自然に除外される。
 *   シフトの start/end はその勤怠日のローカル分(endMinutes < startMinutes なら日跨ぎ)。
 *   比較は date.ts の utcMinutesFromLocalDateTime でエポック分に変換してから行う
 *   (tzOffsetMinutes は timeline を通じて不変という前提のもと、日跨ぎは単純に+1440分で表現できる —
 *   date.ts が DST 非対応の固定オフセットのみを扱う設計のため安全)。
 */

import { utcMinutesFromLocalDateTime, findSettingsForDate } from "./date.js";
import { shiftScheduledMinutes } from "./variable.js";
import type { CalcWarning, DailyBreakdown, PlainDateString, SettingsSpan, ShiftDay } from "./types.js";

function hourMinuteFromMinutesOfDay(totalMinutes: number): { hour: number; minute: number } {
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

export function computeShiftVarianceWarnings(
  shifts: ShiftDay[],
  days: DailyBreakdown[],
  settingsTimeline: SettingsSpan[],
): CalcWarning[] {
  const warnings: CalcWarning[] = [];
  const shiftMap = new Map<PlainDateString, ShiftDay>(shifts.map((shift) => [shift.date, shift]));

  for (const day of days) {
    const shift = shiftMap.get(day.date);
    // ShiftDay.dayType が legal_holiday の日、実労働は daily の判定で legalHolidayMinutes 側に
    // 寄っているため、両方を足し戻して「その日実際に働いた総量」を復元する。
    const actualMinutes = day.workedMinutes + day.legalHolidayMinutes;

    if (!shift) {
      if (actualMinutes > 0) {
        warnings.push({ kind: "missing_shift", date: day.date, shift: { actualMinutes } });
      }
      continue;
    }

    if (shift.dayType !== "work") {
      if (actualMinutes > 0) {
        warnings.push({
          kind: "shift_unplanned_work",
          date: day.date,
          shift: { actualMinutes, deltaMinutes: actualMinutes },
        });
      }
      continue;
    }

    // ここから dayType === "work"
    if (actualMinutes === 0) {
      if (!day.isPaidLeave) {
        const scheduledMinutes = shiftScheduledMinutes(shift);
        warnings.push({
          kind: "shift_absence",
          date: day.date,
          shift: { scheduledMinutes, actualMinutes: 0, deltaMinutes: scheduledMinutes },
        });
      }
      continue;
    }

    if (day.stretches.length === 0) continue; // 実労働はあるが打刻区間が取れない(理論上想定しない)

    const settings = findSettingsForDate(day.date, settingsTimeline);
    const crossesMidnight = shift.endMinutes < shift.startMinutes;
    const shiftStartAt = utcMinutesFromLocalDateTime(
      day.date,
      hourMinuteFromMinutesOfDay(shift.startMinutes),
      settings.tzOffsetMinutes,
    );
    const shiftEndAt =
      utcMinutesFromLocalDateTime(day.date, hourMinuteFromMinutesOfDay(shift.endMinutes), settings.tzOffsetMinutes) +
      (crossesMidnight ? 1440 : 0);

    const firstClockIn = day.stretches.reduce(
      (min, stretch) => Math.min(min, stretch.clockInAt),
      Number.POSITIVE_INFINITY,
    );
    const completedStretches = day.stretches.filter(
      (stretch): stretch is typeof stretch & { clockOutAt: number } => stretch.clockOutAt !== null,
    );
    const lastClockOut =
      completedStretches.length > 0
        ? completedStretches.reduce((max, stretch) => Math.max(max, stretch.clockOutAt), Number.NEGATIVE_INFINITY)
        : null;

    if (firstClockIn > shiftStartAt) {
      warnings.push({
        kind: "shift_late_arrival",
        date: day.date,
        punchAt: firstClockIn,
        shift: { scheduledMinutes: shiftScheduledMinutes(shift), deltaMinutes: firstClockIn - shiftStartAt },
      });
    }
    if (lastClockOut !== null && lastClockOut < shiftEndAt) {
      warnings.push({
        kind: "shift_early_leave",
        date: day.date,
        punchAt: lastClockOut,
        shift: { scheduledMinutes: shiftScheduledMinutes(shift), deltaMinutes: shiftEndAt - lastClockOut },
      });
    }
  }

  return warnings;
}
