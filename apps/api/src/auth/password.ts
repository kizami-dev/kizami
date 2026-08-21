/**
 * パスワードハッシュ(WebCrypto PBKDF2-SHA256, 600,000 回)。
 *
 * 保存形式: "pbkdf2-sha256$<iterations>$<saltBase64>$<hashBase64>"
 * node:crypto は使わず globalThis.crypto (WebCrypto) のみに依存する(Node / workerd 両対応)。
 *
 * 参照: docs/design/v01-data-model.md §組織・認証・権限
 * (2026-08-21: argon2id から変更。argon2 はネイティブ実装で workerd 非対応のため)
 */

const ALGO = "pbkdf2-sha256";
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    keyMaterial,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** 新規パスワードをハッシュ化して保存用文字列を返す。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, ITERATIONS);
  return `${ALGO}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** timing-safe にバイト列を比較する。 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

/** 保存済みハッシュ文字列と平文パスワードを timing-safe に照合する。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== ALGO) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const salt = fromBase64(parts[2] as string);
  const expected = fromBase64(parts[3] as string);
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}
