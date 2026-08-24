import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG } from "../src/catalog.js";
import { IMPLIED_VIEW_PERMISSIONS } from "../src/implied.js";

/**
 * カタログの30項目には対応する独立キーが存在しない「含意されるだけの閲覧」専用キー
 * (implied.ts のコメント参照)。impliesView がこれらを指しても「実在しない」扱いにはしない。
 */
const EXTRA_VIEW_ONLY_KEYS = new Set([
  "department.view",
  "tenant_settings.view",
  "permission_preset.view",
  "permission_assignment.effective_view",
  "api_key.view",
]);

/** docs/design/permission-catalog.md §4「管理者」列の明示ON分(apps/api/src/seed.ts の ADMIN_GRANTS と同じ)。 */
const ADMIN_GRANT_KEYS = [
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
  "department.manage",
  "tenant_settings.calendar.manage",
  "tenant_settings.flex.manage",
  "tenant_settings.gps.manage",
  "tenant_settings.auto_deduction.manage",
  "tenant_settings.auth.manage",
  "notification.settings.manage",
  "permission.preset.manage",
  "permission.assignment.manage",
  "audit_log.view",
  "api_key.manage",
  "approval_flow.manage",
];

/** docs/design/permission-catalog.md §4「マネージャー」列の明示ON分(apps/api/src/seed.ts の MANAGER_GRANTS と同じ)。 */
const MANAGER_GRANT_KEYS = [
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
];

describe("PERMISSION_CATALOG", () => {
  it("has exactly the 33 items from permission-catalog.md §1, all with unique keys", () => {
    expect(PERMISSION_CATALOG.length).toBe(33);
    const keys = PERMISSION_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every impliesView key actually exists (as a catalog key, or a recognized view-only key)", () => {
    const catalogKeys = new Set(PERMISSION_CATALOG.map((e) => e.key));
    for (const item of PERMISSION_CATALOG) {
      for (const viewKey of item.impliesView) {
        expect(catalogKeys.has(viewKey) || EXTRA_VIEW_ONLY_KEYS.has(viewKey)).toBe(true);
      }
    }
  });

  it("impliesView is derived from IMPLIED_VIEW_PERMISSIONS, not duplicated by hand", () => {
    for (const item of PERMISSION_CATALOG) {
      expect(item.impliesView).toEqual(IMPLIED_VIEW_PERMISSIONS[item.key] ?? []);
    }
  });

  it("the standard presets' grants (admin, manager) all exist in the catalog", () => {
    const catalogKeys = new Set(PERMISSION_CATALOG.map((e) => e.key));
    for (const key of [...ADMIN_GRANT_KEYS, ...MANAGER_GRANT_KEYS]) {
      expect(catalogKeys.has(key)).toBe(true);
    }
  });

  it("every entry has at least one valid scope and a scope list that never includes 'self'", () => {
    const validScopes = new Set(["self", "department", "department_and_descendants", "tenant"]);
    for (const item of PERMISSION_CATALOG) {
      expect(item.scopes.length).toBeGreaterThan(0);
      for (const s of item.scopes) expect(validScopes.has(s)).toBe(true);
      expect(item.scopes).not.toContain("self");
      expect(typeof item.dangerous).toBe("boolean");
      expect(item.labelJa.length).toBeGreaterThan(0);
      expect(item.descriptionJa.length).toBeGreaterThan(0);
    }
  });
});
