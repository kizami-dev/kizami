/**
 * 有給付与の3段フロー(予告 → 管理者承認 → 本人通知、v0.7 フェーズ4、Part B)。
 *
 * 通知は必ずモック(fetchImpl)を通す — 実送信は行わない。
 */

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  insertLeaveGrant,
  insertShiftPlan,
  listLeaveGrantProposals,
  listNotifications,
  upsertNotificationSettings,
  upsertShiftDaysForPlan,
  users,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { runLeaveGrantProposalScan } from "../src/leave-grant-proposals.js";
import {
  grantPermission,
  loginAndGetCookie,
  setupExtraUser,
  setupSecondUser,
  setupTestDb,
  setVariablePeriodStartDay,
  switchToMonthlyVariableWorkPolicy,
} from "./support/setup.js";

// JST 2026-04-15 12:00。入社日 2025-10-01 の初回付与(6ヶ月後 = 2026-04-01)は既に過ぎているので、
// リードタイム30日以内に入る基準日を作るために入社日は 2025-11-01(初回付与 2026-05-01)にする。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z");
const FIXED_NOW_MINUTES = Math.floor(FIXED_NOW.getTime() / 60_000);

const GRANT_MANAGE_PERMISSION = "leave.grant.manage";
/** 入社日。初回付与(6ヶ月後)は 2026-05-01 = FIXED_NOW から16日後(リードタイム30日以内)。 */
const HIRE_DATE = "2025-11-01";
const EXPECTED_GRANTED_ON = "2026-05-01";

interface ProposalJson {
  id: string;
  userId: string;
  userName: string | null;
  leaveGrantClass: string | null;
  leaveType: string;
  grantedOn: string;
  days: number;
  expiresOn: string;
  attendanceRate: {
    periodFrom: string;
    periodTo: string;
    workingDays: number;
    attendedDays: number;
    rate: number | null;
    basis: "shift" | "calendar_estimate";
  };
  status: string;
  decisionNote: string | null;
  grantId: string | null;
}

async function setHireDate(db: Database, userId: string, hireDate: string): Promise<void> {
  await db.update(users).set({ hireDate }).where(eq(users.id, userId));
}

/** 比例付与の区分(users.leave_grant_class、労基法39条3項)を直接書き換える。 */
async function setLeaveGrantClass(db: Database, userId: string, leaveGrantClass: string): Promise<void> {
  await db.update(users).set({ leaveGrantClass }).where(eq(users.id, userId));
}

/** 有給設定(付与方式)を保存する。POST /settings/leave は leave.grant.manage が要るので API 経由で。 */
async function configureLeaveSettings(app: ReturnType<typeof createApp>, cookie: string): Promise<void> {
  const res = await app.request("/settings/leave", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      grantMethod: "statutory",
      fixedDateMmDd: null,
      hourlyLeaveEnabled: false,
      hourlyLeaveMaxDays: 5,
      halfDayLeaveEnabled: true,
      stockConversionEnabled: false,
      stockMaxDays: 40,
      stockExpiresMonths: null,
    }),
  });
  if (res.status !== 200) throw new Error(`configureLeaveSettings failed: ${res.status}`);
}

/** fetch を捕まえるだけのモック(実送信しないことの担保)。 */
function makeFetchSpy(): { fetchImpl: typeof fetch; hits: Array<{ url: string; body: string }> } {
  const hits: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    hits.push({ url: typeof input === "string" ? input : input.toString(), body: init?.body ? String(init.body) : "" });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, hits };
}

