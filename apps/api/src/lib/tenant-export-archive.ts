/**
 * テナントの全データのエクスポートを1つの zip にまとめて、**流しながら**返す(2026-10-05、
 * docs/design/tenant-withdrawal.md「全データのエクスポート」。2026-10-06 にストリーミングへ変更)。
 * GET /tenant/export(routes/tenant-withdrawal.ts)が使う。
 *
 * ## 中身
 *
 * ```
 * README.txt                                  … 中身の説明と、法定保存の案内(日本語・英語)。zip の先頭
 * data/<テーブル名>.json                       … 機械可読な全データ(@kizami/db の iterateTenantExportTable)
 * attendance/monthly/<YYYY-MM>.csv             … 月ごとの集計(GET /exports/attendance.csv の汎用CSVと同じ列・同じ値)
 * attendance/daily/<YYYY-MM>/<氏名>_<id>.csv   … 月ごと・メンバーごとの出勤簿相当(日ごとの始業・終業・労働時間)
 * manifest.json                               … 形式の版・出力時刻・テーブルごとの行数・除いた列とテーブル。zip の末尾
 * ```
 *
 * 秘密(パスワード・2FA・API キー・トークンのハッシュ、暗号化した秘密情報)は data/ に入らない
 * (除外は @kizami/db の TENANT_EXPORT_POLICY が SELECT の段階で行う)。
 *
 * ## 人が読める勤怠の記録(判断点)
 *
 * - **月ごとの集計**は既存の汎用CSVをそのまま使う(routes/exports.ts の buildGenericAttendanceCsv)。
 *   締め済みの月はスナップショット、未締めの月はその場の計算という扱いも同じなので、画面から
 *   ダウンロードした CSV と1分も違わない
 * - **出勤簿相当**(日ごとの始業・終業・労働時間・休憩・深夜・法定休日・有給)は、既存のエクスポートに
 *   日単位の CSV が無いため、月次の画面と同じ計算(calculateMonthlyForUser)の日別の内訳から作る。
 *   打刻の修正は反映した「今の記録」で、締め後の修正も含む(締めた時点の数字は月ごとの集計の側にある)
 * - 対象の月は、そのメンバーの打刻・休暇がある最初の月から最後の月まで(今月まで)を**途切れなく**出す。
 *   勤務の無い月も、「その月は勤務が無かった」ことが分かる出勤簿として残す
 *
 * ## zip の作り方(依存の判断)
 *
 * fflate(MIT、依存なし、純粋な JS)のストリーミング API(`Zip` + `ZipDeflate`、同期の Deflate)を使う。
 * Node と Workers の両方で動き、バンドルに入るのは zip の圧縮に要る部分だけ(数十 KB)。
 * `AsyncZipDeflate` などの非同期版は Worker スレッド(Node の worker_threads / ブラウザの Worker)に
 * 依存し、Node と Workers で同じには動かないので使わない。zip の書式を自前で書く案もあったが、CRC32 や
 * Deflate を手で書くより、広く使われている実装に任せるほうが壊れたアーカイブを作る危険が小さい。
 *
 * ## 大きさと時間 — 流しながら作る(判断点、2026-10-06)
 *
 * 当初は全テーブルの全行を読み、全ファイルの文字列を作ってから zipSync していた。50人 × 3年
 * (約17万行・zip 内 1,929 ファイル・6.3 MB)で RSS が約 580 MB 増え、200人 × 3年では約 1.85 GB
 * (Apple M4 の計測)。ホスト版の API コンテナの上限は 512Mi なので、最大規模のテナントが1回
 * エクスポートすると API ごと OOM で落ち、全テナントに影響する。時間(4秒・18秒)は問題ではなかった。
 *
 * そこで全体を**引っぱり型のストリーム**にした:
 *
 * - zip に入れる中身を async generator で1ファイルずつ・1断片ずつ作り(`exportEntries`)、それを
 *   fflate の `Zip` に流して出てきたバイト列を、`ReadableStream` の `pull()` ごとに1つ渡す
 *   (`zipChunks` / `toReadableStream`)。HTTP の相手が読んだ分だけ次を作るので、相手が遅ければ
 *   こちらも止まる(背圧)。Node(@hono/node-server)はソケットの drain を待ってから次を読む
 * - data/<テーブル>.json は主キーの keyset ページングで `TENANT_EXPORT_DEFAULT_BATCH_SIZE` 行ずつ読み、
 *   ページごとに書き出す(`[` + 行を `,` でつないだもの + `]`)。書式は従来の
 *   `JSON.stringify(rows, null, 2)` と**1バイトも違わない**(テストで突き合わせている)
 * - 出勤簿相当は「月 → メンバー」の順に1か月・1人ずつ計算して、すぐに zip へ流す。全員分の内訳を
 *   溜めない。月ごとの文脈(buildTenantMonthlyContext: 法令・手当・設定のタイムラインと制度の版)は
 *   テナント単位の小さなもので、打刻の量に比例しないので月ごとに1回読む(従来どおり)
 * - メンバーごとの「記録がある月」の範囲は、打刻を全件読まずに `GROUP BY user_id` の MIN/MAX で求める
 * - manifest.json は行数を数え終えてから書くので zip の**末尾**に置く(zip の読み手は中央ディレクトリ
 *   から引くので、順序に意味は無い)。README.txt は先頭
 * - Content-Length は付けない(作り終えるまで大きさが分からない)
 *
 * - data/ の keyset ページングが効くよう、行の多いテーブル(打刻・締め・申請・通知・シフトの日)に
 *   `(tenant_id, id)` の索引を足した(migrations 0038 / migrations-pg 0013。audit_logs には元からある)。
 *   無いと各ページがテナントの全行を読んで並べ直し、200人 × 3年の SQLite で data/ だけに 30 秒かかった
 *
 * 計測(Apple M4、Node 26。RSS は /usr/bin/time -l の最大 RSS から、同じスクリプトでエクスポート
 * しない回の値を引いたもの。数字は docs/design/tenant-withdrawal.md §4 にも載せる):
 *
 * | 規模(50人 × 3年 = 約17万行・1,878 ファイル、200人は約67万行・7,278 ファイル) | 従来(zipSync) | ストリーミング |
 * | --- | --- | --- |
 * | PostgreSQL 50人 × 3年 | +270〜285 MB・6 秒 | +10〜20 MB・6 秒 |
 * | PostgreSQL 200人 × 3年 | +1.35 GB・18 秒 | +13 MB・23 秒 |
 * | SQLite 50人 × 3年 | +380〜420 MB・4.5 秒 | +90〜120 MB・4 秒 |
 * | SQLite 200人 × 3年 | +1.27 GB・18 秒 | +285 MB・17 秒 |
 *
 * JS のヒープの使用量は規模によらず約 40〜70 MB の増分で頭打ちになる。SQLite で RSS が規模とともに
 * 増えるのは @libsql/client のネイティブ側の文(statement)のメモリで、JS の側のオブジェクトが
 * 小さいので V8 が大きな GC をなかなか走らせず、解放が遅れるもの(gc() を明示的に呼ぶと戻る
 * ことを確かめた。エクスポートに限らず、問い合わせを大量に続けると同じように見える)。
 * ホスト版は PostgreSQL(pg は純粋な JS)なのでこの影響を受けない。
 * Cloudflare の 100 秒の制限は最初の1バイトまでの時間なので、流し始めてしまえば規模による
 * 時間の上限も実質なくなる。
 *
 * ## 同時に1本まで(判断点)
 *
 * エクスポートは**プロセス全体で同時に1本**まで(`tryAcquireTenantExportSlot`)。2本目は
 * 429 `export_busy` + `Retry-After: 30`。1本あたりのメモリは上のとおり小さくなったが、同時に何本も
 * 走ると重い計算(月次の再計算)と DB の読み出しが重なり、上限 512Mi のコンテナを圧迫する。
 * エクスポートは退会の前などにまれに使うもので、待たせても実害が小さい。テナントごとではなく
 * プロセス全体にするのは、守りたいのがプロセスのメモリだから。Workers では isolate ごとの枠になる。
 *
 * 枠は、ストリームが最後まで流れた・途中で失敗した・相手が切った(`cancel()`)のいずれでも返す。
 * 相手が接続を開いたまま読まない場合に枠を握り続けないよう、`TENANT_EXPORT_IDLE_TIMEOUT_MS` の間
 * 1バイトも読まれなければストリームを打ち切る(他のテナントのエクスポートを止められないように)。
 *
 * ## 途中で失敗したとき
 *
 * 応答のヘッダー(200)は送った後なので、ステータスでは伝えられない。ストリームをエラーにして
 * 接続を切り(相手からはダウンロードの失敗に見える。zip の末尾の中央ディレクトリが無いので、壊れた
 * zip を正しいものと取り違えることもない)、console.error に残す。
 */

