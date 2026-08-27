/**
 * Prometheus 互換のメトリクス(text format 0.0.4)を自前で組み立てる最小レジストリ。
 *
 * ## 判断点: prom-client を入れず自前で持つ(2026-08-27)
 *
 * 必要なのは「カウンタ1本・ヒストグラム1本・ゲージ数本」だけで、prom-client が提供する
 * 価値(レジストリ・集約・多数の既定メトリクス)のほとんどを使わない。それに加えて
 * **KIZAMI の API は workerd でも起動する**(要件 §8、src/workers.ts)という事情がある:
 *
 * - prom-client の既定メトリクス(`collectDefaultMetrics`)は `perf_hooks`・`process` の
 *   イベントループ計測・GC フックに依存しており、workerd では動かない
 * - `/metrics` が Node でしか生えないのは配布物として一貫しない(セルフホスト先が
 *   Workers なら監視できない、という状態を作りたくない)
 *
 * そのため、ランタイム非依存の素の TypeScript でレンダリングだけを行う。プロセス固有の
 * 値(RSS・uptime)は `collectProcessMetrics()` が実行時に存在確認して、取れる環境でだけ
 * 出す(取れなければその行ごと消える — Prometheus 側は欠測として扱えばよい)。
 *
 * 同じ判断は Web Push の VAPID 実装(packages/notify)やレート制限(lib/rate-limit.ts)と
 * 同じ方針に沿っている: 小さくて枯れている処理は依存を増やさず自前で持つ。
 *
 * ## カーディナリティの方針
 *
 * ラベルに**生のパス・ユーザーID・テナントIDを入れない**。HTTP メトリクスのラベルは
 * `method`(既知の動詞のみ)・`route`(Hono が解決したルートパターン)・`status`(2xx 等の
 * ステータスクラス)の3つに限る。これで時系列の本数は「ルート数 × 7 × 4」程度で頭打ちになる。
 * 詳細は docs/design/observability.md。
 */

/** メトリクスのラベル(値は出力時にエスケープする)。 */
export type MetricLabels = Record<string, string>;

/** 1本の時系列。`suffix` はヒストグラムの `_bucket` / `_sum` / `_count` に使う。 */
export interface MetricSample {
  labels?: MetricLabels;
  value: number;
  /** メトリクス名に付ける接尾辞(既定 "")。 */
  suffix?: string;
}

/** 同じ名前・同じ型の時系列のまとまり(`# HELP` / `# TYPE` の単位)。 */
export interface MetricFamily {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  samples: MetricSample[];
}

/**
 * HTTP リクエスト所要時間のバケット(秒)。
 *
 * 5本 + `+Inf` に絞っている。KIZAMI の API は打刻(数ms)と月次集計(数百ms〜)が主で、
 * この粒度があれば「速い/普通/遅い/異常」の区別は付く。バケットを増やすとルート数ぶん
 * 時系列が掛け算で増える(ルート数 × バケット数)ので、安易に足さないこと。
 */
export const HTTP_DURATION_BUCKETS = [0.005, 0.025, 0.1, 0.5, 1] as const;

/** ラベルに出す HTTP メソッド。想定外の動詞は "other" に畳んでカーディナリティを閉じる。 */
const KNOWN_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** 想定外のメソッドを "other" に畳む。 */
export function normalizeMethod(method: string): string {
  return KNOWN_METHODS.has(method) ? method : "other";
}

/**
 * Hono が解決したルートパターン(`c.req.routePath`)をラベル値に整える。
 *
 * - `/api` プレフィクス付きの配信(src/node.ts が同じアプリを `/` と `/api` の2箇所に
 *   マウントしている)は同じルートとして数えたいので剥がす
 * - どのルートにも一致しなかった場合、Hono は `/*`(= 404 を返した)を返す。生のパスは
 *   ここでも使わない(存在しない URL を叩かれるだけで時系列が無限に増えるため)
 */
