/**
 * 多段承認(二段承認)の統合テスト。仕様の正: docs/design/approval-flows.md
 *
 * 対象は3種別すべて(打刻修正 / 休暇 / 休憩自動控除の打ち消し)。検証の柱は:
 * - 既定(単段)の挙動が一切変わらないこと(回帰) — 既存の corrections.test.ts /
 *   leave-requests.test.ts / auto-break-waivers.test.ts が本体だが、ここでも
 *   「設定を触らなければ1回の承認で反映される」ことを種別ごとに1本ずつ押さえる
 * - 二段では**一次承認の時点で何も反映されない**こと(打刻が supersede されない・
 *   承認済み休暇が増えない・自動控除の打ち消し日が増えない)
 * - 一次と二次を同じ人ができないこと / 二次は tenant スコープの承認権限が要ること
 * - どちらの段でも却下でき、最終承認までは取り下げられること
 * - 設定変更が仕掛かり中の申請に影響しないこと(グランドファザリング)
 * - 一次承認で二次承認者候補へ通知が飛ぶこと(通知は全てモック・実送信しない)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAllApprovedLeaveRequests,
  listApprovedWaiverDatesInRange,
  listAuditLogs,
  listNotifications,
  listValidPunches,
  insertLeaveGrant,
  upsertApprovalFlowSettings,
  upsertMembership,
  createDepartment,
  uuidv7,
  userPolicyAssignments,
  workPolicies,
  workPolicyVersions,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupExtraUser, setupTestDb } from "./support/setup.js";

/** テスト対象期間(2026-04)の内側、日界・月境界から十分離れた安全な時刻に固定する。 */
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

interface RequestJson {
  id: string;
  status: string;
  requiredSteps: number;
  currentStep: number | null;
  step1DecidedBy: string | null;
  step1DecidedAt: number | null;
  decidedBy: string | null;
}

const CORRECTION_APPROVE = "attendance.correction.approve";
const LEAVE_APPROVE = "leave.request.approve";

/** 段数設定を直接書き込む(設定 API 自体のテストは別 describe で行う)。 */
async function setSteps(
  db: Database,
  params: { tenantId: string; userId: string; correction?: number; leave?: number; waiver?: number },
): Promise<void> {
  await upsertApprovalFlowSettings(db, {
    tenantId: params.tenantId,
    correctionSteps: params.correction ?? 1,
    leaveSteps: params.leave ?? 1,
    autoBreakWaiverSteps: params.waiver ?? 1,
    updatedAt: 0,
    updatedBy: params.userId,
  });
}

/**
 * ログインできる追加ユーザーを作り、指定の権限・スコープを与える。
 * work_policy は割り当てない(承認する側は自分の勤怠集計を使わないため)。
 */
async function createApprover(
  db: Database,
  params: { tenantId: string; label: string; permission: string; scope: string; departmentId?: string },
): Promise<{ userId: string; email: string; password: string }> {
  const user = await setupExtraUser(db, {
    tenantId: params.tenantId,
    email: `${params.label}-${uuidv7()}@example.com`,
    name: `Approver ${params.label}`,
  });
  await grantPermission(db, { tenantId: params.tenantId, userId: user.userId, permission: params.permission, scope: params.scope });
  if (params.departmentId !== undefined) {
    await upsertMembership(db, { tenantId: params.tenantId, userId: user.userId, departmentId: params.departmentId, createdAt: 0 });
  }
  return user;
}

/**
 * 二段承認のテストで使う最小の組織を組み立てる。
 *
 * 一次承認者は department スコープなので、apps/api/src/lib/scope.ts の解決上
 * **申請者と同じ部署に所属していないと申請対象がスコープ外**になる(403)。
 * 各テストで毎回この結線を書くと本題が埋もれるため、ここにまとめる。
 * 二次承認者(tenant スコープ)は所属を問わないため部署に入れない。
 */
async function setupTwoStepOrg(
  db: Database,
  params: { tenantId: string; requesterUserId: string; permission: string },
): Promise<{
  departmentId: string;
  dept: { userId: string; email: string; password: string };
  hq: { userId: string; email: string; password: string };
}> {
  const department = await createDepartment(db, { id: uuidv7(), tenantId: params.tenantId, name: "部署A", parentId: null, createdAt: 0 });
  await upsertMembership(db, { tenantId: params.tenantId, userId: params.requesterUserId, departmentId: department.id, createdAt: 0 });
  const dept = await createApprover(db, {
    tenantId: params.tenantId,
    label: "dept",
    permission: params.permission,
    scope: "department",
    departmentId: department.id,
  });
  const hq = await createApprover(db, { tenantId: params.tenantId, label: "hq", permission: params.permission, scope: "tenant" });
  return { departmentId: department.id, dept, hq };
}

