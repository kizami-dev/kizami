import { describe, expect, it, vi } from "vitest";
import { KizamiApiClient, KizamiApiError } from "../src/client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("KizamiApiClient — success paths", () => {
  it("punch() sends the kind and returns the created punch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { punch: { id: "p1", kind: "clock_in", occurredAt: 1000 } }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_test", fetchImpl });

    const punch = await client.punch({ kind: "clock_in" });

    expect(punch).toEqual({ id: "p1", kind: "clock_in", occurredAt: 1000 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3091/punches");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer kzm_test", "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ kind: "clock_in" });
  });

  it("punch() omits occurredAt from the body when not given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { punch: { id: "p1", kind: "clock_in", occurredAt: 1000 } }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_test", fetchImpl });

    await client.punch({ kind: "clock_in" });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("occurredAt");
  });

  it("listPunches() sends from/to as query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { punches: [] }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091/", apiKey: "kzm_test", fetchImpl });

    await client.listPunches({ from: 10, to: 20 });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3091/punches?from=10&to=20");
  });

  it("getMonthlySummary() omits the month query param when not given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { totals: {}, flexBalance: {}, warnings: [], days: [], closed: false, amended: false }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_test", fetchImpl });

    await client.getMonthlySummary();

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3091/attendance/monthly");
  });

  it("strips a trailing slash from baseUrl before building request URLs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { state: "out", lastPunch: null }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091///", apiKey: "kzm_test", fetchImpl });

    await client.getStatus();

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3091/attendance/status");
  });
});

describe("KizamiApiClient — error translation", () => {
  it("translates 401 into a message about an invalid/expired API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_bad", fetchImpl });

    const err = await client.getStatus().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KizamiApiError);
    expect((err as KizamiApiError).status).toBe(401);
    expect((err as KizamiApiError).code).toBe("unauthorized");
    expect((err as KizamiApiError).message).toMatch(/APIキーが無効か失効しています/);
  });

  it("translates 403 insufficient_api_key_scope into a message about missing scope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "insufficient_api_key_scope" }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_readonly", fetchImpl });

    await expect(client.punch({ kind: "clock_in" })).rejects.toThrow(/権限\(スコープ\)がありません/);
  });

  it("translates 409 month_closed into a message about the month being closed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: "month_closed" }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_test", fetchImpl });

    await expect(client.punch({ kind: "clock_in" })).rejects.toThrow(/既に締め処理済み/);
  });

  it("translates 409 month_closed_requires_unlock distinctly from plain month_closed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: "month_closed_requires_unlock" }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_test", fetchImpl });

    await expect(client.punch({ kind: "clock_in" })).rejects.toThrow(/締めの解除権限/);
  });

  it("falls back to a generic message carrying the error code for unmapped codes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_body" }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_test", fetchImpl });

    await expect(client.punch({ kind: "clock_in" })).rejects.toMatchObject({ status: 400, code: "invalid_body" });
  });

  it("falls back to a status-only message when the response body has no error code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:3091", apiKey: "kzm_test", fetchImpl });

    await expect(client.getStatus()).rejects.toThrow(/HTTP 500/);
  });

  it("translates a network-level fetch failure into a connectivity message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new KizamiApiClient({ baseUrl: "http://localhost:9999", apiKey: "kzm_test", fetchImpl });

    await expect(client.getStatus()).rejects.toThrow(/接続できませんでした/);
  });
});
