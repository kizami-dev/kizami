/**
 * コアタイム(labor law §32-3、docs/design/work-systems.md「コアタイム」)の
 * 設定 API・タイムライン解決・警告のシリアライズを通しで固定するテスト(2026-08-24 追加)。
 *
 * KIZAMI におけるコアタイムは「警告だけを出し、集計は一切変えない」設定であるため、
 * ここでも totals / flexBalance が変わらないことを明示的に確認する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7, workPolicies, workPolicyVersions, type Database } from "@kizami/db";
import { buildSettingsTimeline } from "../src/lib/settings.js";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const PERMISSION = "tenant_settings.flex.manage";

const FIXED_NOW = new Date("2026-04-15T03:00:00.000Z"); // JST 2026-04-15 12:00

/** 10:00〜15:00・月〜金のコアタイム。 */
const CORE_10_15 = { startMinutes: 600, endMinutes: 900, weekdays: [1, 2, 3, 4, 5] };

/**
 * setupTestDb() が作った work_policy に版を直接追記する
 * (POST /settings/work-policy は過去日を拒否するため、対象月に効く版を作るには DB を直接使う。
 * settings-timeline-resolution.test.ts と同じ手法)。
 */
async function appendFlexVersionWithCore(
  db: Database,
  params: { tenantId: string; effectiveFrom: string; core: string | null },
): Promise<void> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, params.tenantId)).limit(1);
  const workPolicyId = rows[0]?.id;
  if (!workPolicyId) throw new Error("no work_policies row for tenant");

  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    workPolicyId,
    effectiveFrom: params.effectiveFrom,
    kind: "flex",
    settlementPeriod: "monthly",
    core: params.core,
    standardDayMinutes: 480,
    createdAt: 0,
  });
}

describe("コアタイム: POST/GET /settings/work-policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    return { db, tenantId, userId, app, cookie };
  }

  function postBody(core: unknown) {
    return JSON.stringify({
      effectiveFrom: "2026-05-01",
      kind: "flex",
      settlementPeriod: "monthly",
      standardDayMinutes: 480,
      ...(core === undefined ? {} : { core }),
    });
  }

  it("round-trip: POST したコアタイムが GET でそのまま返る", async () => {
    const { app, cookie } = await setup();

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: postBody(CORE_10_15),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).version.core).toEqual(CORE_10_15);

    const getBody = await (await app.request("/settings/work-policy", { headers: { cookie } })).json();
    const created = getBody.history.find((v: { effectiveFrom: string }) => v.effectiveFrom === "2026-05-01");
    expect(created.core).toEqual(CORE_10_15);
    // "今日"(2026-04-15)時点の実効版はまだコアタイムなしの初版
    expect(getBody.effective.core).toBeNull();
  });

  it("core を省略すると「コアタイムなし」(null)として保存される", async () => {
    const { app, cookie } = await setup();

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: postBody(undefined),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).version.core).toBeNull();
  });

  it("weekdays を省略した core も受け付ける(エンジン既定の月〜金が適用される)", async () => {
    const { app, cookie } = await setup();

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: postBody({ startMinutes: 600, endMinutes: 900 }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).version.core).toEqual({ startMinutes: 600, endMinutes: 900 });
  });

  it("終了 <= 開始(日跨ぎ・ゼロ幅)は 400 invalid_core_time", async () => {
    const { app, cookie } = await setup();

    for (const core of [
      { startMinutes: 900, endMinutes: 600 }, // 日跨ぎ相当
      { startMinutes: 600, endMinutes: 600 }, // ゼロ幅
    ]) {
      const res = await app.request("/settings/work-policy", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: postBody(core),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_core_time" });
    }
  });

  it("0〜1440 の範囲外・非整数は 400 invalid_core_time", async () => {
    const { app, cookie } = await setup();

    for (const core of [
      { startMinutes: -1, endMinutes: 900 },
      { startMinutes: 600, endMinutes: 1441 },
      { startMinutes: 600.5, endMinutes: 900 },
      { startMinutes: "10:00", endMinutes: 900 },
    ]) {
      const res = await app.request("/settings/work-policy", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: postBody(core),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_core_time" });
    }
  });

  it("weekdays が空配列・範囲外なら 400 invalid_core_time_weekdays", async () => {
    const { app, cookie } = await setup();

    for (const weekdays of [[], [7], [1, 9]]) {
      const res = await app.request("/settings/work-policy", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: postBody({ ...CORE_10_15, weekdays }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_core_time_weekdays" });
    }
  });

  it("kind = fixed ではリクエストの core を無視して null で保存する", async () => {
    const { app, cookie } = await setup();

    const res = await app.request("/settings/work-policy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        effectiveFrom: "2026-05-01",
        kind: "fixed",
        settlementPeriod: "monthly",
        standardDayMinutes: 480,
        core: CORE_10_15,
      }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).version.core).toBeNull();
  });
});

