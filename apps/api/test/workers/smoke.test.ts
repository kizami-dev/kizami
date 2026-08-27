/**
 * apps/api が **workerd + D1** で起動し、ログイン → 打刻 → 勤務状態 → 月次まで通ることの
 * スモークテスト(要件 §8「Workers+D1 動作保証」)。
 *
 * postgres-smoke.test.ts と対になる位置づけ: API 層の分岐はダイアレクトにもランタイムにも
 * 依存しないので、ここで見るのは「起動経路が workerd/D1 でも動くこと」だけ。ルートごとの
 * 振る舞いの網羅は Node レグ(test/*.test.ts、700件超)が持つ。
 *
 * 叩いているのは **配備するのと同じ src/workers.ts の default export**(`SELF` 経由)。
 * createApp() を直接呼ぶのではなく Worker の fetch パイプラインを通すことで、
 * バインディングの受け渡し・/api プレフィクスの二重登録・アイソレート内キャッシュまで含めて
 * 実際の経路を検証している。
 *
 * 走らせ方: `pnpm test:workers`(設定は apps/api/vitest.workers.config.ts)
 */

import { SELF, applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1Database } from "@kizami/db";
import { extractCookie, seedTenant } from "../support/seed.js";

const ORIGIN = "https://kizami.test";

/**
 * 実行時の「今」を基準にする(固定時刻は使わない)。
 *
 * Node レグのテストは vi.useFakeTimers() で時刻を固定するが、workerd は決定性のために
 * Date.now() を I/O 境界でしか進めない実行モデルで、偽タイマーとの相性が悪い。ここは
 * 集計値の正しさではなく「経路が通ること」を見るスモークなので、実時刻の1時間前に出勤を
 * 打って「勤務中」になることだけを確認すれば足りる。
 */
function jstMonth(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

let cookie: string;

beforeAll(async () => {
  // 本番では `wrangler d1 migrations apply` がデプロイ時に流す工程
  // (Workers に「起動時に1回」の場所が無いため — packages/db/src/d1.ts 冒頭を参照)
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

  // シードは Worker と同じ D1 バインディングへ直接書く(SELF が見る DB と同一)
  const { db } = createD1Database(env.DB);
  const { email, password } = await seedTenant(db);

  const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  cookie = extractCookie(login);
});

describe("apps/api boots on workerd + D1", () => {
  it("GET /healthz が Worker の fetch ハンドラ経由で応答する", async () => {
    const res = await SELF.fetch(`${ORIGIN}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "kizami" });
  });

  it("リバースプロキシ用の /api プレフィクスでも同じアプリが応答する", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/healthz`);
    expect(res.status).toBe(200);
  });

  it("未認証のリクエストは 401 で弾かれる(セッション判定が workerd でも効く)", async () => {
    const res = await SELF.fetch(`${ORIGIN}/attendance/status`);
    expect(res.status).toBe(401);
  });

  it("ログイン → 出勤打刻 → 勤務状態 → 月次集計まで通る", async () => {
    const clockIn = await SELF.fetch(`${ORIGIN}/punches`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: Math.floor(Date.now() / 60_000) - 60 }),
    });
    expect(clockIn.status).toBe(201);

    const status = await SELF.fetch(`${ORIGIN}/attendance/status`, { headers: { cookie } });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { state: string }).state).toBe("working");

    // 月次は @kizami/engine(Temporal polyfill 経由)まで通る経路。workerd にネイティブ
    // Temporal が無いため、ここが通ることは polyfill ローダーが効いていることの確認でもある
    const monthly = await SELF.fetch(`${ORIGIN}/attendance/monthly?month=${jstMonth(Date.now())}`, { headers: { cookie } });
    expect(monthly.status).toBe(200);
    const body = (await monthly.json()) as {
      days: unknown[];
      workSystem: string;
      figures: { source: string; totals: Record<string, number> };
    };
    expect(Array.isArray(body.days)).toBe(true);
    expect(body.workSystem).toBe("flex");
    expect(body.figures.source).toBe("live");
    // 区分別の分数(engine の CategorizedMinutes)がすべて数値で返る = 集計まで通っている
    expect(new Set(Object.keys(body.figures.totals))).toEqual(
      new Set(["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"]),
    );
  });

  it("GET /me が自分のプロフィルを返す(認可ミドルウェア経由)", async () => {
    const res = await SELF.fetch(`${ORIGIN}/me`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { email: "test@example.com", displayName: "Test User" } });
  });
});
