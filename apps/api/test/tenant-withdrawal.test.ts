/**
 * テナントの退会(申請 → 30日の猶予 → 物理削除)のルート・定期ジョブ・運用者 CLI のテスト。
 * 設計は docs/design/tenant-withdrawal.md。削除そのもの(全テーブルの漏れ・別テナントの行の不変・
 * 途中で失敗した後の再実行)は packages/db/test/tenant-purge.test.ts が SQLite・PostgreSQL・D1 で見る。
 * ここではその上に載る次を守る:
 *
 * 1. 権限とテナント名の再入力
 * 2. 猶予期間の制限(ログイン・既存のセッション・API キー・打刻・招待・パスワード再設定・定期ジョブ)
 * 3. 取り消しで元どおりに使えること
 * 4. 削除予定の前は消えず、過ぎたら消えること(再通知は1回、完了のメール)
 * 5. 全データのエクスポート(zip の中身・秘密を含まない・監査ログ)
 * 6. 削除の後、同じメールで新しく登録できること
 */

import { strFromU8, unzipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  authCredentials,
  claimTenantPurge,
  listTenantsDueForPurge,
  insertPunchEvent,
  invitations,
  passwordResetTokens,
  tenants,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { sha256Hex } from "../src/auth/api-key.js";
import { purgeTenantNow } from "../src/lib/operator-commands.js";
import type { SystemMail } from "../src/lib/system-mail.js";
import { bootstrapTenant } from "../src/lib/tenant-bootstrap.js";
import { WITHDRAWAL_GRACE_MINUTES, WITHDRAWAL_REMINDER_LEAD_MINUTES } from "../src/lib/tenant-withdrawal.js";
import { runLeaveGrantProposalScan } from "../src/leave-grant-proposals.js";
import { listActiveUsers } from "../src/reminders.js";
import { purgeWithdrawnTenant, runTenantWithdrawalScan } from "../src/tenant-purge.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
const NOW_MINUTES = Math.floor(FIXED_NOW.getTime() / 60_000);
const DAY = 24 * 60;
const APP_BASE_URL = "https://app.example.com";
const TENANT_NAME = "Test Tenant";

interface Harness {
  db: Database;
  app: ReturnType<typeof createApp>;
  mails: SystemMail[];
  tenantId: string;
  admin: { userId: string; email: string; password: string };
  member: { userId: string; email: string; password: string };
  otherTenantId: string;
}

/**
 * 管理者(tenant.withdraw を持つ)・従業員(持たない)のいるテナントと、別のテナントを1つ用意する。
 * メールは偽の送信関数で集める。
 */
async function harness(options: { mail?: boolean } = {}): Promise<Harness> {
  const seeded = await setupTestDb();
  const { db, tenantId } = seeded;
  await grantPermission(db, { tenantId, userId: seeded.userId, permission: "tenant.withdraw", scope: "tenant" });
  const member = await setupSecondUser(db, tenantId);
  const [policy] = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId)).limit(1);
  await db.insert(userPolicyAssignments).values({ id: uuidv7(), tenantId, userId: member.userId, workPolicyId: policy!.id, effectiveFrom: "1970-01-01", createdAt: 0 });
  await db.update(users).set({ hireDate: "2025-12-15" }).where(eq(users.tenantId, tenantId));

  const other = await bootstrapTenant(db, { tenantName: "別の会社", adminEmail: "other-admin@example.com", adminPassword: "other horse battery staple", now: 0 });
  await db.update(users).set({ hireDate: "2025-12-15" }).where(eq(users.tenantId, other.tenantId));

  const mails: SystemMail[] = [];
  const app = createApp({
    db,
    ...(options.mail === false
      ? {}
      : {
          tenantWithdrawalMail: {
            appBaseUrl: APP_BASE_URL,
            sendMail: async (mail: SystemMail) => {
              mails.push(mail);
            },
          },
        }),
  });
  return {
    db,
    app,
    mails,
    tenantId,
    admin: { userId: seeded.userId, email: seeded.email, password: seeded.password },
    member,
    otherTenantId: other.tenantId,
  };
}

