import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loginAndGetCookie, setupTestDb } from "./support/setup.js";

// JST 正午(日界・月境界から十分離れた安全な時刻)に固定して、テストを実行時刻から独立させる。
const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");

describe("punch flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts out, then clock_in -> break_start -> break_end -> clock_out drives status through working/onBreak/out", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const post = (kind: string, occurredAt: number) =>
      app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind, occurredAt }),
      });

    const status = async () => {
      const res = await app.request("/attendance/status", { headers: { cookie } });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ state: string; lastPunch: { kind: string; occurredAt: number } | null }>;
    };

    const initial = await status();
    expect(initial).toEqual({ state: "out", lastPunch: null });

    const now = Math.floor(FIXED_NOW.getTime() / 60_000);
    const clockInAt = now - 240;

    const clockInRes = await post("clock_in", clockInAt);
    expect(clockInRes.status).toBe(201);
    expect((await clockInRes.json()).punch).toEqual({ id: expect.any(String), kind: "clock_in", occurredAt: clockInAt });
    expect((await status()).state).toBe("working");

    const breakStartAt = clockInAt + 120;
    const breakStartRes = await post("break_start", breakStartAt);
    expect(breakStartRes.status).toBe(201);
    const afterBreakStart = await status();
    expect(afterBreakStart.state).toBe("onBreak");
    expect(afterBreakStart.lastPunch).toEqual({ kind: "break_start", occurredAt: breakStartAt });

    const breakEndAt = breakStartAt + 30;
    const breakEndRes = await post("break_end", breakEndAt);
    expect(breakEndRes.status).toBe(201);
    expect((await status()).state).toBe("working");

    const clockOutAt = breakEndAt + 90;
    const clockOutRes = await post("clock_out", clockOutAt);
    expect(clockOutRes.status).toBe(201);
    const final = await status();
    expect(final.state).toBe("out");
    expect(final.lastPunch).toEqual({ kind: "clock_out", occurredAt: clockOutAt });
  });

  it("defaults occurredAt to the current minute when omitted", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.punch.occurredAt).toBe(Math.floor(FIXED_NOW.getTime() / 60_000));
  });
});

describe("punch validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an unknown kind with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "lunch_start" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_kind" });
  });

  it("rejects occurredAt more than 5 minutes in the future with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const now = Math.floor(FIXED_NOW.getTime() / 60_000);
    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: now + 6 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "occurred_at_in_future" });
  });

  it("accepts occurredAt exactly 5 minutes in the future", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const now = Math.floor(FIXED_NOW.getTime() / 60_000);
    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: now + 5 }),
    });

    expect(res.status).toBe(201);
  });

  it("rejects a non-integer occurredAt with 400", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: 123.5 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_occurred_at" });
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "clock_in" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
