import { describe, expect, it } from "vitest";
import { encodeBase32 } from "../src/base32.js";
import {
  buildOtpauthUri,
  generateTotp,
  generateTotpSecret,
  totpCounterAt,
  verifyTotp,
  TOTP_STEP_SECONDS,
} from "../src/totp.js";

/**
 * RFC 6238 Appendix B のテストベクタ(SHA-1)。
 * 共有鍵は ASCII "12345678901234567890"(20バイト)を base32 にしたもの。
 *
 * RFC の表は 8 桁で書かれている。KIZAMI の既定は 6 桁なので、同じベクタを
 * digits=8 と digits=6(= 8桁の下6桁)の両方で確認する。
 */
const RFC6238_SECRET = encodeBase32(new TextEncoder().encode("12345678901234567890"));

const RFC6238_VECTORS: { time: number; totp8: string }[] = [
  { time: 59, totp8: "94287082" },
  { time: 1111111109, totp8: "07081804" },
  { time: 1111111111, totp8: "14050471" },
  { time: 1234567890, totp8: "89005924" },
  { time: 2000000000, totp8: "69279037" },
  { time: 20000000000, totp8: "65353130" },
];

describe("TOTP (RFC 6238 Appendix B)", () => {
  it("uses the documented base32 form of the RFC's shared secret", () => {
    expect(RFC6238_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  for (const { time, totp8 } of RFC6238_VECTORS) {
    it(`T=${time} produces ${totp8} (8 digits)`, async () => {
      await expect(generateTotp(RFC6238_SECRET, time, { digits: 8 })).resolves.toBe(totp8);
    });

    it(`T=${time} produces ${totp8.slice(-6)} (6 digits, KIZAMI の既定)`, async () => {
      await expect(generateTotp(RFC6238_SECRET, time)).resolves.toBe(totp8.slice(-6));
    });
  }
});

describe("totpCounterAt", () => {
  it("floors the UTC seconds by the 30s step", () => {
    expect(totpCounterAt(0)).toBe(0);
    expect(totpCounterAt(29)).toBe(0);
    expect(totpCounterAt(30)).toBe(1);
    expect(totpCounterAt(59)).toBe(1);
    // RFC 6238 Appendix B の T=20000000000 は 32 ビットに収まらない秒数
    expect(totpCounterAt(20000000000)).toBe(666666666);
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000;

  it("accepts the current code and reports its counter", async () => {
    const code = await generateTotp(RFC6238_SECRET, now);
    await expect(verifyTotp({ secret: RFC6238_SECRET, code, unixSeconds: now })).resolves.toEqual({
      counter: totpCounterAt(now),
    });
  });

  it("accepts a code from one step in the past and one step in the future (±1 の許容)", async () => {
    const previous = await generateTotp(RFC6238_SECRET, now - TOTP_STEP_SECONDS);
    const next = await generateTotp(RFC6238_SECRET, now + TOTP_STEP_SECONDS);
    await expect(verifyTotp({ secret: RFC6238_SECRET, code: previous, unixSeconds: now })).resolves.toEqual({
      counter: totpCounterAt(now) - 1,
    });
    await expect(verifyTotp({ secret: RFC6238_SECRET, code: next, unixSeconds: now })).resolves.toEqual({
      counter: totpCounterAt(now) + 1,
    });
  });

  it("rejects a code two steps away (窓の外)", async () => {
    const stale = await generateTotp(RFC6238_SECRET, now - 2 * TOTP_STEP_SECONDS);
    await expect(verifyTotp({ secret: RFC6238_SECRET, code: stale, unixSeconds: now })).resolves.toBeNull();
  });

  it("rejects a code generated from another secret", async () => {
    const other = generateTotpSecret();
    const code = await generateTotp(other, now);
    // 万一同じ6桁になった場合に false negative を出さないよう、生成し直して確認する
    const expected = await generateTotp(RFC6238_SECRET, now);
    if (code === expected) return;
    await expect(verifyTotp({ secret: RFC6238_SECRET, code, unixSeconds: now })).resolves.toBeNull();
  });

  it("rejects malformed input without touching the secret", async () => {
    for (const code of ["", "12345", "1234567", "12a456", " 123456 "]) {
      await expect(verifyTotp({ secret: RFC6238_SECRET, code, unixSeconds: now })).resolves.toBeNull();
    }
  });

  it("rejects a replay: counters at or below minCounterExclusive never match", async () => {
    const counter = totpCounterAt(now);
    const code = await generateTotp(RFC6238_SECRET, now);
    await expect(
      verifyTotp({ secret: RFC6238_SECRET, code, unixSeconds: now, minCounterExclusive: counter }),
    ).resolves.toBeNull();
    // 1つ前までしか使っていなければ、現在のカウンタはまだ受理できる
    await expect(
      verifyTotp({ secret: RFC6238_SECRET, code, unixSeconds: now, minCounterExclusive: counter - 1 }),
    ).resolves.toEqual({ counter });
  });
});

describe("generateTotpSecret", () => {
  it("returns a 32-character base32 string (160 ビット)", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("returns a different secret each time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("buildOtpauthUri", () => {
  it("builds a Key URI with the issuer both in the label and the query", () => {
    const uri = buildOtpauthUri({ issuer: "KIZAMI", accountName: "user@example.com", secret: RFC6238_SECRET });
    expect(uri.startsWith("otpauth://totp/KIZAMI%3Auser%40example.com?")).toBe(true);
    const query = new URL(uri.replace("otpauth://", "https://")).searchParams;
    expect(query.get("secret")).toBe(RFC6238_SECRET);
    expect(query.get("issuer")).toBe("KIZAMI");
    expect(query.get("algorithm")).toBe("SHA1");
    expect(query.get("digits")).toBe("6");
    expect(query.get("period")).toBe("30");
  });

  it("escapes issuer / account names that contain URI-significant characters", () => {
    const uri = buildOtpauthUri({ issuer: "株式会社 A/B", accountName: "a b@example.com", secret: RFC6238_SECRET });
    expect(uri).not.toContain(" ");
    expect(uri.split("?")[0]).not.toContain("/B");
  });
});
