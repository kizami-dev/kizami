/**
 * アプリ側の SSRF 対策(lib/outbound-guard.ts)の、保存時の検査と通知経路への配線のテスト。
 * 接続のたびの検査(DNS rebinding 対策)の本体は outbound-guard.test.ts。
 *
 * ここでは createApp の `notify.outbound`(保存時のチェッカー)と `notify.tenantFetchImpl`
 * (テナントが設定した送り先に使う fetch)を、実際のガード(名前解決だけ偽のリゾルバ)で配線して確認する。
 */

import { describe, expect, it, vi } from "vitest";
import { upsertNotificationSettings } from "@kizami/db";
import { createApp } from "../src/app.js";
import { clearOidcCaches, discover, OidcError } from "../src/lib/oidc.js";
import { createOutboundGuard } from "../src/lib/outbound-guard.js";
import { createOutboundPolicy } from "../src/lib/outbound-policy.js";
import { grantPermission, loginAndGetCookie, setupTestDb, testEncryptor } from "./support/setup.js";

/** "internal.example" だけが 10.0.0.5(プライベート)に解決される偽のリゾルバ。 */
function guardForTests() {
  return createOutboundGuard(createOutboundPolicy({ blockPrivate: true }), {
    resolve: async (host) => [{ address: host === "internal.example" ? "10.0.0.5" : "93.184.216.34", family: 4 as const }],
  });
}

async function setup(options: { withGuard: boolean; vapid?: boolean; fetchImpl?: typeof fetch; tenantFetchImpl?: typeof fetch }) {
  const seeded = await setupTestDb();
  await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "notification.settings.manage", scope: "tenant" });
  await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "tenant_settings.auth.manage", scope: "tenant" });
  const guard = options.withGuard ? guardForTests() : null;
  const app = createApp({
    db: seeded.db,
    encryptor: testEncryptor(),
    ...(options.vapid ? { vapid: { publicKey: "x", privateKey: "y", subject: "mailto:ops@example.com" } } : {}),
    notify: {
      ...(guard ? { outbound: guard } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.tenantFetchImpl ? { tenantFetchImpl: options.tenantFetchImpl } : {}),
    },
  });
  const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
  return { seeded, app, cookie };
}

function send(app: ReturnType<typeof createApp>, cookie: string, method: string, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }),
  );
}

const DISABLED = { webhookEnabled: false, smtpEnabled: false };

describe("PUT /settings/notifications(テナントの Webhook・SMTP)", () => {
  it("ガード有効: プライベート・メタデータ・ループバック・内部名の Webhook URL は 400 outbound_destination_blocked", async () => {
    const { app, cookie } = await setup({ withGuard: true });
    for (const webhookUrl of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:8080/hook",
      "http://[::1]/hook",
      "https://localhost/hook",
      "https://internal.example/hook",
    ]) {
      const res = await send(app, cookie, "PUT", "/settings/notifications", { ...DISABLED, webhookUrl });
      expect(res.status, webhookUrl).toBe(400);
      expect(await res.json()).toEqual({ error: "outbound_destination_blocked", field: "webhookUrl" });
    }
  });

  it("ガード有効: 公開の Webhook URL は保存できる", async () => {
    const { app, cookie } = await setup({ withGuard: true });
    const res = await send(app, cookie, "PUT", "/settings/notifications", { ...DISABLED, webhookUrl: "https://hooks.slack.com/services/T/B/x" });
    expect(res.status).toBe(200);
  });

  it("ガード有効: SMTP ホストがプライベートなら 400(IP リテラル・内部に解決される名前)", async () => {
    const { app, cookie } = await setup({ withGuard: true });
    for (const smtpHost of ["192.168.0.10", "internal.example", "localhost"]) {
      const res = await send(app, cookie, "PUT", "/settings/notifications", {
        ...DISABLED,
        smtpHost,
        smtpPort: 587,
        smtpFrom: "kizami@example.com",
      });
      expect(res.status, smtpHost).toBe(400);
      expect(await res.json()).toEqual({ error: "outbound_destination_blocked", field: "smtpHost" });
    }
    const ok = await send(app, cookie, "PUT", "/settings/notifications", { ...DISABLED, smtpHost: "smtp.example.com", smtpPort: 587, smtpFrom: "kizami@example.com" });
    expect(ok.status).toBe(200);
  });

  it("ガード無効(既定): プライベートな宛先でも従来どおり保存できる(社内 LAN の SMTP・Webhook を使うセルフホスト)", async () => {
    const { app, cookie } = await setup({ withGuard: false });
    const res = await send(app, cookie, "PUT", "/settings/notifications", {
      webhookEnabled: true,
      webhookUrl: "http://10.0.0.5:8080/hook",
      smtpEnabled: true,
      smtpHost: "192.168.0.10",
      smtpPort: 25,
      smtpFrom: "kizami@corp.example",
    });
    expect(res.status).toBe(200);
  });

  it("テスト送信: テナントの Webhook には tenantFetchImpl を使い、fetchImpl は使わない", async () => {
    const viaTenant = vi.fn(async () => new Response(null, { status: 200 }));
    const viaPlain = vi.fn(async () => new Response(null, { status: 200 }));
    const { seeded, app, cookie } = await setup({
      withGuard: false,
      tenantFetchImpl: viaTenant as unknown as typeof fetch,
      fetchImpl: viaPlain as unknown as typeof fetch,
    });
    const put = await send(app, cookie, "PUT", "/settings/notifications", {
      webhookEnabled: true,
      webhookUrl: "https://hooks.example.com/x",
      smtpEnabled: false,
    });
    expect(put.status).toBe(200);

    const res = await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(viaTenant).toHaveBeenCalledTimes(1);
    expect(viaPlain).not.toHaveBeenCalled();
    expect(seeded.tenantId).toBeTruthy();
  });

  it("テナントの設定が保存済みで、後から有効になったガードが接続を拒否する場合、テスト送信は失敗として返る(保存時の検査だけに頼らない)", async () => {
    const guard = guardForTests();
    const seeded = await setupTestDb();
    await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "notification.settings.manage", scope: "tenant" });
    const encryptor = testEncryptor();
    // ガード無効の時代に保存された内部向けの Webhook(DB へ直接入れる)
    await upsertNotificationSettings(seeded.db, {
      tenantId: seeded.tenantId,
      webhookEnabled: true,
      webhookUrl: await encryptor.encrypt("http://internal.example/hook"),
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpFrom: null,
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: seeded.userId,
    });
    const app = createApp({ db: seeded.db, encryptor, notify: { outbound: guard, tenantFetchImpl: guard.fetch } });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    const res = await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ channel: string; ok: boolean; error?: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.ok).toBe(false);
    expect(body.results[0]?.error).toMatch(/not allowed/);
  });
});

