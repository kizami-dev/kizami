/**
 * ログに外から来た値を載せるときの下ごしらえ(2026-10-22、セキュリティレビュー Low)。
 *
 * - `logValue`: 外部(IdP の応答・クエリ文字列など)の文字列を JSON 文字列リテラルにして載せる。
 *   改行・制御文字がエスケープされるので、値の中に `\n[kizami] login ok user=...` のような
 *   **偽のログ行を仕込めない**。長さも切る(巨大な応答でログを溢れさせない)
 * - `redactUrlCredentials`: 接続文字列(`redis://user:pass@host:6379` 等)のユーザー名・パスワードを伏せる。
 *   起動ログに設定値をそのまま出すと、ログの閲覧権限しか無い人にも資格情報が渡るため
 */

/** 外部から来た値をログ用に JSON 文字列リテラルへ(改行・制御文字をエスケープし、max 文字で切る)。 */
export function logValue(value: unknown, max = 200): string {
  const text = typeof value === "string" ? value : String(value);
  const truncated = text.length > max ? `${text.slice(0, max)}…` : text;
  // JSON.stringify は U+2028/U+2029 をエスケープしないので、行区切りとして扱うログ基盤向けに足しておく
  return JSON.stringify(truncated).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** URL のユーザー名・パスワードを `***` に置き換える。URL として読めなければ全体を伏せる。 */
export function redactUrlCredentials(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "(unparsable url)";
  }
  if (parsed.username === "" && parsed.password === "") return url;
  if (parsed.username !== "") parsed.username = "***";
  if (parsed.password !== "") parsed.password = "***";
  return parsed.toString();
}
