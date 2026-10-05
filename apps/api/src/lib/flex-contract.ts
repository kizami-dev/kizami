/**
 * フレックスの契約上の枠と不足の繰越の入力(engine の `FlexContractInput`)を組み立てる
 * (2026-10-05、時短勤務の第2段階。docs/design/work-systems.md「フレックスの契約上の枠と不足の繰越」)。
 *
 * エンジンは前月・翌月を自分で計算しない(純関数で、入力は呼び出し側が集めて渡す)。ここで
 * 次の3つを用意する:
 *
 * 1. **所定労働日**: 所定休日のカレンダー(scheduled_holiday_calendar_versions)と、その月の
 *    設定タイムライン(法定休日)から、engine の `listScheduledWorkDates` で数える
 * 2. **前月からの繰越**(carryInMinutes): 前月の `carryOutMinutes`
 *    - 前月が締め済みなら**スナップショット**(flexCarryOut 行)から読む。締めた時点の値が正であり、
 *      締めた後に設定を変えても動かない(締めの原則)
 *    - 締め前なら**その場で計算する**。前月もまた前々月から繰越を受けているかもしれないので、
 *      前月の計算にも同じ組み立てを使う(連鎖)。遡る深さは `FLEX_CARRY_CHAIN_MAX_DEPTH` か月までに
 *      限り、上限に達したら繰越を0とみなして `flex_carry_chain_truncated` 警告を出す
 *    - 前月の制度が「契約上の枠・繰越する」でなければ0で、そこで遡りは止まる
 * 3. **翌月が受け入れられる繰越の上限**(nextPeriodCarryCapacityMinutes): この月が繰り越す設定の
 *    ときだけ、翌月の設定・カレンダー・法令から engine の `computeFlexFrames` で求める
 *    (翌月の法定の枠 − 翌月の契約上の枠)。翌月の割当が無い(退職など)なら0 = 全額をこの月で確定
 *
 * 遡る深さの上限(判断点): 3か月。締めを運用していれば前月は締め済みでスナップショットから読める
 * ので、遡りは常に1か月で止まる。上限は「締めずに使い続けているテナント」で月次の表示1回が
 * 何か月分もの再計算を呼ばないための守りで、1回の表示で追加に計算するのは最大3か月分になる。
 * 3か月を超えて締めずに繰越が続く運用は、不足の精算が事実上されていない状態なので警告で知らせる。
 *
 * 清算期間は1か月に固定している(engine の `settlement: "monthly"`)。複数月の清算期間
 * (労基法32条の3、2019年改正で3か月まで)に広げるときは、「前月」を「前の清算期間」に、
 * 繰越の上限を清算期間の法定の枠に読み替え、各月の1か月ごとの週平均50時間の判定を足すことになる
 * (docs/design/work-systems.md「将来の拡張」)。
 */

import { getClosingSnapshots, getClosingState, type Database, type Transaction } from "@kizami/db";
import {
  computeFlexFrames,
  listScheduledWorkDates,
  type CalendarTimelineSpan,
  type EngineOutput,
  type FlexContractInput,
  type SettingsSpan,
} from "@kizami/engine";
import { buildCalendarTimeline } from "./holiday-calendar.js";
import { buildLawTimelineForTenant, buildSettingsTimeline, resolveWorkSystemForDate } from "./settings.js";
import { dateFromEpochDay, daysInMonth, epochDayFromDate, formatDate } from "./time.js";

/** 前月の繰越を遡る深さの上限(か月)。上のファイル冒頭の判断点参照 */
export const FLEX_CARRY_CHAIN_MAX_DEPTH = 3;

interface YearMonth {
  year: number;
  month: number;
}

function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function monthRange({ year, month }: YearMonth): { fromDate: string; toDate: string; period: string } {
  const fromDate = formatDate(year, month, 1);
  const toDate = dateFromEpochDay(epochDayFromDate(fromDate) + daysInMonth(year, month) - 1);
  return { fromDate, toDate, period: fromDate.slice(0, 7) };
}

/** その月の期間開始日の制度が「契約上の枠」のフレックスなら、その flex の設定を返す */
function contractFlexAt(settingsTimeline: SettingsSpan[], fromDate: string) {
  const ws = resolveWorkSystemForDate(settingsTimeline, fromDate);
  return ws.kind === "flex" && ws.totalHoursBasis === "scheduled_days" ? ws : null;
}

/** 前月の締め前の計算を呼び出す関数(closing-amend.ts の computeMonthlyForUser を渡す。循環 import を避けるため) */
export type ComputeMonthForCarry = (period: YearMonth, carryChainDepth: number) => Promise<EngineOutput>;

export interface ResolveFlexContractParams {
  tenantId: string;
  userId: string;
  year: number;
  month: number;
  /** この月の設定タイムライン(buildSettingsTimeline の結果) */
  settingsTimeline: SettingsSpan[];
  /**
   * 前月をその場で計算するとき、さらに遡ってよい残りの深さ。省略時は FLEX_CARRY_CHAIN_MAX_DEPTH
   * (月次の表示・締め・エクスポートなど、外から呼ぶときは省略する)
   */
  carryChainDepth?: number;
  /** 所定休日のカレンダー(省略時は取得する)。同じテナントで何人分も計算する呼び出し元が使い回す */
  calendarTimeline?: CalendarTimelineSpan[];
}

