/**
 * 手当対象時間の統合テスト(docs/design/allowances.md)。
 *
 * 定義 → 打刻 → GET /attendance/monthly に手当分数が乗る → 締め → closing_snapshots に
 * allowance:<definitionId> として保存される → 締め後に定義を変更しても締め済み月の値は
 * 変わらない(原則6) → CSV に allowance_<name> 列が出る、までを1本のシナリオで確認する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

// 手当定義の POST は「今日以降」の effectiveFrom しか受け付けない(原則6)一方、打刻は未来時刻を
// 受け付けない。そのため時刻を3段階で進めながらシナリオを進める(closings.test.ts と同じ流儀):
// ①月初(定義作成) → ②打刻対象日(打刻) → ③月末後(締め・締め後の版追加)。
const INITIAL_NOW = new Date("2026-04-01T03:00:00.000Z"); // JST 2026-04-01 12:00
const PUNCH_DAY_NOW = new Date("2026-04-10T09:00:00.000Z"); // JST 2026-04-10 18:00
const AFTER_MONTH_END_NOW = new Date("2026-05-15T03:00:00.000Z"); // JST 2026-05-15 12:00

const ALLOWANCE_SETTINGS_PERMISSION = "tenant_settings.calendar.manage";

async function postPunch(app: RequestLike, cookie: string, kind: string, occurredAt: number) {
  const res = await app.request("/punches", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, occurredAt }),
  });
  expect(res.status).toBe(201);
}

async function createAllowance(
  app: RequestLike,
  cookie: string,
  body: { effectiveFrom: string; name: string; conditions: Record<string, unknown> },
) {
  const res = await app.request("/settings/allowances", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function getMonthly(app: RequestLike, cookie: string, month: string) {
  const res = await app.request(`/attendance/monthly?month=${month}`, { headers: { cookie } });
  return { status: res.status, body: await res.json() };
}

/** CRLF 区切り・先頭行=ヘッダの CSV をシンプルにパースする(引用符を含むフィールドは無い前提のテスト用、exports.test.ts と同じ)。 */
function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const withoutBom = text.replace(/^﻿/, "");
  const lines = withoutBom.split("\r\n").filter((l) => l.length > 0);
  const [header, ...rest] = lines;
  return { header: (header ?? "").split(","), rows: rest.map((l) => l.split(",")) };
}

describe("手当対象時間: 定義→打刻→monthly→締め→スナップショット復元→CSV", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("end-to-end", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: ALLOWANCE_SETTINGS_PERMISSION, scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 1. 定義: 早朝手当(6:00-8:00)。対象月(2026-04)より前から有効にしておく。
    const { id: definitionId } = await createAllowance(app, cookie, {
      effectiveFrom: "2026-04-01",
      name: "早朝手当",
      conditions: { timeBand: { startMinutes: 360, endMinutes: 480 } },
    });

    // 2. 打刻: 6:30-18:00(早朝手当の対象は 6:30-8:00 の 90分)。打刻は未来時刻を受け付けないため
    //    対象日まで時刻を進めてから打つ。
    vi.setSystemTime(PUNCH_DAY_NOW);
    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 10, 6, 30));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 10, 18, 0));

    // 3. GET /attendance/monthly に手当分数が乗る
    const before = await getMonthly(app, cookie, "2026-04");
    expect(before.status).toBe(200);
    expect(before.body.closed).toBe(false);
    expect(before.body.allowanceTotals).toEqual([{ definitionId, minutes: 90 }]);
    expect(before.body.allowanceDefinitions).toEqual({ [definitionId]: "早朝手当" });
    const day = before.body.days.find((d: { date: string }) => d.date === "2026-04-10");
    expect(day.allowances).toEqual([{ definitionId, minutes: 90 }]);

    // 4. 締め(月末後に進めてから)。セッション有効期限を跨ぐため再ログインする。
    vi.setSystemTime(AFTER_MONTH_END_NOW);
    const freshCookie = await loginAndGetCookie(app, email, password);
    const closeRes = await app.request("/closings/2026-04/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: freshCookie },
      body: JSON.stringify({}),
    });
    expect(closeRes.status).toBe(200);

    const afterClose = await getMonthly(app, freshCookie, "2026-04");
    expect(afterClose.body.closed).toBe(true);
    expect(afterClose.body.allowanceTotals).toEqual([{ definitionId, minutes: 90 }]);

    // 5. 締め後に定義の条件を変更しても、締め済み月の値は変わらない(原則6)。
    //    新しい版は対象月より後(2026-06)から有効にする。
    const changeRes = await app.request(`/settings/allowances/${definitionId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: freshCookie },
      body: JSON.stringify({
        effectiveFrom: "2026-06-01",
        name: "早朝手当(改定)",
        conditions: { timeBand: { startMinutes: 300, endMinutes: 420 } }, // 5:00-7:00 に変更
      }),
    });
    expect(changeRes.status).toBe(201);

    const afterDefinitionChange = await getMonthly(app, freshCookie, "2026-04");
    expect(afterDefinitionChange.body.closed).toBe(true);
    // 締め済み月(2026-04)はスナップショットから返るので、条件変更・分数(90分)とも変わらない。
    expect(afterDefinitionChange.body.allowanceTotals).toEqual([{ definitionId, minutes: 90 }]);
    // 名前マップは締め済み月でも「期間開始日時点」ではなく現在の定義に対して素直に組み立てているため、
    // 2026-04 の名前は当時有効だった "早朝手当"(2026-06から有効な改定はこの期間に関係しない)のまま。
    expect(afterDefinitionChange.body.allowanceDefinitions).toEqual({ [definitionId]: "早朝手当" });

    // 6. CSV に allowance_<name> 列が出る(締め済み月なのでスナップショット経由)。
    const csvRes = await app.request("/exports/attendance.csv?month=2026-04", { headers: { cookie: freshCookie } });
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    const { header, rows } = parseCsv(csvText);
    expect(header).toContain("allowance_早朝手当");
    const allowanceColIndex = header.indexOf("allowance_早朝手当");
    const row = rows.find((r) => r[0] === userId);
    expect(row?.[allowanceColIndex]).toBe("90");
  });

  it("有給のみの日は手当が付かず、未締め月の monthly でも allowanceTotals は0を含めて返る", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: ALLOWANCE_SETTINGS_PERMISSION, scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { id: definitionId } = await createAllowance(app, cookie, {
      effectiveFrom: "2026-04-01",
      name: "早朝手当",
      conditions: { timeBand: { startMinutes: 360, endMinutes: 480 } },
    });

    // 4/10 は打刻なし(有給のみを想定 — このテストでは打刻を作らないだけで有給申請 API までは
    // 経由しない。手当が実労働セグメントに対してのみ算出されることの確認が目的)。
    const res = await getMonthly(app, cookie, "2026-04");
    expect(res.status).toBe(200);
    // 定義は期間内に有効だが実労働が無いので0分。行自体は含まれる(engine の契約)。
    expect(res.body.allowanceTotals).toEqual([{ definitionId, minutes: 0 }]);
  });
});
