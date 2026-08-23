/**
 * 1ヶ月単位の変形労働時間制(monthly_variable、労基法32条の2)集計
 * (docs/design/shift-work.md「時間外労働の3段判定」)。
 *
 * fixed.ts の日次→週次の二段判定を、シフト(ShiftDay)による「日ごとに違う所定」に
 * 対応させたうえで、③期間段(変形期間の法定総枠超過)を追加した三段判定:
 *
 * - ①日: 所定(ShiftDay)が1日8時間(law.dailyStatutoryMinutes)超の日は所定超、
 *   8時間以下の日は8時間超。閾値は `max(所定, 法定8時間)` という1つの式に単純化できる
 *   (所定>8hなら所定がそのまま閾値になり、所定<=8hなら法定8hが閾値になる。fixed.ts と違い
 *   monthly_variable の所定は8h超もありうるため、fixed.ts のように「所定は常に8h以内」を
 *   前提にできない)
 * - ②週: 週の所定合計が週法定(law.weeklyStatutoryMinutes、特例44h)超の週は所定合計超、
 *   以下の週は週法定超。①で時間外にした分は除く。閾値は `max(週の所定合計, 週法定)`。
 *   週の起算は settings.weekStartWeekday。月をまたぐ週は「その暦月内の日のみ」で判定する
 *   (fixed.ts と同じ割り切り — 月次締めの独立性を優先し、前月分を引きずらない)
 * - ③期間: 変形期間(periodStartDay 起点の1ヶ月)全体の実労働合計 −(①②で時間外にした分)
 *   − 期間の法定総枠(floor(週法定 × 暦日数 / 7))の正の部分。**期間の終了日が属する月の
 *   締めにのみ**帰属させる(`attributedToThisMonth`、決定事項3。下記参照)
 *
 * 法定休日(ShiftDay.dayType === "legal_holiday")の労働は①②③のいずれからも除外し、
 * daily.ts と同じく legalHolidayMinutes へ計上する(shift-work.md「法定休日の扱い」)。
 * 曜日固定の `settings.legalHoliday` ではなく ShiftDay 側の dayType が権威を持つ
 * (シフト表が「その日働くべきか」を決めるデータになったため)。ShiftDay が無い日
 * (missing_shift)だけは、判定材料が無いため旧来の `settings.legalHoliday`(曜日基準)に
 * フォールバックする。
 *
 * ---
 *
 * 判断点(2026-08-23, ③期間段の帰属の実装 — docs/design/shift-work.md 決定事項3):
 *
 * 「期間の終了日が属する月の締めに帰属させる」を素直に実装すると、periodStartDay が
 * 何であっても各暦月には必ずちょうど1つ「その月に終わる変形期間」が存在する
 * (期間は隙間なく1ヶ月ずつ連続してタイル状に並ぶため)。つまり periodStart を
 * 「`period`(締めている暦月)の前月の periodStartDay」に固定する素朴な実装では、
 * `attributedToThisMonth` は構造的に常に true になってしまい、決定事項3が言う
 * 「期間が月末時点で未完なら加算しない」を再現できる場面が無くなる。
 *
 * そこで本実装は、`periodStart` の時点で実際に有効だった設定(`settingsTimeline` を
 * `periodStart` の日付で解決したもの)が monthly_variable かつ同じ periodStartDay で
 * あることを確認し、一致しなければ `attributedToThisMonth: false` とする
 * (計算自体は返すが totals には加算しない)。これは実務上「シフト制をこの月から
 * 導入した」ケースに対応する — 前月分の monthly_variable な期間・シフトがそもそも
 * 存在しないため、「前月から続く期間」を完結した期間として扱うのは誤りになる。
 * periodStartDay がテナント設定変更で変わった場合も同様に false 側に倒す
 * (期間の一意なタイリングが崩れるため、安全側 = 加算しない側に倒す判断)。
 *
 * 判断点(週の割り切り): ②の週グルーピングは「発生日の暦月」ごとに独立して行う
 * (fixed.ts と同じ)。③のために変形期間全体(前月にまたがる分含む)の①②を計算する際も、
 * 前月側の週グルーピングは「前月を1ヶ月分まるごと計算し直す」形にしている
 * (`computeMonthDayWeekCalc` を前月にも適用する) — 前月の週境界は前月が単独で
 * 閉じられたとき(=前月自身の締め処理)に実際に使われるものと一致させる必要があり、
 * 変形期間の開始日(periodStartDay)だけを起点にした部分月グルーピングをすると、
 * 前月の締め処理が計算する週次時間外と数値がずれてしまう(二重計上・計上漏れの原因になる)。
 */

