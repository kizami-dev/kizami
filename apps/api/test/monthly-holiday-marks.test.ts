/**
 * 月次の日別の表に付ける休日の印(GET /attendance/monthly の holidayMarks、2026-10-06)。
 *
 * 曜日だけでは分からない休日 — 国民の祝日と、所定休日のカレンダーで個別に足した休日 — に印が付き、
 * 曜日による所定休日(土日)・カレンダーの営業日(extraWorkdays)・祝日を休日にしない設定では
 * 付かないことを固定する。集計には使わない表示専用の値。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

/** JST 2026-10-05 12:00 */
const NOW = new Date("2026-10-05T03:00:00.000Z");

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

async function holidayMarks(app: RequestLike, cookie: string, month: string): Promise<Record<string, string>> {
  const res = await app.request(`/attendance/monthly?month=${month}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { holidayMarks: Record<string, string> };
  return body.holidayMarks;
}

async function addCalendarVersion(app: RequestLike, cookie: string, body: unknown): Promise<void> {
  const res = await app.request("/settings/holiday-calendar", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
}

describe("月次の休日の印(holidayMarks)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("既定のカレンダーでは国民の祝日に national が付き、土日には付かない", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 2026-09: 敬老の日(9/21)・国民の休日(9/22)・秋分の日(9/23)
    expect(await holidayMarks(app, cookie, "2026-09")).toEqual({
      "2026-09-21": "national",
      "2026-09-22": "national",
      "2026-09-23": "national",
    });
  });

  it("カレンダーで足した休日に company が付き、営業日にした祝日には付かない", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "tenant_settings.calendar.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 2026-11: 文化の日(11/3)を営業日に、11/2 を会社の休日に。勤労感謝の日(11/23)はそのまま
    await addCalendarVersion(app, cookie, {
      effectiveFrom: "2026-11-01",
      weekdays: [0, 6],
      nationalHolidays: true,
      extraHolidays: ["2026-11-02"],
      extraWorkdays: ["2026-11-03"],
    });

    expect(await holidayMarks(app, cookie, "2026-11")).toEqual({
      "2026-11-02": "company",
      "2026-11-23": "national",
    });
  });

  it("祝日を所定休日にしない設定では、祝日に印を付けない", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "tenant_settings.calendar.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await addCalendarVersion(app, cookie, { effectiveFrom: "2026-11-01", weekdays: [0, 6], nationalHolidays: false });

    expect(await holidayMarks(app, cookie, "2026-11")).toEqual({});
  });
});
