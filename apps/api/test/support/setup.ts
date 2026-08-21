/**
 * テスト専用のシードヘルパ。テナント1件・タイムゾーンJST固定・日界0時・
 * フレックス月清算(標準1日480分)・ユーザー1件を最小限で投入する。
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // @libsql/client のローカル sqlite3 ドライバは `db.transaction()` 実行後、client 側の
  // ネイティブ接続を手放し次回アクセス時に遅延再接続する。`:memory:` だとその再接続が
  // 新規の空DBになりデータが失われる(修正申請の承認処理が db.transaction を使うため、
  // このテスト DB でそれ以降のリクエストが軒並み失敗する)。ファイルバックエンドにして回避する。
  const dbPath = join(tmpdir(), `kizami-api-test-${randomUUID()}.db`);
  const { db } = await migrateDb({ url: `file:${dbPath}` });
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

export interface SeededSecondUser {
  userId: string;
  email: string;
  password: string;
}

/**
 * `setupTestDb()` が作った同一テナントへ、もう1人ユーザーを追加する(修正申請の
 * 「他人のイベント」バリデーションテスト用)。work_policy 割当は行わない
 * (打刻・修正申請のテストのみが対象で、勤怠集計は使わないため)。
 */
export async function setupSecondUser(db: Database, tenantId: string): Promise<SeededSecondUser> {
  const now = 0;
  const userId = uuidv7();
  const email = "second@example.com";
  const password = "another horse battery staple";

  await db.insert(users).values({ id: userId, tenantId, email, name: "Second User", isActive: true, createdAt: now });
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });

  return { userId, email, password };
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
