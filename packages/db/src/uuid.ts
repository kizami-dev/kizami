/**
 * UUIDv7 生成(RFC 9562)。
 *
 * - `crypto.getRandomValues` ベースで Node / workerd 両対応(グローバル `crypto` のみに依存)
 * - タイムスタンプ部(先頭48bit, epoch ミリ秒)は引数で差し替え可能。
 *   packages/engine と異なり db パッケージは現在時刻に触れてよいため、既定値は `Date.now()`
 */

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += HEX.charAt(b >> 4) + HEX.charAt(b & 0x0f);
  }
  return out;
}

/**
 * UUIDv7 を生成する。
 *
 * @param timestampMs epoch ミリ秒。省略時は `Date.now()`
 */
export function uuidv7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);

  // 先頭48bit: unix_ts_ms (ビッグエンディアン)
  const ts = BigInt(Math.trunc(timestampMs));
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // 残り80bit: ランダム(bytes[6..15])
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  bytes.set(random, 6);

  // version: bytes[6] の上位4bit = 0111 (7)
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  // variant: bytes[8] の上位2bit = 10
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
