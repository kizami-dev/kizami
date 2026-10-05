/**
 * フレックス集計(docs/design/v01-data-model.md「集計エンジンの入出力」、
 * および要件定義書 §2「v0.1のフレックス仕様」、docs/design/work-systems.md)。
 *
 * 清算期間1ヶ月。法定の枠 = floor(週法定労働時間 × 暦日数 / 7)。
 * 週法定労働時間・60時間超区分の有効/閾値は `@kizami/law` の `LawRules` から取得する
 * (原則 週40時間・月60時間だが、特例措置対象事業場は週44時間、60時間超区分は
 * 施行日より前は無効 — packages/law/README.md 参照)。
 *
 * 判断点: フレックスの月枠・60時間超閾値は「月」単位でしか意味を持たない値であり、
 * `daily.ts` の深夜帯のように「日ごと」に解決する対象ではない。本関数は期間初日
 * (`period` の1日)に有効な法令版を1つだけ解決し、月全体に適用する
 * (月の途中で法令が切り替わる稀なケースは、深夜帯のような日次カテゴリでのみ日ごとに
 * 反映され、月次集計であるフレックス総枠・60時間超閾値は初日基準で決め打ちにする)。
 *
 * ## 契約上の枠と3段の計算(2026-10-05、時短勤務の第2段階)
 *
 * 総労働時間の決め方(`WorkSystem` の flex 分岐の `totalHoursBasis`)は期間開始日の版で決める
 * (労働時間制そのものを期間開始日で決めるのと同じ流儀)。
 *
 * - "statutory_frame"(既定): 従来どおり。過不足も時間外も法定の枠と比べる2段の計算
 * - "scheduled_days": 契約上の枠 = 所定労働日の標準労働時間の合計。次の3段にする
 *   1. 過不足は「契約上の枠 + 前月からの繰越の受け入れ」(= frameMinutes)と比べる
 *   2. frameMinutes〜法定の枠 = 法定内超過(割増なし。固定時間制の法定内残業にあたる)
 *   3. 法定の枠を超えた分 = 法定外(totals.overtime。従来と同じ式)
 *
 * totals.statutory は「法定の枠以内の労働」で、どちらの決め方でも min(実績, 法定の枠) のまま
 * (法定内超過はその内数として flexBalance に別に持つ)。給与ソフト向けの割り直しは
 * apps/api/src/lib/payroll-export.ts が行う。
 *
 * ### 契約上の枠が法定の枠を上回るとき(判断点: 頭打ち+警告)
 *
 * 31日の月に所定23日 × 8時間 = 184時間は、法定の枠(177時間8分)を上回る。フレックスの
 * 清算期間の総労働時間は法定の枠の範囲内で定めなければならない(労基法32条の3第1項2号、
 * 昭63.1.1 基発1号「清算期間における総労働時間…は、法定労働時間の総枠の範囲内」)。
 * そのまま使うと、法定の枠を超えた時間が「契約の枠内」として不足の計算に入り、本人に不利な
 * 不足(=控除)が出る。そこで**法定の枠で頭打ちにし**、`flex_contract_frame_capped` 警告で
 * 設定(標準労働時間か所定休日のカレンダー)の見直しを促す。時間外(法定外)は元から法定の枠と
 * 比べているので、頭打ちにしても割増の対象は1分も減らない。
 *
 * ### 不足の繰越(`carryOverShortfall`)
 *
 * 不足(frameMinutes − 実績の正の部分)のうち、翌月が受け入れられる分
 * (`FlexContractInput.nextPeriodCarryCapacityMinutes` = 翌月の法定の枠 − 翌月の契約上の枠)までを
 * 翌月へ送り出し(carryOutMinutes)、残りをこの月の不足として確定する(confirmedShortfallMinutes)。
 * 翌月に上乗せした結果が法定の枠を超えると、その超えた部分は本来「法定外」として割増の対象に
 * なる時間を、前月の不足の穴埋めとして割増なしで働かせることになるため(昭63.1.1 基発1号は
 * 不足の繰越を「法定労働時間の総枠の範囲内である限り」違法ではないとする)。
 * 受け入れ側でも同じ上限で切り詰める(送り出した後に翌月の設定が変わった場合の守り)。
 * 超過は繰り越さない(types.ts の `carryOverShortfall` 参照)。
 */

import { daysInMonth, findLawForDate, findSettingsForDate, formatDateString, isInPeriod } from "./date.js";
import type {
  CalcWarning,
  CategorizedMinutes,
  DailyBreakdown,
  FlexBalance,
  FlexContractInput,
  FlexTotalHoursBasis,
  LawTimelineSpan,
  PaidLeaveEntry,
  PlainDateString,
  SettingsSpan,
  WorkSystem,
} from "./types.js";

