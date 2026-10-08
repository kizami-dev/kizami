/**
 * 承認・却下・退会の atomic plan(docs/design/d1-atomic-writes.md §6 #10〜#19 の B)を3レグ
 * (SQLite / PostgreSQL / D1)で固定する。`supportsTransactions` で外さない — D1 で動くことそのものが目的。
 *
 * どの経路も「claim(条件付き UPDATE)→ ガード → 依存する書き込み」の形で、ここで見るのは:
 * - 同時の2要求で勝つのは1つだけ、負けた側は何も書かない(打刻・付与・監査ログが残らない)
 * - claim できない状態(既に決裁済み)では何も書かない
 * - 承認では、計画の前に読んだ「締め前」が書き込みの時点で崩れていたら(同時に締められた)何も書かない
 * - UNIQUE 違反(二重 supersede・approved の重複)は従来どおり例外として呼び出し側へ届き、何も残らない
 */

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateDb, supportsTransactions, type Database } from "./support/db.js";
import { supportsInteractiveTransactions } from "../src/d1.js";
import { isUniqueConstraintError } from "../src/errors.js";
import type { NewAuditLogInput } from "../src/queries/audit.js";
import { createAutoBreakWaiver, decideAutoBreakWaiverAtomic, getAutoBreakWaiverById } from "../src/queries/auto-break-waivers.js";
import { appendClosingEvent } from "../src/queries/closings.js";
import {
  approveCorrectionRequest,
  createCorrectionRequest,
  getCorrectionRequest,
  rejectCorrectionRequest,
  type CorrectionRequest,
} from "../src/queries/corrections.js";
import {
  approveLeaveGrantProposal,
  approveLeaveRequest,
  createLeaveRequest,
  getLeaveGrantProposal,
  getLeaveRequest,
  insertLeaveGrantProposal,
  updateLeaveGrantProposalStatus,
  updateLeaveRequestStatus,
} from "../src/queries/leave.js";
import { insertPunchEvent } from "../src/queries/punches.js";
import { claimTenantPurge, cancelTenantWithdrawalWithAudit, requestTenantWithdrawalWithAudit } from "../src/queries/tenant-withdrawal.js";
import { auditLogs, leaveGrants, punchEvents, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("atomic decisions (approvals / rejections / tenant withdrawal)", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const approverId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values([
      { id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 },
      { id: approverId, tenantId, email: "b@example.com", name: "B", createdAt: 0 },
    ]);
  });

  const audit = (action: string, targetId: string): NewAuditLogInput => ({
    tenantId,
    actorId: approverId,
    action,
    targetType: "test",
    targetId,
    detail: "{}",
    occurredAt: 1000,
  });
  const auditActions = async () =>
    (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).map((l) => l.action).sort();
  const closeMonth = (period: string, occurredAt = 900) =>
    appendClosingEvent(db, { tenantId, period, event: "close", actorId: approverId, occurredAt });

  it("supportsInteractiveTransactions matches the leg (false only on D1)", () => {
    expect(supportsInteractiveTransactions(db)).toBe(supportsTransactions);
  });

  describe("tenant withdrawal (#10 request / #11 cancel)", () => {
    const request = () =>
      requestTenantWithdrawalWithAudit(db, {
        tenantId,
        requestedAt: 1000,
        scheduledPurgeAt: 2000,
        audit: audit("tenant.withdrawal.request", tenantId),
      });
    const cancel = () => cancelTenantWithdrawalWithAudit(db, { tenantId, audit: audit("tenant.withdrawal.cancel", tenantId) });

    it("request: claims the tenant row and writes one audit log; a second request writes nothing", async () => {
      const row = await request();
      expect(row).toMatchObject({ id: tenantId, withdrawalRequestedAt: 1000, withdrawalScheduledPurgeAt: 2000 });
      expect(await request()).toBeNull();
      expect(await auditActions()).toEqual(["tenant.withdrawal.request"]);
    });

    it("concurrent requests: exactly one wins and exactly one audit log is written", async () => {
      const results = await Promise.all([request(), request(), request()]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await auditActions()).toEqual(["tenant.withdrawal.request"]);
    });

    it("cancel: only while withdrawing, and not once the purge has started (no audit log when lost)", async () => {
      expect(await cancel()).toBeNull();
      expect(await auditActions()).toEqual([]);

      await request();
      const cancelled = await cancel();
      expect(cancelled).toMatchObject({ withdrawalRequestedAt: null, withdrawalScheduledPurgeAt: null });

      await request();
      expect(await claimTenantPurge(db, { tenantId, now: 3000, requireDue: false })).not.toBeNull();
      expect(await cancel()).toBeNull();
      expect(await auditActions()).toEqual(["tenant.withdrawal.cancel", "tenant.withdrawal.request", "tenant.withdrawal.request"]);
    });

    it("concurrent cancels: exactly one wins and exactly one cancel audit log is written", async () => {
      await request();
      const results = await Promise.all([cancel(), cancel()]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await auditActions()).toEqual(["tenant.withdrawal.cancel", "tenant.withdrawal.request"]);
    });
  });

  describe("correction approve (#14, open month) / reject (#15)", () => {
    const period = "2026-04";
    const createAddition = () =>
      createCorrectionRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        proposedKind: "clock_in",
        proposedOccurredAt: 5000,
        reason: "打刻忘れ",
        createdAt: 0,
      });
    const approve = (req: CorrectionRequest, extra: { supersedesId?: string } = {}) => {
      const punchId = uuidv7();
      return approveCorrectionRequest(db, {
        id: req.id,
        tenantId,
        fromStatus: "pending",
        decidedBy: approverId,
        decidedAt: 1000,
        decisionNote: null,
        punch: {
          id: punchId,
          tenantId,
          userId,
          kind: "clock_in",
          occurredAt: 5000,
          recordedAt: 1000,
          source: "web",
          actorId: approverId,
          correctionRequestId: req.id,
          ...(extra.supersedesId !== undefined ? { supersedesId: extra.supersedesId } : {}),
        },
        openPeriods: [period],
        audit: audit("correction.approve", req.id),
      });
    };
    const reject = (req: CorrectionRequest) =>
      rejectCorrectionRequest(db, {
        id: req.id,
        tenantId,
        fromStatus: "pending",
        decidedBy: approverId,
        decidedAt: 1000,
        decisionNote: "no",
        audit: audit("correction.reject", req.id),
      });
    const punchesFor = async (correctionRequestId: string) =>
      db.select().from(punchEvents).where(eq(punchEvents.correctionRequestId, correctionRequestId));

    it("approves: status claim + punch + audit log, all at once", async () => {
      const req = await createAddition();
      const result = await approve(req);
      if (!result.ok) throw new Error("expected approval to succeed");
      expect(result.request).toMatchObject({ id: req.id, status: "approved", decidedBy: approverId });
      expect(result.event).toMatchObject({ kind: "clock_in", occurredAt: 5000, correctionRequestId: req.id });
      expect(await punchesFor(req.id)).toHaveLength(1);
      expect(await auditActions()).toEqual(["correction.approve"]);
    });

    it("concurrent approvals of an addition (no UNIQUE to stop it): exactly one wins; the loser writes no punch and no audit log", async () => {
      const req = await createAddition();
      const results = await Promise.all([approve(req), approve(req), approve(req)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, reason: "not_pending" },
        { ok: false, reason: "not_pending" },
      ]);
      expect(await punchesFor(req.id)).toHaveLength(1);
      expect(await auditActions()).toEqual(["correction.approve"]);
    });

    it("lost claim (already rejected): not_pending, no punch, no audit log", async () => {
      const req = await createAddition();
      expect(await reject(req)).not.toBeNull();
      expect(await approve(req)).toEqual({ ok: false, reason: "not_pending" });
      expect(await punchesFor(req.id)).toHaveLength(0);
      expect((await getCorrectionRequest(db, req.id))?.status).toBe("rejected");
      expect(await auditActions()).toEqual(["correction.reject"]);
    });

    it("the month got closed after the pre-read: month_closed, and nothing is written (status stays pending)", async () => {
      const req = await createAddition();
      await closeMonth(period);
      expect(await approve(req)).toEqual({ ok: false, reason: "month_closed" });
      expect((await getCorrectionRequest(db, req.id))?.status).toBe("pending");
      expect(await punchesFor(req.id)).toHaveLength(0);
      expect(await auditActions()).toEqual([]);
    });

    it("a reopened month counts as open again (close -> reopen -> approve succeeds)", async () => {
      const req = await createAddition();
      await closeMonth(period, 900);
      await appendClosingEvent(db, { tenantId, period, event: "reopen", actorId: approverId, occurredAt: 950 });
      expect((await approve(req)).ok).toBe(true);
    });

    it("a second supersede of the same punch is a UNIQUE violation and rolls back the claim and the audit log", async () => {
      const target = await insertPunchEvent(db, {
        tenantId,
        userId,
        kind: "clock_in",
        occurredAt: 4000,
        recordedAt: 4000,
        source: "web",
        actorId: userId,
      });
      const first = await createAddition();
      const second = await createAddition();
      expect((await approve(first, { supersedesId: target.id })).ok).toBe(true);

      const err = await approve(second, { supersedesId: target.id }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isUniqueConstraintError(err)).toBe(true);
      expect((await getCorrectionRequest(db, second.id))?.status).toBe("pending");
      expect(await punchesFor(second.id)).toHaveLength(0);
      expect(await auditActions()).toEqual(["correction.approve"]);
    });

    it("concurrent approve and reject: exactly one decision lands, with exactly one audit log", async () => {
      const req = await createAddition();
      const [approved, rejected] = await Promise.all([approve(req), reject(req)]);
      expect([approved.ok, rejected !== null].filter(Boolean)).toHaveLength(1);
      const status = (await getCorrectionRequest(db, req.id))?.status;
      expect(await punchesFor(req.id)).toHaveLength(status === "approved" ? 1 : 0);
      expect(await auditActions()).toHaveLength(1);
    });

    it("concurrent rejections: exactly one wins and exactly one audit log is written", async () => {
      const req = await createAddition();
      const results = await Promise.all([reject(req), reject(req)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await auditActions()).toEqual(["correction.reject"]);
    });
  });

  describe("leave request approve (#16, open month)", () => {
    const createLeave = () =>
      createLeaveRequest(db, {
        tenantId,
        userId,
        requestedBy: userId,
        leaveDate: "2026-04-10",
        unit: "full_day",
        leaveType: "annual_paid",
        reason: "私用",
        createdAt: 0,
      });
    const approve = (id: string) =>
      approveLeaveRequest(db, {
        id,
        tenantId,
        fromStatus: "pending",
        decidedBy: approverId,
        decidedAt: 1000,
        decisionNote: null,
        openPeriod: "2026-04",
        audit: audit("leave_request.approve", id),
      });

    it("concurrent approvals: exactly one wins and exactly one audit log is written", async () => {
      const req = await createLeave();
      const results = await Promise.all([approve(req.id), approve(req.id)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "not_pending" });
      expect((await getLeaveRequest(db, req.id))?.status).toBe("approved");
      expect(await auditActions()).toEqual(["leave_request.approve"]);
    });

    it("lost claim (withdrawn) and closed month both write nothing", async () => {
      const withdrawn = await createLeave();
      await updateLeaveRequestStatus(db, { id: withdrawn.id, tenantId, status: "withdrawn" });
      expect(await approve(withdrawn.id)).toEqual({ ok: false, reason: "not_pending" });

      const pending = await createLeave();
      await closeMonth("2026-04");
      expect(await approve(pending.id)).toEqual({ ok: false, reason: "month_closed" });
      expect((await getLeaveRequest(db, pending.id))?.status).toBe("pending");
      expect(await auditActions()).toEqual([]);
    });
  });

  describe("leave grant proposal approve (#17)", () => {
    const createProposal = () =>
      insertLeaveGrantProposal(db, {
        tenantId,
        userId,
        leaveType: "annual_paid",
        grantedOn: "2026-10-01",
        days: 10,
        expiresOn: "2028-10-01",
        attendanceRate: "{}",
        proposedAt: 0,
      });
    const approve = (id: string) =>
      approveLeaveGrantProposal(db, {
        tenantId,
        id,
        decidedBy: approverId,
        decidedAt: 1000,
        grant: {
          tenantId,
          userId,
          leaveType: "annual_paid",
          grantedOn: "2026-10-01",
          days: 10,
          expiresOn: "2028-10-01",
          source: "proposal",
          createdAt: 1000,
        },
        buildAudit: (grantId) => ({ ...audit("leave_grant_proposal.approve", id), detail: JSON.stringify({ grantId }) }),
      });
    const grantsOfUser = async () =>
      db.select().from(leaveGrants).where(and(eq(leaveGrants.tenantId, tenantId), eq(leaveGrants.userId, userId)));

    it("creates the grant, links it to the proposal and audits it (the audit detail carries the same grant id)", async () => {
      const proposal = await createProposal();
      const result = await approve(proposal.id);
      if (!result) throw new Error("expected approval to succeed");
      expect(result.proposal).toMatchObject({ status: "approved", grantId: result.grant.id, decidedBy: approverId });
      expect(result.grant).toMatchObject({ grantedOn: "2026-10-01", days: 10, source: "proposal" });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      expect(JSON.parse(log?.afterDigest ?? "{}")).toEqual({ grantId: result.grant.id });
    });

    it("concurrent approvals (leave_grants has no UNIQUE): exactly one wins; exactly one grant and one audit log", async () => {
      const proposal = await createProposal();
      const results = await Promise.all([approve(proposal.id), approve(proposal.id), approve(proposal.id)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const grants = await grantsOfUser();
      expect(grants).toHaveLength(1);
      expect((await getLeaveGrantProposal(db, { tenantId, id: proposal.id }))?.grantId).toBe(grants[0]?.id);
      expect(await auditActions()).toEqual(["leave_grant_proposal.approve"]);
    });

    it("lost claim (already rejected): null, no grant, no audit log", async () => {
      const proposal = await createProposal();
      await updateLeaveGrantProposalStatus(db, { tenantId, id: proposal.id, fromStatus: "proposed", status: "rejected" });
      expect(await approve(proposal.id)).toBeNull();
      expect(await grantsOfUser()).toHaveLength(0);
      expect(await auditActions()).toEqual([]);
    });
  });

  describe("auto break waiver approve (#18, open month) / reject (#19)", () => {
    const createWaiver = () =>
      createAutoBreakWaiver(db, { tenantId, userId, requestedBy: userId, waiveDate: "2026-04-10", reason: "休憩なし", createdAt: 0 });
    const decide = (id: string, status: "approved" | "rejected") =>
      decideAutoBreakWaiverAtomic(db, {
        decision: { id, tenantId, status, decidedBy: approverId, decidedAt: 1000, decisionNote: null },
        ...(status === "approved" ? { openPeriod: "2026-04" } : {}),
        audit: audit(`auto_break_waiver.${status === "approved" ? "approve" : "reject"}`, id),
      });

    it("concurrent approvals: exactly one wins and exactly one audit log is written", async () => {
      const waiver = await createWaiver();
      const results = await Promise.all([decide(waiver.id, "approved"), decide(waiver.id, "approved")]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await auditActions()).toEqual(["auto_break_waiver.approve"]);
    });

    it("approving a second waiver for the same user/date is a UNIQUE violation and writes nothing", async () => {
      const first = await createWaiver();
      const second = await createWaiver();
      expect((await decide(first.id, "approved")).ok).toBe(true);
      const err = await decide(second.id, "approved").then(
        () => null,
        (e: unknown) => e,
      );
      expect(isUniqueConstraintError(err)).toBe(true);
      expect((await getAutoBreakWaiverById(db, second.id))?.status).toBe("pending");
      expect(await auditActions()).toEqual(["auto_break_waiver.approve"]);
    });

    it("closed month: month_closed and nothing is written; rejection does not look at the month", async () => {
      const waiver = await createWaiver();
      await closeMonth("2026-04");
      expect(await decide(waiver.id, "approved")).toEqual({ ok: false, reason: "month_closed" });
      expect((await getAutoBreakWaiverById(db, waiver.id))?.status).toBe("pending");
      expect(await auditActions()).toEqual([]);
      expect((await decide(waiver.id, "rejected")).ok).toBe(true);
    });

    it("concurrent rejections / lost claim: exactly one wins; the loser writes no audit log", async () => {
      const waiver = await createWaiver();
      const results = await Promise.all([decide(waiver.id, "rejected"), decide(waiver.id, "rejected")]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await decide(waiver.id, "approved")).toEqual({ ok: false, reason: "not_pending" });
      expect(await auditActions()).toEqual(["auto_break_waiver.reject"]);
    });
  });
});
