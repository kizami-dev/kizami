/**
 * D1 の配備(`interactiveTransactions: false`)での承認の振り分け(docs/design/d1-atomic-writes.md §6.1)。
 *
 * - 締め済み月に影響する承認(amend)は db.transaction() に入る前に 409 `amend_unsupported_on_d1` で断り、
 *   **何も書かない**(打刻・申請の状態・closing_events・スナップショット・監査ログのどれも変わらない)
 * - 締め前の月の承認は atomic plan で通る(D1 でも動く経路)
 *
 * ここは Node の SQLite で「D1 の配備」をフラグで再現する。実物の workerd + D1 で同じ経路を通すのは
 * test/workers/approvals.test.ts。
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditLogs,
  autoBreakWaivers,
  closingEvents,
  closingSnapshots,
  correctionRequests,
  insertLeaveGrant,
  leaveRequests,
  punchEvents,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function post(app: RequestLike, cookie: string, path: string, body: unknown = {}) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** 書き込みの有無を比べるための、テナントの関係する表の行数。 */
async function counts(db: Database, tenantId: string) {
  const n = async (table: typeof punchEvents | typeof auditLogs | typeof closingEvents | typeof closingSnapshots) =>
    (await db.select().from(table).where(eq(table.tenantId, tenantId))).length;
  return {
    punches: await n(punchEvents),
    audits: await n(auditLogs),
    closingEvents: await n(closingEvents),
    snapshots: await n(closingSnapshots),
  };
}

async function setup() {
  const seeded = await setupTestDb();
  const { db, tenantId, userId } = seeded;
  for (const permission of ["closing.execute", "closing.unlock", "attendance.correction.approve", "leave.request.approve"]) {
    await grantPermission(db, { tenantId, userId, permission, scope: "tenant" });
  }
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
  // D1 の配備と同じ判定(Workers エントリでは db から自動で false になる)
  const app = createApp({ db, interactiveTransactions: false });
  const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
  return { ...seeded, app, cookie };
}

describe("approvals on a deployment without interactive transactions (D1)", () => {
  it("corrections / leave / auto-break waivers: approving into a closed month is 409 amend_unsupported_on_d1 and writes nothing", async () => {
    const { db, tenantId, app, cookie } = await setup();
    expect((await post(app, cookie, "/punches", { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 1, 9, 0) })).status).toBe(201);
    expect((await post(app, cookie, "/punches", { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 1, 18, 0) })).status).toBe(201);
    // 締めそのものは atomic plan(closePeriod)なので D1 でも通る
    expect((await post(app, cookie, "/closings/2026-04/close")).status).toBe(200);

    const correction = await post(app, cookie, "/corrections", {
      proposedKind: "clock_in",
      proposedOccurredAt: jstMinutes(2026, 4, 2, 9, 0),
      reason: "打刻忘れ",
    });
    expect(correction.status).toBe(201);
    const leave = await post(app, cookie, "/leave/requests", { leaveDate: "2026-04-15", reason: "私用のため" });
    expect(leave.status).toBe(201);
    const waiver = await post(app, cookie, "/auto-break-waivers", { waiveDate: "2026-04-01", reason: "休憩を取れなかった" });
    expect(waiver.status).toBe(201);
    const correctionId = (correction.body.request as { id: string }).id;
    const leaveId = (leave.body.request as { id: string }).id;
    const waiverId = (waiver.body.waiver as { id: string }).id;

    const before = await counts(db, tenantId);
    for (const path of [`/corrections/${correctionId}/approve`, `/leave/requests/${leaveId}/approve`, `/auto-break-waivers/${waiverId}/approve`]) {
      expect(await post(app, cookie, path)).toEqual({ status: 409, body: { error: "amend_unsupported_on_d1" } });
    }
    expect(await counts(db, tenantId)).toEqual(before);
    expect((await db.select().from(correctionRequests).where(eq(correctionRequests.id, correctionId)))[0]?.status).toBe("pending");
    expect((await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveId)))[0]?.status).toBe("pending");
    expect((await db.select().from(autoBreakWaivers).where(eq(autoBreakWaivers.id, waiverId)))[0]?.status).toBe("pending");

    // 締めを解除すれば同じ申請が atomic plan で承認できる(運用上の回避手順。closing-guard.ts のコメント)
    expect((await post(app, cookie, "/closings/2026-04/reopen")).status).toBe(200);
    const approved = await post(app, cookie, `/corrections/${correctionId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ amended: false, amendedPeriods: [], request: { status: "approved" } });
  });

  it("without closing.unlock the closed month is still 409 month_closed_requires_unlock (checked before the D1 refusal)", async () => {
    const seeded = await setupTestDb();
    const { db, tenantId, userId } = seeded;
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "attendance.correction.approve", scope: "tenant" });
    const app = createApp({ db, interactiveTransactions: false });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    expect((await post(app, cookie, "/closings/2026-04/close")).status).toBe(200);
    const correction = await post(app, cookie, "/corrections", {
      proposedKind: "clock_in",
      proposedOccurredAt: jstMinutes(2026, 4, 2, 9, 0),
      reason: "打刻忘れ",
    });
    const res = await post(app, cookie, `/corrections/${(correction.body.request as { id: string }).id}/approve`);
    expect(res).toMatchObject({ status: 409, body: { error: "month_closed_requires_unlock" } });
  });

  it("approvals into open months go through the atomic plan (no db.transaction)", async () => {
    const { app, cookie } = await setup();
    const correction = await post(app, cookie, "/corrections", {
      proposedKind: "clock_in",
      proposedOccurredAt: jstMinutes(2026, 5, 7, 9, 0),
      reason: "打刻忘れ",
    });
    const approved = await post(app, cookie, `/corrections/${(correction.body.request as { id: string }).id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ amended: false, appliedEvent: { kind: "clock_in" } });

    const leave = await post(app, cookie, "/leave/requests", { leaveDate: "2026-05-15", reason: "私用のため" });
    expect((await post(app, cookie, `/leave/requests/${(leave.body.request as { id: string }).id}/approve`)).body).toMatchObject({
      amended: false,
      request: { status: "approved" },
    });

    const waiver = await post(app, cookie, "/auto-break-waivers", { waiveDate: "2026-05-07", reason: "休憩を取れなかった" });
    expect((await post(app, cookie, `/auto-break-waivers/${(waiver.body.waiver as { id: string }).id}/approve`)).body).toMatchObject({
      amended: false,
      waiver: { status: "approved" },
    });
  });
});
