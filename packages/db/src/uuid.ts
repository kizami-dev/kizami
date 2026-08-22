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
 * 同一ミリ秒内の単調性カウンタ(RFC 9562 §6.2 Method 1 の rand_a 利用)。
 *
 * 判断点(2026-08-23): closing_events の世代解決は `ORDER BY occurred_at, id` で並べるため、
 * 同一ミリ秒に close と amend の2行が作られると(vi.useFakeTimers 下のテストで実際に発生)、
 * id の大小がランダムビット任せになり close/amend の順序が確率的に逆転していた。
 * rand_a(12bit)を「同一ミリ秒内の連番」に使い、同一プロセス内では生成順と id の辞書順が
 * 一致することを保証する。プロセスをまたぐ同一ミリ秒衝突までは守れないが、締めイベントは
 * 単一 API プロセスが直列に書くため実用上十分。
 */
let lastTimestampMs = -1;
let sequence = 0;

/**
 * UUIDv7 を生成する。同一ミリ秒内では生成順に辞書順が増加する(上記カウンタ)。
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

  // 同一ミリ秒なら連番を進め、ミリ秒が変わったらリセット。4096(12bit)を使い切ったら
  // ランダム下位ビットに任せる(1ミリ秒に4096回生成する実運用は無い)
  if (timestampMs === lastTimestampMs) {
    sequence = Math.min(sequence + 1, 0x0fff);
  } else {
    lastTimestampMs = timestampMs;
    sequence = 0;
  }

  // 残り80bit: ランダム(bytes[6..15])
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  bytes.set(random, 6);

  // rand_a(bytes[6..7] の下位12bit)を単調カウンタで上書き
  bytes[6] = (sequence >> 8) & 0x0f;
  bytes[7] = sequence & 0xff;

  // version: bytes[6] の上位4bit = 0111 (7)
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  // variant: bytes[8] の上位2bit = 10
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
