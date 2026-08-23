/**
 * 休憩の自動控除(docs/design/breaks.md「採る設計: 集計時に控除し、打ち消しは独立した申請」)。
 *
 * 打刻イベントは一切生成しない。deriveSegments が確定させた `workedSegments`/`stretches` に対する
 * 後段の純粋な変換として実装する(deriveSegments 自体の打刻解釈・警告ロジックには関与しない)。
 *
 * 判定・控除の単位は「勤務区間」(`WorkStretch`)である。日界をまたぐ夜勤を勤怠日で割ると
 * 閾値判定を誤るため(この点は break-check.ts と同じ理由)。適用する `breakRule` は
 * 区間の開始日(clockInAt の勤怠日)の設定で解決する — settingsTimeline の日界解決・
 * break-check.ts の law 解決と同じ「開始日でまるごと帰属させる」考え方に揃えている。
 *
 * 単位が break-check.ts と非対称であることについて(2026-08-23, breaks.md):
 * break-check.ts の休憩不足検知は同一勤怠日の区間群を「チェーン」として合算するように
 * なったが、この自動控除の判定単位は区間のまま据え置いている。意図的な非対称であり、
 * 矛盾ではない —
 * - 自動控除は「打刻がなくても休憩を取れたはず」とみなして実労働を機械的に削る、
 *   危険な機能である(breaks.md「自動控除は便利機能ではなく危険な機能」)。控除の可否は
 *   各区間が単独で閾値を満たすかどうかで厳密に判定すべきで、他区間の空白を借りて
 *   「合算すれば閾値を超えるから控除する」という判断はしない(過少申告側に倒れる方向の
 *   拡大解釈になるため)。
 * - 一方で休憩不足検知は労働者保護のための検知であり、実態(中抜けの空白は労働からの
 *   解放である)を広く捉える方向にチェーンで合算する。
 * - この非対称の帰結: 4時間+中抜け+4時間の日は、各区間が deductMinutes の overMinutes
 *   閾値に届かないため、どちらの区間にも自動控除はかからない(中抜けの空白そのものが
 *   休憩の役割を担っており、それ以上機械的に削る必要がない)。一方 break-check.ts 側は
 *   チェーンで合算するため、この中抜けの空白は休憩不足判定ではちゃんと休憩として
 *   算入される。「自動控除は保守的に区間単位のまま・休憩不足検知は実態を捉えるため
 *   チェーン単位」という使い分けは、それぞれの目的(過少申告の防止 / 過剰検知の防止)に
 *   応じた選択である。
 */

import { resolveAttendanceDate } from "./date.js";
import type { Segment } from "./derive.js";
import type { AutoBreakRule, BreakRule, PlainDateString, SettingsSpan, WorkStretch } from "./types.js";

export interface AutoBreakDeductionResult {
  /** 自動控除の tail-cut を反映した後の workedSegments(punch 由来の休憩は既に除外済み) */
  workedSegments: Segment[];
  /**
   * 自動控除によって workedSegments から取り除かれた区間(punch の breakSegments には含めない)。
   * daily.ts が breakSegments と同じ要領で勤怠日に配賦し、DailyBreakdown.autoDeductedBreakMinutes を作る。
   */
  autoDeductedSegments: Segment[];
  /** workedMinutes(控除後)・autoDeductedBreakMinutes を更新した stretches */
  stretches: WorkStretch[];
}

/**
 * ルール1件の「実際に控除する分数」。
 * - auto: 打刻休憩は控除に使わず、ルールの deductMinutes を丸ごと控除する
 *   (打刻休憩はデータとして stretch.breakMinutes に残るが、実労働計算には効かない。
 *   これが punch モードとの違い — punch は打刻休憩をそのまま実労働から引くのに対し、
 *   auto は打刻の有無・長さに関係なく所定の休憩を差し引いたものとして扱う)
 * - both: 打刻休憩が deductMinutes に満たない差分だけを追加控除する(打刻優先)
 */
function deductionForRule(rule: AutoBreakRule, mode: "auto" | "both", punchBreakMinutes: number): number {
  if (mode === "auto") return rule.deductMinutes;
  return Math.max(0, rule.deductMinutes - punchBreakMinutes);
}

