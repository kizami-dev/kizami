/**
 * GET /me, GET /me/effective-permissions
 */

import { Hono } from "hono";
import { getTenantById, type Database } from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";

export function createMeRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const user = c.get("user");
    // テナント名(社名)を含める(2026-08-23 依頼)。ヘッダー等で「どの会社の勤怠か」を
    // 示すために使う。ログイン画面には出さない — 認証前はテナントが確定せず、将来の
    // マルチテナントで「どの社名を出すか」を決められないため、表示は認証後に限る。
    const tenant = await getTenantById(db, user.tenantId);
    return c.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, tenantId: user.tenantId },
      tenant: { name: tenant?.name ?? null },
    });
  });

  /**
   * 認証済みユーザー自身の実効権限(プリセットの合算・広いスコープ優先・「操作は閲覧を含意」の
   * 展開・セルフサービス権限の常時付与まですべて済んだ最終形)を返す。
   *
   * 判断点(二重実装しない): 権限の解決ロジック自体はここには一切書かない。認証ミドルウェア
   * (apps/api/src/auth/middleware.ts)が各リクエストで既に loadEffectivePermissions を1回
   * 呼び `c.get("permissions")` にキャッシュしており、requirePermission もこのキャッシュ済み
   * 値を読むだけの薄い判定関数になっている(apps/api/src/authz.ts)。このエンドポイントは
   * その既存の解決結果をそのまま JSON へシリアライズするだけの窓口であり、Web 側が
   * 「このユーザーは何ができるか」を UI 表示(メニューの出し分け等)のために問い合わせる
   * 用途を想定する。認可判定そのもの(サーバー側の実施)は既存どおり各エンドポイントの
   * requirePermission が担い続け、このレスポンスはあくまで表示用の参考情報という位置づけ。
   */
  app.get("/effective-permissions", async (c) => {
    const permissions = c.get("permissions");
    return c.json({
      permissions: [...permissions].map(([key, scope]) => ({ key, scope })),
    });
  });

  return app;
}
