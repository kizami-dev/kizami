/**
 * システムメール設定の解析(lib/system-mail-config.ts)と Turnstile 設定の解析(lib/turnstile.ts の
 * parseTurnstileEnv)。signup-config.test.ts と同じく純関数としてここで検証する(終了・警告は node.ts)。
 */

import { describe, expect, it } from "vitest";
import { parseSystemMailEnv, SYSTEM_MAIL_REQUIRED_ENV } from "../src/lib/system-mail-config.js";
import { parseTurnstileEnv } from "../src/lib/turnstile.js";

const FULL = {
  SYSTEM_SMTP_URL: "smtps://user:pass@smtp.example.com:465",
  SYSTEM_MAIL_FROM: "KIZAMI <noreply@kizami.dev>",
  APP_BASE_URL: "https://app.kizami.dev/",
};

describe("parseSystemMailEnv", () => {
  it("3つが揃っていれば config を返す(APP_BASE_URL の末尾スラッシュは落とし、前後の空白も除く)", () => {
    expect(parseSystemMailEnv({ ...FULL, SYSTEM_MAIL_FROM: "  KIZAMI <noreply@kizami.dev> " })).toEqual({
      config: {
        systemSmtpUrl: FULL.SYSTEM_SMTP_URL,
        systemMailFrom: "KIZAMI <noreply@kizami.dev>",
        appBaseUrl: "https://app.kizami.dev",
      },
      missing: [],
      errors: [],
    });
  });

  it("何も設定されていなければ config: null で、欠けている名前をすべて返す(エラーではない)", () => {
    expect(parseSystemMailEnv({})).toEqual({ config: null, missing: [...SYSTEM_MAIL_REQUIRED_ENV], errors: [] });
  });

  it.each(SYSTEM_MAIL_REQUIRED_ENV)("%s だけ欠けていれば config: null で、その名前だけが missing に入る", (name) => {
    const result = parseSystemMailEnv({ ...FULL, [name]: undefined });
    expect(result.config).toBeNull();
    expect(result.missing).toEqual([name]);
    expect(result.errors).toEqual([]);
  });

  it("空白だけの値は欠落として扱う", () => {
    const result = parseSystemMailEnv({ ...FULL, SYSTEM_SMTP_URL: "   " });
    expect(result.config).toBeNull();
    expect(result.missing).toEqual(["SYSTEM_SMTP_URL"]);
  });

  it("SYSTEM_SMTP_URL のスキームと APP_BASE_URL の形式が不正なら errors に入れ、config: null", () => {
    const result = parseSystemMailEnv({ ...FULL, SYSTEM_SMTP_URL: "http://smtp.example.com", APP_BASE_URL: "app.kizami.dev" });
    expect(result.config).toBeNull();
    expect(result.missing).toEqual([]);
    expect(result.errors).toEqual([
      "SYSTEM_SMTP_URL must start with smtp:// or smtps://",
      "APP_BASE_URL must be an absolute http(s) URL (e.g. https://app.kizami.dev)",
    ]);
  });
});

describe("parseTurnstileEnv", () => {
  it("両方のキーが設定されていれば返し、どちらかが欠けていれば null(= Turnstile を使わない)", () => {
    expect(parseTurnstileEnv({ TURNSTILE_SECRET_KEY: " s ", TURNSTILE_SITE_KEY: "k" })).toEqual({ secretKey: "s", siteKey: "k" });
    expect(parseTurnstileEnv({ TURNSTILE_SECRET_KEY: "s" })).toBeNull();
    expect(parseTurnstileEnv({ TURNSTILE_SITE_KEY: "k" })).toBeNull();
    expect(parseTurnstileEnv({ TURNSTILE_SECRET_KEY: "  ", TURNSTILE_SITE_KEY: "k" })).toBeNull();
    expect(parseTurnstileEnv({})).toBeNull();
  });
});
