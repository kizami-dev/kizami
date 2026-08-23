/**
 * 認証系エンドポイントのレート制限(2026-08-24 追加)のルートレベルテスト。
 *
 * クライアント IP は `CF-Connecting-IP` ヘッダで指定する(createApp の既定は trustProxy=true。
 * vitest から `app.request()` を直接叩くと TCP のソースアドレスが取れないため、
 * ヘッダで指定しないと全リクエストが同じキー "unknown" に落ちる — lib/client-ip.ts 参照)。
 *
 * 窓の経過は実時間を待たず `rateLimitNow` を注入して手で進める。
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { RATE_LIMITS } from "../src/lib/rate-limit.js";
import { setupTestDb } from "./support/setup.js";

/** 手で進められる時計。createApp に rateLimitNow として渡す。 */
function fakeClock(): { clock: { at: number }; now: () => number } {
  const clock = { at: 0 };
  return { clock, now: () => clock.at };
}

async function loginRequest(app: ReturnType<typeof createApp>, ip: string, email: string, password: string): Promise<Response> {
  return await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email, password }),
  });
}

describe("POST /auth/login のレート制限", () => {
  it(`同一 IP+メールへの ${RATE_LIMITS.loginPerIpEmail.max}回目までは 401、${RATE_LIMITS.loginPerIpEmail.max + 1}回目は 429`, async () => {
    const { db, email } = await setupTestDb();
    const app = createApp({ db });

    for (let i = 0; i < RATE_LIMITS.loginPerIpEmail.max; i += 1) {
      const res = await loginRequest(app, "203.0.113.1", email, "wrong-password");
      expect(res.status).toBe(401);
    }

    const blocked = await loginRequest(app, "203.0.113.1", email, "wrong-password");
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.headers.get("retry-after")).toBe(String(body.retryAfterSeconds));
  });

  it("別 IP からの試行は影響を受けない", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });

    for (let i = 0; i <= RATE_LIMITS.loginPerIpEmail.max; i += 1) {
      await loginRequest(app, "203.0.113.1", email, "wrong-password");
    }
    expect((await loginRequest(app, "203.0.113.1", email, password)).status).toBe(429);

    // 別 IP は 1回目なので、正しいパスワードならそのままログインできる
    const other = await loginRequest(app, "203.0.113.99", email, password);
    expect(other.status).toBe(200);
  });

  it("窓を過ぎればまた試せる(注入した時計を進めて検証)", async () => {
    const { db, email, password } = await setupTestDb();
    const { clock, now } = fakeClock();
    const app = createApp({ db, rateLimitNow: now });

    for (let i = 0; i <= RATE_LIMITS.loginPerIpEmail.max; i += 1) {
      await loginRequest(app, "203.0.113.1", email, "wrong-password");
    }
    expect((await loginRequest(app, "203.0.113.1", email, password)).status).toBe(429);

    clock.at += RATE_LIMITS.loginPerIpEmail.windowMs + 1;
    const afterWindow = await loginRequest(app, "203.0.113.1", email, password);
    expect(afterWindow.status).toBe(200);
  });

  it("メールの大文字小文字を変えても同じバケツに入る(回避できない)", async () => {
    const { db, email } = await setupTestDb();
    const app = createApp({ db });

    for (let i = 0; i < RATE_LIMITS.loginPerIpEmail.max; i += 1) {
      await loginRequest(app, "203.0.113.1", email, "wrong-password");
    }
    const upper = await loginRequest(app, "203.0.113.1", email.toUpperCase(), "wrong-password");
    expect(upper.status).toBe(429);
  });

  it(`同一 IP から多数のメールを試す総当たりは IP のみの上限(${RATE_LIMITS.loginPerIp.max}回)で止まる`, async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    // メールを毎回変えるので IP+メールの上限(10回)には掛からない。IP のみの上限で止まるはず。
    for (let i = 0; i < RATE_LIMITS.loginPerIp.max; i += 1) {
      const res = await loginRequest(app, "203.0.113.7", `attacker-${i}@example.com`, "wrong-password");
      expect(res.status).toBe(401);
    }
    const blocked = await loginRequest(app, "203.0.113.7", "attacker-last@example.com", "wrong-password");
    expect(blocked.status).toBe(429);
  });

  it("429 の応答はメールの実在有無を漏らさない(実在・不在で同一の本文)", async () => {
    const { db, email } = await setupTestDb();
    const app = createApp({ db });

    // 実在メールで上限まで使い切る
    for (let i = 0; i <= RATE_LIMITS.loginPerIpEmail.max; i += 1) {
      await loginRequest(app, "203.0.113.2", email, "wrong-password");
    }
    const existing = await loginRequest(app, "203.0.113.2", email, "wrong-password");

    // 不在メールで、別 IP から同じだけ使い切る
    for (let i = 0; i <= RATE_LIMITS.loginPerIpEmail.max; i += 1) {
      await loginRequest(app, "203.0.113.3", "nobody@example.com", "wrong-password");
    }
    const missing = await loginRequest(app, "203.0.113.3", "nobody@example.com", "wrong-password");

    expect(existing.status).toBe(429);
    expect(missing.status).toBe(429);
    const [a, b] = await Promise.all([existing.json(), missing.json()]);
    expect(Object.keys(a as object).sort()).toEqual(["error", "retryAfterSeconds"]);
    expect((a as { error: string }).error).toBe((b as { error: string }).error);
  });

  it("形式不正(400)はレート制限の対象外", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    for (let i = 0; i < RATE_LIMITS.loginPerIp.max + 5; i += 1) {
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" },
        body: JSON.stringify({ email: "only-email@example.com" }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("trustProxy=false ならヘッダを無視する(偽装した IP で制限を回避できない)", async () => {
    const { db, email } = await setupTestDb();
    const app = createApp({ db, trustProxy: false });

    // IP を毎回変えて申告しても、ヘッダが無視されるので同じキーに落ちる。
    // 上限は IP+メール(10回)側が先に来る。
    for (let i = 0; i < RATE_LIMITS.loginPerIpEmail.max; i += 1) {
      const res = await loginRequest(app, `203.0.113.${i + 10}`, email, "wrong-password");
      expect(res.status).toBe(401);
    }
    const blocked = await loginRequest(app, "198.51.100.1", email, "wrong-password");
    expect(blocked.status).toBe(429);
  });
});

describe("招待/パスワードリセットのトークン経路のレート制限", () => {
  it(`GET /invitations/:token は IP ごとに ${RATE_LIMITS.tokenPerIp.max}回まで(超過で 429)`, async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    for (let i = 0; i < RATE_LIMITS.tokenPerIp.max; i += 1) {
      const res = await app.request(`/invitations/guess-${i}`, { headers: { "cf-connecting-ip": "203.0.113.5" } });
      expect(res.status).toBe(404);
    }
    const blocked = await app.request("/invitations/guess-last", { headers: { "cf-connecting-ip": "203.0.113.5" } });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()) as { error: string }).toMatchObject({ error: "rate_limited" });

    // 別 IP は影響を受けない
    const other = await app.request("/invitations/guess-last", { headers: { "cf-connecting-ip": "203.0.113.6" } });
    expect(other.status).toBe(404);
  });

  it("招待とパスワードリセットは同じ IP バケツを共有する(トークン推測の総和で数える)", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    for (let i = 0; i < RATE_LIMITS.tokenPerIp.max; i += 1) {
      const res = await app.request(`/invitations/guess-${i}`, { headers: { "cf-connecting-ip": "203.0.113.8" } });
      expect(res.status).toBe(404);
    }
    const reset = await app.request("/password-resets/guess-x", { headers: { "cf-connecting-ip": "203.0.113.8" } });
    expect(reset.status).toBe(429);
  });

  it("POST /password-resets/:token/use も対象(窓を過ぎればまた試せる)", async () => {
    const { db } = await setupTestDb();
    const { clock, now } = fakeClock();
    const app = createApp({ db, rateLimitNow: now });

    const use = async (token: string): Promise<Response> =>
      await app.request(`/password-resets/${token}/use`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify({ password: "a-long-enough-password" }),
      });

    for (let i = 0; i < RATE_LIMITS.tokenPerIp.max; i += 1) {
      expect((await use(`guess-${i}`)).status).toBe(404);
    }
    expect((await use("guess-last")).status).toBe(429);

    clock.at += RATE_LIMITS.tokenPerIp.windowMs + 1;
    expect((await use("guess-after-window")).status).toBe(404);
  });
});

