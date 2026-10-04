import { describe, expect, it } from "vitest";
import { isTransientConnectError, withStartupRetry } from "../src/lib/startup-retry.js";

/** Drizzle と同じく、ドライバのエラーを cause に包んだエラーを作る。 */
function wrapped(code: string): Error {
  const cause = Object.assign(new Error(`getaddrinfo ${code} postgres.kizami-cloud.svc`), { code });
  return new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', { cause });
}

const noSleep = async () => {};

describe("isTransientConnectError", () => {
  it("cause を辿って一時的な接続失敗を見つける", () => {
    expect(isTransientConnectError(wrapped("EAI_AGAIN"))).toBe(true);
    expect(isTransientConnectError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isTransientConnectError(Object.assign(new Error("starting up"), { code: "57P03" }))).toBe(true);
  });

  it("認証失敗や SQL エラーは一時的とみなさない", () => {
    expect(isTransientConnectError(Object.assign(new Error("password authentication failed"), { code: "28P01" }))).toBe(false);
    expect(isTransientConnectError(new Error("syntax error"))).toBe(false);
    expect(isTransientConnectError("not an error")).toBe(false);
  });
});

describe("withStartupRetry", () => {
  it("一時的な失敗のあと成功すれば、その値を返す", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withStartupRetry(
      async () => {
        calls++;
        if (calls < 3) throw wrapped("EAI_AGAIN");
        return "ok";
      },
      { sleep: noSleep, onRetry: ({ delayMs }) => retries.push(delayMs) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    // 500ms から倍々
    expect(retries).toEqual([500, 1000]);
  });

  it("一時的でない失敗は再試行せずに投げる", async () => {
    let calls = 0;
    await expect(
      withStartupRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("password authentication failed"), { code: "28P01" });
        },
        { sleep: noSleep, onRetry: () => {} },
      ),
    ).rejects.toThrow("password authentication failed");
    expect(calls).toBe(1);
  });

  it("上限回数に達したら最後のエラーを投げる", async () => {
    let calls = 0;
    await expect(
      withStartupRetry(
        async () => {
          calls++;
          throw wrapped("ECONNREFUSED");
        },
        { attempts: 4, sleep: noSleep, onRetry: () => {} },
      ),
    ).rejects.toThrow("Failed query");
    expect(calls).toBe(4);
  });

  it("待ち時間は maxDelayMs で頭打ちになる", async () => {
    const delays: number[] = [];
    await expect(
      withStartupRetry(
        async () => {
          throw wrapped("EAI_AGAIN");
        },
        { attempts: 6, baseDelayMs: 1000, maxDelayMs: 3000, sleep: noSleep, onRetry: ({ delayMs }) => delays.push(delayMs) },
      ),
    ).rejects.toThrow();
    expect(delays).toEqual([1000, 2000, 3000, 3000, 3000]);
  });
});
