/**
 * Workers でのメール(docs/design/workers-d1.md「メール」)を **workerd** で通す。
 *
 * - テナントの SMTP: 配備するのと同じ `cloudflare:sockets` の接続(src/lib/workers-smtp-socket.ts)で、Node 側の
 *   偽の SMTP サーバー(test/workers/support/fake-smtp-server.ts、平文・認証なし)へ本物の TCP で送る。
 *   管理者のテスト送信(POST /settings/notifications/test)と、Cron の打刻忘れの本人宛メールの2経路
 * - ポート 25 は Workers が塞いでいるので、接続の前に分かりやすいエラーで断る
 * - システムメール: miniflare がローカルでシミュレートする Email Service の `send_email` バインディング
 *   (`EMAIL`)で、Cron の退会の再通知を送る。バインディングの呼び出しは包んで記録する
 * - 本人用のパスワード再設定は D1 のトランザクション対応まで無効(D1_TRANSACTIONS_SUPPORTED)。
 *   フラグを立てれば同じ組み立てで有効になる
 *
 * TLS(465 / STARTTLS)と AUTH の分岐は Node の test/smtp-client.test.ts が偽の接続で見る(ここで TLS の
 * 証明書を用意しないため)。
 */

import { SELF, applyD1Migrations, createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createD1Database,
  insertPunchEvent,
  permissionPresets,
  presetAssignments,
  tenants,
  upsertNotificationSettings,
  upsertUserNotificationSettings,
  users,
  uuidv7,
  type Database,
} from "@kizami/db";
import worker, { createWorkerApp, handleScheduled, type WorkerEnv } from "../../src/workers.js";
import { extractCookie, jstMinutes, seedTenant } from "../support/seed.js";

const testEnv = env as unknown as WorkerEnv & typeof env;
const ORIGIN = "https://kizami.test";
const SCHEDULED_TIME = Date.UTC(2026, 3, 15, 3, 0); // JST 2026-04-15 12:00
const NOW_MINUTES = Math.floor(SCHEDULED_TIME / 60_000);

interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
}

async function inbox(): Promise<ReceivedMail[]> {
  return (await (await fetch(testEnv.TEST_SMTP_INBOX_URL)).json()) as ReceivedMail[];
}

let db: Database;
let tenantId: string;
let userId: string;
let cookie: string;

async function grant(params: { tenantId: string; userId: string; permission: string }): Promise<void> {
  const presetId = uuidv7();
  await db.insert(permissionPresets).values({
    id: presetId,
    tenantId: params.tenantId,
    name: `test-grant:${params.permission}`,
    grants: JSON.stringify([{ key: params.permission, scope: "tenant" }]),
    isSystem: false,
    createdAt: 0,
  });
  await db.insert(presetAssignments).values({ id: uuidv7(), tenantId: params.tenantId, userId: params.userId, presetId, createdAt: 0 });
}

async function setSmtp(port: number): Promise<void> {
  await upsertNotificationSettings(db, {
    tenantId,
    webhookEnabled: false,
    webhookUrl: null,
    smtpEnabled: true,
    smtpHost: "127.0.0.1",
    smtpPort: port,
    smtpUser: null,
    smtpPassword: null,
    smtpFrom: "KIZAMI 通知 <noreply@example.com>",
    updatedAt: 0,
    updatedBy: userId,
  });
}

/** 受けた本文の Subject を復号する(encoded-word の B だけ)。 */
function subjectOf(data: string): string {
  const header = /\r\nSubject: ((?:.*)(?:\r\n .*)*)\r\n/.exec(`\r\n${data}`)?.[1] ?? "";
  return header
    .split(/\r\n /)
    .map((word) => {
      const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(word);
      return m ? new TextDecoder().decode(Uint8Array.from(atob(m[1] ?? ""), (c) => c.charCodeAt(0))) : word;
    })
    .join("");
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  ({ db } = createD1Database(env.DB));
  const seeded = await seedTenant(db);
  ({ tenantId, userId } = seeded);
  await grant({ tenantId, userId, permission: "notification.settings.manage" });

  const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: seeded.email, password: seeded.password }),
  });
  expect(login.status).toBe(200);
  cookie = extractCookie(login);
});

beforeEach(async () => {
  await fetch(testEnv.TEST_SMTP_INBOX_URL, { method: "DELETE" });
  await setSmtp(testEnv.TEST_SMTP_PORT);
});

