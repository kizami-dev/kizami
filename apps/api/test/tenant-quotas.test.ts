/**
 * テナントごとの利用上限(lib/tenant-quotas.ts、docs/design/tenant-quotas.md)のテスト。
 *
 * 重点: 各上限の境界(上限ちょうどまでは通り、次から断る)/ 未設定(無制限)なら素通し /
 * **打刻は上限の影響を受けない**(全部の上限が 0 でも打刻できる)/ テナントごとに独立 /
 * 通知の上限は管理者へ1日1回だけ知らせる / `/metrics` の上限到達回数。
 */

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { notifications, type Database } from "@kizami/db";
import { dispatch } from "@kizami/notify";
import { createApp } from "../src/app.js";
import { buildPersonalChannels, buildTenantChannels } from "../src/lib/notification-channels.js";
import { createTenantQuotas, NotificationQuotaExceededError, parseQuotaEnv, PERSONAL_TEST_SENDS_PER_DAY } from "../src/lib/tenant-quotas.js";
import { createTestDatabase, grantPermission, loginAndGetCookie, setupExtraUser, setupTestDb, testEncryptor } from "./support/setup.js";

const NOW = Date.UTC(2026, 5, 15, 3, 0) / 60_000;

function json(app: ReturnType<typeof createApp>, cookie: string, method: string, path: string, body?: unknown) {
  return Promise.resolve(
    app.request(path, { method, headers: { "content-type": "application/json", cookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  );
}

describe("parseQuotaEnv", () => {
  it("未設定・空は無制限(キーを持たない)", () => {
    expect(parseQuotaEnv({})).toEqual({ limits: {}, errors: [] });
    expect(parseQuotaEnv({ QUOTA_MAX_MEMBERS: "", QUOTA_MAX_API_KEYS: "  " })).toEqual({ limits: {}, errors: [] });
  });

  it("0 以上の整数を読む(0 は「全部断る」)", () => {
    expect(
      parseQuotaEnv({
        QUOTA_MAX_MEMBERS: "50",
        QUOTA_MAX_API_KEYS: "20",
        QUOTA_OUTBOUND_NOTIFICATIONS_PER_DAY: "2000",
        QUOTA_INVITE_RESET_MAILS_PER_DAY: "0",
      }),
    ).toEqual({ limits: { members: 50, apiKeys: 20, outboundNotificationsPerDay: 2000, inviteResetMailsPerDay: 0 }, errors: [] });
  });

  it("不正な値は errors に入れる(起動時に落とす)", () => {
    const { limits, errors } = parseQuotaEnv({ QUOTA_MAX_MEMBERS: "-1", QUOTA_MAX_API_KEYS: "ten", QUOTA_OUTBOUND_NOTIFICATIONS_PER_DAY: "1.5" });
    expect(limits).toEqual({});
    expect(errors).toHaveLength(3);
  });
});

describe("メンバー数の上限(招待中を含む在籍者)", () => {
  async function setup(limit: number | undefined) {
    const seeded = await setupTestDb();
    await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "member.deactivate", scope: "tenant" });
    const quotas = createTenantQuotas(limit === undefined ? {} : { members: limit }, { nowMinutes: () => NOW });
    const app = createApp({ db: seeded.db, quotas, metricsToken: "tok" });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    return { seeded, app, cookie };
  }
  const invite = (app: ReturnType<typeof createApp>, cookie: string, n: number) =>
    json(app, cookie, "POST", "/members", { email: `m${n}@example.com`, name: `M${n}` });

  it("上限ちょうどまで招待でき、次の招待は 409 member_limit_reached(招待中も席を占める)", async () => {
    // 管理者1人 + 上限 3 → あと 2 人
    const { app, cookie } = await setup(3);
    expect((await invite(app, cookie, 1)).status).toBe(201);
    expect((await invite(app, cookie, 2)).status).toBe(201);
    const blocked = await invite(app, cookie, 3);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "member_limit_reached", limit: 3 });
  });

  it("退職処理で席が空けば再び招待できる。再有効化も上限に掛かる", async () => {
    const { app, cookie } = await setup(2);
    const first = (await (await invite(app, cookie, 1)).json()) as { member: { id: string } };
    expect((await invite(app, cookie, 2)).status).toBe(409);

    expect((await json(app, cookie, "POST", `/members/${first.member.id}/deactivate`, {})).status).toBe(200);
    expect((await invite(app, cookie, 2)).status).toBe(201);
    // 席が埋まったので、退職者の再有効化は断られる
    const reactivate = await json(app, cookie, "POST", `/members/${first.member.id}/reactivate`, {});
    expect(reactivate.status).toBe(409);
    expect(await reactivate.json()).toEqual({ error: "member_limit_reached", limit: 2 });
  });

  it("未設定(無制限)なら何人でも招待できる", async () => {
    const { app, cookie } = await setup(undefined);
    for (let i = 1; i <= 5; i += 1) expect((await invite(app, cookie, i)).status).toBe(201);
  });

  it("他のテナントの在籍者は数えない", async () => {
    const { seeded, app, cookie } = await setup(2);
    await setupTestDb(seeded.db);
    expect((await invite(app, cookie, 1)).status).toBe(201);
  });

  it("上限に達した回数が /metrics に全体の累計として出る", async () => {
    const { app, cookie } = await setup(1);
    expect((await invite(app, cookie, 1)).status).toBe(409);
    expect((await invite(app, cookie, 2)).status).toBe(409);
    const res = await app.request("/metrics", { headers: { authorization: "Bearer tok" } });
    const body = await res.text();
    expect(body).toContain('kizami_quota_limit_hits_total{limit="members"} 2');
    expect(body).toContain('kizami_quota_limit_hits_total{limit="api_keys"} 0');
  });
});

