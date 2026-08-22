/**
 * buildPersonalChannels / buildTenantChannels(apps/api/src/lib/notification-channels.ts)の
 * テスト。今回の修正の核心 — docs/requirements.md §7「通知の宛先の原則」:
 * 本人宛の通知はテナント共有 Webhook に絶対に送らない — を重点的に確認する。
 */

import { describe, expect, it } from "vitest";
import { getUserNotificationSettings, upsertNotificationSettings, upsertUserNotificationSettings } from "@kizami/db";
import type { SmtpChannelConfig, SmtpSendFn } from "@kizami/notify";
import { dispatch } from "@kizami/notify";
import { buildPersonalChannels, buildTenantChannels } from "../src/lib/notification-channels.js";
import { runReminderScan } from "../src/reminders.js";
import { jstMinutes, setupSecondUser, setupTestDb, testEncryptor } from "./support/setup.js";
import { insertPunchEvent } from "@kizami/db";

const TENANT_WEBHOOK_URL = "https://tenant-shared.example/webhook";
const PERSONAL_WEBHOOK_URL_1 = "https://personal-1.example/webhook";
const PERSONAL_WEBHOOK_URL_2 = "https://personal-2.example/webhook";

function recordingFetch(hits: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    hits.push(typeof input === "string" ? input : input.toString());
    return new Response(null, { status: 200 });
  }) as typeof fetch;
}

function recordingSmtp(calls: { to: string; config: SmtpChannelConfig }[]): SmtpSendFn {
  return async (config, msg) => {
    calls.push({ to: msg.to.email ?? "", config });
  };
}

