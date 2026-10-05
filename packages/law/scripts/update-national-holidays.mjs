/**
 * 国民の祝日のデータ(src/national-holidays-data.ts)を、内閣府が公開している CSV から作り直す。
 *
 *   pnpm --filter @kizami/law update:holidays                       # 内閣府から取得して書き換える
 *   pnpm --filter @kizami/law update:holidays -- ./syukujitsu.csv   # 手元の CSV から作る
 *
 * 出典: 内閣府「国民の祝日について」の「昭和30年(1955年)から令和X年(20XX年)国民の祝日
 * (csv形式)」 https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv(Shift_JIS)
 *
 * いつ更新するか(docs/design/work-systems.md「所定休日のカレンダー」): 内閣府の CSV は、
 * 翌年の春分の日・秋分の日が官報(国立天文台の暦要項)で公示される毎年2月ごろに翌年分が
 * 足される。祝日法の改正(祝日の新設・移動、五輪のような特例)があったときも差し替わる。
 * 年に1回、2月以降にこのスクリプトを流して差分を確認し、リリースに含める。
 *
 * 出力は日付の配列だけ(祝日の名前は持たない)。KIZAMI が祝日を使うのは「その日が所定休日か」の
 * 判定だけで、名前は画面の5言語に訳す必要が出るうえ集計には効かないため。
 * 2000年より前は捨てる(@kizami/law の基準版〔2000-01-01〕より前は計算の対象にしない)。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const FIRST_YEAR = 2000;
const packageRoot = new URL("..", import.meta.url).pathname;
const outputPath = join(packageRoot, "src", "national-holidays-data.ts");

async function loadCsvBytes() {
  const localPath = process.argv[2];
  if (localPath) return new Uint8Array(readFileSync(localPath));
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`failed to fetch ${SOURCE_URL}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const text = new TextDecoder("shift_jis").decode(await loadCsvBytes());
const dates = [];
for (const line of text.split(/\r?\n/).slice(1)) {
  const [rawDate] = line.split(",");
  if (!rawDate) continue;
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(rawDate.trim());
  if (!match) throw new Error(`unexpected line in CSV: ${line}`);
  const [, y, m, d] = match;
  if (Number(y) < FIRST_YEAR) continue;
  dates.push(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
}
dates.sort();
if (dates.length === 0) throw new Error("no holidays parsed");
const lastYear = dates[dates.length - 1].slice(0, 4);

const lines = [];
for (let i = 0; i < dates.length; i += 8) {
  lines.push(`  ${dates.slice(i, i + 8).map((d) => `"${d}"`).join(", ")},`);
}

const body = `/**
 * 国民の祝日(「国民の祝日に関する法律」の祝日と、同法3条2項・3項の休日〔振替休日・国民の休日〕)。
 *
 * **このファイルは scripts/update-national-holidays.mjs が生成する。手で編集しないこと。**
 * 出典: 内閣府「国民の祝日について」の CSV(${SOURCE_URL})。
 * 収録範囲: ${FIRST_YEAR}-01-01 〜 ${lastYear}-12-31(この範囲外の年は「データ無し」として扱う —
 * national-holidays.ts の isNationalHolidayDataAvailable 参照)。
 */

/** データを収録している最初の年 */
export const NATIONAL_HOLIDAY_DATA_FIRST_YEAR = ${FIRST_YEAR};
/** データを収録している最後の年(内閣府の CSV は毎年2月ごろに翌年分が足される) */
export const NATIONAL_HOLIDAY_DATA_LAST_YEAR = ${lastYear};

/** 祝日・休日の日付("YYYY-MM-DD")。昇順 */
export const NATIONAL_HOLIDAY_DATES: readonly string[] = [
${lines.join("\n")}
];
`;
writeFileSync(outputPath, body);
console.log(`[update-national-holidays] wrote ${dates.length} dates (${FIRST_YEAR}-${lastYear}) to ${outputPath}`);
