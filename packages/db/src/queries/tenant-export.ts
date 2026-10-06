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
 *
 * ## ページングして読む(判断点、2026-10-06)
 *
 * 1テナントの全行を一度に読むと、50人 × 3年で約17万行・数百 MB のオブジェクトがメモリに載る
 * (ホスト版の API コンテナの上限は 512Mi)。そこで、テーブルごとに**主キーの keyset ページング**で
 * 少しずつ読む `iterateTenantExportTable` を正とし、`exportTenantData`(全部を配列で返す)はその上に
 * 載せた互換の入口にする。
 *
 * - **keyset(`主キー > 前のページの最後`)を使い、OFFSET は使わない**: OFFSET は後ろのページほど
 *   読み飛ばしの行が増え(全体で行数の2乗)、読んでいる間に行が増減するとページの境目で重複・欠落が
 *   起きる。keyset は各ページが索引を引くだけで、境目もずれない
 * - 主キーが複合(help_overrides 等)のときは `(a > x) OR (a = x AND b > y)` の形に展開する。
 *   行値の比較 `(a, b) > (x, y)` は SQLite・PostgreSQL では書けるが、drizzle に共通の書き方が無く、
 *   方言ごとに SQL を分けたくないため。順序は ORDER BY と同じ列・同じ照合順序なので、PostgreSQL の
 *   照合順序(collation)でも「並べた順」と「> の判定」は一致する
 * - 行の順序・列の除外・値の変換(drizzle の列の読み取り)は `exportTenantData` の従来の結果と同じ
 *   (同じ SELECT にページの条件と LIMIT を足しただけ)
 * - ページの間でトランザクションは張らない(D1 は対話的なトランザクションを持たない)。読んでいる間に
 *   打刻が増えれば、keyset の後ろ側に入ったものだけが出力に入る。エクスポートは「その時点のおおよその
 *   全量」で足り、厳密なスナップショットは求めない(従来もテーブルごとに別の SELECT だった)
 */

import { and, asc, eq, gt, or, type Column, type SQL } from "drizzle-orm";
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

/** 1テーブル分の読み出しの段取り(SELECT する列・テナントで絞る列・並べる主キー)。 */
interface ExportTablePlan {
  name: string;
  table: SQLiteTable;
  selection: Record<string, SQLiteColumn>;
  filterColumn: SQLiteColumn;
  primaryColumns: SQLiteColumn[];
  omittedColumns: readonly string[];
}

/** 出す順(tenants が先頭、以降は削除の順の逆 = 親から子。読み手が users → punch_events の順に追えるように)。 */
function orderedExportTables(): SQLiteTable[] {
  return [tenants, ...[...TENANT_PURGE_ORDER].reverse()];
}

function planFor(table: SQLiteTable): ExportTablePlan | { name: string; excludeReason: string } {
  const name = tableNameOf(table);
  const policy = policyFor(name);
  if ("excludeReason" in policy) return { name, excludeReason: policy.excludeReason };
  const config = getTableConfig(table);
  const omitted = new Set(policy.omitColumns);
  const selected = config.columns.filter((c) => !omitted.has(c.name));
  const selection = Object.fromEntries(selected.map((c) => [c.name, c])) as Record<string, SQLiteColumn>;
  const filterColumn = name === "tenants" ? (tenants.id as SQLiteColumn) : config.columns.find((c) => c.name === "tenant_id");
  if (!filterColumn) throw new Error(`tenant-export: ${name} has no tenant_id column`);
  const primaryColumns =
    config.primaryKeys.length > 0
      ? (config.primaryKeys[0] as unknown as { columns: SQLiteColumn[] }).columns
      : config.columns.filter((c) => c.primary);
  if (primaryColumns.length === 0) throw new Error(`tenant-export: ${name} has no primary key`);
  // keyset の「前のページの最後」は出力した行から取るので、主キーの列は出す側に無いといけない
  for (const c of primaryColumns) {
    if (omitted.has(c.name)) throw new Error(`tenant-export: ${name}.${c.name} is a primary key column and cannot be omitted`);
  }
  return { name, table, selection, filterColumn, primaryColumns, omittedColumns: policy.omitColumns };
}

