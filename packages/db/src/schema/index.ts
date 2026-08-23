/**
 * v0.1 スキーマの集約 export。drizzle.config.ts と migrate.ts はここを単一の schema source として使う。
 *
 * ダイアレクト分離方針: v0.1 は SQLite(sqlite-core)。PostgreSQL / D1 対応は将来、
 * `src/schema/` 配下にダイアレクトごとのディレクトリを追加する形で分離できるよう
 * このディレクトリはテーブル定義のみを置き、クエリ層(src/queries/)からは切り離している。
 */

export * from "./allowances.js";
export * from "./api-keys.js";
export * from "./audit.js";
export * from "./auto-break-waivers.js";
export * from "./closings.js";
export * from "./corrections.js";
export * from "./help-overrides.js";
export * from "./invitations.js";
export * from "./notification-settings.js";
export * from "./notifications.js";
export * from "./org.js";
export * from "./permissions.js";
export * from "./punches.js";
export * from "./settings.js";
export * from "./shifts.js";
export * from "./slack.js";
export * from "./tenants.js";
export * from "./users.js";
export * from "./user-notification-settings.js";
export * from "./leave.js";
export * from "./password-resets.js";
