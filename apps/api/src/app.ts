import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Database } from "@kizami/db";
import { authMiddleware, type AppEnv } from "./auth/middleware.js";
import { ForbiddenError } from "./authz.js";
import { createAttendanceRoutes } from "./routes/attendance.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createCorrectionsRoutes } from "./routes/corrections.js";
import { createDepartmentsRoutes } from "./routes/departments.js";
import { createMeRoutes } from "./routes/me.js";
import { createMembersRoutes } from "./routes/members.js";
import { createNotificationsRoutes } from "./routes/notifications.js";
import { createPresetsRoutes } from "./routes/presets.js";
import { createPunchesRoutes } from "./routes/punches.js";
import { createSettingsRoutes, type SettingsRoutesDeps } from "./routes/settings.js";

export interface CreateAppDeps {
  db: Database;
  /**
   * セッション Cookie に Secure を付けるか。省略時 false(テスト用)。
   * 実行環境のエントリポイント(node.ts 等)は明示的に渡すこと(既定 ON)。
   */
  secureCookies?: boolean;
  /**
   * 許可する CORS オリジン(開発時の Waku dev サーバー用)。
   * 省略時は CORS ヘッダを付けない(本番は同一オリジン配信が前提)。
   */
  corsOrigin?: string;
  /**
   * POST /settings/notifications/test が使う通知チャネルの依存差し替え
   * (実際の送信を行う Node 実装は node.ts が渡す。テストは偽実装を注入して実送信しない)。
   */
  notify?: SettingsRoutesDeps;
}

/**
 * ランタイム非依存の Hono アプリ本体。
 * Node からは node.ts、Workers からは workers.ts がこれを共有する(要件 §8)。
 *
 * DB(@kizami/engine と @kizami/db 接続済み)を deps 経由で注入するファクトリにすることで、
 * テストは :memory: DB を、Node ランタイムは env から作った DB をそれぞれ渡せるようにする。
 */
export function createApp(deps: CreateAppDeps) {
  const { db, secureCookies = false, corsOrigin, notify } = deps;
  const app = new Hono<AppEnv>();

  if (corsOrigin) {
    app.use("*", cors({ origin: corsOrigin, credentials: true }));
  }

  app.get("/healthz", (c) => c.json({ ok: true, name: "kizami" }));

  app.route("/auth", createAuthRoutes(db, { secureCookies }));

  const authed = new Hono<AppEnv>();
  authed.use("*", authMiddleware(db, { secureCookies }));
  authed.route("/me", createMeRoutes());
  authed.route("/punches", createPunchesRoutes(db));
  authed.route("/attendance", createAttendanceRoutes(db));
  authed.route("/corrections", createCorrectionsRoutes(db));
  authed.route("/notifications", createNotificationsRoutes(db));
  authed.route("/settings", createSettingsRoutes(db, notify ?? {}));
  authed.route("/departments", createDepartmentsRoutes(db));
  authed.route("/members", createMembersRoutes(db));
  authed.route("/presets", createPresetsRoutes(db));
  app.route("/", authed);

  app.onError((err, c) => {
    if (err instanceof ForbiddenError) {
      return c.json({ error: "forbidden" }, 403);
    }
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