/** 休暇の残高計算は標準労働時間の解決に work policy を要求するため、追加ユーザーにも割り当てる。 */
async function assignWorkPolicy(db: Database, params: { tenantId: string; userId: string }): Promise<void> {
  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId: params.tenantId, name: "Flex", createdAt: 0 });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    settlementPeriod: "monthly",
    core: null,
    standardDayMinutes: 480,
    createdAt: 0,
  });
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    userId: params.userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: 0,
  });
}

interface AppLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

function post(app: AppLike, path: string, cookie: string, body: unknown = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

/** 打刻修正申請(退勤打刻の追加)を1件作る。 */
async function createCorrection(app: AppLike, cookie: string, occurredAt: number) {
  const res = await post(app, "/corrections", cookie, {
    proposedKind: "clock_out",
    proposedOccurredAt: occurredAt,
    reason: "退勤打刻を忘れた",
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { request: RequestJson }).request;
}

describe("approval flow settings API (GET/PUT /settings/approval-flow)", () => {
  it("defaults to single step for every kind and requires approval_flow.manage", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const forbidden = await app.request("/settings/approval-flow", { headers: { cookie } });
    expect(forbidden.status).toBe(403);

    await grantPermission(db, { tenantId, userId, permission: "approval_flow.manage", scope: "tenant" });
    const app2 = createApp({ db });
    const cookie2 = await loginAndGetCookie(app2, email, password);
    const res = await app2.request("/settings/approval-flow", { headers: { cookie: cookie2 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      correctionSteps: 1,
      leaveSteps: 1,
      autoBreakWaiverSteps: 1,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("PUT validates each kind and stores the new step counts", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "approval_flow.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const bad = await app.request("/settings/approval-flow", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ correctionSteps: 3, leaveSteps: 1, autoBreakWaiverSteps: 1 }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_correction_steps" });

    const ok = await app.request("/settings/approval-flow", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ correctionSteps: 2, leaveSteps: 2, autoBreakWaiverSteps: 1 }),
    });
    expect(ok.status).toBe(200);
    const saved = (await ok.json()) as { correctionSteps: number; leaveSteps: number; autoBreakWaiverSteps: number };
    expect(saved.correctionSteps).toBe(2);
    expect(saved.leaveSteps).toBe(2);
    expect(saved.autoBreakWaiverSteps).toBe(1);

    // 承認の厳しさを変える操作なので、変更前後の両方が監査ログに残る。
    const logs = await listAuditLogs(db, { tenantId, action: "approval_flow_settings.update", limit: 10 });
    expect(logs).toHaveLength(1);
    // 監査ログの detail は DB 上 after_digest 列に入る(queries/audit.ts の insertAuditLog 参照)。
    const detail = JSON.parse(logs[0]?.afterDigest ?? "{}") as {
      before: { correctionSteps: number };
      after: { correctionSteps: number; leaveSteps: number };
    };
    expect(detail.before.correctionSteps).toBe(1);
    expect(detail.after.correctionSteps).toBe(2);
    expect(detail.after.leaveSteps).toBe(2);
  });
});

