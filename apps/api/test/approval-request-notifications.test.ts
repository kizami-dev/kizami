/**
 * 承認依頼の通知(2026-08-23 追加、依頼「Tier 0 実装その2」)。
 *
 * apps/api/src/lib/approvers.ts(resolveApproversForUser)+ routes/corrections.ts・
 * routes/leave.ts・routes/auto-break-waivers.ts の POST /(申請作成)を対象に:
 * - 部署スコープの承認者だけに届く(スコープ外の承認権限者には届かない)
 * - 申請者自身(承認権限あり)には届かない
 * - テナント共有 Webhook に1件飛ぶ・文面に理由が含まれない
 * - 個人設定で approval_request をメール/Webhook ON にすると外部チャネルが使われる
 * - leave / auto-break-waivers でも同じ配線になっている(type の確認のみ)
 *
 * 通知系はすべてモック(fetchImpl 差し替え)で実送信しない。
 */

import { describe, expect, it } from "vitest";
import {
  authCredentials,
  insertLeaveGrant,
  listNotifications,
  upsertMembership,
  upsertNotificationSettings,
  upsertUserNotificationSettings,
  users,
  uuidv7,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";
import { setupOrgFixture } from "./support/org.js";
import { hashPassword } from "../src/auth/password.js";

/** ログイン不要の承認者役ユーザーを作る(通知の宛先確認は DB を直接読むだけで足りるため)。 */
async function createApproverUser(db: Database, tenantId: string, label: string): Promise<string> {
  const userId = uuidv7();
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `approver-${label}-${userId}@example.com`,
    name: `Approver ${label}`,
    isActive: true,
    createdAt: 0,
  });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId,
    passwordHash: await hashPassword("unused - never logs in"),
    createdAt: 0,
    updatedAt: 0,
  });
  return userId;
}

interface UserFetchInit {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function createCorrectionRequestViaApi(app: UserFetchInit, cookie: string, reason: string) {
  return app.request("/corrections", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ proposedKind: "clock_in", proposedOccurredAt: 60, reason }),
  });
}

