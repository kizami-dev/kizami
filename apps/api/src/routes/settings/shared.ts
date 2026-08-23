/**
 * routes/settings/ 配下の各ドメインファイルが共有するヘルパー・型。
 * 2026-08-23、routes/settings.ts(1430行・22ルート)を挙動不変で分割した際に切り出した。
 */

import type { SmtpSendFn } from "@kizami/notify";
import type { Encryptor } from "../../lib/encryption.js";

export interface SettingsRoutesDeps {
  /** webhookChannel の fetch 差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /** smtp 送信関数。省略時 smtp チャネルは常に「未設定」扱いになる(テスト送信も 400) */
  smtpSendFn?: SmtpSendFn;
  /**
   * webhookUrl・smtpPassword の暗号化・復号に使う。null/未設定の場合、PUT は秘密情報を
   * 含む更新を 503 encryption_unavailable で拒否する(平文フォールバックはしない)。
   */
  encryptor?: Encryptor | null;
}

/** "YYYY-MM-DD" の書式チェックのみ(暦としての正当性チェックはしない、既存 routes/leave.ts の DATE_RE と同じ流儀)。 */
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLocalDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE_RE.test(value);
}

export async function parseJsonRecord(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}