export function normalizeRoute(routePath: string): string {
  if (routePath === "/api" || routePath.startsWith("/api/")) {
    const stripped = routePath.slice("/api".length);
    return stripped === "" ? "/" : stripped;
  }
  return routePath;
}

/** HTTP ステータスをクラス("2xx" 等)に畳む。個別のコードはラベルにしない。 */
export function statusClass(status: number): string {
  const hundreds = Math.floor(status / 100);
  return hundreds >= 1 && hundreds <= 5 ? `${hundreds}xx` : "other";
}

/** `recordHttpRequest` に渡す1リクエストぶんの観測値。 */
export interface HttpRequestSample {
  method: string;
  /** Hono の `c.req.routePath`(生パスではない)。 */
  routePath: string;
  status: number;
  durationSeconds: number;
}

/** HTTP メトリクスの集計器(プロセス内メモリ。プロセス再起動でカウンタは 0 に戻る)。 */
export interface HttpMetrics {
  /** リクエスト1件を記録する。 */
  record(sample: HttpRequestSample): void;
  /** 現在値を MetricFamily に落とす(スクレイプのたびに呼ばれる)。 */
  collect(): MetricFamily[];
}

/** カウンタの内部状態(ラベルの組み合わせごと)。 */
interface CounterEntry {
  labels: MetricLabels;
  value: number;
}

/** ヒストグラムの内部状態(ラベルの組み合わせごと)。 */
interface HistogramEntry {
  labels: MetricLabels;
  /** HTTP_DURATION_BUCKETS と同じ長さ。各要素は「そのバケット**だけ**に入った件数」。 */
  counts: number[];
  sum: number;
  /** `+Inf` を含む総件数。 */
  count: number;
}

/**
 * HTTP メトリクスの集計器を作る。
 *
 * カウンタもヒストグラムもプロセス内メモリにしか持たない(レート制限と同じ replicas=1 前提。
 * Prometheus のカウンタはプロセス再起動でリセットされる前提で `rate()` を使うため、
 * 永続化する必要はない)。
 */
export function createHttpMetrics(): HttpMetrics {
  /** `method|route|status` -> カウンタ */
  const requests = new Map<string, CounterEntry>();
  /** `method|route` -> ヒストグラム(status はヒストグラムのラベルに含めない — 掛け算を避ける) */
  const durations = new Map<string, HistogramEntry>();

  return {
    record(sample: HttpRequestSample): void {
      const method = normalizeMethod(sample.method);
      const route = normalizeRoute(sample.routePath);
      const status = statusClass(sample.status);

      const counterKey = `${method}|${route}|${status}`;
      const counter = requests.get(counterKey);
      if (counter) counter.value += 1;
      else requests.set(counterKey, { labels: { method, route, status }, value: 1 });

      const histogramKey = `${method}|${route}`;
      let histogram = durations.get(histogramKey);
      if (!histogram) {
        histogram = { labels: { method, route }, counts: HTTP_DURATION_BUCKETS.map(() => 0), sum: 0, count: 0 };
        durations.set(histogramKey, histogram);
      }
      histogram.sum += sample.durationSeconds;
      histogram.count += 1;
      const index = HTTP_DURATION_BUCKETS.findIndex((upper) => sample.durationSeconds <= upper);
      // index === -1 は「どのバケットにも入らない = +Inf のみ」。counts には積まず count だけ増える。
      if (index >= 0) {
        const current = histogram.counts[index];
        histogram.counts[index] = (current ?? 0) + 1;
      }
    },

    collect(): MetricFamily[] {
      const requestSamples: MetricSample[] = [...requests.values()].map((entry) => ({
        labels: entry.labels,
        value: entry.value,
      }));

      const durationSamples: MetricSample[] = [];
      for (const entry of durations.values()) {
        // `_bucket` は**累積**(le 以下の総数)であることに注意。counts はバケット単位なので足し上げる。
        let cumulative = 0;
        for (const [index, upper] of HTTP_DURATION_BUCKETS.entries()) {
          cumulative += entry.counts[index] ?? 0;
          durationSamples.push({
            suffix: "_bucket",
            labels: { ...entry.labels, le: formatBucketBoundary(upper) },
            value: cumulative,
          });
        }
        durationSamples.push({ suffix: "_bucket", labels: { ...entry.labels, le: "+Inf" }, value: entry.count });
        durationSamples.push({ suffix: "_sum", labels: entry.labels, value: entry.sum });
        durationSamples.push({ suffix: "_count", labels: entry.labels, value: entry.count });
      }

      return [
        {
          name: "kizami_http_requests_total",
          help: "HTTP リクエスト数(ルートパターン・ステータスクラス別の累積)",
          type: "counter",
          samples: requestSamples,
        },
        {
          name: "kizami_http_request_duration_seconds",
          help: "HTTP リクエストの所要時間(秒)",
          type: "histogram",
          samples: durationSamples,
        },
      ];
    },
  };
}

