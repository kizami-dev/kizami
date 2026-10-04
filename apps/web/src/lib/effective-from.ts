import { messages } from "./messages";

/**
 * 設定の版の適用開始日の表示。1970-01-01 / 1970-01-02 は「初期の版」を表す番兵値で、
 * 日付として見せると誤解を招くため「初期設定」と表示する(データ・API は変えない)。
 */
export function isInitialVersionDate(date: string): boolean {
  return date <= "1970-01-02";
}

export function formatEffectiveFrom(date: string): string {
  return isInitialVersionDate(date) ? messages.common.initialVersion : date;
}
