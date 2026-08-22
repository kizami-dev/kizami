/**
 * 締め済み月への変更が全経路(打刻・修正申請の作成・承認)で拒否されることのテスト。
 * 参照: apps/api/src/lib/closing-guard.ts、依頼の禁止事項。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-05-15T03:00:00.000Z"); // JST 2026-05-15 12:00

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function postPunch(app: RequestLike, cookie: string, kind: string, occurredAt: number) {
  const res = await app.request("/punches", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, occurredAt }),
  });
  return { status: res.status, body: (await res.json()) as { error?: string } };
}

async function closePeriod(app: RequestLike, cookie: string, period: string) {
  const res = await app.request(`/closings/${period}/close`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
}

async function reopenPeriod(app: RequestLike, cookie: string, period: string) {
  const res = await app.request(`/closings/${period}/reopen`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
}

describe("month-closed guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("POST /punches rejects a punch dated inside a closed month with 409 month_closed", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await closePeriod(app, cookie, "2026-04");

    const res = await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 10, 9, 0));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("month_closed");
  });

  it("POST /punches for an open month is unaffected by another month being closed", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await closePeriod(app, cookie, "2026-03");

    const res = await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 10, 9, 0));
    expect(res.status).toBe(201);
  });

  it("POST /corrections (addition) rejects a proposedOccurredAt inside a closed month", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await closePeriod(app, cookie, "2026-04");

    const res = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        proposedKind: "clock_in",
        proposedOccurredAt: jstMinutes(2026, 4, 10, 9, 0),
        reason: "忘れていた",
      }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "month_closed" });
  });

  it("POST /corrections (correction of an existing punch) rejects when the target's original month is closed, even if the proposed date is in an open month", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // punch は開いている 3月のうちに登録 → その後 3月を締める
    const punchRes = await postPunch(app, cookie, "clock_in", jstMinutes(2026, 3, 20, 9, 0));
    expect(punchRes.status).toBe(201);
    const punchId = (
      (await (
        await app.request("/punches?from=0&to=99999999999", { headers: { cookie } })
      ).json()) as { punches: { id: string; occurredAt: number }[] }
    ).punches.find((p) => p.occurredAt === jstMinutes(2026, 3, 20, 9, 0))?.id;
    expect(punchId).toBeDefined();

    await closePeriod(app, cookie, "2026-03");

    // 訂正申請: 対象は締め済み(3月)の打刻、提案内容は開いている(4月)日時 — それでも拒否される
    const res = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        targetEventId: punchId,
        proposedKind: "clock_in",
        proposedOccurredAt: jstMinutes(2026, 4, 20, 9, 0),
        reason: "日付の訂正",
      }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "month_closed" });
  });

  it("POST /corrections/:id/approve rejects when the reflection destination is a month closed after the request was created", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 4月分の申請を、まだ4月が開いているうちに作成する(打刻忘れの追加申請)
    const createRes = await app.request("/corrections", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        proposedKind: "clock_in",
        proposedOccurredAt: jstMinutes(2026, 4, 10, 9, 0),
        reason: "退勤打刻を忘れた",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { request: { id: string } }).request;

    // 申請作成後に4月を締める
    await closePeriod(app, cookie, "2026-04");

    // 承認しようとすると、反映先(4月)が締め済みのため拒否される
    const approveRes = await app.request(`/corrections/${created.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(409);
    expect((await approveRes.json()) as { error: string }).toEqual({ error: "month_closed" });
  });

  it("reopening a month allows punches again", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.unlock", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await closePeriod(app, cookie, "2026-04");
    const blockedRes = await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 10, 9, 0));
    expect(blockedRes.status).toBe(409);

    // occurred_at は分単位(秒を持たない)なので、close/reopen が同一分内に起きると履歴の順序が
    // 不定になりうる(closings.test.ts と同じ理由)。最低1分は現在時刻を進めてから reopen する。
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 60_000));
    await reopenPeriod(app, cookie, "2026-04");
    const allowedRes = await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 10, 9, 0));
    expect(allowedRes.status).toBe(201);
  });
});
