/**
 * 保存時秘密情報の暗号化(AES-256-GCM, WebCrypto `crypto.subtle`)。
 *
 * node:crypto は使わず globalThis.crypto (WebCrypto) のみに依存する(Node / workerd 両対応。
 * apps/api/src/auth/password.ts の PBKDF2 実装と同じ方針)。
 *
 * 保存形式: `"enc:v1:<ivBase64>:<ciphertextBase64>"`。バージョンを埋め込むことで、将来の
 * アルゴリズム変更・鍵ローテーションに備える(未知のバージョンは「復号できない値」として
 * 扱い null を返す — plaintext と誤認しない)。
 *
 * 呼び出し側との契約(kizami の秘密情報カラム全般に適用する):
 * - decrypt は例外を投げない。復号できない値(鍵不一致・破損・未知バージョン)は null を返す。
 * - "enc:" で始まらない値は平文とみなしそのまま返す(既存データとの後方互換)。
 * - 平文フォールバックでの暗号化は存在しない(encrypt は常に暗号化した値を返す)。
 */

const ENC_MARKER = "enc:";
const V1_PREFIX = "enc:v1:";
const IV_BYTES = 12; // AES-GCM 推奨サイズ
const KEY_BYTES = 32; // AES-256

export interface Encryptor {
  /** 平文を暗号化し `"enc:v1:<ivBase64>:<ciphertextBase64>"` を返す。 */
  encrypt(plain: string): Promise<string>;
  /**
   * 保存値を復号する。"enc:" プレフィクスが無ければ平文とみなしそのまま返す。
   * 復号できない場合(鍵不一致・破損・未知バージョン)は例外を投げず null を返す。
   */
  decrypt(stored: string): Promise<string | null>;
}

function isValidBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function decodeBase64(value: string): Uint8Array {
  if (!isValidBase64(value)) {
    throw new Error("crypto: invalid base64 string");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * 32バイトを base64 で表現した鍵文字列から Encryptor を作る。
 * 鍵の形式が不正(base64でない/32バイトでない)なら例外を投げる(同期的に検証する)。
 */
export function createEncryptor(keyBase64: string): Encryptor {
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64(keyBase64);
  } catch {
    throw new Error("createEncryptor: key must be a valid base64 string");
  }
  if (keyBytes.length !== KEY_BYTES) {
    throw new Error(`createEncryptor: key must decode to ${KEY_BYTES} bytes (AES-256), got ${keyBytes.length}`);
  }

  // importKey は非同期だが、成功が保証されている(鍵長は既に検証済み)ため
  // Promise をそのまま保持して encrypt/decrypt から都度 await する(遅延インポート・使い回し)。
  const keyPromise = crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);

  return {
    async encrypt(plain: string): Promise<string> {
      const key = await keyPromise;
      const iv = new Uint8Array(IV_BYTES);
      crypto.getRandomValues(iv);
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        new TextEncoder().encode(plain),
      );
      return `${V1_PREFIX}${encodeBase64(iv)}:${encodeBase64(new Uint8Array(ciphertext))}`;
    },

    async decrypt(stored: string): Promise<string | null> {
      if (!stored.startsWith(ENC_MARKER)) {
        // "enc:" プレフィクスが無い = 暗号化前の既存データ(平文)。そのまま読める。
        return stored;
      }
      if (!stored.startsWith(V1_PREFIX)) {
        // "enc:" だが v1 ではない = 未知のバージョン。plaintext と誤認せず復号不可扱い。
        return null;
      }
      const rest = stored.slice(V1_PREFIX.length);
      const sep = rest.indexOf(":");
      if (sep === -1) return null;

      try {
        const iv = decodeBase64(rest.slice(0, sep));
        const ciphertext = decodeBase64(rest.slice(sep + 1));
        const key = await keyPromise;
        const plainBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext as BufferSource);
        return new TextDecoder().decode(plainBytes);
      } catch {
        // 鍵不一致(認証タグ検証失敗)・破損した base64 など、復号に失敗した場合は例外を投げず null
        return null;
      }
    },
  };
}
