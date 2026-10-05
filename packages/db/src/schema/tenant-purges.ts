/**
 * tenant_purge_records — 退会したテナントを物理削除した記録(**システム表**、2026-10-05)。
 * 設計は docs/design/tenant-withdrawal.md「削除の記録」。
 *
 * ## なぜ要るのか
 *
 * テナントを削除すると、そのテナントの監査ログ(audit_logs)も一緒に消える。すると運用者の手元には
 * 「いつ、どのテナントを、どれだけ消したか」の記録が何も残らない。問い合わせ(「本当に消えたのか」)や、
 * バックアップから復元したときに**削除済みのテナントをもう一度消す**作業(deploy/k8s-cloud/README.md)の
 * 手掛かりとして、テナントの外に最小限の記録を残す。
 *
 * ## 個人情報を一切持たない(判断点)
 *
 * 持つのはテナント id(不透明な UUIDv7)・時刻・テーブルごとの削除行数だけ。**テナント名・メール・
 * 氏名・申請者の id は持たない**。ここに名前を残すと、「消した」と言いながら運用者側に会社名が
 * 残り続けることになる(退職者の消去で監査ログの detail に氏名を入れないのと同じ理由 —
 * docs/design/data-retention.md)。
 *
 * ## システム表の例外(docs/design/multi-tenancy.md)
 *
 * `tenant_id` は持つが **tenants への外部キーは張らない**。この行は参照先のテナントが消えた後に
 * 残るためのものなので、FK を張ると削除そのものができない。テナント向けのクエリ・ルートからは
 * 触らず、アクセス経路は削除の処理(packages/db/src/queries/tenant-purge.ts)と運用者 CLI に限る。
 *
 * ## 途中で失敗したとき
 *
 * 削除は通常1トランザクションで行うので、失敗すればこの行も含めて巻き戻る。トランザクションを
 * 使えない D1 では、この行を先に作り、テーブルを1つ消すたびに `deleted_counts` を更新する。
 * `purged_at` が null の行は「始めたが終わっていない」削除で、再実行すると続きから完了させ、
 * 行数は足し合わせる(queries/tenant-purge.ts の purgeTenant)。
 */

import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tenantPurgeRecords = sqliteTable(
  "tenant_purge_records",
  {
    id: text("id").primaryKey(),
    /** 削除したテナントの id。tenants への FK は張らない(上記) */
    tenantId: text("tenant_id").notNull(),
    /** 退会を申請した時刻(UTC エポック分)。削除の時点の tenants.withdrawal_requested_at を写す */
    withdrawalRequestedAt: integer("withdrawal_requested_at").notNull(),
    /** 削除を始めた時刻(UTC エポック分) */
    purgeStartedAt: integer("purge_started_at").notNull(),
    /** 削除を終えた時刻(UTC エポック分)。null = 始めたが終わっていない(D1 で途中失敗した場合だけ残りうる) */
    purgedAt: integer("purged_at"),
    /**
     * テーブルごとの削除行数(JSON の `{ "<テーブル名>": 行数 }`)。tenants 行・pending_signups の
     * 行も含む。値は数だけで、行の中身は一切入れない
     */
    deletedCounts: text("deleted_counts").notNull(),
  },
  // 1テナントにつき1行。同じテナントの削除が同時に2本走っても、片方はここで失敗する
  // (失敗した側の再実行は「削除済み」を見て終わる)。
  (table) => [uniqueIndex("tenant_purge_records_tenant_id_idx").on(table.tenantId)],
);
