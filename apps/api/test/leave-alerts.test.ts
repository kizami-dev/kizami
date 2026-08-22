import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertLeaveGrant, listNotifications, type Database } from "@kizami/db";
import { addDays, addYears } from "@kizami/leave";
import type { NotificationChannel, NotificationMessage } from "@kizami/notify";
import { createApp } from "../src/app.js";
import { runLeaveAlertScan } from "../src/leave-alerts.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

/**
 * runLeaveAlertScan(失効間近・年5日取得義務アラート)のテスト。
 *
 * setupTestDb() のテナントは標準1日480分(フレックス月清算)。TODAY を基準に
 * @kizami/leave の addDays/addYears で日付を組み立てる(手計算による暦の誤りを避けるため)。
 *
 * 段階判定(leave-alerts.ts のコメント参照): 最も緩い段階(60d/90d)は「残日数がちょうど
 * 閾値と一致する日」だけ発火し、最も厳しい段階(7d/30d)は「残日数が閾値以下」で発火する
 * キャッチオール。そのため各テストは「残日数がちょうど何日か」を明示的に作る。
 */

const TODAY = "2026-04-15";
const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00
const FIXED_NOW_MINUTES = Math.floor(FIXED_NOW.getTime() / 60_000);
const MINUTES_PER_DAY = 1440;

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function grantAnnual(
  db: Database,
  params: { tenantId: string; userId: string; grantedOn: string; days: number; expiresOn: string },
) {
  return insertLeaveGrant(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    leaveType: "annual",
    grantedOn: params.grantedOn,
    days: params.days,
    expiresOn: params.expiresOn,
    source: "manual",
    createdAt: 0,
  });
}

