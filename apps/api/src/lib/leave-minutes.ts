/**
 * 有給1日分の分数換算(全休=1日、半休=1/2日)に使う「その日の所定(分)」の解決。
 *
 * 背景(docs/design/shift-work.md 実装フェーズ4、2026-08-24 の決定):
 * フレックス・固定時間制では所定がテナント/ポリシー単位の定数なので、
 * `standardDayMinutesForDate`(同期・DB非依存)だけで解決できた。シフト制
 * (monthly_variable)では所定が user × 日付の可変データになるため、解決に DB
 * (shift_days)が要る。そこで **非同期のリゾルバを1度組み立てて、以後は同期に引く**形にする
 * (期間内の有効なシフト日を先読みしてメモリに載せる — 日ごとに1クエリ投げない)。
 *
 * 解決規則(リードの決定):
 * 1. その user × date に有効な shift_day があり `dayType === "work"` なら、その日の**シフト所定**
 *    (`@kizami/engine` の `shiftScheduledMinutes`。休憩控除・日跨ぎの扱いは engine の定義に従う)
 * 2. それ以外(シフトが無い日 / legal_holiday / non_working / そもそも monthly_variable でない)は
 *    work_policy_versions.standard_day_minutes — monthly_variable ではこれが
 *    「基準所定(有給換算用)」を意味する(`BaseDayMinutesSpan` の JSDoc 参照)
 *
 * flex/fixed のユーザーでは規則2しか通らず、値も呼び出し経路も従来と同一
 * (シフトの先読みクエリも発行しない — 下記 `needsShiftLookup` 参照)。
 *
 * 残高の日↔分換算(`calculateBalance` の `standardDayMinutes`)には規則2の値だけを使う:
 * 「残り◯日」は特定の日付に紐づかない総量であり、たまたま今日入っているシフトの長短で
 * 残日数の見え方が変わるのは不自然なため(`baseForDate` を用意している理由)。
 */

import { listValidShiftDaysInRange, type Database, type Transaction } from "@kizami/db";
import { shiftScheduledMinutes, type SettingsSpan, type ShiftDayType } from "@kizami/engine";
import { resolveWorkSystemForDate, standardDayMinutesForDate, type BaseDayMinutesSpan } from "./settings.js";

export interface LeaveStandardMinutesResolver {
  /** 有給1件の分数換算に使う「その日の所定」(規則1 → 規則2)。 */
  forDate(date: string): number;
  /** 残高の日↔分換算に使う基準所定(規則2のみ。シフトは見ない)。 */
  baseForDate(date: string): number;
}

export interface MakeLeaveStandardMinutesResolverParams {
  tenantId: string;
  userId: string;
  /** `buildSettingsTimelineWithBaseDayMinutes` の第1の返り値 */
  timeline: SettingsSpan[];
  /** 同じく第2の返り値(monthly_variable の基準所定) */
  baseDayMinutes: BaseDayMinutesSpan[];
  /** 先読みするシフトの範囲(両端含む、ローカル日付)。呼び出し側が分数解決したい全日付を含めること */
  fromDate: string;
  toDate: string;
}

/**
 * 期間内の有効なシフト日を先読みし、同期に引けるリゾルバを返す。
 *
 * `Database | Transaction` を受け取る(lib/closing-amend.ts が締め後修正と同一
 * トランザクションで使うため。他の buildSettingsTimeline 等と同じ理由)。
 */
export async function makeLeaveStandardMinutesResolver(
  db: Database | Transaction,
  params: MakeLeaveStandardMinutesResolverParams,
): Promise<LeaveStandardMinutesResolver> {
  const { tenantId, userId, timeline, baseDayMinutes, fromDate, toDate } = params;

  const baseForDate = (date: string): number => standardDayMinutesForDate(timeline, date, baseDayMinutes);

  // シフトを読むのは「対象期間のどこかで monthly_variable が有効なとき」だけ。
  // 変更点(span の from)で制度が切り替わりうるので、期間初日と期間内の各変更点を見る。
  const needsShiftLookup =
    resolveWorkSystemForDate(timeline, fromDate).kind === "monthly_variable" ||
    timeline.some((span) => span.from >= fromDate && span.from <= toDate && span.settings.workSystem.kind === "monthly_variable");

  if (!needsShiftLookup) {
    return { forDate: baseForDate, baseForDate };
  }

  const rows = await listValidShiftDaysInRange(db, { tenantId, userId, fromDate, toDate });
  const shiftMinutesByDate = new Map<string, number>();
  for (const row of rows) {
    shiftMinutesByDate.set(
      row.date,
      shiftScheduledMinutes({
        date: row.date,
        dayType: row.dayType as ShiftDayType,
        startMinutes: row.startMinutes,
        endMinutes: row.endMinutes,
        breakMinutes: row.breakMinutes,
      }),
    );
  }

  const forDate = (date: string): number => {
    if (resolveWorkSystemForDate(timeline, date).kind !== "monthly_variable") return baseForDate(date);
    if (date < fromDate || date > toDate) {
      // 先読み範囲外の日付を聞かれた = 呼び出し側の配線ミス。基準所定で黙って代用すると
      // 「シフトのある日なのにシフトを見ていない」誤りが静かに紛れ込むため、明確に失敗させる。
      throw new Error(`makeLeaveStandardMinutesResolver: date ${date} is outside the preloaded range [${fromDate}, ${toDate}]`);
    }
    const scheduled = shiftMinutesByDate.get(date);
    // dayType が work 以外のシフト日は shiftScheduledMinutes が 0 を返す。有給を「0分」に
    // 換算するのは無意味(残高が減らないのに休暇として記録される)なので、規則2へ落とす。
    if (scheduled !== undefined && scheduled > 0) return scheduled;
    return baseForDate(date);
  };

  return { forDate, baseForDate };
}
