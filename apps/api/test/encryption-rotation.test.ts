/**
 * 鍵のローテーション(KIZAMI_ENCRYPTION_KEYS_PREVIOUS)と再暗号化 CLI の中身
 * (apps/api/src/lib/encryption.ts の buildEncryptorFromEnv / lib/reencrypt-secrets.ts)。
 */

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tenantNotificationSettings,
  tenantOidcSettings,
  tenantSlackSettings,
  userNotificationSettings,
  userTotp,
  type Database,
} from "@kizami/db";
import { createEncryptor, type InspectableEncryptor } from "@kizami/crypto";
import { buildEncryptorFromEnv, cookieContext, decryptSealed, decryptSecret, secretContext } from "../src/lib/encryption.js";
import { reencryptSecrets } from "../src/lib/reencrypt-secrets.js";
import { createTestDatabase } from "./support/setup.js";
import { seedTenant } from "./support/seed.js";

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** v1(マスター鍵直接・AAD なし)の値を作る。 */
async function v1(keyBase64: string, plain: string): Promise<string> {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return `enc:v1:${b64(iv)}:${b64(ct)}`;
}

afterEach(() => vi.restoreAllMocks());

describe("buildEncryptorFromEnv(旧鍵)", () => {
  it("旧鍵で暗号化した値を読め、書き込みは現行鍵になる", async () => {
    const oldKey = randomKey();
    const newKey = randomKey();
    const stored = await createEncryptor(oldKey).encrypt("hook", secretContext.tenantWebhookUrl("t1"));
    const enc = buildEncryptorFromEnv({ KIZAMI_ENCRYPTION_KEY: newKey, KIZAMI_ENCRYPTION_KEYS_PREVIOUS: ` ${oldKey} ,` });
    expect(enc).not.toBeNull();
    expect(await decryptSecret(enc, stored, secretContext.tenantWebhookUrl("t1"))).toBe("hook");
    const fresh = await enc!.encrypt("hook", secretContext.tenantWebhookUrl("t1"));
    expect(await createEncryptor(newKey).decrypt(fresh, secretContext.tenantWebhookUrl("t1"))).toBe("hook");
  });

  it("封印 Cookie(信頼済み端末など)も旧鍵で発行したものを読める", async () => {
    const oldKey = randomKey();
    const sealed = await createEncryptor(oldKey).encrypt("{}", cookieContext("kizami_trusted_device"));
    const enc = buildEncryptorFromEnv({ KIZAMI_ENCRYPTION_KEY: randomKey(), KIZAMI_ENCRYPTION_KEYS_PREVIOUS: oldKey })!;
    expect(await decryptSealed(enc, sealed, cookieContext("kizami_trusted_device"))).toBe("{}");
  });

  it("不正な旧鍵は位置つきの警告で除外し、現行鍵と他の旧鍵は生きる(鍵の値はログに出さない)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const goodOld = randomKey();
    const bad = "definitely-not-a-key";
    const stored = await createEncryptor(goodOld).encrypt("x", secretContext.tenantSmtpPassword("t1"));
    const enc = buildEncryptorFromEnv({ KIZAMI_ENCRYPTION_KEY: randomKey(), KIZAMI_ENCRYPTION_KEYS_PREVIOUS: `${bad},${goodOld}` });
    expect(enc).not.toBeNull();
    expect(await enc!.decrypt(stored, secretContext.tenantSmtpPassword("t1"))).toBe("x");
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("#1");
    expect(logged).not.toContain(bad);
    expect(logged).not.toContain(goodOld);
  });

  it("現行鍵が無ければ旧鍵があっても null", () => {
    expect(buildEncryptorFromEnv({ KIZAMI_ENCRYPTION_KEYS_PREVIOUS: randomKey() })).toBeNull();
  });
});

