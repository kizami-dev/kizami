/**
 * Slack リクエスト署名検証(`X-Slack-Signature` / `X-Slack-Request-Timestamp`)。
 *
 * docs/external-api/slack.md「リクエストの検証」の実装。node:crypto は使わず
 * globalThis.crypto (WebCrypto の HMAC-SHA256) のみに依存する(apps/api/src/auth/password.ts の
 * PBKDF2 実装・packages/crypto/src/encryptor.ts の AES-GCM 実装と同じ方針。Node / workerd 両対応)。
 *
 * Slack の署名仕様(https://docs.slack.dev/authentication/verifying-requests-from-slack):
 * 1. `basestring = "v0:" + timestamp + ":" + rawBody`
 * 2. `signature = "v0=" + HMAC-SHA256(basestring, signingSecret) の16進文字列`
 * 3. リクエストの `X-Slack-Signature` ヘッダとタイミング安全に比較する
 *
 * リプレイ攻撃対策: `X-Slack-Request-Timestamp` が現在時刻から
 * `MAX_TIMESTAMP_SKEW_SECONDS`(5分)より古い(または将来側に大きくずれた)場合は、
 * 署名の正当性を検証するまでもなく拒否する。
 */

const SIGNATURE_VERSION = "v0";
const SIGNATURE_PREFIX = `${SIGNATURE_VERSION}=`;
/** リプレイ攻撃対策: これより古い(未来にずれた)タイムスタンプは拒否する(依頼: 5分)。 */
export const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

/** 文字列を UTF-8 バイト列に見立てて timing-safe に比較する(長さが違う時点で false、早期returnはしない)。 */
function timingSafeEqualHex(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `v0:{timestamp}:{rawBody}` の HMAC-SHA256(hex) を計算する。signingSecret は平文
 * (呼び出し側が apps/api/src/lib/encryption.ts で復号済みのものを渡すこと。DB上は暗号化されている)。
 */
async function computeSignature(signingSecret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const basestring = `${SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(basestring) as BufferSource);
  return SIGNATURE_PREFIX + toHex(digest);
}

export interface VerifySlackSignatureParams {
  /** テナントの Signing Secret(復号済み平文)。null/未設定なら常に拒否する(依頼どおり)。 */
  signingSecret: string | null;
  /** `X-Slack-Signature` ヘッダの値(例 "v0=abcdef..."）。 */
  signatureHeader: string | null;
  /** `X-Slack-Request-Timestamp` ヘッダの値(UNIXエポック秒の文字列)。 */
  timestampHeader: string | null;
  /** リクエストボディの生文字列(署名は application/x-www-form-urlencoded の生バイト列に対して計算される)。 */
  rawBody: string;
  /** 検証基準時刻(UNIXエポック秒)。省略時 `Math.floor(Date.now() / 1000)`。テストで固定するために注入可能にする。 */
  nowSeconds?: number;
}

/**
 * Slack リクエストの署名を検証する。
 *
 * 拒否する条件(いずれか1つでも該当すれば false):
 * - signingSecret が未設定(null)
 * - signatureHeader / timestampHeader のいずれかが欠落、またはタイムスタンプが数値でない
 * - タイムスタンプが現在時刻から MAX_TIMESTAMP_SKEW_SECONDS より離れている(リプレイ対策。
 *   未来方向のずれも同じ閾値で拒否する — Slack側の時計が大きく進んでいる異常も弾くため)
 * - 計算した署名がヘッダの値とタイミング安全な比較で一致しない
 */
export async function verifySlackSignature(params: VerifySlackSignatureParams): Promise<boolean> {
  const { signingSecret, signatureHeader, timestampHeader, rawBody } = params;
  if (!signingSecret) return false;
  if (!signatureHeader || !timestampHeader) return false;
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  if (!/^\d+$/.test(timestampHeader)) return false;
  const timestamp = Number(timestampHeader);
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const expected = await computeSignature(signingSecret, timestampHeader, rawBody);
  return timingSafeEqualHex(expected, signatureHeader);
}
