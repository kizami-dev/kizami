/**
 * worker_heartbeats — 定期スキャンワーカー(apps/api/src/worker.ts)の最終実行時刻と成否の累計。
 *
 * 参照: docs/design/observability.md。
 *
 * ## なぜテーブルなのか(判断点 2026-08-27)
 *
 * `/metrics` は api コンテナが出す。ところがワーカーは**別プロセス**(同じ Pod / 別コンテナ、
 * Compose なら別サービス)なので、ワーカーの状態を api のプロセス内メモリで共有できない。
 * 選択肢は2つあった:
 *
 * 1. ワーカーが自前の HTTP サーバーを立て、Prometheus が2つのターゲットを叩く
 * 2. ワーカーが DB に心拍を書き、api の `/metrics` がそれを読んで出す(**採用**)
 *
 * 1 はポートを1つ増やし、k8s では Service/追加の scrape 設定、Compose ではポート公開が要る。
 * KIZAMI の配備は「api と worker が同じ DB を見る」ことが既に前提(worker.ts はスキャンの
 * ために DB を読む)なので、2 なら**配備物を一切増やさずに**単一のスクレイプ先で完結する。
 * 心拍の書き込みはスキャン1回につき5行の UPSERT で、既定 15分周期では無視できる負荷。
 *
 * ## テナントを持たない理由
 *
 * これは業務データではなく**プロセスの運用状態**で、テナント間で分割する意味がない
 * (ワーカーは全テナントを横断してスキャンする)。したがって docs/design/multi-tenancy.md の
 * 「全テーブルに tenant_id」規約の対象外とする — 逆に tenant_id を持たせると「どのテナントの
 * 行を読めばワーカーが生きているか」が決まらず、意味のない列になる。
 *
 * ## カウンタの扱い
 *
 * `success_count` / `failure_count` は**単調増加**(リセットしない)。Prometheus の counter は
 * 単調増加を前提に `rate()` を取るため、DB に持つことでワーカー再起動をまたいでも連続する
 * (プロセス内メモリだと再起動のたびに 0 に戻り、再起動が失敗として見えなくなる)。
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  /** スキャンの識別子(例 "reminder" / "overtime-alert")。apps/api/src/worker.ts の SCAN_JOBS と対応 */
  jobName: text("job_name").primaryKey(),
  /** 最後に実行を終えた時刻(UTC エポック分。時刻カラムの規約は packages/db/src/index.ts) */
  lastRunAt: integer("last_run_at").notNull(),
  /** 最後の実行結果。"success" | "failure" */
  lastResult: text("last_result").notNull(),
  /** 成功した実行の累計(単調増加) */
  successCount: integer("success_count").notNull().default(0),
  /** 失敗した実行の累計(単調増加) */
  failureCount: integer("failure_count").notNull().default(0),
});