import { deflateSync, strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { and, eq, max, min } from "drizzle-orm";
import {
  iterateTenantExportTable,
  leaveRequests,
  listTenantExportTables,
  listTenantUsers,
  punchEvents,
  type Database,
  type MemberUser,
} from "@kizami/db";
import type { DailyBreakdown } from "@kizami/engine";
import { buildTenantMonthlyContext } from "./closing-amend.js";
import { buildCsvRow } from "./csv.js";
import { TZ_OFFSET_MINUTES_JST } from "./settings.js";
import { calculateMonthlyForUser } from "../reminders.js";
import { buildGenericAttendanceCsv } from "../routes/exports.js";

/** manifest.json の `format` と版。中身の形を変えたら版を上げる。 */
export const TENANT_EXPORT_FORMAT = "kizami-tenant-export";
export const TENANT_EXPORT_FORMAT_VERSION = 1;

/** この間、相手が1バイトも読まなければストリームを打ち切って枠を返す(ミリ秒)。 */
export const TENANT_EXPORT_IDLE_TIMEOUT_MS = 5 * 60_000;

/** 2本目のエクスポートに返す Retry-After(秒)。 */
export const TENANT_EXPORT_RETRY_AFTER_SECONDS = 30;

const DAY_MINUTES = 24 * 60;

/** 年月("YYYY-MM")。 */
type YearMonth = string;

function yearMonthOfEpochMinutes(minutes: number): YearMonth {
  return new Date((minutes + TZ_OFFSET_MINUTES_JST) * 60_000).toISOString().slice(0, 7);
}

function nextYearMonth(ym: YearMonth): YearMonth {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** from 〜 to(両端を含む)の年月を途切れなく並べる。 */
function yearMonthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  const result: YearMonth[] = [];
  for (let ym = from; ym <= to; ym = nextYearMonth(ym)) result.push(ym);
  return result;
}

/**
 * メンバーごとの「記録がある月」の範囲(最初の月と最後の月)。打刻の時刻は日本時間の暦月で数えるが、
 * 日界(既定0時、設定で深夜にずらせる)をまたぐ打刻は前日の勤怠に入りうるので、1日前の月も範囲に含める。
 *
 * 打刻を全件読むと 50人 × 3年で約17万行になるので、メンバーごとの最初と最後の時刻だけを
 * `GROUP BY user_id` で読む。年月への変換は単調なので、「各打刻の月(と1日前の月)の最小・最大」は
 * 「最初の打刻の1日前の月」と「最後の打刻の月」に等しい(今月で頭打ちにするのも単調なので順序を変えない)。
 */
async function recordMonthRangeByUser(db: Database, tenantId: string, currentMonth: YearMonth): Promise<Map<string, { from: YearMonth; to: YearMonth }>> {
  const ranges = new Map<string, { from: YearMonth; to: YearMonth }>();
  const extend = (userId: string, ym: YearMonth) => {
    const capped = ym > currentMonth ? currentMonth : ym;
    const range = ranges.get(userId);
    if (!range) ranges.set(userId, { from: capped, to: capped });
    else {
      if (capped < range.from) range.from = capped;
      if (capped > range.to) range.to = capped;
    }
  };
  const punches = await db
    .select({ userId: punchEvents.userId, first: min(punchEvents.occurredAt), last: max(punchEvents.occurredAt) })
    .from(punchEvents)
    .where(eq(punchEvents.tenantId, tenantId))
    .groupBy(punchEvents.userId);
  for (const p of punches) {
    if (p.first === null || p.last === null) continue;
    extend(p.userId, yearMonthOfEpochMinutes(Number(p.first) - DAY_MINUTES));
    extend(p.userId, yearMonthOfEpochMinutes(Number(p.last)));
  }
  const leaves = await db
    .select({ userId: leaveRequests.userId, first: min(leaveRequests.leaveDate), last: max(leaveRequests.leaveDate) })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "approved")))
    .groupBy(leaveRequests.userId);
  for (const l of leaves) {
    if (l.first === null || l.last === null) continue;
    extend(l.userId, l.first.slice(0, 7));
    extend(l.userId, l.last.slice(0, 7));
  }
  return ranges;
}