describe("コアタイム: buildSettingsTimeline の解決", () => {
  it("work_policy_versions.core が flex の WorkSystem.core として復元される", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await appendFlexVersionWithCore(db, {
      tenantId,
      effectiveFrom: "2026-04-10",
      core: JSON.stringify(CORE_10_15),
    });

    const timeline = await buildSettingsTimeline(db, { tenantId, userId, fromDate: "2026-04-01", toDate: "2026-04-30" });

    const before = timeline.filter((s) => s.from <= "2026-04-09").at(-1);
    const after = timeline.filter((s) => s.from <= "2026-04-10").at(-1);
    expect(before?.settings.workSystem).toMatchObject({ kind: "flex", core: null });
    expect(after?.settings.workSystem).toMatchObject({ kind: "flex", core: CORE_10_15 });
  });

  it("壊れた core の値はコアタイムなしにフォールバックする(月次を 500 にしない)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await appendFlexVersionWithCore(db, { tenantId, effectiveFrom: "2026-04-10", core: "not json" });

    const timeline = await buildSettingsTimeline(db, { tenantId, userId, fromDate: "2026-04-01", toDate: "2026-04-30" });
    expect(timeline.at(-1)?.settings.workSystem).toMatchObject({ kind: "flex", core: null });
  });
});

describe("コアタイム: GET /attendance/monthly の警告シリアライズ", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("遅刻・早退が乖離分数つきで返り、集計(totals・flexBalance)は変わらない", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const punch = async (kind: string, occurredAt: number) => {
      const r = await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind, occurredAt }),
      });
      expect(r.status).toBe(201);
    };
    // 2026-04-01(水) 10:30 出勤 → コアタイム開始(10:00)から30分の遅刻
    await punch("clock_in", jstMinutes(2026, 4, 1, 10, 30));
    await punch("break_start", jstMinutes(2026, 4, 1, 12, 0));
    await punch("break_end", jstMinutes(2026, 4, 1, 13, 0));
    await punch("clock_out", jstMinutes(2026, 4, 1, 18, 0));
    // 2026-04-02(木) 14:00 退勤 → コアタイム終了(15:00)より60分早い早退
    await punch("clock_in", jstMinutes(2026, 4, 2, 9, 0));
    await punch("clock_out", jstMinutes(2026, 4, 2, 14, 0));

    const before = await (await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } })).json();
    expect(before.warnings.filter((w: { kind: string }) => w.kind.startsWith("core_time_"))).toEqual([]);

    // コアタイムを月初から有効にする(過去日なので DB へ直接追記する)
    await appendFlexVersionWithCore(db, { tenantId, effectiveFrom: "2026-04-01", core: JSON.stringify(CORE_10_15) });

    const after = await (await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } })).json();
    const coreWarnings = after.warnings.filter((w: { kind: string }) => w.kind.startsWith("core_time_"));

    expect(coreWarnings).toEqual(
      expect.arrayContaining([
        { kind: "core_time_late_arrival", date: "2026-04-01", punchAt: jstMinutes(2026, 4, 1, 10, 30), core: { deltaMinutes: 30 } },
        { kind: "core_time_early_leave", date: "2026-04-02", punchAt: jstMinutes(2026, 4, 2, 14, 0), core: { deltaMinutes: 60 } },
      ]),
    );
    // 集計はコアタイムの有無で1分も変わらない(警告のみ、控除しない)
    expect(after.figures.totals).toEqual(before.figures.totals);
    expect(after.figures.flexBalance).toEqual(before.figures.flexBalance);
  });

  it("不在(core_time_absence)は過去の平日にだけ出て、当日以降には出ない", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await appendFlexVersionWithCore(db, { tenantId, effectiveFrom: "2026-04-01", core: JSON.stringify(CORE_10_15) });

    const body = await (await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } })).json();
    const absenceDates = body.warnings
      .filter((w: { kind: string }) => w.kind === "core_time_absence")
      .map((w: { date: string }) => w.date);

    // "今日" は 2026-04-15。当日以降は出さない
    expect(absenceDates.every((d: string) => d < "2026-04-15")).toBe(true);
    // 平日(月〜金)のみ。土日は既定の適用曜日に含まれない
    expect(absenceDates).toContain("2026-04-01"); // 水
    expect(absenceDates).not.toContain("2026-04-04"); // 土
    expect(absenceDates).not.toContain("2026-04-05"); // 日(法定休日)
    expect(absenceDates).not.toContain("2026-04-15");
    expect(absenceDates).not.toContain("2026-04-16");
  });
});
