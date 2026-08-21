/**
 * KIZAMI 集計エンジン
 *
 * 制約(要件 §8/§9):
 * - 純関数のみ。I/O・Date.now()・タイムゾーン暗黙依存を持たない
 * - Node と workerd の両方で同一に動作する
 * - 入力は打刻列+テナント設定、出力は区分別時間数(分単位)
 */

/** 労働時間の区分。金額計算はスコープ外(要件 §2)。 */
export type TimeCategory =
  | "statutory" // 法定内労働
  | "overtime" // 法定時間外
  | "overtime60h" // 月60時間超の法定時間外
  | "lateNight" // 深夜(22時〜5時)
  | "statutoryHoliday"; // 法定休日労働

/** 集計結果: 区分ごとの分数。 */
export type CategorizedMinutes = Readonly<Record<TimeCategory, number>>;

export const EMPTY_RESULT: CategorizedMinutes = Object.freeze({
  statutory: 0,
  overtime: 0,
  overtime60h: 0,
  lateNight: 0,
  statutoryHoliday: 0,
});
