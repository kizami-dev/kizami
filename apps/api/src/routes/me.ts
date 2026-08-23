/**
 * GET /me
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

  return app;
}