/**
 * gross(打刻休憩控除後の実労働、まだ自動控除は適用していない値)に対して、どの自動控除
 * ルールを・どれだけ控除するかを選ぶ。
 *
 * 各ルールは「発動」すれば(gross が自身の overMinutes を超えていれば)、そのルール単体の
 * 実効控除を次式で持つ:
 *
 *   実効控除 = min(モード調整後の控除分数(deductionForRule), gross − overMinutes)
 *
 * gross − overMinutes を上限にクランプすることで、そのルールを適用した結果の実労働が
 * 自身の overMinutes を割り込むことは構造的に起こらない(実労働は決して閾値未満まで
 * 削られないという労働者保護は、この上限クランプによって維持している)。発動した複数
 * ルールのうち実効控除が最大のものを採用する。同値なら overMinutes が大きい方
 * (最も実態に近い階層)を優先する。
 *
 * 旧方式(そのルールを適用した結果が自身の overMinutes 以上かで丸ごと採否を決める
 * 「自己無矛盾性チェック」)には不感帯があった: 単一階層ルール(例: 480分超60分控除の
 * みが設定されている場合)では gross が (480, 540) の範囲にあると、旧方式は「60分フル
 * 控除すると 480 を割ってしまう」という理由でルールを丸ごと棄却していた。結果、控除は
 * 常に0分のまま実労働が閾値を超え続け、insufficient_break の誤警告だけが出ていた。
 * 新方式では同じ場面で min(60, gross−480) 分だけを控除するため、実労働はちょうど
 * 480(自身の閾値)に着地し、この不感帯は生じない。
 *
 * この判定は各ルールが自分自身の gross・deductMinutes だけで完結し、他のルールの採否に
 * 依存しない。そのため「安定するまで再評価する」という多段の不動点ループは不要で、
 * 1回のフィルタリングで最終結果に到達する(仕様は不動点を許容しているが、この設計では
 * ラウンドをまたいで結果が振動する余地自体が無い)。
 *
 * 経緯: 2026-08-23 にまず「厳密比較(>)→以上(≥)」という境界の修正を行ったが、単一階層
 * ルールの不感帯(上記)は残っていたため、同日中に実効控除ベースのクランプ方式へ
 * 再修正した。
 */
function selectRule(
  gross: number,
  punchBreakMinutes: number,
  rules: AutoBreakRule[],
  mode: "auto" | "both",
): { rule: AutoBreakRule; deduction: number } | undefined {
  let best: { rule: AutoBreakRule; deduction: number } | undefined;
  for (const rule of rules) {
    if (gross <= rule.overMinutes) continue; // 発動条件: 実労働が閾値を超えている
    const raw = deductionForRule(rule, mode, punchBreakMinutes);
    const effective = Math.min(raw, gross - rule.overMinutes);
    if (
      !best ||
      effective > best.deduction ||
      (effective === best.deduction && rule.overMinutes > best.rule.overMinutes)
    ) {
      best = { rule, deduction: effective };
    }
  }
  return best;
}

/**
 * segments(1つの勤務区間に属する workedSegments、時系列昇順)の末尾から `deductMinutes` 分を
 * 削る。
 *
 * 末尾から削る理由(代替案: 比例配分は採らない): 休憩を実際にどの時刻に取ったか(取れて
 * いないか)はデータとして存在しない。だとすれば控除位置は「末尾」「先頭」「比例配分」の
 * いずれかを選ぶしかなく、どれも実態を正確には表さない。ここでは末尾を選ぶ:
 * - 比例配分(セグメント全体に薄く按分)は、深夜帯との重なりを「本当は起きなかった端数の
 *   重なり」という偽の精度で歪める。実際には休憩は連続したまとまりで取る(取れない)もので、
 *   1分単位に薄く散らして深夜割増を按分するのは実態からむしろ遠い
 * - 末尾控除は「終業直前まで働いていた」という前提に立つ点で、必ずしも労働者に有利な
 *   仮定ではない(先頭から削れば逆に不利になる場面もある)。つまり末尾か先頭かの選択自体に
 *   絶対的な正しさはない
 * - それでもどちらかを選ぶ必要があり、末尾控除は「区間の終了時刻から逆算するだけ」で
 *   説明でき、本人・労務担当のどちらにも計算過程を提示しやすい(説明可能性で勝る)
 */
