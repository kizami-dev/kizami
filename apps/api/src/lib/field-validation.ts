/**
 * PUT系エンドポイント共通の小さなバリデーション・整形ヘルパー。
 *
 * 元は routes/settings.ts にのみ存在したが、routes/notification-preferences.ts
 * (GET/PUT /settings/notifications/me)も同じ「undefined=維持 / null・""=クリア / string=置換」
 * の3値ルールと URL 検証・Webhook プレビュー生成を必要とするため、ここへ切り出して共有する。
 */

export type StringFieldResult = { ok: true; value: string | null } | { ok: false };

/** undefined=維持 / null・""=クリア / string=置換、の3値ルールで文字列項目を解決する。 */
export function resolveStringField(value: unknown, current: string | null): StringFieldResult {
  if (value === undefined) return { ok: true, value: current };
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value === "string") return { ok: true, value };
  return { ok: false };
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Webhook URL のマスク表示用プレビュー(オリジンのみ、例 "https://hooks.slack.com/..."）。 */
export function webhookPreview(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return null;
  }
}
