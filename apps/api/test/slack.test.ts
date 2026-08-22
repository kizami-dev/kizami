/**
 * POST /slack/commands・GET/PUT /settings/slack・POST /settings/slack-link のテスト。
 * 実際のSlackへのリクエストは行わない(署名は自前で計算してcurl相当のリクエストを送る)。
 */

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { punchEvents, upsertTenantSlackSettings, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb, testEncryptor } from "./support/setup.js";

const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z"); // JST 2026-06-15 12:00

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

/** テスト用: WebCrypto HMAC-SHA256 で正しい "v0=..." 署名を計算する(実装とは独立に組み立てる)。 */
async function sign(signingSecret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`) as BufferSource,
  );
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v0=${hex}`;
}

interface SlackCommandParams {
  teamId: string;
  slackUserId: string;
  text: string;
}

function buildBody(params: SlackCommandParams): string {
  const usp = new URLSearchParams({
    token: "legacy-verification-token-unused",
    team_id: params.teamId,
    team_domain: "example",
    channel_id: "C000",
    channel_name: "general",
    user_id: params.slackUserId,
    user_name: "tester",
    command: "/punch",
    text: params.text,
    api_app_id: "A000",
    response_url: "https://hooks.slack.com/commands/1234",
    trigger_id: "1234.5678",
  });
  return usp.toString();
}

async function postSlackCommand(
  app: RequestLike,
  signingSecret: string,
  params: SlackCommandParams,
  overrides: { signatureOverride?: string; timestampOverride?: string; bodyOverride?: string } = {},
): Promise<{ status: number; body: { response_type?: string; text?: string; error?: string } }> {
  const body = overrides.bodyOverride ?? buildBody(params);
  const timestamp = overrides.timestampOverride ?? String(Math.floor(Date.now() / 1000));
  const signature = overrides.signatureOverride ?? (await sign(signingSecret, timestamp, body));

  const res = await app.request("/slack/commands", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    },
    body,
  });
  return { status: res.status, body: (await res.json()) as { response_type?: string; text?: string; error?: string } };
}

