/**
 * セッション Cookie を発行する未認証の POST への Origin 検証 + JSON 必須化(2026-10-05、ログイン CSRF 対策)。
 *
 * app.ts の `authPostOrigins`(node.ts / workers.ts が APP_BASE_URL と CORS_ORIGIN から作る)で有効になる。
 * 空のとき(APP_BASE_URL / CORS_ORIGIN 未設定)は、リクエストの Host と CORS を許したオリジンだけを通す代わりのガード(2026-10-22)。
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authPostAllowedOrigins } from "../src/lib/json-post-guard.js";
import { setupTestDb } from "./support/setup.js";

const ALLOWED = "https://kizami.example.com";

/** ガードが掛かる未認証 POST(app.ts)。トークン系は実在しないトークンで、ガードを通れば 404 になる。 */
const GUARDED_PATHS = [
  "/auth/login",
  "/auth/login/totp",
  "/auth/oidc/start",
  "/invitations/no-such-token/accept",
  "/password-resets/no-such-token/use",
] as const;

function post(app: ReturnType<typeof createApp>, path: string, headers: Record<string, string>, body = "{}") {
  return app.request(path, { method: "POST", headers, body });
}

describe("authPostAllowedOrigins", () => {
  it("明示された値だけをオリジンに正規化して返す(空文字・未設定・重複・不正な値は落とす)", () => {
    expect(authPostAllowedOrigins([undefined, ""])).toEqual([]);
    expect(authPostAllowedOrigins(["https://a.example.com/app", "https://a.example.com", "http://localhost:3000"])).toEqual([
      "https://a.example.com",
      "http://localhost:3000",
    ]);
    expect(authPostAllowedOrigins(["not a url", "*"])).toEqual([]);
  });
});

describe("未認証の POST の Origin 検証(authPostOrigins あり)", () => {
  for (const path of GUARDED_PATHS) {
    it(`${path}: 別のオリジンは 403、JSON 以外は 415`, async () => {
      const { db } = await setupTestDb();
      const app = createApp({ db, authPostOrigins: [ALLOWED] });

      const wrongOrigin = await post(app, path, { "content-type": "application/json", origin: "https://evil.example.net" });
      expect(wrongOrigin.status).toBe(403);
      expect(await wrongOrigin.json()).toEqual({ error: "forbidden_origin" });

      const form = await post(app, path, { "content-type": "application/x-www-form-urlencoded", origin: ALLOWED }, "a=b");
      expect(form.status).toBe(415);
      const noType = await post(app, path, { origin: ALLOWED });
      expect(noType.status).toBe(415);
    });

    it(`${path}: 正しいオリジンと Origin なし(curl 等)はガードを通る`, async () => {
      const { db } = await setupTestDb();
      const app = createApp({ db, authPostOrigins: [ALLOWED] });

      for (const headers of [{ "content-type": "application/json", origin: ALLOWED }, { "content-type": "application/json" }]) {
        const res = await post(app, path, headers);
        // ガードを通ったあとの結果(本文が空なので 400/401/404 のいずれか)。403/415 ではないこと
        expect([403, 415]).not.toContain(res.status);
      }
    });
  }

  it("許可するオリジンが複数あるとき(APP_BASE_URL と CORS_ORIGIN)どちらも通る", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db, authPostOrigins: [ALLOWED, "http://localhost:3000"] });
    for (const origin of [ALLOWED, "http://localhost:3000"]) {
      const res = await post(app, "/auth/login", { "content-type": "application/json", origin }, JSON.stringify({ email, password }));
      expect(res.status).toBe(200);
    }
  });

  it("OIDC の callback(GET)・Bearer の打刻 API・ログアウトにはガードを掛けない", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db, authPostOrigins: [ALLOWED] });

    // IdP からのリダイレクトは Origin も JSON も付かない GET
    const callback = await app.request("/auth/oidc/callback?code=x&state=y", { headers: { origin: "https://idp.example.org" } });
    expect([403, 415]).not.toContain(callback.status);

    // Bearer 経路は Origin を見ない(未認証なので 401 になるだけ)
    const punch = await post(app, "/punches", {
      "content-type": "text/plain",
      authorization: "Bearer kzm_does-not-exist",
      origin: "https://evil.example.net",
    });
    expect(punch.status).toBe(401);
  });
});

describe("authPostOrigins なし(APP_BASE_URL / CORS_ORIGIN 未設定の配備): 自分自身の Host を許可オリジンにする", () => {
  for (const path of GUARDED_PATHS) {
    it(`${path}: 別サイトの Origin・cross-site・JSON 以外は弾く`, async () => {
      const { db } = await setupTestDb();
      const app = createApp({ db });

      const wrongOrigin = await post(app, path, { "content-type": "application/json", origin: "https://evil.example.net" });
      expect(wrongOrigin.status).toBe(403);
      expect(await wrongOrigin.json()).toEqual({ error: "forbidden_origin" });

      // ホストが同じでもポートが違えば別オリジン
      const otherPort = await post(app, path, { "content-type": "application/json", origin: "http://localhost:4444" });
      expect(otherPort.status).toBe(403);

      const crossSite = await post(app, path, { "content-type": "application/json", "sec-fetch-site": "cross-site" });
      expect(crossSite.status).toBe(403);

      const form = await post(app, path, { "content-type": "text/plain", origin: "http://localhost" }, "{}");
      expect(form.status).toBe(415);
    });
  }

  it("他サイトのフォーム(text/plain)からのログインではセッションが張られない(ログイン CSRF)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const res = await post(
      app,
      "/auth/login",
      { "content-type": "text/plain", origin: "https://evil.example.net", "sec-fetch-site": "cross-site" },
      JSON.stringify({ email, password }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie().some((line) => line.startsWith("kizami_session="))).toBe(false);
  });

  it("同じ Host の Origin・X-Forwarded-Host と一致する Origin・CORS を許したオリジン・Origin なし(curl 等)は通る", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db, corsOrigin: "http://localhost:3000" });
    const body = JSON.stringify({ email, password });
    const cases: Record<string, string>[] = [
      { "content-type": "application/json", origin: "http://localhost", "sec-fetch-site": "same-origin" },
      { "content-type": "application/json", origin: "https://kizami.example.com", "x-forwarded-host": "kizami.example.com" },
      { "content-type": "application/json", origin: "http://localhost:3000", "sec-fetch-site": "same-site" },
      { "content-type": "application/json" },
    ];
    for (const headers of cases) {
      const res = await post(app, "/auth/login", headers, body);
      expect(res.status).toBe(200);
    }
  });
});