/**
 * UTF-8 BOM + CRLF(Excel で開けるように。既存の CSV エクスポートと同じ)。フィールドは lib/csv.ts の
 * buildCsvRow を通す — 氏名などの入力値が数式として評価されないよう無害化する(数値の列は変えない)。
 */
function buildCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean>>): string {
  return "﻿" + [header, ...rows].map((r) => buildCsvRow(r)).join("\r\n") + "\r\n";
}

/** UTC エポック分 → 日本時間の "YYYY-MM-DD HH:mm"。 */
function localDateTime(minutes: number): string {
  return new Date((minutes + TZ_OFFSET_MINUTES_JST) * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

const DAILY_CSV_HEADER = [
  "user_id",
  "user_name",
  "date",
  "clock_in",
  "clock_out",
  "work_stretches",
  "worked_minutes",
  "break_minutes",
  "auto_deducted_break_minutes",
  "late_night_minutes",
  "is_legal_holiday",
  "legal_holiday_minutes",
  "paid_leave_minutes",
] as const;

/** 出勤簿相当の1か月分(日ごとの行)。 */
function buildDailyCsv(user: MemberUser, days: readonly DailyBreakdown[]): string {
  const rows = days.map((day) => {
    const first = day.stretches[0];
    const last = day.stretches[day.stretches.length - 1];
    const stretches = day.stretches
      .map((s) => `${localDateTime(s.clockInAt)}-${s.clockOutAt === null ? "" : localDateTime(s.clockOutAt)}`)
      .join(" / ");
    return [
      user.id,
      user.name,
      day.date,
      first ? localDateTime(first.clockInAt) : "",
      last && last.clockOutAt !== null ? localDateTime(last.clockOutAt) : "",
      stretches,
      day.workedMinutes,
      day.breakMinutes,
      day.autoDeductedBreakMinutes,
      day.lateNightMinutes,
      day.isLegalHoliday,
      day.legalHolidayMinutes,
      day.paidLeaveMinutes,
    ];
  });
  return buildCsv(DAILY_CSV_HEADER, rows);
}

/** zip 内のファイル名に使える形へ(パス区切り・制御文字・Windows で使えない文字を _ に)。 */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").trim();
  return cleaned === "" ? "_" : cleaned.slice(0, 60);
}

const README = `KIZAMI テナントの全データのエクスポート / KIZAMI tenant data export
====================================================================

■ 中身
- manifest.json: 形式の版、出力の時刻、テーブルごとの行数、出力から除いた列とテーブル
- data/<テーブル名>.json: すべてのデータ(列名は KIZAMI のデータベースの列名のまま)。
  時刻の列は UTC のエポック分(1970-01-01 00:00 UTC からの分数)です。
- attendance/monthly/<年月>.csv: 月ごとの勤怠の集計(画面からダウンロードできる汎用CSVと同じ列)。
  締め済みの月は、締めた時点の数字です。
- attendance/daily/<年月>/<氏名>_<id>.csv: メンバーごと・月ごとの出勤簿相当
  (日ごとの始業・終業の時刻〔日本時間〕・労働時間・休憩・深夜・法定休日・有給、時間は分)。

■ 含まれないもの
パスワード・二要素認証・API キー・各種トークンのハッシュ、暗号化して保存している秘密情報
(Webhook の URL、SMTP のパスワード、SSO・Slack の秘密)は含みません。詳しくは manifest.json を見てください。

■ 保存の義務について
労働基準法109条により、出勤簿などの労働関係に関する重要な書類は、事業主が5年間
(令和2年改正法の附則による経過措置により、当分の間は3年間)保存しなければなりません。
この保存義務は事業主の義務であり、KIZAMI からデータを削除してもなくなりません。
このファイルは安全な場所に保管してください。全員分の個人情報が含まれています。

----

Contents: manifest.json (format version, row counts, omitted columns/tables), data/<table>.json
(all rows, database column names, times in UTC epoch minutes), attendance/monthly/<YYYY-MM>.csv
(monthly totals, same columns as the generic CSV export), attendance/daily/<YYYY-MM>/<name>_<id>.csv
(per-member daily attendance records, local time JST). Password, 2FA, API key and token hashes and
encrypted secrets are not included. Under Article 109 of the Labor Standards Act, the employer must keep
attendance records for 5 years (3 years for the time being under the transitional provision); deleting
data from KIZAMI does not remove that obligation. This file contains personal data of all members.
`;

/** 出し終えたときの数(manifest に書くのと同じもの。完了のログに使う)。 */
export interface TenantExportSummary {
  tableCount: number;
  rowCount: number;
  monthlyCsvCount: number;
  dailyCsvCount: number;
}

/** zip に入れる1ファイル。中身は一度に渡すか、断片の列で渡す(断片ごとに zip へ流す)。 */
interface ExportEntry {
  path: string;
  body: string | AsyncIterable<string>;
}

/**
 * 1テーブル分の data/<テーブル>.json の断片。`JSON.stringify(rows, null, 2)` と同じバイト列を、
 * ページ(batchSize 行)ごとに作る。1行を単独で整形して各行の頭に2つ空白を足すと、配列の中で
 * 整形したものと一致する(JSON の文字列の中に生の改行は現れないので、改行の置き換えは安全)。
 */
async function* tableJsonChunks(
  db: Database,
  tenantId: string,
  tableName: string,
  batchSize: number | undefined,
  counter: { rows: number },
): AsyncGenerator<string> {
  let first = true;
  for await (const batch of iterateTenantExportTable(db, tenantId, tableName, batchSize === undefined ? {} : { batchSize })) {
    const body = batch.map((row) => JSON.stringify(row, null, 2).replaceAll("\n", "\n  ")).join(",\n  ");
    yield (first ? "[\n  " : ",\n  ") + body;
    first = false;
    counter.rows += batch.length;
  }
  yield first ? "[]" : "\n]";
}

/**
 * zip に入れるファイルを先頭から順に作る。呼び出し側(zipChunks)が前のファイルの中身を流し終えてから
 * 次を求めるので、ここで持つのは「今のファイル」の分だけ。
 */
async function* exportEntries(
  db: Database,
  params: { tenantId: string; now: number; batchSize?: number; onSummary: (summary: TenantExportSummary) => void },
): AsyncGenerator<ExportEntry> {
  const { tenantId, now } = params;
  yield { path: "README.txt", body: README };

  const { tables, excludedTables } = listTenantExportTables();
  const counters = tables.map(() => ({ rows: 0 }));
  for (const [i, table] of tables.entries()) {
    yield { path: `data/${table.name}.json`, body: tableJsonChunks(db, tenantId, table.name, params.batchSize, counters[i]!) };
  }

  // ---- 人が読める勤怠の記録 ----
  const currentMonth = yearMonthOfEpochMinutes(now);
  const users = await listTenantUsers(db, tenantId);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const ranges = await recordMonthRangeByUser(db, tenantId, currentMonth);

  const monthsWithRecords = new Set<YearMonth>();
  for (const range of ranges.values()) for (const ym of yearMonthRange(range.from, range.to)) monthsWithRecords.add(ym);
  const months = [...monthsWithRecords].sort();

  let monthlyCsvCount = 0;
  let dailyCsvCount = 0;
  for (const ym of months) {
    const [year, month] = ym.split("-").map(Number) as [number, number];
    const monthly = await buildGenericAttendanceCsv(db, { tenantId, year, month, targetUsers: users });
    yield { path: `attendance/monthly/${ym}.csv`, body: monthly.body };
    monthlyCsvCount += 1;

    // テナント単位・月単位の文脈(打刻の量には比例しない)。メンバーの間で使い回す
    const tenantContext = await buildTenantMonthlyContext(db, { tenantId, year, month }).catch(() => undefined);
    for (const [userId, range] of ranges) {
      if (ym < range.from || ym > range.to) continue;
      const user = usersById.get(userId);
      if (!user) continue;
      let csv: string;
      try {
        const { output } = await calculateMonthlyForUser(db, { tenantId, userId, year, month }, tenantContext);
        csv = buildDailyCsv(user, output.days);
      } catch {
        // 制度の割当が無い等で計算できないメンバーは飛ばす(月ごとの集計の CSV と同じ方針)。
        // 打刻そのものは data/punch_events.json に必ず入っている。
        continue;
      }
      yield { path: `attendance/daily/${ym}/${safeFileName(user.name)}_${user.id}.csv`, body: csv };
      dailyCsvCount += 1;
    }
  }

  // ---- 行数を数え終えたので、最後に manifest ----
  const rowCount = counters.reduce((sum, c) => sum + c.rows, 0);
  const manifest = {
    format: TENANT_EXPORT_FORMAT,
    formatVersion: TENANT_EXPORT_FORMAT_VERSION,
    exportedAt: new Date(now * 60_000).toISOString(),
    tenantId,
    timeColumns: "UTC epoch minutes (minutes since 1970-01-01T00:00:00Z)",
    tables: tables.map((t, i) => ({ name: t.name, file: `data/${t.name}.json`, rows: counters[i]!.rows, omittedColumns: t.omittedColumns })),
    excludedTables,
    attendance: { months, monthlyCsvCount, dailyCsvCount },
  };
  yield { path: "manifest.json", body: JSON.stringify(manifest, null, 2) };
  params.onSummary({ tableCount: tables.length, rowCount, monthlyCsvCount, dailyCsvCount });
}

/** zip の圧縮の水準(従来の zipSync と同じ)。 */
const ZIP_LEVEL = 6;

/**
 * 中身を一度に渡すファイル(README・CSV・manifest)の zip の項目。fflate の文書にある拡張の仕方
 * (ZipPassThrough を継いで process を差し替える)で、deflateSync の結果をそのまま流す。
 *
 * 判断点: ZipDeflate(ストリーミングの Deflate)は1ファイルごとに 96 KB の作業用バッファと
 * 探索表を確保する。出勤簿相当は 200人 × 3年で 7,200 ファイルあり、すぐに捨てられるとはいえ
 * ガベージコレクションが追いつく前にプロセスの RSS が数百 MB 膨らんだ(計測)。数 KB の CSV に
 * 要るのは中身の大きさに見合った分だけなので、一度に圧縮する deflateSync を使う(従来の zipSync も
 * 中で deflateSync を使っていたので、圧縮の結果も同じ)。
 */
class ZipDeflateWhole extends ZipPassThrough {
  flag: 0 | 1 | 2 | 3 = 0; // level 6 の「通常」の圧縮(fflate の ZipDeflate と同じ値)

  constructor(filename: string) {
    super(filename);
    this.compression = 8;
  }

  protected override process(chunk: Uint8Array<ArrayBuffer>, final: boolean): void {
    // 呼び出し側は1回の push(final: true)で全体を渡す(zipChunks)
    this.ondata(null, deflateSync(chunk, { level: ZIP_LEVEL }), final);
  }
}

/**
 * ファイルの列を fflate の Zip に流し、出てきた zip のバイト列を返す。fflate は push の中で同期的に
 * コールバックを呼ぶので、溜まった分を push のたびに取り出して返す(1回に返すのは、断片1つを圧縮した
 * 分 + ヘッダー程度)。
 */
async function* zipChunks(entries: AsyncIterable<ExportEntry>): AsyncGenerator<Uint8Array> {
  let pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else pending.push(chunk);
  });
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    if (pending.length === 0) return;
    const out = pending.length === 1 ? pending[0]! : concat(pending);
    pending = [];
    yield out;
  }

  for await (const entry of entries) {
    if (typeof entry.body === "string") {
      const file = new ZipDeflateWhole(entry.path);
      zip.add(file);
      file.push(strToU8(entry.body), true);
    } else {
      const file = new ZipDeflate(entry.path, { level: ZIP_LEVEL });
      zip.add(file);
      for await (const part of entry.body) {
        file.push(strToU8(part));
        yield* drain();
      }
      file.push(new Uint8Array(0), true);
    }
    yield* drain();
  }
  zip.end();
  yield* drain();
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// ---- 同時に1本まで(ファイル冒頭の判断点) ----

