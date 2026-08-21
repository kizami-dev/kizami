import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { setupTestDb } from "./support/setup.js";

describe("api scaffold", () => {
  it("GET /healthz returns ok", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "kizami" });
  });
});
