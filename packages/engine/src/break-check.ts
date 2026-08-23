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
 *
 * 判定の単位は「チェーン」(2026-08-23 改定, docs/design/breaks.md):
 * - 退勤済みの勤務区間(`WorkStretch`)を、**開始時刻(clockInAt)が属する勤怠日**
 *   (`resolveAttendanceDate`)でグループ化したものを1つのチェーンとして合算判定する。
 * - 旧来は勤務区間(WorkStretch)単独で判定していたが、それでは「6時間半勤務 → 1.5時間の
 *   中抜け → 1時間勤務」という日に最初の区間だけを見て違反にしてしまう。しかし中抜けの
 *   空白は労働から完全に解放された時間であり、実態として休憩の役割を果たしている
 *   (打刻上「休憩」として記録されていないだけ)。チェーン化はこの過剰検知を防ぐ。
 * - 日界をまたぐ夜勤(例: 22:00出勤〜翌7:00退勤)は1つの区間として開始日のチェーンに
 *   丸ごと属し、勤怠日で分割されない。34条は継続した勤務に対する義務であり、日界で
 *   分割すると8時間の勤務が「2時間の日」と「6時間の日」に分かれ、どちらの日を見ても
 *   休憩義務が発生しない(=法違反を見落とす)。この保護はチェーン化後も維持される
 *   (夜勤の区間はそもそも1つの WorkStretch であり、グループ化の対象は区間そのものであって
 *   区間の内部を勤怠日で割ることはしないため)。
 *
 * チェーン内の実労働・休憩:
 * - 実労働 = チェーン内の各区間の workedMinutes(自動控除適用後)の合計。
 * - 休憩 = 各区間の breakMinutes の合計(呼び出し側 index.ts が打刻休憩+自動控除を
 *   合算した値を渡す)+ **区間と区間の間の空白**(前の区間の clockOutAt から次の区間の
 *   clockInAt までの分数)。
 * - 空白は区間「間」だけを数え、**チェーン最後の区間の後(退勤後)の空白は数えない**。
 *   34条1項が求めるのは「労働時間の途中」に与える休憩であり、最後の区間の後は帰宅であって
 *   休憩ではない。区間「間」だけを算入する設計は、この途中性の要件を構造的に満たす
 *   (休憩の "位置" までは判定しないスコープ外の要件だが、少なくとも末尾の空白を
 *   誤って休憩に含める過ちは構造的に起こらない)。
 * - 日をまたぐ空白(ある日の退勤〜翌日の出勤の間)はチェーン化の時点でそもそも発生しない。
 *   別の勤怠日は別のチェーンだからである。これは意図的な設計であり、勤務間インターバル
 *   (次の勤務までの休息時間)を34条の休憩と混同しないためのもの。両者は法的に別概念であり、
 *   「翌日の勤務まで12時間あったから今日の休憩は足りている」という判定は誤りになる。
 * - 「労働時間の途中に与える」(休憩が区間の先頭・末尾に寄っていないか)という要件自体は
 *   引き続きスコープ外。休憩の合計分数のみで判定し、位置は見ない。
 *
 * 法令(law)の解決はチェーンの勤怠日(= グループのキー、チェーン内で最初に出勤した区間の
 * 開始日)で行う。警告の `date` も同じくチェーンの勤怠日。
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

  // 未退勤(missing_clock_out で discard された区間)は workedMinutes/breakMinutes が
  // null になっており、実労働・休憩とも確定していないため判定対象に含めない。
  //
  // グループ化の key は「区間の開始日(clockInAt の勤怠日)」。日界をまたぐ区間の途中で
  // 施行日を迎える稀なケースは、区間全体を1つの継続した勤務とみなし開始日基準に倒す
  // (終了日基準にすると、退勤を少し遅らせるだけで適用法令が変わってしまい、打刻の
  // タイミング次第で判定が揺れるため。settingsTimeline の日界解決や auto-break.ts の
  // ルール解決と同じ「開始日でまるごと帰属させる」考え方に揃えている)。
  const chains = new Map<string, WorkStretch[]>();
  for (const stretch of stretches) {
    if (stretch.workedMinutes === null || stretch.breakMinutes === null) continue;
    const { date } = resolveAttendanceDate(stretch.clockInAt, settingsTimeline);
    const group = chains.get(date);
    if (group) {
      group.push(stretch);
    } else {
      chains.set(date, [stretch]);
    }
  }

  for (const [date, rawChain] of chains) {
    if (!isInPeriod(date, period)) continue;

    // 区間間の空白を正しく算出するため、念のため開始時刻の昇順に整列する
    // (通常 stretches は既に時系列順で渡されるが、この関数はその前提に依存し切らない)。
    const chain = [...rawChain].sort((a, b) => a.clockInAt - b.clockInAt);

    const law = findLawForDate(date, lawTimeline);

    const worked = chain.reduce((sum, s) => sum + (s.workedMinutes as number), 0);

    let breakMinutesTotal = chain.reduce((sum, s) => sum + (s.breakMinutes as number), 0);
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const curr = chain[i];
      if (!prev || !curr) continue;
      // prev は退勤済み区間(フィルタ済み)なので clockOutAt は必ず number。
      breakMinutesTotal += curr.clockInAt - (prev.clockOutAt as number);
    }

    // 該当する要件(チェーンの実労働が overMinutes を厳密に超えているもの)のうち、
    // 最も厳しい(minimumMinutes が最大の)ものを必要休憩とする。
    const applicable = law.breakRequirements.filter((requirement) => worked > requirement.overMinutes);
    if (applicable.length === 0) continue;
    const requiredMinutes = applicable.reduce(
      (max, requirement) => Math.max(max, requirement.minimumMinutes),
      0,
    );

    // chains は空配列を値に持つことがない(必ず1件以上 push してから Map に入る)ため、
    // chain[0] は必ず存在する。
    const firstStretch = chain[0];
    if (firstStretch && breakMinutesTotal < requiredMinutes) {
      warnings.push({
        kind: "insufficient_break",
        date,
        // チェーン内で最初に出勤した区間の時刻を代表点として使う。
        punchAt: firstStretch.clockInAt,
        break: { requiredMinutes, actualMinutes: breakMinutesTotal },
      });
    }
  }

  return warnings;
}
