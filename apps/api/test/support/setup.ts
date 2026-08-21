/**
 * テスト専用のシードヘルパ。テナント1件・タイムゾーンJST固定・日界0時・
 * フレックス月清算(標準1日480分)・ユーザー1件を最小限で投入する。
 */

import {
  authCredentials,
  migrateDb,
  tenantSettingVersions,
  tenants,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  workPolicyVersions,
  type Database,
} from "@kizami/db";
import { hashPassword } from "../../src/auth/password.js";

export interface SeededTenant {
  db: Database;
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  displayName: string;
}

export async function setupTestDb(): Promise<SeededTenant> {
  const { db } = await migrateDb();
  const now = 0;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const email = "test@example.com";
  const password = "correct horse battery staple";
  const displayName = "Test User";

  await db.insert(tenants).values({ id: tenantId, name: "Test Tenant", createdAt: now });

  await db.insert(tenantSettingVersions).values({
    id: uuidv7(),
    tenantId,
    effectiveFrom: "1970-01-01",
    dayBoundaryMinutes: 0,
    legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
    breakRule: JSON.stringify({ mode: "punch" }),
    gpsEnabled: false,
    gpsRetentionDays: null,
    createdAt: now,
  });

  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId, name: "Flex", createdAt: now });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    settlementPeriod: "monthly",
    core: null,
    standardDayMinutes: 480,
    createdAt: now,
  });

  await db.insert(users).values({ id: userId, tenantId, email, name: displayName, isActive: true, createdAt: now });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId,
    userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: now,
  });

  return { db, tenantId, userId, email, password, displayName };
}

export function extractCookie(res: Response): string {
  const setCookieHeader = res.headers.get("set-cookie");
  if (!setCookieHeader) {
    throw new Error("response has no set-cookie header");
  }
  return setCookieHeader.split(";")[0] as string;
}

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

export async function loginAndGetCookie(app: RequestLike, email: string, password: string): Promise<string> {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`login failed with status ${res.status}`);
  }
  return extractCookie(res);
}

/** ローカル JST の日時から UTC エポック分を計算する(テスト専用、tzOffset=540 固定)。 */
export function jstMinutes(year: number, month: number, day: number, hour: number, minute: number): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour - 9, minute) / 60_000);
}