describe("tenant SMTP over cloudflare:sockets", () => {
  it("管理者のテスト送信が、本物の TCP で偽の SMTP サーバーに届く", async () => {
    const res = await SELF.fetch(`${ORIGIN}/settings/notifications/test`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ channel: "smtp", ok: true }] });

    const mails = await inbox();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.from).toBe("MAIL FROM:<noreply@example.com>");
    expect(mails[0]?.to).toEqual(["RCPT TO:<test@example.com>"]);
    expect(mails[0]?.data).toContain("To: test@example.com\r\n");
    expect(mails[0]?.data).toContain("Content-Type: text/plain; charset=UTF-8\r\n");
    expect(subjectOf(mails[0]?.data ?? "")).toBe("KIZAMI 通知テスト");
  });

  it("ポート 25 は接続の前に断り、テスト送信の結果に理由が出る", async () => {
    await setSmtp(25);
    const res = await SELF.fetch(`${ORIGIN}/settings/notifications/test`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    const body = (await res.json()) as { results: Array<{ channel: string; ok: boolean; error?: string }> };
    expect(body.results).toEqual([{ channel: "smtp", ok: false, error: expect.stringContaining("port 25 is blocked on Cloudflare Workers") }]);
    expect(await inbox()).toEqual([]);
  });

  it("Cron の打刻忘れが、本人の個人設定(メール ON)に従ってメールを送る", async () => {
    await upsertUserNotificationSettings(db, {
      tenantId,
      userId,
      missingClockOutEmail: true,
      missingClockOutWebhook: false,
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
      emailAddress: "me@example.org",
      webhookUrl: null,
      updatedAt: 0,
    });
    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "0,15,30,45 * * * *", scheduledTime: SCHEDULED_TIME }), env as never, ctx);
    await waitOnExecutionContext(ctx);

    const mails = await inbox();
    expect(mails.map((m) => m.to)).toEqual([["RCPT TO:<me@example.org>"]]);
    expect(subjectOf(mails[0]?.data ?? "")).toContain("打刻");
  });
});

describe("system mail over the Email Service binding", () => {
  /** 本物の(miniflare がシミュレートする)バインディングを包んで、渡した内容を記録する。 */
  function recordingEnv() {
    const sent: unknown[] = [];
    const binding = testEnv.EMAIL as { send(message: unknown): Promise<unknown> };
    const mailEnv: WorkerEnv = {
      ...testEnv,
      SYSTEM_MAIL_FROM: "KIZAMI <noreply@example.com>",
      APP_BASE_URL: "https://kizami.example.com",
      EMAIL: {
        send: async (message: unknown) => {
          sent.push(message);
          return binding.send(message);
        },
      },
    };
    return { mailEnv, sent };
  }

  it("Cron の退会の再通知を、tenant.withdraw を持つ人へバインディングで送る", async () => {
    const withdrawingTenantId = uuidv7();
    const ownerId = uuidv7();
    await db.insert(tenants).values({
      id: withdrawingTenantId,
      name: "Withdrawing",
      createdAt: 0,
      withdrawalRequestedAt: NOW_MINUTES - 24 * 24 * 60,
      // 削除予定の6日前 = 再通知(7日前)の窓の中
      withdrawalScheduledPurgeAt: NOW_MINUTES + 6 * 24 * 60,
    });
    await db.insert(users).values({ id: ownerId, tenantId: withdrawingTenantId, email: "owner@example.org", name: "Owner", isActive: true, createdAt: 0 });
    await grant({ tenantId: withdrawingTenantId, userId: ownerId, permission: "tenant.withdraw" });

    const { mailEnv, sent } = recordingEnv();
    const result = await handleScheduled(createScheduledController({ cron: "6,21,36,51 * * * *", scheduledTime: SCHEDULED_TIME }), mailEnv, createExecutionContext());
    expect(result.outcomes).toMatchObject([{ job: "tenant-withdrawal", ok: true, counts: { reminded: 1 } }]);
    expect(sent).toEqual([
      {
        to: "owner@example.org",
        from: { email: "noreply@example.com", name: "KIZAMI" },
        subject: expect.stringContaining("KIZAMI"),
        text: expect.stringContaining("https://kizami.example.com/settings/withdrawal"),
      },
    ]);
  });

  it("本人用のパスワード再設定は D1 のトランザクション対応まで無効、フラグを立てれば同じ組み立てで有効", async () => {
    const { mailEnv } = recordingEnv();
    const config = async (app: ReturnType<typeof createWorkerApp>) =>
      (await app.fetch(new Request(`${ORIGIN}/password-resets/config`), mailEnv as never, createExecutionContext() as never)).json();
    expect(await config(createWorkerApp(mailEnv))).toEqual({ selfService: false });
    expect(await config(createWorkerApp(mailEnv, { d1TransactionsSupported: true }))).toEqual({ selfService: true });
    // システムメールが無ければフラグを立てても無効
    expect(await config(createWorkerApp(testEnv, { d1TransactionsSupported: true }))).toEqual({ selfService: false });
  });
});
