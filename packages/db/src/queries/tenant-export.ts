/**
 * テナントの全データのエクスポート(機械可読な部分、2026-10-05)。
 * 設計は docs/design/tenant-withdrawal.md「全データのエクスポート」。zip に詰める・人が読める
 * 勤怠の CSV を足すのは apps/api/src/lib/tenant-export-archive.ts。
 *
 * ## 何を出すか
 *
 * tenants の1行と、`TENANT_PURGE_ORDER`(削除の対象と同じ一覧)の全テーブルの `tenant_id = 対象` の行を、
 * **DB の列名(snake_case)のまま**出す。削除の対象と同じ一覧を使うので、「消されるのにエクスポート
 * されない表」は作れない(test/tenant-export.test.ts がスキーマから検査する)。
 *
 * ## 何を出さないか(判断点)
 *
 * 認証の秘密と、暗号化して保存している秘密情報。テナントの業務データではなく、外に出ると
 * **そのまま悪用できる**もの(ハッシュも総当たりの材料になる)。テーブルごとの扱いは
 * `TENANT_EXPORT_POLICY` に**全テーブル分を明示**する — 新しいテーブルを足したとき、
 * ここに扱いを書かない限りテストが落ちる(「何も書かない = 全部出す」にはしない)。
 * 除外は SELECT の段階で行う(秘密の列はそもそもメモリに読み込まない)。
 *
 * 時刻の列は DB と同じ UTC エポック分、真偽の列は true/false、JSON を入れている列(grants 等)は
 * 文字列のまま出す(解釈を変えずに渡すため)。
 */

import { asc, eq, type Column } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database } from "../types.js";
import { tenants } from "../schema/index.js";
import { tableNameOf, TENANT_PURGE_ORDER } from "./tenant-purge.js";

/**
 * テーブルごとのエクスポートの扱い。
 * - `{ omitColumns: [...] }`: 行は出すが、その列は出さない(空配列 = 全列を出す)
 * - `{ excludeReason: "..." }`: テーブルごと出さない(行のほぼすべてが秘密そのもの)
 */
export type TenantExportTablePolicy = { omitColumns: readonly string[] } | { excludeReason: string };

export const TENANT_EXPORT_POLICY: Readonly<Record<string, TenantExportTablePolicy>> = {
  tenants: { omitColumns: [] },
  closing_snapshots: { omitColumns: [] },
  closing_events: { omitColumns: [] },
  correction_requests: { omitColumns: [] },
  punch_events: { omitColumns: [] },
  leave_grant_proposals: { omitColumns: [] },
  leave_grants: { omitColumns: [] },
  leave_requests: { omitColumns: [] },
  auto_break_waivers: { omitColumns: [] },
  shift_days: { omitColumns: [] },
  shift_plans: { omitColumns: [] },
  shift_patterns: { omitColumns: [] },
  memberships: { omitColumns: [] },
  departments: { omitColumns: [] },
  preset_assignments: { omitColumns: [] },
  permission_presets: { omitColumns: [] },
  user_policy_assignments: { omitColumns: [] },
  work_policy_versions: { omitColumns: [] },
  work_policies: { omitColumns: [] },
  allowance_definition_versions: { omitColumns: [] },
  allowance_definitions: { omitColumns: [] },
  // キーの名前・権限・期限は出す(誰がどんな連携をしていたかの記録)。ハッシュは出さない
  api_keys: { omitColumns: ["key_hash"] },
  approval_flow_settings: { omitColumns: [] },
  audit_logs: { omitColumns: [] },
  auth_credentials: { excludeReason: "パスワードのハッシュ(認証の秘密)" },
  help_overrides: { omitColumns: [] },
  invitations: { omitColumns: ["token_hash"] },
  notifications: { omitColumns: [] },
  password_reset_tokens: { omitColumns: ["token_hash"] },
  // endpoint と鍵は「その端末へ通知を送れる」資格情報。端末の種類(user_agent)と時刻は出す
  push_subscriptions: { omitColumns: ["endpoint", "keys_p256dh", "keys_auth"] },
  sessions: { excludeReason: "ログインセッション(id がトークンのハッシュそのもの)" },
  slack_link_tokens: { omitColumns: ["token_hash"] },
  slack_user_links: { omitColumns: [] },
  tenant_leave_settings: { omitColumns: [] },
  // Webhook の URL は送信の資格情報そのもの、SMTP のパスワードは秘密(どちらも暗号化して保存している)
  tenant_notification_settings: { omitColumns: ["webhook_url", "smtp_password"] },
  tenant_oidc_settings: { omitColumns: ["client_secret"] },
  tenant_slack_settings: { omitColumns: ["signing_secret"] },
  user_notification_settings: { omitColumns: ["webhook_url"] },
  user_totp_recovery_codes: { excludeReason: "二要素認証のリカバリコードのハッシュ(認証の秘密)" },
  // 有効にした時刻だけを出す。共有鍵(暗号化済み)と、リプレイ防止のカウンタは出さない
  user_totp: { omitColumns: ["secret_encrypted", "last_used_counter"] },
  scheduled_holiday_calendar_versions: { omitColumns: [] },
  tenant_setting_versions: { omitColumns: [] },
  // 利用上限の日ごとのカウンタ。運用者が上限の執行に使う運用上の値で、テナントの業務データではない
  tenant_usage_counters: { excludeReason: "利用上限の運用上のカウンタ(業務データではない)" },
  users: { omitColumns: [] },
};

