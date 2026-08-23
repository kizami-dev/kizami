/**
 * 月次締め(v0.3 第一弾)の API テスト。参照: apps/api/src/routes/closings.ts。
 *
 * FIXED_NOW は締め対象月(2026-04)より後(2026-05)に固定し、「既に終わった月を締める」
 * という現実的なシナリオでテストする。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, tenantSettingVersions, uuidv7, type Database } from "@kizami/db";
import { calculate, type EngineInput, type LawTimelineSpan } from "@kizami/engine";
import { buildLawTimeline } from "@kizami/law";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupSecondUser, setupTestDb, switchToFixedWorkPolicy } from "./support/setup.js";

const FIXED_NOW = new Date("2026-05-15T03:00:00.000Z"); // JST 2026-05-15 12:00

// setupTestDb() が作るテナントの法令プロファイル既定値(中小企業・特例措置対象外)と同じもの。
const LAW_TIMELINE: LawTimelineSpan[] = buildLawTimeline("2026-04-01", "2026-04-30", {
  isSmallOrMediumEnterprise: true,
  isSpecialProvisionWorkplace: false,
});

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

interface ClosingEventJson {
  id: string;
  event: "close" | "reopen";
  actorId: string;
  note: string | null;
  occurredAt: number;
}

interface ClosingStateJson {
  period: string;
  status: "open" | "closed";
  lastEvent: ClosingEventJson | null;
  history: ClosingEventJson[];
}

async function getClosing(app: RequestLike, cookie: string, period: string) {
  const res = await app.request(`/closings/${period}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as { closing?: ClosingStateJson; error?: string } };
}

async function closePeriod(app: RequestLike, cookie: string, period: string, note?: string) {
  const res = await app.request(`/closings/${period}/close`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(note !== undefined ? { note } : {}),
  });
  return { status: res.status, body: (await res.json()) as { closing?: ClosingStateJson; error?: string } };
}

async function reopenPeriod(app: RequestLike, cookie: string, period: string, note?: string) {
  const res = await app.request(`/closings/${period}/reopen`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(note !== undefined ? { note } : {}),
  });
  return { status: res.status, body: (await res.json()) as { closing?: ClosingStateJson; error?: string } };
}

async function postPunch(app: RequestLike, cookie: string, kind: string, occurredAt: number) {
  return app.request("/punches", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, occurredAt }),
  });
}

async function getMonthly(app: RequestLike, cookie: string, month: string) {
  const res = await app.request(`/attendance/monthly?month=${month}`, { headers: { cookie } });
  return { status: res.status, body: await res.json() };
}

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

/** action の監査ログの detail(JSON文字列で保存されている afterDigest)を最新1件だけ返す。 */
async function latestAuditDetail(db: Database, tenantId: string, action: string): Promise<unknown> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  const matches = rows.filter((r) => r.action === action);
  const latest = matches[matches.length - 1];
  if (!latest) throw new Error(`no audit log found for action ${action}`);
  return JSON.parse(latest.afterDigest ?? "null");
}