describe("corrections: single step (regression) and two step", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("single step (default): one approval applies the punch, exactly as before", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CORRECTION_APPROVE, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));
    expect(created.requiredSteps).toBe(1);
    expect(created.currentStep).toBe(1);

    const res = await post(app, `/corrections/${created.id}/approve`, cookie);
    expect(res.status).toBe(200);
    const approved = ((await res.json()) as { request: RequestJson }).request;
    expect(approved.status).toBe("approved");
    expect(approved.currentStep).toBeNull();

    const punches = await listValidPunches(db, {
      tenantId,
      userId,
      fromMinutes: jstMinutes(2026, 4, 1, 0, 0),
      toMinutes: jstMinutes(2026, 4, 2, 0, 0),
    });
    expect(punches).toHaveLength(1);
  });

  it("two step: the punch is applied only after the second approval", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const { dept, hq } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));
    expect(created.requiredSteps).toBe(2);

    // ---- 一次承認: 反映されない ----
    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    const step1 = await post(app, `/corrections/${created.id}/approve`, deptCookie);
    expect(step1.status).toBe(200);
    const afterStep1 = ((await step1.json()) as { request: RequestJson; appliedEvent: unknown }).request;
    expect(afterStep1.status).toBe("approved_step1");
    expect(afterStep1.currentStep).toBe(2);
    expect(afterStep1.step1DecidedBy).toBe(dept.userId);
    // 最終決裁の欄は空のまま(一次承認者を決裁者と取り違えないため)。
    expect(afterStep1.decidedBy).toBeNull();

    const range = { tenantId, userId, fromMinutes: jstMinutes(2026, 4, 1, 0, 0), toMinutes: jstMinutes(2026, 4, 2, 0, 0) };
    expect(await listValidPunches(db, range)).toHaveLength(0);

    // ---- 二次承認: ここで初めて反映 ----
    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    const step2 = await post(app, `/corrections/${created.id}/approve`, hqCookie);
    expect(step2.status).toBe(200);
    const afterStep2 = ((await step2.json()) as { request: RequestJson }).request;
    expect(afterStep2.status).toBe("approved");
    expect(afterStep2.currentStep).toBeNull();
    expect(afterStep2.decidedBy).toBe(hq.userId);
    expect(afterStep2.step1DecidedBy).toBe(dept.userId);

    expect(await listValidPunches(db, range)).toHaveLength(1);
  });

  it("the same person cannot perform both steps (409 same_approver_as_step1)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const hq = await createApprover(db, { tenantId, label: "hq", permission: CORRECTION_APPROVE, scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));

    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    expect((await post(app, `/corrections/${created.id}/approve`, hqCookie)).status).toBe(200);

    const second = await post(app, `/corrections/${created.id}/approve`, hqCookie);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "same_approver_as_step1" });
  });

  it("a department-scoped approver cannot perform the second step (403)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const { departmentId, dept: deptA } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });
    const deptB = await createApprover(db, {
      tenantId,
      label: "deptB",
      permission: CORRECTION_APPROVE,
      scope: "department",
      departmentId,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));

    const aCookie = await loginAndGetCookie(app, deptA.email, deptA.password);
    expect((await post(app, `/corrections/${created.id}/approve`, aCookie)).status).toBe(200);

    // 別人ではあるが department スコープしか持たない → 二次承認はできない。
    const bCookie = await loginAndGetCookie(app, deptB.email, deptB.password);
    const res = await post(app, `/corrections/${created.id}/approve`, bCookie);
    expect(res.status).toBe(403);
  });

  it("the requester cannot approve their own request without the approve permission (unchanged rule)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));

    // 申請者は承認権限を持たない(セルフサービス権限のみ)。
    const res = await post(app, `/corrections/${created.id}/approve`, cookie);
    expect(res.status).toBe(403);
  });

  it("rejects at the first step, and at the second step (recording which step in the audit log)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const { dept, hq } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });
    await grantPermission(db, { tenantId, userId: hq.userId, permission: "audit_log.view", scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);

    // (a) 一次段での却下
    const first = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));
    const rejected1 = await post(app, `/corrections/${first.id}/reject`, deptCookie, { note: "内容が不足" });
    expect(rejected1.status).toBe(200);
    expect(((await rejected1.json()) as { request: RequestJson }).request.status).toBe("rejected");

    // (b) 二次段での却下(一次承認済みからでも差し戻せる)
    const second = await createCorrection(app, cookie, jstMinutes(2026, 4, 2, 18, 0));
    expect((await post(app, `/corrections/${second.id}/approve`, deptCookie)).status).toBe(200);
    const rejected2 = await post(app, `/corrections/${second.id}/reject`, hqCookie, { note: "本部判断で却下" });
    expect(rejected2.status).toBe(200);
    expect(((await rejected2.json()) as { request: RequestJson }).request.status).toBe("rejected");

    const logsRes = await app.request("/audit-logs?action=correction.reject", { headers: { cookie: hqCookie } });
    expect(logsRes.status).toBe(200);
    const logs = (await logsRes.json()) as { logs: { action: string; detail: string | null }[] };
    const steps = logs.logs
      .filter((l) => l.action === "correction.reject")
      .map((l) => (JSON.parse(l.detail ?? "{}") as { step?: number }).step)
      .sort();
    expect(steps).toEqual([1, 2]);
  });

  it("a department-scoped approver cannot reject a request that already passed the first step (403)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const { departmentId, dept: deptA } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });
    const deptB = await createApprover(db, {
      tenantId,
      label: "deptB",
      permission: CORRECTION_APPROVE,
      scope: "department",
      departmentId,
    });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));

    const aCookie = await loginAndGetCookie(app, deptA.email, deptA.password);
    expect((await post(app, `/corrections/${created.id}/approve`, aCookie)).status).toBe(200);

    const bCookie = await loginAndGetCookie(app, deptB.email, deptB.password);
    expect((await post(app, `/corrections/${created.id}/reject`, bCookie)).status).toBe(403);
  });

  it("the requester can withdraw until the final approval (including after the first step)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const { dept } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));

    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    expect((await post(app, `/corrections/${created.id}/approve`, deptCookie)).status).toBe(200);

    const withdrawn = await post(app, `/corrections/${created.id}/withdraw`, cookie);
    expect(withdrawn.status).toBe(200);
    expect(((await withdrawn.json()) as { request: RequestJson }).request.status).toBe("withdrawn");

    // 取り下げ後は二次承認できない。
    const hq = await createApprover(db, { tenantId, label: "hq", permission: CORRECTION_APPROVE, scope: "tenant" });
    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    const late = await post(app, `/corrections/${created.id}/approve`, hqCookie);
    expect(late.status).toBe(409);
  });

  it("GET /corrections?status=pending includes requests waiting for the second step", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const { dept } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));
    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    expect((await post(app, `/corrections/${created.id}/approve`, deptCookie)).status).toBe(200);

    const res = await app.request("/corrections", { headers: { cookie } });
    expect(res.status).toBe(200);
    const listed = (await res.json()) as { requests: RequestJson[] };
    expect(listed.requests.map((r) => r.status)).toEqual(["approved_step1"]);
    expect(listed.requests[0]?.currentStep).toBe(2);
  });
});

