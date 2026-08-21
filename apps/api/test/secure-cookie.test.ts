import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { setupTestDb } from "./support/setup.js";

describe("session cookie security", () => {
  it("sets Secure attribute when secureCookies is enabled", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, secureCookies: true });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: seeded.email, password: seeded.password }),
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kizami_session=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
  });

  it("returns the same error for unknown email and wrong password", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db });

    const unknown = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "whatever whatever" }),
    });
    const wrongPassword = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: seeded.email, password: "wrong password here" }),
    });

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrongPassword.json());
  });
});
