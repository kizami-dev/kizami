/**
 * 固定時間制(通常の労働時間制)集計(labor law §32条・§37条)。
 *
 * フレックス(flex.ts)は「月の総枠との過不足」で時間外が決まるが、固定時間制は
 * 日単位・週単位の積み上げで決まる点が根本的に違う:
 *
 * - 日次法定時間外 = max(0, 実労働 − law.dailyStatutoryMinutes)。1日8時間(労基法32条2項)。
 *   特例措置対象事業場でも変わらない(緩和されるのは週の方だけ。`@kizami/law` 参照)
 * - 週次法定時間外 = 週内の「日次法定時間外を除いた実労働(withinStatutory)」の累積が
 *   law.weeklyStatutoryMinutes を超えた分。**必ず日次を引いた後の値**を週次判定に使うことで、
 *   同じ時間を日次・週次の両方でカウントする二重計上を防ぐ(要件の計算順序どおり)
 * - 所定外法定内(法定内残業)= 所定労働時間(standardDayMinutes)を超えるが1日8時間以内の部分。
 *   割増賃金の義務はないが賃金は発生するため、法定時間外(統計上の overtime)とは区別して
 *   `extraWithinStatutoryMinutes` に分けて表示する
 * - 法定休日の労働は日次/週次の判定から除外する。daily.ts が法定休日の `workedMinutes` を
 *   既に 0 にしているため、本ファイルでは改めて分岐せずとも自然に除外される
 *   (0分の実労働は日次時間外・週次累積のどちらにも寄与しない)
 *
 * 判断点(独自判断):
 * - 週のグループ化に使う起算曜日(`weekStartWeekday`)は、flex.ts が月枠の閾値系の値を
 *   期間開始日基準で決め打ちにしているのと同じ流儀で、期間開始日の設定から1つだけ解決し
 *   期間全体に適用する。月の途中で `weekStartWeekday` 自体が変わる設定変更は想定していない
 * - 月をまたぐ週(例: 4/1が水曜起算の週の3日目)は、この月の期間内の日だけで週次判定する。
 *   前月分の実労働を引きずって週次判定はしない — 月次締めの独立性を優先する割り切り。
 *   その結果、月初の週は法定週40時間に届く前に月が終わることが多く、週次法定時間外が
 *   実態よりやや出にくい方向に振れる(保守的というより「その月だけ見れば正しい」計算)
 * - 有給は totals に加えない。固定時間制の有給は「所定労働日の欠勤を打ち消す」だけで
 *   実労働時間ではないため、日次/週次の時間外判定にはそもそも関与しない。
 *   フレックス(flex.ts)は月の総枠に対する過不足を測るため有給を実績に算入する必要があるが、
 *   固定時間制は「その日実際に働いた時間」がそのまま閾値と比較されるため算入対象が異なる
 *   (呼び出し側との対称性のため引数は受け取るが、本関数内では使わない)
 */

import {
  epochDayFromDateString,
  findLawForDate,
  findSettingsForDate,
  formatDateString,
  weekdayFromEpochDay,
} from "./date.js";
import type {
  CategorizedMinutes,
  DailyBreakdown,
  LawTimelineSpan,
  PaidLeaveEntry,
  PlainDateString,
  SettingsSpan,
} from "./types.js";