/** 法定の枠と契約上の枠(`computeFlexFrames` の戻り値) */
export interface FlexFrames {
  /** 期間開始日の制度の総労働時間の決め方 */
  totalHoursBasis: FlexTotalHoursBasis;
  /** 期間開始日の制度が不足を繰り越すか */
  carryOverShortfall: boolean;
  /** 法定の枠(分) */
  statutoryFrameMinutes: number;
  /** 所定労働日の標準労働時間の合計(頭打ち前、分)。法定の枠が基準なら null */
  requestedContractFrameMinutes: number | null;
  /** 契約上の枠(法定の枠で頭打ちにした後、分)。法定の枠が基準なら null */
  contractFrameMinutes: number | null;
  /**
   * 前月の不足をこの月に上乗せできる上限(分)= 法定の枠 − 契約上の枠。法定の枠が基準なら0。
   * 前月の計算では、これが `FlexContractInput.nextPeriodCarryCapacityMinutes` になる
   */
  carryCapacityMinutes: number;
}

/** 期間開始日に有効な flex の設定を返す(flex でなければ null)。 */
function periodStartFlex(settingsTimeline: SettingsSpan[], period: { year: number; month: number }) {
  const periodStartDate = formatDateString({ year: period.year, month: period.month, day: 1 });
  const ws = findSettingsForDate(periodStartDate, settingsTimeline).workSystem;
  return ws.kind === "flex" ? ws : null;
}

/** その日の標準労働時間。月の途中で flex 以外の版になっていれば、期間開始日の flex の値を使う */
function standardDayMinutesOn(date: PlainDateString, settingsTimeline: SettingsSpan[], fallback: number): number {
  const ws: WorkSystem = findSettingsForDate(date, settingsTimeline).workSystem;
  return ws.kind === "monthly_variable" ? fallback : ws.standardDayMinutes;
}

/**
 * 法定の枠と契約上の枠を計算する純関数。`calculate` の中だけでなく、API が「翌月が受け入れられる
 * 繰越の上限」(翌月の carryCapacityMinutes)を求めるのにも使う — 枠の定義をこの1箇所に置くため。
 *
 * `settingsTimeline` の期間開始日の制度が flex でなければ、法定の枠だけを返す
 * (totalHoursBasis は "statutory_frame"、carryCapacityMinutes は 0)。
 */
export function computeFlexFrames(
  settingsTimeline: SettingsSpan[],
  lawTimeline: LawTimelineSpan[],
  period: { year: number; month: number },
  scheduledWorkDates: readonly PlainDateString[] = [],
): FlexFrames {
  const dim = daysInMonth(period.year, period.month);

  // 総枠は「日々の積み上げ」なので日割りで按分する。期間の途中で週法定労働時間が変わる
  // 改正(例: 特例措置の見直し)があっても、その日から新しい値が効く。
  // 週法定が期間を通じて一定なら floor(週法定 × 暦日数 / 7) と一致する。
  //
  // 一方で「閾値」(60時間超の区分、36協定の月/年上限)は期間全体に対する一つの数値であり
  // 按分できないため、期間開始日の版を使う(calculateFlexBalance の law)。判断の基準日については
  // docs/design/v01-data-model.md「法令の適用時点」を参照。
  // 日ごとに 7 で割ると浮動小数の誤差が累積して1分ずれることがあるため、
  // 週法定労働時間(整数)を合計してから最後に一度だけ 7 で割る。
  let weeklyMinutesSum = 0;
  for (let day = 1; day <= dim; day++) {
    const date = formatDateString({ year: period.year, month: period.month, day });
    weeklyMinutesSum += findLawForDate(date, lawTimeline).weeklyStatutoryMinutes;
  }
  const statutoryFrameMinutes = Math.floor(weeklyMinutesSum / 7);

  const flex = periodStartFlex(settingsTimeline, period);
  const totalHoursBasis = flex?.totalHoursBasis ?? "statutory_frame";
  const carryOverShortfall = flex?.carryOverShortfall ?? false;
  if (flex === null || totalHoursBasis === "statutory_frame") {
    return {
      totalHoursBasis: "statutory_frame",
      carryOverShortfall,
      statutoryFrameMinutes,
      requestedContractFrameMinutes: null,
      contractFrameMinutes: null,
      carryCapacityMinutes: 0,
    };
  }

  // 契約上の枠も「日々の積み上げ」なので、所定労働日ごとにその日に有効な版の標準労働時間を足す
  // (月の途中で標準労働時間を変える版を足しても、その日から効く)。同じ日が2回渡されても1回と数える。
  let requested = 0;
  for (const date of new Set(scheduledWorkDates)) {
    if (!isInPeriod(date, period)) continue;
    requested += standardDayMinutesOn(date, settingsTimeline, flex.standardDayMinutes);
  }
  const contractFrameMinutes = Math.min(requested, statutoryFrameMinutes);
  return {
    totalHoursBasis,
    carryOverShortfall,
    statutoryFrameMinutes,
    requestedContractFrameMinutes: requested,
    contractFrameMinutes,
    carryCapacityMinutes: statutoryFrameMinutes - contractFrameMinutes,
  };
}

