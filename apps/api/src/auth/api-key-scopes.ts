/**
 * 公開打刻APIキーのスコープ(用途)一覧。
 *
 * 依頼どおり2種類のみ v0.4 で用意する。将来スコープを増やせるよう、この配列に追加するだけで
 * apps/api/src/routes/api-keys.ts のバリデーション・apps/web の発行フォームの選択肢に反映される
 * (エンドポイントごとの許可スコープは apps/api/src/auth/api-key-scope-guard.ts が別途持つ)。
 *
 * middleware.ts(AppEnv)と api-key.ts の両方から参照されるため、循環 import を避けるために
 * この2ファイルとは独立させている。
 */

/** 自分の打刻の作成・参照。 */
export type ApiKeyScope = "punch" | "read";

export const API_KEY_SCOPES: readonly ApiKeyScope[] = ["punch", "read"];

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}