describe("API キー数の上限", () => {
  it("有効なキーが上限ちょうどまで発行でき、次は 409。失効すれば空く。既存のキーでの打刻は止まらない", async () => {
    const seeded = await setupTestDb();
    await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "api_key.manage", scope: "tenant" });
    const app = createApp({ db: seeded.db, quotas: createTenantQuotas({ apiKeys: 2 }) });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const issue = () => json(app, cookie, "POST", "/api-keys", { name: "k", scopes: ["punch"] });

    const a = (await (await issue()).json()) as { apiKey: { id: string; token: string } };
    expect((await issue()).status).toBe(201);
    const blocked = await issue();
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "api_key_limit_reached", limit: 2 });

    // 上限に達していても、既存のキーでの打刻は通る(打刻は止めない)
    const punch = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${a.apiKey.token}` },
      body: JSON.stringify({ kind: "clock_in", occurredAt: Math.floor(Date.now() / 60_000) - 5 }),
    });
    expect(punch.status).toBe(201);

    expect((await json(app, cookie, "DELETE", `/api-keys/${a.apiKey.id}`)).status).toBe(200);
    expect((await issue()).status).toBe(201);
  });
});

describe("打刻は上限の影響を受けない", () => {
  it("すべての上限が 0 でも、Web からの打刻ができる", async () => {
    const { db, email, password } = await setupTestDb();
    const quotas = createTenantQuotas({ members: 0, apiKeys: 0, outboundNotificationsPerDay: 0, inviteResetMailsPerDay: 0 });
    const app = createApp({ db, quotas });
    const cookie = await loginAndGetCookie(app, email, password);
    const res = await json(app, cookie, "POST", "/punches", { kind: "clock_in", occurredAt: Math.floor(Date.now() / 60_000) - 5 });
    expect(res.status).toBe(201);
  });
});

describe("外向きの通知の1日の上限", () => {
  async function setupChannels(limit: number | undefined) {
    const seeded = await setupTestDb();
    const encryptor = testEncryptor();
    const { upsertNotificationSettings } = await import("@kizami/db");
    await upsertNotificationSettings(seeded.db, {
      tenantId: seeded.tenantId,
      webhookEnabled: true,
      webhookUrl: await encryptor.encrypt("https://hooks.example.com/x"),
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpFrom: null,
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: seeded.userId,
    });
    await grantPermission(seeded.db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "notification.settings.manage", scope: "tenant" });
    let minutes = NOW;
    const quotas = createTenantQuotas(limit === undefined ? {} : { outboundNotificationsPerDay: limit }, { nowMinutes: () => minutes });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const build = () => buildTenantChannels(seeded.db, seeded.tenantId, { encryptor, fetchImpl: fetchImpl as unknown as typeof fetch, quotas });
    const send = async () => {
      const results = await dispatch(await build(), { to: {}, title: "t", body: "b" });
      return results[0] as { ok: boolean; error?: unknown };
    };
    return { seeded, fetchImpl, send, advance: (m: number) => (minutes += m) };
  }

  it("上限ちょうどまで送り、次から送らない(失敗として返り、fetch は呼ばれない)", async () => {
    const { fetchImpl, send } = await setupChannels(2);
    expect((await send()).ok).toBe(true);
    expect((await send()).ok).toBe(true);
    const third = await send();
    expect(third.ok).toBe(false);
    expect(third.error).toBeInstanceOf(NotificationQuotaExceededError);
    expect((third.error as Error).message).toBe("notification_limit_reached");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("日本時間の 0 時を越えると数え直す", async () => {
    const { send, advance } = await setupChannels(1);
    expect((await send()).ok).toBe(true);
    expect((await send()).ok).toBe(false);
    advance(24 * 60);
    expect((await send()).ok).toBe(true);
  });

  it("未設定(無制限)なら素通し", async () => {
    const { send } = await setupChannels(undefined);
    for (let i = 0; i < 10; i += 1) expect((await send()).ok).toBe(true);
  });

  it("上限に達したら管理者にアプリ内で知らせる。何度断っても同じ日は1通だけ", async () => {
    const { seeded, send } = await setupChannels(1);
    await send();
    for (let i = 0; i < 4; i += 1) await send();
    const rows = await seeded.db.select().from(notifications).where(eq(notifications.tenantId, seeded.tenantId));
    const notices = rows.filter((r) => r.type === "quota_notification_limit");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.userId).toBe(seeded.userId);
    expect(notices[0]?.subjectDate).toBe("2026-06-15");
  });

  it("アプリ内通知の作成そのものは上限の影響を受けない(上限 0 でもテナントの通知は作れる)", async () => {
    const { seeded, send } = await setupChannels(0);
    await send();
    const { createNotificationIfAbsent } = await import("@kizami/db");
    const created = await createNotificationIfAbsent(seeded.db, {
      tenantId: seeded.tenantId,
      userId: seeded.userId,
      type: "missing_clock_out",
      subjectDate: "2026-06-14",
      title: "t",
      body: "b",
      createdAt: NOW,
    });
    expect(created).not.toBeNull();
  });

  it("本人宛のメール・個人 Webhook も数え、ブラウザプッシュは数えない", async () => {
    const { seeded } = await setupChannels(1);
    const { upsertUserNotificationSettings, upsertNotificationSettings } = await import("@kizami/db");
    const encryptor = testEncryptor();
    await upsertNotificationSettings(seeded.db, {
      tenantId: seeded.tenantId,
      webhookEnabled: false,
      webhookUrl: null,
      smtpEnabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: null,
      smtpFrom: "k@example.com",
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: seeded.userId,
    });
    await upsertUserNotificationSettings(seeded.db, {
      tenantId: seeded.tenantId,
      userId: seeded.userId,
      missingClockOutEmail: true,
      missingClockOutWebhook: true,
      missingClockOutPush: false,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      overtimeAlertPush: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      leaveAlertPush: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      correctionAlertPush: false,
      approvalRequestEmail: false,
      approvalRequestWebhook: false,
      approvalRequestPush: false,
      shiftVarianceEmail: false,
      shiftVarianceWebhook: false,
      shiftVariancePush: false,
      emailAddress: null,
      webhookUrl: await encryptor.encrypt("https://hooks.example.com/me"),
      updatedAt: 0,
    });
    const quotas = createTenantQuotas({ outboundNotificationsPerDay: 1 }, { nowMinutes: () => NOW });
    const smtpSendFn = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const channels = await buildPersonalChannels(
      seeded.db,
      { tenantId: seeded.tenantId, userId: seeded.userId, notificationType: "missing_clock_out" },
      { encryptor, smtpSendFn, fetchImpl: fetchImpl as unknown as typeof fetch, quotas },
    );
    const results = await dispatch(channels, { to: {}, title: "t", body: "b" });
    // メールと Webhook の2つで上限 1 → 片方だけ成功
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("POST /settings/notifications/test も数えられ、上限に達したら失敗として返る", async () => {
    const { seeded } = await setupChannels(undefined);
    const quotas = createTenantQuotas({ outboundNotificationsPerDay: 1 });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const app = createApp({ db: seeded.db, encryptor: testEncryptor(), quotas, notify: { fetchImpl: fetchImpl as unknown as typeof fetch } });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const run = async () => ((await (await app.request("/settings/notifications/test", { method: "POST", headers: { cookie } })).json()) as { results: Array<{ ok: boolean; error?: string }> }).results[0];
    expect((await run())?.ok).toBe(true);
    const second = await run();
    expect(second?.ok).toBe(false);
    expect(second?.error).toBe("notification_limit_reached");
  });
});

describe("招待・パスワード再設定リンクの1日の上限(管理者の操作だけが使う枠)", () => {
  it("未認証の本人用再設定を繰り返しても枠は減らず、管理者の招待・再設定リンクは発行できる", async () => {
    const db: Database = await createTestDatabase();
    const seeded = await setupTestDb(db);
    await grantPermission(db, { tenantId: seeded.tenantId, userId: seeded.userId, permission: "member.invite", scope: "tenant" });
    const other = await setupExtraUser(db, { tenantId: seeded.tenantId, email: "other-member@example.com", name: "T" });
    const mails: string[] = [];
    const background: Array<() => Promise<void>> = [];
    const app = createApp({
      db,
      selfServiceReset: {
        appBaseUrl: "https://app.example.com",
        sendMail: async (mail) => {
          mails.push(mail.to);
        },
        runInBackground: (task) => {
          background.push(task);
        },
      },
      quotas: createTenantQuotas({ inviteResetMailsPerDay: 1 }, { nowMinutes: () => NOW }),
      metricsToken: "tok",
    });
    const forgot = async (email: string, n: number) => {
      const res = await app.request("/password-resets", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${n}` },
        body: JSON.stringify({ email }),
      });
      while (background.length > 0) await background.shift()!();
      return res.status;
    };

    // 未認証の第三者が繰り返す(別メール・別 IP でスロットルを避ける)。枠は 1 しか無いが、どれもメールが届く
    expect(await forgot(seeded.email, 1)).toBe(202);
    expect(await forgot(other.email, 2)).toBe(202);
    expect(mails).toHaveLength(2);

    // それでも管理者の招待の発行には枠が残っている(1 回目は通り、2 回目から断る)
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const first = await json(app, cookie, "POST", "/members", { email: "new1@example.com", name: "N1" });
    expect(first.status).toBe(201);
    const second = await json(app, cookie, "POST", "/members", { email: "new2@example.com", name: "N2" });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "invite_reset_limit_reached" });

    const metrics = await (await app.request("/metrics", { headers: { authorization: "Bearer tok" } })).text();
    expect(metrics).toContain('kizami_quota_limit_hits_total{limit="invite_reset_mails"} 1');
  });
});

