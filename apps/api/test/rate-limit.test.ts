/**
 * lib/rate-limit.ts(スライディングウィンドウのレート制限)の単体テスト。
 *
 * 実時間を待たずに窓の経過を再現するため、すべて `now` を注入して手で進める
 * (createRateLimiter の now は、そもそもこのテスト容易性のために用意した注入点)。
 */

import { describe, expect, it } from "vitest";
import { createFailureLimiter, createRateLimiter } from "../src/lib/rate-limit.js";

/** 手で進められる時計。`at` を書き換えると limiter の見る「現在時刻」が変わる。 */
function fakeClock(start = 0) {
  const clock = { at: start };
  return { clock, now: () => clock.at };
}

describe("createRateLimiter", () => {
  it("窓内は max 回まで許可し、max+1 回目を拒否する", () => {
    const { now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now });

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
  });

  it("キーごとに独立したカウンタを持つ", () => {
    const { now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    // 別キーは影響を受けない
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(false);
  });

  it("拒否時の retryAfterSeconds は「最も古い試行が窓から出るまで」の秒数(切り上げ・最低1)", () => {
    const { clock, now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now });

    limiter.check("k"); // t=0 に1回目
    clock.at += 10_000;
    limiter.check("k"); // t=10s に2回目
    clock.at += 5_000; // t=15s

    // 1回目(t=0)が窓から出るのは t=60s。あと45秒。
    const denied = limiter.check("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(45);
  });

  it("許可時は retryAfterSeconds が 0", () => {
    const { now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now });
    expect(limiter.check("k")).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("固定窓ではなくスライディング: 古い試行が1つ抜けた分だけ枠が戻る", () => {
    const { clock, now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now });

    limiter.check("k"); // t=0
    clock.at += 30_000;
    limiter.check("k"); // t=30s
    expect(limiter.check("k").allowed).toBe(false); // 窓内に2件

    // t=61s: 1件目(t=0)だけが窓から出る → 1回ぶんだけ空く
    clock.at = 61_000;
    expect(limiter.check("k").allowed).toBe(true);
    // 2件目(t=30s)はまだ窓内なので、すぐにまた埋まる
    expect(limiter.check("k").allowed).toBe(false);
  });

  it("窓を完全に過ぎればカウンタは全部リセットされる", () => {
    const { clock, now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now });

    limiter.check("k");
    limiter.check("k");
    expect(limiter.check("k").allowed).toBe(false);

    clock.at += 60_001;
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
  });

  it("拒否された試行は記録されない(叩き続けても窓が永久に埋まったままにならない)", () => {
    const { clock, now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now });

    limiter.check("k"); // t=0 に1回だけ受理
    // t=1s..50s の間、拒否され続ける。これが記録されてしまうと窓が延び続ける。
    for (let t = 1_000; t <= 50_000; t += 1_000) {
      clock.at = t;
      expect(limiter.check("k").allowed).toBe(false);
    }

    // 受理された唯一の試行(t=0)が窓から出た直後には必ず1回通るはず
    clock.at = 60_001;
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("max=0 なら常に拒否する(退避用の設定として成立すること)", () => {
    const { now } = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 0, now });
    const result = limiter.check("k");
    expect(result.allowed).toBe(false);
    // 窓内に試行が1件も無いケース。窓1つぶんを目安に返す(NaN を返さないことの回帰テスト)。
    expect(result.retryAfterSeconds).toBe(60);
  });
});

describe("createFailureLimiter(失敗だけを数える、先に予約する)", () => {
  it("max 回まで予約でき、max 回目の予約は reachedLimit。その次は拒否", () => {
    const { now } = fakeClock();
    const limiter = createFailureLimiter({ windowMs: 60_000, max: 3, now });

    const a = limiter.reserve("k");
    const b = limiter.reserve("k");
    const c = limiter.reserve("k");
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, true]);
    expect([a.reachedLimit, b.reachedLimit, c.reachedLimit]).toEqual([false, false, true]);
    expect(limiter.reserve("k").allowed).toBe(false);
    expect(limiter.reserve("other").allowed).toBe(true);
  });

  it("検証中(未確定)の予約も上限に数える — 同時の N 本が揃ってすり抜けない", () => {
    const { now } = fakeClock();
    const limiter = createFailureLimiter({ windowMs: 60_000, max: 5, now });
    const results = Array.from({ length: 20 }, () => limiter.reserve("k"));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("release は自分の予約だけを返す(過去の失敗は残る)。2回呼んでも1回ぶん", () => {
    const { now } = fakeClock();
    const limiter = createFailureLimiter({ windowMs: 60_000, max: 3, now });
    limiter.reserve("k"); // 失敗として残す
    limiter.reserve("k"); // 失敗として残す
    const success = limiter.reserve("k");
    expect(success.reachedLimit).toBe(true);
    success.release();
    success.release();
    // 2件残っているので、あと1回だけ予約できる
    expect(limiter.reserve("k").allowed).toBe(true);
    expect(limiter.reserve("k").allowed).toBe(false);
  });

  it("reset で記録が消え、窓を過ぎれば自然に解ける", () => {
    const { clock, now } = fakeClock();
    const limiter = createFailureLimiter({ windowMs: 60_000, max: 2, now });
    limiter.reserve("a");
    limiter.reserve("a");
    limiter.reserve("b");
    limiter.reserve("b");
    expect(limiter.reserve("a").allowed).toBe(false);
    limiter.reset("a");
    expect(limiter.reserve("a").allowed).toBe(true);

    expect(limiter.reserve("b").retryAfterSeconds).toBe(60);
    clock.at += 60_001;
    expect(limiter.reserve("b").allowed).toBe(true);
  });

  it("retryAfterSeconds は上限を割り込むのに必要な失敗が窓を出るまでの秒数", () => {
    const { clock, now } = fakeClock();
    const limiter = createFailureLimiter({ windowMs: 60_000, max: 2, now });
    limiter.reserve("k"); // t=0
    clock.at = 10_000;
    limiter.reserve("k"); // t=10s(上限2)
    clock.at = 20_000;
    // 1件以下に減るには t=0 が窓を出る必要がある → t=60s、今から 40秒
    expect(limiter.reserve("k").retryAfterSeconds).toBe(40);
  });
});
