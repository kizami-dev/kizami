/**
 * 承認・却下・退会の経路が **workerd + D1** で通ること(docs/design/d1-atomic-writes.md §6 #10〜#19)。
 *
 * 以前はどれも `db.transaction()` を使っていて、D1 は `BEGIN` を拒否するので 500 になっていた。
 * atomic plan(D1 では `batch()`)へ移したので、配備するのと同じ src/workers.ts を `SELF` 経由で叩いて、
 * 締め前の月の承認・却下・付与予告の承認・退会の申請と取り消しが通ること、締め済み月への承認(amend)は
 * 何も書かずに 409 `amend_unsupported_on_d1` で断ることを見る。原子性(同時の2要求で勝つのは1つ)は
 * packages/db/test/atomic-decisions.test.ts が D1 レグでも見ている。
 */

import { SELF, applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  auditLogs,
  closingEvents,
  createD1Database,
  insertLeaveGrant,
  insertLeaveGrantProposal,
  leaveGrants,
  permissionPresets,
  presetAssignments,
  punchEvents,
  uuidv7,
  type Database,
} from "@kizami/db";
import { extractCookie, jstMinutes, seedTenant } from "../support/seed.js";

const ORIGIN = "https://kizami.test";

let db: Database;
let tenantId: string;
let userId: string;
let cookie: string;

