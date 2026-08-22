/**
 * GET /exports/attendance.csv のテスト。参照: apps/api/src/routes/exports.ts。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, upsertMembership, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";
import { setupOrgFixture } from "./support/org.js";

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
  expect(res.status).toBe(201);
}

async function getCsv(app: RequestLike, cookie: string, month: string) {
  const res = await app.request(`/exports/attendance.csv?month=${month}`, { headers: { cookie } });
  // Response#text() は TextDecoder 既定(ignoreBOM: false)によりデコード時に先頭の
  // UTF-8 BOM バイト列を消費してしまうため、BOM の有無はデコード前の生バイトで確認する。
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, hasBom };
}

/** CRLF 区切り・先頭行=ヘッダの CSV をシンプルにパースする(引用符を含むフィールドは無い前提のテスト用)。 */
function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const withoutBom = text.replace(/^﻿/, "");
  const lines = withoutBom.split("\r\n").filter((l) => l.length > 0);
  const [header, ...rest] = lines;
  return { header: (header ?? "").split(","), rows: rest.map((l) => l.split(",")) };
}

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

describe("GET /exports/attendance.csv", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 403 without export.attendance.run", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/exports/attendance.csv?month=2026-04", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("returns a UTF-8 BOM, CRLF-delimited CSV with the expected header and content-type/disposition", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const { status, headers, text, hasBom } = await getCsv(app, cookie, "2026-04");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(headers.get("content-disposition")).toBe('attachment; filename="kizami-2026-04.csv"');
    expect(hasBom).toBe(true);
    expect(text.includes("\r\n")).toBe(true);

    const { header, rows } = parseCsv(text);
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
      "flex_frame_minutes",
      "flex_actual_minutes",
      "flex_diff_minutes",
      "closed",
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0] as string[];
    expect(row[0]).toBe(userId);
    expect(row[2]).toBe(email);
    expect(row[3]).toBe("2026-04");
    expect(row[row.length - 1]).toBe("false"); // closed
  });

  it("computes rows on-demand for an open month, and audit-logs the export", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const { text: openText } = await getCsv(app, cookie, "2026-04");
    const openRow = parseCsv(openText).rows[0] as string[];
    expect(openRow[openRow.length - 1]).toBe("false");
    // 9時間労働(休憩なし)→ statutory は8時間=480分に収まるはず
    expect(Number(openRow[4])).toBeGreaterThan(0);

    expect(await auditActionsFor(db, tenantId)).toEqual(["export.attendance"]);
  });

  it("reads rows from the closing snapshot for a closed month (matches values captured at close time)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 18, 0));

    const { text: beforeCloseText } = await getCsv(app, cookie, "2026-04");
    const beforeRow = parseCsv(beforeCloseText).rows[0] as string[];

    const closeRes = await app.request("/closings/2026-04/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(closeRes.status).toBe(200);

    const { text: afterCloseText } = await getCsv(app, cookie, "2026-04");
    const afterRow = parseCsv(afterCloseText).rows[0] as string[];
    expect(afterRow[afterRow.length - 1]).toBe("true"); // closed
    expect(afterRow.slice(4, 12)).toEqual(beforeRow.slice(4, 12)); // 区分別時間数・flex収支は締め前と一致
  });

  it("only includes users within the actor's scope (department manager cannot export a sibling department's member)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const org = await setupOrgFixture(db, tenantId);
    await upsertMembership(db, { tenantId, userId, departmentId: org.deptA.id, createdAt: 0 });
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 締め済み月にする(org フィクスチャのメンバーは制度未割当のため、未締めの
    // オンデマンド計算パスだと calculateMonthlyForUser が例外を投げて行ごとスキップされてしまう。
    // 締め済みパスは snapshot 欠如を0埋めで扱うため、スコープ絞り込みだけを独立して検証できる)。
    const closeRes = await app.request("/closings/2026-04/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(closeRes.status).toBe(200);

    const { text } = await getCsv(app, cookie, "2026-04");
    const { rows } = parseCsv(text);
    const exportedIds = rows.map((r) => r[0]);
    expect(exportedIds).toContain(userId); // 本人(部署A所属)は含まれる
    expect(exportedIds).toContain(org.memberAUserId); // 同じ部署Aのメンバーも含まれる
    expect(exportedIds).not.toContain(org.memberA1UserId); // 子部署(A1)は department スコープでは含まれない
    expect(exportedIds).not.toContain(org.memberBUserId); // 別ツリー(部署B)は含まれない
  });
});
