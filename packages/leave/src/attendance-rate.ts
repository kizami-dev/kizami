/**
 * 出勤率の**参考値**(労基法39条1項「全労働日の8割以上出勤」の検算材料)。
 *
 * 位置づけ(docs/requirements.md §11 の決定、docs/design/shift-work.md 実装フェーズ4):
 * この値は付与の可否を機械が判定するためのものでは**ない**。付与予告
 * (leave_grant_proposals)に添えて管理者に見せ、最終判断を人が行うための参考値である。
 * よって「分母が正確に出せない制度では推定であることを明示する」(basis)ことを、
 * 精度そのものより優先している。
 *
 * 算定期間: [基準日 − 1年, 基準日 − 1日](両端含む)。初回付与では入社日より前に遡らない
 * (入社前は労働日が存在しないため、分母に含めると出勤率が不当に下がる)。
 *
 * 分母(全労働日):
 * - シフト制(monthly_variable): 期間内の有効な shift_days のうち dayType が work のもの
 *   (basis="shift"。シフトが「その日働くべきだったか」をデータで持つため正確に出せる —
 *   これがシフト制と有給付与フローを同時期に実装した理由、shift-work.md 参照)
 * - 固定時間制・フレックス: 暦日から「法定休日の曜日」および(テナント設定が持つなら)
 *   週の非労働日を除いた推定(basis="calendar_estimate")
 *
 * 分子(出勤日): 実労働のあった日(打刻から解決した勤怠日ごとの実労働 > 0)に加えて、
 * **承認済みの年次有給休暇取得日**(通達により出勤したものとみなす)。分母(全労働日)に
 * 含まれる日だけを数える — 全労働日でない日(法定休日・非労働日)の労働は法39条の
 * 「出勤日」ではないため(出勤率が 1.0 を超えないのはこの交差の帰結)。
 *
 * 本ファイルは純関数のみ(パッケージ全体の制約)。日付ファクト(シフト日・出勤日・
 * 有給取得日)は呼び出し側(apps/api)が DB から集めて渡す。
 */

import { addDays, addYears, compareDate, weekdayOf } from "./date.js";
import type { PlainDateString } from "./types.js";

/** 分母の出どころ。UI はこれを見て「シフト基準」「暦日からの推定」を出し分ける。 */
export type AttendanceRateBasis = "shift" | "calendar_estimate";

/** 出勤率の参考値。leave_grant_proposals.attendance_rate に JSON でそのまま保存する。 */
export interface AttendanceRateReference {
  /** 算定期間の初日(両端含む) */
  periodFrom: PlainDateString;
  /** 算定期間の末日(両端含む) */
  periodTo: PlainDateString;
  /** 全労働日(分母) */
  workingDays: number;
  /** 出勤日(分子) */
  attendedDays: number;
  /** attendedDays / workingDays(0〜1)。workingDays が 0 なら null(0除算を避け「不明」を表す) */
  rate: number | null;
  basis: AttendanceRateBasis;
}

export interface AttendanceRatePeriod {
  periodFrom: PlainDateString;
  periodTo: PlainDateString;
}

/**
 * 算定期間 [基準日 − 1年, 基準日 − 1日] を返す。`hireDate` が期間の開始より後
 * (=初回付与)ならそこまで切り詰める。
 *
 * 期間が成立しない(hireDate が基準日以降)場合も periodFrom > periodTo の形でそのまま返す
 * — 呼び出し側は calculateAttendanceRate に渡せば workingDays=0・rate=null が返る。
 */
export function resolveAttendanceRatePeriod(grantedOn: PlainDateString, hireDate?: PlainDateString): AttendanceRatePeriod {
  const periodTo = addDays(grantedOn, -1);
  const naturalFrom = addYears(grantedOn, -1);
  const periodFrom = hireDate !== undefined && compareDate(hireDate, naturalFrom) > 0 ? hireDate : naturalFrom;
  return { periodFrom, periodTo };
}

/**
 * 暦日から全労働日を推定する(固定時間制・フレックス用)。`nonWorkingWeekdays` に含まれる
 * 曜日(0=日曜)を除いた日付を昇順で返す。
 *
 * 呼び出し側はテナント設定の法定休日(曜日指定のとき)と、週の非労働日が設定されていれば
 * それも合わせて渡す。何も分からない場合は土日(0,6)を渡す想定 —「週休2日の推定」であることを
 * basis="calendar_estimate" が示す。
 */
export function estimateCalendarWorkingDates(
  periodFrom: PlainDateString,
  periodTo: PlainDateString,
  nonWorkingWeekdays: readonly number[],
): PlainDateString[] {
  const excluded = new Set(nonWorkingWeekdays);
  const dates: PlainDateString[] = [];
  let cursor = periodFrom;
  // 無限ループ防止(算定期間は最長でも1年+α)。
  for (let i = 0; i < 400 && compareDate(cursor, periodTo) <= 0; i++) {
    if (!excluded.has(weekdayOf(cursor))) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export interface CalculateAttendanceRateParams extends AttendanceRatePeriod {
  basis: AttendanceRateBasis;
  /** 全労働日(分母)の日付。重複・期間外は本関数側で除去する */
  workingDates: readonly PlainDateString[];
  /** 実労働のあった日(打刻ベース) */
  attendedDates: readonly PlainDateString[];
  /** 承認済みの有給取得日(出勤扱い) */
  paidLeaveDates: readonly PlainDateString[];
}

/**
 * 出勤率の参考値を組み立てる。分子は「(実労働のあった日 ∪ 有給取得日) ∩ 全労働日」。
 */
export function calculateAttendanceRate(params: CalculateAttendanceRateParams): AttendanceRateReference {
  const { periodFrom, periodTo, basis, workingDates, attendedDates, paidLeaveDates } = params;

  const inPeriod = (date: PlainDateString): boolean => compareDate(date, periodFrom) >= 0 && compareDate(date, periodTo) <= 0;

  const working = new Set<PlainDateString>();
  for (const date of workingDates) if (inPeriod(date)) working.add(date);

  const attended = new Set<PlainDateString>();
  for (const date of [...attendedDates, ...paidLeaveDates]) {
    if (inPeriod(date) && working.has(date)) attended.add(date);
  }

  const workingDays = working.size;
  const attendedDays = attended.size;
  return {
    periodFrom,
    periodTo,
    workingDays,
    attendedDays,
    rate: workingDays === 0 ? null : attendedDays / workingDays,
    basis,
  };
}