function post(app: Harness["app"], path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function login(app: Harness["app"], email: string, password: string) {
  return app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

async function requestWithdrawal(h: Harness, cookie: string) {
  const res = await post(h.app, "/tenant/withdrawal", cookie, { confirmTenantName: TENANT_NAME });
  expect(res.status).toBe(200);
  return (await res.json()) as { withdrawal: { status: string; requestedAt: number; scheduledPurgeAt: number } };
}

async function issueMemberApiKey(h: Harness, memberCookie: string): Promise<string> {
  const res = await post(h.app, "/api-keys", memberCookie, { name: "IC カード", scopes: ["punch"] });
  expect(res.status).toBe(201);
  return ((await res.json()) as { apiKey: { token: string } }).apiKey.token;
}

function punchWithKey(h: Harness, token: string) {
  return h.app.request("/punches", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind: "clock_in" }),
  });
}

describe("テナントの退会", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("権限とテナント名の再入力", () => {
    it("tenant.withdraw を持たない人は、状態の取得・申請・取り消し・エクスポートのどれも 403", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.member.email, h.member.password);
      expect((await h.app.request("/tenant/withdrawal", { headers: { cookie } })).status).toBe(403);
      expect((await post(h.app, "/tenant/withdrawal", cookie, { confirmTenantName: TENANT_NAME })).status).toBe(403);
      expect((await post(h.app, "/tenant/withdrawal/cancel", cookie)).status).toBe(403);
      expect((await h.app.request("/tenant/export", { headers: { cookie } })).status).toBe(403);
      const [tenant] = await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId));
      expect(tenant?.withdrawalRequestedAt).toBeNull();
    });

    it("テナント名が一致しなければ 400 confirmation_mismatch で何も変わらない(前後の空白だけは許す)", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      for (const wrong of ["test tenant", "Test  Tenant", "別の会社", ""]) {
        const res = await post(h.app, "/tenant/withdrawal", cookie, { confirmTenantName: wrong });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "confirmation_mismatch" });
      }
      expect((await post(h.app, "/tenant/withdrawal", cookie, {})).status).toBe(400);
      const status = (await (await h.app.request("/tenant/withdrawal", { headers: { cookie } })).json()) as { withdrawal: { status: string } };
      expect(status.withdrawal.status).toBe("active");

      const ok = await post(h.app, "/tenant/withdrawal", cookie, { confirmTenantName: `  ${TENANT_NAME} ` });
      expect(ok.status).toBe(200);
    });
  });

  describe("申請", () => {
    it("削除予定は申請の30日後。監査ログを残し、tenant.withdraw を持つ全員へメールを送る(テナント名は本文に入れない)。2回目は 409", async () => {
      const h = await harness();
      // もう1人、退会の権限を持つ管理者(申請した本人以外にも知らせる)
      const coAdmin = { email: "co-admin@example.com" };
      const coAdminId = uuidv7();
      await h.db.insert(users).values({ id: coAdminId, tenantId: h.tenantId, email: coAdmin.email, name: "副管理者", createdAt: 0 });
      await grantPermission(h.db, { tenantId: h.tenantId, userId: coAdminId, permission: "tenant.withdraw", scope: "tenant" });

      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      const body = await requestWithdrawal(h, cookie);
      expect(body.withdrawal).toEqual({ status: "withdrawing", requestedAt: NOW_MINUTES, scheduledPurgeAt: NOW_MINUTES + 30 * DAY });

      const logs = await h.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, h.tenantId), eq(auditLogs.action, "tenant.withdrawal.request")));
      expect(logs).toHaveLength(1);
      expect(logs[0]?.actorId).toBe(h.admin.userId);

      expect(h.mails.map((m) => m.to).sort()).toEqual([coAdmin.email, h.admin.email].sort());
      for (const mail of h.mails) {
        expect(mail.text).not.toContain(TENANT_NAME);
        expect(mail.subject).not.toContain(TENANT_NAME);
        expect(mail.text).toContain(`${APP_BASE_URL}/settings/withdrawal`);
        expect(mail.text).toContain("労働基準法109条");
        expect(mail.text).toContain("2026-07-15 12:00"); // 削除予定(日本時間)
      }
      // 従業員には送らない
      expect(h.mails.some((m) => m.to === h.member.email)).toBe(false);

      // 手続き中の書き込みは取り消し以外ガードが 409 で止める(申請の条件付き UPDATE の手前で)
      const second = await post(h.app, "/tenant/withdrawal", cookie, { confirmTenantName: TENANT_NAME });
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: string }).error).toBe("tenant_withdrawing");
      const [tenant] = await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId));
      expect(tenant?.withdrawalRequestedAt).toBe(NOW_MINUTES);
    });

    it("システムメールの無い配備(セルフホスト)ではメールを出さず、画面の表示だけ", async () => {
      const h = await harness({ mail: false });
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, cookie);
      expect(h.mails).toEqual([]);
      const status = (await (await h.app.request("/tenant/withdrawal", { headers: { cookie } })).json()) as { mailNotifications: boolean };
      expect(status.mailNotifications).toBe(false);
    });
  });

  describe("メールの言語(宛先ごとの users.locale)", () => {
    /** 退会の権限を持つ管理者を1人足す(言語を指定できる)。 */
    async function addAdmin(h: Harness, email: string, locale: string | null) {
      const id = uuidv7();
      await h.db.insert(users).values({ id, tenantId: h.tenantId, email, name: email, locale, createdAt: 0 });
      await grantPermission(h.db, { tenantId: h.tenantId, userId: id, permission: "tenant.withdraw", scope: "tenant" });
      return id;
    }

    it("申請のメール: 宛先ごとにその人の言語で届く(申請者の言語ではない)。未設定・不正値は ja", async () => {
      const h = await harness();
      await h.db.update(users).set({ locale: "en" }).where(eq(users.id, h.admin.userId));
      await addAdmin(h, "ko-admin@example.com", "ko");
      await addAdmin(h, "none-admin@example.com", null);
      await addAdmin(h, "bad-admin@example.com", "xx");

      await requestWithdrawal(h, await loginAndGetCookie(h.app, h.admin.email, h.admin.password));

      const subjectOf = (to: string) => h.mails.find((m) => m.to === to)?.subject;
      expect(subjectOf(h.admin.email)).toBe("[KIZAMI] We received your tenant withdrawal request");
      expect(subjectOf("ko-admin@example.com")).toBe("[KIZAMI] 테넌트 탈퇴 신청을 접수했습니다");
      expect(subjectOf("none-admin@example.com")).toBe("【KIZAMI】テナントの退会のお申し込みを受け付けました");
      expect(subjectOf("bad-admin@example.com")).toBe("【KIZAMI】テナントの退会のお申し込みを受け付けました");
      expect(h.mails).toHaveLength(4);
      // 英語・韓国語版も日時(日本時間のまま)と画面の URL を持つ
      expect(h.mails.find((m) => m.to === h.admin.email)?.text).toContain("Jul 15, 2026, 12:00 (JST)");
      expect(h.mails.find((m) => m.to === "ko-admin@example.com")?.text).toContain("2026년 7월 15일 12:00(일본 시간)");
    });

    it("定期ジョブ: 7日前の再通知と、削除の完了のメールも宛先ごとの言語(完了の宛先と言語は削除の前に集める)", async () => {
      const h = await harness();
      await h.db.update(users).set({ locale: "zh-Hant" }).where(eq(users.id, h.admin.userId));
      await addAdmin(h, "en-admin@example.com", "en");
      const { withdrawal } = await requestWithdrawal(h, await loginAndGetCookie(h.app, h.admin.email, h.admin.password));
      h.mails.length = 0;
      const mailer = { appBaseUrl: APP_BASE_URL, sendMail: async (mail: SystemMail) => void h.mails.push(mail) };

      await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt - WITHDRAWAL_REMINDER_LEAD_MINUTES, mailer });
      const reminders = Object.fromEntries(h.mails.map((m) => [m.to, m.subject]));
      expect(reminders).toEqual({
        [h.admin.email]: "[KIZAMI] 公司的資料即將被刪除",
        "en-admin@example.com": "[KIZAMI] Your tenant's data is about to be deleted",
      });

      h.mails.length = 0;
      const purged = await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt, mailer });
      expect(purged.purgedTenantIds).toEqual([h.tenantId]);
      // 削除で users 行が消えた後でも、削除の前に集めた言語で届く
      expect(await h.db.select().from(users).where(eq(users.tenantId, h.tenantId))).toEqual([]);
      expect(Object.fromEntries(h.mails.map((m) => [m.to, m.subject]))).toEqual({
        [h.admin.email]: "[KIZAMI] 公司的資料已刪除完成",
        "en-admin@example.com": "[KIZAMI] Your tenant's data has been deleted",
      });
    });

    it("退会手続き中でも、退会の権限を持つ人は自分の言語を保存できる(削除の7日前・完了のメールに反映される)", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, cookie);
      const res = await h.app.request("/me/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ locale: "ko" }),
      });
      expect(res.status).toBe(200);
      const [row] = await h.db.select().from(users).where(eq(users.id, h.admin.userId));
      expect(row?.locale).toBe("ko");
    });

    it("1通の送信が失敗しても、他の宛先へは送られる(従来の失敗の扱いのまま)", async () => {
      const h = await harness();
      await addAdmin(h, "en-admin@example.com", "en");
      const { withdrawal } = await requestWithdrawal(h, await loginAndGetCookie(h.app, h.admin.email, h.admin.password));
      h.mails.length = 0;
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const mailer = {
        appBaseUrl: APP_BASE_URL,
        sendMail: async (mail: SystemMail) => {
          if (mail.to === h.admin.email) throw new Error("smtp down");
          h.mails.push(mail);
        },
      };
      await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt - WITHDRAWAL_REMINDER_LEAD_MINUTES, mailer });
      expect(h.mails.map((m) => m.to)).toEqual(["en-admin@example.com"]);
      expect(errors).toHaveBeenCalled();
      errors.mockRestore();
    });
  });

  describe("猶予期間の制限", () => {
    it("管理者以外はログインできず(403)、既存のセッションは 401 tenant_withdrawing。管理者はログインでき、/me に削除予定が出る", async () => {
      const h = await harness();
      const memberCookie = await loginAndGetCookie(h.app, h.member.email, h.member.password);
      const adminCookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, adminCookie);

      const denied = await login(h.app, h.member.email, h.member.password);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: "tenant_withdrawing" });
      expect(denied.headers.get("set-cookie")).toBeNull();
      // パスワードが違えば従来どおり 401(手続き中かどうかを漏らさない)
      expect((await login(h.app, h.member.email, "wrong password")).status).toBe(401);

      const meWithOldSession = await h.app.request("/me", { headers: { cookie: memberCookie } });
      expect(meWithOldSession.status).toBe(401);
      expect(await meWithOldSession.json()).toEqual({ error: "tenant_withdrawing" });

      expect((await login(h.app, h.admin.email, h.admin.password)).status).toBe(200);
      const me = (await (await h.app.request("/me", { headers: { cookie: adminCookie } })).json()) as {
        tenant: { withdrawal: { scheduledPurgeAt: number } | null };
      };
      expect(me.tenant.withdrawal?.scheduledPurgeAt).toBe(NOW_MINUTES + 30 * DAY);

      // 別のテナントには何の影響も無い
      expect((await login(h.app, "other-admin@example.com", "other horse battery staple")).status).toBe(200);
    });

    it("管理者も書き込みは取り消し以外 409。閲覧と既存の CSV エクスポートはできる", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, cookie);

      const punch = await post(h.app, "/punches", cookie, { kind: "clock_in" });
      expect(punch.status).toBe(409);
      expect(await punch.json()).toEqual({ error: "tenant_withdrawing" });
      expect((await post(h.app, "/tenant/withdrawal", cookie, { confirmTenantName: TENANT_NAME })).status).toBe(409);
      expect((await h.app.request("/attendance/status", { headers: { cookie } })).status).toBe(200);
      expect((await h.app.request("/tenant/withdrawal", { headers: { cookie } })).status).toBe(200);
    });

    it("打刻の拒否: API キーは 403 tenant_withdrawing(キーは消さない)", async () => {
      const h = await harness();
      const memberCookie = await loginAndGetCookie(h.app, h.member.email, h.member.password);
      const token = await issueMemberApiKey(h, memberCookie);
      const adminCookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, adminCookie);

      const res = await punchWithKey(h, token);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "tenant_withdrawing" });
      expect((await h.app.request("/attendance/status", { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    });

    it("招待の受諾と、管理者以外のパスワード再設定は 403(パスワードも変わらない)", async () => {
      const h = await harness();
      const invitedId = uuidv7();
      await h.db.insert(users).values({ id: invitedId, tenantId: h.tenantId, email: "invited@example.com", name: "招待中", createdAt: 0 });
      await h.db.insert(invitations).values({
        id: uuidv7(),
        tenantId: h.tenantId,
        userId: invitedId,
        tokenHash: await sha256Hex("invite-token"),
        expiresAt: NOW_MINUTES + DAY,
        createdBy: h.admin.userId,
        createdAt: NOW_MINUTES,
      });
      await h.db.insert(passwordResetTokens).values({
        id: uuidv7(),
        tenantId: h.tenantId,
        userId: h.member.userId,
        tokenHash: await sha256Hex("reset-token"),
        expiresAt: NOW_MINUTES + DAY,
        createdBy: h.admin.userId,
        createdAt: NOW_MINUTES,
      });
      const [credentialBefore] = await h.db.select().from(authCredentials).where(eq(authCredentials.userId, h.member.userId));

      const adminCookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, adminCookie);

      const accept = await h.app.request("/invitations/invite-token/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "brand new horse battery" }),
      });
      expect(accept.status).toBe(403);
      expect(await h.db.select().from(authCredentials).where(eq(authCredentials.userId, invitedId))).toEqual([]);

      const reset = await h.app.request("/password-resets/reset-token/use", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "brand new horse battery" }),
      });
      expect(reset.status).toBe(403);
      expect(await reset.json()).toEqual({ error: "tenant_withdrawing" });
      const [credentialAfter] = await h.db.select().from(authCredentials).where(eq(authCredentials.userId, h.member.userId));
      expect(credentialAfter?.passwordHash).toBe(credentialBefore?.passwordHash);
    });

    it("日次ジョブの停止: 手続き中のテナントのユーザーは、定期ジョブの対象(listActiveUsers・有給の予告)から外れる", async () => {
      const h = await harness();
      const before = await listActiveUsers(h.db);
      expect(before.filter((u) => u.tenantId === h.tenantId)).toHaveLength(2);
      const grantsBefore = await runLeaveGrantProposalScan(h.db, { nowMinutes: NOW_MINUTES });

      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, cookie);

      const after = await listActiveUsers(h.db);
      expect(after.filter((u) => u.tenantId === h.tenantId)).toEqual([]);
      expect(after.filter((u) => u.tenantId === h.otherTenantId)).toHaveLength(1);
      const grantsAfter = await runLeaveGrantProposalScan(h.db, { nowMinutes: NOW_MINUTES });
      expect(grantsAfter.scannedUserCount).toBe(grantsBefore.scannedUserCount - 2);
    });
  });

  it("取り消すと元どおり: 従業員のログイン・既存のセッション・API キーの打刻が使え、監査ログが残る", async () => {
    const h = await harness();
    const memberCookie = await loginAndGetCookie(h.app, h.member.email, h.member.password);
    const token = await issueMemberApiKey(h, memberCookie);
    const adminCookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
    await requestWithdrawal(h, adminCookie);
    expect((await punchWithKey(h, token)).status).toBe(403);

    const cancel = await post(h.app, "/tenant/withdrawal/cancel", adminCookie);
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as { withdrawal: { status: string } }).withdrawal).toEqual({ status: "active" });
    expect((await post(h.app, "/tenant/withdrawal/cancel", adminCookie)).status).toBe(409);

    expect((await login(h.app, h.member.email, h.member.password)).status).toBe(200);
    expect((await h.app.request("/me", { headers: { cookie: memberCookie } })).status).toBe(200);
    expect((await punchWithKey(h, token)).status).toBe(201);
    expect((await listActiveUsers(h.db)).filter((u) => u.tenantId === h.tenantId)).toHaveLength(2);
    const [tenant] = await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId));
    expect(tenant).toMatchObject({ withdrawalRequestedAt: null, withdrawalScheduledPurgeAt: null, withdrawalReminderSentAt: null });
    const logs = await h.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, h.tenantId), eq(auditLogs.action, "tenant.withdrawal.cancel")));
    expect(logs).toHaveLength(1);
    // 取り消した後の定期ジョブは何もしない
    const scan = await runTenantWithdrawalScan(h.db, { nowMinutes: NOW_MINUTES + 31 * DAY, mailer: null });
    expect(scan).toEqual({ remindedTenantIds: [], purgedTenantIds: [], failures: [] });
  });

  describe("定期ジョブによる削除", () => {
    function mailer(h: Harness) {
      return {
        appBaseUrl: APP_BASE_URL,
        sendMail: async (mail: SystemMail) => {
          h.mails.push(mail);
        },
      };
    }

    it("削除予定の前は消えない。7日前に再通知を1回だけ送り、予定を過ぎたら削除して完了のメールを送る", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      const { withdrawal } = await requestWithdrawal(h, cookie);
      h.mails.length = 0;

      // 再通知の時期より前: 何もしない
      const early = await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt - WITHDRAWAL_REMINDER_LEAD_MINUTES - 1, mailer: mailer(h) });
      expect(early).toEqual({ remindedTenantIds: [], purgedTenantIds: [], failures: [] });

      // 7日前: 再通知を1回だけ
      const reminderAt = withdrawal.scheduledPurgeAt - WITHDRAWAL_REMINDER_LEAD_MINUTES;
      expect((await runTenantWithdrawalScan(h.db, { nowMinutes: reminderAt, mailer: mailer(h) })).remindedTenantIds).toEqual([h.tenantId]);
      expect((await runTenantWithdrawalScan(h.db, { nowMinutes: reminderAt + 60, mailer: mailer(h) })).remindedTenantIds).toEqual([]);
      expect(h.mails.map((m) => m.subject)).toEqual(["【KIZAMI】テナントのデータの削除が近づいています"]);
      expect(h.mails[0]?.text).not.toContain(TENANT_NAME);

      // 予定の1分前: まだ消えない
      expect((await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt - 1, mailer: mailer(h) })).purgedTenantIds).toEqual([]);
      expect(await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId))).toHaveLength(1);

      // 予定を過ぎた: 削除して完了のメール(宛先は削除の前に集めた管理者)
      h.mails.length = 0;
      const purged = await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt, mailer: mailer(h) });
      expect(purged.purgedTenantIds).toEqual([h.tenantId]);
      expect(purged.failures).toEqual([]);
      expect(await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId))).toEqual([]);
      expect(await h.db.select().from(users).where(eq(users.tenantId, h.tenantId))).toEqual([]);
      expect(h.mails.map((m) => [m.to, m.subject])).toEqual([[h.admin.email, "【KIZAMI】テナントのデータの削除が完了しました"]]);
      // 別のテナントは残る
      expect(await h.db.select().from(users).where(eq(users.tenantId, h.otherTenantId))).toHaveLength(1);
      // 削除済みのテナントの管理者はもうログインできない
      expect((await login(h.app, h.admin.email, h.admin.password)).status).toBe(401);
    });

    it("1つのテナントの削除が失敗しても(外部キーで止まる)何も消えず、原因を取り除いた後の再実行で完了する", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      const { withdrawal } = await requestWithdrawal(h, cookie);
      // テナント分離が破れたデータ(別テナントの監査ログが対象テナントのユーザーを指す)を置く。
      // 削除はこれを外部キー違反として止める — 別テナントの行を黙って壊さない安全装置
      const strayId = uuidv7();
      await h.db.insert(auditLogs).values({ id: strayId, tenantId: h.otherTenantId, actorId: h.member.userId, action: "x", target: "x", occurredAt: 0 });

      const failed = await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt, mailer: null });
      expect(failed.purgedTenantIds).toEqual([]);
      expect(failed.failures.map((f) => f.tenantId)).toEqual([h.tenantId]);
      // 1トランザクションなので何も消えていない
      expect(await h.db.select().from(users).where(eq(users.tenantId, h.tenantId))).toHaveLength(2);

      await h.db.delete(auditLogs).where(eq(auditLogs.id, strayId));
      const retried = await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt + 15, mailer: null });
      expect(retried.purgedTenantIds).toEqual([h.tenantId]);
      expect(await h.db.select().from(users).where(eq(users.tenantId, h.tenantId))).toEqual([]);
    });
  });

  describe("確認と削除のすき間(TOCTOU)— 削除しない側に倒れる", () => {
    it("削除の対象と確かめた後・削除の前に管理者が取り消すと、テナントは削除されず元どおりに使える", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      const { withdrawal } = await requestWithdrawal(h, cookie);

      // 定期ジョブの「確認」(削除予定を過ぎたテナントの一覧)
      const due = await listTenantsDueForPurge(h.db, { now: withdrawal.scheduledPurgeAt });
      expect(due.map((t) => t.id)).toEqual([h.tenantId]);
      // その直後に取り消しが入る
      expect((await post(h.app, "/tenant/withdrawal/cancel", cookie)).status).toBe(200);
      // 削除: 「削除中」の印を取れず、何も消さない
      const result = await purgeWithdrawnTenant(h.db, { tenantId: h.tenantId, nowMinutes: withdrawal.scheduledPurgeAt, mailer: null });
      expect(result.status).toBe("not_withdrawing");
      expect(await h.db.select().from(users).where(eq(users.tenantId, h.tenantId))).toHaveLength(2);
      expect((await login(h.app, h.member.email, h.member.password)).status).toBe(200);
    });

    it("削除が始まった(「削除中」の印がある)テナントの取り消しは 409 purge_in_progress。削除は次の実行で完了する", async () => {
      const h = await harness();
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      const { withdrawal } = await requestWithdrawal(h, cookie);
      expect(await claimTenantPurge(h.db, { tenantId: h.tenantId, now: withdrawal.scheduledPurgeAt, requireDue: true })).not.toBeNull();

      const cancel = await post(h.app, "/tenant/withdrawal/cancel", cookie);
      expect(cancel.status).toBe(409);
      expect(await cancel.json()).toEqual({ error: "purge_in_progress" });

      const scan = await runTenantWithdrawalScan(h.db, { nowMinutes: withdrawal.scheduledPurgeAt + 15, mailer: null });
      expect(scan.purgedTenantIds).toEqual([h.tenantId]);
      expect(await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId))).toEqual([]);
    });
  });

  describe("運用者 CLI の「今すぐ削除」", () => {
    it("確認(テナント id の再入力)が一致しなければ何もしない。申請していないテナントは消せない。申請済みなら予定を待たずに消す", async () => {
      const h = await harness();
      expect(await purgeTenantNow(h.db, { tenantId: h.tenantId, confirmTenantId: h.tenantId, nowMinutes: NOW_MINUTES, mailer: null })).toEqual({
        status: "not_withdrawing",
      });
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      await requestWithdrawal(h, cookie);

      expect(await purgeTenantNow(h.db, { tenantId: h.tenantId, confirmTenantId: h.otherTenantId, nowMinutes: NOW_MINUTES, mailer: null })).toEqual({
        status: "confirmation_mismatch",
      });
      expect(await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId))).toHaveLength(1);

      const result = await purgeTenantNow(h.db, { tenantId: h.tenantId, confirmTenantId: ` ${h.tenantId} `, nowMinutes: NOW_MINUTES + 5, mailer: null });
      expect(result.status).toBe("purged");
      expect(await h.db.select().from(tenants).where(eq(tenants.id, h.tenantId))).toEqual([]);
      const again = await purgeTenantNow(h.db, { tenantId: h.tenantId, confirmTenantId: h.tenantId, nowMinutes: NOW_MINUTES + 6, mailer: null });
      expect(again.status).toBe("already_purged");
    });
  });

  describe("全データのエクスポート", () => {
    it("zip に全テーブルの JSON・月ごとの集計・出勤簿相当の CSV が入り、秘密は入らない。監査ログを残す。通常の状態でも猶予中でも使える", async () => {
      const h = await harness();
      await insertPunchEvent(h.db, {
        id: uuidv7(),
        tenantId: h.tenantId,
        userId: h.member.userId,
        kind: "clock_in",
        occurredAt: jstMinutes(2026, 6, 1, 9, 0),
        recordedAt: jstMinutes(2026, 6, 1, 9, 0),
        source: "web",
        actorId: h.member.userId,
      });
      await insertPunchEvent(h.db, {
        id: uuidv7(),
        tenantId: h.tenantId,
        userId: h.member.userId,
        kind: "clock_out",
        occurredAt: jstMinutes(2026, 6, 1, 18, 0),
        recordedAt: jstMinutes(2026, 6, 1, 18, 0),
        source: "web",
        actorId: h.member.userId,
      });
      const cookie = await loginAndGetCookie(h.app, h.admin.email, h.admin.password);
      const [credential] = await h.db.select().from(authCredentials).where(eq(authCredentials.userId, h.admin.userId));

      for (const phase of ["active", "withdrawing"] as const) {
        if (phase === "withdrawing") await requestWithdrawal(h, cookie);
        const res = await h.app.request("/tenant/export", { headers: { cookie } });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/zip");
        expect(res.headers.get("content-disposition")).toBe('attachment; filename="kizami-export-20260615.zip"');
        const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
        const names = Object.keys(files).sort();
        expect(names).toContain("README.txt");
        expect(names).toContain("manifest.json");
        expect(names).toContain("data/users.json");
        expect(names).toContain("data/punch_events.json");
        expect(names).not.toContain("data/auth_credentials.json");
        expect(names).not.toContain("data/sessions.json");
        expect(names).toContain("attendance/monthly/2026-06.csv");
        expect(names).toContain(`attendance/daily/2026-06/Second User_${h.member.userId}.csv`);

        const all = names.map((n) => strFromU8(files[n]!)).join("\n");
        // 秘密(パスワードのハッシュ)はどこにも無い。別のテナントの行も無い
        expect(all).not.toContain(credential!.passwordHash);
        expect(all).not.toContain("other-admin@example.com");

        const usersJson = JSON.parse(strFromU8(files["data/users.json"]!)) as Array<{ email: string; tenant_id: string }>;
        expect(usersJson.map((u) => u.email).sort()).toEqual([h.admin.email, h.member.email].sort());
        const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as { format: string; tenantId: string; excludedTables: Array<{ name: string }> };
        expect(manifest.format).toBe("kizami-tenant-export");
        expect(manifest.tenantId).toBe(h.tenantId);
        expect(manifest.excludedTables.map((t) => t.name)).toContain("auth_credentials");

        const daily = strFromU8(files[`attendance/daily/2026-06/Second User_${h.member.userId}.csv`]!);
        expect(daily.split("\r\n")[0]).toContain("date,clock_in,clock_out");
        expect(daily).toContain("2026-06-01,2026-06-01 09:00,2026-06-01 18:00");
        const monthly = strFromU8(files["attendance/monthly/2026-06.csv"]!);
        expect(monthly).toContain(h.member.userId);
      }

      const logs = await h.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, h.tenantId), eq(auditLogs.action, "tenant.export")));
      expect(logs).toHaveLength(2);
      expect(logs[0]?.afterDigest).not.toContain(h.member.email);
    });
  });
});

