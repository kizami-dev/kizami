/**
 * GET /exports/attendance.csv?month=YYYY-MM[&compare=original]
 *
 * 汎用CSVエクスポート(v0.3 第一弾)。参照: docs/requirements.md §6(締めと出口)、
 * docs/design/permission-catalog.md §1.6(エクスポート)。
 *
 * 権限: `export.attendance.run`(スコープ department/department_and_descendants/tenant)。
 * apps/api/src/lib/scope.ts の resolveAccessibleUserIds() で「実際にどのユーザーを出力できるか」
 * を絞り込む(members.ts と同じ窓口を使う — スコープ判定ロジックの重複を避ける)。
 *
 * 締め済み月はスナップショットから、未締めはオンデマンド計算(calculateMonthlyForUser)から
 * 値を組み立てる(依頼の禁止事項: 締め済み月の集計は必ずスナップショット経由)。
 *
 * 締め後修正(amend, v0.4): `?compare=original` を付けると、区分別時間数5種 + flex収支3種の
 * 各列について「当初の確定値(original_*_minutes)」と「最新値との差分(diff_*_minutes、
 * 最新−当初)」を追加する(給与の差額調整に必須 — 依頼)。amend が無い月(未締め、または
 * 締め済みだが未修正)は original = 最新、diff = 0 になる。
 *
 * 固定時間制対応(2026-08-23):
 * - `work_system` 列(flex/fixed)を追加。締め済み月は snapshot に flex 系の行が
 *   1つも無ければ fixed と判定する(engineOutputFromSnapshots の契約 — closing-snapshot.ts
 *   参照)。未締め月は calculate() の workSystem をそのまま使う
 * - 既存の flex 3列は固定時間制の行では空文字にする(0 と「存在しない」を区別するため。
 *   apps/api/src/lib/closing-snapshot.ts と同じ判断)
 * - `fixed_within_scheduled_minutes` / `fixed_extra_within_statutory_minutes`(月合計)を追加。
 *   EngineOutput.totals にはこの粒度が無い(所定内と法定内残業を分けて持たない)ため、未締め月は
 *   output.days から、締め済み月は closing_snapshots の fixedWithinScheduled/
 *   fixedExtraWithinStatutory 区分(CLOSING_SNAPSHOT_CATEGORIES に追加済み)から、それぞれ
 *   値を出す。フレックスの月(または締め時点で対象ユーザーの行が皆無だった月)はこの2列を
 *   空文字にする(0 と「存在しない」を区別する既存の判断と同じ)。列自体は work_system に
 *   よらず常に存在させ、中身だけ制度・締め状態に応じて空にする(依頼: 列数を制度で変えない)
 * - `compare=original` の original_ / diff_ 系にも fixed_ 系の列を追加する(締め済み月から
 *   取れるようになったため。既存の5区分+flex3種と同じ original_ / diff_ 構成の対称性を保つ
 *   ための判断 — 詳細は本ファイルの実装コメント参照)
 *
 * CSV は UTF-8 BOM 付き・CRLF 改行(Excel 対応、依頼どおり)。
 */

import { Hono } from "hono";
import {
  getClosingSnapshotsForUsers,
  getClosingState,
  getOriginalClosingSnapshotsForUsers,
  insertAuditLog,
  listTenantUsers,
  type Database,
  type MemberUser,
} from "@kizami/db";
import type { CategorizedMinutes, EngineOutput, FlexBalance } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { buildAllowanceTimeline, resolveAllowanceColumnsForPeriod, type AllowanceColumn } from "../lib/allowances.js";
import { engineOutputFromSnapshots, sumFixedBreakdown, type SnapshotTotals } from "../lib/closing-snapshot.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { dateFromEpochDay, daysInMonth, epochDayFromDate, formatDate, nowMinutes, parseMonthParam } from "../lib/time.js";
import { calculateMonthlyForUser } from "../reminders.js";

const EXPORT_PERMISSION = "export.attendance.run";

/**
 * `closed` 列より前の固定列。手当の列(allowance_<name>、テナント・期間ごとに動的)は
 * この後・`closed` の前に挿入する(docs/design/allowances.md「CSVエクスポート」)。
 * 分割しているのは、動的な列を `closed` より前に差し込む必要があり、1本の定数配列のままでは
 * 挿入位置を毎回スライスで探すことになり分かりにくいため。
 */
