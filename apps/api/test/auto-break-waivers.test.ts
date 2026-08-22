/**
 * 休憩自動控除の打ち消し申請フロー(routes/auto-break-waivers.ts)の統合テスト。
 * 参照: docs/design/breaks.md、packages/engine/src/auto-break.ts、
 * apps/api/test/corrections.test.ts・closing-amend.test.ts(締め後修正の検証手法を踏襲)。
 *
 * 通知(POST /:id/approve が送る本人宛通知)は createApp に notify 依存を渡さないため、
 * smtpSendFn が無く・個人 webhook も未設定のまま(buildPersonalChannels は空チャネルを返す)
 * = 外部への実送信は一切発生しない(notification-channels-personal.test.ts と同じ前提)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setBreakRule, setupSecondUser, setupTestDb } from "./support/setup.js";

// テスト対象期間(2026-04)の内側、日界・月境界から十分離れた安全な時刻に固定する(corrections.test.ts と同じ流儀)。
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

interface WaiverJson {
  id: string;
  userId: string;
  requestedBy: string;
  status: string;
  waiveDate: string;
  reason: string;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  createdAt: number;
}

interface MonthlyJson {
  closed: boolean;
  amended: boolean;
  totals: { statutory: number; overtime: number };
  warnings: Array<{ kind: string; date: string; punchAt?: number; break?: { requiredMinutes: number; actualMinutes: number } }>;
  days: Array<{ date: string; autoDeductedBreakMinutes: number; breakMinutes: number; workedMinutes: number }>;
}

async function postPunch(app: RequestLike, cookie: string, kind: string, occurredAt: number) {
  const res = await app.request("/punches", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, occurredAt }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { punch: { id: string } }).punch;
}

async function createWaiver(app: RequestLike, cookie: string, waiveDate: string, reason = "体調不良で休憩を取れなかった") {
  const res = await app.request("/auto-break-waivers", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ waiveDate, reason }),
  });
  return { status: res.status, body: (await res.json()) as { waiver: WaiverJson; targetMonthClosed: boolean } };
}

async function approveWaiver(app: RequestLike, cookie: string, id: string) {
  const res = await app.request(`/auto-break-waivers/${id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function getMonthly(app: RequestLike, cookie: string, month: string): Promise<MonthlyJson> {
  const res = await app.request(`/attendance/monthly?month=${month}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json() as Promise<MonthlyJson>;
}

async function closePeriod(app: RequestLike, cookie: string, period: string) {
  const res = await app.request(`/closings/${period}/close`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
}

describe("auto break waivers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto mode: 9h shift with no punched break is auto-deducted 60min and raises no warnings", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const monthly = await getMonthly(app, cookie, "2026-04");
    const day = monthly.days.find((d) => d.date === "2026-04-01");
    expect(day?.autoDeductedBreakMinutes).toBe(60);
    expect(day?.breakMinutes).toBe(0);
    expect(day?.workedMinutes).toBe(480); // 9h - 60min
    expect(monthly.warnings).toEqual([]);
  });

  it("both mode: 30min punched break + 60min rule deducts only the 30min shortfall", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "both", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "break_start", jstMinutes(2026, 4, 1, 12, 0));
    await postPunch(app, cookie, "break_end", jstMinutes(2026, 4, 1, 12, 30));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const monthly = await getMonthly(app, cookie, "2026-04");
    const day = monthly.days.find((d) => d.date === "2026-04-01");
    expect(day?.breakMinutes).toBe(30); // 打刻由来
    expect(day?.autoDeductedBreakMinutes).toBe(30); // 60分ルール - 打刻30分 = 追加30分だけ
    expect(day?.workedMinutes).toBe(480); // 9h - 30min(打刻) - 30min(自動) = 8h
    expect(monthly.warnings).toEqual([]);
  });

  it("waiver approval removes the auto deduction and reveals an insufficient_break warning (engine wiring)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    await grantPermission(db, { tenantId, userId, permission: "attendance.correction.approve", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const before = await getMonthly(app, cookie, "2026-04");
    const beforeDay = before.days.find((d) => d.date === "2026-04-01");
    expect(beforeDay?.autoDeductedBreakMinutes).toBe(60);
    expect(before.warnings).toEqual([]);

    const { status: createStatus, body: created } = await createWaiver(app, cookie, "2026-04-01");
    expect(createStatus).toBe(201);
    expect(created.waiver.status).toBe("pending");
    expect(created.targetMonthClosed).toBe(false);

    const { status: approveStatus, body: approved } = await approveWaiver(app, cookie, created.waiver.id);
    expect(approveStatus).toBe(200);
    expect(approved.amended).toBe(false); // 未締め月なので amend 扱いにはならない

    const after = await getMonthly(app, cookie, "2026-04");
    const afterDay = after.days.find((d) => d.date === "2026-04-01");
    expect(afterDay?.autoDeductedBreakMinutes).toBe(0);
    expect(afterDay?.workedMinutes).toBe(540); // 控除が消え9hのまま
    expect(after.warnings).toHaveLength(1);
    expect(after.warnings[0]).toMatchObject({
      kind: "insufficient_break",
      date: "2026-04-01",
      break: { requiredMinutes: 60, actualMinutes: 0 },
    });
  });

  it("approving a waiver for a closed month runs the amend flow and updates the snapshot", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    await grantPermission(db, { tenantId, userId, permission: "attendance.correction.approve", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    await closePeriod(app, cookie, "2026-04");

    const before = await getMonthly(app, cookie, "2026-04");
    expect(before.closed).toBe(true);
    expect(before.amended).toBe(false);

    // 判断点(このテストのためのメモ): closing_events の並び順は (occurred_at, id) で決める
    // (packages/db/src/queries/closings.ts)。id は uuidv7 だが乱数部で終端の順序が決まるため、
    // 同一分内に複数の closing_events(close と amend)を作ると occurred_at が完全一致し、
    // id の乱数部の大小関係だけで「どちらが新しいか」が決まってしまう(たまたま amend の id が
    // close の id より辞書順で小さいと、amend の方が古い扱いになり現在世代の判定を誤る)。
    // 現実の運用では締めと承認が同じ分内に起きることは稀だが、fake timers で時刻を凍結する
    // このテストでは容易に再現するため、amend 前に時刻を進めて occurred_at を確実に
    // ずらす(締め後修正は実運用でも締めより後の時刻に起きるので、時刻を進めること自体は
    // シナリオとして不自然ではない)。
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 5 * 60_000));

    const { status: createStatus, body: created } = await createWaiver(app, cookie, "2026-04-01");
    expect(createStatus).toBe(201);
    expect(created.targetMonthClosed).toBe(true); // 締め済み月でも申請は作れる

    const { status: approveStatus, body: approved } = await approveWaiver(app, cookie, created.waiver.id);
    expect(approveStatus).toBe(200);
    expect(approved.amended).toBe(true);

    const after = await getMonthly(app, cookie, "2026-04");
    expect(after.closed).toBe(true);
    expect(after.amended).toBe(true);
    // 控除60分が消えた分、実働(statutory)が60分増える
    expect(after.totals.statutory - before.totals.statutory).toBe(60);

    const closingRes = await app.request("/closings/2026-04", { headers: { cookie } });
    const closing = (await closingRes.json()) as { closing: { history: Array<{ event: string }> } };
    expect(closing.closing.history.map((e) => e.event)).toEqual(["close", "amend"]);
  });

  it("approving the same waived date twice conflicts with 409 (DB-level approved-unique guard)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    await grantPermission(db, { tenantId, userId, permission: "attendance.correction.approve", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const { body: first } = await createWaiver(app, cookie, "2026-04-01", "1件目");
    const { body: second } = await createWaiver(app, cookie, "2026-04-01", "2件目(同日への重複申請)");

    const firstApprove = await approveWaiver(app, cookie, first.waiver.id);
    expect(firstApprove.status).toBe(200);

    const secondApprove = await approveWaiver(app, cookie, second.waiver.id);
    expect(secondApprove.status).toBe(409);
    expect(secondApprove.body).toEqual({ error: "already_approved" });
  });

  it("approving without attendance.correction.approve is rejected with 403", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    // approver には権限を付与しない
    const { email: approverEmail, password: approverPassword } = await setupSecondUser(db, tenantId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    const { body: created } = await createWaiver(app, cookie, "2026-04-01");

    const approverCookie = await loginAndGetCookie(app, approverEmail, approverPassword);
    const res = await app.request(`/auto-break-waivers/${created.waiver.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: approverCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);

    // 何も変わっていない(申請は pending のまま)
    const listRes = await app.request("/auto-break-waivers?status=pending", { headers: { cookie } });
    const pending = ((await listRes.json()) as { requests: WaiverJson[] }).requests;
    expect(pending.map((w) => w.id)).toContain(created.waiver.id);
  });

  it("GET /auto-break-waivers scopes: without view_all only own requests are visible; approve permission implies view_all", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    const { userId: otherUserId, email: otherEmail, password: otherPassword } = await setupSecondUser(db, tenantId);
    const app = createApp({ db });

    const cookie = await loginAndGetCookie(app, email, password);
    const otherCookie = await loginAndGetCookie(app, otherEmail, otherPassword);

    await createWaiver(app, cookie, "2026-04-01", "本人分");
    await createWaiver(app, otherCookie, "2026-04-02", "他者分");

    // 権限なしの本人視点: 自分の分だけ
    const ownListRes = await app.request("/auto-break-waivers?status=all", { headers: { cookie } });
    const ownList = ((await ownListRes.json()) as { requests: WaiverJson[] }).requests;
    expect(ownList).toHaveLength(1);
    expect(ownList[0]?.reason).toBe("本人分");

    // attendance.correction.approve は view_all を含意する(packages/authz/src/implied.ts)
    await grantPermission(db, { tenantId, userId: otherUserId, permission: "attendance.correction.approve", scope: "tenant" });
    const scopedListRes = await app.request("/auto-break-waivers?status=all", { headers: { cookie: otherCookie } });
    const scopedList = ((await scopedListRes.json()) as { requests: WaiverJson[] }).requests;
    expect(scopedList.map((w) => w.reason).sort()).toEqual(["他者分", "本人分"]);
  });

  it("withdraw: only the requester can withdraw a pending waiver", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    await setBreakRule(db, {
      tenantId,
      breakRule: { mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 60 }] },
    });
    const { email: otherEmail, password: otherPassword } = await setupSecondUser(db, tenantId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const otherCookie = await loginAndGetCookie(app, otherEmail, otherPassword);

    const { body: created } = await createWaiver(app, cookie, "2026-04-01");

    const forbidden = await app.request(`/auto-break-waivers/${created.waiver.id}/withdraw`, {
      method: "POST",
      headers: { cookie: otherCookie },
    });
    expect(forbidden.status).toBe(403);

    const ok = await app.request(`/auto-break-waivers/${created.waiver.id}/withdraw`, {
      method: "POST",
      headers: { cookie },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { waiver: WaiverJson }).waiver.status).toBe("withdrawn");
  });
});

describe("POST /settings/attendance breakRule validation (auto/both)", () => {
  const CALENDAR_PERMISSION = "tenant_settings.calendar.manage";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function body(breakRule: unknown) {
    return {
      effectiveFrom: "2026-05-01",
      dayBoundaryMinutes: 0,
      weekStartWeekday: 0,
      legalHolidayRule: { kind: "weekday", weekday: 0 },
      breakRule,
      gpsEnabled: false,
      gpsRetentionDays: null,
    };
  }

  it("accepts a valid ascending auto/both rules array", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(
        body({
          mode: "both",
          rules: [
            { overMinutes: 360, deductMinutes: 45 },
            { overMinutes: 480, deductMinutes: 60 },
          ],
        }),
      ),
    });
    expect(res.status).toBe(201);
  });

  it("rejects rules in descending/non-strict order", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(
        body({
          mode: "auto",
          rules: [
            { overMinutes: 480, deductMinutes: 60 },
            { overMinutes: 360, deductMinutes: 45 },
          ],
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_break_rule" });
  });

  it("rejects an empty rules array for auto/both mode", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body({ mode: "auto", rules: [] })),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_break_rule" });
  });

  it("rejects negative overMinutes / non-positive deductMinutes", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const negativeOver = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body({ mode: "auto", rules: [{ overMinutes: -10, deductMinutes: 45 }] })),
    });
    expect(negativeOver.status).toBe(400);
    expect(await negativeOver.json()).toEqual({ error: "invalid_break_rule" });

    const zeroDeduct = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body({ mode: "auto", rules: [{ overMinutes: 360, deductMinutes: 0 }] })),
    });
    expect(zeroDeduct.status).toBe(400);
    expect(await zeroDeduct.json()).toEqual({ error: "invalid_break_rule" });
  });

  it("rejects a rules array longer than the 3-rule cap", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: CALENDAR_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(
        body({
          mode: "auto",
          rules: [
            { overMinutes: 100, deductMinutes: 10 },
            { overMinutes: 200, deductMinutes: 20 },
            { overMinutes: 300, deductMinutes: 30 },
            { overMinutes: 400, deductMinutes: 40 },
          ],
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_break_rule" });
  });
});