import type { Segment } from "./derive.js";
import {
  daysInMonth,
  dateStringFromEpochDay,
  epochDayFromDateString,
  findLawForDate,
  findSettingsForDate,
  formatDateString,
  isLegalHoliday,
  parseDateString,
  weekdayFromEpochDay,
} from "./date.js";
import { splitByAttendanceDay } from "./daily.js";
import type {
  CategorizedMinutes,
  DailyBreakdown,
  LawTimelineSpan,
  PlainDateString,
  SettingsSpan,
  ShiftDay,
  VariablePeriodSummary,
} from "./types.js";

/** ShiftDay 1件の所定(分)。work 以外は 0。日跨ぎ(endMinutes < startMinutes)は 1440 分を足して解決する。 */
export function shiftScheduledMinutes(shift: ShiftDay): number {
  if (shift.dayType !== "work") return 0;
  const raw = shift.endMinutes - shift.startMinutes;
  const span = raw < 0 ? raw + 1440 : raw;
  return Math.max(0, span - shift.breakMinutes);
}

interface VariableDayCalc {
  isLegalHoliday: boolean;
  legalHolidayMinutes: number;
  /** 実労働(法定休日分を除く、まだ①②の内訳には分割していない生の値) */
  workedMinutes: number;
  scheduledMinutes: number;
  withinScheduledMinutes: number;
  extraWithinStatutoryMinutes: number;
  statutoryOvertimeMinutes: number;
}

/** [fromDate, toDate](両端含む、ローカル日付の文字列比較で判定)における日別実労働(分)。 */
function workedMinutesByDateInRange(
  workedSegments: Segment[],
  settingsTimeline: SettingsSpan[],
  fromDate: PlainDateString,
  toDate: PlainDateString,
): Map<PlainDateString, number> {
  const result = new Map<PlainDateString, number>();
  for (const segment of workedSegments) {
    for (const piece of splitByAttendanceDay(segment, settingsTimeline)) {
      if (piece.date < fromDate || piece.date > toDate) continue;
      const minutes = piece.end - piece.start;
      result.set(piece.date, (result.get(piece.date) ?? 0) + minutes);
    }
  }
  return result;
}

function buildInitialDayCalcs(
  dates: PlainDateString[],
  workedByDate: Map<PlainDateString, number>,
  shiftMap: Map<PlainDateString, ShiftDay>,
  settingsTimeline: SettingsSpan[],
): Map<PlainDateString, VariableDayCalc> {
  const result = new Map<PlainDateString, VariableDayCalc>();
  for (const date of dates) {
    const shift = shiftMap.get(date);
    const settings = findSettingsForDate(date, settingsTimeline);
    // 権威は ShiftDay.dayType。ShiftDay が無い日(missing_shift)だけ旧来の曜日ルールに
    // フォールバックする(shift-work.md「法定休日の扱い」、上部コメント参照)。
    const holiday = shift ? shift.dayType === "legal_holiday" : isLegalHoliday(date, settings.legalHoliday);
    const raw = workedByDate.get(date) ?? 0;
    const scheduledMinutes = shift ? shiftScheduledMinutes(shift) : 0;
    result.set(date, {
      isLegalHoliday: holiday,
      legalHolidayMinutes: holiday ? raw : 0,
      workedMinutes: holiday ? 0 : raw,
      scheduledMinutes,
      withinScheduledMinutes: 0,
      extraWithinStatutoryMinutes: 0,
      statutoryOvertimeMinutes: 0,
    });
  }
  return result;
}