let exportInFlight = false;

/**
 * エクスポートの枠を取る。空いていなければ null。取れたら、返した関数で返す(何度呼んでもよい)。
 * ストリームを作った後は、ストリームが終わる・失敗する・切られるときに返すので、呼び出し側が
 * 返すのはストリームを作る前に失敗したときだけ。
 */
export function tryAcquireTenantExportSlot(): (() => void) | null {
  if (exportInFlight) return null;
  exportInFlight = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    exportInFlight = false;
  };
}

/**
 * async generator を、pull ごとに1つ進める ReadableStream にする。終わり・失敗・cancel・読まれないまま
 * の打ち切りのいずれでも `release` を1回呼ぶ。
 */
function toReadableStream(
  source: AsyncGenerator<Uint8Array>,
  options: { release: () => void; idleTimeoutMs: number; tenantId: string },
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let cancelled = false;
  const finish = () => {
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    options.release();
  };
  const armIdleTimer = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      if (finished) return;
      console.error(`tenant export: aborted after ${options.idleTimeoutMs} ms without reads (tenant ${options.tenantId})`);
      finish();
      controller.error(new Error("tenant export: idle timeout"));
      // generator は yield で止まっている(pull の最中ではない)ので、return で finally まで閉じる
      source.return(undefined).catch(() => {});
    }, options.idleTimeoutMs);
    // Node でこのタイマーだけのためにプロセスを生かしておかない(Workers には unref が無い)
    (timer as { unref?: () => void }).unref?.();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        armIdleTimer(controller);
      },
      async pull(controller) {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        try {
          for (;;) {
            const next = await source.next();
            if (finished || cancelled) return; // 待っている間に cancel された・打ち切った
            if (next.done) {
              finish();
              controller.close();
              return;
            }
            if (next.value.byteLength > 0) {
              controller.enqueue(next.value);
              break;
            }
          }
          armIdleTimer(controller);
        } catch (err) {
          if (cancelled) return;
          // ヘッダーは送った後なので、接続を切って伝える(ファイル冒頭「途中で失敗したとき」)
          console.error(`tenant export: failed while streaming (tenant ${options.tenantId}):`, err);
          if (!finished) {
            finish();
            controller.error(err);
          }
        }
      },
      async cancel() {
        // 相手が切った。generator を閉じてから枠を返す(閉じ終わる前に次のエクスポートを始めない)
        cancelled = true;
        if (timer !== undefined) clearTimeout(timer);
        try {
          await source.return(undefined);
        } catch {
          // 閉じる途中の失敗は、もう伝える相手がいない
        } finally {
          finish();
        }
      },
    },
    // 1つ先まで作っておく(相手が読む間に次の断片を用意する)。それ以上は作らない
    { highWaterMark: 1 },
  );
}