function trimTail(segments: Segment[], deductMinutes: number): { kept: Segment[]; removed: Segment[] } {
  if (deductMinutes <= 0) return { kept: segments, removed: [] };
  let remaining = deductMinutes;
  const kept: Segment[] = [];
  const removed: Segment[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!seg) continue;
    if (remaining <= 0) {
      kept.unshift(seg);
      continue;
    }
    const segLen = seg.end - seg.start;
    if (segLen <= remaining) {
      removed.unshift(seg);
      remaining -= segLen;
    } else {
      const cutPoint = seg.end - remaining;
      kept.unshift({ start: seg.start, end: cutPoint });
      removed.unshift({ start: cutPoint, end: seg.end });
      remaining = 0;
    }
  }
  return { kept, removed };
}

/**
 * workedSegments を、それぞれが属する勤務区間(stretch)ごとにグループ分けする。
 *
 * workedSegments は deriveSegments が punches を時系列に処理しながら stretch 単位で
 * 順に積み増したものであり、区間同士は時間的に重ならない(clock_out より前に次の
 * clock_in は起きない)。そのため両配列とも同じ時系列順であることを利用し、カーソルを
 * 前進させるだけの線形走査で分配できる(区間ごとに全区間を re-scan する必要はない)。
 * 未退勤(clockOutAt: null)の stretch は workedSegments を一切持たないため、
 * カーソルはそのまま素通りする。
 */
function groupSegmentsByStretch(workedSegments: Segment[], stretches: WorkStretch[]): Segment[][] {
  const groups: Segment[][] = stretches.map(() => []);
  let cursor = 0;
  for (const seg of workedSegments) {
    while (
      cursor < stretches.length &&
      (stretches[cursor]?.clockOutAt === null || seg.start >= (stretches[cursor]?.clockOutAt as number))
    ) {
      cursor++;
    }
    if (cursor < stretches.length) {
      groups[cursor]?.push(seg);
    }
  }
  return groups;
}

export function applyAutoBreakDeduction(
  workedSegments: Segment[],
  stretches: WorkStretch[],
  settingsTimeline: SettingsSpan[],
  autoBreakWaivedDates: PlainDateString[] = [],
): AutoBreakDeductionResult {
  const waived = new Set(autoBreakWaivedDates);
  const groups = groupSegmentsByStretch(workedSegments, stretches);

  const resultWorkedSegments: Segment[] = [];
  const autoDeductedSegments: Segment[] = [];
  const resultStretches: WorkStretch[] = [];

  stretches.forEach((stretch, index) => {
    const group = groups[index] ?? [];

    // 未退勤: 実労働が確定していないため自動控除も確定しない(break-check.ts が
    // workedMinutes===null の区間を判定対象外にするのと同じ理由)。
    if (stretch.clockOutAt === null || stretch.workedMinutes === null || stretch.breakMinutes === null) {
      resultStretches.push(stretch);
      resultWorkedSegments.push(...group);
      return;
    }

    const { date, settings } = resolveAttendanceDate(stretch.clockInAt, settingsTimeline);
    const rule: BreakRule = settings.breakRule;

    if (rule.mode === "punch" || waived.has(date)) {
      // waiver は mode に関わらずその区間の自動控除を丸ごと止める
      // (breaks.md「承認済みの打ち消し日は自動控除しない」)。
      resultStretches.push({ ...stretch, autoDeductedBreakMinutes: 0 });
      resultWorkedSegments.push(...group);
      return;
    }

    const gross = stretch.workedMinutes;
    const punchBreakMinutes = stretch.breakMinutes;
    const selected = selectRule(gross, punchBreakMinutes, rule.rules, rule.mode);
    const deduction = selected ? selected.deduction : 0;

    if (deduction <= 0) {
      resultStretches.push({ ...stretch, autoDeductedBreakMinutes: 0 });
      resultWorkedSegments.push(...group);
      return;
    }

    const { kept, removed } = trimTail(group, deduction);
    resultWorkedSegments.push(...kept);
    autoDeductedSegments.push(...removed);
    resultStretches.push({
      ...stretch,
      workedMinutes: gross - deduction,
      autoDeductedBreakMinutes: deduction,
    });
  });

  return { workedSegments: resultWorkedSegments, autoDeductedSegments, stretches: resultStretches };
}
