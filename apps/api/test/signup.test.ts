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
import { createApp } from "../src/app.js";
import { RATE_LIMITS } from "../src/lib/rate-limit.js";
import { hashSignupInviteCode } from "../src/lib/signup-invite-code.js";
import type { SystemMail } from "../src/lib/system-mail.js";
import type { SignupDeps } from "../src/routes/signup.js";
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
    password: PASSWORD,
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

      // pending にはハッシュだけ(平文のパスワード・トークンは保存されない)
      const [pending] = await h.db.select().from(pendingSignups);
      expect(pending?.passwordHash.startsWith("pbkdf2-sha256$")).toBe(true);
      expect(pending?.tokenHash).not.toBe(token);

      const preview = await h.app.request(`/signup/verify/${token}`);
      expect(preview.status).toBe(200);
      expect(await preview.json()).toEqual({
        organizationName: "株式会社サンプル",
        adminName: "山田 太郎",
        email: "owner@example.com",
      });

      const confirm = await post(h.app, `/signup/verify/${token}`);
      expect(confirm.status).toBe(200);
      const body = (await confirm.json()) as { user: { id: string; email: string; displayName: string } };
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
      const cookie = extractCookie(confirm);
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

    it("入力検証: 不正なメール・短いパスワード・空の組織名/氏名は 400(メールも送らない)", async () => {
      const h = await harness("open");
      const cases: [Record<string, unknown>, string][] = [
        [{ email: "not-an-email" }, "invalid_email"],
        [{ email: undefined }, "invalid_email"],
        [{ password: "short" }, "invalid_password"],
        [{ organizationName: "  " }, "invalid_organization_name"],
        [{ adminName: "" }, "invalid_name"],
      ];
      for (const [override, error] of cases) {
        const res = await post(h.app, "/signup", signupBody(override));
        expect(res.status, error).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe(error);
      }
      expect((await h.app.request("/signup", { method: "POST", body: "not json", headers: { "cf-connecting-ip": "203.0.113.50" } })).status).toBe(400);
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
      const confirm = await post(h.app, `/signup/verify/${tokenFrom(h.mails[1])}`);
      expect(confirm.status).toBe(200);
      expect(await h.db.select().from(tenants)).toHaveLength(2);
    });

    it("同一メールで再登録すると新しいトークンに置き換わり、古いリンクは無効になる", async () => {
      const h = await harness("open");
      const first = await register(h);
      const second = await register(h, { organizationName: "改め株式会社" });
      expect(second).not.toBe(first);
      expect(await h.db.select().from(pendingSignups)).toHaveLength(1);

      expect((await h.app.request(`/signup/verify/${first}`)).status).toBe(404);
      const confirm = await post(h.app, `/signup/verify/${second}`);
      expect(confirm.status).toBe(200);
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

  describe("確認リンク(トークン経路)", () => {
    it("存在しないトークンは GET / POST とも 404", async () => {
      const h = await harness("open");
      expect((await h.app.request("/signup/verify/nonexistent")).status).toBe(404);
      expect((await post(h.app, "/signup/verify/nonexistent")).status).toBe(404);
    });

    it("期限切れ(24時間超)は 410。テナントは作られない", async () => {
      const h = await harness("open");
      const token = await register(h);
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 25 * HOUR_MS));

      const get = await h.app.request(`/signup/verify/${token}`);
      expect(get.status).toBe(410);
      expect(await get.json()).toEqual({ error: "expired" });
      expect((await post(h.app, `/signup/verify/${token}`)).status).toBe(410);
      expect(await h.db.select().from(tenants)).toHaveLength(0);
    });

    it("24時間以内ならまだ確認できる", async () => {
      const h = await harness("open");
      const token = await register(h);
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 23 * HOUR_MS));
      expect((await post(h.app, `/signup/verify/${token}`)).status).toBe(200);
    });

    it("二重使用: 2回目は 404(消費済みは不存在と区別しない)。テナントは1つだけ", async () => {
      const h = await harness("open");
      const token = await register(h);
      expect((await post(h.app, `/signup/verify/${token}`)).status).toBe(200);
      expect((await post(h.app, `/signup/verify/${token}`)).status).toBe(404);
      expect((await h.app.request(`/signup/verify/${token}`)).status).toBe(404);
      expect(await h.db.select().from(tenants)).toHaveLength(1);
    });

    it("同じトークンの確認が同時に来ても、テナントが作られるのは1つだけ", async () => {
      const h = await harness("open");
      const token = await register(h);
      const results = await Promise.all([post(h.app, `/signup/verify/${token}`), post(h.app, `/signup/verify/${token}`)]);
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

      expect((await post(h.app, `/signup/verify/${token}`)).status).toBe(200);
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

      const confirm = await post(h.app, `/signup/verify/${token}`);
      expect(confirm.status).toBe(409);
      expect(await confirm.json()).toEqual({ error: "invite_code_unavailable" });
      expect(await h.db.select().from(tenants)).toHaveLength(0);
      const [pending] = await h.db.select().from(pendingSignups);
      expect(pending?.consumedAt).toBeNull();
    });

    it("同じコード(max_uses=1)を持つ2件の確認が同時に来ても、作られるテナントは1つだけ", async () => {
      const h = await harness("invite");
      const { row } = await issueCode(h.db, { maxUses: 1 });
      const a = await register(h, { email: "a@example.com", inviteCode: "ABCD-EFGH-JKMN-PQRS" });
      const b = await register(h, { email: "b@example.com", inviteCode: "ABCD-EFGH-JKMN-PQRS" });

      const results = await Promise.all([post(h.app, `/signup/verify/${a}`), post(h.app, `/signup/verify/${b}`)]);
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
      const confirm = await post(invite.app, `/signup/verify/${token}`);
      expect(confirm.status).toBe(409);
      expect(await db.select().from(tenants)).toHaveLength(0);
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
