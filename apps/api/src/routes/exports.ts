/**
 * GET /exports/attendance.csv?month=YYYY-MM
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
 * CSV は UTF-8 BOM 付き・CRLF 改行(Excel 対応、依頼どおり)。
 */

import { Hono } from "hono";
import { getClosingSnapshotsForUsers, getClosingState, insertAuditLog, listTenantUsers, type Database, type MemberUser } from "@kizami/db";
import type { CategorizedMinutes, FlexBalance } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { engineOutputFromSnapshots } from "../lib/closing-snapshot.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { formatDate, nowMinutes, parseMonthParam } from "../lib/time.js";
import { calculateMonthlyForUser } from "../reminders.js";

const EXPORT_PERMISSION = "export.attendance.run";

const CSV_HEADER = [
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

interface RowInput {
  user: MemberUser;
  period: string;
  totals: CategorizedMinutes;
  flexBalance: FlexBalance;
  closed: boolean;
}

function buildRow({ user, period, totals, flexBalance, closed }: RowInput): string {
  return buildCsvRow([
    user.id,
    user.name,
    user.email,
    period,
    totals.statutory,
    totals.overtime,
    totals.overtime60h,
    totals.lateNight,
    totals.statutoryHoliday,
    flexBalance.frameMinutes,
    flexBalance.actualMinutes,
    flexBalance.diffMinutes,
    closed,
  ]);
}

/** UTF-8 BOM + CRLF 改行の CSV 文字列を組み立てる(Excel 対応)。 */
function buildCsv(rows: string[]): string {
  const BOM = "﻿";
  return BOM + [buildCsvRow(CSV_HEADER), ...rows].join("\r\n") + "\r\n";
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
      for (const u of targetUsers) {
        const { totals, flexBalance } = engineOutputFromSnapshots(snapshotsByUser.get(u.id) ?? []);
        rows.push(buildRow({ user: u, period, totals, flexBalance, closed }));
      }
    } else {
      for (const u of targetUsers) {
        try {
          const { output } = await calculateMonthlyForUser(db, { tenantId: user.tenantId, userId: u.id, year, month });
          rows.push(buildRow({ user: u, period, totals: output.totals, flexBalance: output.flexBalance, closed }));
        } catch {
          // テナント設定・制度割当がまだ揃っていないユーザーはスキップする
          // (apps/api/src/reminders.ts runReminderScan と同じ方針)。
        }
      }
    }

    const csv = buildCsv(rows);

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "export.attendance",
      targetType: "export",
      targetId: period,
      detail: JSON.stringify({ period, userCount: rows.length, closed }),
      occurredAt: nowMinutes(),
    });

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="kizami-${period}.csv"`);
    return c.body(csv);
  });

  return app;
}
