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
import type { CategorizedMinutes, FlexBalance } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { engineOutputFromSnapshots } from "../lib/closing-snapshot.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { formatDate, nowMinutes, parseMonthParam } from "../lib/time.js";
import { calculateMonthlyForUser } from "../reminders.js";

const EXPORT_PERMISSION = "export.attendance.run";

const BASE_CSV_HEADER = [
  "user_id",
  "user_name",
  "email",
  "period",
  "statutory_minutes",
  "overtime_minutes",
  "overtime60h_minutes",
  "late_night_minutes",
  "statutory_holiday_minutes",
  "flex_frame_minutes",
  "flex_actual_minutes",
  "flex_diff_minutes",
  "closed",
];

/** ?compare=original のときだけ末尾に追加する列。区分別5種+flex3種それぞれに original_ と diff_ の列を持つ。 */
const COMPARE_CSV_HEADER = [
  "original_statutory_minutes",
  "original_overtime_minutes",
  "original_overtime60h_minutes",
  "original_late_night_minutes",
  "original_statutory_holiday_minutes",
  "original_flex_frame_minutes",
  "original_flex_actual_minutes",
  "original_flex_diff_minutes",
  "diff_statutory_minutes",
  "diff_overtime_minutes",
  "diff_overtime60h_minutes",
  "diff_late_night_minutes",
  "diff_statutory_holiday_minutes",
  "diff_flex_frame_minutes",
  "diff_flex_actual_minutes",
  "diff_flex_diff_minutes",
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

interface MonthlyFigures {
  totals: CategorizedMinutes;
  flexBalance: FlexBalance;
}

interface RowInput {
  user: MemberUser;
  period: string;
  current: MonthlyFigures;
  closed: boolean;
  /** compare=original のときのみ渡す。当初の確定値(amend が無ければ current と同じ値)。 */
  original?: MonthlyFigures | undefined;
}

function buildRow({ user, period, current, closed, original }: RowInput): string {
  const fields: Array<string | number | boolean> = [
    user.id,
    user.name,
    user.email,
    period,
    current.totals.statutory,
    current.totals.overtime,
    current.totals.overtime60h,
    current.totals.lateNight,
    current.totals.statutoryHoliday,
    current.flexBalance.frameMinutes,
    current.flexBalance.actualMinutes,
    current.flexBalance.diffMinutes,
    closed,
  ];

  if (original) {
    fields.push(
      original.totals.statutory,
      original.totals.overtime,
      original.totals.overtime60h,
      original.totals.lateNight,
      original.totals.statutoryHoliday,
      original.flexBalance.frameMinutes,
      original.flexBalance.actualMinutes,
      original.flexBalance.diffMinutes,
      current.totals.statutory - original.totals.statutory,
      current.totals.overtime - original.totals.overtime,
      current.totals.overtime60h - original.totals.overtime60h,
      current.totals.lateNight - original.totals.lateNight,
      current.totals.statutoryHoliday - original.totals.statutoryHoliday,
      current.flexBalance.frameMinutes - original.flexBalance.frameMinutes,
      current.flexBalance.actualMinutes - original.flexBalance.actualMinutes,
      current.flexBalance.diffMinutes - original.flexBalance.diffMinutes,
    );
  }

  return buildCsvRow(fields);
}

/** UTF-8 BOM + CRLF 改行の CSV 文字列を組み立てる(Excel 対応)。 */
function buildCsv(rows: string[], header: readonly string[]): string {
  const BOM = "﻿";
  return BOM + [buildCsvRow([...header]), ...rows].join("\r\n") + "\r\n";
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
    const period = formatDate(year, month, 1).slice(0, 7);
    const compareOriginal = c.req.query("compare") === "original";

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
        const current = engineOutputFromSnapshots(snapshotsByUser.get(u.id) ?? []);
        const original = originalSnapshotsByUser ? engineOutputFromSnapshots(originalSnapshotsByUser.get(u.id) ?? []) : undefined;
        rows.push(buildRow({ user: u, period, current, closed, original }));
      }
    } else {
      for (const u of targetUsers) {
        try {
          const { output } = await calculateMonthlyForUser(db, { tenantId: user.tenantId, userId: u.id, year, month });
          const current: MonthlyFigures = { totals: output.totals, flexBalance: output.flexBalance };
          // 未締めの月には amend という概念が無い(そもそも確定値が存在しない)ため、
          // compare=original が指定されていても current をそのまま original として扱う(diff=0)。
          rows.push(buildRow({ user: u, period, current, closed, original: compareOriginal ? current : undefined }));
        } catch {
          // テナント設定・制度割当がまだ揃っていないユーザーはスキップする
          // (apps/api/src/reminders.ts runReminderScan と同じ方針)。
        }
      }
    }

    const header = compareOriginal ? [...BASE_CSV_HEADER, ...COMPARE_CSV_HEADER] : BASE_CSV_HEADER;
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