describe("reencryptSecrets", () => {
  const OLD = randomKey();
  const CURRENT = randomKey();
  const oldEnc = createEncryptor(OLD);
  const current = (): InspectableEncryptor => createEncryptor(CURRENT, { previous: [OLD] });

  /** テナント 2 つ(各ユーザー 1 人)を持つ DB。 */
  async function seed() {
    const db = await createTestDatabase();
    const a = await seedTenant(db);
    const b = await seedTenant(db);
    return { db, a, b };
  }

  async function putTenantRows(
    db: Database,
    t: { tenantId: string; userId: string },
    v: { webhook: string; smtp: string; slack: string; oidc: string },
  ) {
    await db.insert(tenantNotificationSettings).values({ tenantId: t.tenantId, webhookUrl: v.webhook, smtpPassword: v.smtp, updatedAt: 0, updatedBy: t.userId });
    await db.insert(tenantSlackSettings).values({ tenantId: t.tenantId, signingSecret: v.slack, updatedAt: 0, updatedBy: t.userId });
    await db.insert(tenantOidcSettings).values({ tenantId: t.tenantId, clientSecret: v.oidc, updatedAt: 0, updatedBy: t.userId });
  }

  async function snapshot(db: Database) {
    return JSON.stringify([
      await db.select().from(tenantNotificationSettings),
      await db.select().from(tenantSlackSettings),
      await db.select().from(tenantOidcSettings),
      await db.select().from(userNotificationSettings),
      await db.select().from(userTotp),
    ]);
  }

  it("dry-run は何も書かず、件数だけ数える", async () => {
    const { db, a, b } = await seed();
    await putTenantRows(db, a, {
      webhook: "https://plain.example.com",
      smtp: await v1(OLD, "pw"),
      slack: "plain-slack",
      oidc: await oldEnc.encrypt("o", secretContext.oidcClientSecret(a.tenantId)),
    });
    await db.insert(userTotp).values({ userId: b.userId, tenantId: b.tenantId, secretEncrypted: "JBSWY3DP", createdAt: 0 });
    const before = await snapshot(db);

    const report = await reencryptSecrets(db, current(), { apply: false });
    expect(await snapshot(db)).toBe(before);
    expect(report["tenant_notification_settings.webhook_url"]).toMatchObject({ total: 1, rewrite: 1, rewritten: 0, ok: 0 });
    expect(report["user_totp.secret_encrypted"]).toMatchObject({ rewrite: 1, rewritten: 0 });
  });

  it("--apply: 平文・v1・旧鍵の v2 を現行鍵の v2 にし、アプリが行ごとの文脈で読める", async () => {
    const { db, a, b } = await seed();
    await putTenantRows(db, a, {
      webhook: "https://plain.example.com/a",
      smtp: await v1(OLD, "smtp-a"),
      slack: await oldEnc.encrypt("slack-a", secretContext.slackSigningSecret(a.tenantId)),
      oidc: await oldEnc.encrypt("oidc-a", secretContext.oidcClientSecret(a.tenantId)),
    });
    await putTenantRows(db, b, {
      webhook: await oldEnc.encrypt("https://hook.example.com/b", secretContext.tenantWebhookUrl(b.tenantId)),
      smtp: "smtp-b",
      slack: "slack-b",
      oidc: await v1(OLD, "oidc-b"),
    });
    await db.insert(userTotp).values({
      userId: a.userId,
      tenantId: a.tenantId,
      secretEncrypted: await oldEnc.encrypt("TOTPA", secretContext.totpSecret(a.tenantId, a.userId)),
      createdAt: 0,
    });
    await db.insert(userNotificationSettings).values({ tenantId: b.tenantId, userId: b.userId, webhookUrl: await v1(OLD, "https://me.example.com"), updatedAt: 0 });

    const enc = current();
    const report = await reencryptSecrets(db, enc, { apply: true });
    for (const c of Object.values(report)) expect(c).toMatchObject({ unreadable: 0, conflict: 0, rewritten: c.rewrite, ok: 0 });

    // 現行鍵だけ(旧鍵なし)の Encryptor で、各行自身の文脈で読めて、v2 になっている
    const only = createEncryptor(CURRENT);
    const [na] = await db.select().from(tenantNotificationSettings).where(eq(tenantNotificationSettings.tenantId, a.tenantId));
    const [nb] = await db.select().from(tenantNotificationSettings).where(eq(tenantNotificationSettings.tenantId, b.tenantId));
    expect(na!.webhookUrl!.startsWith("enc:v2:")).toBe(true);
    expect(await only.decrypt(na!.webhookUrl!, secretContext.tenantWebhookUrl(a.tenantId))).toBe("https://plain.example.com/a");
    expect(await only.decrypt(na!.smtpPassword!, secretContext.tenantSmtpPassword(a.tenantId))).toBe("smtp-a");
    expect(await only.decrypt(nb!.webhookUrl!, secretContext.tenantWebhookUrl(b.tenantId))).toBe("https://hook.example.com/b");
    expect(await only.decrypt(nb!.smtpPassword!, secretContext.tenantSmtpPassword(b.tenantId))).toBe("smtp-b");
    // 別テナントの文脈では読めない(文脈が行ごとに正しく付いている)
    expect(await only.decrypt(na!.webhookUrl!, secretContext.tenantWebhookUrl(b.tenantId))).toBeNull();

    const [sa] = await db.select().from(tenantSlackSettings).where(eq(tenantSlackSettings.tenantId, a.tenantId));
    const [sb] = await db.select().from(tenantSlackSettings).where(eq(tenantSlackSettings.tenantId, b.tenantId));
    expect(await only.decrypt(sa!.signingSecret!, secretContext.slackSigningSecret(a.tenantId))).toBe("slack-a");
    expect(await only.decrypt(sb!.signingSecret!, secretContext.slackSigningSecret(b.tenantId))).toBe("slack-b");

    const [oa] = await db.select().from(tenantOidcSettings).where(eq(tenantOidcSettings.tenantId, a.tenantId));
    const [ob] = await db.select().from(tenantOidcSettings).where(eq(tenantOidcSettings.tenantId, b.tenantId));
    expect(await only.decrypt(oa!.clientSecret!, secretContext.oidcClientSecret(a.tenantId))).toBe("oidc-a");
    expect(await only.decrypt(ob!.clientSecret!, secretContext.oidcClientSecret(b.tenantId))).toBe("oidc-b");

    const [t] = await db.select().from(userTotp);
    expect(await only.decrypt(t!.secretEncrypted, secretContext.totpSecret(a.tenantId, a.userId))).toBe("TOTPA");
    const [u] = await db.select().from(userNotificationSettings);
    expect(await only.decrypt(u!.webhookUrl!, secretContext.userWebhookUrl(b.tenantId, b.userId))).toBe("https://me.example.com");

    // 2 回目は何も残らない(冪等)
    const second = await reencryptSecrets(db, enc, { apply: true });
    for (const c of Object.values(second)) expect(c).toMatchObject({ rewrite: 0, rewritten: 0, unreadable: 0 });
  });

  it("すでに現行鍵の v2 の値には触らない(暗号文がそのまま)", async () => {
    const { db, a } = await seed();
    const webhook = await createEncryptor(CURRENT).encrypt("https://h.example.com", secretContext.tenantWebhookUrl(a.tenantId));
    await db.insert(tenantNotificationSettings).values({ tenantId: a.tenantId, webhookUrl: webhook, updatedAt: 0, updatedBy: a.userId });
    const report = await reencryptSecrets(db, current(), { apply: true });
    expect(report["tenant_notification_settings.webhook_url"]).toMatchObject({ total: 1, ok: 1, rewrite: 0, rewritten: 0 });
    const [row] = await db.select().from(tenantNotificationSettings);
    expect(row!.webhookUrl).toBe(webhook);
  });

  it("どの鍵でも読めない値と、文脈が合わない値は unreadable として触らない。NULL は数えない", async () => {
    const { db, a, b } = await seed();
    const foreign = await createEncryptor(randomKey()).encrypt("x", secretContext.tenantWebhookUrl(a.tenantId));
    // b の行に a 宛の文脈で暗号化した値を置いた状態(移植)
    const transplanted = await createEncryptor(CURRENT).encrypt("y", secretContext.tenantWebhookUrl(a.tenantId));
    await db.insert(tenantNotificationSettings).values({ tenantId: a.tenantId, webhookUrl: foreign, smtpPassword: null, updatedAt: 0, updatedBy: a.userId });
    await db.insert(tenantNotificationSettings).values({ tenantId: b.tenantId, webhookUrl: transplanted, updatedAt: 0, updatedBy: b.userId });
    const before = await snapshot(db);

    const report = await reencryptSecrets(db, current(), { apply: true });
    expect(report["tenant_notification_settings.webhook_url"]).toMatchObject({ total: 2, unreadable: 2, rewrite: 0, rewritten: 0 });
    expect(report["tenant_notification_settings.smtp_password"]).toMatchObject({ total: 0 });
    expect(await snapshot(db)).toBe(before);
  });

  it("compare-and-set: 読んだ後に値が変わった行は上書きせず conflict に数える", async () => {
    const { db, a } = await seed();
    await db.insert(tenantNotificationSettings).values({ tenantId: a.tenantId, webhookUrl: "https://plain.example.com", updatedAt: 0, updatedBy: a.userId });
    const enc = current();
    // 走査中に管理画面から保存し直された状況を、復号の直後に割り込んで再現する
    const racing: InspectableEncryptor = {
      encrypt: (plain, ctx) => enc.encrypt(plain, ctx),
      decrypt: (stored, ctx) => enc.decrypt(stored, ctx),
      decryptWithInfo: async (stored, ctx) => {
        const info = await enc.decryptWithInfo(stored, ctx);
        await db.update(tenantNotificationSettings).set({ webhookUrl: "https://edited.example.com" });
        return info;
      },
    };
    const report = await reencryptSecrets(db, racing, { apply: true });
    expect(report["tenant_notification_settings.webhook_url"]).toMatchObject({ rewrite: 1, rewritten: 0, conflict: 1 });
    const [row] = await db.select().from(tenantNotificationSettings);
    expect(row!.webhookUrl).toBe("https://edited.example.com");
  });
});
