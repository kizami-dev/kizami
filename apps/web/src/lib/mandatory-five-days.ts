/**
 * 年5日取得義務の表示用の仕分け(判定そのものは API 側。ここは「いつの分を見せるか」だけを決める)。
 *
 * - `deadline`(= periodEnd)は排他的上限なので、today >= deadline の期間は「期限切れ」。
 * - 期限切れで未達のものは件数だけにまとめ、達成済みの過去分は表示しない。
 * - 開始前の期間(periodStart > today)は「次の期間」。要対応の対象にはしない。
 */
import type { MandatoryFiveDaysStatusDto } from "./api";

export interface MandatoryFiveDaysSplit {
  /** 今の期間(開始済みで期限前)。 */
  current: MandatoryFiveDaysStatusDto[];
  /** まだ始まっていない期間。 */
  upcoming: MandatoryFiveDaysStatusDto[];
  /** 期限が過ぎて未達のまま残っているもの(新しい順)。 */
  expiredShortages: MandatoryFiveDaysStatusDto[];
}

export function splitMandatoryFiveDays(list: readonly MandatoryFiveDaysStatusDto[], today: string): MandatoryFiveDaysSplit {
  const current: MandatoryFiveDaysStatusDto[] = [];
  const upcoming: MandatoryFiveDaysStatusDto[] = [];
  const expiredShortages: MandatoryFiveDaysStatusDto[] = [];
  for (const m of list) {
    if (m.deadline <= today) {
      if (!m.satisfied) expiredShortages.push(m);
    } else if (m.periodStart > today) {
      upcoming.push(m);
    } else {
      current.push(m);
    }
  }
  expiredShortages.sort((a, b) => (a.deadline < b.deadline ? 1 : -1));
  return { current, upcoming, expiredShortages };
}
