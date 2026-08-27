import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { denyPermission, grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

interface EffectivePermissionsResponse {
  permissions: Array<{ key: string; scope: string }>;
}

function findScope(body: EffectivePermissionsResponse, key: string): string | undefined {
  return body.permissions.find((p) => p.key === key)?.scope;
}

describe("GET /me/effective-permissions", () => {
  it("returns only the always-on self-service permissions when no preset is assigned", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/me/effective-permissions", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EffectivePermissionsResponse;

    // 固定原則(docs/requirements.md §4): プリセット割当が0件でも self_service.* の3つは
    // scope "self" で常時付与される(packages/authz/src/self-service.ts の SELF_SERVICE_GRANTS)。
    expect(findScope(body, "self_service.punch")).toBe("self");
    expect(findScope(body, "self_service.request")).toBe("self");
    expect(findScope(body, "self_service.record.view")).toBe("self");
    // 業務タスク権限は何も付与していないので含まれない
    expect(findScope(body, "member.invite")).toBeUndefined();
  });

  it("unions two presets on the same key and keeps the wider scope", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    // 同一キー member.invite に、スコープの異なる2つのプリセットを割り当てる。
    // resolveEffectiveGrants は同一キーに複数スコープが来たら広い方(tenant > department)を
    // 採用する(packages/authz/src/resolve.ts)。
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "department" });
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/me/effective-permissions", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EffectivePermissionsResponse;

    expect(findScope(body, "member.invite")).toBe("tenant");
    // 「操作は閲覧を含意する」の展開: member.invite → member.view も同じ(広い方の)スコープで
    // 自動的に含まれる(packages/authz/src/implied.ts の IMPLIED_VIEW_PERMISSIONS)。
    expect(findScope(body, "member.view")).toBe("tenant");
    // セルフサービス権限はここでも常に含まれる
    expect(findScope(body, "self_service.punch")).toBe("self");
  });

  /**
   * 拒否ルール(deny、2026-08-24)。レスポンスの形は変わらない(実効権限の最終形をそのまま返す)
   * — 拒否された権限は「含まれない」という形でだけ現れる。
   */
  it("omits permissions denied by any assigned preset (deny wins over grants)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    // 1つ目のプリセットが tenant スコープで付与し、2つ目のプリセットが同じキーを拒否する
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await denyPermission(db, { tenantId, userId, permission: "member.invite" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/me/effective-permissions", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EffectivePermissionsResponse;

    expect(findScope(body, "member.invite")).toBeUndefined();
    // 含意先(member.view)も生まれない — 拒否された権限は含意の展開元にならない
    expect(findScope(body, "member.view")).toBeUndefined();
    // セルフサービス権限は拒否の影響を受けない
    expect(findScope(body, "self_service.punch")).toBe("self");
  });

  it("never drops the self-service permissions, even if a preset tries to deny them", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await denyPermission(db, { tenantId, userId, permission: "self_service.punch" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/me/effective-permissions", { headers: { cookie } });
    const body = (await res.json()) as EffectivePermissionsResponse;

    expect(findScope(body, "self_service.punch")).toBe("self");
  });

  it("requires authentication", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/me/effective-permissions");
    expect(res.status).toBe(401);
  });
});
