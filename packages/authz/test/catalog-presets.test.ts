/**
 * docs/design/permission-catalog.md §4「標準プリセット3種の権限割当表」を入力にした
 * 期待結果のテスト。grants の内容は apps/api/src/seed.ts の ADMIN_GRANTS/MANAGER_GRANTS と
 * 同じもの(同梱プリセットの実データ)を最小限で再現している。
 */
import { describe, expect, it } from "vitest";
import { expandImplied, hasPermission, resolveEffectiveGrants } from "../src/resolve.js";
import { SELF_SERVICE_PERMISSIONS } from "../src/self-service.js";
import type { Grant } from "../src/types.js";

const ADMIN_GRANTS: Grant[] = [
  "attendance.punch.proxy",
  "attendance.correction.request_for_others",
  "attendance.correction.approve",
  "attendance.record.view",
  "leave.request.approve",
  "leave.grant.manage",
  "leave.mandatory_five_days.view",
  "closing.execute",
  "closing.unlock",
  "export.attendance.run",
  "alert.labor_limit.configure",
  "member.invite",
  "member.profile.edit",
  "member.deactivate",
  "member.erase",
  "department.manage",
  "tenant_settings.calendar.manage",
  "tenant_settings.flex.manage",
  "tenant_settings.gps.manage",
  "tenant_settings.auto_deduction.manage",
  "notification.settings.manage",
  "permission.preset.manage",
  "permission.assignment.manage",
  "audit_log.view",
  "api_key.manage",
].map((permission) => ({ permission, scope: "tenant" as const }));

const MANAGER_GRANTS: Grant[] = [
  "attendance.correction.approve",
  "attendance.record.view",
  "leave.request.approve",
  "leave.balance.view",
  "leave.mandatory_five_days.view",
  "closing.view",
  "export.attendance.run",
  "alert.labor_limit.view",
  "member.profile.edit",
  "member.view",
].map((permission) => ({ permission, scope: "department_and_descendants" as const }));

/** メンバープリセットはカタログ上の業務タスク権限を一切持たない。 */
const MEMBER_GRANTS: Grant[] = [];

describe("standard presets (permission-catalog.md §4)", () => {
  it("admin: catalog permissions are all granted at tenant scope, plus their implied views", () => {
    const effective = expandImplied(resolveEffectiveGrants([ADMIN_GRANTS]));

    expect(hasPermission(effective, "closing.unlock", "tenant")).toBe(true);
    expect(hasPermission(effective, "audit_log.view", "tenant")).toBe(true); // closing.unlock が含意
    expect(hasPermission(effective, "permission.assignment.manage", "tenant")).toBe(true);
    expect(hasPermission(effective, "permission_preset.view", "tenant")).toBe(true); // 含意展開
    expect(hasPermission(effective, "member.deactivate", "tenant")).toBe(true);
    expect(hasPermission(effective, "member.view", "tenant")).toBe(true); // member.deactivate が含意
  });

  it("manager: granted permissions are scoped to department_and_descendants, not tenant", () => {
    const effective = expandImplied(resolveEffectiveGrants([MANAGER_GRANTS]));

    expect(hasPermission(effective, "attendance.correction.approve", "department_and_descendants")).toBe(true);
    expect(hasPermission(effective, "attendance.correction.approve", "tenant")).toBe(false);
    // leave.request.approve が leave.request.view_all を同スコープで含意する
    expect(hasPermission(effective, "leave.request.view_all", "department_and_descendants")).toBe(true);
  });

  it("manager: does not hold admin-only permissions", () => {
    const effective = expandImplied(resolveEffectiveGrants([MANAGER_GRANTS]));

    expect(hasPermission(effective, "closing.unlock", "self")).toBe(false);
    expect(hasPermission(effective, "permission.preset.manage", "self")).toBe(false);
    expect(hasPermission(effective, "api_key.manage", "self")).toBe(false);
  });

  it("member: holds none of the 30 catalog permissions, only the fixed self-service grants", () => {
    const effective = expandImplied(resolveEffectiveGrants([MEMBER_GRANTS]));

    expect(hasPermission(effective, "attendance.record.view", "self")).toBe(false);
    expect(hasPermission(effective, "member.view", "self")).toBe(false);
    expect(hasPermission(effective, SELF_SERVICE_PERMISSIONS.punch, "self")).toBe(true);
    expect(hasPermission(effective, SELF_SERVICE_PERMISSIONS.viewOwnRecord, "self")).toBe(true);
  });

  it("a user assigned both manager and member presets gets the union (manager's grants win, unaffected by the empty member preset)", () => {
    const effective = expandImplied(resolveEffectiveGrants([MANAGER_GRANTS, MEMBER_GRANTS]));
    expect(hasPermission(effective, "member.view", "department_and_descendants")).toBe(true);
  });

  it("a user assigned both admin and manager presets ends up with the wider (admin/tenant) scope", () => {
    const effective = expandImplied(resolveEffectiveGrants([ADMIN_GRANTS, MANAGER_GRANTS]));
    expect(hasPermission(effective, "attendance.correction.approve", "tenant")).toBe(true);
  });
});
