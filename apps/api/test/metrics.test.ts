/**
 * GET /metrics(Prometheus text format 0.0.4)のテスト。設計は docs/design/observability.md。
 *
 * 見るべき点は3つ:
 * 1. 既定で口が開いていないこと(METRICS_TOKEN 未設定なら 404、トークン不一致なら 401)
 * 2. ラベルにカーディナリティ爆弾(生パス・ユーザーID)が入らないこと
 * 3. ドメインゲージが 60秒キャッシュされ、スクレイプ頻度が DB 負荷に直結しないこと
 */

import { describe, expect, it, vi } from "vitest";
import { punchEvents, recordWorkerHeartbeat, uuidv7 } from "@kizami/db";
import { createApp } from "../src/app.js";
import {
  collectProcessMetrics,
  createHttpMetrics,
  normalizeMethod,
  normalizeRoute,
  renderMetrics,
  statusClass,
} from "../src/lib/metrics.js";
import { createMetricsRoutes } from "../src/routes/metrics.js";
import { setupTestDb } from "./support/setup.js";

const TOKEN = "metrics-token-for-tests";
const AUTH = { authorization: `Bearer ${TOKEN}` };

/** 本文から `name{labels} value` を1行抜き出す(先頭一致)。 */
function findLine(body: string, prefix: string): string | undefined {
  return body.split("\n").find((line) => line.startsWith(prefix));
}

describe("メトリクスのラベル正規化", () => {
  it("/api プレフィクス付きの配信を同じルートに畳む", () => {
    expect(normalizeRoute("/api/punches/:id")).toBe("/punches/:id");
    expect(normalizeRoute("/api")).toBe("/");
    expect(normalizeRoute("/punches/:id")).toBe("/punches/:id");
    // ルートに一致しなかったリクエストは Hono が /* を返す(生パスは使わない)
    expect(normalizeRoute("/*")).toBe("/*");
  });

  it("想定外の HTTP メソッドは other に畳む", () => {
    expect(normalizeMethod("GET")).toBe("GET");
    expect(normalizeMethod("PROPFIND")).toBe("other");
  });

  it("ステータスはクラスに畳む", () => {
    expect(statusClass(201)).toBe("2xx");
    expect(statusClass(429)).toBe("4xx");
    expect(statusClass(500)).toBe("5xx");
  });
});

describe("HTTP メトリクスの集計", () => {
  it("カウンタとヒストグラム(累積バケット・_sum・_count)を組み立てる", () => {
    const metrics = createHttpMetrics();
    metrics.record({ method: "GET", routePath: "/healthz", status: 200, durationSeconds: 0.001 });
    metrics.record({ method: "GET", routePath: "/healthz", status: 200, durationSeconds: 0.2 });
    metrics.record({ method: "GET", routePath: "/healthz", status: 500, durationSeconds: 10 });

    const body = renderMetrics(metrics.collect());
    expect(findLine(body, 'kizami_http_requests_total{method="GET",route="/healthz",status="2xx"}')).toContain(" 2");
    expect(findLine(body, 'kizami_http_requests_total{method="GET",route="/healthz",status="5xx"}')).toContain(" 1");

    // 累積バケット: le=0.005 は 1件、le=0.5 は 2件、+Inf は 3件
    expect(findLine(body, 'kizami_http_request_duration_seconds_bucket{method="GET",route="/healthz",le="0.005"}')).toContain(" 1");
    expect(findLine(body, 'kizami_http_request_duration_seconds_bucket{method="GET",route="/healthz",le="0.5"}')).toContain(" 2");
    expect(findLine(body, 'kizami_http_request_duration_seconds_bucket{method="GET",route="/healthz",le="+Inf"}')).toContain(" 3");
    expect(findLine(body, 'kizami_http_request_duration_seconds_count{method="GET",route="/healthz"}')).toContain(" 3");
    expect(body).toContain("# TYPE kizami_http_request_duration_seconds histogram");
  });

  it("ラベル値の引用符・バックスラッシュ・改行をエスケープする", () => {
    const body = renderMetrics([
      { name: "kizami_test", help: "テスト", type: "gauge", samples: [{ labels: { v: 'a"b\\c\nd' }, value: 1 }] },
    ]);
    expect(body).toContain('kizami_test{v="a\\"b\\\\c\\nd"} 1');
  });

  it("Node ではプロセスメトリクスが取れる", () => {
    const names = collectProcessMetrics().map((family) => family.name);
    expect(names).toContain("kizami_process_resident_memory_bytes");
    expect(names).toContain("kizami_process_uptime_seconds");
  });
});