/** ①日次: 閾値 = max(所定, law.dailyStatutoryMinutes)。法定休日はスキップ(0のまま)。 */
function applyDailyStage(
  calcs: Map<PlainDateString, VariableDayCalc>,
  dates: PlainDateString[],
  lawTimeline: LawTimelineSpan[],
): void {
  for (const date of dates) {
    const c = calcs.get(date);
    if (!c || c.isLegalHoliday) continue;
    const law = findLawForDate(date, lawTimeline);
    const threshold = Math.max(c.scheduledMinutes, law.dailyStatutoryMinutes);
    const dailyOvertime = Math.max(0, c.workedMinutes - threshold);
    const withinThreshold = c.workedMinutes - dailyOvertime;
    const withinScheduled = Math.min(withinThreshold, c.scheduledMinutes);
    const extra = withinThreshold - withinScheduled;
    calcs.set(date, {
      ...c,
      withinScheduledMinutes: withinScheduled,
      extraWithinStatutoryMinutes: extra,
      statutoryOvertimeMinutes: dailyOvertime,
    });
  }
}

/**
 * ②週次: `dates`(既に1つの暦月に属する日のみを渡す契約)を週起算曜日でグルーピングし、
 * 閾値 = max(週の所定合計, law.weeklyStatutoryMinutes) を超えた累積分をその日に帰属させる。
 * fixed.ts の週次パスと同じ「後ろ側(所定外法定内→所定内)から削って時間外へ移す」方式。
 */
function applyWeeklyStage(
  calcs: Map<PlainDateString, VariableDayCalc>,
  dates: PlainDateString[],
  weekStartWeekday: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  lawTimeline: LawTimelineSpan[],
): void {
  const weekGroups = new Map<number, PlainDateString[]>();
  for (const date of dates) {
    const epochDay = epochDayFromDateString(date);
    const weekday = weekdayFromEpochDay(epochDay);
    const weekStartEpochDay = epochDay - ((weekday - weekStartWeekday + 7) % 7);
    const list = weekGroups.get(weekStartEpochDay);
    if (list) {
      list.push(date);
    } else {
      weekGroups.set(weekStartEpochDay, [date]);
    }
  }

  for (const dateList of weekGroups.values()) {
    let weekScheduledTotal = 0;
    for (const date of dateList) {
      const c = calcs.get(date);
      if (c && !c.isLegalHoliday) weekScheduledTotal += c.scheduledMinutes;
    }

    let cumulativeWithinStatutory = 0;
    for (const date of dateList) {
      const c = calcs.get(date);
      if (!c || c.isLegalHoliday) continue;
      const law = findLawForDate(date, lawTimeline);
      const weeklyThreshold = Math.max(weekScheduledTotal, law.weeklyStatutoryMinutes);
      const dayWithinStatutory = c.withinScheduledMinutes + c.extraWithinStatutoryMinutes;

      const priorCumulative = cumulativeWithinStatutory;
      cumulativeWithinStatutory += dayWithinStatutory;

      const weeklyOvertimeForDay =
        Math.max(0, cumulativeWithinStatutory - weeklyThreshold) - Math.max(0, priorCumulative - weeklyThreshold);
      if (weeklyOvertimeForDay <= 0) continue;

      let remaining = weeklyOvertimeForDay;
      const reduceExtra = Math.min(remaining, c.extraWithinStatutoryMinutes);
      remaining -= reduceExtra;
      const reduceScheduled = Math.min(remaining, c.withinScheduledMinutes);
      remaining -= reduceScheduled;

      calcs.set(date, {
        ...c,
        extraWithinStatutoryMinutes: c.extraWithinStatutoryMinutes - reduceExtra,
        withinScheduledMinutes: c.withinScheduledMinutes - reduceScheduled,
        statutoryOvertimeMinutes: c.statutoryOvertimeMinutes + weeklyOvertimeForDay,
      });
    }
  }
}

/** ある暦月まるごとについて①②を計算する(fixed.ts の月次締めと同じ計算を、月単位の関数として切り出したもの)。 */
function computeMonthDayWeekCalc(
  monthPeriod: { year: number; month: number },
  workedSegments: Segment[],
  shiftMap: Map<PlainDateString, ShiftDay>,
  settingsTimeline: SettingsSpan[],
  lawTimeline: LawTimelineSpan[],
): Map<PlainDateString, VariableDayCalc> {
  const monthStart = formatDateString({ year: monthPeriod.year, month: monthPeriod.month, day: 1 });
  const monthEnd = formatDateString({
    year: monthPeriod.year,
    month: monthPeriod.month,
    day: daysInMonth(monthPeriod.year, monthPeriod.month),
  });
  const dates: PlainDateString[] = [];
  for (let d = epochDayFromDateString(monthStart); d <= epochDayFromDateString(monthEnd); d++) {
    dates.push(dateStringFromEpochDay(d));
  }
  const workedByDate = workedMinutesByDateInRange(workedSegments, settingsTimeline, monthStart, monthEnd);
  const calcs = buildInitialDayCalcs(dates, workedByDate, shiftMap, settingsTimeline);
  applyDailyStage(calcs, dates, lawTimeline);
  const weekStartWeekday = findSettingsForDate(monthStart, settingsTimeline).weekStartWeekday;
  applyWeeklyStage(calcs, dates, weekStartWeekday, lawTimeline);
  return calcs;
}

