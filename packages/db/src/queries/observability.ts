/**
 * `/metrics`(docs/design/observability.md)が使うクエリ。
 *
 * 2種類だけ置く:
 *
 * 1. **ドメインゲージ**(テナント数・ユーザー数・直近24時間の打刻数) — スクレイプのたびに
 *    数える。いずれも索引に当たる COUNT 1本に収めること。ここに「重い集計」を足さない
 *    (Prometheus は既定 15秒ごとに叩きに来る。API 側は 60秒キャッシュを噛ませているが、
 *    それでも1分に1回走る前提のコストしか許容しない)
 * 2. **ワーカーの心拍**(worker_heartbeats の読み書き) — 別プロセスであるワーカーの状態を
 *    api の `/metrics` から出すための橋渡し。テーブルにした理由は
 *    packages/db/src/schema/worker-heartbeats.ts の冒頭コメント
 */

import { count, eq, gte } from "drizzle-orm";
import { punchEvents, tenants, users, workerHeartbeats } from "../schema/index.js";
import type { Database, Transaction } from "../types.js";

/** ドメインゲージの一式。 */
export interface ObservabilityCounts {
  /** users の全行数(無効化済みユーザーも含む — 「抱えている人数」を見るため) */
  users: number;
  /** tenants の全行数 */
  tenants: number;
  /** occurred_at が直近24時間に入る punch_events の行数(取消イベントも含む生の件数) */
  punchesLast24h: number;
}

/**
 * ドメインゲージを数える(COUNT 3本)。
 *
 * @param nowMinutes 現在時刻(UTC エポック分)。直近24時間の起点に使う
 */
export async function countObservabilityGauges(db: Database, nowMinutes: number): Promise<ObservabilityCounts> {
  // users / tenants は主キー索引だけを読む COUNT(*)。punch_events は
  // punch_events_occurred_idx(occurred_at 単独)に当たる範囲 COUNT。
  const [userRow] = await db.select({ value: count() }).from(users);
  const [tenantRow] = await db.select({ value: count() }).from(tenants);
  const [punchRow] = await db
    .select({ value: count() })
    .from(punchEvents)
    .where(gte(punchEvents.occurredAt, nowMinutes - 24 * 60));

  return {
    users: userRow?.value ?? 0,
    tenants: tenantRow?.value ?? 0,
    punchesLast24h: punchRow?.value ?? 0,
  };
}

/** worker_heartbeats の1行。 */
export type WorkerHeartbeat = typeof workerHeartbeats.$inferSelect;

/** `recordWorkerHeartbeat` の引数。 */
export interface RecordWorkerHeartbeatParams {
  /** スキャンの識別子(apps/api/src/worker.ts の SCAN_JOBS) */
  jobName: string;
  /** 実行を終えた時刻(UTC エポック分) */
  nowMinutes: number;
  /** スキャンが例外を投げずに終わったか */
  ok: boolean;
}

/**
 * ワーカーの心拍を記録する(無ければ作り、あれば更新する)。
 *
 * `success_count` / `failure_count` は単調増加させる(Prometheus の counter 規約。
 * schema/worker-heartbeats.ts の冒頭コメント参照)。
 *
 * 判断点: UPSERT(`onConflictDoUpdate` + SQL 式でのインクリメント)ではなく
 * 「読んで、あれば UPDATE / 無ければ INSERT」にしている。ワーカーは単一プロセスで
 * 競合しないため原子性が要らず、この形なら SQLite / PostgreSQL / D1 のいずれでも
 * 同じ SQL 生成で動くことが自明になる(ダイアレクト依存の DO UPDATE 構文を避ける)。
 */
export async function recordWorkerHeartbeat(db: Database | Transaction, params: RecordWorkerHeartbeatParams): Promise<void> {
  const lastResult = params.ok ? "success" : "failure";
  const [existing] = await db
    .select()
    .from(workerHeartbeats)
    .where(eq(workerHeartbeats.jobName, params.jobName))
    .limit(1);

  if (existing) {
    await db
      .update(workerHeartbeats)
      .set({
        lastRunAt: params.nowMinutes,
        lastResult,
        successCount: existing.successCount + (params.ok ? 1 : 0),
        failureCount: existing.failureCount + (params.ok ? 0 : 1),
      })
      .where(eq(workerHeartbeats.jobName, params.jobName));
    return;
  }

  await db.insert(workerHeartbeats).values({
    jobName: params.jobName,
    lastRunAt: params.nowMinutes,
    lastResult,
    successCount: params.ok ? 1 : 0,
    failureCount: params.ok ? 0 : 1,
  });
}

/** 全ジョブの心拍を返す(ジョブ数は固定の5件程度なので絞り込みはしない)。 */
export async function listWorkerHeartbeats(db: Database): Promise<WorkerHeartbeat[]> {
  return db.select().from(workerHeartbeats);
}