describe("一般メンバーの操作がテナントの枠を使い切れない", () => {
  it("個人 Webhook のテスト送信を繰り返しても、本人ごとの上限で止まり、業務通知(テナントの枠)は送れる", async () => {
    const seeded = await setupTestDb();
    const encryptor = testEncryptor();
    const { upsertNotificationSettings } = await import("@kizami/db");
    await upsertNotificationSettings(seeded.db, {
      tenantId: seeded.tenantId,
      webhookEnabled: true,
      webhookUrl: await encryptor.encrypt("https://hooks.example.com/tenant"),
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpFrom: null,
      smtpPassword: null,
      updatedAt: 0,
      updatedBy: seeded.userId,
    });
    const quotas = createTenantQuotas({ outboundNotificationsPerDay: 3 }, { nowMinutes: () => NOW });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const app = createApp({ db: seeded.db, encryptor, quotas, notify: { fetchImpl: fetchImpl as unknown as typeof fetch } });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const put = await json(app, cookie, "PUT", "/settings/notifications/me", { categories: {}, webhookUrl: "https://hooks.example.com/me" });
    expect(put.status).toBe(200);

    const results: boolean[] = [];
    for (let i = 0; i < PERSONAL_TEST_SENDS_PER_DAY + 5; i += 1) {
      const res = await json(app, cookie, "POST", "/settings/notifications/me/test");
      results.push(((await res.json()) as { result: { ok: boolean } }).result.ok);
    }
    expect(results.filter(Boolean)).toHaveLength(PERSONAL_TEST_SENDS_PER_DAY);
    expect(fetchImpl).toHaveBeenCalledTimes(PERSONAL_TEST_SENDS_PER_DAY);

    // テナントの枠(3 件)は 1 件も減っていない: システムが送る業務通知は上限まで送れる
    const build = () => buildTenantChannels(seeded.db, seeded.tenantId, { encryptor, fetchImpl: fetchImpl as unknown as typeof fetch, quotas });
    for (let i = 0; i < 3; i += 1) {
      const [r] = await dispatch(await build(), { to: {}, title: "t", body: "b" });
      expect(r?.ok).toBe(true);
    }
    const [over] = await dispatch(await build(), { to: {}, title: "t", body: "b" });
    expect(over?.ok).toBe(false);
  });
});