/**
 * 変形期間([periodStart, periodEnd])を決める。periodStartDay 起点の1ヶ月
 * (例: 16なら 3/16〜4/15 が `period` = 4月 の締めに対応する期間)。
 * periodStartDay は 1〜28 のため全ての月で有効な日付になる(types.ts の WorkSystem コメント参照)。
 */
function computeVariablePeriodRange(
  period: { year: number; month: number },
  periodStartDay: number,
): { periodStart: PlainDateString; periodEnd: PlainDateString } {
  const candidateAnchor = formatDateString({ year: period.year, month: period.month, day: periodStartDay });
  const candidateEnd = dateStringFromEpochDay(epochDayFromDateString(candidateAnchor) - 1);
  const candidateEndCivil = parseDateString(candidateEnd);

  let periodEnd: PlainDateString;
  if (candidateEndCivil.year === period.year && candidateEndCivil.month === period.month) {
    periodEnd = candidateEnd;
  } else {
    // periodStartDay === 1 のときだけここに来る(candidateEnd が前月に丸め込まれるため)。
    // この場合、period の月に属する期間は「period 自身の月初〜月末」になる。
    const nextMonth = addMonths(period.year, period.month, 1);
    const nextAnchor = formatDateString({ year: nextMonth.year, month: nextMonth.month, day: periodStartDay });
    periodEnd = dateStringFromEpochDay(epochDayFromDateString(nextAnchor) - 1);
  }

  // periodStart は「periodEnd の翌日(= 次の periodStartDay の出現)」からちょうど1ヶ月前。
  const anchorAfterEnd = dateStringFromEpochDay(epochDayFromDateString(periodEnd) + 1);
  const anchorCivil = parseDateString(anchorAfterEnd);
  const periodStartMonth = addMonths(anchorCivil.year, anchorCivil.month, -1);
  const periodStart = formatDateString({ year: periodStartMonth.year, month: periodStartMonth.month, day: periodStartDay });

  return { periodStart, periodEnd };
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return { year: y, month: m };
}

