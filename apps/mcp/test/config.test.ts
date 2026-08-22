import { describe, expect, it } from "vitest";
import { ConfigError, loadConfigFromEnv } from "../src/config.js";

describe("loadConfigFromEnv", () => {
  it("reads KIZAMI_API_URL and KIZAMI_API_KEY", () => {
    const config = loadConfigFromEnv({ KIZAMI_API_URL: "http://localhost:3091", KIZAMI_API_KEY: "kzm_abc" });
    expect(config).toEqual({ apiUrl: "http://localhost:3091", apiKey: "kzm_abc" });
  });

  it("throws ConfigError when KIZAMI_API_URL is missing", () => {
    expect(() => loadConfigFromEnv({ KIZAMI_API_KEY: "kzm_abc" })).toThrow(ConfigError);
    expect(() => loadConfigFromEnv({ KIZAMI_API_KEY: "kzm_abc" })).toThrow(/KIZAMI_API_URL/);
  });

  it("throws ConfigError when KIZAMI_API_KEY is missing", () => {
    expect(() => loadConfigFromEnv({ KIZAMI_API_URL: "http://localhost:3091" })).toThrow(/KIZAMI_API_KEY/);
  });

  it("throws ConfigError when KIZAMI_API_KEY does not look like a KIZAMI key", () => {
    expect(() =>
      loadConfigFromEnv({ KIZAMI_API_URL: "http://localhost:3091", KIZAMI_API_KEY: "sk-not-a-kizami-key" }),
    ).toThrow(/形式が不正/);
  });
});
