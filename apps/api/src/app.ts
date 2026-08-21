import { Hono } from "hono";
import type { Database } from "@kizami/db";
import { authMiddleware, type AppEnv } from "./auth/middleware.js";
import { ForbiddenError } from "./authz.js";
import { createAttendanceRoutes } from "./routes/attendance.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createMeRoutes } from "./routes/me.js";
import { createPunchesRoutes } from "./routes/punches.js";

export interface CreateAppDeps {
  db: Database;
  /**
   * セッション Cookie に Secure を付けるか。省略時 false(テスト用)。
   * 実行環境のエントリポイント(node.ts 等)は明示的に渡すこと(既定 ON)。
   */
  secureCookies?: boolean;
}

/**
 * ランタイム非依存の Hono アプリ本体。
 * Node からは node.ts、Workers からは workers.ts がこれを共有する(要件 §8)。
 *
 * DB(@kizami/engine と @kizami/db 接続済み)を deps 経由で注入するファクトリにすることで、
 * テストは :memory: DB を、Node ランタイムは env から作った DB をそれぞれ渡せるようにする。
 */
export function createApp(deps: CreateAppDeps) {
  const { db, secureCookies = false } = deps;
  const app = new Hono<AppEnv>();

  app.get("/healthz", (c) => c.json({ ok: true, name: "kizami" }));

  app.route("/auth", createAuthRoutes(db, { secureCookies }));

  const authed = new Hono<AppEnv>();
  authed.use("*", authMiddleware(db));
  authed.route("/me", createMeRoutes());
  authed.route("/punches", createPunchesRoutes(db));
  authed.route("/attendance", createAttendanceRoutes(db));
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