const BASE_CSV_HEADER_BEFORE_ALLOWANCES = [
  "user_id",
  "user_name",
  "email",
  "period",
  "statutory_minutes",
  "overtime_minutes",
  "overtime60h_minutes",
  "late_night_minutes",
  "statutory_holiday_minutes",
  "work_system",
  "flex_frame_minutes",
  "flex_actual_minutes",
  "flex_diff_minutes",
  "fixed_within_scheduled_minutes",
  "fixed_extra_within_statutory_minutes",
];
const CLOSED_COLUMN = "closed";

/**
 * ?compare=original のときだけ末尾に追加する列。区分別5種+flex3種+固定内訳2種それぞれに
 * original_ と diff_ の列を持つ(BASE_CSV_HEADER の値列と同じ並び・同じ10種で揃える)。
 */
const COMPARE_CSV_HEADER = [
  "original_statutory_minutes",
  "original_overtime_minutes",
  "original_overtime60h_minutes",
  "original_late_night_minutes",
  "original_statutory_holiday_minutes",
  "original_flex_frame_minutes",
  "original_flex_actual_minutes",
  "original_flex_diff_minutes",
  "original_fixed_within_scheduled_minutes",
  "original_fixed_extra_within_statutory_minutes",
  "diff_statutory_minutes",
  "diff_overtime_minutes",
  "diff_overtime60h_minutes",
  "diff_late_night_minutes",
  "diff_statutory_holiday_minutes",
  "diff_flex_frame_minutes",
  "diff_flex_actual_minutes",
  "diff_flex_diff_minutes",
  "diff_fixed_within_scheduled_minutes",
  "diff_fixed_extra_within_statutory_minutes",
];

/** RFC4180 準拠のフィールドエスケープ(カンマ・ダブルクォート・改行を含む場合のみ引用符で囲む)。 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsvRow(fields: Array<string | number | boolean>): string {
  return fields.map((f) => escapeCsvField(String(f))).join(",");
}

/**
 * CSV 1行分の入力。`flexBalance` はフレックス以外(固定時間制、または締め済みで snapshot に
 * flex 系の行が無い)なら null。`fixedWithinScheduledMinutes`/`fixedExtraWithinStatutoryMinutes`
 * も同じ理由で固定時間制以外なら null(closing-snapshot.ts の FixedBreakdownTotals と同じ設計)。
 * `workSystem` は列の出し分け自体には使わない(flexBalance/fixed* の null 判定だけで足りる)が、
 * 読み手が「なぜ空欄か」を判断できるようそのまま1列として出力する。
 */
interface MonthlyFigures {
  totals: CategorizedMinutes;
  flexBalance: FlexBalance | null;
  workSystem: "flex" | "fixed";
  fixedWithinScheduledMinutes: number | null;
  fixedExtraWithinStatutoryMinutes: number | null;
  /** 手当定義ごとの月合計(分)。docs/design/allowances.md「CSVエクスポート」 */
  allowanceTotals: Array<{ definitionId: string; minutes: number }>;
}

interface RowInput {
  user: MemberUser;
  period: string;
  current: MonthlyFigures;
  closed: boolean;
  /** compare=original のときのみ渡す。当初の確定値(amend が無ければ current と同じ値)。 */
  original?: MonthlyFigures | undefined;
}

/** 空文字を許容する CSV フィールド(null/未取得の意味で使う)。 */
type CsvField = string | number | boolean;

function orEmpty(value: number | null): CsvField {
  return value === null ? "" : value;
}

/** 手当の月合計を、CSV の列順(columns、definitionId 昇順で固定済み)に沿って並べる。 */
function allowanceFieldsForColumns(allowanceTotals: MonthlyFigures["allowanceTotals"], columns: readonly AllowanceColumn[]): number[] {
  const byDefinitionId = new Map(allowanceTotals.map((t) => [t.definitionId, t.minutes]));
  // その月の集計に無い定義(締め済みスナップショットが古く、後から追加された定義の列に
  // 対応する行が無い等)は 0 分として埋める — 列自体は同一 CSV 内で常に存在させるため
  // (compare=original の fixed/flex 列と同じ「列数を状況で変えない」方針)。
  return columns.map((col) => byDefinitionId.get(col.definitionId) ?? 0);
}

