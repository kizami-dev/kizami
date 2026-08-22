/**
 * @kizami/help-content の公開API。
 *
 * 実体は scripts/generate.mjs が content/*.ja.md から生成する src/generated.ts
 * (`pnpm --filter @kizami/help-content build` でコミット対象として再生成する)。
 * ここでは型と辞書をそのまま再輸出するだけで、node:fs 等のNode専用APIには一切依存しない
 * — apps/web（ブラウザ実行）から直接 import できることがこのモジュールの制約。
 */
export type { HelpAudience, HelpEntry, HelpKey, HelpOrigin } from "./generated.js";
export { HELP, HELP_KEYS } from "./generated.js";