describe("runLeaveGrantProposalScan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("リードタイム内の付与基準日について予告を作り、leave.grant.manage 保持者へ通知する", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);

    const member = await setupSecondUser(db, tenantId);
    await setHireDate(db, member.userId, HIRE_DATE);

    const { fetchImpl, hits } = makeFetchSpy();
    const result = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.proposal.grantedOn).toBe(EXPECTED_GRANTED_ON);
    expect(result.created[0]?.proposal.days).toBe(10);
    expect(result.created[0]?.proposal.status).toBe("proposed");

    // 管理者(leave.grant.manage 保持者)へアプリ内通知が1件。
    const adminNotifications = await listNotifications(db, { tenantId, userId });
    expect(adminNotifications.filter((n) => n.type === "leave_grant_proposed")).toHaveLength(1);
    // 本人には作らない(予告は管理者向け)。
    const memberNotifications = await listNotifications(db, { tenantId, userId: member.userId });
    expect(memberNotifications.filter((n) => n.type === "leave_grant_proposed")).toHaveLength(0);
    // テナント共有 Webhook 未設定なので外部送信は起きない。
    expect(hits).toHaveLength(0);
  });

  /**
   * 比例付与(2026-08-24 追加)。予告の日数も区分に従う — 予告と実際の付与で日数が食い違うと
   * 承認画面の意味が無くなるため、スキャンも calculateStatutoryGrants に区分を渡す。
   */
  it("比例付与の区分が設定されたメンバーは、予告の日数も比例付与の表に従う", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);

    const member = await setupSecondUser(db, tenantId);
    await setHireDate(db, member.userId, HIRE_DATE);
    await setLeaveGrantClass(db, member.userId, "days4");

    const { fetchImpl } = makeFetchSpy();
    const result = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.proposal.grantedOn).toBe(EXPECTED_GRANTED_ON);
    // 週4日区分の初回(6ヶ月)は7日。フルタイムなら10日。
    expect(result.created[0]?.proposal.days).toBe(7);

    // 一覧 API は表示用に「現在の区分」を返す(なぜ日数が違うのかを管理者に示すため)。
    const listRes = await app.request("/leave/grant-proposals?status=proposed", { headers: { cookie } });
    expect(listRes.status).toBe(200);
    const listed = ((await listRes.json()) as { proposals: ProposalJson[] }).proposals;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.leaveGrantClass).toBe("days4");
    expect(listed[0]?.days).toBe(7);
  });

  it("テナント共有 Webhook が設定されていれば件数だけを1件通知する(個人の詳細は書かない)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);
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

    const member = await setupSecondUser(db, tenantId);
    await setHireDate(db, member.userId, HIRE_DATE);

    const { fetchImpl, hits } = makeFetchSpy();
    await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.body).toContain(EXPECTED_GRANTED_ON);
    expect(hits[0]?.body).not.toContain("Second User");
  });

  it("同じ日に2回実行しても予告は増えない(冪等)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);

    const member = await setupSecondUser(db, tenantId);
    await setHireDate(db, member.userId, HIRE_DATE);

    const { fetchImpl } = makeFetchSpy();
    await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });
    const second = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });

    expect(second.created).toHaveLength(0);
    expect(await listLeaveGrantProposals(db, { tenantId })).toHaveLength(1);
  });

  it("既に leave_grants がある基準日は予告しない", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);

    const member = await setupSecondUser(db, tenantId);
    await setHireDate(db, member.userId, HIRE_DATE);
    await insertLeaveGrant(db, {
      tenantId,
      userId: member.userId,
      leaveType: "annual",
      grantedOn: EXPECTED_GRANTED_ON,
      days: 10,
      expiresOn: "2028-05-01",
      source: "auto",
      createdAt: 0,
    });

    const { fetchImpl } = makeFetchSpy();
    const result = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });
    expect(result.created).toHaveLength(0);
  });

  it("入社日が未設定のユーザーは対象外", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);

    const { fetchImpl } = makeFetchSpy();
    const result = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });
    expect(result.created).toHaveLength(0);
    expect(result.scannedUserCount).toBe(0);
  });

  it("固定/フレックスのユーザーの出勤率参考値は暦日推定(basis=calendar_estimate)になる", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);

    const member = await setupSecondUser(db, tenantId);
    await setHireDate(db, member.userId, HIRE_DATE);

    const { fetchImpl } = makeFetchSpy();
    const result = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });

    const rate = JSON.parse(result.created[0]?.proposal.attendanceRate ?? "{}") as ProposalJson["attendanceRate"];
    expect(rate.basis).toBe("calendar_estimate");
    // 算定期間は [基準日 − 1年, 基準日 − 1日] を入社日でクリップした範囲。
    expect(rate.periodFrom).toBe(HIRE_DATE);
    expect(rate.periodTo).toBe("2026-04-30");
    expect(rate.workingDays).toBeGreaterThan(0);
    // 打刻が1件も無いので出勤日は0、rate は 0。
    expect(rate.attendedDays).toBe(0);
    expect(rate.rate).toBe(0);
  });

  it("シフト制ユーザーの出勤率参考値はシフト基準(basis=shift)になる", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);
    await switchToMonthlyVariableWorkPolicy(db, { tenantId });
    await setVariablePeriodStartDay(db, { tenantId, variablePeriodStartDay: 1 });

    await setHireDate(db, userId, HIRE_DATE);
    const plan = await insertShiftPlan(db, { tenantId, userId, periodStart: "2026-03-01", periodEnd: "2026-03-31", createdAt: 0 });
    await upsertShiftDaysForPlan(db, {
      tenantId,
      userId,
      planId: plan.id,
      days: [
        { date: "2026-03-02", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId: null },
        { date: "2026-03-03", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId: null },
        { date: "2026-03-04", dayType: "non_working", startMinutes: 0, endMinutes: 0, breakMinutes: 0, patternId: null },
      ],
      createdBy: userId,
      createdAt: 0,
    });

    const { fetchImpl } = makeFetchSpy();
    const result = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });

    const proposal = result.created.find((p) => p.proposal.userId === userId);
    const rate = JSON.parse(proposal?.proposal.attendanceRate ?? "{}") as ProposalJson["attendanceRate"];
    expect(rate.basis).toBe("shift");
    // 全労働日 = dayType が work の2日だけ(non_working は分母に入らない)。
    expect(rate.workingDays).toBe(2);
  });
});

