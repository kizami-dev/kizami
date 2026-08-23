/**
 * GET /attendance/monthly のレスポンス契約そのもの(2026-08-23、破壊的変更・承認済み)を検証する。
 * 参照: apps/api/src/routes/attendance.ts 冒頭コメント、
 * docs/design/v01-data-model.md「GET /attendance/monthly レスポンス契約」節。
 *
 * 集計値そのものの正しさ(法定内・時間外の計算等)は他のテストが担う。ここでの関心は
 * 「返ってくるJSONの形」だけ: 新形のキー構成(user/workSystem/days/warnings/figures/
 * allowanceDefinitions/closing)になっていること、旧形のフラットなキー(totals/flexBalance/
 * closed/amended等)がトップレベルに残っていないこと、figures.source が live/snapshot を
 * 正しく反映すること、amend 時のみ figures.original が現れること。
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

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
}

describe("GET /attendance/monthly response contract", () => {
  it("live (open) month: top-level keys are exactly {user, workSystem, days, warnings, figures, allowanceDefinitions, closing}; no legacy flat keys", async () => {
    const { db, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(new Set(Object.keys(body))).toEqual(new Set(["user", "workSystem", "days", "warnings", "figures", "allowanceDefinitions", "closing"]));
    // 旧形のキーが混入していないこと(互換層を残していないことの確認)。
    for (const legacyKey of ["totals", "flexBalance", "closed", "amended", "originalTotals", "originalFlexBalance", "originalAllowanceTotals", "allowanceTotals"]) {
      expect(body).not.toHaveProperty(legacyKey);
    }

    expect(body.user).toEqual({ id: userId, name: "Test User" });
    expect(body.workSystem).toBe("flex");
    expect(body.closing).toEqual({ closed: false, amended: false });

    const figures = body.figures as Record<string, unknown>;
    expect(new Set(Object.keys(figures))).toEqual(
      new Set(["source", "totals", "flexBalance", "fixedBreakdown", "allowanceTotals", "variablePeriod"]),
    );
    expect(figures.source).toBe("live");
    expect(figures.fixedBreakdown).toBeNull(); // フレックスの月なので null(closing-snapshot.ts の契約どおり)
    expect(figures.allowanceTotals).toEqual([]);
  });

  it("closed (not amended) month: figures.source is 'snapshot' and figures.original is absent", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    const closeRes = await app.request("/closings/2026-04/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(closeRes.status).toBe(200);

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const body = (await res.json()) as { closing: { closed: boolean; amended: boolean }; figures: { source: string; original?: unknown } };
    expect(body.closing).toEqual({ closed: true, amended: false });
    expect(body.figures.source).toBe("snapshot");
    expect(body.figures.original).toBeUndefined();
  });

  it("amended month: figures.original carries the first-close generation's totals/flexBalance/fixedBreakdown/allowanceTotals", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "attendance.correction.approve", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));
    expect((await app.request("/closings/2026-04/close", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({}) })).status).toBe(200);

    // 締め後修正: 打刻の追加申請 → 承認(closing.unlock 保持者による締め後修正)。
    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ proposedKind: "break_start", proposedOccurredAt: jstMinutes(2026, 4, 1, 12, 0), reason: "休憩の打刻漏れ" }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: { id: string } }).request;
    const approveRes = await app.request(`/corrections/${created.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const body = (await res.json()) as {
      closing: { closed: boolean; amended: boolean };
      figures: {
        source: string;
        totals: { statutory: number };
        original?: { totals: { statutory: number }; flexBalance: unknown; fixedBreakdown: unknown; allowanceTotals: unknown[] };
      };
    };
    expect(body.closing).toEqual({ closed: true, amended: true });
    expect(body.figures.source).toBe("snapshot");
    expect(body.figures.original).toBeDefined();
    expect(new Set(Object.keys(body.figures.original ?? {}))).toEqual(new Set(["totals", "flexBalance", "fixedBreakdown", "allowanceTotals"]));
    // 休憩を1h追加した分、法定内労働時間(statutory)は当初世代より減っているはず。
    expect(body.figures.totals.statutory).toBeLessThan(body.figures.original?.totals.statutory ?? Infinity);
  });

  it("fixed work system: figures.flexBalance is null and figures.fixedBreakdown carries withinScheduled/extraWithinStatutory", async () => {
    const { switchToFixedWorkPolicy } = await import("./support/setup.js");
    const { db, tenantId, email, password } = await setupTestDb();
    await switchToFixedWorkPolicy(db, { tenantId, standardDayMinutes: 480 });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 19, 30)); // 10.5h、2.5h(150分)の法定時間外

    const res = await app.request("/attendance/monthly?month=2026-04", { headers: { cookie } });
    const body = (await res.json()) as {
      workSystem: string;
      figures: { flexBalance: unknown; fixedBreakdown: { withinScheduledMinutes: number; extraWithinStatutoryMinutes: number } };
    };
    expect(body.workSystem).toBe("fixed");
    expect(body.figures.flexBalance).toBeNull();
    expect(body.figures.fixedBreakdown).toEqual({ withinScheduledMinutes: 480, extraWithinStatutoryMinutes: 0 });
  });
});