/**
 * プロセス固有のメトリクス(RSS・稼働秒数)。
 *
 * `process` が無い/必要な API を持たないランタイム(workerd)では**空配列**を返す。
 * 監視側は「その環境では取れない」として扱えばよく、`/metrics` 自体は変わらず 200 を返す。
 */
export function collectProcessMetrics(): MetricFamily[] {
  const families: MetricFamily[] = [];
  const proc = (globalThis as { process?: { memoryUsage?: () => { rss?: number }; uptime?: () => number } }).process;
  if (proc === undefined) return families;

  if (typeof proc.memoryUsage === "function") {
    try {
      const rss = proc.memoryUsage().rss;
      if (typeof rss === "number" && Number.isFinite(rss)) {
        families.push({
          name: "kizami_process_resident_memory_bytes",
          help: "プロセスの常駐セットサイズ(バイト)",
          type: "gauge",
          samples: [{ value: rss }],
        });
      }
    } catch {
      // 取れなくてもスクレイプ全体は落とさない(observability が落ちて本体が落ちるのは本末転倒)
    }
  }

  if (typeof proc.uptime === "function") {
    try {
      const uptime = proc.uptime();
      if (Number.isFinite(uptime)) {
        families.push({
          name: "kizami_process_uptime_seconds",
          help: "プロセスの稼働秒数",
          type: "gauge",
          samples: [{ value: uptime }],
        });
      }
    } catch {
      // 同上
    }
  }

  return families;
}

/**
 * バケット境界を Prometheus が読める文字列にする。
 * 整数は `1.0` のように小数点を付ける(慣例。`le="1"` でも動くが、公式クライアントに揃える)。
 */
function formatBucketBoundary(upper: number): string {
  return Number.isInteger(upper) ? upper.toFixed(1) : String(upper);
}

/** ラベル値のエスケープ(text format 0.0.4: `\`, `"`, 改行の3つ)。 */
function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

/** `# HELP` 行のエスケープ(`\` と改行のみ。`"` はエスケープしない)。 */
function escapeHelp(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

/** `{a="1",b="2"}` を組み立てる(ラベルが無ければ空文字)。 */
function formatLabels(labels: MetricLabels | undefined): string {
  if (labels === undefined) return "";
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",")}}`;
}

/** 数値の表記(NaN/Inf は Prometheus の綴りに合わせる)。 */
function formatValue(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
}

/**
 * MetricFamily の配列を text format 0.0.4 の本文にする。
 * サンプルが1本も無い family も `# HELP` / `# TYPE` だけは出す(監視側でメトリクスの
 * 存在自体は見えたほうが切り分けやすいため)。
 */
export function renderMetrics(families: MetricFamily[]): string {
  const lines: string[] = [];
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${escapeHelp(family.help)}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);
    for (const sample of family.samples) {
      lines.push(`${family.name}${sample.suffix ?? ""}${formatLabels(sample.labels)} ${formatValue(sample.value)}`);
    }
  }
  // text format は本文の末尾を改行で終える
  return `${lines.join("\n")}\n`;
}

/** `Content-Type` ヘッダの値(text format 0.0.4)。 */
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
