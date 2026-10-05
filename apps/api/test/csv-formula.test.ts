/**
 * CSV の数式インジェクション対策(lib/csv.ts、2026-10-05 セキュリティレビュー)。
 *
 * - 入力値が `=` `+` `-` `@` タブ・CR で始まれば、先頭に `'` を付けて文字列として扱わせる
 * - 数値・数字だけの文字列・日付・時刻は変えない(負の差分 `-30` などがそのまま残る)
 * - 既存の勤怠の CSV(汎用・freee・MF)と、全データのエクスポートの CSV の両方に効いている
 */

import { strFromU8, unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertPunchEvent, users, uuidv7 } from "@kizami/db";
import { createApp } from "../src/app.js";
import { buildCsvRow, escapeCsvField, neutralizeCsvFormula } from "../src/lib/csv.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

describe("neutralizeCsvFormula / escapeCsvField", () => {
  it("数式として評価されうる先頭の文字には ' を付ける", () => {
    for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx", '=HYPERLINK("http://evil")']) {
      expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
    }
  });

  it("数値・数字だけの文字列・日付・時刻・普通の文字列は変えない", () => {
    expect(escapeCsvField(-30)).toBe("-30");
    expect(escapeCsvField(0)).toBe("0");
    expect(escapeCsvField(true)).toBe("true");
    for (const value of ["-30", "+5", "-1.5", "480", "2026-06-01", "2026-06-01 09:00", "8:30", "山田 太郎", "a@example.com", ""]) {
      expect(escapeCsvField(value)).toBe(value);
    }
  });

  it("無害化のうえで RFC4180 のエスケープもする", () => {
    expect(escapeCsvField('=a,"b"')).toBe(`"'=a,""b"""`);
    expect(buildCsvRow(["=x", -1, "y"])).toBe("'=x,-1,y");
  });
});

describe("CSV エクスポートに入力値の数式が残らない", () => {
  const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("勤怠の CSV(汎用・freee・MF)と、全データのエクスポートの CSV の氏名を無害化し、時間の列は変えない", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const evilName = '=HYPERLINK("http://evil.example","x")';
    await db.update(users).set({ name: evilName }).where(eq(users.id, userId));
    for (const permission of ["export.attendance.run", "tenant.withdraw"]) {
      await grantPermission(db, { tenantId, userId, permission, scope: "tenant" });
    }
    for (const [kind, hour] of [["clock_in", 9], ["clock_out", 18]] as const) {
      await insertPunchEvent(db, {
        id: uuidv7(),
        tenantId,
        userId,
        kind,
        occurredAt: jstMinutes(2026, 6, 1, hour, 0),
        recordedAt: jstMinutes(2026, 6, 1, hour, 0),
        source: "web",
        actorId: userId,
      });
    }
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const neutralized = `"'=HYPERLINK(""http://evil.example"",""x"")"`;
    for (const format of ["generic", "freee", "mf"]) {
      const res = await app.request(`/exports/attendance.csv?month=2026-06&format=${format}`, { headers: { cookie } });
      expect(res.status).toBe(200);
      const csv = await res.text();
      expect(csv, format).toContain(neutralized);
      expect(csv, format).not.toMatch(/(^|,)"?=HYPERLINK/m);
    }

    const res = await app.request("/tenant/export", { headers: { cookie } });
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const csvNames = Object.keys(files).filter((n) => n.endsWith(".csv"));
    expect(csvNames.length).toBeGreaterThan(1);
    for (const name of csvNames) {
      const csv = strFromU8(files[name]!);
      expect(csv, name).toContain(neutralized);
      expect(csv, name).not.toMatch(/(^|,)"?=HYPERLINK/m);
    }
    const daily = strFromU8(files[csvNames.find((n) => n.startsWith("attendance/daily/2026-06/"))!]!);
    // 日付・時刻・分の列はそのまま
    expect(daily).toContain("2026-06-01,2026-06-01 09:00,2026-06-01 18:00");
    // JSON(機械可読の全データ)は対象外で、氏名は入力どおり
    const usersJson = JSON.parse(strFromU8(files["data/users.json"]!)) as Array<{ name: string }>;
    expect(usersJson[0]?.name).toBe(evilName);
  });
});
