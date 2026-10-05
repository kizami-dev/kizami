/**
 * tenant_usage_counters — テナントごとの日次カウンタ(利用上限・上限到達の記録、2026-10-05)。
 *
 * 参照: docs/design/tenant-quotas.md。
 *
 * ## 何を数えるか
 *
 * `counter_key` ごとに、日本時間の日(`day` = floor((UTC エポック分 + 540) / 1440))単位で数える:
 *
 * - `outbound_notifications` — その日に送った外向きの通知(Webhook・メール)の数。上限(日次)の判定に使う
 * - `invite_reset_mails` — その日に送った招待・パスワード再設定のメールの数。上限(日次)の判定に使う
 * - `hit:<limit>`(`hit:members` / `hit:api_keys` / `hit:outbound_notifications` / `hit:invite_reset_mails`)—
 *   上限に達して**断った回数**。`/metrics` の「上限に達した回数」(テナントを区別しない全体の累計)の元
 *
 * 上限そのもの(メンバー数・API キー数)は、現在の行数を数えて判定するのでカウンタは持たない(hit だけ記録する)。
 *
 * ## なぜテーブルなのか
 *
 * 通知は api(承認依頼・テスト送信)と worker(定期スキャン)という別プロセスから送られ、`/metrics` は
 * api が出す。プロセス内メモリでは「そのテナントが今日あと何通送れるか」も「上限に達した回数」も
 * 揃わないので DB に持つ(worker_heartbeats と同じ理由)。
 *
 * ## tenant_id に外部キーを張らない(判断点)
 *
 * これは業務データではなく運用上のカウンタで、テナントの退会(削除)を**絶対に妨げてはならない**。
 * 外部キーを張ると、テナントの物理削除が「このテーブルに残った行」で失敗しうる(削除する側が
 * このテーブルを知らなくても)。外部キー無しなら、孤児の行が残るだけで実害は無い
 * (削除時に `deleteTenantUsageCounters` で消せる)。全テーブルに tenant_id という規約は守る
 * (読み書きは必ず tenant_id で絞る)が、参照整合性だけは意図的に持たない。
 */

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tenantUsageCounters = sqliteTable(
  "tenant_usage_counters",
  {
    tenantId: text("tenant_id").notNull(),
    /** カウンタの種別(このファイル冒頭) */
    counterKey: text("counter_key").notNull(),
    /** 日本時間の日番号 = floor((UTC エポック分 + 540) / 1440) */
    day: integer("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.counterKey, table.day] }),
    // /metrics の「上限に達した回数」(counter_key の接頭辞での集計)用
    index("tenant_usage_counters_key_idx").on(table.counterKey),
  ],
);
