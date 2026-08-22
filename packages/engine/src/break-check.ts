/**
 * 休憩不足の検知(労基法34条1項)。
 *
 * 労基法34条1項は、労働時間が6時間を超える場合に45分以上、8時間を超える場合に60分以上の
 * 休憩を労働時間の途中に与えることを義務づけている。KIZAMI は休憩の打刻を実労働から
 * 控除してきたが、それだけでは「休憩を取っていないので実労働が長い」という事実は出ても、
 * それ自体が法違反であることには誰も気づけない。本モジュールはその不足を警告として検知する。
 *
 * 法令解釈(この通りに実装する):
 * - 判定に使う「労働時間」は実労働時間(休憩控除後)である。拘束時間ではない。これが通説。
 * - 「超える」は厳密な超過。実労働ちょうど6時間0分・8時間0分では義務は発生しない
 *   (6時間1分から45分、8時間1分から60分)。`law.breakRequirements` の `overMinutes` との
 *   比較は `>`(以上ではなく超過)で行う。
 * - 判定の単位は「勤務区間」(出勤〜退勤の1まとまり、`WorkStretch`)であって勤怠日ではない。
 *   34条は継続した勤務に対する義務であり、日界をまたぐ夜勤(例: 22:00出勤〜翌7:00退勤)を
 *   勤怠日で分割して判定すると、実労働8時間の勤務が「2時間の日」と「6時間の日」に
 *   分かれてしまい、どちらの日を見ても休憩義務が発生しない(=法違反を見落とす)。
 *   これは実際に起きうる見落としであり、区間単位で判定することで防ぐ。
 * - 「労働時間の途中に与える」(休憩が勤務の先頭・末尾に寄っていないか)という要件は
 *   スコープ外。休憩の合計分数のみで判定し、位置は見ない。
 */

import { findLawForDate, isInPeriod, resolveAttendanceDate } from "./date.js";
import type { CalcWarning, LawTimelineSpan, SettingsSpan, WorkStretch } from "./types.js";

export function checkBreakSufficiency(
  stretches: WorkStretch[],
  settingsTimeline: SettingsSpan[],
  lawTimeline: LawTimelineSpan[],
  period: { year: number; month: number },
): CalcWarning[] {
  const warnings: CalcWarning[] = [];

  for (const stretch of stretches) {
    // 未退勤(missing_clock_out で discard された区間)は workedMinutes/breakMinutes が
    // null になっており、実労働・休憩とも確定していないため判定しない。
    if (stretch.workedMinutes === null || stretch.breakMinutes === null) continue;

    // law は区間の開始日(clockInAt の勤怠日)で解決する。日界をまたぐ区間の途中で
    // 施行日を迎える稀なケースは、区間全体を1つの継続した勤務とみなし開始日基準に倒す
    // (終了日基準にすると、退勤を少し遅らせるだけで適用法令が変わってしまい、
    // 打刻のタイミング次第で判定が揺れるため。settingsTimeline の日界解決と同じ
    // 「開始日でまるごと帰属させる」考え方は daily.ts の stretch 配賦とも揃っている)。
    const { date } = resolveAttendanceDate(stretch.clockInAt, settingsTimeline);
    if (!isInPeriod(date, period)) continue;

    const law = findLawForDate(date, lawTimeline);
    const worked = stretch.workedMinutes;

    // 該当する要件(実労働が overMinutes を厳密に超えているもの)のうち、
    // 最も厳しい(minimumMinutes が最大の)ものを必要休憩とする。
    const applicable = law.breakRequirements.filter((requirement) => worked > requirement.overMinutes);
    if (applicable.length === 0) continue;
    const requiredMinutes = applicable.reduce(
      (max, requirement) => Math.max(max, requirement.minimumMinutes),
      0,
    );

    if (stretch.breakMinutes < requiredMinutes) {
      warnings.push({
        kind: "insufficient_break",
        date,
        punchAt: stretch.clockInAt,
        break: { requiredMinutes, actualMinutes: stretch.breakMinutes },
      });
    }
  }

  return warnings;
}