export interface ExportedTable {
  /** テーブル名(snake_case) */
  name: string;
  /** 行(キーは DB の列名) */
  rows: Record<string, unknown>[];
  /** 出さなかった列(manifest に書いて、受け取った側に「意図して抜いた」ことを伝える) */
  omittedColumns: readonly string[];
}

export interface TenantDataExport {
  /** 出したテーブル(tenants が先頭、以降は削除の順の逆 = 親から子) */
  tables: ExportedTable[];
  /** テーブルごと出さなかったものと、その理由 */
  excludedTables: Array<{ name: string; reason: string }>;
}

function policyFor(name: string): TenantExportTablePolicy {
  const policy = TENANT_EXPORT_POLICY[name];
  if (!policy) throw new Error(`tenant-export: no export policy for table ${name}`);
  return policy;
}

/**
 * テナントの全データを読み出す。存在しないテナントなら null。
 *
 * テナント単位の読み出しなので、各テーブルを `tenant_id = 対象` で絞る(テナント分離の原則1)。
 * 行の順序は主キーの昇順(UUIDv7 なら作成順)にそろえる — 2回出したときに差分を取りやすくするため。
 */
export async function exportTenantData(db: Database, tenantId: string): Promise<TenantDataExport | null> {
  const [tenantRow] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenantRow) return null;

  const tables: ExportedTable[] = [];
  const excludedTables: TenantDataExport["excludedTables"] = [];

  // 親 → 子の順で並べる(読み手が users → punch_events の順に追えるように)
  const ordered: SQLiteTable[] = [tenants, ...[...TENANT_PURGE_ORDER].reverse()];
  for (const table of ordered) {
    const name = tableNameOf(table);
    const policy = policyFor(name);
    if ("excludeReason" in policy) {
      excludedTables.push({ name, reason: policy.excludeReason });
      continue;
    }
    const config = getTableConfig(table);
    const omitted = new Set(policy.omitColumns);
    const selected = config.columns.filter((c) => !omitted.has(c.name));
    const selection = Object.fromEntries(selected.map((c) => [c.name, c])) as Record<string, SQLiteColumn>;
    const filterColumn = name === "tenants" ? tenants.id : config.columns.find((c) => c.name === "tenant_id");
    if (!filterColumn) throw new Error(`tenant-export: ${name} has no tenant_id column`);
    const primaryColumns =
      config.primaryKeys.length > 0
        ? (config.primaryKeys[0] as unknown as { columns: Column[] }).columns
        : config.columns.filter((c) => c.primary);
    const rows = (await db
      .select(selection)
      .from(table)
      .where(eq(filterColumn, tenantId))
      .orderBy(...primaryColumns.map((c) => asc(c)))) as Record<string, unknown>[];
    tables.push({ name, rows, omittedColumns: policy.omitColumns });
  }
  return { tables, excludedTables };
}
