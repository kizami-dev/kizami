/**
 * 暗号文の文脈束縛(AAD)・用途別サブ鍵のテスト(apps/api/src/lib/encryption.ts)。
 * - 別テナントの行へ暗号文を移植しても復号できない(テナント Webhook URL)
 * - 封印 Cookie は Cookie 名に束ねられ、平文は受け付けない
 */

import { describe, expect, it } from "vitest";
import { upsertNotificationSettings } from "@kizami/db";
import { cookieContext, decryptSealed, decryptSecret, secretContext } from "../src/lib/encryption.js";
import { buildTenantChannels } from "../src/lib/notification-channels.js";
import { setupTestDb, testEncryptor } from "./support/setup.js";

const WEBHOOK = "https://hooks.example.com/tenant-a";

async function saveWebhook(db: Awaited<ReturnType<typeof setupTestDb>>["db"], tenantId: string, userId: string, stored: string) {
  await upsertNotificationSettings(db, {
    tenantId,
    webhookEnabled: true,
    webhookUrl: stored,
    smtpEnabled: false,
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    smtpFrom: null,
    smtpPassword: null,
    updatedAt: 0,
    updatedBy: userId,
  });
}

describe("暗号文の文脈束縛", () => {
  it("テナント A 用に暗号化した Webhook URL は、テナント B の行に置くと読めない(チャネルが作られない)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const encryptor = testEncryptor();

    // 正しい文脈(この行のテナント)で暗号化した値なら読める(対照)
    await saveWebhook(db, tenantId, userId, await encryptor.encrypt(WEBHOOK, secretContext.tenantWebhookUrl(tenantId)));
    expect(await buildTenantChannels(db, tenantId, { encryptor })).toHaveLength(1);

    // 別テナント宛の文脈で暗号化した値を、この行へ移植した状態
    await saveWebhook(db, tenantId, userId, await encryptor.encrypt(WEBHOOK, secretContext.tenantWebhookUrl("other-tenant")));
    expect(await buildTenantChannels(db, tenantId, { encryptor })).toHaveLength(0);
  });

  it("decryptSecret: 列が違えば(同じテナントでも)復号できない", async () => {
    const encryptor = testEncryptor();
    const stored = await encryptor.encrypt("pw", secretContext.tenantSmtpPassword("t1"));
    expect(await decryptSecret(encryptor, stored, secretContext.tenantSmtpPassword("t1"))).toBe("pw");
    expect(await decryptSecret(encryptor, stored, secretContext.tenantWebhookUrl("t1"))).toBeNull();
    expect(await decryptSecret(encryptor, stored, secretContext.tenantSmtpPassword("t2"))).toBeNull();
    // ユーザー単位の列は userId も束ねる
    const personal = await encryptor.encrypt("u", secretContext.userWebhookUrl("t1", "u1"));
    expect(await decryptSecret(encryptor, personal, secretContext.userWebhookUrl("t1", "u2"))).toBeNull();
  });

  it("decryptSealed: Cookie 名が違えば復号できず、平文は受け付けない", async () => {
    const encryptor = testEncryptor();
    const sealed = await encryptor.encrypt("{}", cookieContext("kizami_totp_tx"));
    expect(await decryptSealed(encryptor, sealed, cookieContext("kizami_totp_tx"))).toBe("{}");
    expect(await decryptSealed(encryptor, sealed, cookieContext("kizami_oidc_tx"))).toBeNull();
    expect(await decryptSealed(encryptor, "{}", cookieContext("kizami_totp_tx"))).toBeNull();
  });

  it("DB の秘密情報として暗号化した値は Cookie として開けない(用途をまたげない)", async () => {
    const encryptor = testEncryptor();
    const stored = await encryptor.encrypt("{}", secretContext.tenantWebhookUrl("t1"));
    expect(await decryptSealed(encryptor, stored, cookieContext("kizami_totp_tx"))).toBeNull();
  });
});
