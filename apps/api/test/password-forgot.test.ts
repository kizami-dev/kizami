/**
 * 本人用の「パスワードを忘れた」再設定(routes/password-resets.ts の GET /config・POST /、
 * システムメールがある配備のみ)のルートレベルテスト。設計・判断点は同ファイル冒頭を参照。
 *
 * メール送信と Turnstile の siteverify はどちらも注入した偽実装で、外部には出ていかない。
 * リセットリンクのトークンは、偽の送信関数が受け取った本文から取り出す(実運用と同じ経路)。
 * 受諾(GET /password-resets/:token, POST /password-resets/:token/use)は管理者発行と共通の既存経路。
 */

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  authCredentials,
  createPasswordResetToken,
  enableUserTotp,
  passwordResetRequests,
  passwordResetTokens,
  tenants,
  upsertPendingUserTotp,
  userTotp,
  users,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { generatePasswordResetToken } from "../src/auth/password-reset-token.js";
import { RATE_LIMITS } from "../src/lib/rate-limit.js";
import type { SystemMail } from "../src/lib/system-mail.js";
import type { SelfServiceResetDeps } from "../src/routes/password-resets.js";
import { createTestDatabase, extractCookie, loginAndGetCookie, seedTenant, setupExtraUser, setupTestDb, testEncryptor } from "./support/setup.js";

const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
const MINUTE_MS = 60_000;
const NEW_PASSWORD = "a brand new horse battery staple";

interface Harness {
  db: Database;
  app: ReturnType<typeof createApp>;
  mails: SystemMail[];
  turnstileCalls: URLSearchParams[];
  /** 応答の後に走らせる処理(対象の探索・トークン発行・メール送信)。drain() で実行して完了を待つ */
  background: (() => Promise<void>)[];
}

/** Turnstile の偽 siteverify: トークンが "pass" のときだけ成功、"down" は通信失敗。 */
function fakeTurnstileFetch(calls: URLSearchParams[]): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    calls.push(form);
    if (form.get("response") === "down") throw new Error("network down");
    return Response.json({ success: form.get("response") === "pass" });
  }) as typeof fetch;
}

async function harness(
  mode: "disabled" | "enabled" | "enabled-turnstile",
  options: { db?: Database } = {},
): Promise<Harness> {
  const db = options.db ?? (await createTestDatabase());
  const mails: SystemMail[] = [];
  const turnstileCalls: URLSearchParams[] = [];
  const background: Harness["background"] = [];
  const selfServiceReset: SelfServiceResetDeps | undefined =
    mode === "disabled"
      ? undefined
      : {
          appBaseUrl: "https://app.example.com",
          sendMail: async (mail) => {
            mails.push(mail);
          },
          fetchFn: fakeTurnstileFetch(turnstileCalls),
          runInBackground: (task) => {
            background.push(task);
          },
          ...(mode === "enabled-turnstile" ? { turnstile: { secretKey: "secret", siteKey: "site-key" } } : {}),
        };
  const app = createApp({ db, ...(selfServiceReset ? { selfServiceReset } : {}) });
  return { db, app, mails, turnstileCalls, background };
}