/** 出すテーブル・出さないテーブルの一覧(出す順)。zip の manifest と、テーブルごとの読み出しの順に使う。 */
export function listTenantExportTables(): {
  tables: Array<{ name: string; omittedColumns: readonly string[] }>;
  excludedTables: Array<{ name: string; reason: string }>;
} {
  const tables: Array<{ name: string; omittedColumns: readonly string[] }> = [];
  const excludedTables: Array<{ name: string; reason: string }> = [];
  for (const table of orderedExportTables()) {
    const plan = planFor(table);
    if ("excludeReason" in plan) excludedTables.push({ name: plan.name, reason: plan.excludeReason });
    else tables.push({ name: plan.name, omittedColumns: plan.omittedColumns });
  }
  return { tables, excludedTables };
}

/** keyset の条件: (c1 > v1) OR (c1 = v1 AND c2 > v2) OR …(複合主キーを行値比較なしで書く)。 */
function afterKey(columns: readonly SQLiteColumn[], last: Record<string, unknown>): SQL {
  const branches = columns.map((column, i) =>
    and(...columns.slice(0, i).map((prev) => eq(prev, last[prev.name])), gt(column, last[column.name])),
  );
  return (branches.length === 1 ? branches[0] : or(...branches)) as SQL;
}

/** 1ページに読む行数の既定値。1行は大きくても数 KB(監査ログ・設定の JSON)なので、数 MB に収まる。 */
export const TENANT_EXPORT_DEFAULT_BATCH_SIZE = 1000;

/**
 * 1テーブル分のテナントの行を、主キーの昇順で `batchSize` 行ずつ返す(空のテーブルなら何も返さない)。
 * 列の除外・値の変換・順序は `exportTenantData` と同じ。出さないテーブル(TENANT_EXPORT_POLICY の
 * excludeReason)や知らないテーブルの名前を渡すとエラー。
 *
 * テナント単位の読み出しなので、各ページを `tenant_id = 対象` で絞る(テナント分離の原則1)。
 */
export async function* iterateTenantExportTable(
  db: Database,
  tenantId: string,
  tableName: string,
  options: { batchSize?: number } = {},
): AsyncGenerator<Record<string, unknown>[], void, undefined> {
  const batchSize = options.batchSize ?? TENANT_EXPORT_DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error(`tenant-export: invalid batchSize ${batchSize}`);
  const table = orderedExportTables().find((t) => tableNameOf(t) === tableName);
  if (!table) throw new Error(`tenant-export: unknown table ${tableName}`);
  const plan = planFor(table);
  if ("excludeReason" in plan) throw new Error(`tenant-export: table ${tableName} is excluded from the export`);

  const tenantFilter = eq(plan.filterColumn, tenantId);
  let last: Record<string, unknown> | undefined;
  for (;;) {
    const rows = (await db
      .select(plan.selection)
      .from(plan.table)
      .where(last === undefined ? tenantFilter : and(tenantFilter, afterKey(plan.primaryColumns, last)))
      .orderBy(...plan.primaryColumns.map((c: Column) => asc(c)))
      .limit(batchSize)) as Record<string, unknown>[];
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < batchSize) return;
    last = rows[rows.length - 1];
  }
}

/**
 * テナントの全データを配列で読み出す。存在しないテナントなら null。
 *
 * 全行をメモリに載せるので、テナント全体のエクスポート(zip)には使わない — あちらは
 * `iterateTenantExportTable` でテーブルごと・ページごとに流す。これは小さなテナントのテストと、
 * 全体を一度に見たい呼び出し元のための入口。行の順序は主キーの昇順(UUIDv7 なら作成順)。
 */
export async function exportTenantData(db: Database, tenantId: string): Promise<TenantDataExport | null> {
  const [tenantRow] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenantRow) return null;

  const { tables: listed, excludedTables } = listTenantExportTables();
  const tables: ExportedTable[] = [];
  for (const { name, omittedColumns } of listed) {
    const rows: Record<string, unknown>[] = [];
    for await (const batch of iterateTenantExportTable(db, tenantId, name)) rows.push(...batch);
    tables.push({ name, rows, omittedColumns });
  }
  return { tables, excludedTables };
}

