/**
 * lib/log-safe.ts(ログに外の値を載せるときの下ごしらえ、2026-10-22)。
 */
import { describe, expect, it } from "vitest";
import { logValue, redactUrlCredentials } from "../src/lib/log-safe.js";

describe("logValue", () => {
  it("改行・制御文字をエスケープして1行に収める(偽のログ行を作れない)", () => {
    const out = logValue("denied\n[kizami] login ok\r\u2028x");
    expect(out).not.toMatch(/[\r\n\u2028]/);
    expect(out).toBe('"denied\\n[kizami] login ok\\r\\u2028x"');
  });

  it("長い値は切る", () => {
    expect(logValue("a".repeat(500), 10)).toBe(`"${"a".repeat(10)}…"`);
  });
});

describe("redactUrlCredentials", () => {
  it("ユーザー名とパスワードを伏せる", () => {
    expect(redactUrlCredentials("redis://default:s3cret@redis.internal:6379/0")).toBe("redis://***:***@redis.internal:6379/0");
    expect(redactUrlCredentials("rediss://:s3cret@redis.internal:6380")).toBe("rediss://:***@redis.internal:6380");
  });

  it("資格情報の無い URL はそのまま、読めない値は丸ごと伏せる", () => {
    expect(redactUrlCredentials("redis://localhost:6379")).toBe("redis://localhost:6379");
    expect(redactUrlCredentials("not a url with password")).toBe("(unparsable url)");
  });
});
