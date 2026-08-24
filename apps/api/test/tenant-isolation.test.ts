/**
 * テナント間分離(クロステナント)の監査テスト(2026-08-24、v1.0「マルチテナント有効化」)。
 *
 * 1つのアプリ(=1つの DB)に2社(テナントA・テナントB)を作り、**テナントAの認証情報で
 * テナントBの ID を指定した**リクエストが漏れなく 403/404 になること、レスポンス本文に
 * テナントB の識別子(ユーザーID・メール・氏名・部署名など)が一切現れないことを検証する。
 *
 * 判断基準(この監査の合格条件):
 * - テナントB のリソース ID を渡した呼び出しは 200 を返してはならない(空配列の 200 も不可 —
 *   「存在しないID」と同じ 404 に倒し、当たり/外れを漏らさない)
 * - どのレスポンス本文にもテナントB の識別子が現れてはならない(expectNoTenantBLeak)
 *
 * この監査で見つかり修正した実在の穴(リグレッションテスト):
 * 1. POST /shifts/plans が他テナントのユーザーIDを受け付け、`tenant_id=A / user_id=Bのユーザー`
 *    というシフト計画を作れてしまっていた(routes/shifts.ts の isUserInShiftManageScope は
 *    tenant スコープの actor に対して常に true を返していた)
 * 2. POST /api-keys(および GET /api-keys?userId=)が同様に他テナントのユーザーIDを受け付け、
 *    そのユーザー宛のAPIキー行を作れてしまっていた
 * 3. GET /corrections?userId= / GET /leave/requests?userId= / GET /auto-break-waivers?userId= が
 *    他テナントのユーザーIDに 200(空配列)を返していた(404 に統一)
 */

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiKeys,
  authCredentials,
  createAutoBreakWaiver,
  createCorrectionRequest,
  createLeaveRequest,
  createNotificationIfAbsent,
  insertAuditLog,
  insertLeaveGrant,
  insertLeaveGrantProposal,
  insertPunchEvent,
  insertShiftPlan,
  punchEvents,
  shiftPlans,
  userPolicyAssignments,
  users,
  uuidv7,
  type Database,
} from "@kizami/db";
import { createApp, type App } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { bootstrapTenant } from "../src/lib/tenant-bootstrap.js";
import { createTestDatabase, extractCookie, jstMinutes, loginAndGetCookie } from "./support/setup.js";

/** JST 2026-04-15 12:00(テスト内の「今日」)。 */
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");

const PASSWORD = "correct horse battery staple";

interface TenantFixture {
  tenantId: string;
  adminId: string;
  adminEmail: string;
  memberId: string;
  memberEmail: string;
  memberName: string;
  workPolicyId: string;
}

/**
 * テナントを1社作る: 管理者(同梱「管理者」プリセット付き)+ 一般メンバー1名。
 * メンバーには管理者と同じ work policy を割り当てる(月次集計が動くようにするため)。
 */
async function setupTenant(db: Database, slug: string, name: string): Promise<TenantFixture> {
  const adminEmail = `${slug}-admin@example.com`;
  const { tenantId, userId: adminId, workPolicyId } = await bootstrapTenant(db, {
    tenantName: name,
    adminEmail,
    adminPassword: PASSWORD,
    now: 0,
  });

  const memberId = uuidv7();
  const memberEmail = `${slug}-member@example.com`;
  const memberName = `${slug}-メンバー`;
  await db.insert(users).values({
    id: memberId,
    tenantId,
    email: memberEmail,
    name: memberName,
    isActive: true,
    createdAt: 0,
  });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId: memberId,
    passwordHash: await hashPassword(PASSWORD),
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId,
    userId: memberId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: 0,
  });

  return { tenantId, adminId, adminEmail, memberId, memberEmail, memberName, workPolicyId };
}

interface TenantBData {
  correctionId: string;
  leaveRequestId: string;
  waiverId: string;
  shiftPlanId: string;
  proposalId: string;
  notificationId: string;
  presetIds: string[];
  departmentId: string;
  apiKeyId: string;
}

