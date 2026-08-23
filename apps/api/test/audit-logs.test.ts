/**
 * GET /audit-logs(Tier 1)。参照: apps/api/src/routes/audit-logs.ts、
 * docs/design/permission-catalog.md §1.13(audit_log.view)。
 *
 * 監査ログは読み取り専用API(更新・削除は無い)なので、ここではフィルタ・ページング・
 * テナント越え不可・権限なし403 のみを検証する。insertAuditLog で直接シードし、
 * 個々の業務エンドポイント(締め・修正申請等)が正しい action/target で書き込むことは
 * それぞれの機能のテストが担う。
 */

import { describe, expect, it } from "vitest";
import { insertAuditLog, tenants, users, uuidv7, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

interface AuditLogDto {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  occurredAt: number;
}

async function getAuditLogs(app: RequestLike, cookie: string, query = "") {
  const res = await app.request(`/audit-logs${query}`, { headers: { cookie } });
  const body = (await res.json()) as { logs?: AuditLogDto[]; nextCursor?: string | null; error?: string };
  return { status: res.status, body };
}

async function seed(
  db: Database,
  params: { tenantId: string; actorId: string; action: string; targetType: string; targetId: string; occurredAt: number; detail?: unknown },
) {
  return insertAuditLog(db, {
    tenantId: params.tenantId,
    actorId: params.actorId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    detail: JSON.stringify(params.detail ?? {}),
    occurredAt: params.occurredAt,
  });
}

describe("GET /audit-logs", () => {
  it("403s when the actor has no audit_log.view permission at all", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status } = await getAuditLogs(app, cookie);
    expect(status).toBe(403);
  });

  it("returns entries newest-first with the actor's display name joined in, once audit_log.view is granted", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });
    await seed(db, { tenantId, actorId: userId, action: "member.invite", targetType: "user", targetId: "u1", occurredAt: 100 });
    await seed(db, { tenantId, actorId: userId, action: "closing.close", targetType: "closing", targetId: "2026-04", occurredAt: 200 });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status, body } = await getAuditLogs(app, cookie);
    expect(status).toBe(200);
    expect(body.logs).toHaveLength(2);
    expect(body.logs?.map((l) => l.action)).toEqual(["closing.close", "member.invite"]); // occurredAt 降順
    expect(body.logs?.[0]).toMatchObject({ actorId: userId, actorName: "Test User", targetType: "closing", targetId: "2026-04" });
    expect(body.nextCursor).toBeNull();
  });

  it("detail is returned as the raw JSON string (for the UI to parse/format)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });
    await seed(db, { tenantId, actorId: userId, action: "closing.close", targetType: "closing", targetId: "2026-04", occurredAt: 100, detail: { note: "月次確定", userCount: 3 } });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const { body } = await getAuditLogs(app, cookie);
    const detail = JSON.parse(body.logs?.[0]?.detail ?? "null") as { note: string; userCount: number };
    expect(detail).toEqual({ note: "月次確定", userCount: 3 });
  });

  it("filters by actorId, action, targetType, targetId, and from/to", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });

    const otherActorId = uuidv7();
    await db.insert(users).values({ id: otherActorId, tenantId, email: "other-actor@example.com", name: "Other Actor", isActive: true, createdAt: 0 });

    await seed(db, { tenantId, actorId: userId, action: "member.invite", targetType: "user", targetId: "u1", occurredAt: 100 });
    await seed(db, { tenantId, actorId: userId, action: "closing.close", targetType: "closing", targetId: "2026-04", occurredAt: 200 });
    await seed(db, { tenantId, actorId: otherActorId, action: "closing.close", targetType: "closing", targetId: "2026-05", occurredAt: 300 });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const byActor = await getAuditLogs(app, cookie, `?actorId=${otherActorId}`);
    expect(byActor.body.logs?.map((l) => l.targetId)).toEqual(["2026-05"]);

    const byAction = await getAuditLogs(app, cookie, "?action=closing.close");
    expect(byAction.body.logs?.map((l) => l.targetId).sort()).toEqual(["2026-04", "2026-05"]);

    const byTargetType = await getAuditLogs(app, cookie, "?targetType=user");
    expect(byTargetType.body.logs?.map((l) => l.action)).toEqual(["member.invite"]);

    const byTargetId = await getAuditLogs(app, cookie, "?targetType=closing&targetId=2026-04");
    expect(byTargetId.body.logs?.map((l) => l.targetId)).toEqual(["2026-04"]);

    const byRange = await getAuditLogs(app, cookie, "?from=150&to=250");
    expect(byRange.body.logs?.map((l) => l.targetId)).toEqual(["2026-04"]);

    const invalidRange = await getAuditLogs(app, cookie, "?from=300&to=100");
    expect(invalidRange.status).toBe(400);
  });

  it("paginates with a cursor (newest page first, no duplicates/gaps across pages)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });
    for (let i = 0; i < 5; i++) {
      await seed(db, { tenantId, actorId: userId, action: "member.invite", targetType: "user", targetId: `u${i}`, occurredAt: 100 + i });
    }

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const page1 = await getAuditLogs(app, cookie, "?limit=2");
    expect(page1.status).toBe(200);
    expect(page1.body.logs?.map((l) => l.targetId)).toEqual(["u4", "u3"]);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await getAuditLogs(app, cookie, `?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.logs?.map((l) => l.targetId)).toEqual(["u2", "u1"]);
    expect(page2.body.nextCursor).toBeTruthy();

    const page3 = await getAuditLogs(app, cookie, `?limit=2&cursor=${page2.body.nextCursor}`);
    expect(page3.body.logs?.map((l) => l.targetId)).toEqual(["u0"]);
    expect(page3.body.nextCursor).toBeNull();

    // limit の既定・上限
    const badLimit = await getAuditLogs(app, cookie, "?limit=0");
    expect(badLimit.status).toBe(400);
    const tooBigLimit = await getAuditLogs(app, cookie, "?limit=201");
    expect(tooBigLimit.status).toBe(400);
  });

  it("never returns another tenant's audit log entries, even with a broad grant", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });

    const otherTenantId = uuidv7();
    await db.insert(tenants).values({ id: otherTenantId, name: "Other Tenant", createdAt: 0 });
    const otherUserId = uuidv7();
    await db.insert(users).values({ id: otherUserId, tenantId: otherTenantId, email: "elsewhere@example.com", name: "Elsewhere", isActive: true, createdAt: 0 });
    await seed(db, { tenantId: otherTenantId, actorId: otherUserId, action: "closing.close", targetType: "closing", targetId: "2026-04", occurredAt: 100 });
    await seed(db, { tenantId, actorId: userId, action: "member.invite", targetType: "user", targetId: "u1", occurredAt: 100 });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { body } = await getAuditLogs(app, cookie);
    expect(body.logs).toHaveLength(1);
    expect(body.logs?.[0]?.action).toBe("member.invite");
  });

  it("department scope is enough to pass the coarse gate (audit_log.view is not further scoped per-record, like closing.view)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "department" });
    await seed(db, { tenantId, actorId: userId, action: "member.invite", targetType: "user", targetId: "u1", occurredAt: 100 });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const { status } = await getAuditLogs(app, cookie);
    expect(status).toBe(200);
  });
});