describe("grandfathering: the step count is frozen when the request is created", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a request created while single-step stays single-step after the setting is raised to 2", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CORRECTION_APPROVE, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));
    expect(created.requiredSteps).toBe(1);

    // 申請が出た後にテナントが二段承認へ切り替える。
    await setSteps(db, { tenantId, userId, correction: 2 });

    const res = await post(app, `/corrections/${created.id}/approve`, cookie);
    expect(res.status).toBe(200);
    // 作成時の段数(1)で確定する — 途中で「二次承認待ち」に化けない。
    expect(((await res.json()) as { request: RequestJson }).request.status).toBe("approved");
  });

  it("a request created while two-step still needs two approvals after the setting is lowered to 1", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });
    const { dept, hq } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));
    expect(created.requiredSteps).toBe(2);

    // 申請が出た後にテナントが単段へ戻す。
    await setSteps(db, { tenantId, userId, correction: 1 });

    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    const step1 = await post(app, `/corrections/${created.id}/approve`, deptCookie);
    expect(((await step1.json()) as { request: RequestJson }).request.status).toBe("approved_step1");

    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    const step2 = await post(app, `/corrections/${created.id}/approve`, hqCookie);
    expect(((await step2.json()) as { request: RequestJson }).request.status).toBe("approved");
  });
});

describe("leave requests: two step", () => {
  it("the leave is counted as taken only after the second approval", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, leave: 2 });
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

    const { dept, hq } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: LEAVE_APPROVE });
    await assignWorkPolicy(db, { tenantId, userId: dept.userId });
    await assignWorkPolicy(db, { tenantId, userId: hq.userId });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const createRes = await post(app, "/leave/requests", cookie, { leaveDate: "2026-04-20", reason: "私用" });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: RequestJson }).request;
    expect(created.requiredSteps).toBe(2);

    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    const step1 = await post(app, `/leave/requests/${created.id}/approve`, deptCookie);
    expect(step1.status).toBe(200);
    expect(((await step1.json()) as { request: RequestJson }).request.status).toBe("approved_step1");
    // 残高・集計の入力は status='approved' の申請だけ。一次承認では増えない。
    expect(await listAllApprovedLeaveRequests(db, { tenantId, userId })).toHaveLength(0);

    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    const step2 = await post(app, `/leave/requests/${created.id}/approve`, hqCookie);
    expect(step2.status).toBe(200);
    expect(((await step2.json()) as { request: RequestJson }).request.status).toBe("approved");
    expect(await listAllApprovedLeaveRequests(db, { tenantId, userId })).toHaveLength(1);
  });

  it("the same person cannot perform both steps", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, leave: 2 });
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
    const hq = await createApprover(db, { tenantId, label: "hq", permission: LEAVE_APPROVE, scope: "tenant" });
    await assignWorkPolicy(db, { tenantId, userId: hq.userId });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = ((await (await post(app, "/leave/requests", cookie, { leaveDate: "2026-04-21", reason: "私用" })).json()) as {
      request: RequestJson;
    }).request;

    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    expect((await post(app, `/leave/requests/${created.id}/approve`, hqCookie)).status).toBe(200);
    const again = await post(app, `/leave/requests/${created.id}/approve`, hqCookie);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "same_approver_as_step1" });
  });
});