function extractToken(text: string): string {
  const match = /`([^`]+)`/.exec(text);
  if (!match) throw new Error(`no backtick-quoted token found in: ${text}`);
  return match[1] as string;
}

async function punchEventsFor(db: Database, tenantId: string, userId: string) {
  return db
    .select()
    .from(punchEvents)
    .where(and(eq(punchEvents.tenantId, tenantId), eq(punchEvents.userId, userId)));
}

describe("Slack slash command punching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET/PUT /settings/slack", () => {
    it("requires notification.settings.manage", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db, encryptor: testEncryptor() });
      const cookie = await loginAndGetCookie(app, email, password);

      expect((await app.request("/settings/slack", { headers: { cookie } })).status).toBe(403);
      expect(
        (
          await app.request("/settings/slack", {
            method: "PUT",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ enabled: false }),
          })
        ).status,
      ).toBe(403);
    });

    it("GET returns the default (unconfigured) shape", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
      const app = createApp({ db, encryptor: testEncryptor() });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/settings/slack", { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ teamId: null, enabled: false, signingSecretSet: false, updatedAt: null, updatedBy: null });
    });

    it("PUT rejects enabling without both teamId and signingSecret set", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
      const app = createApp({ db, encryptor: testEncryptor() });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/settings/slack", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ enabled: true, teamId: "T12345" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_slack_config");
    });

    it("PUT rejects a secret without an encryptor configured (503)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
      const app = createApp({ db }); // encryptor 未設定
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/settings/slack", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ enabled: false, signingSecret: "shhh" }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("encryption_unavailable");
    });

    it("PUT saves and masks the signing secret, GET reflects it afterwards", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
      const app = createApp({ db, encryptor: testEncryptor() });
      const cookie = await loginAndGetCookie(app, email, password);

      const putRes = await app.request("/settings/slack", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ enabled: true, teamId: "T12345", signingSecret: "shhh-secret" }),
      });
      expect(putRes.status).toBe(200);
      const putBody = (await putRes.json()) as Record<string, unknown>;
      expect(putBody).toEqual({ teamId: "T12345", enabled: true, signingSecretSet: true, updatedAt: expect.any(Number), updatedBy: userId });
      expect(JSON.stringify(putBody)).not.toContain("shhh-secret");

      const getRes = await app.request("/settings/slack", { headers: { cookie } });
      expect(await getRes.json()).toEqual({
        teamId: "T12345",
        enabled: true,
        signingSecretSet: true,
        updatedAt: expect.any(Number),
        updatedBy: userId,
      });
    });
  });

  describe("full flow: configure -> link -> punch", () => {
    const teamId = "T12345";
    const signingSecret = "shhh-secret";
    const slackUserId = "U0000001";

    async function setup() {
      const seeded = await setupTestDb();
      const { db, tenantId, userId } = seeded;
      await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
      const app = createApp({ db, encryptor: testEncryptor() });
      const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

      const putRes = await app.request("/settings/slack", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ enabled: true, teamId, signingSecret }),
      });
      expect(putRes.status).toBe(200);

      return { ...seeded, app, cookie };
    }

    it("/punch (no args) shows usage without requiring a link", async () => {
      const { app } = await setup();
      const { status, body } = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "" });
      expect(status).toBe(200);
      expect(body.response_type).toBe("ephemeral");
      expect(body.text).toContain("/punch in");
    });

    it("rejects a tampered body even if the signature header looks plausible", async () => {
      const { app } = await setup();
      const params = { teamId, slackUserId, text: "status" };
      const realBody = buildBody(params);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await sign(signingSecret, timestamp, realBody);

      const res = await app.request("/slack/commands", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-signature": signature,
          "x-slack-request-timestamp": timestamp,
        },
        body: `${realBody}&text=in`, // 署名計算後に改竄
      });
      expect(res.status).toBe(401);
    });

    it("rejects a request with a timestamp older than 5 minutes", async () => {
      const { app } = await setup();
      const params = { teamId, slackUserId, text: "status" };
      const body = buildBody(params);
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 5 * 60 - 30);
      const signature = await sign(signingSecret, oldTimestamp, body);

      const { status } = await postSlackCommand(app, signingSecret, params, {
        bodyOverride: body,
        timestampOverride: oldTimestamp,
        signatureOverride: signature,
      });
      expect(status).toBe(401);
    });

    it("always rejects when the tenant has no signing secret configured, even with a well-formed signature", async () => {
      const { app, db, tenantId, userId } = await setup();
      // enabled=true かつ signingSecret=null という、API経由では作れない不整合状態を直接DBに作る
      // (「Signing Secret未設定なら常に拒否」の防御が実行時ハンドラ自体にもあることを確かめる)。
      await upsertTenantSlackSettings(db, {
        tenantId,
        teamId: "T_NOSECRET",
        signingSecret: null,
        enabled: true,
        updatedAt: 0,
        updatedBy: userId,
      });

      const { status } = await postSlackCommand(app, "irrelevant-because-no-secret-stored", {
        teamId: "T_NOSECRET",
        slackUserId,
        text: "status",
      });
      expect(status).toBe(401);
    });

    it("/punch status and /punch in before linking prompts to run /punch link", async () => {
      const { app } = await setup();
      for (const text of ["status", "in"]) {
        const { status, body } = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text });
        expect(status).toBe(200);
        expect(body.text).toContain("/punch link");
      }
    });

    it("/punch link issues a one-time token that can be redeemed via POST /settings/slack-link", async () => {
      const { app, cookie, db, tenantId, userId } = await setup();

      const linkRes = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "link" });
      expect(linkRes.status).toBe(200);
      expect(linkRes.body.text).toContain("15分");
      const token = extractToken(linkRes.body.text ?? "");

      const redeemRes = await app.request("/settings/slack-link", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ token }),
      });
      expect(redeemRes.status).toBe(200);
      expect(await redeemRes.json()).toEqual({ linked: true, slackUserId });

      // 使用済みトークンは再利用できない
      const reuseRes = await app.request("/settings/slack-link", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ token }),
      });
      expect(reuseRes.status).toBe(400);
      expect((await reuseRes.json()).error).toBe("invalid_or_expired_token");

      // 連携後は /punch status が動く(unlinked案内が出ない)
      const statusRes = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "status" });
      expect(statusRes.body.text).toContain("勤務外");
      expect(statusRes.body.text).not.toContain("/punch link");

      void tenantId;
      void userId;
      void db;
    });

    it("expired link tokens cannot be redeemed", async () => {
      const { app, cookie } = await setup();

      const linkRes = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "link" });
      const token = extractToken(linkRes.body.text ?? "");

      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 16 * 60_000)); // 16分後(15分の有効期限切れ)

      const redeemRes = await app.request("/settings/slack-link", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ token }),
      });
      expect(redeemRes.status).toBe(400);
      expect((await redeemRes.json()).error).toBe("invalid_or_expired_token");
    });

    async function linkedApp() {
      const seeded = await setup();
      const linkRes = await postSlackCommand(seeded.app, signingSecret, { teamId, slackUserId, text: "link" });
      const token = extractToken(linkRes.body.text ?? "");
      const redeemRes = await seeded.app.request("/settings/slack-link", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: seeded.cookie },
        body: JSON.stringify({ token }),
      });
      expect(redeemRes.status).toBe(200);
      return seeded;
    }

    it("drives clock_in -> break_start -> break_end -> clock_out through Slack, recording source=slack and ephemeral responses", async () => {
      const { app, db, tenantId, userId } = await linkedApp();

      const inRes = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "in" });
      expect(inRes.status).toBe(200);
      expect(inRes.body.response_type).toBe("ephemeral");
      expect(inRes.body.text).toContain("出勤");

      const breakRes = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "break" });
      expect(breakRes.body.text).toContain("休憩開始");

      const backRes = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "back" });
      expect(backRes.body.text).toContain("休憩終了");

      const outRes = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "out" });
      expect(outRes.body.text).toContain("退勤");

      const events = await punchEventsFor(db, tenantId, userId);
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.kind)).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
      for (const e of events) {
        expect(e.source).toBe("slack");
        expect(e.actorId).toBe(userId);
      }
    });

    it("rejects an invalid transition (clock_out while not working) before touching the DB, with a reason", async () => {
      const { app, db, tenantId, userId } = await linkedApp();

      const res = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "out" });
      expect(res.status).toBe(200);
      expect(res.body.text).toContain("退勤できません");

      expect(await punchEventsFor(db, tenantId, userId)).toHaveLength(0);
    });

    it("rejects a duplicate clock_in with a reason and does not double-punch", async () => {
      const { app, db, tenantId, userId } = await linkedApp();

      expect((await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "in" })).status).toBe(200);
      const second = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "in" });
      expect(second.body.text).toContain("既に出勤中");

      expect(await punchEventsFor(db, tenantId, userId)).toHaveLength(1);
    });

    it("rejects punching into a closed month with an ephemeral message instead of a raw 409", async () => {
      const { app, db, tenantId, userId, cookie } = await linkedApp();
      await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });

      const closeRes = await app.request("/closings/2026-06/close", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      });
      expect(closeRes.status).toBe(200);

      const res = await postSlackCommand(app, signingSecret, { teamId, slackUserId, text: "in" });
      expect(res.status).toBe(200);
      expect(res.body.text).toContain("締め");

      expect(await punchEventsFor(db, tenantId, userId)).toHaveLength(0);
    });
  });
});
