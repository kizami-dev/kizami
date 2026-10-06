/**
 * セルフサインアップ(routes/signup.ts、docs/design/saas.md)のルートレベルテスト。
 *
 * メール送信と Turnstile の siteverify はどちらも注入した偽実装で、外部には出ていかない。
 * 確認リンクのトークンは、偽の送信関数が受け取った本文から取り出す(実運用と同じ経路)。
 */

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  createSignupInviteCode,
  pendingSignups,
  permissionPresets,
  revokeSignupInviteCode,
  signupInviteCodes,
  tenants,
  users,
  workPolicyVersions,
  type Database,
} from "@kizami/db";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import { RATE_LIMITS } from "../src/lib/rate-limit.js";
import { hashSignupInviteCode } from "../src/lib/signup-invite-code.js";
import type { SystemMail } from "../src/lib/system-mail.js";
import { SIGNUP_RESEND_THROTTLE_MINUTES, type SignupDeps } from "../src/routes/signup.js";
import { extractCookie, createTestDatabase, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const PASSWORD = "correct horse battery staple";

interface Harness {
  db: Database;
  app: ReturnType<typeof createApp>;
  mails: SystemMail[];
  turnstileCalls: { url: string; form: URLSearchParams }[];
}

/** Turnstile の偽 siteverify: トークンが "pass" のときだけ成功、"down" は通信失敗。 */
function fakeTurnstileFetch(calls: Harness["turnstileCalls"]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    calls.push({ url: String(url), form });
    if (form.get("response") === "down") throw new Error("network down");
    return Response.json({ success: form.get("response") === "pass" });
  }) as typeof fetch;
}

async function harness(
  mode: "invite" | "open" | null,
  options: { db?: Database; signupOverrides?: Partial<SignupDeps> } = {},
): Promise<Harness> {
  const db = options.db ?? (await createTestDatabase());
  const mails: SystemMail[] = [];
  const turnstileCalls: Harness["turnstileCalls"] = [];
  const signup: SignupDeps | undefined =
    mode === null
      ? undefined
      : {
          mode,
          turnstileSecretKey: "secret",
          turnstileSiteKey: "site-key",
          appBaseUrl: "https://app.example.com",
          sendMail: async (mail) => {
            mails.push(mail);
          },
          fetchFn: fakeTurnstileFetch(turnstileCalls),
          ...(options.signupOverrides ?? {}),
        };
  const app = createApp({ db, ...(signup ? { signup } : {}) });
  return { db, app, mails, turnstileCalls };
}

function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    email: "owner@example.com",
    organizationName: "株式会社サンプル",
    adminName: "山田 太郎",
    turnstileToken: "pass",
    ...overrides,
  };
}

