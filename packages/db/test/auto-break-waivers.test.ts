import { beforeEach, describe, expect, it } from "vitest";
import { isUniqueConstraintError } from "../src/errors.js";
import { migrateDb, type Database } from "../src/migrate.js";
import {
  createAutoBreakWaiver,
  decideAutoBreakWaiver,
  getAutoBreakWaiverById,
  listApprovedWaiverDatesInRange,
  listAutoBreakWaivers,
  withdrawAutoBreakWaiver,
} from "../src/queries/auto-break-waivers.js";
import { tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("auto_break_waivers", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const otherUserId = uuidv7();
  const approverId = uuidv7();

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values([
      { id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 },
      { id: otherUserId, tenantId, email: "b@example.com", name: "B", createdAt: 0 },
      { id: approverId, tenantId, email: "approver@example.com", name: "Approver", createdAt: 0 },
    ]);
  });

  it("createAutoBreakWaiver defaults status to pending", async () => {
    const req = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-20",
      reason: "来客対応で休憩を取れなかった",
      createdAt: 0,
    });

    expect(req.status).toBe("pending");

    const fetched = await getAutoBreakWaiverById(db, req.id);
    expect(fetched?.id).toBe(req.id);
  });

  it("getAutoBreakWaiverById returns null for an unknown id", async () => {
    expect(await getAutoBreakWaiverById(db, uuidv7())).toBeNull();
  });

  it("listAutoBreakWaivers filters by tenant/user/status and orders newest first", async () => {
    const first = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-18",
      reason: "first",
      createdAt: 0,
    });
    const second = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-19",
      reason: "second",
      createdAt: 1,
    });
    // 別ユーザーの申請は混ざらないことを確認する
    await createAutoBreakWaiver(db, {
      tenantId,
      userId: otherUserId,
      requestedBy: otherUserId,
      waiveDate: "2026-08-19",
      reason: "other user",
      createdAt: 2,
    });

    const all = await listAutoBreakWaivers(db, { tenantId, userId });
    expect(all.map((r) => r.id)).toEqual([second.id, first.id]);

    await decideAutoBreakWaiver(db, { id: first.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 10 });
    const pendingOnly = await listAutoBreakWaivers(db, { tenantId, userId, status: "pending" });
    expect(pendingOnly.map((r) => r.id)).toEqual([second.id]);
  });

  it("decideAutoBreakWaiver only updates a pending row and returns null otherwise", async () => {
    const req = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-20",
      reason: "reason",
      createdAt: 0,
    });

    const approved = await decideAutoBreakWaiver(db, {
      id: req.id,
      tenantId,
      status: "approved",
      decidedBy: approverId,
      decidedAt: 10,
      decisionNote: "ok",
    });
    expect(approved?.status).toBe("approved");
    expect(approved?.decidedBy).toBe(approverId);

    // 既に approved なので、もう一度 decide しても 0件更新(= null)
    const secondAttempt = await decideAutoBreakWaiver(db, {
      id: req.id,
      tenantId,
      status: "rejected",
      decidedBy: approverId,
      decidedAt: 20,
    });
    expect(secondAttempt).toBeNull();

    const stillApproved = await getAutoBreakWaiverById(db, req.id);
    expect(stillApproved?.status).toBe("approved");
  });

  it("withdrawAutoBreakWaiver withdraws only pending requests", async () => {
    const req = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-20",
      reason: "reason",
      createdAt: 0,
    });

    const withdrawn = await withdrawAutoBreakWaiver(db, { id: req.id, tenantId, userId });
    expect(withdrawn?.status).toBe("withdrawn");

    // 既に withdrawn なので、もう一度取り下げても 0件更新(= null)
    expect(await withdrawAutoBreakWaiver(db, { id: req.id, tenantId, userId })).toBeNull();

    // 承認済みの申請は取り下げられない
    const approvedReq = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-21",
      reason: "reason2",
      createdAt: 1,
    });
    await decideAutoBreakWaiver(db, { id: approvedReq.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 5 });
    expect(await withdrawAutoBreakWaiver(db, { id: approvedReq.id, tenantId, userId })).toBeNull();
  });

  it("listApprovedWaiverDatesInRange returns only approved dates within range, ordered ascending", async () => {
    const inRangeApproved1 = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-15",
      reason: "r1",
      createdAt: 0,
    });
    const inRangeApproved2 = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-10",
      reason: "r2",
      createdAt: 1,
    });
    // pending のままにしておく(却下扱いにしない) — 範囲取得結果に混ざらないことを確認するため
    await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-12",
      reason: "r3",
      createdAt: 2,
    });
    const outOfRangeApproved = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-09-01",
      reason: "r4",
      createdAt: 3,
    });

    await decideAutoBreakWaiver(db, { id: inRangeApproved1.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 10 });
    await decideAutoBreakWaiver(db, { id: inRangeApproved2.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 10 });
    await decideAutoBreakWaiver(db, { id: outOfRangeApproved.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 10 });

    const dates = await listApprovedWaiverDatesInRange(db, {
      tenantId,
      userId,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });
    expect(dates).toEqual(["2026-08-10", "2026-08-15"]);
    expect(dates).not.toContain("2026-08-12"); // pending は含まれない
  });

  it("prevents duplicate approved waivers for the same user/date via the partial UNIQUE index", async () => {
    const first = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-20",
      reason: "1回目",
      createdAt: 0,
    });
    const second = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-20",
      reason: "2回目(同日再申請)",
      createdAt: 1,
    });

    await decideAutoBreakWaiver(db, { id: first.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 10 });

    let caught: unknown;
    try {
      await decideAutoBreakWaiver(db, { id: second.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 20 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isUniqueConstraintError(caught)).toBe(true);

    // 2件目は pending のまま(UNIQUE 違反で更新は成立しない)
    const stillPending = await getAutoBreakWaiverById(db, second.id);
    expect(stillPending?.status).toBe("pending");
  });

  it("allows a new pending request for the same date after the previous one was rejected", async () => {
    const rejected = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-20",
      reason: "却下される申請",
      createdAt: 0,
    });
    await decideAutoBreakWaiver(db, { id: rejected.id, tenantId, status: "rejected", decidedBy: approverId, decidedAt: 10 });

    // 却下後、同じ日に再申請できる
    const retry = await createAutoBreakWaiver(db, {
      tenantId,
      userId,
      requestedBy: userId,
      waiveDate: "2026-08-20",
      reason: "再申請",
      createdAt: 1,
    });
    const approved = await decideAutoBreakWaiver(db, { id: retry.id, tenantId, status: "approved", decidedBy: approverId, decidedAt: 20 });
    expect(approved?.status).toBe("approved");
  });
});
