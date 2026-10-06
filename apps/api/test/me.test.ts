import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "@kizami/db";
import { createApp } from "../src/app.js";
import { denyPermission, grantPermission, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

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

describe("表示言語(users.locale)", () => {
  function putLocale(app: ReturnType<typeof createApp>, cookie: string, body: unknown) {
    return app.request("/me/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("未設定は GET /me で null。PUT /me/locale で保存すると GET /me に出る(5言語すべて)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const before = (await (await app.request("/me", { headers: { cookie } })).json()) as { user: { locale: string | null } };
    expect(before.user.locale).toBeNull();

    for (const locale of ["ja", "en", "ko", "zh", "zh-Hant"]) {
      const res = await putLocale(app, cookie, { locale });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ locale });
      const me = (await (await app.request("/me", { headers: { cookie } })).json()) as { user: { locale: string | null } };
      expect(me.user.locale).toBe(locale);
    }
  });

  it("許可リスト外・型違い・body 不正は 400 で、保存済みの値は変わらない", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);
    expect((await putLocale(app, cookie, { locale: "en" })).status).toBe(200);

    for (const body of [{ locale: "fr" }, { locale: "en-US" }, { locale: "" }, { locale: null }, { locale: 1 }, {}, [], "not json"]) {
      const res = await putLocale(app, cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const me = (await (await app.request("/me", { headers: { cookie } })).json()) as { user: { locale: string | null } };
    expect(me.user.locale).toBe("en");
  });

  it("自分の行だけが変わる: 同じテナントの他のユーザーの locale は変わらない(対象を指定する手段が無い)", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const other = await setupSecondUser(db, tenantId);
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // userId を body に入れても無視される
    const res = await putLocale(app, cookie, { locale: "ko", userId: other.userId });
    expect(res.status).toBe(200);
    const rows = await db.select({ id: users.id, locale: users.locale }).from(users).where(eq(users.tenantId, tenantId));
    expect(rows.find((r) => r.id === other.userId)?.locale).toBeNull();
    expect(rows.filter((r) => r.locale === "ko")).toHaveLength(1);
  });

  it("未認証は 401", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });
    const res = await app.request("/me/locale", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(401);
  });
});