describe("closings API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /closings/:period returns 403 without closing.view", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/closings/2026-04", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("a never-closed period is open with empty history", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status, body } = await getClosing(app, cookie, "2026-04");
    expect(status).toBe(200);
    expect(body.closing).toEqual({ period: "2026-04", status: "open", lastEvent: null, history: [] });
  });

  it("POST close requires closing.execute (403 without it)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status } = await closePeriod(app, cookie, "2026-04");
    expect(status).toBe(403);
  });

  it("POST close rejects a 'department' scope grant (catalog only allows department_and_descendants/tenant)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status } = await closePeriod(app, cookie, "2026-04");
    expect(status).toBe(403);
  });

  it("POST close computes a snapshot, flips status, and records an audit log entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 04/01 09:00-18:00 JST(休憩なし、9時間)
    expect((await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0))).status).toBe(201);
    expect((await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0))).status).toBe(201);

    const beforeClose = await getMonthly(app, cookie, "2026-04");
    expect(beforeClose.body.closing.closed).toBe(false);

    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.view", scope: "tenant" });

    const { status, body } = await closePeriod(app, cookie, "2026-04", "月次確定");
    expect(status).toBe(200);
    expect(body.closing?.status).toBe("closed");
    expect(body.closing?.history).toHaveLength(1);
    expect(body.closing?.history[0]).toMatchObject({ event: "close", actorId: userId, note: "月次確定" });

    expect(await auditActionsFor(db, tenantId)).toContain("closing.close");

    const afterClose = await getMonthly(app, cookie, "2026-04");
    expect(afterClose.status).toBe(200);
    expect(afterClose.body.closing.closed).toBe(true);
    expect(afterClose.body.figures.totals).toEqual(beforeClose.body.figures.totals);
    expect(afterClose.body.figures.flexBalance).toEqual(beforeClose.body.figures.flexBalance);
  });

  // レビュー指摘(締めのサイレントスキップ可視化): テナント設定・制度割当が揃っていない
  // ユーザーは締め計算の対象から静かにスキップされるが、そのユーザーIDが監査ログの detail に
  // skippedUserIds として残ることを確認する。
  it("records skipped user IDs (users without a work policy assignment) in the closing.close audit log detail", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // setupSecondUser は work_policy の割当を行わないため、この2人目は
    // calculateMonthlyForUser が例外を投げてスキップされる。
    const second = await setupSecondUser(db, tenantId);

    expect((await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0))).status).toBe(201);
    expect((await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0))).status).toBe(201);

    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });

    const { status, body } = await closePeriod(app, cookie, "2026-04");
    expect(status).toBe(200);
    expect(body.closing?.status).toBe("closed");

    const detail = (await latestAuditDetail(db, tenantId, "closing.close")) as {
      period: string;
      userCount: number;
      skippedUserIds: string[];
    };
    expect(detail.userCount).toBe(1);
    expect(detail.skippedUserIds).toEqual([second.userId]);
  });

  it("POST close twice returns 409 already_closed", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    expect((await closePeriod(app, cookie, "2026-04")).status).toBe(200);
    const second = await closePeriod(app, cookie, "2026-04");
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_closed");
  });

  it("POST reopen requires closing.unlock (403 without it)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    expect((await closePeriod(app, cookie, "2026-04")).status).toBe(200);
    const res = await reopenPeriod(app, cookie, "2026-04");
    expect(res.status).toBe(403);
  });

  it("POST reopen on an open period returns 409 not_closed", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await reopenPeriod(app, cookie, "2026-04");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_closed");
  });

  it("close -> reopen keeps both events in history and status flips back to open; a re-close appends a third event", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    expect((await closePeriod(app, cookie, "2026-04")).status).toBe(200);

    // occurred_at は分単位(依頼どおり秒を持たない)なので、履歴の順序を意味のある形で
    // 検証するには各操作の間で少なくとも1分は現在時刻を進める必要がある。
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 60_000));
    const reopenRes = await reopenPeriod(app, cookie, "2026-04", "遡及修正のため");
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.closing?.status).toBe("open");
    expect(reopenRes.body.closing?.history.map((e) => e.event)).toEqual(["close", "reopen"]);
    expect(reopenRes.body.closing?.history[1]).toMatchObject({ event: "reopen", actorId: userId, note: "遡及修正のため" });
    expect(await auditActionsFor(db, tenantId)).toEqual(expect.arrayContaining(["closing.close", "closing.reopen"]));

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 120_000));
    const recloseRes = await closePeriod(app, cookie, "2026-04");
    expect(recloseRes.status).toBe(200);
    expect(recloseRes.body.closing?.history.map((e) => e.event)).toEqual(["close", "reopen", "close"]);
  });

  it("GET /closings?from=&to= enumerates every month in range, including ones with no events", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    expect((await closePeriod(app, cookie, "2026-03")).status).toBe(200);

    const res = await app.request("/closings?from=2026-02&to=2026-04", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { closings: ClosingStateJson[] };
    expect(body.closings.map((s) => s.period)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(body.closings.map((s) => s.status)).toEqual(["open", "closed", "open"]);
  });

  it("MOST IMPORTANT: a tenant settings change after close does not alter the closed month's totals/flexBalance", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 深夜帯にかかる勤務(法定休日・日界の設定変更で結果が動くケースを作る)
    expect((await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 5, 9, 0))).status).toBe(201); // 4/5 は日曜
    expect((await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 5, 18, 0))).status).toBe(201);
    expect((await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 10, 20, 0))).status).toBe(201);
    expect((await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 10, 23, 30))).status).toBe(201);

    const beforeClose = await getMonthly(app, cookie, "2026-04");
    expect(beforeClose.body.closing.closed).toBe(false);

    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const closeRes = await closePeriod(app, cookie, "2026-04");
    expect(closeRes.status).toBe(200);

    const snapshotTotals = (await getMonthly(app, cookie, "2026-04")).body;
    expect(snapshotTotals.closing.closed).toBe(true);
    expect(snapshotTotals.figures.totals).toEqual(beforeClose.body.figures.totals);
    expect(snapshotTotals.figures.flexBalance).toEqual(beforeClose.body.figures.flexBalance);

    // 制度変更: 日界を9時間ずらし、法定休日を土曜日に変更する(4/5 の法定休日判定・日別配賦が
    // 変わるはずの、意図的に「結果が動く」変更)。effective_from を締め月より前に置くことで
    // 遡及的に効くはずの変更にする(スナップショットが正しく保護されていれば無視される)。
    await db.insert(tenantSettingVersions).values({
      id: uuidv7(),
      tenantId,
      effectiveFrom: "2026-01-01",
      dayBoundaryMinutes: 300, // 05:00 日界
      legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 6 }), // 土曜を法定休日に変更
      breakRule: JSON.stringify({ mode: "punch" }),
      gpsEnabled: false,
      gpsRetentionDays: null,
      createdAt: 0,
    });

    // 制度変更が実際に有効であることの確認(素の engine.calculate() と比較): 設定を変えると
    // totals が締め前の値から変わるはずである、という前提そのものを検証する。
    const directRecalc = calculate({
      punches: [
        { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 5, 9, 0) },
        { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 5, 18, 0) },
        { kind: "clock_in", occurredAt: jstMinutes(2026, 4, 10, 20, 0) },
        { kind: "clock_out", occurredAt: jstMinutes(2026, 4, 10, 23, 30) },
      ],
      settingsTimeline: [
        {
          from: "2026-01-01",
          settings: {
            tzOffsetMinutes: 540,
            dayBoundaryMinutes: 300,
            weekStartWeekday: 0,
            legalHoliday: { kind: "weekday", weekday: 6 },
            workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
            breakRule: { mode: "punch" },
          },
        },
      ],
      lawTimeline: LAW_TIMELINE,
      period: { year: 2026, month: 4 },
      paidLeave: [],
    } satisfies EngineInput);
    expect(directRecalc.totals).not.toEqual(beforeClose.body.figures.totals);

    // 本題: 締め済み月の /attendance/monthly は、制度変更後もスナップショットのままである。
    const afterSettingsChange = await getMonthly(app, cookie, "2026-04");
    expect(afterSettingsChange.body.closing.closed).toBe(true);
    expect(afterSettingsChange.body.figures.totals).toEqual(beforeClose.body.figures.totals);
    expect(afterSettingsChange.body.figures.flexBalance).toEqual(beforeClose.body.figures.flexBalance);
  });

  it("固定時間制: close -> snapshot -> 読み戻しで flexBalance が null のまま復元される(0埋めに戻らない)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await switchToFixedWorkPolicy(db, { tenantId, standardDayMinutes: 480 });
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 4/1 9:00-19:00(10h、休憩なし)→ 日次法定時間外(8h超)2h が出るはず
    expect((await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0))).status).toBe(201);
    expect((await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 19, 0))).status).toBe(201);

    const beforeClose = await getMonthly(app, cookie, "2026-04");
    expect(beforeClose.body.closing.closed).toBe(false);
    expect(beforeClose.body.workSystem).toBe("fixed");
    expect(beforeClose.body.figures.flexBalance).toBeNull();
    expect(beforeClose.body.figures.totals.overtime).toBe(120); // 2h

    const closeRes = await closePeriod(app, cookie, "2026-04");
    expect(closeRes.status).toBe(200);

    const afterClose = await getMonthly(app, cookie, "2026-04");
    expect(afterClose.body.closing.closed).toBe(true);
    // 0埋めのデフォルト({frameMinutes:0,...})に戻っていないことが本題。
    expect(afterClose.body.figures.flexBalance).toBeNull();
    expect(afterClose.body.figures.totals).toEqual(beforeClose.body.figures.totals);
  });
});
