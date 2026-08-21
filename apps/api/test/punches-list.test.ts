import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

// JST 正午(日界・月境界から十分離れた安全な時刻)に固定して、テストを実行時刻から独立させる。
// 翌日分の打刻も「過去」として投入できるよう、対象日の翌日昼に固定する。
const FIXED_NOW = new Date("2026-06-16T03:00:00.000Z");

describe("GET /punches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the caller's valid punches within [from, to] in occurredAt order", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const post = (kind: string, occurredAt: number) =>
      app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind, occurredAt }),
      });

    const clockInAt = jstMinutes(2026, 6, 15, 9, 0);
    const clockOutAt = jstMinutes(2026, 6, 15, 18, 0);
    const nextDayClockInAt = jstMinutes(2026, 6, 16, 9, 0); // 現在時刻(2026-06-16 12:00 JST)より過去

    expect((await post("clock_in", clockInAt)).status).toBe(201);
    expect((await post("clock_out", clockOutAt)).status).toBe(201);
    // 翌日分は範囲外として除外されることを確認するために投入する
    expect((await post("clock_in", nextDayClockInAt)).status).toBe(201);

    const dayStart = jstMinutes(2026, 6, 15, 0, 0);
    const dayEnd = jstMinutes(2026, 6, 15, 23, 59);

    const res = await app.request(`/punches?from=${dayStart}&to=${dayEnd}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { punches: Array<{ id: string; kind: string; occurredAt: number }> };

    expect(body.punches).toHaveLength(2);
    expect(body.punches[0]).toEqual({ id: expect.any(String), kind: "clock_in", occurredAt: clockInAt });
    expect(body.punches[1]).toEqual({ id: expect.any(String), kind: "clock_out", occurredAt: clockOutAt });
  });

  it("rejects a request missing from/to with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const missingBoth = await app.request("/punches", { headers: { cookie } });
    expect(missingBoth.status).toBe(400);
    expect(await missingBoth.json()).toEqual({ error: "invalid_range" });

    const missingTo = await app.request("/punches?from=0", { headers: { cookie } });
    expect(missingTo.status).toBe(400);
    expect(await missingTo.json()).toEqual({ error: "invalid_range" });
  });

  it("rejects non-integer from/to with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches?from=abc&to=100", { headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_range" });
  });

  it("rejects from > to with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches?from=100&to=0", { headers: { cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_range" });
  });

  it("accepts from === to", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches?from=100&to=100", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ punches: [] });
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/punches?from=0&to=100");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
