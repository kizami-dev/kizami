/**
 * `GET /metrics` — Prometheus text format 0.0.4 のスクレイプ先。
 * 設計・運用は docs/design/observability.md。
 *
 * ## 公開しない
 *
 * `METRICS_TOKEN` が未設定の配備では**このルート自体を生やさない**(= 404。
 * createApp 側で分岐している)。設定されている場合も `Authorization: Bearer <token>` が
 * 一致しなければ 401。既定で口が開かないようにするのは、テナント数・ユーザー数・打刻数という
 * 「その事業所の規模」が読み取れる情報を出すため。
 *
 * ## レート制限との関係(判断点 2026-08-27)
 *
 * 公開打刻 API のキー推測対策(app.ts の `apiKeyPerIp`、120回/分)は `authed` サブアプリに
 * 付いており、`Authorization: Bearer ...` が付いたリクエストだけを数える。`/metrics` は
 * **`authed` より前に**登録するため、この制限のバケツを一切消費しない
 * (Hono は登録順に評価し、応答を返したハンドラより後段は実行されない)。
 * したがって 15秒ごとのスクレイプが IC カードリーダーの打刻枠を食い潰すことはない。
 * 逆に `/metrics` 自身にはレート制限が無いが、トークンを知らないと 401 で弾かれ、
 * 401 の処理コストはヘッダ比較1回なので総当たりの的としても割に合わない。
 *
 * ## ドメインゲージは 60秒キャッシュ
 *
 * Prometheus の既定スクレイプ間隔は 15秒。COUNT を毎回3本走らせる必要はないので、
 * 結果を 60秒だけ使い回す(= どんなスクレイプ頻度でも DB への負荷は1分あたり3クエリで頭打ち)。
 * ワーカーの心拍(worker_heartbeats、5行)も同じキャッシュに同居させる — 更新は既定15分周期で、
 * 60秒の遅延は意味を持たない。
 */

import { Hono } from "hono";
import { countObservabilityGauges, listWorkerHeartbeats, type Database } from "@kizami/db";
import {
  collectProcessMetrics,
  METRICS_CONTENT_TYPE,
  renderMetrics,
  type HttpMetrics,
  type MetricFamily,
} from "../lib/metrics.js";

export interface MetricsRoutesOptions {
  /** `METRICS_TOKEN`。空文字は許容しない(呼び出し側が未設定判定を済ませている前提)。 */
  token: string;
  /** HTTP メトリクスの集計器(app.ts のミドルウェアと共有するインスタンス)。 */
  httpMetrics: HttpMetrics;
  /** `kizami_build_info` に載せる版。 */
  release?: string;
  /** 時刻源(ミリ秒)。テストがキャッシュの経過を実時間を待たずに再現するための注入点。 */
  now?: () => number;
  /** ドメインゲージのキャッシュ有効期間(ミリ秒)。既定 60000。 */
  cacheTtlMs?: number;
}

/** 60秒キャッシュの中身。 */
interface GaugeCache {
  at: number;
  families: MetricFamily[];
}

/**
 * トークンの定数時間比較。長さが違う場合も早期 return せず、比較そのものの所要時間から
 * トークンの内容が漏れないようにする(node:crypto の timingSafeEqual は workerd で
 * 使えないため自前。比較対象は高々数十バイトなのでコストは無視できる)。
 */
function timingSafeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
  }
  return diff === 0;
}

export function createMetricsRoutes(db: Database, options: MetricsRoutesOptions) {
  const now = options.now ?? (() => Date.now());
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  let cache: GaugeCache | undefined;

  /**
   * DB 由来のメトリクス(ドメインゲージ + ワーカー心拍)。
   * 読み取りに失敗した場合は**空配列**を返す(スクレイプ自体は 200 のまま成功させる)。
   * 判断点: 監視エンドポイントが 500 を返すと、DB の一時的な失敗が「アプリが落ちた」ように
   * 見えるうえ、エラー報告(lib/error-report.ts)まで発火してノイズになる。欠測は
   * Prometheus 側で `absent()` として検出できるので、そちらに委ねる。
   */
  async function collectDbMetrics(): Promise<MetricFamily[]> {
    const currentMs = now();
    if (cache !== undefined && currentMs - cache.at < cacheTtlMs) return cache.families;

    let families: MetricFamily[] = [];
    try {
      const nowMinutes = Math.floor(currentMs / 60_000);
      const counts = await countObservabilityGauges(db, nowMinutes);
      const heartbeats = await listWorkerHeartbeats(db);

      families = [
        {
          name: "kizami_users_total",
          help: "登録ユーザー数(無効化済みを含む)",
          type: "gauge",
          samples: [{ value: counts.users }],
        },
        {
          name: "kizami_tenants_total",
          help: "テナント数",
          type: "gauge",
          samples: [{ value: counts.tenants }],
        },
        {
          name: "kizami_punches_last24h",
          help: "直近24時間に発生した打刻イベント数",
          type: "gauge",
          samples: [{ value: counts.punchesLast24h }],
        },
        {
          name: "kizami_worker_last_run_timestamp_seconds",
          help: "定期スキャンが最後に実行を終えた時刻(Unix エポック秒)",
          type: "gauge",
          // last_run_at は UTC エポック**分**(DB の時刻カラム規約)。Prometheus は秒で扱う
          samples: heartbeats.map((row) => ({ labels: { job: row.jobName }, value: row.lastRunAt * 60 })),
        },
        {
          name: "kizami_worker_runs_total",
          help: "定期スキャンの実行回数(結果別・累積。ワーカー再起動をまたいで連続する)",
          type: "counter",
          samples: heartbeats.flatMap((row) => [
            { labels: { job: row.jobName, result: "success" }, value: row.successCount },
            { labels: { job: row.jobName, result: "failure" }, value: row.failureCount },
          ]),
        },
      ];
    } catch (err) {
      console.warn("[metrics] DB 由来のメトリクスを取得できませんでした:", err);
      families = [];
    }

    cache = { at: currentMs, families };
    return families;
  }

  const routes = new Hono();

  routes.get("/", async (c) => {
    const header = c.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!timingSafeEquals(presented, options.token)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const families: MetricFamily[] = [
      {
        name: "kizami_build_info",
        help: "ビルド情報(値は常に1。版の切り替わりを時系列で見るためのラベル付きゲージ)",
        type: "gauge",
        samples: [{ labels: { version: options.release ?? "unknown" }, value: 1 }],
      },
      ...collectProcessMetrics(),
      ...options.httpMetrics.collect(),
      ...(await collectDbMetrics()),
    ];

    return c.body(renderMetrics(families), 200, { "Content-Type": METRICS_CONTENT_TYPE });
  });

  return routes;
}
