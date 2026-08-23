/**
 * /settings 配下のルート群。2026-08-23、単一ファイルだった routes/settings.ts(1430行・22ルート)を
 * 挙動不変で分割した(切り貼りのみ・ロジック無変更)。公開シグネチャ(createSettingsRoutes /
 * SettingsRoutesDeps)は変更していないため、呼び出し側(app.ts)は import パスの変更のみで済む。
 *
 * ファイル構成:
 * - shared.ts: ドメイン間の共有ヘルパー・型(isValidLocalDate・parseJsonRecord・SettingsRoutesDeps)
 * - permissions.ts: ドメイン間で使い回している権限定数
 * - notifications.ts / leave.ts / tenant-profile.ts / privacy.ts / attendance.ts /
 *   work-policy.ts / slack.ts / allowances.ts: ドメイン別のルート実装
 *
 * ルート登録順は元の routes/settings.ts と同じ(notifications → leave → tenant-profile →
 * privacy(work-rules-url・privacy-templates・privacy-contact) → attendance → work-policy →
 * slack(+slack-link) → allowances)。Hono のルーティングはパスが重複しない限り登録順に
 * 依存しないが、挙動不変の原則に合わせて順序もそのまま保った。
 */

import { Hono } from "hono";
import type { Database } from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { registerAllowancesRoutes } from "./allowances.js";
import { registerAttendanceRoutes } from "./attendance.js";
import { registerLeaveRoutes } from "./leave.js";
import { registerNotificationsRoutes } from "./notifications.js";
import { registerPrivacyRoutes } from "./privacy.js";
import { registerShiftPatternsRoutes } from "./shift-patterns.js";
import { registerSlackRoutes } from "./slack.js";
import { registerTenantProfileRoutes } from "./tenant-profile.js";
import { registerWorkPolicyRoutes } from "./work-policy.js";
import type { SettingsRoutesDeps } from "./shared.js";

export type { SettingsRoutesDeps } from "./shared.js";

export function createSettingsRoutes(db: Database, deps: SettingsRoutesDeps = {}) {
  const app = new Hono<AppEnv>();

  registerNotificationsRoutes(app, db, deps);
  registerLeaveRoutes(app, db, deps);
  registerTenantProfileRoutes(app, db, deps);
  registerPrivacyRoutes(app, db, deps);
  registerAttendanceRoutes(app, db, deps);
  registerWorkPolicyRoutes(app, db, deps);
  registerShiftPatternsRoutes(app, db, deps);
  registerSlackRoutes(app, db, deps);
  registerAllowancesRoutes(app, db, deps);

  return app;
}
