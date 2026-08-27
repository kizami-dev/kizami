import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG } from "@kizami/authz";
import { auditLogs, permissionPresets, uuidv7, type Database } from "@kizami/db";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { denyPermission, grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

async function auditActionsFor(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  return rows.map((r) => r.action);
}

/** テスト専用: API からは作れない isSystem=true のプリセットを直接 DB に挿入する。 */
async function insertSystemPreset(
  db: Database,
  params: { tenantId: string; name: string; grants: { key: string; scope: string }[] },
): Promise<string> {
  const id = uuidv7();
  await db.insert(permissionPresets).values({
    id,
    tenantId: params.tenantId,
    name: params.name,
    description: null,
    grants: JSON.stringify(params.grants),
    isSystem: true,
    createdAt: 0,
  });
  return id;
}

describe("presets API", () => {
  describe("GET /presets, GET /presets/catalog", () => {
    it("GET /presets returns 403 without permission.preset.manage", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets", { headers: { cookie } });
      expect(res.status).toBe(403);
    });

    it("GET /presets/catalog returns the full 30-item machine-readable catalog", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets/catalog", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { catalog: unknown[] };
      expect(body.catalog.length).toBe(PERMISSION_CATALOG.length);
    });
  });

  /**
   * 拒否ルール(deny、2026-08-24。docs/design/permission-catalog.md §拒否(deny)ルール)。
   * deny はスコープを持たず全面的で、どのプリセットの付与にも優先する。
   */
  describe("denies(拒否ルール)", () => {
    it("POST /presets accepts denies and GET /presets returns them (UI 用シリアライズ)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const created = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "締め担当(締め実行は禁止)",
          grants: [{ key: "closing.view", scope: "tenant" }],
          denies: ["closing.execute"],
        }),
      });
      expect(created.status).toBe(201);
      expect((await created.json()) as { preset: { denies: string[] } }).toMatchObject({
        preset: { denies: ["closing.execute"] },
      });

      const list = await app.request("/presets", { headers: { cookie } });
      const body = (await list.json()) as { presets: { name: string; grants: unknown[]; denies: string[] }[] };
      const target = body.presets.find((p) => p.name === "締め担当(締め実行は禁止)");
      expect(target?.denies).toEqual(["closing.execute"]);
      // deny を持たないプリセット(grantPermission が作ったもの)は常に空配列で返る
      expect(body.presets.every((p) => Array.isArray(p.denies))).toBe(true);
    });

    it("POST /presets omitting denies defaults to an empty list (後方互換)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "拒否なし", grants: [] }),
      });
      expect(res.status).toBe(201);
      expect((await res.json()) as { preset: { denies: string[] } }).toMatchObject({ preset: { denies: [] } });
    });

    it("returns 400 invalid_denies for a permission key that doesn't exist in the catalog", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "x", grants: [], denies: ["not.a.real.permission"] }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_denies" });
    });

    it("returns 400 invalid_denies when trying to deny a self-service permission", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      // セルフサービス権限はカタログに含まれない(=拒否できない)ため invalid_denies になる
      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "x", grants: [], denies: ["self_service.punch"] }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_denies" });
    });

    it("returns 400 invalid_denies for a duplicated key", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "x", grants: [], denies: ["closing.execute", "closing.execute"] }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_denies" });
    });

    it("PATCH /presets/:id updates denies and records both sides in the audit log", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const created = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "編集対象", grants: [], denies: ["closing.execute"] }),
      });
      const { preset } = (await created.json()) as { preset: { id: string } };

      const res = await app.request(`/presets/${preset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ denies: ["audit_log.view"] }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()) as { preset: { denies: string[] } }).toMatchObject({
        preset: { denies: ["audit_log.view"] },
      });

      const updateLog = (await db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId))).find(
        (r) => r.action === "permission_preset.update",
      );
      // 監査ログの詳細は afterDigest 列に JSON 文字列で入る(packages/db/src/queries/audit.ts)
      const detail = JSON.parse(updateLog!.afterDigest!) as {
        before: { denies: string[] };
        after: { denies: string[] };
      };
      expect(detail.before.denies).toEqual(["closing.execute"]);
      expect(detail.after.denies).toEqual(["audit_log.view"]);
    });

    it("a deny in one preset cancels a grant from another preset (実効権限に反映される)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      // 付与用プリセットで audit_log.view(tenant)を得たうえで、拒否用プリセットも割り当てる
      await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const before = await app.request("/audit-logs", { headers: { cookie } });
      expect(before.status).toBe(200);

      await denyPermission(db, { tenantId, userId, permission: "audit_log.view" });

      const after = await app.request("/audit-logs", { headers: { cookie } });
      expect(after.status).toBe(403);
    });

    it("last_admin: a preset edit that denies permission.preset.manage for the last holder is rejected", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      // userId はテナント唯一の権限管理保持者。その権限は自分が編集できるプリセット経由で持つ。
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const adminPresetId = (
        await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId))
      )[0]!.id;

      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      // 割当は一切触らず、プリセットに deny を1つ足すだけで権限管理者を0人にできてしまう —
      // これを 409 last_admin で拒否する(2026-08-24 に追加したプリセット編集版の固定原則)
      const res = await app.request(`/presets/${adminPresetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ denies: ["permission.preset.manage"] }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "last_admin" });

      // 拒否されたので DB は変わっていない(引き続き権限管理ができる)
      const stillOk = await app.request("/presets", { headers: { cookie } });
      expect(stillOk.status).toBe(200);
    });

    it("last_admin: a preset edit that removes the permission.preset.manage grant is rejected too", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const adminPresetId = (
        await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId))
      )[0]!.id;

      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/presets/${adminPresetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ grants: [] }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "last_admin" });
    });

    it("allows denying permission.preset.manage in a preset while another holder remains", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const adminPresetId = (
        await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId))
      )[0]!.id;

      // もう1人、別プリセット経由の権限管理保持者を用意する(この人は編集対象プリセットを持たない)
      const other = await setupSecondUser(db, tenantId);
      await grantPermission(db, { tenantId, userId: other.userId, permission: "permission.preset.manage", scope: "tenant" });

      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/presets/${adminPresetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ denies: ["permission.preset.manage"] }),
      });
      expect(res.status).toBe(200);

      // 編集した本人はもう権限管理できない(deny が効いている)
      const nowForbidden = await app.request("/presets", { headers: { cookie } });
      expect(nowForbidden.status).toBe(403);
    });

    it("a preset edit that doesn't touch grants/denies skips the last-admin check", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const adminPresetId = (
        await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId))
      )[0]!.id;

      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/presets/${adminPresetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "名前だけ変更" }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /presets", () => {
    it("returns 403 without permission.preset.manage", async () => {
      const { db, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "カスタム", grants: [] }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 400 invalid_grants for a permission key that doesn't exist in the catalog", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "カスタム", grants: [{ key: "not.a.real.permission", scope: "tenant" }] }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_grants" });
    });

    it("returns 400 invalid_grants for a scope the catalog doesn't allow for that key", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      // tenant_settings.gps.manage はカタログ上 "tenant" スコープしか選択できない
      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "カスタム", grants: [{ key: "tenant_settings.gps.manage", scope: "department" }] }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_grants" });
    });

    it("creates a preset and records an audit log entry", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "カスタム閲覧",
          description: "閲覧のみ",
          grants: [{ key: "member.view", scope: "department" }],
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { preset: { id: string; name: string; isSystem: boolean; grants: unknown[] } };
      expect(body.preset.name).toBe("カスタム閲覧");
      expect(body.preset.isSystem).toBe(false);
      expect(body.preset.grants).toEqual([{ key: "member.view", scope: "department" }]);

      expect(await auditActionsFor(db, tenantId)).toContain("permission_preset.create");
    });
  });

  describe("PATCH /presets/:id", () => {
    it("returns 409 system_preset for a system preset", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const presetId = await insertSystemPreset(db, { tenantId, name: "管理者", grants: [] });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/presets/${presetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "改名した管理者" }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "system_preset" });
    });

    it("updates a non-system preset's grants after catalog validation", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const createRes = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "カスタム", grants: [] }),
      });
      const created = ((await createRes.json()) as { preset: { id: string } }).preset;

      const res = await app.request(`/presets/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ grants: [{ key: "closing.view", scope: "tenant" }] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { preset: { grants: unknown[] } };
      expect(body.preset.grants).toEqual([{ key: "closing.view", scope: "tenant" }]);
    });
  });

  describe("DELETE /presets/:id", () => {
    it("returns 409 system_preset for a system preset", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const presetId = await insertSystemPreset(db, { tenantId, name: "メンバー", grants: [] });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/presets/${presetId}`, { method: "DELETE", headers: { cookie } });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "system_preset" });
    });

    it("returns 409 preset_in_use when the preset is still assigned to a member", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      await grantPermission(db, { tenantId, userId, permission: "permission.assignment.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const createRes = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "カスタム", grants: [{ key: "closing.view", scope: "tenant" }] }),
      });
      const created = ((await createRes.json()) as { preset: { id: string } }).preset;

      const second = await setupSecondUser(db, tenantId);
      const assignRes = await app.request(`/members/${second.userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ presetIds: [created.id] }),
      });
      expect(assignRes.status).toBe(200);

      const res = await app.request(`/presets/${created.id}`, { method: "DELETE", headers: { cookie } });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "preset_in_use" });
    });

    it("deletes an unassigned non-system preset and records an audit log entry", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const createRes = await app.request("/presets", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "カスタム", grants: [] }),
      });
      const created = ((await createRes.json()) as { preset: { id: string } }).preset;

      const res = await app.request(`/presets/${created.id}`, { method: "DELETE", headers: { cookie } });
      expect(res.status).toBe(200);

      expect(await auditActionsFor(db, tenantId)).toContain("permission_preset.delete");
    });
  });

  describe("PUT /members/:id/presets — 固定原則", () => {
    it("returns 403 without permission.assignment.manage", async () => {
      const { db, userId, email, password } = await setupTestDb();
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const res = await app.request(`/members/${userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ presetIds: [] }),
      });
      expect(res.status).toBe(403);
    });

    it("self_escalation: an actor cannot grant themselves a permission they don't currently hold", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      // 割当APIを呼ぶための最低権限のみ付与(department スコープ)
      await grantPermission(db, { tenantId, userId, permission: "permission.assignment.manage", scope: "department" });
      const assignOnlyPresetId = (
        await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId))
      )[0]!.id;

      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      // 現在持っていない audit_log.view (tenant) を新たに得ようとする preset を追加割当する。
      // actor は permission.preset.manage を持たないため POST /presets では作れない —
      // isSystem=true として直接 DB に差し込む(割当自体は preset.manage ではなく
      // assignment.manage の管轄なので、isSystem のプリセットでも割当は可能)。
      const extraPresetId = await insertSystemPreset(db, {
        tenantId,
        name: "extra",
        grants: [{ key: "audit_log.view", scope: "tenant" }],
      });
      const res = await app.request(`/members/${userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ presetIds: [assignOnlyPresetId, extraPresetId] }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "self_escalation" });
    });

    it("self_demotion: an actor cannot drop their own permission.preset.manage via self-assignment", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
      await grantPermission(db, { tenantId, userId, permission: "permission.assignment.manage", scope: "tenant" });
      const assignments = await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId));
      const assignManagePresetId = assignments.find((p) => p.name === "test-grant:permission.assignment.manage")!.id;

      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      // permission.preset.manage を持つプリセットを外し、assignment.manage のプリセットだけ残す
      const res = await app.request(`/members/${userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ presetIds: [assignManagePresetId] }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "self_demotion" });
    });

    it("last_admin: cannot remove permission.preset.manage from the tenant's last holder (even by another actor)", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      // userId (target) = テナント唯一の権限管理保持者
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });

      // 別の actor が assignment.manage を持ち、target の割当を操作する
      const actor = await setupSecondUser(db, tenantId);
      await grantPermission(db, { tenantId, userId: actor.userId, permission: "permission.assignment.manage", scope: "tenant" });

      const app = createApp({ db });
      const actorCookie = await loginAndGetCookie(app, actor.email, actor.password);

      const res = await app.request(`/members/${userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: actorCookie },
        body: JSON.stringify({ presetIds: [] }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "last_admin" });
    });

    it("allows removing permission.preset.manage from a user when another holder remains in the tenant", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });

      const actor = await setupSecondUser(db, tenantId);
      await grantPermission(db, { tenantId, userId: actor.userId, permission: "permission.assignment.manage", scope: "tenant" });
      // actor 自身も preset.manage を保持(こちらが「もう1人の保持者」)
      await grantPermission(db, { tenantId, userId: actor.userId, permission: "permission.preset.manage", scope: "tenant" });

      const app = createApp({ db });
      const actorCookie = await loginAndGetCookie(app, actor.email, actor.password);

      const res = await app.request(`/members/${userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: actorCookie },
        body: JSON.stringify({ presetIds: [] }),
      });
      expect(res.status).toBe(200);
    });

    it("assigns presets and records an audit log entry", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.assignment.manage", scope: "tenant" });
      const presetId = (await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId)))[0]!.id;

      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const second = await setupSecondUser(db, tenantId);
      const res = await app.request(`/members/${second.userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ presetIds: [presetId] }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ presetIds: [presetId] });

      expect(await auditActionsFor(db, tenantId)).toContain("permission_assignment.update");
    });

    it("returns 400 invalid_preset_id for a preset that doesn't exist in the tenant", async () => {
      const { db, tenantId, userId, email, password } = await setupTestDb();
      await grantPermission(db, { tenantId, userId, permission: "permission.assignment.manage", scope: "tenant" });
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const second = await setupSecondUser(db, tenantId);
      const res = await app.request(`/members/${second.userId}/presets`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ presetIds: ["nonexistent"] }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_preset_id" });
    });
  });
});