describe("GET /metrics", () => {
  it("METRICS_TOKEN 未設定の配備ではルートごと存在しない(404)", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });
    expect((await app.request("/metrics")).status).toBe(404);
    expect((await app.request("/metrics", { headers: AUTH })).status).toBe(404);
  });

  it("トークンが無い・違うと 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db, metricsToken: TOKEN });
    expect((await app.request("/metrics")).status).toBe(401);
    expect((await app.request("/metrics", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await app.request("/metrics", { headers: { authorization: TOKEN } })).status).toBe(401);
  });

  it("正しいトークンなら text format 0.0.4 でドメインゲージまで返す", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const nowMinutes = Math.floor(Date.now() / 60_000);
    await db.insert(punchEvents).values({
      id: uuidv7(),
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: nowMinutes - 60,
      recordedAt: nowMinutes - 60,
      source: "web",
      actorId: userId,
    });

    const app = createApp({ db, metricsToken: TOKEN, release: "0.7.0" });
    await app.request("/healthz");

    const res = await app.request("/metrics", { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");

    const body = await res.text();
    expect(findLine(body, 'kizami_build_info{version="0.7.0"}')).toContain(" 1");
    expect(findLine(body, "kizami_users_total")).toContain(" 1");
    expect(findLine(body, "kizami_tenants_total")).toContain(" 1");
    expect(findLine(body, "kizami_punches_last24h")).toContain(" 1");
    expect(findLine(body, 'kizami_http_requests_total{method="GET",route="/healthz",status="2xx"}')).toContain(" 1");
    expect(body).toContain("kizami_process_resident_memory_bytes");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("ラベルにユーザーIDや生パスを出さない", async () => {
    const { db, userId } = await setupTestDb();
    const app = createApp({ db, metricsToken: TOKEN });

    // 認証ミドルウェアで 401 になる(= どのルートにも入らない)リクエストと、
    // ユーザーIDを含む存在しないパスを叩いてもラベルは増えない
    await app.request(`/attendance/monthly/${userId}/2026-06`);
    await app.request(`/no-such-path/${userId}`);

    const body = await (await app.request("/metrics", { headers: AUTH })).text();
    expect(body).not.toContain(userId);
    expect(findLine(body, 'kizami_http_requests_total{method="GET",route="/*",status="4xx"}')).toBeDefined();
  });

  it("ワーカーの心拍(最終実行時刻・成功/失敗の累計)を出す", async () => {
    const { db } = await setupTestDb();
    await recordWorkerHeartbeat(db, { jobName: "overtime-alert", nowMinutes: 30_000_000, ok: true });
    await recordWorkerHeartbeat(db, { jobName: "overtime-alert", nowMinutes: 30_000_015, ok: false });
    await recordWorkerHeartbeat(db, { jobName: "reminder", nowMinutes: 30_000_015, ok: true });

    const app = createApp({ db, metricsToken: TOKEN });
    const body = await (await app.request("/metrics", { headers: AUTH })).text();

    // UTC エポック分 → 秒
    expect(findLine(body, 'kizami_worker_last_run_timestamp_seconds{job="overtime-alert"}')).toContain(
      ` ${30_000_015 * 60}`,
    );
    expect(findLine(body, 'kizami_worker_runs_total{job="overtime-alert",result="success"}')).toContain(" 1");
    expect(findLine(body, 'kizami_worker_runs_total{job="overtime-alert",result="failure"}')).toContain(" 1");
    expect(findLine(body, 'kizami_worker_runs_total{job="reminder",result="success"}')).toContain(" 1");
  });

  it("公開打刻APIのレート制限(Bearer 120回/分)のバケツを消費しない", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db, metricsToken: TOKEN });

    // 15秒間隔のスクレイプ換算で 130回ぶん。apiKeyPerIp の上限(120回/分)を超える回数を叩く
    for (let i = 0; i < 130; i += 1) {
      expect((await app.request("/metrics", { headers: AUTH })).status).toBe(200);
    }

    // そのうえで公開打刻APIを叩くと、429(レート制限)ではなく 401(キーが不正)になる
    const res = await app.request("/punches?from=0&to=1", { headers: { authorization: "Bearer kzm_not_a_real_key" } });
    expect(res.status).toBe(401);
  });

  it("ドメインゲージは 60秒キャッシュされる", async () => {
    const { db, tenantId } = await setupTestDb();
    let currentMs = 1_800_000_000_000;
    const routes = createMetricsRoutes(db, {
      token: TOKEN,
      httpMetrics: createHttpMetrics(),
      now: () => currentMs,
    });

    const scrape = async (): Promise<string> => (await routes.request("/", { headers: AUTH })).text();
    expect(findLine(await scrape(), "kizami_users_total")).toContain(" 1");

    // 2人目を足しても、窓の中は前の値が返る
    const { users } = await import("@kizami/db");
    await db.insert(users).values({
      id: uuidv7(),
      tenantId,
      email: "second@example.com",
      name: "Second",
      isActive: true,
      createdAt: 0,
    });
    currentMs += 59_000;
    expect(findLine(await scrape(), "kizami_users_total")).toContain(" 1");

    // 窓が明けたら数え直す
    currentMs += 2_000;
    expect(findLine(await scrape(), "kizami_users_total")).toContain(" 2");
  });

  it("DB が読めなくてもスクレイプは 200 のまま(ドメインゲージだけ欠測する)", async () => {
    const { db } = await setupTestDb();
    const broken = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") {
          return () => {
            throw new Error("db down");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = createApp({ db: broken, metricsToken: TOKEN });
    const res = await app.request("/metrics", { headers: AUTH });
    warn.mockRestore();

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("kizami_http_requests_total");
    expect(body).not.toContain("kizami_users_total");
  });
});