describe("有給付与予告 API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 予告を1件作った状態のテナントを用意する。 */
  async function setupWithProposal() {
    const seeded = await setupTestDb();
    const { db, tenantId, userId, email, password } = seeded;
    await grantPermission(db, { tenantId, userId, permission: GRANT_MANAGE_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await configureLeaveSettings(app, cookie);

    const member = await setupSecondUser(db, tenantId);
    await setHireDate(db, member.userId, HIRE_DATE);

    const { fetchImpl, hits } = makeFetchSpy();
    const scan = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });
    const proposalId = scan.created[0]?.proposal.id as string;

    return { ...seeded, app, cookie, member, proposalId, hits };
  }

  it("GET /leave/grant-proposals は既定で proposed のみを返し、氏名を添える", async () => {
    const { app, cookie, member, proposalId } = await setupWithProposal();

    const res = await app.request("/leave/grant-proposals", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposals: ProposalJson[] };
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0]?.id).toBe(proposalId);
    expect(body.proposals[0]?.userId).toBe(member.userId);
    expect(body.proposals[0]?.userName).toBe("Second User");
    expect(body.proposals[0]?.attendanceRate.basis).toBe("calendar_estimate");
  });

  it("GET /leave/grant-proposals は leave.grant.manage が無ければ 403", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    expect(tenantId).toBeTruthy();

    const res = await app.request("/leave/grant-proposals", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("スコープ外のメンバーの予告は一覧に出ず、承認もできない(403)", async () => {
    const { db, tenantId, member, proposalId } = await setupWithProposal();

    // 別のユーザーに department_and_descendants スコープの leave.grant.manage を与える
    // (エンドポイントが要求する最小スコープ。所属部署が未設定なのでスコープ内ユーザーは自分だけ)。
    const outsider = await setupExtraUser(db, { tenantId, email: "outsider@example.com", name: "Outsider" });
    await grantPermission(db, { tenantId, userId: outsider.userId, permission: GRANT_MANAGE_PERMISSION, scope: "department_and_descendants" });
    const app = createApp({ db });
    const outsiderCookie = await loginAndGetCookie(app, outsider.email, outsider.password);

    const listRes = await app.request("/leave/grant-proposals", { headers: { cookie: outsiderCookie } });
    expect(listRes.status).toBe(200);
    expect(((await listRes.json()) as { proposals: ProposalJson[] }).proposals).toHaveLength(0);
    expect(member.userId).toBeTruthy();

    const approveRes = await app.request(`/leave/grant-proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: outsiderCookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(403);
  });

  it("承認すると leave_grants(source=proposal)が作られ、本人へ通知される", async () => {
    const { db, tenantId, app, cookie, member, proposalId } = await setupWithProposal();

    const res = await app.request(`/leave/grant-proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { proposal: ProposalJson; grant: { source: string; grantedOn: string; days: number } };
    expect(body.proposal.status).toBe("approved");
    expect(body.proposal.grantId).toBeTruthy();
    expect(body.grant.source).toBe("proposal");
    // 基準日より前の承認でも付与日は基準日のまま。
    expect(body.grant.grantedOn).toBe(EXPECTED_GRANTED_ON);
    expect(body.grant.days).toBe(10);

    const memberNotifications = await listNotifications(db, { tenantId, userId: member.userId });
    const granted = memberNotifications.filter((n) => n.type === "leave_grant_approved");
    expect(granted).toHaveLength(1);
    expect(granted[0]?.body).toContain("10日");
    expect(granted[0]?.body).toContain(EXPECTED_GRANTED_ON);

    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).map((r) => r.action);
    expect(actions).toContain("leave_grant_proposal.approve");
  });

  it("承認済みの予告をもう一度承認すると 409 not_proposed", async () => {
    const { app, cookie, proposalId } = await setupWithProposal();

    await app.request(`/leave/grant-proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    const res = await app.request(`/leave/grant-proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "not_proposed" });
  });

  it("却下すると status=rejected になり、以後のワーカー実行で再提案されない", async () => {
    const { db, tenantId, app, cookie, proposalId } = await setupWithProposal();

    const res = await app.request(`/leave/grant-proposals/${proposalId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ note: "休職期間があるため個別に確認する" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposal: ProposalJson };
    expect(body.proposal.status).toBe("rejected");
    expect(body.proposal.decisionNote).toBe("休職期間があるため個別に確認する");

    const { fetchImpl } = makeFetchSpy();
    const rerun = await runLeaveGrantProposalScan(db, { nowMinutes: FIXED_NOW_MINUTES, notifyDeps: { fetchImpl } });
    expect(rerun.created).toHaveLength(0);
    expect(await listLeaveGrantProposals(db, { tenantId, statuses: ["proposed"] })).toHaveLength(0);

    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).map((r) => r.action);
    expect(actions).toContain("leave_grant_proposal.reject");
  });

  it("POST /leave/grants/auto が同じ基準日の付与を作ると、予告は superseded になる", async () => {
    const { db, tenantId, app, cookie, member, proposalId } = await setupWithProposal();

    // /grants/auto は「today までに到来した付与」しか作らないため、予告の基準日を過ぎた時刻へ進める。
    vi.setSystemTime(new Date("2026-05-02T03:00:00.000Z"));

    const res = await app.request("/leave/grants/auto", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ userId: member.userId }),
    });
    expect(res.status).toBe(201);

    const proposals = await listLeaveGrantProposals(db, { tenantId });
    expect(proposals.find((p) => p.id === proposalId)?.status).toBe("superseded");
  });
});
