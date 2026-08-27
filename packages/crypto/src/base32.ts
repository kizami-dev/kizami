/**
 * Base32(RFC 4648 §6、標準アルファベット `A-Z2-7`)のエンコード/デコード。
 *
 * TOTP(src/totp.ts)専用の下回り。共有鍵を認証アプリ(Google Authenticator / 1Password 等)へ
 * 渡す `otpauth://` URI は **base32 表記の鍵しか受け付けない**ため、base64 では代用できない。
 *
 * 依存を増やさず(要件 §8「WebCrypto のみ・node:crypto 不使用」と同じ方針で)自前実装する。
 * 実装は 40 行程度で、テスト(test/base32.test.ts)は RFC 4648 §10 のテストベクタで固定してある。
 *
 * 仕様上の決めごと:
 * - **パディング(`=`)は付けない**。認証アプリに渡す `secret=` パラメータは慣習的に無パディング
 *   であり、付けると URI エスケープ(`%3D`)が要るうえ読み取れないアプリがある。
 * - デコードはパディングと小文字を受け付ける(利用者が手入力で貼り付ける経路があるため)。
 *   空白・ハイフンも無視する(認証アプリが4文字ごとに区切って表示することがある)。
 * - アルファベット外の文字は例外(黙って 0 として読むと別の鍵になり、原因の分かりにくい
 *   「コードが合わない」になるため)。
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** バイト列を base32(無パディング)へ変換する。 */
export function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    // 端数は 0 で右詰めする(RFC 4648 のパディング前の扱いと同じ)。
    out += ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * base32 文字列をバイト列へ戻す。小文字・パディング・区切り(空白/ハイフン)を許容する。
 *
 * @throws アルファベット外の文字が含まれる場合。
 */
export function decodeBase32(input: string): Uint8Array {
  const normalized = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of normalized) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error(`base32: invalid character "${ch}"`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // 端数ビット(< 8)は捨てる。エンコード時に 0 で埋めた分であり、値を持たない。
  return new Uint8Array(bytes);
}
