/**
 * 締め後修正(amend)のテスト。参照: apps/api/src/lib/closing-guard.ts(assertAmendAllowed)・
 * closing-amend.ts、apps/api/src/routes/corrections.ts・leave.ts・attendance.ts・exports.ts。
 *
 * POST /punches が締め済み月に対して引き続き 409 month_closed を返すこと、および
 * POST /corrections 作成時に closing.unlock 無しで 409 になることは
 * apps/api/test/closing-guard.test.ts でカバー済みのため、ここでは重複させない。
 */

import { describe, expect, it } from "vitest";
import { insertLeaveGrant, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb, switchToFixedWorkPolicy } from "./support/setup.js";

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function postPunch(app: RequestLike, cookie: string, kind: string, occurredAt: number) {
  const res = await app.request("/punches", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, occurredAt }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { punch: { id: string; kind: string; occurredAt: number } }).punch;
}

async function closePeriod(app: RequestLike, cookie: string, period: string) {
  const res = await app.request(`/closings/${period}/close`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
}

async function getMonthly(app: RequestLike, cookie: string, month: string) {
  const res = await app.request(`/attendance/monthly?month=${month}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    closed: boolean;
    amended: boolean;
    totals: { statutory: number; overtime: number };
    flexBalance: { frameMinutes: number; actualMinutes: number; diffMinutes: number };
    originalTotals?: { statutory: number; overtime: number };
    originalFlexBalance?: { frameMinutes: number; actualMinutes: number; diffMinutes: number };
  }>;
}

async function getClosingHistory(app: RequestLike, cookie: string, period: string) {
  const res = await app.request(`/closings/${period}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (
    (await res.json()) as {
      closing: {
        status: string;
        history: Array<{ event: string; correctionRequestId: string | null; leaveRequestId: string | null }>;
      };
    }
  ).closing;
}

async function parseCsv(app: RequestLike, cookie: string, month: string, compareOriginal: boolean) {
  const query = compareOriginal ? `?month=${month}&compare=original` : `?month=${month}`;
  const res = await app.request(`/exports/attendance.csv${query}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const text = (await res.text()).replace(/^﻿/, "");
  const lines = text.split("\r\n").filter((l) => l.length > 0);
  const [headerLine, ...rest] = lines;
  const header = (headerLine ?? "").split(",");
  const rows = rest.map((l) => l.split(","));
  return { header, rows };
}

/** 修正申請(打刻追加)を作成する共通ヘルパ。 */
async function createAdditionCorrection(app: RequestLike, cookie: string, occurredAt: number, kind: string, reason: string) {
  const res = await app.request("/corrections", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ proposedKind: kind, proposedOccurredAt: occurredAt, reason }),
  });
  return { status: res.status, body: (await res.json()) as { request: { id: string }; targetMonthClosed: boolean } };
}

async function approveCorrection(app: RequestLike, cookie: string, id: string) {
  const res = await app.request(`/corrections/${id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("closing amend (post-close corrections)", () => {
  it("approving a correction for a closed month, with closing.unlock, reflects the change while keeping the month closed and records amended totals", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 4/1 9:00-18:00(9時間、休憩無し)で1日分の実績を作り、4月を締める
    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    const clockOut = await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    await closePeriod(app, cookie, "2026-04");

    const beforeMonthly = await getMonthly(app, cookie, "2026-04");
    expect(beforeMonthly.closed).toBe(true);
    expect(beforeMonthly.amended).toBe(false);

    // 締め後、退勤打刻が実は19:00だったことが判明 → 訂正申請(締め済み月でも作成できる)
    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        targetEventId: clockOut.id,
        proposedKind: "clock_out",
        proposedOccurredAt: jstMinutes(2026, 4, 1, 19, 0),
        reason: "退勤打刻が1時間ずれていた",
      }),
    });
    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.json()) as { request: { id: string }; targetMonthClosed: boolean };
    const created = createdBody.request;
    expect(createdBody.targetMonthClosed).toBe(true);

    const { status, body } = await approveCorrection(app, cookie, created.id);
    expect(status).toBe(200);
    expect(body.amended).toBe(true);
    expect(body.amendedPeriods).toEqual(["2026-04"]);

    // 締め状態は closed のまま(amend は解除しない)
    const closing = await getClosingHistory(app, cookie, "2026-04");
    expect(closing.status).toBe("closed");
    expect(closing.history.map((e) => e.event)).toEqual(["close", "amend"]);
    const amendEvent = closing.history[1];
    expect(amendEvent?.correctionRequestId).toBe(created.id);
    expect(amendEvent?.leaveRequestId).toBeNull();

    // 月次: amended=true、totals は増え、originalTotals は締め時点の値のまま
    const afterMonthly = await getMonthly(app, cookie, "2026-04");
    expect(afterMonthly.closed).toBe(true);
    expect(afterMonthly.amended).toBe(true);
    expect(afterMonthly.originalTotals).toEqual(beforeMonthly.totals);
    // 退勤が1時間後ろにずれた分、実働(statutory)が60分増える(月間フレックス枠に対しては
    // まだ大きく余裕があるため overtime には乗らない — 区分けは月枠との比較で決まる)
    expect(afterMonthly.totals.statutory - (afterMonthly.originalTotals?.statutory ?? 0)).toBe(60);
  });

  it("approving a correction for a closed month without closing.unlock is rejected with 409 month_closed_requires_unlock, and nothing changes", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    // closing.execute のみ(closing.unlock は付与しない)
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    await closePeriod(app, cookie, "2026-04");

    const { body: created } = await createAdditionCorrection(
      app,
      cookie,
      jstMinutes(2026, 4, 2, 9, 0),
      "clock_in",
      "打刻漏れ",
    );
    expect(created.targetMonthClosed).toBe(true);

    const { status, body } = await approveCorrection(app, cookie, created.request.id);
    expect(status).toBe(409);
    expect(body).toEqual({ error: "month_closed_requires_unlock" });

    // 何も反映されていない(申請は pending のまま)
    const listRes = await app.request("/corrections?status=pending", { headers: { cookie } });
    const pending = ((await listRes.json()) as { requests: Array<{ id: string }> }).requests;
    expect(pending.map((r) => r.id)).toContain(created.request.id);
  });

  it("amending twice creates 3 snapshot generations; the original stays pinned to the first close", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    await closePeriod(app, cookie, "2026-04");
    const originalMonthly = await getMonthly(app, cookie, "2026-04");

    // 1回目の amend: 4/2 に打刻追加(clock_in のみ)
    const { body: firstCreate } = await createAdditionCorrection(app, cookie, jstMinutes(2026, 4, 2, 9, 0), "clock_in", "1回目");
    const first = await approveCorrection(app, cookie, firstCreate.request.id);
    expect(first.status).toBe(200);
    const afterFirst = await getMonthly(app, cookie, "2026-04");
    expect(afterFirst.amended).toBe(true);
    expect(afterFirst.originalTotals).toEqual(originalMonthly.totals);

    // 2回目の amend: 4/2 の退勤打刻を追加
    const { body: secondCreate } = await createAdditionCorrection(app, cookie, jstMinutes(2026, 4, 2, 17, 0), "clock_out", "2回目");
    const second = await approveCorrection(app, cookie, secondCreate.request.id);
    expect(second.status).toBe(200);

    const closing = await getClosingHistory(app, cookie, "2026-04");
    expect(closing.status).toBe("closed");
    expect(closing.history.map((e) => e.event)).toEqual(["close", "amend", "amend"]);

    const afterSecond = await getMonthly(app, cookie, "2026-04");
    expect(afterSecond.amended).toBe(true);
    // 世代を2回重ねても originalTotals は最初の close のまま変わらない
    expect(afterSecond.originalTotals).toEqual(originalMonthly.totals);
    // 4/2分の労働(8h)が丸ごと追加されているので、最新の statutory は当初より増えている
    expect(afterSecond.totals.statutory).toBeGreaterThan(originalMonthly.totals.statutory);
  });

  it("GET /exports/attendance.csv?compare=original reports original/diff columns matching the actual amend", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    const clockOut = await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    await closePeriod(app, cookie, "2026-04");
    const before = await getMonthly(app, cookie, "2026-04");

    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        targetEventId: clockOut.id,
        proposedKind: "clock_out",
        proposedOccurredAt: jstMinutes(2026, 4, 1, 19, 0),
        reason: "退勤打刻の訂正",
      }),
    });
    const created = ((await createRes.json()) as { request: { id: string } }).request;
    const approveRes = await approveCorrection(app, cookie, created.id);
    expect(approveRes.status).toBe(200);
    const after = await getMonthly(app, cookie, "2026-04");

    const { header, rows } = await parseCsv(app, cookie, "2026-04", true);
    expect(header).toEqual([
      "user_id",
      "user_name",
      "email",
      "period",
      "statutory_minutes",
      "overtime_minutes",
      "overtime60h_minutes",
      "late_night_minutes",
      "statutory_holiday_minutes",
      "work_system",
      "flex_frame_minutes",
      "flex_actual_minutes",
      "flex_diff_minutes",
      "fixed_within_scheduled_minutes",
      "fixed_extra_within_statutory_minutes",
      "closed",
      "original_statutory_minutes",
      "original_overtime_minutes",
      "original_overtime60h_minutes",
      "original_late_night_minutes",
      "original_statutory_holiday_minutes",
      "original_flex_frame_minutes",
      "original_flex_actual_minutes",
      "original_flex_diff_minutes",
      "original_fixed_within_scheduled_minutes",
      "original_fixed_extra_within_statutory_minutes",
      "diff_statutory_minutes",
      "diff_overtime_minutes",
      "diff_overtime60h_minutes",
      "diff_late_night_minutes",
      "diff_statutory_holiday_minutes",
      "diff_flex_frame_minutes",
      "diff_flex_actual_minutes",
      "diff_flex_diff_minutes",
      "diff_fixed_within_scheduled_minutes",
      "diff_fixed_extra_within_statutory_minutes",
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0] as string[];
    expect(Number(row[4])).toBe(after.totals.statutory); // statutory_minutes (現在値)
    expect(Number(row[16])).toBe(before.totals.statutory); // original_statutory_minutes
    expect(Number(row[26])).toBe(after.totals.statutory - before.totals.statutory); // diff_statutory_minutes
    expect(Number(row[26])).toBe(60);
  });

  it("without compare=original the CSV header/columns are unchanged (no original_*/diff_* columns)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const { header } = await parseCsv(app, cookie, "2026-04", false);
    expect(header).toEqual([
      "user_id",
      "user_name",
      "email",
      "period",
      "statutory_minutes",
      "overtime_minutes",
      "overtime60h_minutes",
      "late_night_minutes",
      "statutory_holiday_minutes",
      "work_system",
      "flex_frame_minutes",
      "flex_actual_minutes",
      "flex_diff_minutes",
      "fixed_within_scheduled_minutes",
      "fixed_extra_within_statutory_minutes",
      "closed",
    ]);
  });

  it("固定時間制: 締め後修正(amend)を挟んでも所定内/法定内残業の内訳が正しく更新される(0に潰れない)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await switchToFixedWorkPolicy(db, { tenantId, standardDayMinutes: 420 }); // 所定7h
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 4/1 9:00-16:00(7h、休憩無し)→ 所定7hちょうどなので法定内残業は0
    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    const clockOut = await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 16, 0));
    await closePeriod(app, cookie, "2026-04");

    const { rows: beforeRows } = await parseCsv(app, cookie, "2026-04", false);
    const beforeRow = beforeRows[0] as string[];
    expect(Number(beforeRow[13])).toBe(420); // fixed_within_scheduled_minutes
    expect(Number(beforeRow[14])).toBe(0); // fixed_extra_within_statutory_minutes

    // 締め後、退勤打刻が実は17:00(8h)だったことが判明
    // → 所定7h超〜法定8h以内の1hが新たに法定内残業として発生するはず
    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        targetEventId: clockOut.id,
        proposedKind: "clock_out",
        proposedOccurredAt: jstMinutes(2026, 4, 1, 17, 0),
        reason: "退勤打刻の訂正(所定内→法定内残業が発生するケース)",
      }),
    });
    const created = ((await createRes.json()) as { request: { id: string } }).request;
    const approveRes = await approveCorrection(app, cookie, created.id);
    expect(approveRes.status).toBe(200);

    const { rows: afterRows } = await parseCsv(app, cookie, "2026-04", false);
    const afterRow = afterRows[0] as string[];
    expect(Number(afterRow[13])).toBe(420); // fixed_within_scheduled_minutes(所定は変わらない)
    expect(Number(afterRow[14])).toBe(60); // fixed_extra_within_statutory_minutes(1h 増えた。0に潰れていない)
  });

  it("approving a leave request for a closed month (with closing.unlock) amends flex actual minutes by standardDayMinutes", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
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
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 4/1 のみ実働(4/15は休暇にする)
    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    await closePeriod(app, cookie, "2026-04");
    const before = await getMonthly(app, cookie, "2026-04");
    expect(before.amended).toBe(false);

    // 締め後に有給申請(全休、締め済み月でも作成できる)
    const leaveCreateRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-15", reason: "私用のため" }),
    });
    expect(leaveCreateRes.status).toBe(201);
    const leaveCreated = (await leaveCreateRes.json()) as { request: { id: string }; targetMonthClosed: boolean };
    expect(leaveCreated.targetMonthClosed).toBe(true);

    const approveRes = await app.request(`/leave/requests/${leaveCreated.request.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as { amended: boolean };
    expect(approveBody.amended).toBe(true);

    const closing = await getClosingHistory(app, cookie, "2026-04");
    expect(closing.status).toBe("closed");
    expect(closing.history.map((e) => e.event)).toEqual(["close", "amend"]);
    expect(closing.history[1]?.leaveRequestId).toBe(leaveCreated.request.id);
    expect(closing.history[1]?.correctionRequestId).toBeNull();

    const after = await getMonthly(app, cookie, "2026-04");
    expect(after.amended).toBe(true);
    // フルタイム有給1日分(standardDayMinutes=480)がフレックス実績に丸ごと加算される
    expect(after.flexBalance.actualMinutes - (before.flexBalance.actualMinutes ?? 0)).toBe(480);
    expect(after.originalFlexBalance).toEqual(before.flexBalance);
  });

  it("closing a month includes already-approved paid leave in the snapshot (regression: close ignored paid leave)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
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
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    // **締める前に**有給を承認しておく
    const leaveCreateRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-15", reason: "私用のため" }),
    });
    expect(leaveCreateRes.status).toBe(201);
    const leaveCreated = (await leaveCreateRes.json()) as { request: { id: string } };
    const approveRes = await app.request(`/leave/requests/${leaveCreated.request.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);

    const beforeClose = await getMonthly(app, cookie, "2026-04");
    await closePeriod(app, cookie, "2026-04");
    const afterClose = await getMonthly(app, cookie, "2026-04");

    // 締めたときのスナップショットは、締める前の(有給を含む)集計と一致しなければならない。
    // 以前は締め処理が paidLeave を無視しており、確定値から有給1日分が欠落していた。
    expect(afterClose.closed).toBe(true);
    expect(afterClose.flexBalance.actualMinutes).toBe(beforeClose.flexBalance.actualMinutes);
    // 実働540分(9:00-18:00、休憩打刻なし)+ 有給480分
    expect(afterClose.flexBalance.actualMinutes).toBe(540 + 480);
  });

  it("approving a leave request for a closed month without closing.unlock is rejected with 409 month_closed_requires_unlock", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
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
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    await closePeriod(app, cookie, "2026-04");

    const leaveCreateRes = await app.request("/leave/requests", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ leaveDate: "2026-04-15", reason: "私用のため" }),
    });
    const leaveCreated = (await leaveCreateRes.json()) as { request: { id: string } };

    const approveRes = await app.request(`/leave/requests/${leaveCreated.request.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(409);
    expect(await approveRes.json()).toEqual({ error: "month_closed_requires_unlock" });
  });
});
