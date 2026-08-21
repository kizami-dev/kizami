import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { jstMinutes, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

// テスト対象期間(2026-04)の内側、日界・月境界から十分離れた安全な時刻に固定する。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

interface CorrectionRequestJson {
  id: string;
  userId: string;
  requestedBy: string;
  status: string;
  targetEventId: string | null;
  proposedKind: string | null;
  proposedOccurredAt: number | null;
  reason: string;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  createdAt: number;
}

describe("correction request flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("case 1: addition request -> approve -> reflected in GET /attendance/monthly (missing clock-out day counts correctly)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // clock_in のみ(退勤打刻忘れ)
    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    const clockInRes = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: clockInAt }),
    });
    expect(clockInRes.status).toBe(201);

    // 退勤打刻を追加申請
    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ proposedKind: "clock_out", proposedOccurredAt: clockOutAt, reason: "退勤打刻を忘れた" }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: CorrectionRequestJson }).request;
    expect(created.status).toBe("pending");
    expect(created.targetEventId).toBeNull();

    // 承認前は missing_clock_out 警告が出るはず
    const beforeRes = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const before = (await beforeRes.json()) as { warnings: unknown[] };
    expect(before.warnings.length).toBeGreaterThan(0);

    const approveRes = await app.request(`/corrections/${created.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()) as { request: CorrectionRequestJson; appliedEvent: { kind: string; occurredAt: number } };
    expect(approved.request.status).toBe("approved");
    expect(approved.appliedEvent).toEqual({ id: expect.any(String), kind: "clock_out", occurredAt: clockOutAt });

    // 承認後: 退勤打刻忘れの日が正しく計上され、警告が消える
    const afterRes = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const after = (await afterRes.json()) as { warnings: unknown[]; totals: { statutory: number } };
    expect(after.warnings).toEqual([]);
    expect(after.totals.statutory).toBeGreaterThan(0);
  });

  it("case 2: correction request -> approve -> original event superseded, new event valid", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: clockInAt }),
    });
    const wrongClockOutAt = jstMinutes(2026, 4, 1, 17, 0);
    const wrongClockOutRes = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_out", occurredAt: wrongClockOutAt }),
    });
    const wrongClockOutId = ((await wrongClockOutRes.json()) as { punch: { id: string } }).punch.id;

    const correctClockOutAt = jstMinutes(2026, 4, 1, 19, 0);
    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        targetEventId: wrongClockOutId,
        proposedKind: "clock_out",
        proposedOccurredAt: correctClockOutAt,
        reason: "退勤時刻を間違えた",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: CorrectionRequestJson }).request;

    const approveRes = await app.request(`/corrections/${created.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);

    const from = jstMinutes(2026, 4, 1, 0, 0);
    const to = jstMinutes(2026, 4, 2, 0, 0);
    const listRes = await app.request(`/punches?from=${from}&to=${to}`, { headers: { cookie } });
    const list = (await listRes.json()) as { punches: Array<{ id: string; kind: string; occurredAt: number }> };

    expect(list.punches.some((p) => p.id === wrongClockOutId)).toBe(false);
    expect(list.punches.some((p) => p.kind === "clock_out" && p.occurredAt === correctClockOutAt)).toBe(true);
  });

  it("case 3: cancellation request -> approve -> target event invalidated", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: clockInAt }),
    });
    const mistakenBreakStartAt = jstMinutes(2026, 4, 1, 12, 0);
    const breakStartRes = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "break_start", occurredAt: mistakenBreakStartAt }),
    });
    const breakStartId = ((await breakStartRes.json()) as { punch: { id: string } }).punch.id;

    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ targetEventId: breakStartId, reason: "誤って休憩開始を押した" }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: CorrectionRequestJson }).request;
    expect(created.proposedKind).toBeNull();
    expect(created.proposedOccurredAt).toBeNull();

    const approveRes = await app.request(`/corrections/${created.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()) as { appliedEvent: { kind: string; occurredAt: number } };
    expect(approved.appliedEvent).toEqual({ id: expect.any(String), kind: "void", occurredAt: mistakenBreakStartAt });

    const from = jstMinutes(2026, 4, 1, 0, 0);
    const to = jstMinutes(2026, 4, 2, 0, 0);
    const listRes = await app.request(`/punches?from=${from}&to=${to}`, { headers: { cookie } });
    const list = (await listRes.json()) as { punches: Array<{ id: string; kind: string }> };
    expect(list.punches.some((p) => p.id === breakStartId)).toBe(false);
  });

  it("case 4: a second approval targeting the same already-superseded event returns 409 already_superseded", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const clockOutAt = jstMinutes(2026, 4, 1, 18, 0);
    const clockOutRes = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_out", occurredAt: clockOutAt }),
    });
    const targetId = ((await clockOutRes.json()) as { punch: { id: string } }).punch.id;

    const makeCancellation = async () => {
      const res = await app.request("/corrections", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ targetEventId: targetId, reason: "重複して申請" }),
      });
      return (await res.json()) as { request: CorrectionRequestJson };
    };

    const firstReq = (await makeCancellation()).request;
    const secondReq = (await makeCancellation()).request;

    const firstApprove = await app.request(`/corrections/${firstReq.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(firstApprove.status).toBe(200);

    const secondApprove = await app.request(`/corrections/${secondReq.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(secondApprove.status).toBe(409);
    expect(await secondApprove.json()).toEqual({ error: "already_superseded" });

    // ロールバックされているので申請は pending のまま
    const listRes = await app.request("/corrections?status=pending", { headers: { cookie } });
    const list = (await listRes.json()) as { requests: CorrectionRequestJson[] };
    expect(list.requests.map((r) => r.id)).toEqual([secondReq.id]);
  });

  describe("validation", () => {
    it("rejects a missing reason with 400", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/corrections", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ proposedKind: "clock_in", proposedOccurredAt: jstMinutes(2026, 4, 1, 9, 0) }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_reason" });
    });

    it("rejects a proposedOccurredAt more than 5 minutes in the future with 400", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const now = Math.floor(FIXED_NOW.getTime() / 60_000);
      const res = await app.request("/corrections", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ proposedKind: "clock_in", proposedOccurredAt: now + 6, reason: "未来の打刻" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "proposed_occurred_at_in_future" });
    });

    it("rejects a targetEventId belonging to another user with 400", async () => {
      const { db, tenantId, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      // 2人目の同一テナント内ユーザーを作り、その打刻を作る
      const other = await setupSecondUser(db, tenantId);

      const otherClockInRes = await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: await loginAndGetCookie(app, other.email, other.password) },
        body: JSON.stringify({ kind: "clock_in", occurredAt: jstMinutes(2026, 4, 1, 9, 0) }),
      });
      const otherEventId = ((await otherClockInRes.json()) as { punch: { id: string } }).punch.id;

      const res = await app.request("/corrections", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ targetEventId: otherEventId, reason: "他人のイベントを指定" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_target_event" });
    });

    it("rejects a nonexistent targetEventId with 400", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/corrections", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ targetEventId: "01a0000000000000000000000000", reason: "存在しないID" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_target_event" });
    });

    it("rejects an unauthenticated POST /corrections with 401", async () => {
      const { db } = await setupTestDb();
      const app = createApp({ db });

      const res = await app.request("/corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposedKind: "clock_in", proposedOccurredAt: 100, reason: "reason" }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects an unauthenticated GET /corrections with 401", async () => {
      const { db } = await setupTestDb();
      const app = createApp({ db });

      const res = await app.request("/corrections");
      expect(res.status).toBe(401);
    });
  });

  describe("status transitions", () => {
    async function createPendingRequest(app: ReturnType<typeof createApp>, cookie: string) {
      const res = await app.request("/corrections", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ proposedKind: "clock_in", proposedOccurredAt: jstMinutes(2026, 4, 1, 9, 0), reason: "reason" }),
      });
      return ((await res.json()) as { request: CorrectionRequestJson }).request;
    }

    it("returns 409 not_pending when approving a request that is not pending", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const req = await createPendingRequest(app, cookie);
      const rejectRes = await app.request(`/corrections/${req.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      });
      expect(rejectRes.status).toBe(200);

      const approveRes = await app.request(`/corrections/${req.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      });
      expect(approveRes.status).toBe(409);
      expect(await approveRes.json()).toEqual({ error: "not_pending" });
    });

    it("returns 409 not_pending when approving a withdrawn request", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const req = await createPendingRequest(app, cookie);
      const withdrawRes = await app.request(`/corrections/${req.id}/withdraw`, {
        method: "POST",
        headers: { cookie },
      });
      expect(withdrawRes.status).toBe(200);
      expect(((await withdrawRes.json()) as { request: CorrectionRequestJson }).request.status).toBe("withdrawn");

      const approveRes = await app.request(`/corrections/${req.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      });
      expect(approveRes.status).toBe(409);
      expect(await approveRes.json()).toEqual({ error: "not_pending" });
    });

    it("self-approval records selfApproved: true (v0.1 provisional authorization)", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const req = await createPendingRequest(app, cookie);
      const approveRes = await app.request(`/corrections/${req.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ note: "self-approved for single-tenant ops" }),
      });
      expect(approveRes.status).toBe(200);
      const approved = ((await approveRes.json()) as { request: CorrectionRequestJson }).request;
      expect(approved.decidedBy).toBe(approved.requestedBy);
      expect(approved.decisionNote).toBe("self-approved for single-tenant ops");
    });
  });
});
