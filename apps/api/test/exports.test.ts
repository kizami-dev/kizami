/**
 * GET /exports/attendance.csv のテスト。参照: apps/api/src/routes/exports.ts。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, upsertMembership, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import {
  grantPermission,
  jstMinutes,
  loginAndGetCookie,
  setupSecondUser,
  setupTestDb,
  switchToFixedWorkPolicy,
} from "./support/setup.js";
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
      "work_system",
      "flex_frame_minutes",
      "flex_actual_minutes",
      "flex_diff_minutes",
      "fixed_within_scheduled_minutes",
      "fixed_extra_within_statutory_minutes",
      "closed",
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0] as string[];
    expect(row[0]).toBe(userId);
    expect(row[2]).toBe(email);
    expect(row[3]).toBe("2026-04");
    expect(row[9]).toBe("flex"); // work_system
    expect(row[13]).toBe(""); // fixed_within_scheduled_minutes(フレックスなので空)
    expect(row[14]).toBe(""); // fixed_extra_within_statutory_minutes(フレックスなので空)
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
    expect(afterRow.slice(4, 9)).toEqual(beforeRow.slice(4, 9)); // 区分別時間数は締め前と一致
    expect(afterRow[9]).toBe(beforeRow[9]); // work_system
    expect(afterRow.slice(10, 13)).toEqual(beforeRow.slice(10, 13)); // flex収支は締め前と一致
    expect(afterRow[13]).toBe(""); // fixed_within_scheduled_minutes(フレックスなので締め済みでも空のまま)
    expect(afterRow[14]).toBe(""); // fixed_extra_within_statutory_minutes(フレックスなので締め済みでも空のまま)
  });

  it("固定時間制: flex列は空文字・work_system列はfixed・fixed列は所定内/法定内残業の月合計になる(未締め月)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await switchToFixedWorkPolicy(db, { tenantId, standardDayMinutes: 480 }); // 所定8h
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 09:00-19:00(10h)。所定8h(480分)+法定内残業0(所定=法定8hのため)+法定時間外2h(120分)
    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 19, 0));

    const { text } = await getCsv(app, cookie, "2026-04");
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(1);
    const row = rows[0] as string[];

    expect(row[9]).toBe("fixed"); // work_system
    expect(row[10]).toBe(""); // flex_frame_minutes
    expect(row[11]).toBe(""); // flex_actual_minutes
    expect(row[12]).toBe(""); // flex_diff_minutes
    expect(Number(row[13])).toBe(480); // fixed_within_scheduled_minutes
    expect(Number(row[14])).toBe(0); // fixed_extra_within_statutory_minutes
    expect(Number(row[5])).toBe(120); // overtime_minutes (法定時間外2h)
  });

  it("固定時間制・締め済み月: fixed列が空にならず、締め前と同じ実値になる(内訳が締めで失われないことの回帰テスト)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await switchToFixedWorkPolicy(db, { tenantId, standardDayMinutes: 420 }); // 所定7h
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 09:00-19:00(10h)。所定7h(420分)+法定内残業1h(60分、7h超〜8h以内)+法定時間外2h(120分)
    await postPunch(app, cookie, "clock_in", jstMinutes(2026, 4, 1, 9, 0));
    await postPunch(app, cookie, "clock_out", jstMinutes(2026, 4, 1, 19, 0));

    const { text: beforeCloseText } = await getCsv(app, cookie, "2026-04");
    const beforeRow = parseCsv(beforeCloseText).rows[0] as string[];
    expect(Number(beforeRow[13])).toBe(420); // fixed_within_scheduled_minutes(締め前)
    expect(Number(beforeRow[14])).toBe(60); // fixed_extra_within_statutory_minutes(締め前)

    const closeRes = await app.request("/closings/2026-04/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(closeRes.status).toBe(200);

    const { text: afterCloseText } = await getCsv(app, cookie, "2026-04");
    const { rows } = parseCsv(afterCloseText);
    expect(rows).toHaveLength(1);
    const afterRow = rows[0] as string[];
    expect(afterRow[afterRow.length - 1]).toBe("true"); // closed
    // 本題: 締め済み月でも fixed 列が空文字に潰れず、締め前と同じ実値のまま出る。
    expect(afterRow[13]).not.toBe("");
    expect(afterRow[14]).not.toBe("");
    expect(Number(afterRow[13])).toBe(420);
    expect(Number(afterRow[14])).toBe(60);
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

    // 本題: org.memberAUserId は制度未割当のため締め時点で snapshot 行が1つも無い
    // (engineOutputFromSnapshots でいう flexBalance/fixedBreakdown が両方 null になるケース)。
    // これでも例外を投げず、fixed 列は空文字のまま出力される(0埋めにもならない)。
    const memberARow = rows.find((r) => r[0] === org.memberAUserId) as string[];
    expect(memberARow[13]).toBe(""); // fixed_within_scheduled_minutes
    expect(memberARow[14]).toBe(""); // fixed_extra_within_statutory_minutes
  });

  it("行が皆無のユーザー(締め時点で制度未割当)がいても、他ユーザーの出力を含めクラッシュしない", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId); // work_policy 未割当
    await grantPermission(db, { tenantId, userId, permission: "export.attendance.run", scope: "tenant" });
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

    const { status, text } = await getCsv(app, cookie, "2026-04");
    expect(status).toBe(200);
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(2);

    const secondRow = rows.find((r) => r[0] === second.userId) as string[];
    expect(secondRow).toBeDefined();
    expect(secondRow[13]).toBe(""); // fixed_within_scheduled_minutes(行が無いので空文字)
    expect(secondRow[14]).toBe(""); // fixed_extra_within_statutory_minutes(行が無いので空文字)

    const userRow = rows.find((r) => r[0] === userId) as string[];
    expect(userRow[13]).toBe(""); // 本人はフレックスなのでこちらも空文字
  });
});
