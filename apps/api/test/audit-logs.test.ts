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
import { correctionRequests, insertAuditLog, tenants, upsertMembership, users, uuidv7, type Database } from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";
import { setupOrgFixture } from "./support/org.js";

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

  it("department scope passes the gate and still sees rows about the viewer themself", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "department" });
    await seed(db, { tenantId, actorId: userId, action: "member.invite", targetType: "user", targetId: "u1", occurredAt: 100 });

    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    const { status, body } = await getAuditLogs(app, cookie);
    expect(status).toBe(200);
    expect(body.logs?.map((l) => l.action)).toEqual(["member.invite"]);
  });
});

/**
 * セキュリティ指摘 M7(2026-10-22): audit_log.view を部署スコープで持つ人には、スコープ内の
 * ユーザー・部署に帰属する行だけを見せる(以前はテナント内の全件が見えていた)。
 * 組織: 部署A(viewer と memberA)- 部署A1(memberA1)、部署B(memberB)。
 */
describe("GET /audit-logs department scope (M7)", () => {
  async function setupScoped(scope: "department" | "department_and_descendants" | "tenant") {
    const seeded = await setupTestDb();
    const { db, tenantId, userId } = seeded;
    const org = await setupOrgFixture(db, tenantId);
    await upsertMembership(db, { tenantId, userId, departmentId: org.deptA.id, createdAt: 0 });
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope });
    return { ...seeded, org };
  }

  async function insertCorrectionRequest(db: Database, tenantId: string, ownerId: string): Promise<string> {
    const id = uuidv7();
    await db.insert(correctionRequests).values({
      id,
      tenantId,
      userId: ownerId,
      requestedBy: ownerId,
      status: "pending",
      proposedKind: "clock_in",
      proposedOccurredAt: 0,
      reason: "test",
      createdAt: 0,
    });
    return id;
  }

  /** 見える/見えないが分かれる行を一通り入れ、action に識別名を入れて返す。 */
  async function seedMixed(db: Database, tenantId: string, viewerId: string, org: Awaited<ReturnType<typeof setupScoped>>["org"]) {
    let t = 100;
    const s = (actorId: string, action: string, targetType: string, targetId: string) =>
      seed(db, { tenantId, actorId, action, targetType, targetId, occurredAt: t++ });
    await s(org.memberBUserId, "b-on-b", "user", org.memberBUserId);
    await s(org.memberAUserId, "a-on-a", "user", org.memberAUserId);
    await s(org.memberBUserId, "b-on-a", "users", org.memberAUserId);
    await s(org.memberAUserId, "a-on-b", "user", org.memberBUserId);
    await s(viewerId, "self-tenant-settings", "tenant", tenantId);
    await s(org.memberBUserId, "b-tenant-settings", "tenant", tenantId);
    await s(org.memberBUserId, "b-on-dept-a", "department", org.deptA.id);
    await s(org.memberBUserId, "b-on-dept-b", "department", org.deptB.id);
    await s(org.memberBUserId, "b-closing", "closing", "2026-04");
    await s(org.memberBUserId, "b-on-a-request", "correction_request", await insertCorrectionRequest(db, tenantId, org.memberAUserId));
    await s(org.memberBUserId, "b-on-b-request", "correction_request", await insertCorrectionRequest(db, tenantId, org.memberBUserId));
    await s(org.memberA1UserId, "a1-on-a1", "user", org.memberA1UserId);
    await s(org.memberBUserId, "b-on-dept-a1", "department", org.deptA1.id);
  }

  it("department scope: only rows about (or by, on a user/department target) users and departments in scope", async () => {
    const { db, tenantId, userId, email, password, org } = await setupScoped("department");
    await seedMixed(db, tenantId, userId, org);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { status, body } = await getAuditLogs(app, cookie);
    expect(status).toBe(200);
    expect(body.logs?.map((l) => l.action).sort()).toEqual(["a-on-a", "a-on-b", "b-on-a", "b-on-a-request", "b-on-dept-a"].sort());
  });

  it("department_and_descendants scope also covers the child department (A1)", async () => {
    const { db, tenantId, userId, email, password, org } = await setupScoped("department_and_descendants");
    await seedMixed(db, tenantId, userId, org);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { body } = await getAuditLogs(app, cookie);
    expect(body.logs?.map((l) => l.action).sort()).toEqual(
      ["a-on-a", "a-on-b", "b-on-a", "b-on-a-request", "b-on-dept-a", "a1-on-a1", "b-on-dept-a1"].sort(),
    );
  });

  it("tenant scope still sees every row, including tenant-level ones", async () => {
    const { db, tenantId, userId, email, password, org } = await setupScoped("tenant");
    await seedMixed(db, tenantId, userId, org);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { body } = await getAuditLogs(app, cookie);
    expect(body.logs).toHaveLength(13);
  });

  it("a filter (e.g. actorId) cannot widen the department scope", async () => {
    const { db, tenantId, userId, email, password, org } = await setupScoped("department");
    await seedMixed(db, tenantId, userId, org);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const { body } = await getAuditLogs(app, cookie, `?actorId=${org.memberBUserId}`);
    expect(body.logs?.map((l) => l.action).sort()).toEqual(["b-on-a", "b-on-a-request", "b-on-dept-a"].sort());
  });

  it("pagination stays exact when hidden rows are interleaved", async () => {
    const { db, tenantId, userId, email, password, org } = await setupScoped("department");
    for (let i = 0; i < 6; i++) {
      await seed(db, { tenantId, actorId: org.memberAUserId, action: `visible-${i}`, targetType: "user", targetId: org.memberAUserId, occurredAt: 100 + i * 2 });
      await seed(db, { tenantId, actorId: org.memberBUserId, action: `hidden-${i}`, targetType: "user", targetId: org.memberBUserId, occurredAt: 101 + i * 2 });
    }
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const seen: string[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 5; page++) {
      const { body } = await getAuditLogs(app, cookie, `?limit=4${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...(body.logs ?? []).map((l) => l.action));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["visible-5", "visible-4", "visible-3", "visible-2", "visible-1", "visible-0"]);
    expect(cursor).toBeNull();
  });

  it("a department larger than one query's chunk of user IDs still returns every in-scope row, newest first", async () => {
    const { db, tenantId, email, password, org } = await setupScoped("department");
    const extra: string[] = [];
    for (let i = 0; i < 95; i++) {
      const id = uuidv7();
      await db.insert(users).values({ id, tenantId, email: `bulk-${i}@example.com`, name: `Bulk ${i}`, isActive: true, createdAt: 0 });
      await upsertMembership(db, { tenantId, userId: id, departmentId: org.deptA.id, createdAt: 0 });
      extra.push(id);
    }
    // 新しい順に並べたとき、どのチャンクのユーザーの行かが入り混じるように書く
    for (let i = 0; i < extra.length; i++) {
      const id = extra[(i * 37) % extra.length] as string;
      await seed(db, { tenantId, actorId: id, action: `bulk-${i}`, targetType: "user", targetId: id, occurredAt: 1000 + i });
      await seed(db, { tenantId, actorId: org.memberBUserId, action: `hidden-${i}`, targetType: "user", targetId: org.memberBUserId, occurredAt: 1000 + i });
    }
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const page1 = await getAuditLogs(app, cookie, "?limit=60");
    expect(page1.body.logs?.map((l) => l.action)).toEqual(Array.from({ length: 60 }, (_, i) => `bulk-${94 - i}`));
    const page2 = await getAuditLogs(app, cookie, `?limit=60&cursor=${page1.body.nextCursor}`);
    expect(page2.body.logs?.map((l) => l.action)).toEqual(Array.from({ length: 35 }, (_, i) => `bulk-${34 - i}`));
    expect(page2.body.nextCursor).toBeNull();
  });
});
