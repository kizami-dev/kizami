import { describe, expect, it } from "vitest";
import { ConfigError, assertSafeApiUrl, loadConfigFromEnv } from "../src/config.js";

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

describe("KIZAMI_API_URL の検証(平文 http の拒否)", () => {
  it("https は通す", () => {
    expect(() => assertSafeApiUrl("https://kizami.example")).not.toThrow();
    expect(() => assertSafeApiUrl("https://kizami.example:8443/api")).not.toThrow();
  });

  it("localhost / 127.0.0.1 / [::1] の http は通す", () => {
    expect(() => assertSafeApiUrl("http://localhost:3001")).not.toThrow();
    expect(() => assertSafeApiUrl("http://127.0.0.1:3001")).not.toThrow();
    expect(() => assertSafeApiUrl("http://[::1]:3001")).not.toThrow();
  });

  it("外部ホストへの http は拒否する", () => {
    expect(() => assertSafeApiUrl("http://kizami.example")).toThrow(ConfigError);
    expect(() => assertSafeApiUrl("http://192.168.1.10:3001")).toThrow(/https/);
  });

  it("localhost に見せかけたホストや他のスキームは拒否する", () => {
    expect(() => assertSafeApiUrl("http://localhost.evil.example")).toThrow(ConfigError);
    expect(() => assertSafeApiUrl("http://127.0.0.1.evil.example")).toThrow(ConfigError);
    expect(() => assertSafeApiUrl("ftp://localhost")).toThrow(ConfigError);
    expect(() => assertSafeApiUrl("not a url")).toThrow(ConfigError);
  });

  it("loadConfigFromEnv も外部ホストの http を拒否する", () => {
    expect(() => loadConfigFromEnv({ KIZAMI_API_URL: "http://kizami.example", KIZAMI_API_KEY: "kzm_abc" })).toThrow(ConfigError);
  });
});