/**
 * この月の `EngineInput.flexContract` を返す。期間開始日の制度が契約上の枠のフレックスでなければ
 * undefined(何も問い合わせない — 既定の制度の人の計算は、クエリ回数も含めて従来と変わらない)。
 */
export async function resolveFlexContractInput(
  db: Database | Transaction,
  params: ResolveFlexContractParams,
  computeMonth: ComputeMonthForCarry,
): Promise<FlexContractInput | undefined> {
  const current: YearMonth = { year: params.year, month: params.month };
  const { fromDate } = monthRange(current);
  const flex = contractFlexAt(params.settingsTimeline, fromDate);
  if (flex === null) return undefined;

  const calendarTimeline = params.calendarTimeline ?? (await buildCalendarTimeline(db, params.tenantId));
  const scheduled = listScheduledWorkDates(calendarTimeline, params.settingsTimeline, current);

  const depth = params.carryChainDepth ?? FLEX_CARRY_CHAIN_MAX_DEPTH;
  const carryIn = await resolveCarryIn(db, { tenantId: params.tenantId, userId: params.userId }, shiftMonth(current, -1), depth, computeMonth);

  const nextPeriodCarryCapacityMinutes = flex.carryOverShortfall
    ? await resolveCarryCapacity(db, { tenantId: params.tenantId, userId: params.userId, calendarTimeline }, shiftMonth(current, 1))
    : 0;

  return {
    scheduledWorkDates: scheduled.dates,
    carryInMinutes: carryIn.minutes,
    nextPeriodCarryCapacityMinutes,
    ...(carryIn.truncated ? { carryChainTruncated: true } : {}),
    ...(scheduled.nationalHolidayDataUnavailable ? { nationalHolidayDataUnavailable: true } : {}),
  };
}

/** 前月(previous)からこの月へ送られてきた繰越(分)。上のファイル冒頭の 2. 参照 */
async function resolveCarryIn(
  db: Database | Transaction,
  params: { tenantId: string; userId: string },
  previous: YearMonth,
  depth: number,
  computeMonth: ComputeMonthForCarry,
): Promise<{ minutes: number; truncated: boolean }> {
  const { fromDate, toDate, period } = monthRange(previous);

  // 前月の制度が契約上の枠で繰り越す設定でなければ、繰越は無い(遡りはここで止まる)。
  // 前月に制度の割当が無い(入社前など)ときも同じ。
  let previousTimeline: SettingsSpan[];
  try {
    previousTimeline = await buildSettingsTimeline(db, { tenantId: params.tenantId, userId: params.userId, fromDate, toDate });
  } catch {
    return { minutes: 0, truncated: false };
  }
  const previousFlex = contractFlexAt(previousTimeline, fromDate);
  if (previousFlex === null || previousFlex.carryOverShortfall !== true) return { minutes: 0, truncated: false };

  // 締め済みならスナップショットの値(締めた時点の確定値)を使う。行が無ければ繰越は無かった。
  const closing = await getClosingState(db, { tenantId: params.tenantId, period });
  if (closing.status === "closed") {
    const snapshots = await getClosingSnapshots(db, { tenantId: params.tenantId, period });
    const row = snapshots.find((s) => s.userId === params.userId && s.category === "flexCarryOut");
    return { minutes: row?.minutes ?? 0, truncated: false };
  }

  // 締め前: その場で前月を計算する(前月の計算もこの関数を通って前々月へ遡る)。
  if (depth <= 0) return { minutes: 0, truncated: true };
  const output = await computeMonth(previous, depth - 1);
  return {
    minutes: output.flexBalance?.carryOutMinutes ?? 0,
    truncated: output.warnings.some((w) => w.kind === "flex_carry_chain_truncated"),
  };
}

/** 翌月(next)が受け入れられる繰越の上限(分)。上のファイル冒頭の 3. 参照 */
async function resolveCarryCapacity(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; calendarTimeline: CalendarTimelineSpan[] },
  next: YearMonth,
): Promise<number> {
  const { fromDate, toDate } = monthRange(next);
  let nextTimeline: SettingsSpan[];
  try {
    nextTimeline = await buildSettingsTimeline(db, { tenantId: params.tenantId, userId: params.userId, fromDate, toDate });
  } catch {
    // 翌月の割当・設定が無い(退職して割当が切れている等)。受け入れ先が無いので繰り越さない。
    return 0;
  }
  if (contractFlexAt(nextTimeline, fromDate) === null) return 0;
  const lawTimeline = await buildLawTimelineForTenant(db, { tenantId: params.tenantId, fromDate, toDate });
  const scheduled = listScheduledWorkDates(params.calendarTimeline, nextTimeline, next);
  return computeFlexFrames(nextTimeline, lawTimeline, next, scheduled.dates).carryCapacityMinutes;
}