/**
 * テナントの全データの zip を流すストリームを作る。テナントの存在の確認と枠の取得は呼び出し側
 * (routes/tenant-withdrawal.ts)が先に済ませる。枠(`release`)はストリームの終わりに返す。
 */
export function createTenantExportStream(
  db: Database,
  params: {
    tenantId: string;
    now: number;
    release: () => void;
    /** テスト用: data/<テーブル>.json の1ページの行数 */
    batchSize?: number;
    /** テスト用: 読まれないまま打ち切るまでの時間 */
    idleTimeoutMs?: number;
    /** 最後まで出し終えたときに呼ぶ(既定はログに数を出す) */
    onComplete?: (summary: TenantExportSummary) => void;
  },
): { stream: ReadableStream<Uint8Array>; filename: string } {
  const exportedAt = new Date(params.now * 60_000).toISOString();
  const onComplete =
    params.onComplete ??
    ((summary: TenantExportSummary) => {
      console.info(`tenant export: completed (tenant ${params.tenantId})`, JSON.stringify(summary));
    });
  const entries = exportEntries(db, {
    tenantId: params.tenantId,
    now: params.now,
    ...(params.batchSize === undefined ? {} : { batchSize: params.batchSize }),
    onSummary: onComplete,
  });
  const stream = toReadableStream(zipChunks(entries), {
    release: params.release,
    idleTimeoutMs: params.idleTimeoutMs ?? TENANT_EXPORT_IDLE_TIMEOUT_MS,
    tenantId: params.tenantId,
  });
  return { stream, filename: `kizami-export-${exportedAt.slice(0, 10).replaceAll("-", "")}.zip` };
}