export function calculateFixedTotals(
  days: DailyBreakdown[],
  settingsTimeline: SettingsSpan[],
  lawTimeline: LawTimelineSpan[],
  period: { year: number; month: number },
  _paidLeave: PaidLeaveEntry[],
): { totals: CategorizedMinutes; days: DailyBreakdown[] } {
  const dayMap = new Map<PlainDateString, DailyBreakdown>();

  // 期間途中で労働時間制が混在する場合(mixed_work_system 警告)に使う所定労働時間。
  // index.ts が「期間開始日の版で月全体を計算する」方針なので、所定労働時間もそこに揃える。
  // 0 に倒すと所定内が丸ごと消えて全量が所定外法定内に振られ、警告付きとはいえ実態から
  // 大きく外れた明細になるため。
  const periodStartSettings = findSettingsForDate(
    formatDateString({ year: period.year, month: period.month, day: 1 }),
    settingsTimeline,
  );
  // index.ts はこの関数を期間開始日の workSystem.kind === "fixed" のときにしか呼ばないため、
  // periodStartSettings.workSystem は実際には常に fixed(standardDayMinutes を持つ)。
  // ただし WorkSystem は flex/fixed/monthly_variable の3分岐で、monthly_variable は
  // standardDayMinutes を持たないため、型上は絞り込みが要る(到達しないフォールバック)。
  const fallbackStandardDayMinutes =
    periodStartSettings.workSystem.kind === "monthly_variable" ? 0 : periodStartSettings.workSystem.standardDayMinutes;

  // --- 第1パス: 日次法定時間外(§32条2項、1日8時間) -------------------------------------
  for (const day of days) {
    if (day.isLegalHoliday) {
      // 法定休日は日次/週次の判定から除外(既に workedMinutes = 0 になっている)
      dayMap.set(day.date, day);
      continue;
    }
    const settings = findSettingsForDate(day.date, settingsTimeline);
    const law = findLawForDate(day.date, lawTimeline);
    const standardDayMinutes =
      settings.workSystem.kind === "fixed" ? settings.workSystem.standardDayMinutes : fallbackStandardDayMinutes;

    const dailyOvertime = Math.max(0, day.workedMinutes - law.dailyStatutoryMinutes);
    const withinStatutory = day.workedMinutes - dailyOvertime;
    const withinScheduled = Math.min(withinStatutory, standardDayMinutes);
    const extraWithinStatutory = withinStatutory - withinScheduled;

    dayMap.set(day.date, {
      ...day,
      withinScheduledMinutes: withinScheduled,
      extraWithinStatutoryMinutes: extraWithinStatutory,
      // 週次パスでここに週次超過分を加算していく
      statutoryOvertimeMinutes: dailyOvertime,
    });
  }

  // --- 第2パス: 週次法定時間外(§32条1項、原則週40h/特例週44h) -----------------------------
  const periodStartDate = formatDateString({ year: period.year, month: period.month, day: 1 });
  const weekStartWeekday = findSettingsForDate(periodStartDate, settingsTimeline).weekStartWeekday;

  // 週開始日(epoch日、月をまたいでもキーとして機能する)ごとに、この期間内の日付だけをまとめる。
  // days は日付昇順なので、そのまま push すれば各グループ内も昇順のまま。
  const weekGroups = new Map<number, PlainDateString[]>();
  for (const day of days) {
    const epochDay = epochDayFromDateString(day.date);
    const weekday = weekdayFromEpochDay(epochDay);
    const weekStartEpochDay = epochDay - ((weekday - weekStartWeekday + 7) % 7);
    const list = weekGroups.get(weekStartEpochDay);
    if (list) {
      list.push(day.date);
    } else {
      weekGroups.set(weekStartEpochDay, [day.date]);
    }
  }

  for (const dateList of weekGroups.values()) {
    let cumulativeWithinStatutory = 0;
    for (const date of dateList) {
      const day = dayMap.get(date);
      if (!day) continue;
      const law = findLawForDate(date, lawTimeline);
      const dayWithinStatutory = day.withinScheduledMinutes + day.extraWithinStatutoryMinutes;

      const priorCumulative = cumulativeWithinStatutory;
      cumulativeWithinStatutory += dayWithinStatutory;

      // 「この日を加えたことで週法定を超えた分」だけをこの日に帰属させる
      // (既に前日までで超えていれば、この日の withinStatutory は丸ごと週次時間外になる)
      const weeklyOvertimeForDay =
        Math.max(0, cumulativeWithinStatutory - law.weeklyStatutoryMinutes) -
        Math.max(0, priorCumulative - law.weeklyStatutoryMinutes);
      if (weeklyOvertimeForDay <= 0) continue;

      // 後ろ側(所定外法定内 → 所定内)の順で削って週次時間外へ移す(日次と同じ二重計上防止の考え方)
      let remaining = weeklyOvertimeForDay;
      const reduceExtra = Math.min(remaining, day.extraWithinStatutoryMinutes);
      remaining -= reduceExtra;
      const reduceScheduled = Math.min(remaining, day.withinScheduledMinutes);
      remaining -= reduceScheduled;

      dayMap.set(date, {
        ...day,
        extraWithinStatutoryMinutes: day.extraWithinStatutoryMinutes - reduceExtra,
        withinScheduledMinutes: day.withinScheduledMinutes - reduceScheduled,
        statutoryOvertimeMinutes: day.statutoryOvertimeMinutes + weeklyOvertimeForDay,
      });
    }
  }

  const resultDays = days.map((day) => dayMap.get(day.date) ?? day);

  const statutory = resultDays.reduce((sum, d) => sum + d.withinScheduledMinutes + d.extraWithinStatutoryMinutes, 0);
  const overtime = resultDays.reduce((sum, d) => sum + d.statutoryOvertimeMinutes, 0);
  // 60時間超区分の閾値は月単位の値であり日ごとに解決する対象ではないため、
  // flex.ts と同じ流儀で期間開始日の版を使う
  const periodStartLaw = findLawForDate(periodStartDate, lawTimeline);
  const overtime60h = periodStartLaw.overtime60h.enabled
    ? Math.max(0, overtime - periodStartLaw.overtime60h.thresholdMinutes)
    : 0;
  const lateNight = resultDays.reduce((sum, d) => sum + d.lateNightMinutes, 0);
  const statutoryHoliday = resultDays.reduce((sum, d) => sum + d.legalHolidayMinutes, 0);

  return {
    totals: { statutory, overtime, overtime60h, lateNight, statutoryHoliday },
    days: resultDays,
  };
}
