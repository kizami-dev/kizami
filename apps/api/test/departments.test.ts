import { describe, expect, it } from "vitest";
import { auditLogs, upsertMembership, type Database } from "@kizami/db";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

describe("departments API", () => {
  it("GET returns 403 without department.manage or member.view", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/departments", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("GET succeeds for a member.view holder even without department.manage", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "department" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/departments", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()) as { departments: unknown[] }).toEqual({ departments: [] });
  });

  it("POST returns 403 without department.manage", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "営業部" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST creates a root department and records an audit log entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "営業部" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { department: { id: string; name: string; parentId: string | null } };
    expect(body.department.name).toBe("営業部");
    expect(body.department.parentId).toBeNull();

    expect(await auditActionsFor(db, tenantId)).toEqual(["department.create"]);
  });

  it("POST with an unknown parentId returns 400 invalid_parent_id", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "営業部", parentId: "nonexistent" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_parent_id" });
  });

  it("PATCH rejects setting a department as its own parent (circular_reference)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const createRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "本社" }),
    });
    const { department } = (await createRes.json()) as { department: { id: string } };

    const res = await app.request(`/departments/${department.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentId: department.id }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "circular_reference" });
  });

  it("PATCH rejects moving a department under its own descendant (circular_reference)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const rootRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "本社" }),
    });
    const root = ((await rootRes.json()) as { department: { id: string } }).department;

    const childRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "営業部", parentId: root.id }),
    });
    const child = ((await childRes.json()) as { department: { id: string } }).department;

    const grandchildRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "第一営業課", parentId: child.id }),
    });
    const grandchild = ((await grandchildRes.json()) as { department: { id: string } }).department;

    // root の親を、root 自身の孫(grandchild)にしようとする → 循環
    const res = await app.request(`/departments/${root.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentId: grandchild.id }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "circular_reference" });
  });

  it("PATCH allows moving a department to a valid new (non-descendant) parent", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const aRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "A部" }),
    });
    const a = ((await aRes.json()) as { department: { id: string } }).department;

    const bRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "B部" }),
    });
    const b = ((await bRes.json()) as { department: { id: string } }).department;

    const res = await app.request(`/departments/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ parentId: b.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { department: { parentId: string | null } };
    expect(body.department.parentId).toBe(b.id);

    expect(await auditActionsFor(db, tenantId)).toEqual(["department.create", "department.create", "department.update"]);
  });

  it("DELETE returns 409 department_not_empty when the department has a child department", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const rootRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "本社" }),
    });
    const root = ((await rootRes.json()) as { department: { id: string } }).department;

    await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "営業部", parentId: root.id }),
    });

    const res = await app.request(`/departments/${root.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "department_not_empty" });
  });

  it("DELETE returns 409 department_not_empty when a member belongs to the department", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const deptRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "営業部" }),
    });
    const dept = ((await deptRes.json()) as { department: { id: string } }).department;

    await upsertMembership(db, { tenantId, userId, departmentId: dept.id, createdAt: 0 });

    const res = await app.request(`/departments/${dept.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "department_not_empty" });
  });

  it("DELETE removes an empty leaf department and records an audit log entry", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const deptRes = await app.request("/departments", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "営業部" }),
    });
    const dept = ((await deptRes.json()) as { department: { id: string } }).department;

    const res = await app.request(`/departments/${dept.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);

    const listRes = await app.request("/departments", { headers: { cookie } });
    expect((await listRes.json()) as { departments: unknown[] }).toEqual({ departments: [] });

    expect(await auditActionsFor(db, tenantId)).toEqual(["department.create", "department.delete"]);
  });

  it("DELETE of a nonexistent department returns 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "department.manage", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/departments/nonexistent", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(404);
  });
});
