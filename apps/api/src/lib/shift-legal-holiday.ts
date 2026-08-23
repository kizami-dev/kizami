/**
 * シフト確定(POST /shifts/plans/:id/publish)時の法定休日充足チェック
 * (docs/design/shift-work.md「法定休日の扱い」: 週1日、または4週4日の変形休日制)。
 *
 * エンジン(packages/engine)側はこの検証を実装していない(「エンジン側は未実装なので
 * ここで担う」— v0.7 フェーズ1 実装フェーズの分担どおり)。ここは純粋な検証ロジックとして
 * apps/api 側に置く。
 *
 * 判断点(完了報告に明記、独自判断): 労基法35条2項は「4週間を通じ4日以上の休日を与える
 * 就業規則等の定めがある場合」に週1日の原則の例外を認める仕組みで、本来は「4週の起算日」を
 * 就業規則で固定する制度だが、KIZAMI は起算日を別途持たない。ここでは変形期間そのもの
 * (`periodStart`〜`periodEnd`、28〜31日)を検証対象とし:
 *
 * 1. `periodStart` を起点に7日ずつ区切った「完全な週」(端数の残り日数は対象外)それぞれに
 *    legal_holiday が1日以上あれば「週1日」を満たすとみなす
 * 2. 1で満たさない場合、`periodStart` を起点に4週間(28日)の連続窓をスライドさせ、
 *    いずれかの窓に legal_holiday が4日以上あれば「4週4日」を満たすとみなす
 *    (periodStartDay は1〜28に制限されているため変形期間は必ず28日以上あり、
 *    この窓は必ず1つ以上取れる)
 *
 * どちらも満たさなければ不足として扱う(呼び出し側は 409 legal_holiday_shortage)。
 * シフトが登録されていない日(missing_shift)は legal_holiday として数えない
 * (エンジンの `missing_shift` 警告と同じ「シフト不在は保守的に扱う」考え方)。
 */

export interface LegalHolidayCheckDay {
  date: string;
  dayType: string;
}

const DAYS_PER_WEEK = 7;
const WEEKS_FOR_ALTERNATIVE = 4;
const MIN_LEGAL_HOLIDAYS_PER_WEEK = 1;
const MIN_LEGAL_HOLIDAYS_PER_4_WEEKS = 4;

/** [periodStart, periodEnd] の日付配列("YYYY-MM-DD"、連続・昇順)を組み立てる。 */
function dateRangeInclusive(fromEpochDay: number, toEpochDay: number, dateFromEpochDay: (epochDay: number) => string): string[] {
  const dates: string[] = [];
  for (let d = fromEpochDay; d <= toEpochDay; d++) {
    dates.push(dateFromEpochDay(d));
  }
  return dates;
}

/**
 * 変形期間([periodStart, periodEnd])の shift_days から法定休日充足を判定する。
 * `days` は当該期間の有効な shift_days のみを渡すこと(呼び出し側 = queries/shifts.ts の
 * listValidShiftDaysForPlan)。日付順は問わない。
 */
export function hasSufficientLegalHolidays(params: {
  days: LegalHolidayCheckDay[];
  periodStart: string;
  periodEnd: string;
  epochDayFromDate: (date: string) => number;
  dateFromEpochDay: (epochDay: number) => string;
}): boolean {
  const { days, periodStart, periodEnd, epochDayFromDate, dateFromEpochDay } = params;

  const legalHolidayDates = new Set(days.filter((d) => d.dayType === "legal_holiday").map((d) => d.date));

  const fromEpochDay = epochDayFromDate(periodStart);
  const toEpochDay = epochDayFromDate(periodEnd);
  const periodDates = dateRangeInclusive(fromEpochDay, toEpochDay, dateFromEpochDay);

  // ---- 1. 週1日: periodStart 起点の完全な7日区切りをすべて満たすか ----
  const fullWeekCount = Math.floor(periodDates.length / DAYS_PER_WEEK);
  let weeklyOk = fullWeekCount > 0;
  for (let w = 0; w < fullWeekCount && weeklyOk; w++) {
    const weekDates = periodDates.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK);
    const count = weekDates.filter((d) => legalHolidayDates.has(d)).length;
    if (count < MIN_LEGAL_HOLIDAYS_PER_WEEK) weeklyOk = false;
  }
  if (weeklyOk) return true;

  // ---- 2. 4週4日: periodStart 起点の28日連続窓をスライドさせ、いずれかが4日以上を満たすか ----
  const windowSize = DAYS_PER_WEEK * WEEKS_FOR_ALTERNATIVE;
  if (periodDates.length < windowSize) return false;
  for (let start = 0; start + windowSize <= periodDates.length; start++) {
    const windowDates = periodDates.slice(start, start + windowSize);
    const count = windowDates.filter((d) => legalHolidayDates.has(d)).length;
    if (count >= MIN_LEGAL_HOLIDAYS_PER_4_WEEKS) return true;
  }

  return false;
}
