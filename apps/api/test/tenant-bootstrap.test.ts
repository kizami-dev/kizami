/**
 * テナント初期構築(src/lib/tenant-bootstrap.ts)のテスト。
 *
 * seed(`pnpm seed`)と create-tenant(`pnpm create-tenant`)が共有する処理で、
 * CLI 側は環境変数の読み取りと冪等判定だけを担う。ここでは実処理側
 * (作られる中身・同梱プリセットの同期・冪等判定に使う検索関数)を検証する。
 */

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { permissionPresets, presetAssignments, tenantSettingVersions, workPolicyVersions } from "@kizami/db";
import { createApp } from "../src/app.js";
import {
  ADMIN_GRANTS,
  bootstrapTenant,
  findTenantsByName,
  findUserByEmailInTenant,
  syncSystemPresetGrants,
  type Grant,
} from "../src/lib/tenant-bootstrap.js";
import { createTestDatabase, loginAndGetCookie } from "./support/setup.js";

const PASSWORD = "correct horse battery staple";

describe("bootstrapTenant", () => {
  it("テナント・既定設定版・既定の労働時間制・同梱プリセット3種・管理者を作り、そのままログインできる", async () => {
    const db = await createTestDatabase();
    const { tenantId, userId } = await bootstrapTenant(db, {
      tenantName: "サンプル株式会社",
      adminEmail: "admin@example.com",
      adminPassword: PASSWORD,
    });

    const settings = await db.select().from(tenantSettingVersions).where(eq(tenantSettingVersions.tenantId, tenantId));
    expect(settings).toHaveLength(1);
    const policies = await db.select().from(workPolicyVersions).where(eq(workPolicyVersions.tenantId, tenantId));
    expect(policies).toHaveLength(1);

    const presets = await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId));
    expect(presets.map((p) => p.name).sort()).toEqual(["マネージャー", "メンバー", "管理者"]);
    expect(presets.every((p) => p.isSystem)).toBe(true);

    const assignments = await db.select().from(presetAssignments).where(eq(presetAssignments.tenantId, tenantId));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.userId).toBe(userId);

    // 作られた管理者でログインでき、管理者向けエンドポイント(メンバー一覧)が通る
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, "admin@example.com", PASSWORD);
    const res = await app.request("/members", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("2社作ってもプリセット・設定は互いに独立する", async () => {
    const db = await createTestDatabase();
    const a = await bootstrapTenant(db, { tenantName: "A社", adminEmail: "a@example.com", adminPassword: PASSWORD });
    const b = await bootstrapTenant(db, { tenantName: "B社", adminEmail: "b@example.com", adminPassword: PASSWORD });

    expect(a.tenantId).not.toBe(b.tenantId);
    const presetsA = await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, a.tenantId));
    const presetsB = await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, b.tenantId));
    expect(presetsA).toHaveLength(3);
    expect(presetsB).toHaveLength(3);
    expect(presetsA.map((p) => p.id).some((id) => presetsB.map((q) => q.id).includes(id))).toBe(false);
  });
});

describe("syncSystemPresetGrants", () => {
  it("カタログに増えた権限だけを同梱プリセットへ追記し、既存の grant は触らない", async () => {
    const db = await createTestDatabase();
    const { tenantId } = await bootstrapTenant(db, {
      tenantName: "サンプル株式会社",
      adminEmail: "admin@example.com",
      adminPassword: PASSWORD,
    });

    // 「カタログに後から権限が増えた」状況を、既存テナントの grants を削って再現する
    const trimmed = ADMIN_GRANTS.filter((g) => g.key !== "shift.manage");
    await db
      .update(permissionPresets)
      .set({ grants: JSON.stringify([...trimmed, { key: "custom.legacy.permission", scope: "tenant" }]) })
      .where(eq(permissionPresets.name, "管理者"));

    const added = await syncSystemPresetGrants(db, tenantId);
    expect(added.get("管理者")).toEqual(["shift.manage"]);

    const rows = await db.select().from(permissionPresets).where(eq(permissionPresets.name, "管理者"));
    const grants = JSON.parse(rows[0]?.grants ?? "[]") as Grant[];
    expect(grants.map((g) => g.key)).toContain("shift.manage");
    // 運用側で入っていた見知らぬ grant は削除されない
    expect(grants.map((g) => g.key)).toContain("custom.legacy.permission");

    // 2回目は差分なし
    expect(await syncSystemPresetGrants(db, tenantId)).toEqual(new Map());
  });
});

describe("create-tenant の冪等判定に使う検索", () => {
  it("同名テナント・テナント内の同一メールを引ける(他テナントの同一メールは引っかからない)", async () => {
    const db = await createTestDatabase();
    const a = await bootstrapTenant(db, { tenantName: "同名株式会社", adminEmail: "admin@example.com", adminPassword: PASSWORD });
    const b = await bootstrapTenant(db, { tenantName: "別会社", adminEmail: "admin@example.com", adminPassword: PASSWORD });

    const sameName = await findTenantsByName(db, "同名株式会社");
    expect(sameName.map((t) => t.id)).toEqual([a.tenantId]);

    expect((await findUserByEmailInTenant(db, a.tenantId, "admin@example.com"))?.tenantId).toBe(a.tenantId);
    expect((await findUserByEmailInTenant(db, b.tenantId, "admin@example.com"))?.tenantId).toBe(b.tenantId);
    expect(await findUserByEmailInTenant(db, a.tenantId, "nobody@example.com")).toBeNull();
  });
});
