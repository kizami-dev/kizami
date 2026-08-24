/**
 * GET/PUT /settings/sso(OIDC 設定)のテスト。docs/design/sso-oidc.md が仕様の正。
 *
 * 重点:
 * - 権限 `tenant_settings.auth.manage`(tenant スコープ)でのガード
 * - client_secret は GET で平文が漏れない(clientSecretSet の boolean のみ)
 * - DB には暗号化("enc:v1:...")して保存され、復号すると元の値に戻る
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, getTenantOidcSettings } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb, testEncryptor } from "./support/setup.js";

const SSO_PERMISSION = "tenant_settings.auth.manage";
const ISSUER = "https://login.microsoftonline.com/tenant-guid/v2.0";

async function setup(options: { withPermission?: boolean; withEncryptor?: boolean } = {}) {
  const seeded = await setupTestDb();
  if (options.withPermission ?? true) {
    await grantPermission(seeded.db, {
      tenantId: seeded.tenantId,
      userId: seeded.userId,
      permission: SSO_PERMISSION,
      scope: "tenant",
    });
  }
  const app = createApp({
    db: seeded.db,
    ...((options.withEncryptor ?? true) ? { encryptor: testEncryptor() } : { encryptor: null }),
  });
  const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
  return { seeded, app, cookie };
}

function put(app: ReturnType<typeof createApp>, cookie: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request("/settings/sso", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );
}

describe("GET/PUT /settings/sso", () => {
  it("権限が無ければ 403(GET・PUT とも)", async () => {
    const { app, cookie } = await setup({ withPermission: false });

    const get = await app.request("/settings/sso", { headers: { cookie } });
    expect(get.status).toBe(403);

    const res = await put(app, cookie, { enabled: false });
    expect(res.status).toBe(403);
  });

  it("未設定のテナントでは既定値を返す", async () => {
    const { app, cookie } = await setup();
    const res = await app.request("/settings/sso", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: null,
      clientId: null,
      enabled: false,
      allowUnverifiedEmail: false,
      clientSecretSet: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("client_secret は暗号化して保存され、GET では平文を返さない", async () => {
    const { seeded, app, cookie } = await setup();

    const res = await put(app, cookie, {
      enabled: true,
      issuer: ISSUER,
      clientId: "client-abc",
      clientSecret: "super-secret-value",
      allowUnverifiedEmail: false,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.clientSecretSet).toBe(true);
    expect(JSON.stringify(body)).not.toContain("super-secret-value");

    // DB には "enc:v1:..." で入り、復号すると元に戻る(往復)
    const stored = await getTenantOidcSettings(seeded.db, seeded.tenantId);
    expect(stored?.clientSecret?.startsWith("enc:v1:")).toBe(true);
    expect(await testEncryptor().decrypt(stored?.clientSecret ?? "")).toBe("super-secret-value");

    const get = await app.request("/settings/sso", { headers: { cookie } });
    const getBody = (await get.json()) as Record<string, unknown>;
    expect(getBody).toMatchObject({ issuer: ISSUER, clientId: "client-abc", enabled: true, clientSecretSet: true });
    expect(JSON.stringify(getBody)).not.toContain("super-secret-value");
  });

  it("clientSecret を省略した PUT は既存値を維持する(空文字ならクリア)", async () => {
    const { seeded, app, cookie } = await setup();
    await put(app, cookie, { enabled: true, issuer: ISSUER, clientId: "client-abc", clientSecret: "s1" });

    // 省略 = 維持
    const keep = await put(app, cookie, { enabled: true, clientId: "client-xyz" });
    expect(keep.status).toBe(200);
    expect(await testEncryptor().decrypt((await getTenantOidcSettings(seeded.db, seeded.tenantId))?.clientSecret ?? "")).toBe("s1");

    // 空文字 = クリア。ただし enabled のままではクリアできない(壊れた設定を作らせない)
    const clearWhileEnabled = await put(app, cookie, { enabled: true, clientSecret: "" });
    expect(clearWhileEnabled.status).toBe(400);
    expect(await clearWhileEnabled.json()).toEqual({ error: "invalid_sso_config" });

    const cleared = await put(app, cookie, { enabled: false, clientSecret: "" });
    expect(cleared.status).toBe(200);
    expect((await cleared.json() as { clientSecretSet: boolean }).clientSecretSet).toBe(false);
  });

  it("issuer は https の URL のみ受け付ける", async () => {
    const { app, cookie } = await setup();

    for (const bad of ["http://idp.example.com", "not a url", "https://idp.example.com/?a=b"]) {
      const res = await put(app, cookie, { enabled: false, issuer: bad });
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_issuer" });
    }

    const ok = await put(app, cookie, { enabled: false, issuer: ISSUER });
    expect(ok.status).toBe(200);
  });

  it("設定が揃っていないのに有効化しようとすると 400", async () => {
    const { app, cookie } = await setup();
    const res = await put(app, cookie, { enabled: true, issuer: ISSUER });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_sso_config" });
  });

  it("暗号鍵が無い環境で新しい clientSecret を保存しようとすると 503(平文で保存しない)", async () => {
    const { app, cookie } = await setup({ withEncryptor: false });

    const res = await put(app, cookie, { enabled: false, issuer: ISSUER, clientId: "c", clientSecret: "s" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "encryption_unavailable" });

    // 秘密情報を含まない更新は鍵が無くても通る
    const ok = await put(app, cookie, { enabled: false, issuer: ISSUER });
    expect(ok.status).toBe(200);
  });

  it("allowUnverifiedEmail は既定 false で、明示的に切り替えられる", async () => {
    const { app, cookie } = await setup();
    const created = await put(app, cookie, { enabled: false, issuer: ISSUER, clientId: "c", clientSecret: "s" });
    expect((await created.json() as { allowUnverifiedEmail: boolean }).allowUnverifiedEmail).toBe(false);

    const toggled = await put(app, cookie, { enabled: false, allowUnverifiedEmail: true });
    expect((await toggled.json() as { allowUnverifiedEmail: boolean }).allowUnverifiedEmail).toBe(true);

    // 省略した場合は維持される
    const kept = await put(app, cookie, { enabled: false });
    expect((await kept.json() as { allowUnverifiedEmail: boolean }).allowUnverifiedEmail).toBe(true);
  });

  it("更新は監査ログに残る(シークレットそのものは残さない)", async () => {
    const { seeded, app, cookie } = await setup();
    await put(app, cookie, { enabled: true, issuer: ISSUER, clientId: "client-abc", clientSecret: "super-secret-value" });

    const logs = await seeded.db.select().from(auditLogs).where(eq(auditLogs.action, "oidc_settings.update"));
    expect(logs).toHaveLength(1);
    const detail = logs[0]?.afterDigest ?? "";
    expect(detail).not.toContain("super-secret-value");
    expect(JSON.parse(detail)).toMatchObject({ issuer: ISSUER, clientId: "client-abc", enabled: true, clientSecretChanged: true });
  });
});
