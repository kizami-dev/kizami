/**
 * テナントの全データのエクスポートを1つの zip にまとめる(2026-10-05、docs/design/tenant-withdrawal.md
 * 「全データのエクスポート」)。GET /tenant/export(routes/tenant-withdrawal.ts)が使う。
 *
 * ## 中身
 *
 * ```
 * README.txt                                  … 中身の説明と、法定保存の案内(日本語・英語)
 * manifest.json                               … 形式の版・出力時刻・テーブルごとの行数・除いた列とテーブル
 * data/<テーブル名>.json                       … 機械可読な全データ(@kizami/db の exportTenantData)
 * attendance/monthly/<YYYY-MM>.csv             … 月ごとの集計(GET /exports/attendance.csv の汎用CSVと同じ列・同じ値)
 * attendance/daily/<YYYY-MM>/<氏名>_<id>.csv   … 月ごと・メンバーごとの出勤簿相当(日ごとの始業・終業・労働時間)
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
 * fflate(MIT、依存なし、純粋な JS)の zipSync を使う。Node と Workers の両方で動き、バンドルに入るのは
 * zip の圧縮に要る部分だけ(数十 KB)。zip の書式を自前で書く案もあったが、CRC32 や Deflate を
 * 手で書くより、広く使われている実装に任せるほうが壊れたアーカイブを作る危険が小さい。
 *
 * ## 大きさと時間
 *
 * 全部をメモリ上で組み立てて1回の応答で返す。月次の計算は「メンバー数 × 月数」回走るので、
 * 数百人 × 数年のテナントでは数十秒かかりうる(Closed Beta の規模では問題にならない)。
 * 規模が大きくなったら、非同期のジョブにしてオブジェクトストレージ経由で渡す形に変える。
 */

import { strToU8, zipSync, type Zippable } from "fflate";
import { and, eq } from "drizzle-orm";
import { exportTenantData, leaveRequests, listTenantUsers, punchEvents, type Database, type MemberUser } from "@kizami/db";
import type { DailyBreakdown } from "@kizami/engine";
import { buildTenantMonthlyContext } from "./closing-amend.js";
import { TZ_OFFSET_MINUTES_JST } from "./settings.js";
import { nowMinutes } from "./time.js";
import { calculateMonthlyForUser } from "../reminders.js";
import { buildGenericAttendanceCsv } from "../routes/exports.js";

/** manifest.json の `format` と版。中身の形を変えたら版を上げる。 */
export const TENANT_EXPORT_FORMAT = "kizami-tenant-export";
export const TENANT_EXPORT_FORMAT_VERSION = 1;

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
    .select({ userId: punchEvents.userId, occurredAt: punchEvents.occurredAt })
    .from(punchEvents)
    .where(eq(punchEvents.tenantId, tenantId));
  for (const p of punches) {
    extend(p.userId, yearMonthOfEpochMinutes(p.occurredAt));
    extend(p.userId, yearMonthOfEpochMinutes(p.occurredAt - DAY_MINUTES));
  }
  const leaves = await db
    .select({ userId: leaveRequests.userId, leaveDate: leaveRequests.leaveDate })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "approved")));
  for (const l of leaves) extend(l.userId, l.leaveDate.slice(0, 7));
  return ranges;
}

/** RFC4180 のフィールドのエスケープ(routes/exports.ts と同じ規則)。 */
function csvField(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM + CRLF(Excel で開けるように。既存の CSV エクスポートと同じ)。 */
function buildCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean>>): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
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

export interface TenantExportArchive {
  /** zip の中身 */
  bytes: Uint8Array;
  /** Content-Disposition のファイル名 */
  filename: string;
  /** 監査ログに残す数(中身そのものは残さない) */
  summary: { tableCount: number; rowCount: number; monthlyCsvCount: number; dailyCsvCount: number };
}

/** テナントの全データの zip を作る。存在しないテナントなら null。 */
export async function buildTenantExportArchive(db: Database, params: { tenantId: string; now?: number }): Promise<TenantExportArchive | null> {
  const now = params.now ?? nowMinutes();
  const data = await exportTenantData(db, params.tenantId);
  if (!data) return null;

  const files: Zippable = { "README.txt": strToU8(README) };

  let rowCount = 0;
  for (const table of data.tables) {
    files[`data/${table.name}.json`] = strToU8(JSON.stringify(table.rows, null, 2));
    rowCount += table.rows.length;
  }

  // ---- 人が読める勤怠の記録 ----
  const currentMonth = yearMonthOfEpochMinutes(now);
  const users = await listTenantUsers(db, params.tenantId);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const ranges = await recordMonthRangeByUser(db, params.tenantId, currentMonth);

  const monthsWithRecords = new Set<YearMonth>();
  for (const range of ranges.values()) for (const ym of yearMonthRange(range.from, range.to)) monthsWithRecords.add(ym);
  const months = [...monthsWithRecords].sort();

  let monthlyCsvCount = 0;
  let dailyCsvCount = 0;
  for (const ym of months) {
    const [year, month] = ym.split("-").map(Number) as [number, number];
    const monthly = await buildGenericAttendanceCsv(db, { tenantId: params.tenantId, year, month, targetUsers: users });
    files[`attendance/monthly/${ym}.csv`] = strToU8(monthly.body);
    monthlyCsvCount += 1;

    const tenantContext = await buildTenantMonthlyContext(db, { tenantId: params.tenantId, year, month }).catch(() => undefined);
    for (const [userId, range] of ranges) {
      if (ym < range.from || ym > range.to) continue;
      const user = usersById.get(userId);
      if (!user) continue;
      try {
        const { output } = await calculateMonthlyForUser(db, { tenantId: params.tenantId, userId, year, month }, tenantContext);
        files[`attendance/daily/${ym}/${safeFileName(user.name)}_${user.id}.csv`] = strToU8(buildDailyCsv(user, output.days));
        dailyCsvCount += 1;
      } catch {
        // 制度の割当が無い等で計算できないメンバーは飛ばす(月ごとの集計の CSV と同じ方針)。
        // 打刻そのものは data/punch_events.json に必ず入っている。
      }
    }
  }

  const exportedAt = new Date(now * 60_000).toISOString();
  const manifest = {
    format: TENANT_EXPORT_FORMAT,
    formatVersion: TENANT_EXPORT_FORMAT_VERSION,
    exportedAt,
    tenantId: params.tenantId,
    timeColumns: "UTC epoch minutes (minutes since 1970-01-01T00:00:00Z)",
    tables: data.tables.map((t) => ({ name: t.name, file: `data/${t.name}.json`, rows: t.rows.length, omittedColumns: t.omittedColumns })),
    excludedTables: data.excludedTables,
    attendance: { months, monthlyCsvCount, dailyCsvCount },
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  const bytes = zipSync(files, { level: 6 });
  const stamp = exportedAt.slice(0, 10).replaceAll("-", "");
  return {
    bytes,
    filename: `kizami-export-${stamp}.zip`,
    summary: { tableCount: data.tables.length, rowCount, monthlyCsvCount, dailyCsvCount },
  };
}