describe("buildPersonalChannels — 本人宛のチャネルはテナント共有 Webhook を使わない", () => {
  it("personal webhook is used, the tenant shared webhook is never hit", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // テナントの共有 Webhook を有効化(管理者が設定した接続情報)。
    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: TENANT_WEBHOOK_URL,
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpFrom: null,
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: userId,
    });

    // 本人が個人 Webhook を設定して打刻忘れ通知を有効化する。
    await upsertUserNotificationSettings(db, {
      tenantId,
      userId,
      missingClockOutEmail: false,
      missingClockOutWebhook: true,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      emailAddress: null,
      webhookUrl: PERSONAL_WEBHOOK_URL_1,
      updatedAt: 0,
    });

    const hits: string[] = [];
    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { fetchImpl: recordingFetch(hits) },
    );
    expect(channels).toHaveLength(1);
    await dispatch(channels, { to: { email: "unused@example.com" }, title: "t", body: "b" });

    expect(hits).toEqual([PERSONAL_WEBHOOK_URL_1]);
    expect(hits).not.toContain(TENANT_WEBHOOK_URL);
  });

  it("two users with different personal webhooks never see each other's channel (isolation)", async () => {
    const { db, tenantId, userId: user1 } = await setupTestDb();
    const { userId: user2 } = await setupSecondUser(db, tenantId);

    await upsertUserNotificationSettings(db, {
      tenantId,
      userId: user1,
      missingClockOutEmail: false,
      missingClockOutWebhook: true,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      emailAddress: null,
      webhookUrl: PERSONAL_WEBHOOK_URL_1,
      updatedAt: 0,
    });
    await upsertUserNotificationSettings(db, {
      tenantId,
      userId: user2,
      missingClockOutEmail: false,
      missingClockOutWebhook: true,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      emailAddress: null,
      webhookUrl: PERSONAL_WEBHOOK_URL_2,
      updatedAt: 0,
    });

    const hits1: string[] = [];
    const channels1 = await buildPersonalChannels(
      db,
      { tenantId, userId: user1, notificationType: "missing_clock_out" },
      { fetchImpl: recordingFetch(hits1) },
    );
    await dispatch(channels1, { to: { email: "x" }, title: "t", body: "b" });
    expect(hits1).toEqual([PERSONAL_WEBHOOK_URL_1]);

    const hits2: string[] = [];
    const channels2 = await buildPersonalChannels(
      db,
      { tenantId, userId: user2, notificationType: "missing_clock_out" },
      { fetchImpl: recordingFetch(hits2) },
    );
    await dispatch(channels2, { to: { email: "x" }, title: "t", body: "b" });
    expect(hits2).toEqual([PERSONAL_WEBHOOK_URL_2]);
  });

  it("email channel uses tenant SMTP connection info but the individually-resolved personal recipient address", async () => {
    const { db, tenantId, userId, email: accountEmail } = await setupTestDb();

    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: false,
      webhookUrl: null,
      smtpEnabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "kizami@example.com",
      smtpFrom: "kizami@example.com",
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: userId,
    });

    await upsertUserNotificationSettings(db, {
      tenantId,
      userId,
      missingClockOutEmail: true,
      missingClockOutWebhook: false,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      emailAddress: "personal-inbox@example.com", // アカウントのメールとは別の宛先を指定
      webhookUrl: null,
      updatedAt: 0,
    });

    const calls: { to: string; config: SmtpChannelConfig }[] = [];
    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { smtpSendFn: recordingSmtp(calls) },
    );
    expect(channels).toHaveLength(1);
    // 呼び出し元が渡す to.email (アカウントの email) は無視され、個人設定の宛先で上書きされる。
    await dispatch(channels, { to: { email: accountEmail }, title: "t", body: "b" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe("personal-inbox@example.com");
    expect(calls[0]?.to).not.toBe(accountEmail);
    expect(calls[0]?.config.host).toBe("smtp.example.com");
  });

  it("no personal settings row => no external channels at all (in-app only, default OFF)", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: TENANT_WEBHOOK_URL,
      smtpEnabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: null,
      smtpFrom: "kizami@example.com",
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: userId,
    });

    const row = await getUserNotificationSettings(db, { tenantId, userId });
    expect(row).toBeNull();

    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { fetchImpl: recordingFetch([]), smtpSendFn: recordingSmtp([]) },
    );
    expect(channels).toHaveLength(0);
  });

  it("overtime_* and leave_* types resolve to their category prefs (category bundling)", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await upsertUserNotificationSettings(db, {
      tenantId,
      userId,
      missingClockOutEmail: false,
      missingClockOutWebhook: false,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: true,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      emailAddress: null,
      webhookUrl: PERSONAL_WEBHOOK_URL_1,
      updatedAt: 0,
    });

    const overtimeChannels = await buildPersonalChannels(db, {
      tenantId,
      userId,
      notificationType: "overtime_special_annual",
    });
    expect(overtimeChannels).toHaveLength(1);

    const otherOvertimeChannels = await buildPersonalChannels(db, {
      tenantId,
      userId,
      notificationType: "overtime_45h_reached",
    });
    expect(otherOvertimeChannels).toHaveLength(1);

    // leave_* はカテゴリが違うので有効化していない = チャネル無し
    const leaveChannels = await buildPersonalChannels(db, {
      tenantId,
      userId,
      notificationType: "leave_expiring_7d",
    });
    expect(leaveChannels).toHaveLength(0);
  });

  it("buildTenantChannels still returns the tenant shared webhook (used for admin-facing test sends only)", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: TENANT_WEBHOOK_URL,
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpFrom: null,
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: userId,
    });

    const hits: string[] = [];
    const channels = await buildTenantChannels(db, tenantId, { fetchImpl: recordingFetch(hits) });
    expect(channels).toHaveLength(1);
    await dispatch(channels, { to: { email: "x" }, title: "t", body: "b" });
    expect(hits).toEqual([TENANT_WEBHOOK_URL]);
  });

  it("webhookUrl is stored encrypted (enc:v1: prefix) and decrypts back to the original value", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const encryptor = testEncryptor();
    const encrypted = await encryptor.encrypt(PERSONAL_WEBHOOK_URL_1);

    await upsertUserNotificationSettings(db, {
      tenantId,
      userId,
      missingClockOutEmail: false,
      missingClockOutWebhook: true,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      emailAddress: null,
      webhookUrl: encrypted,
      updatedAt: 0,
    });

    const stored = await getUserNotificationSettings(db, { tenantId, userId });
    expect(stored?.webhookUrl?.startsWith("enc:v1:")).toBe(true);
    expect(stored?.webhookUrl).not.toContain("personal-1.example");
    await expect(encryptor.decrypt(stored!.webhookUrl!)).resolves.toBe(PERSONAL_WEBHOOK_URL_1);

    // 復号できて初めてチャネルが組み立てられる(鍵を渡した場合)。
    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { encryptor },
    );
    expect(channels).toHaveLength(1);

    // 鍵を渡さない場合は復号できず、チャネルは組み立てられない(平文フォールバックしない)。
    const channelsWithoutKey = await buildPersonalChannels(db, {
      tenantId,
      userId,
      notificationType: "missing_clock_out",
    });
    expect(channelsWithoutKey).toHaveLength(0);
  });
});

describe("runReminderScan — end-to-end regression: the tenant shared webhook never receives a personal notification", () => {
  it("wires resolveChannels through buildPersonalChannels the same way worker.ts does", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: TENANT_WEBHOOK_URL,
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpFrom: null,
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: userId,
    });
    await upsertUserNotificationSettings(db, {
      tenantId,
      userId,
      missingClockOutEmail: false,
      missingClockOutWebhook: true,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      emailAddress: null,
      webhookUrl: PERSONAL_WEBHOOK_URL_1,
      updatedAt: 0,
    });

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: clockInAt,
      recordedAt: clockInAt,
      source: "web",
      actorId: userId,
    });

    const hits: string[] = [];
    const fetchImpl = recordingFetch(hits);
    const nowMinutes = jstMinutes(2026, 4, 15, 12, 0);
    const result = await runReminderScan(db, {
      nowMinutes,
      resolveChannels: (tId, uId, type) => buildPersonalChannels(db, { tenantId: tId, userId: uId, notificationType: type }, { fetchImpl }),
    });

    expect(result.created).toHaveLength(1);
    expect(hits).toEqual([PERSONAL_WEBHOOK_URL_1]);
    expect(hits).not.toContain(TENANT_WEBHOOK_URL);
  });
});
