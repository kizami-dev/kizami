/**
 * SIGNUP_MODE ほかの環境変数の解釈(lib/signup-config.ts)。起動時 fail-fast の判定部分を
 * 純関数として切り出してあるので、プロセスを落とさずにここで検証する(終了は node.ts)。
 */

import { describe, expect, it } from "vitest";
import { parseSignupEnv, SIGNUP_REQUIRED_ENV } from "../src/lib/signup-config.js";

const FULL_ENV = {
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  SYSTEM_SMTP_URL: "smtps://user:pass@email-smtp.ap-northeast-1.amazonaws.com:465",
  SYSTEM_MAIL_FROM: "KIZAMI <noreply@kizami.dev>",
  APP_BASE_URL: "https://app.kizami.dev/",
};

describe("parseSignupEnv", () => {
  it("未設定・空・off は無効(config: null)で、他の変数が欠けていてもエラーにしない", () => {
    for (const SIGNUP_MODE of [undefined, "", "  ", "off", "OFF"]) {
      expect(parseSignupEnv({ SIGNUP_MODE })).toEqual({ ok: true, config: null });
    }
  });

  it("invite / open で全変数が揃っていれば有効。APP_BASE_URL の末尾スラッシュは落とす", () => {
    for (const mode of ["invite", "open", "Invite"] as const) {
      const result = parseSignupEnv({ SIGNUP_MODE: mode, ...FULL_ENV });
      expect(result).toEqual({
        ok: true,
        config: {
          mode: mode.toLowerCase(),
          turnstileSecretKey: FULL_ENV.TURNSTILE_SECRET_KEY,
          turnstileSiteKey: FULL_ENV.TURNSTILE_SITE_KEY,
          systemSmtpUrl: FULL_ENV.SYSTEM_SMTP_URL,
          systemMailFrom: FULL_ENV.SYSTEM_MAIL_FROM,
          appBaseUrl: "https://app.kizami.dev",
        },
      });
    }
  });

  it.each(SIGNUP_REQUIRED_ENV)("%s が欠けていれば、その名前を明示してエラーにする", (name) => {
    const env: Record<string, string | undefined> = { SIGNUP_MODE: "open", ...FULL_ENV, [name]: undefined };
    const result = parseSignupEnv(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain(name);
    }
  });

  it("空白だけの値も欠落として扱い、欠けているものをすべて列挙する", () => {
    const result = parseSignupEnv({ SIGNUP_MODE: "invite", TURNSTILE_SECRET_KEY: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const text = result.errors.join("\n");
      for (const name of SIGNUP_REQUIRED_ENV) expect(text).toContain(name);
    }
  });

  it("不明な SIGNUP_MODE(綴り間違い)は黙って off にせずエラー", () => {
    const result = parseSignupEnv({ SIGNUP_MODE: "enabled", ...FULL_ENV });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("SIGNUP_MODE");
  });

  it("SYSTEM_SMTP_URL が smtp(s):// でない、APP_BASE_URL が絶対 URL でない場合はエラー", () => {
    const smtp = parseSignupEnv({ SIGNUP_MODE: "open", ...FULL_ENV, SYSTEM_SMTP_URL: "http://example.com" });
    expect(smtp.ok).toBe(false);
    const base = parseSignupEnv({ SIGNUP_MODE: "open", ...FULL_ENV, APP_BASE_URL: "app.kizami.dev" });
    expect(base.ok).toBe(false);
  });
});