function buildRow({ user, period, current, closed, original, columns }: RowInput & { columns: readonly AllowanceColumn[] }): string {
  const fields: CsvField[] = [
    user.id,
    user.name,
    user.email,
    period,
    current.totals.statutory,
    current.totals.overtime,
    current.totals.overtime60h,
    current.totals.lateNight,
    current.totals.statutoryHoliday,
    current.workSystem,
    orEmpty(current.flexBalance?.frameMinutes ?? null),
    orEmpty(current.flexBalance?.actualMinutes ?? null),
    orEmpty(current.flexBalance?.diffMinutes ?? null),
    orEmpty(current.fixedWithinScheduledMinutes),
    orEmpty(current.fixedExtraWithinStatutoryMinutes),
    ...allowanceFieldsForColumns(current.allowanceTotals, columns),
    closed,
  ];

  if (original) {
    // 現在・当初どちらかが flexBalance を持たない(制度が違う、または締め済みでflex行が無い)
    // 場合は差分を計算できないため空文字にする(0 と書くと「変化なし」に見えてしまう)。
    const diffFlex = (pick: (f: MonthlyFigures) => number | undefined): CsvField => {
      const c = pick(current);
      const o = pick(original);
      return c !== undefined && o !== undefined ? c - o : "";
    };
    // fixed 系は元々 number | null で持っているため diffFlex とは undefined/null が違うだけで
    // 考え方は同じ(どちらかが null なら差分計算不能 = 空文字)。
    const diffFixed = (pick: (f: MonthlyFigures) => number | null): CsvField => {
      const c = pick(current);
      const o = pick(original);
      return c !== null && o !== null ? c - o : "";
    };
    fields.push(
      original.totals.statutory,
      original.totals.overtime,
      original.totals.overtime60h,
      original.totals.lateNight,
      original.totals.statutoryHoliday,
      orEmpty(original.flexBalance?.frameMinutes ?? null),
      orEmpty(original.flexBalance?.actualMinutes ?? null),
      orEmpty(original.flexBalance?.diffMinutes ?? null),
      orEmpty(original.fixedWithinScheduledMinutes),
      orEmpty(original.fixedExtraWithinStatutoryMinutes),
      current.totals.statutory - original.totals.statutory,
      current.totals.overtime - original.totals.overtime,
      current.totals.overtime60h - original.totals.overtime60h,
      current.totals.lateNight - original.totals.lateNight,
      current.totals.statutoryHoliday - original.totals.statutoryHoliday,
      diffFlex((f) => f.flexBalance?.frameMinutes),
      diffFlex((f) => f.flexBalance?.actualMinutes),
      diffFlex((f) => f.flexBalance?.diffMinutes),
      diffFixed((f) => f.fixedWithinScheduledMinutes),
      diffFixed((f) => f.fixedExtraWithinStatutoryMinutes),
    );
  }

  return buildCsvRow(fields);
}

/** 締め済み月: snapshot から読み戻した値を MonthlyFigures へ変換する。 */
function monthlyFiguresFromSnapshot(snapshot: SnapshotTotals): MonthlyFigures {
  return {
    totals: snapshot.totals,
    flexBalance: snapshot.flexBalance,
    // flex 系の行があれば flex。無ければ fixed とみなす(対象ユーザーの行が締め時点で皆無
    // だったケースも含む — engineOutputFromSnapshots の JSDoc 参照。この場合 fixedBreakdown も
    // null になり、下記2列は結局空文字になるため実害は無い)。
    workSystem: snapshot.flexBalance === null ? "fixed" : "flex",
    fixedWithinScheduledMinutes: snapshot.fixedBreakdown?.withinScheduledMinutes ?? null,
    fixedExtraWithinStatutoryMinutes: snapshot.fixedBreakdown?.extraWithinStatutoryMinutes ?? null,
    allowanceTotals: snapshot.allowanceTotals,
  };
}

/**
 * 未締め月: calculate() の生の結果を MonthlyFigures へ変換する。
 * 所定内/法定内残業の合算は sumFixedBreakdown(closing-snapshot.ts)を再利用する —
 * 締め確定時にスナップショットへ書く値とここで表示する値の計算式がずれると、締めた瞬間に
 * 表示値が変わって見えるバグになるため、計算式を1箇所に集約している。
 */
function monthlyFiguresFromEngineOutput(output: EngineOutput): MonthlyFigures {
  const fixedBreakdown = output.workSystem === "fixed" ? sumFixedBreakdown(output.days) : null;
  return {
    totals: output.totals,
    flexBalance: output.flexBalance,
    workSystem: output.workSystem,
    fixedWithinScheduledMinutes: fixedBreakdown?.withinScheduledMinutes ?? null,
    fixedExtraWithinStatutoryMinutes: fixedBreakdown?.extraWithinStatutoryMinutes ?? null,
    allowanceTotals: output.allowanceTotals,
  };
}

/** UTF-8 BOM + CRLF 改行の CSV 文字列を組み立てる(Excel 対応)。 */
function buildCsv(rows: string[], header: readonly string[]): string {
  const BOM = "﻿";
  return BOM + [buildCsvRow([...header]), ...rows].join("\r\n") + "\r\n";
}