export function calculateFlexBalance(
  days: DailyBreakdown[],
  settingsTimeline: SettingsSpan[],
  lawTimeline: LawTimelineSpan[],
  period: { year: number; month: number },
  paidLeave: PaidLeaveEntry[],
  flexContract?: FlexContractInput,
): { totals: CategorizedMinutes; flexBalance: FlexBalance; warnings: CalcWarning[] } {
  const periodStartDate = formatDateString({ year: period.year, month: period.month, day: 1 });
  const frames = computeFlexFrames(settingsTimeline, lawTimeline, period, flexContract?.scheduledWorkDates ?? []);
  const { statutoryFrameMinutes } = frames;

  const law = findLawForDate(periodStartDate, lawTimeline);

  const workedTotal = days.reduce((sum, d) => sum + d.workedMinutes, 0);
  const paidLeaveMinutesInPeriod = paidLeave
    .filter((entry) => isInPeriod(entry.date, period))
    .reduce((sum, entry) => sum + entry.minutes, 0);
  const actualMinutes = workedTotal + paidLeaveMinutesInPeriod;

  // 法定の枠との比較(3段目)。総労働時間の決め方によらず同じ式 — 既定の制度の結果を変えないため、
  // 2026-10-05 より前の式そのまま。
  const statutory = Math.min(actualMinutes, statutoryFrameMinutes);
  const overtime = Math.max(0, actualMinutes - statutoryFrameMinutes);
  // 60時間超区分が無効な期間(2010年以前・中小企業の2023年3月以前)は overtime60h を常に0にする
  const overtime60h = law.overtime60h.enabled ? Math.max(0, overtime - law.overtime60h.thresholdMinutes) : 0;
  const lateNight = days.reduce((sum, d) => sum + d.lateNightMinutes, 0);
  const statutoryHoliday = days.reduce((sum, d) => sum + d.legalHolidayMinutes, 0);
  const totals: CategorizedMinutes = { statutory, overtime, overtime60h, lateNight, statutoryHoliday };

  if (frames.contractFrameMinutes === null) {
    // 法定の枠が基準(既定)。過不足は法定の枠と比べ、繰越は起きない(上乗せの余地が0のため)。
    const diffMinutes = actualMinutes - statutoryFrameMinutes;
    return {
      totals,
      flexBalance: {
        frameMinutes: statutoryFrameMinutes,
        actualMinutes,
        diffMinutes,
        statutoryFrameMinutes,
        contractFrameMinutes: null,
        carryInMinutes: 0,
        withinStatutoryExcessMinutes: 0,
        carryOutMinutes: 0,
        confirmedShortfallMinutes: Math.max(0, -diffMinutes),
      },
      warnings: [],
    };
  }

  const warnings: CalcWarning[] = [];
  const contractFrameMinutes = frames.contractFrameMinutes;
  const requestedContract = frames.requestedContractFrameMinutes ?? contractFrameMinutes;
  if (requestedContract > contractFrameMinutes) {
    warnings.push({
      kind: "flex_contract_frame_capped",
      date: periodStartDate,
      flexFrame: { requestedMinutes: requestedContract, capMinutes: contractFrameMinutes },
    });
  }

  // 1段目: 前月からの繰越を上乗せした枠。上乗せは法定の枠を超えない範囲に限る。
  const requestedCarryIn = Math.max(0, flexContract?.carryInMinutes ?? 0);
  const carryInMinutes = Math.min(requestedCarryIn, frames.carryCapacityMinutes);
  if (requestedCarryIn > carryInMinutes) {
    warnings.push({
      kind: "flex_carry_in_clipped",
      date: periodStartDate,
      flexFrame: { requestedMinutes: requestedCarryIn, capMinutes: carryInMinutes },
    });
  }
  const frameMinutes = contractFrameMinutes + carryInMinutes;

  // 2段目: 枠を超え、法定の枠以内の部分(法定内超過)。
  const withinStatutoryExcessMinutes = Math.max(0, statutory - frameMinutes);

  // 不足と繰越。超過は繰り越さない(carryOutMinutes は不足からしか作らない)。
  const shortfallMinutes = Math.max(0, frameMinutes - actualMinutes);
  const carryOutMinutes = frames.carryOverShortfall
    ? Math.min(shortfallMinutes, Math.max(0, flexContract?.nextPeriodCarryCapacityMinutes ?? 0))
    : 0;

  if (flexContract?.carryChainTruncated) {
    warnings.push({ kind: "flex_carry_chain_truncated", date: periodStartDate });
  }
  if (flexContract?.nationalHolidayDataUnavailable) {
    warnings.push({ kind: "national_holiday_data_unavailable", date: periodStartDate });
  }

  return {
    totals,
    flexBalance: {
      frameMinutes,
      actualMinutes,
      diffMinutes: actualMinutes - frameMinutes,
      statutoryFrameMinutes,
      contractFrameMinutes,
      carryInMinutes,
      withinStatutoryExcessMinutes,
      carryOutMinutes,
      confirmedShortfallMinutes: shortfallMinutes - carryOutMinutes,
    },
    warnings,
  };
}
