import { describe, expect, it } from "vitest";
import { hasPermission, resolveEffectiveGrants } from "../src/resolve.js";
import { SELF_SERVICE_PERMISSIONS } from "../src/self-service.js";
import type { Grant } from "../src/types.js";

describe("resolveEffectiveGrants", () => {
  it("unions grants from multiple presets", () => {
    const presetA: Grant[] = [{ permission: "member.view", scope: "department" }];
    const presetB: Grant[] = [{ permission: "leave.balance.view", scope: "tenant" }];

    const effective = resolveEffectiveGrants([presetA, presetB]);

    expect(effective.get("member.view")).toBe("department");
    expect(effective.get("leave.balance.view")).toBe("tenant");
  });

  it("picks the wider scope when the same permission appears with different scopes", () => {
    const presetA: Grant[] = [{ permission: "member.view", scope: "department" }];
    const presetB: Grant[] = [{ permission: "member.view", scope: "tenant" }];
    const presetC: Grant[] = [{ permission: "member.view", scope: "department_and_descendants" }];

    // 入力順を変えても結果は同じ(常に一番広いスコープが勝つ)
    expect(resolveEffectiveGrants([presetA, presetB, presetC]).get("member.view")).toBe("tenant");
    expect(resolveEffectiveGrants([presetB, presetA, presetC]).get("member.view")).toBe("tenant");
    expect(resolveEffectiveGrants([presetC, presetA]).get("member.view")).toBe("department_and_descendants");
  });

  it("always includes the fixed self-service grants, even with zero presets assigned", () => {
    const effective = resolveEffectiveGrants([]);

    expect(effective.get(SELF_SERVICE_PERMISSIONS.punch)).toBe("self");
    expect(effective.get(SELF_SERVICE_PERMISSIONS.requestOwn)).toBe("self");
    expect(effective.get(SELF_SERVICE_PERMISSIONS.viewOwnRecord)).toBe("self");
  });

  it("does not let a narrower explicit grant downgrade the fixed self-service scope", () => {
    // セルフサービス権限はプリセットのON/OFF対象外だが、キーが偶然一致しても self より
    // 狭いスコープは存在しないため、self が維持されることを確認する(健全性チェック)。
    const preset: Grant[] = [{ permission: SELF_SERVICE_PERMISSIONS.punch, scope: "self" }];
    const effective = resolveEffectiveGrants([preset]);
    expect(effective.get(SELF_SERVICE_PERMISSIONS.punch)).toBe("self");
  });
});

describe("hasPermission", () => {
  it("returns true when the granted scope satisfies the required scope", () => {
    const effective = new Map([["closing.view", "department_and_descendants" as const]]);
    expect(hasPermission(effective, "closing.view", "department")).toBe(true);
    expect(hasPermission(effective, "closing.view", "department_and_descendants")).toBe(true);
  });

  it("returns false when the granted scope is narrower than required", () => {
    const effective = new Map([["closing.view", "department" as const]]);
    expect(hasPermission(effective, "closing.view", "tenant")).toBe(false);
    expect(hasPermission(effective, "closing.view", "department_and_descendants")).toBe(false);
  });

  it("returns false for a permission that was never granted", () => {
    const effective = new Map<string, "self">();
    expect(hasPermission(effective, "audit_log.view", "self")).toBe(false);
  });
});
