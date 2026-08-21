import { describe, expect, it } from "vitest";
import { expandImplied } from "../src/resolve.js";
import type { PermissionKey, Scope } from "../src/types.js";

describe("expandImplied", () => {
  it("adds the implied view permission at the same scope as the granting operation", () => {
    const effective = new Map<PermissionKey, Scope>([["attendance.correction.approve", "department_and_descendants"]]);

    const expanded = expandImplied(effective);

    expect(expanded.get("attendance.correction.view_all")).toBe("department_and_descendants");
    expect(expanded.get("attendance.record.view")).toBe("department_and_descendants");
    // 元の付与はそのまま残る
    expect(expanded.get("attendance.correction.approve")).toBe("department_and_descendants");
  });

  it("does not downgrade an implied permission that was already explicitly granted more widely", () => {
    const effective = new Map<PermissionKey, Scope>([
      ["attendance.correction.approve", "department"],
      ["attendance.record.view", "tenant"], // 別プリセットから広く直接付与済み
    ]);

    const expanded = expandImplied(effective);

    expect(expanded.get("attendance.record.view")).toBe("tenant");
  });

  it("widens an already-implied-in permission if a wider operation also implies it", () => {
    const effective = new Map<PermissionKey, Scope>([
      ["attendance.record.view", "department"], // 直接付与(狭い)
      ["export.attendance.run", "tenant"], // 同じ閲覧を、より広いスコープで含意する操作
    ]);

    const expanded = expandImplied(effective);

    expect(expanded.get("attendance.record.view")).toBe("tenant");
  });

  it("maps closing.unlock to both closing.view and audit_log.view", () => {
    const effective = new Map<PermissionKey, Scope>([["closing.unlock", "tenant"]]);
    const expanded = expandImplied(effective);
    expect(expanded.get("closing.view")).toBe("tenant");
    expect(expanded.get("audit_log.view")).toBe("tenant");
  });

  it("does not mutate the input map", () => {
    const effective = new Map<PermissionKey, Scope>([["member.invite", "tenant"]]);
    expandImplied(effective);
    expect(effective.has("member.view")).toBe(false);
  });

  it("is a no-op for permissions with no implied view (e.g. plain view permissions)", () => {
    const effective = new Map<PermissionKey, Scope>([["member.view", "department"]]);
    const expanded = expandImplied(effective);
    expect(expanded.size).toBe(1);
  });
});
