/**
 * lib/rate-limit.ts(スライディングウィンドウのレート制限)の単体テスト。
 *
 * 実時間を待たずに窓の経過を再現するため、すべて `now` を注入して手で進める
 * (createRateLimiter の now は、そもそもこのテスト容易性のために用意した注入点)。
 */

import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/lib/rate-limit.js";

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