describe("approval request notifications: scope", () => {
  it("notifies a department-scoped approver in the requester's department, but not one in an unrelated department", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupOrgFixture(db, tenantId);

    // 申請者(=actor)を部署Aに所属させる。
    await upsertMembership(db, { tenantId, userId, departmentId: org.deptA.id, createdAt: 0 });

    // 部署Aの承認者(department スコープ) — 通知が届くはず。
    const approverInA = await createApproverUser(db, tenantId, "in-A");
    await upsertMembership(db, { tenantId, userId: approverInA, departmentId: org.deptA.id, createdAt: 0 });
    await grantPermission(db, { tenantId, userId: approverInA, permission: "attendance.correction.approve", scope: "department" });

    // 部署Bの承認者(department スコープ) — 部署Aの申請者はスコープ外なので届かないはず。
    const approverInB = await createApproverUser(db, tenantId, "in-B");
    await upsertMembership(db, { tenantId, userId: approverInB, departmentId: org.deptB.id, createdAt: 0 });
    await grantPermission(db, { tenantId, userId: approverInB, permission: "attendance.correction.approve", scope: "department" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await createCorrectionRequestViaApi(app, cookie, "テスト理由A");
    expect(res.status).toBe(201);

    const inANotifications = await listNotifications(db, { tenantId, userId: approverInA });
    expect(inANotifications.filter((n) => n.type === "approval_request_correction")).toHaveLength(1);

    const inBNotifications = await listNotifications(db, { tenantId, userId: approverInB });
    expect(inBNotifications.filter((n) => n.type === "approval_request_correction")).toHaveLength(0);
  });

  it("does not notify the requester even when the requester also holds the approve permission (self-approval)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    // 申請者自身がテナント全体スコープの承認権限を持つ(自己承認できる)。
    await grantPermission(db, { tenantId, userId, permission: "attendance.correction.approve", scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await createCorrectionRequestViaApi(app, cookie, "自己承認できるが通知は自分に来ない");
    expect(res.status).toBe(201);

    const own = await listNotifications(db, { tenantId, userId });
    expect(own.filter((n) => n.type === "approval_request_correction")).toHaveLength(0);
  });
});

describe("approval request notifications: tenant shared webhook", () => {
  it("sends exactly one tenant webhook message whose body omits the request reason", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    // テナント共有 Webhook を設定(平文 URL。decryptSecret は enc: プレフィクスが無ければ
    // encryptor 無しでもそのまま返すため、テストでは暗号化を省略できる)。
    await upsertNotificationSettings(db, {
      tenantId,
      webhookEnabled: true,
      webhookUrl: "https://tenant-shared.example/webhook",
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      updatedAt: 0,
      updatedBy: userId,
    });

    // 承認者を1人作る(department 通知テストと重複しないよう、ここではテナントスコープにする)。
    const approver = await createApproverUser(db, tenantId, "tenant-scope");
    await grantPermission(db, { tenantId, userId: approver, permission: "attendance.correction.approve", scope: "tenant" });

    const hits: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? String(init.body) : "";
      hits.push({ url: typeof input === "string" ? input : input.toString(), body });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const app = createApp({ db, notify: { fetchImpl } });
    const cookie = await loginAndGetCookie(app, email, password);

    const secretReason = "とても個人的な理由テキスト12345";
    const res = await createCorrectionRequestViaApi(app, cookie, secretReason);
    expect(res.status).toBe(201);

    const tenantHits = hits.filter((h) => h.url === "https://tenant-shared.example/webhook");
    expect(tenantHits).toHaveLength(1);
    expect(tenantHits[0]?.body).not.toContain(secretReason);
  });
});

describe("approval request notifications: personal channel opt-in", () => {
  it("uses the approver's personal webhook once approval_request webhook is enabled for them", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const approver = await createApproverUser(db, tenantId, "personal-webhook");
    await grantPermission(db, { tenantId, userId: approver, permission: "attendance.correction.approve", scope: "tenant" });

    // 承認者本人の個人設定で approval_request の Webhook を ON にし、個人 Webhook URL を設定する
    // (暗号化は省略 — buildPersonalChannels は decryptSecret 経由で enc: プレフィクス無しの
    // 値をそのまま通す)。
    await upsertUserNotificationSettings(db, {
      tenantId,
      userId: approver,
      missingClockOutEmail: false,
      missingClockOutWebhook: false,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      approvalRequestEmail: false,
      approvalRequestWebhook: true,
      emailAddress: null,
      webhookUrl: "https://approver-personal.example/webhook",
      updatedAt: 0,
    });

    const hits: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      hits.push(typeof input === "string" ? input : input.toString());
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const app = createApp({ db, notify: { fetchImpl } });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await createCorrectionRequestViaApi(app, cookie, "個人Webhookテスト");
    expect(res.status).toBe(201);

    expect(hits).toContain("https://approver-personal.example/webhook");
  });

  it("does NOT use the approver's personal webhook when approval_request webhook stays off (default)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const approver = await createApproverUser(db, tenantId, "personal-webhook-off");
    await grantPermission(db, { tenantId, userId: approver, permission: "attendance.correction.approve", scope: "tenant" });

    // 個人 Webhook URL は設定するが、approval_request カテゴリの webhook は既定(OFF)のまま。
    await upsertUserNotificationSettings(db, {
      tenantId,
      userId: approver,
      missingClockOutEmail: false,
      missingClockOutWebhook: false,
      overtimeAlertEmail: false,
      overtimeAlertWebhook: false,
      leaveAlertEmail: false,
      leaveAlertWebhook: false,
      correctionAlertEmail: false,
      correctionAlertWebhook: false,
      approvalRequestEmail: false,
      approvalRequestWebhook: false,
      emailAddress: null,
      webhookUrl: "https://approver-personal-off.example/webhook",
      updatedAt: 0,
    });

    const hits: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      hits.push(typeof input === "string" ? input : input.toString());
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const app = createApp({ db, notify: { fetchImpl } });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await createCorrectionRequestViaApi(app, cookie, "個人Webhook OFFテスト");
    expect(res.status).toBe(201);

    expect(hits).not.toContain("https://approver-personal-off.example/webhook");

    // アプリ内通知自体は既定(常時ON)で届く。
    const notifications = await listNotifications(db, { tenantId, userId: approver });
    expect(notifications.filter((n) => n.type === "approval_request_correction")).toHaveLength(1);
  });
});

describe("approval request notifications: leave / auto-break-waivers wiring", () => {
  it("POST /leave/requests notifies approvers with type approval_request_leave", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const approver = await createApproverUser(db, tenantId, "leave");
    await grantPermission(db, { tenantId, userId: approver, permission: "leave.request.approve", scope: "tenant" });

    // 残高が無いと 409 insufficient_balance になるため、有給を付与しておく
    // (test/leave-requests.test.ts の grantAnnual と同じ形)。
    await insertLeaveGrant(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2026-01-01",
      days: 10,
      expiresOn: "2028-01-01",
      source: "manual",
      createdAt: 0,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-05-11", reason: "有給" }),
    });
    expect(res.status).toBe(201);

    const notifications = await listNotifications(db, { tenantId, userId: approver });
    expect(notifications.filter((n) => n.type === "approval_request_leave")).toHaveLength(1);
  });

  it("POST /auto-break-waivers notifies approvers with type approval_request_waiver", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();

    const approver = await createApproverUser(db, tenantId, "waiver");
    await grantPermission(db, { tenantId, userId: approver, permission: "attendance.correction.approve", scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/auto-break-waivers", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ waiveDate: "2026-05-11", reason: "休憩を取れなかった" }),
    });
    expect(res.status).toBe(201);

    const notifications = await listNotifications(db, { tenantId, userId: approver });
    expect(notifications.filter((n) => n.type === "approval_request_waiver")).toHaveLength(1);
  });
});