function post(app: Harness["app"], path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** 確認(POST /signup/verify/:token)。パスワードは確認時に設定する。 */
function confirmSignup(app: Harness["app"], token: string, body: unknown = { password: PASSWORD }, headers: Record<string, string> = {}) {
  return post(app, `/signup/verify/${token}`, body, headers);
}

function tokenFrom(mail: SystemMail | undefined): string {
  const match = mail?.text.match(/\/signup\/verify\/([\w-]+)/);
  if (!match?.[1]) throw new Error("no verification link in mail");
  return match[1];
}

/** 登録して確認メールのトークンを返す。 */
async function register(h: Harness, overrides: Record<string, unknown> = {}): Promise<string> {
  const before = h.mails.length;
  const res = await post(h.app, "/signup", signupBody(overrides));
  expect(res.status).toBe(202);
  expect(h.mails.length).toBe(before + 1);
  return tokenFrom(h.mails[before]);
}

async function issueCode(db: Database, overrides: Partial<Parameters<typeof createSignupInviteCode>[1]> = {}, plain = "ABCD-EFGH-JKMN-PQRS") {
  return {
    plain,
    row: await createSignupInviteCode(db, {
      codeHash: await hashSignupInviteCode(plain),
      note: null,
      maxUses: 1,
      expiresAt: null,
      createdAt: Math.floor(FIXED_NOW.getTime() / 60_000),
      ...overrides,
    }),
  };
}

describe("セルフサインアップ", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("SIGNUP_MODE=off(signup 未指定)", () => {
    it("GET /signup/config は 200 で { mode: 'off' }、他の /signup/* はすべて 404", async () => {
      const h = await harness(null);
      const config = await h.app.request("/signup/config");
      expect(config.status).toBe(200);
      expect(await config.json()).toEqual({ mode: "off" });

      expect((await post(h.app, "/signup", signupBody())).status).toBe(404);
      expect((await h.app.request("/signup/verify/whatever")).status).toBe(404);
      expect((await post(h.app, "/signup/verify/whatever")).status).toBe(404);
      expect((await h.app.request("/signup/anything-else")).status).toBe(404);
      expect(h.mails).toHaveLength(0);
    });

    it("off ではレート制限のカウンタも消費しない(何度叩いても 404 のまま)", async () => {
      const h = await harness(null);
      for (let i = 0; i < RATE_LIMITS.signupPerIp.max + 3; i += 1) {
        expect((await post(h.app, "/signup", signupBody())).status).toBe(404);
      }
    });
  });

  describe("GET /signup/config", () => {
    it("invite / open では mode と turnstileSiteKey を返す", async () => {
      for (const mode of ["invite", "open"] as const) {
        const h = await harness(mode);
        const res = await h.app.request("/signup/config");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ mode, turnstileSiteKey: "site-key" });
      }
    });
  });

  describe("POST /signup 〜 確認(open モード)", () => {
    it("正常系: 202 → メール → 確認でテナント・同梱プリセット・既定 work policy・管理者が作られ、ログイン済みで返る", async () => {
      const h = await harness("open");
      const res = await post(h.app, "/signup", signupBody());
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ status: "verification_sent" });

      // 確認前はテナントが存在しない(未確認の空テナントを作らない)
      expect(await h.db.select().from(tenants)).toHaveLength(0);
      expect(h.mails).toHaveLength(1);
      const mail = h.mails[0]!;
      expect(mail.to).toBe("owner@example.com");
      expect(mail.text).toContain("https://app.example.com/signup/verify/");
      const token = tokenFrom(mail);

      // pending にはトークンのハッシュだけ(平文は保存されない)。パスワード列そのものが無い
      const [pending] = await h.db.select().from(pendingSignups);
      expect(pending?.tokenHash).not.toBe(token);
      expect(pending).not.toHaveProperty("passwordHash");

      const preview = await h.app.request(`/signup/verify/${token}`);
      expect(preview.status).toBe(200);
      expect(await preview.json()).toEqual({
        organizationName: "株式会社サンプル",
        adminName: "山田 太郎",
        email: "owner@example.com",
      });

      const confirmed = await confirmSignup(h.app, token);
      expect(confirmed.status).toBe(200);
      const body = (await confirmed.json()) as { user: { id: string; email: string; displayName: string } };
      expect(body.user).toMatchObject({ email: "owner@example.com", displayName: "山田 太郎" });

      // テナント・同梱プリセット・既定 work policy・管理者
      const tenantRows = await h.db.select().from(tenants);
      expect(tenantRows).toHaveLength(1);
      const tenantId = tenantRows[0]!.id;
      expect(tenantRows[0]!.name).toBe("株式会社サンプル");
      const presets = await h.db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId));
      expect(presets.map((p) => p.name).sort()).toEqual(["マネージャー", "メンバー", "管理者"]);
      const policies = await h.db.select().from(workPolicyVersions).where(eq(workPolicyVersions.tenantId, tenantId));
      expect(policies).toHaveLength(1);
      expect(policies[0]?.standardDayMinutes).toBe(480);
      const admins = await h.db.select().from(users).where(eq(users.tenantId, tenantId));
      expect(admins).toHaveLength(1);
      expect(admins[0]?.id).toBe(body.user.id);

      // ログイン済み(Cookie でそのまま管理者向け API が通る)
      const cookie = extractCookie(confirmed);
      const me = await h.app.request("/me", { headers: { cookie } });
      expect(me.status).toBe(200);
      const members = await h.app.request("/members", { headers: { cookie } });
      expect(members.status).toBe(200);

      // 登録時のパスワードで通常ログインもできる
      const login = await post(h.app, "/auth/login", { email: "owner@example.com", password: PASSWORD });
      expect(login.status).toBe(200);

      // pending は消費済みでテナントが記録され、監査ログ tenant.signup が残る
      const [consumed] = await h.db.select().from(pendingSignups);
      expect(consumed?.consumedAt).not.toBeNull();
      expect(consumed?.tenantId).toBe(tenantId);
      const logs = await h.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      expect(logs.map((l) => l.action)).toContain("tenant.signup");
      const signupLog = logs.find((l) => l.action === "tenant.signup");
      expect(signupLog?.actorId).toBe(body.user.id);
      expect(signupLog?.target).toBe(`tenant:${tenantId}`);
    });

    it("Turnstile には secret・token・remoteip を送る(IP は CF-Connecting-IP から)", async () => {
      const h = await harness("open");
      await post(h.app, "/signup", signupBody(), { "cf-connecting-ip": "203.0.113.7" });
      expect(h.turnstileCalls).toHaveLength(1);
      expect(h.turnstileCalls[0]?.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(Object.fromEntries(h.turnstileCalls[0]!.form)).toEqual({ secret: "secret", response: "pass", remoteip: "203.0.113.7" });
    });

    it("入力検証: 不正なメール・空の組織名/氏名は 400(メールも送らない)", async () => {
      const h = await harness("open");
      const cases: [Record<string, unknown>, string][] = [
        [{ email: "not-an-email" }, "invalid_email"],
        [{ email: undefined }, "invalid_email"],
        [{ organizationName: "  " }, "invalid_organization_name"],
        [{ adminName: "" }, "invalid_name"],
      ];
      for (const [override, error] of cases) {
        const res = await post(h.app, "/signup", signupBody(override));
        expect(res.status, error).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe(error);
      }
      expect((await h.app.request("/signup", { method: "POST", body: "not json", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" } })).status).toBe(400);
      expect(h.mails).toHaveLength(0);
      expect(h.turnstileCalls).toHaveLength(0);
    });

    it("Turnstile 失敗は 400 turnstile_failed、検証できないときは 503、トークン欠落も 400。pending は作らない", async () => {
      const h = await harness("open");
      const failed = await post(h.app, "/signup", signupBody({ turnstileToken: "bad" }));
      expect(failed.status).toBe(400);
      expect(await failed.json()).toEqual({ error: "turnstile_failed" });

      const missing = await post(h.app, "/signup", signupBody({ turnstileToken: undefined }));
      expect(missing.status).toBe(400);

      const down = await post(h.app, "/signup", signupBody({ turnstileToken: "down" }));
      expect(down.status).toBe(503);
      expect(await down.json()).toEqual({ error: "turnstile_unavailable" });

      expect(await h.db.select().from(pendingSignups)).toHaveLength(0);
      expect(h.mails).toHaveLength(0);
    });

    it("同じメールのユーザーが既にいても応答は同一(202 + 同じボディ)で、同様に確認メールが出る", async () => {
      const seeded = await setupTestDb();
      const h = await harness("open", { db: seeded.db });

      const fresh = await post(h.app, "/signup", signupBody({ email: "brand-new@example.com" }));
      const existing = await post(h.app, "/signup", signupBody({ email: seeded.email }));
      expect(existing.status).toBe(fresh.status);
      expect(existing.status).toBe(202);
      expect(await existing.json()).toEqual(await fresh.json());
      expect(h.mails.map((m) => m.to)).toEqual(["brand-new@example.com", seeded.email]);

      // 既存ユーザーを引いていないので、確認すれば別テナントが作られる(同一メールの複数テナントは許容)
      const confirmed = await confirmSignup(h.app, tokenFrom(h.mails[1]));
      expect(confirmed.status).toBe(200);
      expect(await h.db.select().from(tenants)).toHaveLength(2);
    });

    it("同一メールで再登録すると新しいトークンに置き換わり、古いリンクは無効になる", async () => {
      const h = await harness("open");
      const first = await register(h);
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + (SIGNUP_RESEND_THROTTLE_MINUTES + 1) * 60_000));
      const second = await register(h, { organizationName: "改め株式会社" });
      expect(second).not.toBe(first);
      expect(await h.db.select().from(pendingSignups)).toHaveLength(1);

      expect((await h.app.request(`/signup/verify/${first}`)).status).toBe(404);
      const confirmed = await confirmSignup(h.app, second);
      expect(confirmed.status).toBe(200);
      expect((await h.db.select().from(tenants))[0]?.name).toBe("改め株式会社");
    });

    it("メール送信が失敗しても応答は 202 のまま(例外は握ってログに残す)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const h = await harness("open", {
        signupOverrides: {
          sendMail: async () => {
            throw new Error("smtp down");
          },
        },
      });
      const res = await post(h.app, "/signup", signupBody());
      expect(res.status).toBe(202);
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
      errorSpy.mockRestore();
    });

    it("open モードでは inviteCode を渡しても無視される", async () => {
      const h = await harness("open");
      const res = await post(h.app, "/signup", signupBody({ inviteCode: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" }));
      expect(res.status).toBe(202);
    });
  });

  describe("確認メールの言語(locale)", () => {
    it("リクエストの locale の言語で出る。省略・不正値・型違いは ja。応答はどれも同一の 202", async () => {
      const cases: Array<[unknown, string]> = [
        ["en", "[KIZAMI] Confirm your email address"],
        ["ko", "[KIZAMI] 이메일 주소 확인"],
        ["zh", "[KIZAMI] 邮箱地址确认"],
        ["zh-Hant", "[KIZAMI] 電子郵件地址確認"],
        ["ja", "【KIZAMI】メールアドレスの確認"],
        [undefined, "【KIZAMI】メールアドレスの確認"],
        ["fr", "【KIZAMI】メールアドレスの確認"],
        ["en-US", "【KIZAMI】メールアドレスの確認"],
        [123, "【KIZAMI】メールアドレスの確認"],
        [{ x: 1 }, "【KIZAMI】メールアドレスの確認"],
      ];
      for (const [locale, subject] of cases) {
        const h = await harness("open");
        const res = await post(h.app, "/signup", signupBody(locale === undefined ? {} : { locale }));
        expect(res.status, String(locale)).toBe(202);
        expect(await res.json()).toEqual({ status: "verification_sent" });
        expect(h.mails.map((m) => m.subject), String(locale)).toEqual([subject]);
        expect(tokenFrom(h.mails[0])).toBeTruthy();
      }
    });

    it("locale はスロットルに影響しない: 5分以内の再申請は言語が違ってもメールを出さず、応答も同じ", async () => {
      const h = await harness("open");
      const first = await post(h.app, "/signup", signupBody({ locale: "en" }));
      const second = await post(h.app, "/signup", signupBody({ locale: "ko" }));
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(await second.json()).toEqual(await first.json());
      expect(h.mails).toHaveLength(1);
    });
  });

  describe("確認リンク(トークン経路)", () => {
    it("存在しないトークンは GET / POST とも 404", async () => {
      const h = await harness("open");
      expect((await h.app.request("/signup/verify/nonexistent")).status).toBe(404);
      expect((await confirmSignup(h.app, "nonexistent")).status).toBe(404);
    });

    it("期限切れ(24時間超)は 410。テナントは作られない", async () => {
      const h = await harness("open");
      const token = await register(h);
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 25 * HOUR_MS));

      const get = await h.app.request(`/signup/verify/${token}`);
      expect(get.status).toBe(410);
      expect(await get.json()).toEqual({ error: "expired" });
      expect((await confirmSignup(h.app, token)).status).toBe(410);
      expect(await h.db.select().from(tenants)).toHaveLength(0);
    });

    it("24時間以内ならまだ確認できる", async () => {
      const h = await harness("open");
      const token = await register(h);
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 23 * HOUR_MS));
      expect((await confirmSignup(h.app, token)).status).toBe(200);
    });

    it("二重使用: 2回目は 404(消費済みは不存在と区別しない)。テナントは1つだけ", async () => {
      const h = await harness("open");
      const token = await register(h);
      expect((await confirmSignup(h.app, token)).status).toBe(200);
      expect((await confirmSignup(h.app, token)).status).toBe(404);
      expect((await h.app.request(`/signup/verify/${token}`)).status).toBe(404);
      expect(await h.db.select().from(tenants)).toHaveLength(1);
    });

    it("同じトークンの確認が同時に来ても、テナントが作られるのは1つだけ", async () => {
      const h = await harness("open");
      const token = await register(h);
      const results = await Promise.all([confirmSignup(h.app, token), confirmSignup(h.app, token)]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 404]);
      expect(await h.db.select().from(tenants)).toHaveLength(1);
    });
  });

  describe("招待コード(invite モード)", () => {
    it("コード無し・不正なコードは 400 invalid_invite_code(pending は作らない)", async () => {
      const h = await harness("invite");
      await issueCode(h.db);
      for (const inviteCode of [undefined, "", "WRONG-CODE-0000-0000"]) {
        const res = await post(h.app, "/signup", signupBody({ inviteCode }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid_invite_code" });
      }
      expect(await h.db.select().from(pendingSignups)).toHaveLength(0);
      expect(h.mails).toHaveLength(0);
    });

    it("有効なコードなら通り、入口では消費しない。確認で used_count が 1 になる。大文字小文字・ハイフン有無は問わない", async () => {
      const h = await harness("invite");
      const { row } = await issueCode(h.db, { maxUses: 3 });
      const token = await register(h, { inviteCode: "abcd efgh-jkmnpqrs" });

      const [afterRegister] = await h.db.select().from(signupInviteCodes).where(eq(signupInviteCodes.id, row.id));
      expect(afterRegister?.usedCount).toBe(0);

      expect((await confirmSignup(h.app, token)).status).toBe(200);
      const [afterConfirm] = await h.db.select().from(signupInviteCodes).where(eq(signupInviteCodes.id, row.id));
      expect(afterConfirm?.usedCount).toBe(1);

      const logs = await h.db.select().from(auditLogs);
      expect(JSON.parse(logs.find((l) => l.action === "tenant.signup")!.afterDigest!)).toMatchObject({ inviteCodeId: row.id });
    });

    it("期限切れ・失効済み・上限到達のコードは 400", async () => {
      const h = await harness("invite");
      const nowMin = Math.floor(FIXED_NOW.getTime() / 60_000);
      await issueCode(h.db, { expiresAt: nowMin - 1 }, "EXPI-REDD-CODE-2222");
      const revoked = await issueCode(h.db, {}, "REVO-KEDD-CODE-3333");
      await revokeSignupInviteCode(h.db, { id: revoked.row.id, revokedAt: nowMin });
      const used = await issueCode(h.db, { maxUses: 1 }, "USED-UPPP-CODE-4444");
      await h.db.update(signupInviteCodes).set({ usedCount: 1 }).where(eq(signupInviteCodes.id, used.row.id));

      for (const inviteCode of ["EXPI-REDD-CODE-2222", "REVO-KEDD-CODE-3333", "USED-UPPP-CODE-4444"]) {
        const res = await post(h.app, "/signup", signupBody({ inviteCode }));
        expect(res.status, inviteCode).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid_invite_code" });
      }
    });

    it("登録後に確認までの間にコードが失効すると、確認は 409 invite_code_unavailable でテナントは作られず pending は未消費のまま", async () => {
      const h = await harness("invite");
      const { row } = await issueCode(h.db);
      const token = await register(h, { inviteCode: "ABCD-EFGH-JKMN-PQRS" });
      await revokeSignupInviteCode(h.db, { id: row.id, revokedAt: Math.floor(FIXED_NOW.getTime() / 60_000) });

      const confirmed = await confirmSignup(h.app, token);
      expect(confirmed.status).toBe(409);
      expect(await confirmed.json()).toEqual({ error: "invite_code_unavailable" });
      expect(await h.db.select().from(tenants)).toHaveLength(0);
      const [pending] = await h.db.select().from(pendingSignups);
      expect(pending?.consumedAt).toBeNull();
    });

    it("同じコード(max_uses=1)を持つ2件の確認が同時に来ても、作られるテナントは1つだけ", async () => {
      const h = await harness("invite");
      const { row } = await issueCode(h.db, { maxUses: 1 });
      const a = await register(h, { email: "a@example.com", inviteCode: "ABCD-EFGH-JKMN-PQRS" });
      const b = await register(h, { email: "b@example.com", inviteCode: "ABCD-EFGH-JKMN-PQRS" });

      const results = await Promise.all([confirmSignup(h.app, a), confirmSignup(h.app, b)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await h.db.select().from(tenants)).toHaveLength(1);
      const [code] = await h.db.select().from(signupInviteCodes).where(eq(signupInviteCodes.id, row.id));
      expect(code?.usedCount).toBe(1);
    });

    it("invite モードでは、コード無しで受け付けた古い pending(open 時代)は確認できない", async () => {
      const db = await createTestDatabase();
      const open = await harness("open", { db });
      const token = await register(open);
      const invite = await harness("invite", { db });
      const confirmed = await confirmSignup(invite.app, token);
      expect(confirmed.status).toBe(409);
      expect(await db.select().from(tenants)).toHaveLength(0);
    });
  });

  describe("セキュリティ(乗っ取り・フィッシング・ログイン CSRF)", () => {
    it("乗っ取り: 攻撃者が被害者のメールで登録しても、パスワードは被害者が確認時に決める。攻撃者が送ったパスワードは無視され、ログインできない", async () => {
      const h = await harness("open");
      const attackerPassword = "attacker chosen password 1";
      // 攻撃者は登録時にパスワードを送ろうとするが、受け付ける欄が無く保存もされない
      const res = await post(h.app, "/signup", signupBody({ email: "victim@example.com", password: attackerPassword }));
      expect(res.status).toBe(202);
      const token = tokenFrom(h.mails[0]);
      expect(h.mails[0]?.to).toBe("victim@example.com");
      expect(JSON.stringify(await h.db.select().from(pendingSignups))).not.toContain(attackerPassword);

      // 被害者がリンクを踏んで、自分のパスワードを設定する
      const victimPassword = "victim chosen password 2";
      expect((await confirmSignup(h.app, token, { password: victimPassword })).status).toBe(200);

      const asAttacker = await post(h.app, "/auth/login", { email: "victim@example.com", password: attackerPassword });
      expect(asAttacker.status).toBe(401);
      const asVictim = await post(h.app, "/auth/login", { email: "victim@example.com", password: victimPassword });
      expect(asVictim.status).toBe(200);
    });

    it("確認でパスワードが無い・短い・不正な body は 400 で、トークンは消費されない(直したあとで確認できる)", async () => {
      const h = await harness("open");
      const token = await register(h);
      for (const body of [{}, { password: "short" }, { password: 123456789012 }, null]) {
        const res = await confirmSignup(h.app, token, body);
        expect(res.status).toBe(400);
      }
      expect(await h.db.select().from(tenants)).toHaveLength(0);
      expect((await confirmSignup(h.app, token, { password: "long enough password" })).status).toBe(200);
    });

    it("フィッシング: 確認メールの件名・本文にユーザー入力(組織名・氏名)は一切入らず、固定文面+確認 URL だけ", async () => {
      const h = await harness("open");
      await post(
        h.app,
        "/signup",
        signupBody({ organizationName: "Evil Corp https://evil.example/phish", adminName: "<b>click here</b> https://evil.example/x" }),
      );
      const mail = h.mails[0]!;
      for (const text of [mail.subject, mail.text]) {
        expect(text).not.toContain("Evil");
        expect(text).not.toContain("evil.example");
        expect(text).not.toContain("click here");
        expect(text).not.toContain("<b>");
      }
      // 本文に出る URL は確認 URL だけ
      expect(mail.text.match(/https?:\/\/\S+/g)).toEqual([expect.stringMatching(/^https:\/\/app\.example\.com\/signup\/verify\/[\w-]+$/)]);
      // 組織名は確認画面(GET)で見せる
      const preview = await h.app.request(`/signup/verify/${tokenFrom(mail)}`);
      expect(((await preview.json()) as { organizationName: string }).organizationName).toContain("Evil Corp");
    });

    it("ログイン CSRF: Origin が APP_BASE_URL と違う POST は 403(登録も確認も)。一致・Origin 無しは通る", async () => {
      const h = await harness("open");
      const evil = { origin: "https://evil.example" };
      const signupRes = await post(h.app, "/signup", signupBody(), evil);
      expect(signupRes.status).toBe(403);
      expect(await signupRes.json()).toEqual({ error: "forbidden_origin" });
      expect(h.mails).toHaveLength(0);

      const token = await register(h);
      expect((await confirmSignup(h.app, token, { password: PASSWORD }, evil)).status).toBe(403);
      expect((await confirmSignup(h.app, token, { password: PASSWORD }, { origin: "null" })).status).toBe(403);
      expect((await confirmSignup(h.app, token, { password: PASSWORD }, { origin: "https://app.example.com.evil.example" })).status).toBe(403);
      expect(await h.db.select().from(tenants)).toHaveLength(0);

      // 正しいオリジンなら通る(ブラウザの本来の経路)
      const ok = await confirmSignup(h.app, token, { password: PASSWORD }, { origin: "https://app.example.com" });
      expect(ok.status).toBe(200);
    });

    it("ログイン CSRF: Content-Type が JSON でない POST(フォームの自動送信など)は 415", async () => {
      const h = await harness("open");
      const token = await register(h);
      for (const contentType of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"]) {
        const res = await h.app.request(`/signup/verify/${token}`, {
          method: "POST",
          headers: { "content-type": contentType },
          body: `password=${PASSWORD}`,
        });
        expect(res.status, contentType).toBe(415);
      }
      const noType = await h.app.request("/signup", { method: "POST", body: JSON.stringify(signupBody()) });
      expect(noType.status).toBe(415);
      expect(await h.db.select().from(tenants)).toHaveLength(0);
    });

    it("再送スロットル: 大文字小文字だけ違うメールでも同じ宛先として抑止される(メールは出ず、既存の pending も1件のまま)", async () => {
      const h = await harness("open");
      await register(h, { email: "victim@example.com" });
      for (const variant of ["Victim@Example.com", "VICTIM@EXAMPLE.COM", "  victim@example.com  "]) {
        const res = await post(h.app, "/signup", signupBody({ email: variant }));
        expect(res.status).toBe(202);
      }
      expect(h.mails).toHaveLength(1);
      expect(await h.db.select().from(pendingSignups)).toHaveLength(1);
    });

    it("再送スロットル: 同じメールで同時に登録が来ても、pending は1件・メールは1通", async () => {
      const h = await harness("open");
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          post(h.app, "/signup", signupBody({ email: i % 2 === 0 ? "race@example.com" : "RACE@example.com" }), { "cf-connecting-ip": `203.0.113.${i + 1}` }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202, 202, 202]);
      expect(await h.db.select().from(pendingSignups)).toHaveLength(1);
      expect(h.mails).toHaveLength(1);
    });

    it("再送スロットル: 同じメールへの5分以内の再登録は 202 のまま何もしない(メールも出さず、最初のリンクも有効のまま)。5分後は再発行できる", async () => {
      const h = await harness("open");
      const first = await register(h);
      const again = await post(h.app, "/signup", signupBody({ organizationName: "妨害" }));
      expect(again.status).toBe(202);
      expect(await again.json()).toEqual({ status: "verification_sent" });
      expect(h.mails).toHaveLength(1);
      expect((await h.app.request(`/signup/verify/${first}`)).status).toBe(200);

      vi.setSystemTime(new Date(FIXED_NOW.getTime() + (SIGNUP_RESEND_THROTTLE_MINUTES + 1) * 60_000));
      const second = await register(h);
      expect(second).not.toBe(first);
      expect((await h.app.request(`/signup/verify/${first}`)).status).toBe(404);
    });
  });

  describe("レート制限", () => {
    it(`POST /signup は同一 IP で ${RATE_LIMITS.signupPerIp.max}回まで、次は 429。別 IP は影響を受けない`, async () => {
      const h = await harness("open");
      const ip = { "cf-connecting-ip": "203.0.113.1" };
      for (let i = 0; i < RATE_LIMITS.signupPerIp.max; i += 1) {
        expect((await post(h.app, "/signup", signupBody({ email: `u${i}@example.com` }), ip)).status).toBe(202);
      }
      const blocked = await post(h.app, "/signup", signupBody(), ip);
      expect(blocked.status).toBe(429);
      expect(((await blocked.json()) as { error: string }).error).toBe("rate_limited");
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

      expect((await post(h.app, "/signup", signupBody(), { "cf-connecting-ip": "203.0.113.2" })).status).toBe(202);
    });

    it("登録処理に到達する全経路(/signup と、node.ts と同じ二重マウントの /api/signup)が同じバケツで 429 になる。末尾スラッシュは登録処理に到達しない", async () => {
      const h = await harness("open");
      const root = new Hono();
      root.route("/api", h.app);
      root.route("/", h.app);
      const ip = { "cf-connecting-ip": "203.0.113.77" };
      const send = (path: string, email: string) =>
        root.request(path, {
          method: "POST",
          headers: { "content-type": "application/json", ...ip },
          body: JSON.stringify(signupBody({ email })),
        });

      // 末尾スラッシュ付きは Hono の厳密なパス照合で登録ハンドラに到達しない(認証ミドルウェアで
      // 401 になる)。到達しない = 登録もメールも起きず、レート制限の迂回路にもならない。
      for (const path of ["/signup/", "/api/signup/"]) {
        const res = await send(path, "slash@example.com");
        expect([401, 404], path).toContain(res.status);
      }
      expect(h.mails).toHaveLength(0);
      expect(await h.db.select().from(pendingSignups)).toHaveLength(0);

      // 到達する経路は /signup と /api/signup で、合わせて同じバケツを消費する
      const reachable = ["/signup", "/api/signup", "/signup", "/api/signup", "/signup"];
      expect(reachable).toHaveLength(RATE_LIMITS.signupPerIp.max);
      for (const [i, path] of reachable.entries()) {
        expect((await send(path, `u${i}@example.com`)).status, path).toBe(202);
      }
      for (const path of ["/signup", "/api/signup"]) {
        expect((await send(path, "extra@example.com")).status, path).toBe(429);
      }
      expect(h.mails).toHaveLength(RATE_LIMITS.signupPerIp.max);
    });

    it("確認リンクは招待・リセットと同じトークン経路の上限(20回/15分)で 429 になり、GET /signup/config は対象外", async () => {
      const h = await harness("open");
      const ip = { "cf-connecting-ip": "203.0.113.9" };
      for (let i = 0; i < RATE_LIMITS.tokenPerIp.max; i += 1) {
        expect((await h.app.request("/signup/verify/nonexistent", { headers: ip })).status).toBe(404);
      }
      expect((await h.app.request("/signup/verify/nonexistent", { headers: ip })).status).toBe(429);
      expect((await h.app.request("/signup/config", { headers: ip })).status).toBe(200);
    });
  });
});
