/**
 * コアタイムの予実乖離警告(労基法32条の3、docs/design/work-systems.md「コアタイム」)。
 *
 * フレックスタイム制の**任意**設定であるコアタイム(必ず勤務すべき時間帯)と、打刻由来の
 * 実績(`DailyBreakdown`)を突き合わせ、乖離を警告として出す。
 * 集計(totals・flexBalance)には一切反映しない — コアタイム中の不在は制度上「遅刻・早退」
 * として扱えるが、フレックスの時間外は**清算期間の総枠との差でしか決まらない**ため、
 * コアタイムを外れても労働時間は1分も増減しないからである。賃金控除を行うかどうかは
 * 給与側の責任(shift-variance.ts・docs/design/breaks.md と同じ「計測と警告のみ」の原則)。
 *
 * 呼び出し側の契約: `days` は `period`(締めている暦月)の日のみを渡すこと
 * (`buildDailyBreakdown` の出力をそのまま渡す想定)。判定はすべて「その日」単体で完結する。
 * 呼び出しは `calculate` のフレックス分岐からのみ行う — コアタイムは `WorkSystem` の
 * flex 分岐にしか存在しない概念のため。
 *
 * コアタイムが「適用される日」(判断点):
 * - その日に有効な設定が flex でない、または `core` が null → 対象外(警告を一切出さない)
 * - 法定休日(`day.isLegalHoliday`)→ 対象外。法定休日に働くこと自体が例外であり、
 *   そこにコアタイムの遅刻・早退を重ねて言うのは意味を持たない
 * - `core.weekdays`(省略時は月〜金)に含まれない曜日 → 対象外。フレックスには
 *   「所定労働日カレンダー」が無いため、所定休日(土曜など)をここで区別する
 *   (types.ts の `CoreTime.weekdays` の判断点コメント参照)
 * - 有給を取得した日(`day.isPaidLeave`)→ 対象外。全休はもちろん、時間単位年休で
 *   コアタイムの一部を休んだ場合も「承認済みの不在」であり遅刻・早退ではない。
 *   何分ぶん休んだかとコアタイムの重なりを厳密に見ることもできるが、有給は分数しか
 *   持たず(取得した時間帯を持たない)重なりを判定できないため、日単位で丸ごと除外する
 *   という保守的な(誤報を出さない側の)扱いにしている
 * - `core` の帯が成立しない値(endMinutes <= startMinutes)→ 対象外。日跨ぎのコアタイムは
 *   制度前提として持たない(types.ts の `CoreTime` 参照)。apps/api が 400 で弾くが、
 *   エンジンとしても「帯が無い」とみなして黙って何も出さない
 *
 * 判定の詳細:
 * - core_time_late_arrival / core_time_early_leave: 最初の出勤(`day.stretches` の最小
 *   clockInAt)がコアタイム開始より遅い / 最後の退勤(退勤済み stretch の最大 clockOutAt)が
 *   コアタイム終了より早い。中抜け(コアタイム中の一時退出)は検知しない — first-in/last-out
 *   だけを見る shift-variance.ts と同じ流儀に揃えた(中抜けの是非は休憩ルールの領分であり、
 *   コアタイムの警告としては「その日コアタイムの端に居なかった」ことが分かれば足りる)
 * - core_time_absence: 対象日に実労働が0分。`asOfDate` 以降(当日を含む)は出さない —
 *   まだ来ていない日・進行中の当日に「不在です」と警告するのは誤報
 *   (shift_absence と同じ扱い、`EngineInput.asOfDate` のコメント参照)
 *
 * 比較は shift-variance.ts と同様、`utcMinutesFromLocalDateTime` でエポック分に変換してから
 * 行う(tzOffsetMinutes は timeline を通じて不変という前提のもと、固定オフセットのみを扱う
 * date.ts の設計に沿う)。
 */

import { epochDayFromDateString, findSettingsForDate, utcMinutesFromLocalDateTime, weekdayFromEpochDay } from "./date.js";
import type { CalcWarning, CoreTime, DailyBreakdown, PlainDateString, SettingsSpan } from "./types.js";