/**
 * 手当の列(allowance_<name>、テナント・期間ごとに動的)を `closed` の直前に挿入したヘッダを
 * 組み立てる。列名の先頭に付ける固定プレフィックス `allowance_` はヘッダ上の名前空間の目印
 * (docs/design/allowances.md「CSVエクスポート」— 名前自体はテナントが自由に付けられるため、
 * 取り込み側は必ずこのヘッダ名で列を参照すること。列の並び順や本数は定義の追加・削除で変わりうる)。
 */
function buildHeader(columns: readonly AllowanceColumn[], compareOriginal: boolean): string[] {
  const allowanceHeader = columns.map((col) => `allowance_${col.name}`);
  const base = [...BASE_CSV_HEADER_BEFORE_ALLOWANCES, ...allowanceHeader, CLOSED_COLUMN];
  return compareOriginal ? [...base, ...COMPARE_CSV_HEADER] : base;
}

export function createExportsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/attendance.csv", async (c) => {
    requirePermission(c, EXPORT_PERMISSION, "department");
    const user = c.get("user");

    const parsedMonth = parseMonthParam(c.req.query("month"));
    if (!parsedMonth) {
      return c.json({ error: "invalid_month" }, 400);
    }
    const { year, month } = parsedMonth;
    const monthStartDate = formatDate(year, month, 1);
    const monthEndDate = dateFromEpochDay(epochDayFromDate(monthStartDate) + daysInMonth(year, month) - 1);
    const period = monthStartDate.slice(0, 7);
    const compareOriginal = c.req.query("compare") === "original";

    // 手当の列(テナント単位・期間に依存、ユーザーには依存しない)を一度だけ解決する
    // (docs/design/allowances.md「CSVエクスポート」— 列名は期間開始日時点の版を使う)。
    const allowanceTimeline = await buildAllowanceTimeline(db, { tenantId: user.tenantId, fromDate: monthStartDate, toDate: monthEndDate });
    const allowanceColumns = resolveAllowanceColumnsForPeriod(allowanceTimeline, monthStartDate);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") },
      permission: EXPORT_PERMISSION,
    });

    const tenantUsers = await listTenantUsers(db, user.tenantId);
    const targetUsers =
      accessibleUserIds === "all" ? tenantUsers : tenantUsers.filter((u) => accessibleUserIds.has(u.id));
    // CSV の行順は決定的にしておく(テスト容易性・差分の見やすさのため)
    targetUsers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const closingState = await getClosingState(db, { tenantId: user.tenantId, period });
    const closed = closingState.status === "closed";

    const rows: string[] = [];
    if (closed) {
      const snapshotsByUser = await getClosingSnapshotsForUsers(db, {
        tenantId: user.tenantId,
        period,
        userIds: targetUsers.map((u) => u.id),
      });
      const originalSnapshotsByUser = compareOriginal
        ? await getOriginalClosingSnapshotsForUsers(db, { tenantId: user.tenantId, period, userIds: targetUsers.map((u) => u.id) })
        : null;
      for (const u of targetUsers) {
        const current = monthlyFiguresFromSnapshot(engineOutputFromSnapshots(snapshotsByUser.get(u.id) ?? []));
        const original = originalSnapshotsByUser
          ? monthlyFiguresFromSnapshot(engineOutputFromSnapshots(originalSnapshotsByUser.get(u.id) ?? []))
          : undefined;
        rows.push(buildRow({ user: u, period, current, closed, original, columns: allowanceColumns }));
      }
    } else {
      for (const u of targetUsers) {
        try {
          const { output } = await calculateMonthlyForUser(db, { tenantId: user.tenantId, userId: u.id, year, month });
          const current = monthlyFiguresFromEngineOutput(output);
          // 未締めの月には amend という概念が無い(そもそも確定値が存在しない)ため、
          // compare=original が指定されていても current をそのまま original として扱う(diff=0)。
          rows.push(buildRow({ user: u, period, current, closed, original: compareOriginal ? current : undefined, columns: allowanceColumns }));
        } catch {
          // テナント設定・制度割当がまだ揃っていないユーザーはスキップする
          // (apps/api/src/reminders.ts runReminderScan と同じ方針)。
        }
      }
    }

    const header = buildHeader(allowanceColumns, compareOriginal);
    const csv = buildCsv(rows, header);

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "export.attendance",
      targetType: "export",
      targetId: period,
      detail: JSON.stringify({ period, userCount: rows.length, closed, compareOriginal }),
      occurredAt: nowMinutes(),
    });

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="kizami-${period}.csv"`);
    return c.body(csv);
  });

  return app;
}