/** 分離の検証で「Bにしか無いもの」として使う識別子の集合。 */
function tenantBIdentifiers(tenantB: TenantFixture, data: TenantBData): string[] {
  return [
    tenantB.tenantId,
    tenantB.adminId,
    tenantB.adminEmail,
    tenantB.memberId,
    tenantB.memberEmail,
    tenantB.memberName,
    data.correctionId,
    data.leaveRequestId,
    data.waiverId,
    data.shiftPlanId,
    data.proposalId,
    data.notificationId,
    data.departmentId,
    data.apiKeyId,
  ];
}

/**
 * 「200 を返さない」かつ「本文に B の識別子が含まれない」ことを1か所で確認する。
 * 想定される応答は 403(スコープ外)か 404(存在しない扱い)のみ。
 */
async function expectNoTenantBLeak(res: Response, forbidden: string[], label: string): Promise<void> {
  const text = await res.text();
  expect([403, 404], `${label}: status ${res.status} body ${text}`).toContain(res.status);
  for (const needle of forbidden) {
    expect(text, `${label} leaked ${needle}`).not.toContain(needle);
  }
}

/** 200 で返る一覧に B の識別子が含まれないことを確認する。 */
async function expectListWithoutTenantB(res: Response, forbidden: string[], label: string): Promise<string> {
  expect(res.status, label).toBe(200);
  const text = await res.text();
  for (const needle of forbidden) {
    expect(text, `${label} leaked ${needle}`).not.toContain(needle);
  }
  return text;
}

interface TwoTenants {
  db: Database;
  app: App;
  tenantA: TenantFixture;
  tenantB: TenantFixture;
  adminACookie: string;
  memberACookie: string;
  adminBCookie: string;
  data: TenantBData;
}

/** テナントA・B を作り、B 側にひととおりのデータ(申請・シフト・通知・監査ログ等)を仕込む。 */
async function setupTwoTenants(): Promise<TwoTenants> {
  const db = await createTestDatabase();
  const app = createApp({ db });

  const tenantA = await setupTenant(db, "alpha", "Alpha 株式会社");
  const tenantB = await setupTenant(db, "bravo", "Bravo 株式会社");

  const adminACookie = await loginAndGetCookie(app, tenantA.adminEmail, PASSWORD);
  const memberACookie = await loginAndGetCookie(app, tenantA.memberEmail, PASSWORD);
  const adminBCookie = await loginAndGetCookie(app, tenantB.adminEmail, PASSWORD);

  // --- B のデータ(直接 DB 投入。API 経由の前提条件〔残高・設定〕に依存させないため) ---
  await insertPunchEvent(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    kind: "clock_in",
    occurredAt: jstMinutes(2026, 4, 1, 9, 0),
    recordedAt: jstMinutes(2026, 4, 1, 9, 0),
    source: "web",
    actorId: tenantB.memberId,
  });
  await insertPunchEvent(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    kind: "clock_out",
    occurredAt: jstMinutes(2026, 4, 1, 18, 0),
    recordedAt: jstMinutes(2026, 4, 1, 18, 0),
    source: "web",
    actorId: tenantB.memberId,
  });

  const correction = await createCorrectionRequest(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    requestedBy: tenantB.memberId,
    proposedKind: "clock_in",
    proposedOccurredAt: jstMinutes(2026, 4, 2, 9, 0),
    reason: "Bの修正申請",
    createdAt: 0,
  });

  await insertLeaveGrant(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    leaveType: "annual",
    grantedOn: "2026-01-01",
    days: 10,
    expiresOn: "2028-01-01",
    source: "manual",
    createdAt: 0,
  });
  const leaveRequest = await createLeaveRequest(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    requestedBy: tenantB.memberId,
    leaveDate: "2026-04-20",
    unit: "full_day",
    leaveType: "annual",
    reason: "Bの休暇申請",
    createdAt: 0,
  });

  const waiver = await createAutoBreakWaiver(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    requestedBy: tenantB.memberId,
    waiveDate: "2026-04-01",
    reason: "Bの休憩控除打ち消し申請",
    createdAt: 0,
  });

  const shiftPlan = await insertShiftPlan(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    createdAt: 0,
  });

  const proposal = await insertLeaveGrantProposal(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    leaveType: "annual",
    grantedOn: "2026-05-01",
    days: 11,
    expiresOn: "2028-05-01",
    attendanceRate: JSON.stringify({ kind: "unavailable" }),
    proposedAt: 0,
  });

  const notification = await createNotificationIfAbsent(db, {
    tenantId: tenantB.tenantId,
    userId: tenantB.memberId,
    type: "punch_missing",
    subjectDate: "2026-04-01",
    title: "Bの通知タイトル",
    body: "Bの通知本文",
    createdAt: 0,
  });
  if (!notification) throw new Error("failed to seed a tenant B notification");

  await insertAuditLog(db, {
    tenantId: tenantB.tenantId,
    actorId: tenantB.adminId,
    action: "member.invite",
    targetType: "user",
    targetId: tenantB.memberId,
    detail: JSON.stringify({ email: tenantB.memberEmail }),
    occurredAt: 0,
  });

  // --- B の API 経由で作るもの(部署・プリセット・APIキー。B 側の正常系も同時に確かめる) ---
  const deptRes = await app.request("/departments", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminBCookie },
    body: JSON.stringify({ name: "Bravo営業部" }),
  });
  expect(deptRes.status).toBe(201);
  const departmentId = ((await deptRes.json()) as { department: { id: string } }).department.id;

  const presetsRes = await app.request("/presets", { headers: { cookie: adminBCookie } });
  expect(presetsRes.status).toBe(200);
  const presetIds = ((await presetsRes.json()) as { presets: Array<{ id: string }> }).presets.map((p) => p.id);

  const apiKeyRes = await app.request("/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminBCookie },
    body: JSON.stringify({ name: "Bのキー", scopes: ["punch"], userId: tenantB.memberId }),
  });
  expect(apiKeyRes.status).toBe(201);
  const apiKeyId = ((await apiKeyRes.json()) as { apiKey: { id: string } }).apiKey.id;

  return {
    db,
    app,
    tenantA,
    tenantB,
    adminACookie,
    memberACookie,
    adminBCookie,
    data: {
      correctionId: correction.id,
      leaveRequestId: leaveRequest.id,
      waiverId: waiver.id,
      shiftPlanId: shiftPlan.id,
      proposalId: proposal.id,
      notificationId: notification.id,
      presetIds,
      departmentId,
      apiKeyId,
    },
  };
}

