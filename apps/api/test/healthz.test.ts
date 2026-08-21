import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("api scaffold", () => {
  it("GET /healthz returns ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "kizami" });
  });
});