export function calculateVariableTotals(
  days: DailyBreakdown[],
  workedSegments: Segment[],
  shifts: ShiftDay[],
  settingsTimeline: SettingsSpan[],
  lawTimeline: LawTimelineSpan[],
  period: { year: number; month: number },
): { totals: CategorizedMinutes; days: DailyBreakdown[]; variablePeriod: VariablePeriodSummary } {
  const periodStartDate = formatDateString({ year: period.year, month: period.month, day: 1 });
  const settingsAtPeriodMonthStart = findSettingsForDate(periodStartDate, settingsTimeline);
  // index.ts はこの関数を期間開始日の workSystem.kind === "monthly_variable" のときにしか
  // 呼ばないため、実際には常に monthly_variable(periodStartDay を持つ)。型安全のための
  // フォールバックのみ(到達しない、fixed.ts の fallbackStandardDayMinutes と同じ考え方)。
  const periodStartDay =
    settingsAtPeriodMonthStart.workSystem.kind === "monthly_variable"
      ? settingsAtPeriodMonthStart.workSystem.periodStartDay
      : 1;

  const { periodStart, periodEnd } = computeVariablePeriodRange(period, periodStartDay);

  // 判断点(上部コメント参照): periodStart の時点で実際に有効だった設定が monthly_variable
  // かつ同じ periodStartDay であることを確認できたときだけ、この期間を「完結した期間」として
  // 今月の締めに帰属させる。
  const settingsAtPeriodStart = findSettingsForDate(periodStart, settingsTimeline);
  const attributedToThisMonth =
    settingsAtPeriodStart.workSystem.kind === "monthly_variable" &&
    settingsAtPeriodStart.workSystem.periodStartDay === periodStartDay;

  const shiftMap = new Map(shifts.map((shift) => [shift.date, shift] as const));

  // --- ①②: period(締めている暦月)自身の全日について計算する。DailyBreakdown の出力対象。 ---
  const calcsThisMonth = computeMonthDayWeekCalc(period, workedSegments, shiftMap, settingsTimeline, lawTimeline);

  const resultDays = days.map((day) => {
    const c = calcsThisMonth.get(day.date);
    if (!c) return day;
    return {
      ...day,
      scheduledMinutes: c.scheduledMinutes,
      isLegalHoliday: c.isLegalHoliday,
      legalHolidayMinutes: c.legalHolidayMinutes,
      workedMinutes: c.workedMinutes,
      withinScheduledMinutes: c.withinScheduledMinutes,
      extraWithinStatutoryMinutes: c.extraWithinStatutoryMinutes,
      statutoryOvertimeMinutes: c.statutoryOvertimeMinutes,
    };
  });

  // --- ③: 変形期間全体([periodStart, periodEnd])の実労働・所定・①②既済み分を集計する。 ---
  // periodStart が period の前月に属する場合だけ、前月ぶんを独立して計算する
  // (前月自身の締めが計算するのと同じ値になるよう、前月をまるごと計算し直す。上部コメント参照)。
  const periodStartCivil = parseDateString(periodStart);
  const periodStartIsInThisMonth = periodStartCivil.year === period.year && periodStartCivil.month === period.month;
  const calcsPrevMonth = periodStartIsInThisMonth
    ? null
    : computeMonthDayWeekCalc(
        { year: periodStartCivil.year, month: periodStartCivil.month },
        workedSegments,
        shiftMap,
        settingsTimeline,
        lawTimeline,
      );

  let periodWorkedTotal = 0;
  let overtimeAlreadyAttributed = 0;
  let scheduledTotalMinutes = 0;
  let weeklyMinutesSum = 0;
  for (let d = epochDayFromDateString(periodStart); d <= epochDayFromDateString(periodEnd); d++) {
    const date = dateStringFromEpochDay(d);
    const civil = parseDateString(date);
    const isThisMonth = civil.year === period.year && civil.month === period.month;
    const c = isThisMonth ? calcsThisMonth.get(date) : calcsPrevMonth?.get(date);
    if (c) {
      periodWorkedTotal += c.workedMinutes;
      overtimeAlreadyAttributed += c.statutoryOvertimeMinutes;
      scheduledTotalMinutes += c.scheduledMinutes;
    }
    weeklyMinutesSum += findLawForDate(date, lawTimeline).weeklyStatutoryMinutes;
  }
  // flex.ts と同じ: 日ごとに7で割ると誤差が累積しうるため、合計してから最後に一度だけ割る。
  const statutoryFrameMinutes = Math.floor(weeklyMinutesSum / 7);
  const periodOvertimeMinutes = Math.max(0, periodWorkedTotal - overtimeAlreadyAttributed - statutoryFrameMinutes);

  const statutory = resultDays.reduce((sum, d) => sum + d.withinScheduledMinutes + d.extraWithinStatutoryMinutes, 0);
  const overtimeFromDays = resultDays.reduce((sum, d) => sum + d.statutoryOvertimeMinutes, 0);
  const overtime = overtimeFromDays + (attributedToThisMonth ? periodOvertimeMinutes : 0);

  // 60時間超区分の閾値は月単位の値であり、fixed.ts/flex.ts と同じく期間開始日(= period の月初)の版を使う。
  const periodStartLaw = findLawForDate(periodStartDate, lawTimeline);
  const overtime60h = periodStartLaw.overtime60h.enabled
    ? Math.max(0, overtime - periodStartLaw.overtime60h.thresholdMinutes)
    : 0;
  const lateNight = resultDays.reduce((sum, d) => sum + d.lateNightMinutes, 0);
  const statutoryHoliday = resultDays.reduce((sum, d) => sum + d.legalHolidayMinutes, 0);

  return {
    totals: { statutory, overtime, overtime60h, lateNight, statutoryHoliday },
    days: resultDays,
    variablePeriod: {
      periodStart,
      periodEnd,
      statutoryFrameMinutes,
      scheduledTotalMinutes,
      workedTotalMinutes: periodWorkedTotal,
      periodOvertimeMinutes,
      attributedToThisMonth,
    },
  };
}
