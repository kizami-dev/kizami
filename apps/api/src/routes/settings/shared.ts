/**
 * routes/settings/ 配下の各ドメインファイルが共有するヘルパー・型。
 * 2026-08-23、routes/settings.ts(1430行・22ルート)を挙動不変で分割した際に切り出した。
 */

import type { SmtpSendFn } from "@kizami/notify";
import type { Encryptor } from "../../lib/encryption.js";
import type { OutboundChecker } from "../../lib/outbound-policy.js";

export interface SettingsRoutesDeps {
  /** webhookChannel の fetch 差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /**
   * **テナントが設定した送り先**(Webhook・ブラウザプッシュの endpoint)への送信に使う fetch。省略時は `fetchImpl`。
   * SSRF ガード(lib/outbound-guard.ts)を有効にした配備だけが、検査済みの IP にだけ接続する fetch を渡す。
   * 運用者が設定する送り先(環境変数 WEBHOOK_URL のフォールバック)は `fetchImpl` のまま。
   */
  tenantFetchImpl?: typeof fetch;
  /**
   * 保存時の検査(Webhook の URL・SMTP のホスト・OIDC の issuer・プッシュの endpoint がプライベートな宛先でないか)。
   * 省略 = 検査しない(SSRF ガードが無効な配備)。DNS は後で変わりうるので、保存時の検査は先回りの
   * 親切にすぎず、接続のたびの検査(tenantFetchImpl / smtpSendFn)が本体。lib/outbound-policy.ts 参照。
   */
  outbound?: OutboundChecker;
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
