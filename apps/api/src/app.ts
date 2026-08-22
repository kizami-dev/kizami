import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Database } from "@kizami/db";
import type { Encryptor } from "./lib/encryption.js";
import { apiKeyScopeGuardMiddleware } from "./auth/api-key-scope-guard.js";
import { authOrApiKeyMiddleware, type AppEnv } from "./auth/middleware.js";
import { ForbiddenError } from "./authz.js";
import { MonthClosedError, MonthClosedRequiresUnlockError } from "./lib/closing-guard.js";
import { createApiKeysRoutes } from "./routes/api-keys.js";
import { createAttendanceRoutes } from "./routes/attendance.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createClosingsRoutes } from "./routes/closings.js";
import { createCorrectionsRoutes } from "./routes/corrections.js";
import { createDepartmentsRoutes } from "./routes/departments.js";
import { createExportsRoutes } from "./routes/exports.js";
import { createHelpRoutes } from "./routes/help.js";
import { createMeRoutes } from "./routes/me.js";
import { createMembersRoutes } from "./routes/members.js";
import { createNotificationsRoutes } from "./routes/notifications.js";
import { createNotificationPreferencesRoutes } from "./routes/notification-preferences.js";
import { createPresetsRoutes } from "./routes/presets.js";
import { createPunchesRoutes } from "./routes/punches.js";
import { createSettingsRoutes, type SettingsRoutesDeps } from "./routes/settings.js";
import { createLeaveRoutes } from "./routes/leave.js";

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
  /**
   * 秘密情報(webhookUrl・smtpPassword)の暗号化・復号に使う Encryptor。
   * 未設定/null の場合、settings.ts の PUT は秘密情報を含む更新を 503 で拒否する
   * (平文フォールバックはしない)。node.ts / worker.ts は環境変数 KIZAMI_ENCRYPTION_KEY から
   * apps/api/src/lib/encryption.ts の buildEncryptorFromEnv() で組み立てて渡す。
   */
  encryptor?: Encryptor | null;
}

/**
 * ランタイム非依存の Hono アプリ本体。
 * Node からは node.ts、Workers からは workers.ts がこれを共有する(要件 §8)。
 *
 * DB(@kizami/engine と @kizami/db 接続済み)を deps 経由で注入するファクトリにすることで、
 * テストは :memory: DB を、Node ランタイムは env から作った DB をそれぞれ渡せるようにする。
 */
export function createApp(deps: CreateAppDeps) {
  const { db, secureCookies = false, corsOrigin, notify, encryptor } = deps;
  const app = new Hono<AppEnv>();

  if (corsOrigin) {
    app.use("*", cors({ origin: corsOrigin, credentials: true }));
  }

  app.get("/healthz", (c) => c.json({ ok: true, name: "kizami" }));

  app.route("/auth", createAuthRoutes(db, { secureCookies }));

  const authed = new Hono<AppEnv>();
  // セッションCookie / 公開打刻APIキーの両方を受け付ける(v0.4)。認証後、APIキー認証のみ
  // エンドポイント許可表(apiKeyScopeGuardMiddleware)でさらに絞り込む。
  authed.use("*", authOrApiKeyMiddleware(db, { secureCookies }));
  authed.use("*", apiKeyScopeGuardMiddleware());
  authed.route("/me", createMeRoutes());
  authed.route("/api-keys", createApiKeysRoutes(db));
  authed.route("/punches", createPunchesRoutes(db));
  authed.route("/attendance", createAttendanceRoutes(db));
  authed.route("/corrections", createCorrectionsRoutes(db));
  authed.route("/notifications", createNotificationsRoutes(db));
  authed.route("/settings", createSettingsRoutes(db, { ...(notify ?? {}), encryptor: encryptor ?? null }));
  // 個人の通知受け取り設定(GET/PUT /settings/notifications/me, POST /settings/notifications/me/test)。
  // 権限チェック無し(認証済み本人のみ、routes/notification-preferences.ts 冒頭コメント参照)。
  // /settings/notifications(テナント設定, createSettingsRoutes)とはパスの衝突が無いため
  // 別のサブルータとしてマウントできる("/notifications" 完全一致 vs "/notifications/me")。
  authed.route(
    "/settings/notifications",
    createNotificationPreferencesRoutes(db, { ...(notify ?? {}), encryptor: encryptor ?? null }),
  );
  authed.route("/help", createHelpRoutes(db));
  authed.route("/departments", createDepartmentsRoutes(db));
  authed.route("/members", createMembersRoutes(db));
  authed.route("/presets", createPresetsRoutes(db));
  authed.route("/closings", createClosingsRoutes(db));
  authed.route("/exports", createExportsRoutes(db));
  authed.route("/leave", createLeaveRoutes(db));
  app.route("/", authed);

  app.onError((err, c) => {
    if (err instanceof ForbiddenError) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (err instanceof MonthClosedRequiresUnlockError) {
      return c.json({ error: "month_closed_requires_unlock" }, 409);
    }
    if (err instanceof MonthClosedError) {
      return c.json({ error: "month_closed" }, 409);
    }
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