describe("PUT /settings/notifications/me(個人の Webhook)", () => {
  it("ガード有効: プライベートな URL は 400、公開 URL は保存できる。無効なら従来どおり", async () => {
    const guarded = await setup({ withGuard: true });
    const blocked = await send(guarded.app, guarded.cookie, "PUT", "/settings/notifications/me", { categories: {}, webhookUrl: "http://169.254.169.254/" });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "outbound_destination_blocked", field: "webhookUrl" });
    const ok = await send(guarded.app, guarded.cookie, "PUT", "/settings/notifications/me", { categories: {}, webhookUrl: "https://hooks.example.com/me" });
    expect(ok.status).toBe(200);

    const open = await setup({ withGuard: false });
    const lan = await send(open.app, open.cookie, "PUT", "/settings/notifications/me", { categories: {}, webhookUrl: "http://10.0.0.5/me" });
    expect(lan.status).toBe(200);
  });
});

describe("PUT /settings/sso(OIDC の issuer)", () => {
  it("ガード有効: プライベートな issuer は 400、公開の issuer は保存できる", async () => {
    const { app, cookie } = await setup({ withGuard: true });
    const body = { enabled: false, clientId: "c", clientSecret: "s" };
    const blocked = await send(app, cookie, "PUT", "/settings/sso", { ...body, issuer: "https://internal.example/realms/x" });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "outbound_destination_blocked", field: "issuer" });
    const literal = await send(app, cookie, "PUT", "/settings/sso", { ...body, issuer: "https://10.1.2.3/realms/x" });
    expect(literal.status).toBe(400);
    const ok = await send(app, cookie, "PUT", "/settings/sso", { ...body, issuer: "https://login.example.com/realms/x" });
    expect(ok.status).toBe(200);
  });

  it("OIDC の discovery は、ガードの fetch を渡すとプライベートな宛先へ接続せず sso_discovery_failed になる", async () => {
    clearOidcCaches();
    const guard = guardForTests();
    const err = await discover("https://internal.example/realms/x", { fetchImpl: guard.fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect((err as OidcError).code).toBe("sso_discovery_failed");
  });
});

describe("POST /push/subscriptions(購読の endpoint)", () => {
  async function subscription(endpoint: string) {
    // 長さだけ合っていれば保存時の検証は通る(送信しないテストなので本物の鍵は不要)
    const b64 = (n: number) => btoa(String.fromCharCode(...new Uint8Array(n).fill(1))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    return { endpoint, keys: { p256dh: b64(65), auth: b64(16) } };
  }

  it("ガード有効: プライベートな endpoint は 400、公開のプッシュサービスは保存できる", async () => {
    const { app, cookie } = await setup({ withGuard: true, vapid: true });
    const blocked = await send(app, cookie, "POST", "/push/subscriptions", { subscription: await subscription("http://169.254.169.254/push") });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "outbound_destination_blocked", field: "endpoint" });
    const ok = await send(app, cookie, "POST", "/push/subscriptions", { subscription: await subscription("https://fcm.googleapis.com/fcm/send/abc") });
    expect(ok.status).toBe(200);
  });

  it("ガード無効(既定)ならそのまま保存できる", async () => {
    const { app, cookie } = await setup({ withGuard: false, vapid: true });
    const res = await send(app, cookie, "POST", "/push/subscriptions", { subscription: await subscription("http://10.0.0.5/push") });
    expect(res.status).toBe(200);
  });
});