describe("テナント間分離(テナントAの認証情報でテナントBのIDを触れないこと)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("勤怠の閲覧系: 月次・打刻対象者一覧・CSVエクスポートにBが出てこない", async () => {
    const { app, tenantA, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    const monthly = await app.request(`/attendance/monthly?month=2026-04&userId=${tenantB.memberId}`, {
      headers: { cookie: adminACookie },
    });
    await expectNoTenantBLeak(monthly, forbidden, "GET /attendance/monthly?userId=<B>");

    const members = await app.request("/attendance/members", { headers: { cookie: adminACookie } });
    await expectListWithoutTenantB(members, forbidden, "GET /attendance/members");

    const csv = await app.request("/exports/attendance.csv?month=2026-04", { headers: { cookie: adminACookie } });
    expect(csv.status).toBe(200);
    const csvText = await csv.text();
    for (const needle of forbidden) {
      expect(csvText, `CSV leaked ${needle}`).not.toContain(needle);
    }
    // A 自身の行は出ている(空の CSV を見て「漏れていない」と誤判定しないための確認)
    expect(csvText).toContain(tenantA.memberName);
  });

  it("修正申請: Bの申請IDへの承認・却下・取り下げは404、?userId=<B>も404", async () => {
    const { app, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    for (const action of ["approve", "reject", "withdraw"]) {
      const res = await app.request(`/corrections/${data.correctionId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminACookie },
        body: JSON.stringify({}),
      });
      await expectNoTenantBLeak(res, forbidden, `POST /corrections/:id/${action}`);
    }

    const list = await app.request(`/corrections?userId=${tenantB.memberId}&status=all`, {
      headers: { cookie: adminACookie },
    });
    await expectNoTenantBLeak(list, forbidden, "GET /corrections?userId=<B>");

    const own = await app.request("/corrections?status=all", { headers: { cookie: adminACookie } });
    await expectListWithoutTenantB(own, forbidden, "GET /corrections(自テナント一覧)");
  });

  it("休暇申請・残高・付与予告: BのIDはすべて404、一覧にもBは出てこない", async () => {
    const { app, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    for (const action of ["approve", "reject", "withdraw"]) {
      const res = await app.request(`/leave/requests/${data.leaveRequestId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminACookie },
        body: JSON.stringify({}),
      });
      await expectNoTenantBLeak(res, forbidden, `POST /leave/requests/:id/${action}`);
    }

    const list = await app.request(`/leave/requests?userId=${tenantB.memberId}&status=all`, {
      headers: { cookie: adminACookie },
    });
    await expectNoTenantBLeak(list, forbidden, "GET /leave/requests?userId=<B>");

    const balance = await app.request(`/leave/balance?userId=${tenantB.memberId}`, { headers: { cookie: adminACookie } });
    await expectNoTenantBLeak(balance, forbidden, "GET /leave/balance?userId=<B>");

    for (const action of ["approve", "reject"]) {
      const res = await app.request(`/leave/grant-proposals/${data.proposalId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminACookie },
        body: JSON.stringify({}),
      });
      await expectNoTenantBLeak(res, forbidden, `POST /leave/grant-proposals/:id/${action}`);
    }

    const proposals = await app.request("/leave/grant-proposals?status=all", { headers: { cookie: adminACookie } });
    await expectListWithoutTenantB(proposals, forbidden, "GET /leave/grant-proposals");

    // 付与(POST /leave/grants・/grants/auto)の宛先に B のユーザーを指定できない
    const grant = await app.request("/leave/grants", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ userId: tenantB.memberId, grantedOn: "2026-04-01", days: 5 }),
    });
    await expectNoTenantBLeak(grant, forbidden, "POST /leave/grants(userId=<B>)");

    const autoGrant = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ userId: tenantB.memberId }),
    });
    await expectNoTenantBLeak(autoGrant, forbidden, "POST /leave/grants/auto(userId=<B>)");
  });

  it("休憩自動控除の打ち消し申請: Bの申請IDは404、?userId=<B>も404", async () => {
    const { app, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    for (const action of ["approve", "reject", "withdraw"]) {
      const res = await app.request(`/auto-break-waivers/${data.waiverId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminACookie },
        body: JSON.stringify({}),
      });
      await expectNoTenantBLeak(res, forbidden, `POST /auto-break-waivers/:id/${action}`);
    }

    const list = await app.request(`/auto-break-waivers?userId=${tenantB.memberId}&status=all`, {
      headers: { cookie: adminACookie },
    });
    await expectNoTenantBLeak(list, forbidden, "GET /auto-break-waivers?userId=<B>");
  });

  it("メンバー管理: 一覧にBは出ず、Bのユーザーへの更新・招待・パスワードリセットは404", async () => {
    const { app, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    const list = await app.request("/members", { headers: { cookie: adminACookie } });
    await expectListWithoutTenantB(list, forbidden, "GET /members");

    const patch = await app.request(`/members/${tenantB.memberId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ hireDate: "2020-04-01" }),
    });
    await expectNoTenantBLeak(patch, forbidden, "PATCH /members/<B>");

    const presets = await app.request(`/members/${tenantB.memberId}/presets`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ presetIds: [] }),
    });
    await expectNoTenantBLeak(presets, forbidden, "PUT /members/<B>/presets");

    const invite = await app.request(`/members/${tenantB.memberId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({}),
    });
    await expectNoTenantBLeak(invite, forbidden, "POST /members/<B>/invitations");

    const reset = await app.request(`/members/${tenantB.memberId}/password-resets`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({}),
    });
    await expectNoTenantBLeak(reset, forbidden, "POST /members/<B>/password-resets");

    const deactivate = await app.request(`/members/${tenantB.memberId}/deactivate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({}),
    });
    await expectNoTenantBLeak(deactivate, forbidden, "POST /members/<B>/deactivate");

    const workPolicy = await app.request(`/members/${tenantB.memberId}/work-policy`, { headers: { cookie: adminACookie } });
    await expectNoTenantBLeak(workPolicy, forbidden, "GET /members/<B>/work-policy");
  });

  it("権限プリセット: Bのプリセットは参照・更新・削除も割当もできない", async () => {
    const { app, tenantA, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);
    const targetPresetId = data.presetIds[0] as string;

    const list = await app.request("/presets", { headers: { cookie: adminACookie } });
    const text = await expectListWithoutTenantB(list, forbidden, "GET /presets");
    for (const presetId of data.presetIds) {
      expect(text, `GET /presets leaked ${presetId}`).not.toContain(presetId);
    }

    const patch = await app.request(`/presets/${targetPresetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ name: "乗っ取り" }),
    });
    await expectNoTenantBLeak(patch, forbidden, "PATCH /presets/<B>");

    const del = await app.request(`/presets/${targetPresetId}`, { method: "DELETE", headers: { cookie: adminACookie } });
    await expectNoTenantBLeak(del, forbidden, "DELETE /presets/<B>");

    // A のメンバーに B のプリセットを割り当てようとしても 400(invalid_preset_id)
    const assign = await app.request(`/members/${tenantA.memberId}/presets`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ presetIds: [targetPresetId] }),
    });
    expect(assign.status).toBe(400);
    expect(await assign.json()).toEqual({ error: "invalid_preset_id" });
  });

  it("部署: Bの部署は一覧に出ず、更新・削除・所属先としての指定もできない", async () => {
    const { app, tenantA, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    const list = await app.request("/departments", { headers: { cookie: adminACookie } });
    const text = await expectListWithoutTenantB(list, forbidden, "GET /departments");
    expect(text).not.toContain("Bravo営業部");

    const patch = await app.request(`/departments/${data.departmentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ name: "乗っ取り" }),
    });
    await expectNoTenantBLeak(patch, forbidden, "PATCH /departments/<B>");

    const del = await app.request(`/departments/${data.departmentId}`, {
      method: "DELETE",
      headers: { cookie: adminACookie },
    });
    await expectNoTenantBLeak(del, forbidden, "DELETE /departments/<B>");

    // A のメンバーの所属先に B の部署を指定できない(400)
    const patchMember = await app.request(`/members/${tenantA.memberId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ departmentId: data.departmentId }),
    });
    expect(patchMember.status).toBe(400);
    expect(await patchMember.json()).toEqual({ error: "invalid_department_id" });
  });

  it("シフト: Bのユーザー宛の計画作成・Bの計画IDの参照/編集/確定はすべて404(リグレッション)", async () => {
    const { db, app, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    // リグレッション: 以前はこれが 201 になり、tenant_id=A / user_id=B のシフト計画が作られていた
    const create = await app.request("/shifts/plans", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ userId: tenantB.memberId, periodStart: "2026-05-01" }),
    });
    await expectNoTenantBLeak(create, forbidden, "POST /shifts/plans(userId=<B>)");

    // 実際に行が作られていないことまで確認する(レスポンスだけでは追随しきれないため)
    const plans = await db.select().from(shiftPlans);
    expect(plans.filter((p) => p.userId === tenantB.memberId).map((p) => p.tenantId)).toEqual([tenantB.tenantId]);

    const listPlans = await app.request(`/shifts/plans?userId=${tenantB.memberId}`, { headers: { cookie: adminACookie } });
    await expectNoTenantBLeak(listPlans, forbidden, "GET /shifts/plans?userId=<B>");

    const history = await app.request(`/shifts/plans/${data.shiftPlanId}/history`, { headers: { cookie: adminACookie } });
    await expectNoTenantBLeak(history, forbidden, "GET /shifts/plans/<B>/history");

    const days = await app.request(`/shifts/plans/${data.shiftPlanId}/days`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ days: [{ date: "2026-04-02", dayType: "non_working" }] }),
    });
    await expectNoTenantBLeak(days, forbidden, "PUT /shifts/plans/<B>/days");

    const publish = await app.request(`/shifts/plans/${data.shiftPlanId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({}),
    });
    await expectNoTenantBLeak(publish, forbidden, "POST /shifts/plans/<B>/publish");
  });

  it("APIキー: Bのユーザー宛に発行できず、Bのキーの一覧・失効もできない(リグレッション)", async () => {
    const { db, app, tenantA, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    // リグレッション: 以前はこれが 201 になり、tenant_id=A / user_id=B のAPIキー行が作られていた
    const create = await app.request("/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ name: "乗っ取りキー", scopes: ["punch"], userId: tenantB.memberId }),
    });
    await expectNoTenantBLeak(create, forbidden, "POST /api-keys(userId=<B>)");

    const keyRows = await db.select().from(apiKeys);
    expect(keyRows.filter((r) => r.userId === tenantB.memberId).map((r) => r.tenantId)).toEqual([tenantB.tenantId]);

    const list = await app.request(`/api-keys?userId=${tenantB.memberId}`, { headers: { cookie: adminACookie } });
    await expectNoTenantBLeak(list, forbidden, "GET /api-keys?userId=<B>");

    const revoke = await app.request(`/api-keys/${data.apiKeyId}`, { method: "DELETE", headers: { cookie: adminACookie } });
    await expectNoTenantBLeak(revoke, forbidden, "DELETE /api-keys/<B>");

    // A で発行したキーでの打刻は必ず A のユーザーの打刻になる(B のユーザーの打刻にはならない)
    const issued = await app.request("/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ name: "Aのキー", scopes: ["punch"], userId: tenantA.memberId }),
    });
    expect(issued.status).toBe(201);
    const token = ((await issued.json()) as { apiKey: { token: string } }).apiKey.token;

    const punch = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "clock_in" }),
    });
    expect(punch.status).toBe(201);
    const punchId = ((await punch.json()) as { punch: { id: string } }).punch.id;
    const stored = await db.select().from(punchEvents);
    const row = stored.find((p) => p.id === punchId);
    expect(row?.tenantId).toBe(tenantA.tenantId);
    expect(row?.userId).toBe(tenantA.memberId);
  });

  it("通知: Bの通知は一覧に出ず、既読化もできない", async () => {
    const { app, tenantB, memberACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    const list = await app.request("/notifications", { headers: { cookie: memberACookie } });
    const text = await expectListWithoutTenantB(list, forbidden, "GET /notifications");
    expect(text).not.toContain("Bの通知タイトル");

    const read = await app.request(`/notifications/${data.notificationId}/read`, {
      method: "POST",
      headers: { cookie: memberACookie },
    });
    await expectNoTenantBLeak(read, forbidden, "POST /notifications/<B>/read");
  });

  it("監査ログ: Bのイベントは一覧にもフィルタ指定でも出てこない", async () => {
    const { app, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    const list = await app.request("/audit-logs?limit=100", { headers: { cookie: adminACookie } });
    await expectListWithoutTenantB(list, forbidden, "GET /audit-logs");

    // B の actorId / targetId を明示指定しても素通りしない(0件のまま)
    const filtered = await app.request(`/audit-logs?actorId=${tenantB.adminId}&limit=100`, {
      headers: { cookie: adminACookie },
    });
    const filteredText = await expectListWithoutTenantB(filtered, forbidden, "GET /audit-logs?actorId=<B>");
    expect(JSON.parse(filteredText).logs).toEqual([]);
  });

  it("月次締め: Bで締めてもAの同じ月は開いたまま(締めの状態が混ざらない)", async () => {
    const { app, tenantB, adminACookie, adminBCookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    const closeB = await app.request("/closings/2026-03/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminBCookie },
      body: JSON.stringify({}),
    });
    expect(closeB.status).toBe(200);

    const stateA = await app.request("/closings/2026-03", { headers: { cookie: adminACookie } });
    expect(stateA.status).toBe(200);
    const bodyA = (await stateA.json()) as { closing: { status: string } };
    expect(bodyA.closing.status).toBe("open");

    const listA = await app.request("/closings?from=2026-01&to=2026-12", { headers: { cookie: adminACookie } });
    const listText = await expectListWithoutTenantB(listA, forbidden, "GET /closings");
    const closingsA = (JSON.parse(listText) as { closings: Array<{ period: string; status: string }> }).closings;
    expect(closingsA.filter((s) => s.status === "closed")).toEqual([]);

    // A で同じ月に打刻できる(B の締めが A をロックしていない)
    const punch = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminACookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: jstMinutes(2026, 3, 10, 9, 0) }),
    });
    expect(punch.status).toBe(201);
  });

  it("設定: Bのテナント設定・社名はAからは見えない", async () => {
    const { app, tenantB, adminACookie, data } = await setupTwoTenants();
    const forbidden = tenantBIdentifiers(tenantB, data);

    const me = await app.request("/me", { headers: { cookie: adminACookie } });
    const meText = await expectListWithoutTenantB(me, forbidden, "GET /me");
    expect(meText).toContain("Alpha 株式会社");
    expect(meText).not.toContain("Bravo 株式会社");

    const profile = await app.request("/settings/tenant-profile", { headers: { cookie: adminACookie } });
    const profileText = await expectListWithoutTenantB(profile, forbidden, "GET /settings/tenant-profile");
    expect(profileText).not.toContain("Bravo 株式会社");
  });
});

describe("複数テナントに同じメールがある場合のログイン(テナント選択)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("招待受諾で2社目に同じメールを作ると、以後のログインは 409 multiple_tenants → tenantId 指定で入れる", async () => {
    const db = await createTestDatabase();
    const app = createApp({ db });

    const tenantA = await setupTenant(db, "alpha", "Alpha 株式会社");
    const tenantB = await setupTenant(db, "bravo", "Bravo 株式会社");
    const adminBCookie = await loginAndGetCookie(app, tenantB.adminEmail, PASSWORD);

    // 顧問社労士のケース: A に居るメンバーと同じメールを B にも招待する
    const sharedEmail = tenantA.memberEmail;
    const inviteRes = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminBCookie },
      body: JSON.stringify({ email: sharedEmail, name: "顧問社労士" }),
    });
    expect(inviteRes.status).toBe(201);
    const invited = (await inviteRes.json()) as { member: { id: string }; invitation: { token: string } };
    const sharedUserId = invited.member.id;

    const sharedPassword = "shared account password!!";
    const accept = await app.request(`/invitations/${invited.invitation.token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: sharedPassword }),
    });
    expect(accept.status).toBe(200);
    // 受諾直後のセッションは受諾したテナント(B)のもの
    const acceptedCookie = extractCookie(accept);
    const meAfterAccept = await app.request("/me", { headers: { cookie: acceptedCookie } });
    expect(((await meAfterAccept.json()) as { user: { tenantId: string } }).user.tenantId).toBe(tenantB.tenantId);

    // パスワードが違えば一致するのは1テナントだけ → 選択は挟まらない
    const singleMatch = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: sharedEmail, password: PASSWORD }),
    });
    expect(singleMatch.status).toBe(200);
    const meA = await app.request("/me", { headers: { cookie: extractCookie(singleMatch) } });
    expect(((await meA.json()) as { user: { tenantId: string } }).user.tenantId).toBe(tenantA.tenantId);

    // 両テナントのパスワードを揃えると、テナント選択(409)になる
    await db
      .update(authCredentials)
      .set({ passwordHash: await hashPassword(PASSWORD) })
      .where(eq(authCredentials.userId, sharedUserId));

    const multi = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: sharedEmail, password: PASSWORD }),
    });
    expect(multi.status).toBe(409);
    const multiBody = (await multi.json()) as { error: string; tenants: Array<{ id: string; name: string | null }> };
    expect(multiBody.error).toBe("multiple_tenants");
    expect(multiBody.tenants.map((t) => t.id).sort()).toEqual([tenantA.tenantId, tenantB.tenantId].sort());
    expect(multiBody.tenants.map((t) => t.name).sort()).toEqual(["Alpha 株式会社", "Bravo 株式会社"]);

    // tenantId を指定すればそのテナントのセッションになる
    for (const tenant of [tenantA, tenantB]) {
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: sharedEmail, password: PASSWORD, tenantId: tenant.tenantId }),
      });
      expect(res.status).toBe(200);
      const me = await app.request("/me", { headers: { cookie: extractCookie(res) } });
      expect(((await me.json()) as { user: { tenantId: string } }).user.tenantId).toBe(tenant.tenantId);
    }
  });
});