describe("auto break waivers: two step", () => {
  it("the waived date takes effect only after the second approval", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, waiver: 2 });
    const { dept, hq } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const createRes = await post(app, "/auto-break-waivers", cookie, { waiveDate: "2026-04-10", reason: "休憩を取れなかった" });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { waiver: RequestJson }).waiver;
    expect(created.requiredSteps).toBe(2);

    const inRange = () => listApprovedWaiverDatesInRange(db, { tenantId, userId, fromDate: "2026-04-01", toDate: "2026-04-30" });

    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    const step1 = await post(app, `/auto-break-waivers/${created.id}/approve`, deptCookie);
    expect(step1.status).toBe(200);
    expect(((await step1.json()) as { waiver: RequestJson }).waiver.status).toBe("approved_step1");
    // 集計エンジンへ渡る打ち消し日は status='approved' のみ。一次承認では増えない。
    expect(await inRange()).toEqual([]);

    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    const step2 = await post(app, `/auto-break-waivers/${created.id}/approve`, hqCookie);
    expect(step2.status).toBe(200);
    expect(((await step2.json()) as { waiver: RequestJson }).waiver.status).toBe("approved");
    expect(await inRange()).toEqual(["2026-04-10"]);
  });

  it("the requester can withdraw after the first step", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, waiver: 2 });
    const { dept } = await setupTwoStepOrg(db, { tenantId, requesterUserId: userId, permission: CORRECTION_APPROVE });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = ((await (
      await post(app, "/auto-break-waivers", cookie, { waiveDate: "2026-04-11", reason: "休憩を取れなかった" })
    ).json()) as { waiver: RequestJson }).waiver;

    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    expect((await post(app, `/auto-break-waivers/${created.id}/approve`, deptCookie)).status).toBe(200);

    const withdrawn = await post(app, `/auto-break-waivers/${created.id}/withdraw`, cookie);
    expect(withdrawn.status).toBe(200);
    expect(((await withdrawn.json()) as { waiver: RequestJson }).waiver.status).toBe("withdrawn");
  });
});

describe("second-step approval request notifications (all mocked, nothing is really sent)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies tenant-scope approvers on the first approval, and never the approver who just acted", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setSteps(db, { tenantId, userId, correction: 2 });

    // 二次承認者候補が複数いる場合に全員へ届くことを見たいので、hq は fixture ではなく個別に2人作る。
    const department = await createDepartment(db, { id: uuidv7(), tenantId, name: "部署A", parentId: null, createdAt: 0 });
    await upsertMembership(db, { tenantId, userId, departmentId: department.id, createdAt: 0 });
    const dept = await createApprover(db, {
      tenantId,
      label: "dept",
      permission: CORRECTION_APPROVE,
      scope: "department",
      departmentId: department.id,
    });
    const hq1 = await createApprover(db, { tenantId, label: "hq1", permission: CORRECTION_APPROVE, scope: "tenant" });
    const hq2 = await createApprover(db, { tenantId, label: "hq2", permission: CORRECTION_APPROVE, scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));

    const deptCookie = await loginAndGetCookie(app, dept.email, dept.password);
    expect((await post(app, `/corrections/${created.id}/approve`, deptCookie)).status).toBe(200);

    const step2Type = "approval_request_correction_step2";
    for (const hq of [hq1, hq2]) {
      const notifications = await listNotifications(db, { tenantId, userId: hq.userId });
      expect(notifications.filter((n) => n.type === step2Type)).toHaveLength(1);
    }

    // 一次承認を行った本人には二次承認の依頼を送らない(既に決裁に関与しているため)。
    const deptNotifications = await listNotifications(db, { tenantId, userId: dept.userId });
    expect(deptNotifications.filter((n) => n.type === step2Type)).toHaveLength(0);

    // 申請者本人にも送らない(自分の申請の承認依頼は自分には来ない、という既存の方針どおり)。
    const ownNotifications = await listNotifications(db, { tenantId, userId });
    expect(ownNotifications.filter((n) => n.type === step2Type)).toHaveLength(0);
  });

  it("does not send a second-step request notification for a single-step request", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const hq = await createApprover(db, { tenantId, label: "hq", permission: CORRECTION_APPROVE, scope: "tenant" });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const created = await createCorrection(app, cookie, jstMinutes(2026, 4, 1, 18, 0));

    const hqCookie = await loginAndGetCookie(app, hq.email, hq.password);
    expect((await post(app, `/corrections/${created.id}/approve`, hqCookie)).status).toBe(200);

    const notifications = await listNotifications(db, { tenantId, userId: hq.userId });
    expect(notifications.filter((n) => n.type === "approval_request_correction_step2")).toHaveLength(0);
  });
});