async function post(path: string, body: unknown = {}) {
  const res = await SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const idOf = (body: Record<string, unknown>, key: string) => (body[key] as { id: string }).id;
const tenantRows = async (table: typeof punchEvents | typeof auditLogs | typeof closingEvents) =>
  (await db.select().from(table).where(eq(table.tenantId, tenantId))).length;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  ({ db } = createD1Database(env.DB));
  const seeded = await seedTenant(db);
  ({ tenantId, userId } = seeded);
  const presetId = uuidv7();
  const permissions = [
    "attendance.correction.approve",
    "leave.request.approve",
    "leave.grant.manage",
    "closing.execute",
    "closing.unlock",
    "tenant.withdraw",
  ];
  await db.insert(permissionPresets).values({
    id: presetId,
    tenantId,
    name: "test-approvals",
    grants: JSON.stringify(permissions.map((key) => ({ key, scope: "tenant" }))),
    isSystem: false,
    createdAt: 0,
  });
  await db.insert(presetAssignments).values({ id: uuidv7(), tenantId, userId, presetId, createdAt: 0 });
  await insertLeaveGrant(db, {
    tenantId,
    userId,
    leaveType: "annual",
    grantedOn: "2020-01-01",
    days: 10,
    expiresOn: "2099-01-01",
    source: "manual",
    createdAt: 0,
  });

  const login = await SELF.fetch(`${ORIGIN}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: seeded.email, password: seeded.password }),
  });
  expect(login.status).toBe(200);
  cookie = extractCookie(login);
});

describe("approvals on workerd + D1 (atomic plan)", () => {
  it("修正申請の承認(締め前の月)が打刻と監査ログを1単位で書き、二重承認は 409 not_pending", async () => {
    const created = await post("/corrections", { proposedKind: "clock_in", proposedOccurredAt: jstMinutes(2026, 5, 7, 9, 0), reason: "打刻忘れ" });
    expect(created.status).toBe(201);
    const id = idOf(created.body, "request");

    const approved = await post(`/corrections/${id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ amended: false, request: { status: "approved" }, appliedEvent: { kind: "clock_in" } });
    expect(await post(`/corrections/${id}/approve`)).toMatchObject({ status: 409, body: { error: "not_pending" } });
    expect((await db.select().from(punchEvents).where(eq(punchEvents.correctionRequestId, id))).length).toBe(1);
  });

  it("修正申請の却下・休暇申請の承認・休憩自動控除の打ち消しの承認と却下が通る", async () => {
    const correction = await post("/corrections", { proposedKind: "clock_in", proposedOccurredAt: jstMinutes(2026, 5, 8, 9, 0), reason: "打刻忘れ" });
    expect(await post(`/corrections/${idOf(correction.body, "request")}/reject`, { note: "不要" })).toMatchObject({
      status: 200,
      body: { request: { status: "rejected" } },
    });

    const leave = await post("/leave/requests", { leaveDate: "2026-05-15", reason: "私用のため" });
    expect(leave.status).toBe(201);
    expect(await post(`/leave/requests/${idOf(leave.body, "request")}/approve`)).toMatchObject({
      status: 200,
      body: { amended: false, request: { status: "approved" } },
    });

    const approveWaiver = await post("/auto-break-waivers", { waiveDate: "2026-05-07", reason: "休憩を取れなかった" });
    expect(await post(`/auto-break-waivers/${idOf(approveWaiver.body, "waiver")}/approve`)).toMatchObject({
      status: 200,
      body: { amended: false, waiver: { status: "approved" } },
    });
    const rejectWaiver = await post("/auto-break-waivers", { waiveDate: "2026-05-08", reason: "休憩を取れなかった" });
    expect(await post(`/auto-break-waivers/${idOf(rejectWaiver.body, "waiver")}/reject`)).toMatchObject({
      status: 200,
      body: { waiver: { status: "rejected" } },
    });
  });

  it("付与予告の承認が付与を1本だけ作り、予告に結ぶ", async () => {
    const proposal = await insertLeaveGrantProposal(db, {
      tenantId,
      userId,
      leaveType: "annual",
      grantedOn: "2026-10-01",
      days: 11,
      expiresOn: "2028-10-01",
      attendanceRate: JSON.stringify({ rate: 1 }),
      proposedAt: 0,
    });
    const approved = await post(`/leave/grant-proposals/${proposal.id}/approve`);
    expect(approved.status).toBe(201);
    const grants = await db.select().from(leaveGrants).where(eq(leaveGrants.grantedOn, "2026-10-01"));
    expect(grants).toHaveLength(1);
    expect(approved.body).toMatchObject({ proposal: { status: "approved", grantId: grants[0]?.id } });
    expect(await post(`/leave/grant-proposals/${proposal.id}/approve`)).toMatchObject({ status: 409, body: { error: "not_proposed" } });
  });

  it("締め済み月への承認(amend)は何も書かずに 409 amend_unsupported_on_d1", async () => {
    expect((await post("/closings/2026-04/close")).status).toBe(200);
    const correction = await post("/corrections", { proposedKind: "clock_in", proposedOccurredAt: jstMinutes(2026, 4, 2, 9, 0), reason: "打刻忘れ" });
    expect(correction.status).toBe(201);
    const before = { punches: await tenantRows(punchEvents), audits: await tenantRows(auditLogs), events: await tenantRows(closingEvents) };

    expect(await post(`/corrections/${idOf(correction.body, "request")}/approve`)).toEqual({
      status: 409,
      body: { error: "amend_unsupported_on_d1" },
    });
    expect({ punches: await tenantRows(punchEvents), audits: await tenantRows(auditLogs), events: await tenantRows(closingEvents) }).toEqual(before);
  });

  // 退会の申請の後は取り消し以外の書き込みが 409 になるので、このファイルの最後に置く
  it("退会の申請と取り消しが通り、二重申請は 409", async () => {
    expect((await post("/tenant/withdrawal", { confirmTenantName: "Test Tenant" })).status).toBe(200);
    // 手続き中の二重申請は、ルートより手前の auth/tenant-withdrawal-guard.ts が止める(claim の負けは
    // packages/db/test/atomic-decisions.test.ts が D1 レグで見ている)
    expect((await post("/tenant/withdrawal", { confirmTenantName: "Test Tenant" })).status).toBe(409);
    expect((await post("/tenant/withdrawal/cancel")).status).toBe(200);
    expect(await post("/tenant/withdrawal/cancel")).toMatchObject({ status: 409, body: { error: "not_withdrawing" } });
    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).map((l) => l.action);
    expect(actions.filter((a) => a.startsWith("tenant.withdrawal."))).toEqual(["tenant.withdrawal.request", "tenant.withdrawal.cancel"]);
  });
});
