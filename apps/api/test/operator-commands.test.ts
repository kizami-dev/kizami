/**
 * 運用者 CLI(src/operator.ts)の中身 lib/operator-commands.ts のテスト。
 * CLI 本体は引数の解釈と出力だけなので、ここで DB を伴う主要関数を検証する。
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { findSignupInviteCodeByHash, isSignupInviteCodeUsable, signupInviteCodes } from "@kizami/db";
import {
  argValue,
  createInviteCode,
  formatMinutesUtc,
  intArg,
  listInviteCodes,
  listTenants,
  revokeInviteCode,
} from "../src/lib/operator-commands.js";
import { hashSignupInviteCode } from "../src/lib/signup-invite-code.js";
import { bootstrapTenant } from "../src/lib/tenant-bootstrap.js";
import { createTestDatabase } from "./support/setup.js";

const DAY = 24 * 60;
const NOW = 29_000_000;

describe("invite-code create / list / revoke", () => {
  it("create は平文を1度だけ返し、DB にはハッシュだけを保存する(既定は max_uses=1・無期限)", async () => {
    const db = await createTestDatabase();
    const { plainCode, row } = await createInviteCode(db, { nowMinutes: NOW });
    expect(plainCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    expect(row).toMatchObject({ maxUses: 1, usedCount: 0, expiresAt: null, revokedAt: null, createdAt: NOW });

    // 平文はどの列にも入っていない。ハッシュでだけ引ける
    const stored = await db.select().from(signupInviteCodes);
    expect(JSON.stringify(stored)).not.toContain(plainCode);
    expect(JSON.stringify(stored)).not.toContain(plainCode.replaceAll("-", ""));
    const found = await findSignupInviteCodeByHash(db, await hashSignupInviteCode(plainCode));
    expect(found?.id).toBe(row.id);
    expect(isSignupInviteCodeUsable(found!, NOW)).toBe(true);
  });

  it("--max-uses / --expires-days / --note が反映される", async () => {
    const db = await createTestDatabase();
    const { row } = await createInviteCode(db, { nowMinutes: NOW, maxUses: 5, expiresInDays: 14, note: "A社 山田さん" });
    expect(row).toMatchObject({ maxUses: 5, expiresAt: NOW + 14 * DAY, note: "A社 山田さん" });
  });

  it("不正な max-uses / expires-days は拒否する", async () => {
    const db = await createTestDatabase();
    await expect(createInviteCode(db, { nowMinutes: NOW, maxUses: 0 })).rejects.toThrow("--max-uses");
    await expect(createInviteCode(db, { nowMinutes: NOW, expiresInDays: -1 })).rejects.toThrow("--expires-days");
  });

  it("list は平文を含まず、状態(active / revoked / expired / exhausted)を出す", async () => {
    const db = await createTestDatabase();
    const active = await createInviteCode(db, { nowMinutes: NOW, note: "active" });
    const revoked = await createInviteCode(db, { nowMinutes: NOW, note: "revoked" });
    const expired = await createInviteCode(db, { nowMinutes: NOW - 10 * DAY, expiresInDays: 1, note: "expired" });
    const exhausted = await createInviteCode(db, { nowMinutes: NOW, note: "exhausted" });
    await db.update(signupInviteCodes).set({ usedCount: 1 }).where(eq(signupInviteCodes.id, exhausted.row.id));
    expect(await revokeInviteCode(db, { id: revoked.row.id, nowMinutes: NOW })).toBe(true);

    const listing = await listInviteCodes(db, { nowMinutes: NOW });
    const byNote = Object.fromEntries(listing.map((r) => [r.note, r.status]));
    expect(byNote).toEqual({ active: "active", revoked: "revoked", expired: "expired", exhausted: "exhausted" });
    for (const plain of [active, revoked, expired, exhausted].map((c) => c.plainCode)) {
      expect(JSON.stringify(listing)).not.toContain(plain);
    }
    expect(listing.find((r) => r.note === "active")).toMatchObject({ usedCount: 0, maxUses: 1, expiresAt: null, revoked: false });
  });

  it("revoke は存在しない id・失効済みで false を返す", async () => {
    const db = await createTestDatabase();
    const { row } = await createInviteCode(db, { nowMinutes: NOW });
    expect(await revokeInviteCode(db, { id: "no-such-id", nowMinutes: NOW })).toBe(false);
    expect(await revokeInviteCode(db, { id: row.id, nowMinutes: NOW })).toBe(true);
    expect(await revokeInviteCode(db, { id: row.id, nowMinutes: NOW })).toBe(false);
  });
});

describe("tenant list", () => {
  it("id / 名前 / 作成日 / 有効ユーザー数を作成順に返す", async () => {
    const db = await createTestDatabase();
    const a = await bootstrapTenant(db, { tenantName: "A社", adminEmail: "a@example.com", adminPassword: "correct horse battery", now: 100 });
    await bootstrapTenant(db, { tenantName: "B社", adminEmail: "b@example.com", adminPassword: "correct horse battery", now: 200 });

    const rows = await listTenants(db);
    expect(rows.map((r) => ({ name: r.name, createdAt: r.createdAt, activeUserCount: r.activeUserCount }))).toEqual([
      { name: "A社", createdAt: 100, activeUserCount: 1 },
      { name: "B社", createdAt: 200, activeUserCount: 1 },
    ]);
    expect(rows[0]?.id).toBe(a.tenantId);
  });
});

describe("引数の解釈", () => {
  it("--flag value / --flag=value の両形式、整数の検証、UTC 表示", () => {
    expect(argValue(["--note", "hello"], "note")).toBe("hello");
    expect(argValue(["--note=hi there"], "note")).toBe("hi there");
    expect(argValue([], "note")).toBeUndefined();
    expect(intArg(["--max-uses", "3"], "max-uses")).toBe(3);
    expect(intArg([], "max-uses")).toBeUndefined();
    expect(() => intArg(["--max-uses", "abc"], "max-uses")).toThrow("--max-uses");
    expect(formatMinutesUtc(0)).toBe("1970-01-01 00:00");
  });
});
