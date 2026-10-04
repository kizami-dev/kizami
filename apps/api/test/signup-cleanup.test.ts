/**
 * 期限切れの未確認サインアップの掃除(signup-cleanup.ts)。
 * 期限(登録から24時間)から7日以上経った未消費の行だけを消す。
 */

import { describe, expect, it } from "vitest";
import { consumePendingSignup, findPendingSignupByTokenHash, upsertPendingSignupUnlessRecent, type Database } from "@kizami/db";
import {
  PASSWORD_RESET_REQUEST_RETENTION_MINUTES,
  PENDING_SIGNUP_RETENTION_AFTER_EXPIRY_MINUTES,
  runPasswordResetRequestCleanup,
  runPendingSignupCleanup,
} from "../src/signup-cleanup.js";
import { acquirePasswordResetRequestSlot } from "@kizami/db";
import { createTestDatabase } from "./support/setup.js";

const DAY = 24 * 60;
const NOW = 100 * DAY;

async function pendingExpiringAt(db: Database, email: string, expiresAt: number) {
  const row = await upsertPendingSignupUnlessRecent(
    db,
    {
    email,
    emailKey: email,
    organizationName: "X",
    adminName: "Y",
    tokenHash: `token-${email}`,
    inviteCodeId: null,
    expiresAt,
    createdAt: expiresAt - DAY,
    },
    { throttleMinutes: 5 },
  );
  if (!row) throw new Error("unexpected throttle");
  return row;
}

describe("runPendingSignupCleanup", () => {
  it("期限切れから7日以上経った未消費だけを削除し、猶予内・未期限・消費済みは残す", async () => {
    const db = await createTestDatabase();
    const old = await pendingExpiringAt(db, "old@example.com", NOW - PENDING_SIGNUP_RETENTION_AFTER_EXPIRY_MINUTES - 1);
    const withinGrace = await pendingExpiringAt(db, "grace@example.com", NOW - 6 * DAY);
    const live = await pendingExpiringAt(db, "live@example.com", NOW + DAY);
    const consumed = await pendingExpiringAt(db, "done@example.com", NOW - 30 * DAY);
    await consumePendingSignup(db, { id: consumed.id, nowMinutes: NOW - 31 * DAY });

    const result = await runPendingSignupCleanup(db, { nowMinutes: NOW });
    expect(result).toEqual({ deletedCount: 1 });

    expect(await findPendingSignupByTokenHash(db, old.tokenHash)).toBeNull();
    for (const kept of [withinGrace, live, consumed]) {
      expect(await findPendingSignupByTokenHash(db, kept.tokenHash)).not.toBeNull();
    }
  });

  it("冪等: 2回目は何も消さない", async () => {
    const db = await createTestDatabase();
    await pendingExpiringAt(db, "old@example.com", NOW - 10 * DAY);
    expect((await runPendingSignupCleanup(db, { nowMinutes: NOW })).deletedCount).toBe(1);
    expect((await runPendingSignupCleanup(db, { nowMinutes: NOW })).deletedCount).toBe(0);
  });
});

describe("runPasswordResetRequestCleanup", () => {
  it("保持期間を過ぎた再送スロットル行だけを消す(冪等)", async () => {
    const db = await createTestDatabase();
    const slot = (emailKey: string, nowMinutes: number) => acquirePasswordResetRequestSlot(db, { emailKey, nowMinutes, throttleMinutes: 5 });
    await slot("old@example.com", NOW - PASSWORD_RESET_REQUEST_RETENTION_MINUTES - 1);
    await slot("recent@example.com", NOW - 10);

    expect(await runPasswordResetRequestCleanup(db, { nowMinutes: NOW })).toEqual({ deletedCount: 1 });
    expect(await runPasswordResetRequestCleanup(db, { nowMinutes: NOW })).toEqual({ deletedCount: 0 });
    // 残った行は窓内なのでまだ抑止が効く
    expect(await slot("recent@example.com", NOW - 9)).toBe(false);
  });
});