describe("公開打刻 API キーのレート制限", () => {
  it(`Bearer 付きリクエストは IP ごとに ${RATE_LIMITS.apiKeyPerIp.max}回/分まで(超過で 429)`, async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const attempt = async (): Promise<Response> =>
      await app.request("/punches?from=0&to=1", {
        headers: { authorization: "Bearer kzm_not-a-real-key", "cf-connecting-ip": "203.0.113.20" },
      });

    for (let i = 0; i < RATE_LIMITS.apiKeyPerIp.max; i += 1) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);
  });

  it("セッション Cookie 認証のリクエストは対象外(共有 IP でも巻き添えにならない)", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    // 同じ IP から Bearer 付きで上限まで使い切る
    for (let i = 0; i <= RATE_LIMITS.apiKeyPerIp.max; i += 1) {
      await app.request("/punches?from=0&to=1", {
        headers: { authorization: "Bearer kzm_not-a-real-key", "cf-connecting-ip": "203.0.113.21" },
      });
    }

    // Cookie 認証(Authorization ヘッダ無し)は 429 ではなく通常どおり 401
    const cookieAuth = await app.request("/punches?from=0&to=1", { headers: { "cf-connecting-ip": "203.0.113.21" } });
    expect(cookieAuth.status).toBe(401);
  });
});
