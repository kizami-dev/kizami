/**
 * セキュリティヘッダ(2026-10-22、セキュリティレビュー M4。src/lib/security-headers.ts)。
 *
 * - 200 / 401 / 404 のどれにも同じヘッダが付く
 * - CSP は API 用の最も厳しいもの(default-src 'none'; frame-ancestors 'none')
 * - HSTS は HTTPS で届いたときだけ(includeSubDomains / preload は付けない)
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { API_CONTENT_SECURITY_POLICY, HSTS_VALUE, isHttpsRequest } from "../src/lib/security-headers.js";
import { setupTestDb } from "./support/setup.js";

function expectBaseHeaders(res: Response) {
  expect(res.headers.get("content-security-policy")).toBe(API_CONTENT_SECURITY_POLICY);
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("API のセキュリティヘッダ", () => {
  it("200(GET /healthz)に付く。http では HSTS を付けない", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });
    const res = await app.request("http://localhost/healthz");
    expect(res.status).toBe(200);
    expectBaseHeaders(res);
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("401(未ログインの GET /me)と 404(METRICS_TOKEN 未設定の GET /metrics)にも付く", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });
    const unauthorized = await app.request("http://localhost/me");
    expect(unauthorized.status).toBe(401);
    expectBaseHeaders(unauthorized);
    const notFound = await app.request("http://localhost/metrics");
    expect(notFound.status).toBe(404);
    expectBaseHeaders(notFound);
  });

  it("HTTPS で届いたリクエストには includeSubDomains 無しの HSTS を付ける", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });
    const direct = await app.request("https://kizami.example.com/healthz");
    expect(direct.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
    expect(HSTS_VALUE).not.toMatch(/includeSubDomains|preload/i);
    const proxied = await app.request("http://localhost/healthz", { headers: { "X-Forwarded-Proto": "https" } });
    expect(proxied.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
  });

  it("APP_BASE_URL が https なら経路によらず HSTS を付ける", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db, appBaseUrl: "https://kizami.example.com" });
    const res = await app.request("http://localhost/healthz");
    expect(res.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
  });
});

describe("isHttpsRequest", () => {
  it("URL・X-Forwarded-Proto・CF-Visitor・宣言されたベース URL で判定する", () => {
    expect(isHttpsRequest(new Request("https://a.example/"))).toBe(true);
    expect(isHttpsRequest(new Request("http://a.example/"))).toBe(false);
    expect(isHttpsRequest(new Request("http://a.example/", { headers: { "x-forwarded-proto": "https, http" } }))).toBe(true);
    expect(isHttpsRequest(new Request("http://a.example/", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
    expect(isHttpsRequest(new Request("http://a.example/", { headers: { "cf-visitor": '{"scheme":"https"}' } }))).toBe(true);
    expect(isHttpsRequest(new Request("http://a.example/"), "https://kizami.example.com")).toBe(true);
    expect(isHttpsRequest(new Request("http://a.example/"), "http://localhost:8080")).toBe(false);
  });
});
