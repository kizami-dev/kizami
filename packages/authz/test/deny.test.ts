/**
 * 拒否ルール(deny)の評価テスト(2026-08-24、docs/requirements.md §4 のロードマップ項目
 * 「権限denyルール」の実装)。
 *
 * 仕様の要点(docs/design/permission-catalog.md §拒否(deny)ルール):
 * - 実効権限 = (全プリセットの grants の union) − (全プリセットの denies の union)
 * - deny はスコープを持たず全面的(スコープを指定した部分的な拒否は存在しない)
 * - セルフサービス権限(自分の打刻等)は deny の対象外
 */
import { describe, expect, it } from "vitest";
import { applyDenies, hasPermission, resolveEffectivePermissions } from "../src/resolve.js";
import { SELF_SERVICE_PERMISSIONS, UNDENIABLE_PERMISSIONS, isDeniablePermission } from "../src/self-service.js";
import type { PresetPermissions } from "../src/types.js";

describe("resolveEffectivePermissions: grant のみ(deny 未使用時の後方互換)", () => {
  it("denies を持たないプリセットは従来どおり union される", () => {
    const effective = resolveEffectivePermissions([
      { grants: [{ permission: "member.view", scope: "department" }] },
      { grants: [{ permission: "leave.balance.view", scope: "tenant" }] },
    ]);

    expect(effective.get("member.view")).toBe("department");
    expect(effective.get("leave.balance.view")).toBe("tenant");
  });

  it("同一権限が複数プリセットにあれば広いスコープが勝つ", () => {
    const effective = resolveEffectivePermissions([
      { grants: [{ permission: "member.view", scope: "department" }] },
      { grants: [{ permission: "member.view", scope: "tenant" }] },
    ]);
    expect(effective.get("member.view")).toBe("tenant");
  });
});

describe("resolveEffectivePermissions: deny は付与に優先する", () => {
  it("別のプリセットが付与していても、1つのプリセットの deny で無効になる", () => {
    const granting: PresetPermissions = { grants: [{ permission: "closing.execute", scope: "tenant" }] };
    const denying: PresetPermissions = { grants: [], denies: ["closing.execute"] };

    expect(resolveEffectivePermissions([granting]).has("closing.execute")).toBe(true);
    expect(resolveEffectivePermissions([granting, denying]).has("closing.execute")).toBe(false);
    // 入力順を変えても結果は同じ(deny は常に勝つ)
    expect(resolveEffectivePermissions([denying, granting]).has("closing.execute")).toBe(false);
  });

  it("同一プリセット内で付与と拒否が衝突した場合も拒否が勝つ", () => {
    const effective = resolveEffectivePermissions([
      { grants: [{ permission: "audit_log.view", scope: "tenant" }], denies: ["audit_log.view"] },
    ]);
    expect(effective.has("audit_log.view")).toBe(false);
  });

  it("deny は全スコープに及ぶ(テナント付与でも自部署付与でも等しく無効)", () => {
    for (const scope of ["department", "department_and_descendants", "tenant"] as const) {
      const effective = resolveEffectivePermissions([
        { grants: [{ permission: "member.invite", scope }] },
        { grants: [], denies: ["member.invite"] },
      ]);
      expect(effective.has("member.invite")).toBe(false);
      expect(hasPermission(effective, "member.invite", "department")).toBe(false);
      expect(hasPermission(effective, "member.invite", "tenant")).toBe(false);
    }
  });

  it("拒否していない権限には影響しない", () => {
    const effective = resolveEffectivePermissions([
      {
        grants: [
          { permission: "member.invite", scope: "tenant" },
          { permission: "member.deactivate", scope: "tenant" },
        ],
        denies: ["member.deactivate"],
      },
    ]);
    expect(effective.get("member.invite")).toBe("tenant");
    expect(effective.has("member.deactivate")).toBe(false);
  });
});

describe("resolveEffectivePermissions: deny と「操作は閲覧を含意する」の関係", () => {
  it("拒否された操作権限は、その含意先の閲覧権限も生まない", () => {
    // closing.execute は closing.view / attendance.record.view を含意する
    const granted = resolveEffectivePermissions([{ grants: [{ permission: "closing.execute", scope: "tenant" }] }]);
    expect(granted.has("closing.view")).toBe(true);

    const denied = resolveEffectivePermissions([
      { grants: [{ permission: "closing.execute", scope: "tenant" }], denies: ["closing.execute"] },
    ]);
    expect(denied.has("closing.execute")).toBe(false);
    expect(denied.has("closing.view")).toBe(false);
  });

  it("他の権限の含意によって、拒否された閲覧権限が復活しない", () => {
    // shift.manage は attendance.record.view を含意する
    const effective = resolveEffectivePermissions([
      { grants: [{ permission: "shift.manage", scope: "tenant" }] },
      { grants: [], denies: ["attendance.record.view"] },
    ]);
    expect(effective.get("shift.manage")).toBe("tenant");
    expect(effective.has("attendance.record.view")).toBe(false);
  });

  it("含意元が拒否されても、別経路で付与された閲覧権限は残る", () => {
    const effective = resolveEffectivePermissions([
      { grants: [{ permission: "closing.execute", scope: "tenant" }], denies: ["closing.execute"] },
      { grants: [{ permission: "closing.view", scope: "department" }] },
    ]);
    expect(effective.has("closing.execute")).toBe(false);
    expect(effective.get("closing.view")).toBe("department");
  });
});

describe("セルフサービス権限は拒否できない(固定原則)", () => {
  it("セルフサービス権限への deny は無視される", () => {
    const effective = resolveEffectivePermissions([
      {
        grants: [],
        denies: [
          SELF_SERVICE_PERMISSIONS.punch,
          SELF_SERVICE_PERMISSIONS.requestOwn,
          SELF_SERVICE_PERMISSIONS.viewOwnRecord,
        ],
      },
    ]);

    expect(effective.get(SELF_SERVICE_PERMISSIONS.punch)).toBe("self");
    expect(effective.get(SELF_SERVICE_PERMISSIONS.requestOwn)).toBe("self");
    expect(effective.get(SELF_SERVICE_PERMISSIONS.viewOwnRecord)).toBe("self");
  });

  it("UNDENIABLE_PERMISSIONS は3つのセルフサービス権限ちょうど", () => {
    expect([...UNDENIABLE_PERMISSIONS].sort()).toEqual(
      [
        SELF_SERVICE_PERMISSIONS.punch,
        SELF_SERVICE_PERMISSIONS.requestOwn,
        SELF_SERVICE_PERMISSIONS.viewOwnRecord,
      ].sort(),
    );
  });

  it("isDeniablePermission はセルフサービス権限にだけ false を返す", () => {
    expect(isDeniablePermission(SELF_SERVICE_PERMISSIONS.punch)).toBe(false);
    expect(isDeniablePermission("closing.execute")).toBe(true);
  });
});

describe("applyDenies", () => {
  it("入力のマップを変更せず、新しいマップを返す", () => {
    const original = new Map([["closing.view", "tenant" as const]]);
    const result = applyDenies(original, ["closing.view"]);

    expect(result.has("closing.view")).toBe(false);
    expect(original.has("closing.view")).toBe(true);
  });

  it("存在しないキーの拒否は無害", () => {
    const result = applyDenies(new Map([["closing.view", "tenant" as const]]), ["member.invite"]);
    expect(result.get("closing.view")).toBe("tenant");
  });
});
