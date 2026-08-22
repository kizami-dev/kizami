/**
 * get_status の「今日の打刻一覧」を絞り込むための、当日(JST)の範囲計算。
 *
 * KIZAMI 本体はテナントごとに日界(dayBoundaryMinutes)を設定できるが、公開APIには
 * その設定を取得する手段がなく(APIキーのスコープ外)、apps/mcp は薄いHTTPクライアントに
 * 徹する方針のため、この計算は「日界0時・Asia/Tokyo固定」という近似を使う(既定のテナント
 * 設定と一致する — apps/api/src/seed.ts の dayBoundaryMinutes: 0 を参照)。日界を0時以外に
 * 変更しているテナントでは、この「今日」の範囲がサーバー側の勤怠日と数時間ずれる場合がある
 * (判断点。README に明記する)。
 */

const JST_OFFSET_MINUTES = 9 * 60;
const MINUTES_PER_DAY = 1440;

/** 与えた時刻(UTC エポック分)が属する JST 暦日の [開始, 終了] を UTC エポック分で返す(終了は含む)。 */
export function jstCalendarDayWindow(nowMinutes: number): { from: number; to: number } {
  const localMinutes = nowMinutes + JST_OFFSET_MINUTES;
  const dayIndex = Math.floor(localMinutes / MINUTES_PER_DAY);
  const localDayStart = dayIndex * MINUTES_PER_DAY;
  const from = localDayStart - JST_OFFSET_MINUTES;
  const to = from + MINUTES_PER_DAY - 1;
  return { from, to };
}

export function nowMinutes(): number {
  return Math.floor(Date.now() / 60_000);
}

/**
 * 当月(JST基準)を "YYYY-MM" で返す。
 *
 * GET /attendance/monthly はサーバー側で month クエリを必須にしており(省略時のデフォルトは
 * 持たない — apps/api/src/lib/time.ts の parseMonthParam)、get_monthly_summary ツールが
 * 「引数省略時は当月」という契約(依頼)を満たすには、クライアント側で当月を計算して
 * 明示的に渡す必要がある。
 */
export function currentJstMonth(atMinutes: number = nowMinutes()): string {
  const localMinutes = atMinutes + JST_OFFSET_MINUTES;
  const dayIndex = Math.floor(localMinutes / MINUTES_PER_DAY);
  const date = new Date(dayIndex * MINUTES_PER_DAY * 60_000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}