/** その日1日分(full_day)の有給申請を作成し、即座に本人承認まで行う(残高を消費するため)。 */
async function requestAndApproveFullDay(app: RequestLike, cookie: string, leaveDate: string): Promise<void> {
  const createRes = await app.request("/leave/requests", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ leaveDate, reason: "私用のため" }),
  });
  expect(createRes.status).toBe(201);
  const created = ((await createRes.json()) as { request: { id: string } }).request;

  const approveRes = await app.request(`/leave/requests/${created.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(approveRes.status).toBe(200);
}

async function enableStockConversion(app: RequestLike, cookie: string): Promise<void> {
  const res = await app.request("/settings/leave", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      grantMethod: "statutory",
      hourlyLeaveEnabled: false,
      hourlyLeaveMaxDays: 5,
      halfDayLeaveEnabled: true,
      stockConversionEnabled: true,
      stockMaxDays: 40,
      stockExpiresMonths: null,
    }),
  });
  expect(res.status).toBe(200);
}

describe("runLeaveAlertScan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- 失効間近 ----

  it("creates leave_expiring_60d once the grant is exactly 60 days from expiry, and is idempotent on re-scan", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const expiresOn = addDays(TODAY, 60);
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn });

    const first = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(first.scannedUserCount).toBe(1);
    expect(first.created).toHaveLength(1);
    expect(first.created[0]?.notification.type).toBe("leave_expiring_60d");
    expect(first.created[0]?.notification.subjectDate).toBe(expiresOn);
    expect(first.created[0]?.notification.body).not.toContain("積立休暇に振り替えられます");

    // 同日中に再スキャンしても重複しない(冪等)
    const second = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES + 5 });
    expect(second.created).toHaveLength(0);

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored.filter((n) => n.type === "leave_expiring_60d")).toHaveLength(1);
  });

  it("does not notify a fully-consumed (zero remaining) grant even at its exact 60-day mark", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const expiresOn = addDays(TODAY, 60);
    // 1日(480分)のみ付与し、同日に全消化する
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 1, expiresOn });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await requestAndApproveFullDay(app, cookie, TODAY);

    const result = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
  });

  it("creates a separate leave_expiring_30d notification once 30 days remain, alongside the existing 60d one", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const expiresOn = addDays(TODAY, 60);
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn });

    const first = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(first.created).toHaveLength(1);
    expect(first.created[0]?.notification.type).toBe("leave_expiring_60d");

    // 30日後(=失効まで残り30日ちょうど)まで時計を進める
    const nowMinutes2 = FIXED_NOW_MINUTES + 30 * MINUTES_PER_DAY;
    vi.setSystemTime(new Date(nowMinutes2 * 60_000));

    const second = await runLeaveAlertScan(db, { nowMinutes: nowMinutes2 });
    expect(second.created).toHaveLength(1);
    expect(second.created[0]?.notification.type).toBe("leave_expiring_30d");
    expect(second.created[0]?.notification.subjectDate).toBe(expiresOn);

    const stored = await listNotifications(db, { tenantId, userId });
    expect(stored.map((n) => n.type).sort()).toEqual(["leave_expiring_30d", "leave_expiring_60d"]);
  });

  it("does not backfill the 60-day notification when the first scan already happens 35 days before expiry", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const expiresOn = addDays(TODAY, 35);
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn });

    const result = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(0);
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(0);
  });

  it("still fires the 7-day (catch-all) notification when the first scan happens after the 7-day mark has passed", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    // 60日・30日のどちらのちょうどの日も逃した状態(残り3日)で初回スキャンする
    const expiresOn = addDays(TODAY, 3);
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn });

    const result = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.type).toBe("leave_expiring_7d");
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(1);
  });

  it("includes the stock-conversion note in the body when the tenant has stock conversion enabled", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const expiresOn = addDays(TODAY, 60);
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn });

    await grantPermission(db, { tenantId, userId, permission: "leave.grant.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    await enableStockConversion(app, cookie);

    const result = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.body).toContain("失効分は積立休暇に振り替えられます");
  });

  // ---- 年5日取得義務 ----

  it("creates leave_mandatory5_90d when 90 days remain until the deadline and there is a shortage", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const deadline = addDays(TODAY, 90);
    const grantedOn = addYears(deadline, -1); // periodEnd(=grantedOn+1年) が ちょうど deadline になるよう逆算する
    // 有給の失効(annual grant の expiresOn)自体は遠い未来にして、失効間近アラートと干渉させない
    const expiresOn = addYears(grantedOn, 5);
    await grantAnnual(db, { tenantId, userId, grantedOn, days: 10, expiresOn });

    const result = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.notification.type).toBe("leave_mandatory5_90d");
    expect(result.created[0]?.notification.subjectDate).toBe(deadline);
    expect(result.created[0]?.notification.body).toContain("時間単位の取得は含められません");
  });

  it("does not notify when the mandatory 5-day requirement is already satisfied", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const deadline = addDays(TODAY, 90);
    const grantedOn = addYears(deadline, -1);
    const expiresOn = addYears(grantedOn, 5);
    await grantAnnual(db, { tenantId, userId, grantedOn, days: 10, expiresOn });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    // 期間内(grantedOn 以降)に full_day を5日取得して義務を満たす
    for (let i = 0; i < 5; i++) {
      await requestAndApproveFullDay(app, cookie, addDays(grantedOn, 10 + i));
    }

    const result = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES });
    expect(result.created.filter((c) => c.notification.type.startsWith("leave_mandatory5_"))).toHaveLength(0);
    expect(
      (await listNotifications(db, { tenantId, userId })).filter((n) => n.type.startsWith("leave_mandatory5_")),
    ).toHaveLength(0);
  });

  // ---- 横断的な確認 ----

  it("dispatches to external channels only for newly created notifications, not for duplicates", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const expiresOn = addDays(TODAY, 60);
    await grantAnnual(db, { tenantId, userId, grantedOn: "2020-01-01", days: 10, expiresOn });

    const sent: NotificationMessage[] = [];
    const fakeChannel: NotificationChannel = {
      name: "fake",
      async send(msg) {
        sent.push(msg);
      },
    };
    const resolveChannels = async () => [fakeChannel];

    const first = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES, resolveChannels });
    expect(first.created).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(first.created[0]?.dispatchResults).toEqual([{ channel: "fake", ok: true }]);

    const second = await runLeaveAlertScan(db, { nowMinutes: FIXED_NOW_MINUTES + 5, resolveChannels });
    expect(second.created).toHaveLength(0);
    expect(sent).toHaveLength(1); // 重複時は再送しない
  });
});
