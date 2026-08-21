import { describe, expect, it, vi } from "vitest";
import { webhookChannel } from "../src/webhook.js";

describe("webhookChannel", () => {
  it("POSTs JSON with both `content` (Discord) and `text` (Slack) set to `title\\nbody`", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));

    const channel = webhookChannel("https://hooks.example.com/xyz", { fetchImpl });
    await channel.send({ to: {}, title: "退勤打刻の記録がありません", body: "2026-08-10 の退勤打刻が記録されていません。" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("expected fetchImpl to have been called");
    const [url, init] = call;
    expect(url).toBe("https://hooks.example.com/xyz");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });

    const body = JSON.parse(init?.body as string);
    const expectedText = "退勤打刻の記録がありません\n2026-08-10 の退勤打刻が記録されていません。";
    expect(body).toEqual({ content: expectedText, text: expectedText });
  });

  it("throws when the response is not ok", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 500 }));
    const channel = webhookChannel("https://hooks.example.com/xyz", { fetchImpl });

    await expect(channel.send({ to: {}, title: "t", body: "b" })).rejects.toThrow(/responded 500/);
  });

  it("has name 'webhook'", () => {
    const channel = webhookChannel("https://hooks.example.com/xyz");
    expect(channel.name).toBe("webhook");
  });
});
