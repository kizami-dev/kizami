/**
 * PostgreSQL 用スキーマ(DDL 専用ミラー)。
 *
 * - 中身は `src/schema/`(sqlite-core, 単一の正)から `buildPgSchema` が実行時に生成する。
 *   手で書き写したファイルは置かない — 二重管理は必ずズレるため(判断点 2026-08-24)。
 * - このモジュールの用途は2つだけ:
 *     1. `drizzle.config.pg.ts` が読み込み、`migrations-pg/` の DDL を生成する
 *     2. `test/schema-drift.test.ts` が sqlite 側との一致を検証する
 *   クエリ層(`src/queries/`)はこのモジュールを参照しない。両ダイアレクトとも sqlite-core の
 *   テーブルオブジェクトでクエリを組み立てる(docs/design/db-dialects.md 参照)。
 * - `export const { ... }` で列挙しているのは drizzle-kit が「モジュールの名前付き export」を
 *   走査して PgTable を集めるため。テーブルを追加したらここにも名前を足すこと
 *   (足し忘れは schema-drift テストが検出する)。
 */

import * as sqliteSchema from "../schema/index.js";
import { buildPgSchema } from "./generate.js";

const pg = buildPgSchema(sqliteSchema as unknown as Record<string, unknown>);

export const {
  allowanceDefinitionVersions,
  allowanceDefinitions,
  apiKeys,
  auditLogs,
  authCredentials,
  autoBreakWaivers,
  closingEvents,
  closingSnapshots,
  correctionRequests,
  departments,
  helpOverrides,
  invitations,
  leaveGrantProposals,
  leaveGrants,
  leaveRequests,
  memberships,
  notifications,
  passwordResetTokens,
  permissionPresets,
  presetAssignments,
  punchEvents,
  sessions,
  shiftDays,
  shiftPatterns,
  shiftPlans,
  slackLinkTokens,
  slackUserLinks,
  tenantLeaveSettings,
  tenantNotificationSettings,
  tenantOidcSettings,
  tenantSettingVersions,
  tenantSlackSettings,
  tenants,
  userNotificationSettings,
  userPolicyAssignments,
  users,
  workPolicies,
  workPolicyVersions,
} = pg;

/** 生成された pg テーブルの全量(export 名 -> PgTable)。drift テスト用。 */
export const pgTables = pg;