describe("削除の後、同じメールで新しく登録できる", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("サインアップで作ったテナントを退会・削除した後、同じメールでもう一度サインアップしてログインできる", async () => {
    const db = await (await import("./support/setup.js")).createTestDatabase();
    const mails: SystemMail[] = [];
    const app = createApp({
      db,
      signup: {
        mode: "open",
        turnstileSecretKey: "secret",
        turnstileSiteKey: "site-key",
        appBaseUrl: APP_BASE_URL,
        sendMail: async (mail) => {
          mails.push(mail);
        },
        fetchFn: (async () => Response.json({ success: true })) as unknown as typeof fetch,
      },
    });
    const email = "owner@example.com";
    const password = "correct horse battery staple";

    async function signupAndVerify(): Promise<string> {
      const before = mails.length;
      const res = await app.request("/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, organizationName: "株式会社サンプル", adminName: "山田 太郎", turnstileToken: "pass" }),
      });
      expect(res.status).toBe(202);
      const token = mails[before]?.text.match(/\/signup\/verify\/([\w-]+)/)?.[1];
      expect(token).toBeDefined();
      const verified = await app.request(`/signup/verify/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      expect(verified.status).toBe(200);
      const [user] = await db.select().from(users).where(eq(users.email, email));
      return user!.tenantId;
    }

    const firstTenantId = await signupAndVerify();
    const cookie = await loginAndGetCookie(app, email, password);
    const withdrawn = await app.request("/tenant/withdrawal", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmTenantName: "株式会社サンプル" }),
    });
    expect(withdrawn.status).toBe(200);
    const purged = await runTenantWithdrawalScan(db, { nowMinutes: NOW_MINUTES + WITHDRAWAL_GRACE_MINUTES, mailer: null });
    expect(purged.purgedTenantIds).toEqual([firstTenantId]);
    expect(await db.select().from(users).where(eq(users.email, email))).toEqual([]);

    // 再送のスロットル(5分)を越えてから、同じメールで登録し直す
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 10 * 60_000));
    const secondTenantId = await signupAndVerify();
    expect(secondTenantId).not.toBe(firstTenantId);
    expect((await login(app, email, password)).status).toBe(200);
  });
});
