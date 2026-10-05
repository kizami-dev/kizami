/**
 * CSV のフィールドの書き出し(2026-10-05、セキュリティレビューの指摘で共通化)。
 * 勤怠の CSV エクスポート(routes/exports.ts の汎用・給与ソフト形式)と、全データのエクスポート
 * (lib/tenant-export-archive.ts)が同じ関数を通る。
 *
 * ## 数式インジェクション(CSV injection)対策
 *
 * 氏名・メールアドレス・手当の名前などの入力値が `=` `+` `-` `@` やタブ・CR で始まると、
 * Excel などの表計算ソフトで開いたときに**数式として評価される**(外部への送信や任意の
 * コマンドの起動に使われうる)。OWASP の推奨どおり、そうした値の先頭に `'` を付けて
 * 文字列として扱わせる(https://owasp.org/www-community/attacks/CSV_Injection)。
 *
 * **数値の列は変えない**(判断点): 差分の列(diff_*)などは負の数(`-30`)を正しく持つ。
 * `number` で渡された値と、文字列でも数字だけの値(給与ソフト形式は数値を文字列で組み立てる)は
 * そのまま出す。数字だけの値は表計算ソフトが数として読むだけで、数式にはならない。
 * 日付・時刻("2026-06-01"・"2026-06-01 09:00")は数字で始まるので、もともと対象にならない。
 */

/** 数式として評価されうる先頭の文字(OWASP の一覧)。 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** 数として読める文字列(符号付き整数・小数)。これは数式ではないのでそのまま出す。 */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** 数式として評価されないよう、必要なら先頭に `'` を付ける。 */
export function neutralizeCsvFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}

/** 1フィールド: 数式の無害化のうえで、RFC4180 のエスケープ(カンマ・ダブルクォート・改行を含むときだけ引用符で囲む)。 */
export function escapeCsvField(value: string | number | boolean): string {
  const text = typeof value === "string" ? neutralizeCsvFormula(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 1行(区切りはカンマ)。 */
export function buildCsvRow(fields: ReadonlyArray<string | number | boolean>): string {
  return fields.map(escapeCsvField).join(",");
}