function post(app: Harness["app"], path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** 本人用の再設定を要求する。 */
function requestReset(h: Harness, email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return post(h.app, "/password-resets", { email, ...extra }, headers);
}

/** 応答の後のバックグラウンド処理を実行して、完了(トークン発行・メール送信)を待つ。 */
async function flush(h: Harness) {
  while (h.background.length > 0) await h.background.shift()!();
}

function tokensFrom(mail: SystemMail | undefined): string[] {
  return [...(mail?.text.matchAll(/\/reset\/([\w-]+)/g) ?? [])].map((m) => m[1] as string);
}

function advanceMinutes(minutes: number) {
  vi.setSystemTime(new Date(Date.now() + minutes * MINUTE_MS));
}

describe("本人用の「パスワードを忘れた」再設定", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("システムメールなし(selfServiceReset 未指定)", () => {
    it("GET /config は selfService:false、POST は 404(メールも出ない)。既存の受諾経路は従来どおり", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("disabled", { db });

      const config = await h.app.request("/password-resets/config");
      expect(config.status).toBe(200);
      expect(await config.json()).toEqual({ selfService: false });

      const res = await requestReset(h, email);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(h.mails).toHaveLength(0);

      // 無効でも、存在しないトークンは従来どおり 404(受諾経路は変わらない)
      expect((await h.app.request("/password-resets/nonexistent-token")).status).toBe(404);
    });

    it("無効な配備では POST のレート制限カウンタを消費しない(何度叩いても 404 のまま)", async () => {
      const h = await harness("disabled");
      for (let i = 0; i < RATE_LIMITS.passwordResetRequestPerIp.max + 3; i += 1) {
        expect((await requestReset(h, "a@example.com")).status).toBe(404);
      }
    });
  });

  describe("GET /password-resets/config", () => {
    it("有効なら selfService:true。Turnstile のキーがある配備では turnstileSiteKey も返す", async () => {
      const plain = await harness("enabled");
      expect(await (await plain.app.request("/password-resets/config")).json()).toEqual({ selfService: true });

      const withKey = await harness("enabled-turnstile");
      expect(await (await withKey.app.request("/password-resets/config")).json()).toEqual({
        selfService: true,
        turnstileSiteKey: "site-key",
      });
    });

    it("ログイン画面を開くたびに叩かれるので、トークン経路のレート制限には数えない", async () => {
      const h = await harness("enabled");
      for (let i = 0; i < RATE_LIMITS.tokenPerIp.max + 5; i += 1) {
        expect((await h.app.request("/password-resets/config")).status).toBe(200);
      }
      // トークン経路(受諾リンク)の枠は残っている
      expect((await h.app.request("/password-resets/nonexistent-token")).status).toBe(404);
    });
  });

  describe("POST /password-resets(ユーザー列挙対策・メール)", () => {
    it("存在するメールでも存在しないメールでも、同じ 202 + 同じボディ。存在するときだけメールが出る", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });

      const known = await requestReset(h, email);
      const unknown = await requestReset(h, "nobody@example.com");
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(await known.json()).toEqual(await unknown.json());
      await flush(h);

      expect(h.mails).toHaveLength(1);
      expect(h.mails[0]?.to).toBe(email);
      expect(tokensFrom(h.mails[0])).toHaveLength(1);
      expect(h.mails[0]?.text).toContain("https://app.example.com/reset/");
    });

    it("応答の前に DB 書き込み(トークン発行)もメール送信も起きない。該当者あり・なしのどちらでも、応答直後はトークン 0 件で、バックグラウンドの完了後に作られる", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });

      // 該当者あり
      expect((await requestReset(h, email)).status).toBe(202);
      expect(await db.select().from(passwordResetTokens)).toHaveLength(0);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "password_reset.self_request"))).toHaveLength(0);
      expect(h.mails).toHaveLength(0);
      expect(h.background).toHaveLength(1);

      // 該当者なし: 応答の前にやることは同じ(スロットルの取得 1 回)で、後続の処理も予約される
      expect((await requestReset(h, "nobody@example.com")).status).toBe(202);
      expect(await db.select().from(passwordResetTokens)).toHaveLength(0);
      expect(h.background).toHaveLength(2);
      expect(await db.select().from(passwordResetRequests)).toHaveLength(2);

      await flush(h);
      expect(await db.select().from(passwordResetTokens)).toHaveLength(1);
      expect(h.mails).toHaveLength(1);
    });

    it("メール本文にテナント名も入力値(メールアドレス)も含めない。固定文面 + リンクのみ", async () => {
      const { db, tenantId, email } = await setupTestDb();
      await db.update(tenants).set({ name: "株式会社シークレット" }).where(eq(tenants.id, tenantId));
      const h = await harness("enabled", { db });

      await requestReset(h, email);
      await flush(h);

      const mail = h.mails[0]!;
      expect(mail.text).not.toContain("株式会社シークレット");
      expect(mail.subject).not.toContain("株式会社シークレット");
      expect(mail.text).not.toContain(email);
      expect(mail.text).not.toContain("Test User");
    });

    it("退職者と、パスワード資格情報の無いユーザー(SSO のみ等)にはトークンも送信も無い(応答は同じ 202)", async () => {
      const { db, tenantId, userId, email } = await setupTestDb();
      const h = await harness("enabled", { db });

      await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
      expect((await requestReset(h, email)).status).toBe(202);

      await db.update(users).set({ isActive: true }).where(eq(users.id, userId));
      await db.delete(authCredentials).where(eq(authCredentials.userId, userId));
      expect((await requestReset(h, email)).status).toBe(202);
      await flush(h);

      expect(h.mails).toHaveLength(0);
      expect(await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tenantId, tenantId))).toHaveLength(0);
      // スロットルは実在しないメール・退職者にも同じように取る(応答時間を該当者の有無から独立させるため)
      expect(await db.select().from(passwordResetRequests)).toHaveLength(1);
    });

    it("複数テナントに該当するときは、リンクを「アカウント1」「アカウント2」と番号付きで並べる(各トークンは本人発行・監査ログあり)", async () => {
      const db = await createTestDatabase();
      const a = await seedTenant(db);
      const b = await seedTenant(db);
      await db.update(tenants).set({ name: "A社" }).where(eq(tenants.id, a.tenantId));
      await db.update(tenants).set({ name: "B社" }).where(eq(tenants.id, b.tenantId));
      const h = await harness("enabled", { db });

      expect((await requestReset(h, a.email)).status).toBe(202);
      await flush(h);

      expect(h.mails).toHaveLength(1);
      const mail = h.mails[0]!;
      const tokens = tokensFrom(mail);
      expect(tokens).toHaveLength(2);
      expect(mail.text).toContain("アカウント1");
      expect(mail.text).toContain("アカウント2");
      expect(mail.text).not.toContain("A社");
      expect(mail.text).not.toContain("B社");

      const rows = await db.select().from(passwordResetTokens);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.source === "self" && r.createdBy === r.userId)).toBe(true);
      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "password_reset.self_request"));
      expect(logs).toHaveLength(2);

      // 受諾画面にはどの組織のアカウントかが出る(既存の GET が tenantName を返す)
      const previews = await Promise.all(tokens.map(async (t) => (await h.app.request(`/password-resets/${t}`)).json()));
      expect(previews.map((p) => (p as { tenantName: string }).tenantName).sort()).toEqual(["A社", "B社"]);
    });
  });

  describe("メールの言語(locale)", () => {
    it("リクエストの locale が最優先 → なければアカウントの users.locale → なければ ja。不正値は無視して次の候補へ", async () => {
      const cases: Array<{ name: string; stored: string | null; request: unknown; subject: string }> = [
        { name: "リクエスト優先", stored: "ko", request: "en", subject: "[KIZAMI] Reset your password" },
        { name: "保存値", stored: "zh-Hant", request: undefined, subject: "[KIZAMI] 密碼重設指引" },
        { name: "不正なリクエスト値は保存値へ", stored: "ko", request: "fr", subject: "[KIZAMI] 비밀번호 재설정 안내" },
        { name: "どちらも無ければ ja", stored: null, request: undefined, subject: "【KIZAMI】パスワード再設定のご案内" },
        { name: "不正なリクエスト値 + 保存値なし", stored: null, request: 5, subject: "【KIZAMI】パスワード再設定のご案内" },
        { name: "DB の不正値は無視して ja", stored: "xx", request: undefined, subject: "【KIZAMI】パスワード再設定のご案内" },
      ];
      for (const c of cases) {
        const { db, userId, email } = await setupTestDb();
        await db.update(users).set({ locale: c.stored }).where(eq(users.id, userId));
        const h = await harness("enabled", { db });
        const res = await requestReset(h, email, c.request === undefined ? {} : { locale: c.request });
        expect(res.status, c.name).toBe(202);
        await flush(h);
        expect(h.mails.map((m) => m.subject), c.name).toEqual([c.subject]);
      }
    });

    it("複数アカウント(複数テナント)では1通で、設定済みの最初のアカウントの言語", async () => {
      const db = await createTestDatabase();
      const a = await seedTenant(db);
      const b = await seedTenant(db);
      await db.update(users).set({ locale: "zh" }).where(eq(users.id, b.userId));
      const h = await harness("enabled", { db });
      expect((await requestReset(h, a.email)).status).toBe(202);
      await flush(h);
      expect(h.mails).toHaveLength(1);
      expect(h.mails[0]?.subject).toBe("[KIZAMI] 密码重置指引");
      expect(h.mails[0]?.text).toContain("账号1");
    });

    it("locale の有無・値は応答もスロットルも変えない(存在しないメールも同じ 202、5分以内は言語が違っても1通)", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });
      const known = await requestReset(h, email, { locale: "en" });
      const unknown = await requestReset(h, "nobody@example.com", { locale: "ko" });
      const throttled = await requestReset(h, email, { locale: "zh" });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(throttled.status).toBe(202);
      const knownBody = await known.json();
      expect(await unknown.json()).toEqual(knownBody);
      expect(await throttled.json()).toEqual(knownBody);
      await flush(h);
      expect(h.mails.map((m) => m.subject)).toEqual(["[KIZAMI] Reset your password"]);
    });
  });

  describe("メール単位の 5 分スロットル", () => {
    it("5 分以内の再要求は 202 だがメールを出さない。5 分たてば出る", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });

      await requestReset(h, email);
      advanceMinutes(4);
      expect((await requestReset(h, email)).status).toBe(202);
      await flush(h);
      expect(h.mails).toHaveLength(1);

      advanceMinutes(1);
      expect((await requestReset(h, email)).status).toBe(202);
      await flush(h);
      expect(h.mails).toHaveLength(2);
    });

    it("同時リクエストが何本来てもメールは 1 通", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });

      const responses = await Promise.all(Array.from({ length: 4 }, () => requestReset(h, email)));
      expect(responses.map((r) => r.status)).toEqual([202, 202, 202, 202]);
      await flush(h);

      expect(h.mails).toHaveLength(1);
      expect(await db.select().from(passwordResetTokens)).toHaveLength(1);
    });

    it("大文字小文字違いのメールでも同じキーで抑止される(別ユーザーでもすり抜けられない)", async () => {
      const { db, tenantId } = await setupTestDb();
      await setupExtraUser(db, { tenantId, email: "Case@Example.com", name: "Upper" });
      await setupExtraUser(db, { tenantId, email: "case@example.com", name: "Lower" });
      const h = await harness("enabled", { db });

      expect((await requestReset(h, "Case@Example.com")).status).toBe(202);
      expect((await requestReset(h, "case@example.com")).status).toBe(202);
      await flush(h);

      expect(h.mails).toHaveLength(1);
      expect(h.mails[0]?.to).toBe("Case@Example.com");
    });

    it("古い本人発行トークンは新しい発行で失効する(旧リンクは 404、新リンクは有効)", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });

      await requestReset(h, email);
      await flush(h);
      const [oldToken] = tokensFrom(h.mails[0]);
      advanceMinutes(6);
      await requestReset(h, email);
      await flush(h);
      const [newToken] = tokensFrom(h.mails[1]);

      expect((await h.app.request(`/password-resets/${oldToken}`)).status).toBe(404);
      expect((await h.app.request(`/password-resets/${newToken}`)).status).toBe(200);
    });

    it("管理者発行のトークンは本人の要求では失効しない", async () => {
      const { db, tenantId, userId, email } = await setupTestDb();
      const h = await harness("enabled", { db });
      await createPasswordResetToken(db, {
        tenantId,
        userId,
        tokenHash: "admin-h",
        expiresAt: Math.floor(Date.now() / MINUTE_MS) + 1440,
        createdBy: userId,
        createdAt: Math.floor(Date.now() / MINUTE_MS),
      });

      await requestReset(h, email);
      await flush(h);
      expect(await db.select().from(passwordResetTokens)).toHaveLength(2);
      const [admin] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, "admin-h"));
      expect(admin?.revokedAt).toBeNull();
    });
  });

  describe("Turnstile", () => {
    it("キーがある配備では必須(無し・失敗は 400、通信失敗は 503)。通れば 202", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled-turnstile", { db });

      const missing = await requestReset(h, email);
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ error: "turnstile_failed" });

      expect((await requestReset(h, email, { turnstileToken: "bad" })).status).toBe(400);
      expect((await requestReset(h, email, { turnstileToken: "down" })).status).toBe(503);
      await flush(h);
      expect(h.mails).toHaveLength(0);

      expect((await requestReset(h, email, { turnstileToken: "pass" })).status).toBe(202);
      await flush(h);
      expect(h.mails).toHaveLength(1);
      expect(h.turnstileCalls.at(-1)?.get("secret")).toBe("secret");
    });

    it("キーが無い配備では不要(siteverify も呼ばない)", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });
      expect((await requestReset(h, email)).status).toBe(202);
      await flush(h);
      expect(h.mails).toHaveLength(1);
      expect(h.turnstileCalls).toHaveLength(0);
    });
  });

  describe("入力検証・ガード・レート制限", () => {
    it("メールアドレスの形式不正は 400 invalid_email、body 不正は 400 invalid_body", async () => {
      const h = await harness("enabled");
      // IP 単位のレート制限(5 回)に収まるよう、本ケース全体で 5 リクエスト以内にする
      for (const email of ["", "not-an-email", 123, undefined]) {
        const res = await post(h.app, "/password-resets", { email });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid_email" });
      }
      const raw = await h.app.request("/password-resets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      });
      expect(raw.status).toBe(400);
    });

    it("Origin が許可オリジンと違えば 403、JSON 以外は 415。同じ Origin なら通る", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });

      const bad = await requestReset(h, email, {}, { origin: "https://evil.example.com" });
      expect(bad.status).toBe(403);
      expect(await bad.json()).toEqual({ error: "forbidden_origin" });

      const form = await h.app.request("/password-resets", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `email=${encodeURIComponent(email)}`,
      });
      expect(form.status).toBe(415);
      await flush(h);
      expect(h.mails).toHaveLength(0);

      expect((await requestReset(h, email, {}, { origin: "https://app.example.com" })).status).toBe(202);
    });

    it("IP ごとに 15 分 5 回(signup と同等)を超えると 429(宛先が違っても数える)", async () => {
      const h = await harness("enabled");
      for (let i = 0; i < RATE_LIMITS.passwordResetRequestPerIp.max; i += 1) {
        expect((await requestReset(h, `user${i}@example.com`)).status).toBe(202);
      }
      const limited = await requestReset(h, "another@example.com");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).not.toBeNull();
    });
  });

  describe("受諾(既存の /password-resets/:token 経路をそのまま使う)", () => {
    async function issue(h: Harness, email: string): Promise<string> {
      await requestReset(h, email);
      await flush(h);
      return tokensFrom(h.mails.at(-1))[0]!;
    }

    function use(h: Harness, token: string, password = NEW_PASSWORD) {
      return post(h.app, `/password-resets/${token}/use`, { password });
    }

    it("TTL は 1 時間: 59 分後は有効、61 分後は 410", async () => {
      const { db, email } = await setupTestDb();
      const h = await harness("enabled", { db });
      const token = await issue(h, email);

      advanceMinutes(59);
      expect((await h.app.request(`/password-resets/${token}`)).status).toBe(200);
      advanceMinutes(2);
      const expired = await h.app.request(`/password-resets/${token}`);
      expect(expired.status).toBe(410);
      expect((await use(h, token)).status).toBe(410);
    });

    it("使用すると新しいパスワードでログインでき、全セッションが失効する。使用の応答はそのままログイン状態", async () => {
      const { db, email, password } = await setupTestDb();
      const h = await harness("enabled", { db });
      const oldSession = await loginAndGetCookie(h.app, email, password);
      const token = await issue(h, email);

      const res = await use(h, token);
      expect(res.status).toBe(200);
      const newCookie = extractCookie(res);
      expect((await h.app.request("/me", { headers: { cookie: newCookie } })).status).toBe(200);
      expect((await h.app.request("/me", { headers: { cookie: oldSession } })).status).toBe(401);

      expect((await post(h.app, "/auth/login", { email, password: NEW_PASSWORD })).status).toBe(200);
      expect((await post(h.app, "/auth/login", { email, password })).status).toBe(401);
      // 二度目は使えない
      expect((await use(h, token)).status).toBe(404);
    });

    it("管理者発行と本人発行の両方があるとき、片方を使うともう片方も無効になる", async () => {
      const { db, tenantId, userId, email } = await setupTestDb();
      const h = await harness("enabled", { db });
      const selfToken = await issue(h, email);
      const nowMin = Math.floor(Date.now() / MINUTE_MS);
      // 管理者発行(本人発行の失効を伴う既存の再発行ではなく、並存させるため db を直接使う)
      const admin = await generatePasswordResetToken();
      await db.insert(passwordResetTokens).values({
        id: crypto.randomUUID(),
        tenantId,
        userId,
        tokenHash: admin.hash,
        expiresAt: nowMin + 1440,
        usedAt: null,
        revokedAt: null,
        createdBy: userId,
        source: "admin",
        createdAt: nowMin,
      });

      expect((await use(h, selfToken)).status).toBe(200);
      expect((await h.app.request(`/password-resets/${admin.token}`)).status).toBe(404);
    });

    it("2FA は解除されない: 2FA 利用者には使用直後のセッションを発行せず、ログインでは TOTP を求められる", async () => {
      const { db, tenantId, userId, email } = await setupTestDb();
      await upsertPendingUserTotp(db, { tenantId, userId, secretEncrypted: "x", createdAt: 0 });
      await enableUserTotp(db, { tenantId, userId, enabledAt: 1, lastUsedCounter: 0 });
      const h = await harness("enabled", { db });
      const token = await issue(h, email);

      const res = await use(h, token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ passwordUpdated: true, status: "login_required" });
      expect(res.headers.get("set-cookie")).toBeNull();

      // パスワードは更新済みで、ログインは第1段階を通っても TOTP が要る(セッションは張られない)。
      // 2FA が有効だが暗号鍵の無い test app では 503 になるので、totp_required への分岐は
      // encryptor 付きの app で確認する(routes/auth.ts の既存の挙動)。
      const loginApp = createApp({ db, encryptor: testEncryptor() });
      const login = await post(loginApp, "/auth/login", { email, password: NEW_PASSWORD });
      expect(login.status).toBe(200);
      expect(await login.json()).toEqual({ status: "totp_required" });
      // user_totp は残っている
      const [totp] = await db.select().from(userTotp).where(eq(userTotp.userId, userId));
      expect(totp?.enabledAt).not.toBeNull();
    });
  });
});