/** `CoreTime.weekdays` を省略したときに適用される曜日(月〜金)。 */
const DEFAULT_CORE_WEEKDAYS: ReadonlyArray<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5];

function hourMinuteFromMinutesOfDay(totalMinutes: number): { hour: number; minute: number } {
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

/** その日にコアタイムが適用されるか(上記「適用される日」の判定)。適用されるなら帯を返す。 */
function resolveCoreTimeForDate(date: PlainDateString, day: DailyBreakdown, settingsTimeline: SettingsSpan[]): CoreTime | null {
  const { workSystem } = findSettingsForDate(date, settingsTimeline);
  if (workSystem.kind !== "flex" || workSystem.core === null) return null;

  const core = workSystem.core;
  // 帯として成立しない値(日跨ぎ・ゼロ幅)は「コアタイムなし」と同じ扱いにする。
  if (core.endMinutes <= core.startMinutes) return null;

  if (day.isLegalHoliday) return null;
  if (day.isPaidLeave) return null;

  const weekdays = core.weekdays ?? DEFAULT_CORE_WEEKDAYS;
  if (!weekdays.includes(weekdayFromEpochDay(epochDayFromDateString(date)))) return null;

  return core;
}

export function computeCoreTimeWarnings(
  days: DailyBreakdown[],
  settingsTimeline: SettingsSpan[],
  asOfDate?: PlainDateString,
): CalcWarning[] {
  const warnings: CalcWarning[] = [];

  for (const day of days) {
    const core = resolveCoreTimeForDate(day.date, day, settingsTimeline);
    if (!core) continue;

    // 法定休日は上で除外済みなので、その日の実労働は workedMinutes に出そろっている。
    if (day.workedMinutes === 0) {
      // 基準日以降(当日含む)はまだ不在と断定できない(EngineInput.asOfDate のコメント参照)。
      const isFutureOrToday = asOfDate !== undefined && day.date >= asOfDate;
      if (!isFutureOrToday) {
        warnings.push({
          kind: "core_time_absence",
          date: day.date,
          core: { deltaMinutes: core.endMinutes - core.startMinutes },
        });
      }
      continue;
    }

    if (day.stretches.length === 0) continue; // 実労働はあるが打刻区間が取れない(理論上想定しない)

    const settings = findSettingsForDate(day.date, settingsTimeline);
    const coreStartAt = utcMinutesFromLocalDateTime(day.date, hourMinuteFromMinutesOfDay(core.startMinutes), settings.tzOffsetMinutes);
    const coreEndAt = utcMinutesFromLocalDateTime(day.date, hourMinuteFromMinutesOfDay(core.endMinutes), settings.tzOffsetMinutes);

    const firstClockIn = day.stretches.reduce((min, stretch) => Math.min(min, stretch.clockInAt), Number.POSITIVE_INFINITY);
    const completedStretches = day.stretches.filter(
      (stretch): stretch is typeof stretch & { clockOutAt: number } => stretch.clockOutAt !== null,
    );
    const lastClockOut =
      completedStretches.length > 0
        ? completedStretches.reduce((max, stretch) => Math.max(max, stretch.clockOutAt), Number.NEGATIVE_INFINITY)
        : null;

    // ちょうどコアタイム開始に出勤 / ちょうど終了に退勤は遅刻・早退ではない(厳密な不等号)。
    if (firstClockIn > coreStartAt) {
      warnings.push({
        kind: "core_time_late_arrival",
        date: day.date,
        punchAt: firstClockIn,
        // コアタイム全体より遅く出勤した場合でも、不在だったのはコアタイムの長さまで
        // (帯の外側は遅刻ではない)。上限で丸める。
        core: { deltaMinutes: Math.min(firstClockIn - coreStartAt, coreEndAt - coreStartAt) },
      });
    }
    if (lastClockOut !== null && lastClockOut < coreEndAt) {
      warnings.push({
        kind: "core_time_early_leave",
        date: day.date,
        punchAt: lastClockOut,
        core: { deltaMinutes: Math.min(coreEndAt - lastClockOut, coreEndAt - coreStartAt) },
      });
    }
  }

  return warnings;
}
