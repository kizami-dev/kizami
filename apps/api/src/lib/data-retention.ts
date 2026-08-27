/**
 * 退職者の個人データ保持期間の計算(純関数)。docs/design/data-retention.md。
 *
 * 「消去してよいか」の判定は、労働基準法109条の保存義務がまだ生きているかどうかの判定に
 * ほかならない。誤ると**法定帳簿を義務期間内に失う**方向の事故になるため、次の3点を
 * 意図的に保守側へ倒している(判断点):
 *
 * 1. **暦日で加算する**(365日 × N ではない)。閏日を含む期間で1日早く消せてしまうのを避ける。
 *    2月29日退職 + 3年のように加算先の日が存在しない場合、Temporal の既定 overflow:"constrain"
 *    が 2月28日へ丸める。これは1日**早く**消せる方向なので、ここだけは明示的に
 *    「存在しない日は翌月1日へ送る」= 3月1日として扱う(常に義務期間以上保持する)。
 * 2. **経過後の日から可能**とする。保持年数 N 年が「経過した」= 退職日 + N 年**の翌日**以降。
 *    退職日当日を1日目と数えるため、境界日そのものはまだ保持期間内として扱う。
 * 3. **判定はローカル暦日で行う**(UTC エポック分の大小比較ではない)。表示される「残り日数」と
 *    実際の可否がズレると、担当者は画面を信用できなくなる。
 */

import { dateFromEpochDay, epochDayFromDate } from "./time.js";
import { Temporal } from "./temporal.js";

/** テナント設定として受け付ける保持年数。労基法109条の原則5年 / 経過措置の3年のみ。 */
export const ALLOWED_RETENTION_YEARS: readonly number[] = [3, 5];

/** 既定の保持年数(原則側の5年。schema/tenants.ts の default と一致させること)。 */
export const DEFAULT_RETENTION_YEARS = 5;

export function isAllowedRetentionYears(value: unknown): value is number {
  return typeof value === "number" && ALLOWED_RETENTION_YEARS.includes(value);
}

/**
 * 退職日(ローカル暦日 "YYYY-MM-DD")+ 保持年数 から、**消去が可能になる最初の日**を返す。
 *
 * 例: 2020-04-01 退職・5年 → 2025-04-02(2025-04-01 までは保持期間内)。
 */
export function erasableFromDate(deactivatedDate: string, retentionYears: number): string {
  const start = Temporal.PlainDate.from(deactivatedDate);
  // overflow:"constrain" は 2月29日 + 3年 を 2月28日へ**手前に**丸める(1日早く消せてしまう)。
  // 丸められたこと(日が変わったこと)を検出したときだけ翌日へ送り直し、常に義務期間以上保つ。
  const constrained = start.add({ years: retentionYears }, { overflow: "constrain" });
  const anniversary = constrained.day === start.day ? constrained : constrained.add({ days: 1 });
  return anniversary.add({ days: 1 }).toString();
}

/** 保持期間の評価結果。UI・API の双方がこの形をそのまま使う。 */
export interface RetentionStatus {
  /** 退職日(ローカル暦日)。null = まだ退職処理されていない */
  deactivatedDate: string | null;
  /** 消去が可能になる最初の日(ローカル暦日)。deactivatedDate が null なら null */
  erasableFrom: string | null;
  /** 今日時点で消去可能か */
  erasable: boolean;
  /** 消去可能になるまでの残り日数。既に可能なら 0。deactivatedDate が null なら null */
  remainingDays: number | null;
}

/**
 * 退職日と保持年数から、今日(`today`、ローカル暦日)時点の保持期間の状態を求める。
 *
 * `deactivatedDate` が null(在籍中 or 退職日が記録される前に無効化された古い行)の場合、
 * `erasable` は **false** を返す — 起算日が分からないものを「消してよい」と答えてはいけない。
 * この状態の退職者を消したい場合は、いったん再有効化してから改めて退職処理をやり直す
 * (docs/design/data-retention.md「移行(既存の退職者)」)。
 */
export function evaluateRetention(params: {
  deactivatedDate: string | null;
  retentionYears: number;
  today: string;
}): RetentionStatus {
  const { deactivatedDate, retentionYears, today } = params;
  if (deactivatedDate === null) {
    return { deactivatedDate: null, erasableFrom: null, erasable: false, remainingDays: null };
  }
  const erasableFrom = erasableFromDate(deactivatedDate, retentionYears);
  const remaining = epochDayFromDate(erasableFrom) - epochDayFromDate(today);
  return {
    deactivatedDate,
    erasableFrom,
    erasable: remaining <= 0,
    remainingDays: Math.max(0, remaining),
  };
}

/** UTC エポック分 → ローカル暦日 "YYYY-MM-DD"。退職日(deactivated_at)の解釈に使う。 */
export function localDateFromEpochMinutes(epochMinutes: number, tzOffsetMinutes: number): string {
  return dateFromEpochDay(Math.floor((epochMinutes + tzOffsetMinutes) / 1440));
}
