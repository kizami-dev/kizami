/**
 * 保存時秘密情報・封印 Cookie の暗号化(AES-256-GCM, WebCrypto `crypto.subtle`)。
 *
 * node:crypto は使わず globalThis.crypto (WebCrypto) のみに依存する(Node / workerd 両対応。
 * apps/api/src/auth/password.ts の PBKDF2 実装と同じ方針)。
 *
 * 保存形式:
 * - v2(現行の書き込み形式): `"enc:v2:<ivBase64>:<ciphertextBase64>"`
 *   - マスター鍵(KIZAMI_ENCRYPTION_KEY)から HKDF-SHA256 で **用途別のサブ鍵** を導出して使う
 *     (`at-rest` = DB の秘密情報、`cookie` = 封印 Cookie)。1 本のマスター鍵を用途をまたいで
 *     直接使い回さない。
 *   - AES-GCM の AAD(追加認証データ)に「用途 + ラベル」を束ねる。ラベルは呼び出し側が
 *     `<table>.<column>:<tenantId>[:<userId>]` や Cookie 名で指定する。別の行・別のテナント・
 *     別の用途へ暗号文を移植しても認証タグ検証で失敗する(= 復号できない)。
 * - v1(読み取りのみ・後方互換): `"enc:v1:<ivBase64>:<ciphertextBase64>"`。マスター鍵を直接使い、
 *   AAD なし。既存の DB 値と発行済み Cookie を読むためだけに残す(新規の書き込みは常に v2)。
 *
 * 鍵のローテーション:
 * - 保存形式に鍵 ID は持たない。`createEncryptor(current, { previous: [...] })` は **書き込みを常に current で**
 *   行い、復号は current → previous(渡した順)の順に試す。AES-GCM は認証タグで鍵の取り違えを検出するので、
 *   試し復号で誤った平文が返ることはない(失敗は null)。v1・v2・Cookie のどれにも同じく効く。
 * - 旧鍵は復号専用。旧鍵で読めた値は `decryptWithInfo` が `needsRewrite: true` を返す
 *   (再暗号化 CLI = apps/api/src/reencrypt-secrets.ts が使う)。
 *
 * 呼び出し側との契約(kizami の秘密情報カラム全般に適用する):
 * - encrypt / decrypt は必ず明示的な文脈(EncryptionContext)を渡す。省略時の既定値は無い。
 * - decrypt は例外を投げない。復号できない値(鍵不一致・文脈不一致・破損・未知バージョン)は null を返す。
 * - "enc:" で始まらない値は平文とみなしそのまま返す(既存データとの後方互換)。
 *   クライアントが書き換えられる値(Cookie)には使わないこと(apps/api の decryptSealed を使う)。
 * - 平文フォールバックでの暗号化は存在しない(encrypt は常に暗号化した値を返す)。
 */

const ENC_MARKER = "enc:";
const V1_PREFIX = "enc:v1:";
const V2_PREFIX = "enc:v2:";
const IV_BYTES = 12; // AES-GCM 推奨サイズ
const KEY_BYTES = 32; // AES-256

/** 暗号化の用途。サブ鍵(HKDF の info)と AAD の両方に効く。 */
export type EncryptionPurpose = "at-rest" | "cookie";

/** サブ鍵導出の info。用途ごとに固定(変えると既存の v2 値が読めなくなる)。 */
const HKDF_INFO: Record<EncryptionPurpose, string> = {
  "at-rest": "kizami/v2/at-rest",
  cookie: "kizami/v2/cookie",
};

/**
 * HKDF の salt。マスター鍵は 256 ビットの一様乱数(パスワードではない)なので salt は固定の
 * ゼロ長でよい(RFC 5869 §3.1: salt 無しは HashLen 個のゼロと同等)。用途の分離は info で行う。
 */
const HKDF_SALT = new Uint8Array(0);

export interface EncryptionContext {
  purpose: EncryptionPurpose;
  /**
   * 暗号文を束ねる識別子。DB なら `<table>.<column>:<所有者の不変 ID>`、Cookie なら Cookie 名。
   * メールアドレスのような変更可能な値は使わない。
   */
  label: string;
}

export interface Encryptor {
  /** 平文を文脈つきで暗号化し `"enc:v2:<ivBase64>:<ciphertextBase64>"` を返す。 */
  encrypt(plain: string, ctx: EncryptionContext): Promise<string>;
  /**
   * 保存値を復号する。"enc:" プレフィクスが無ければ平文とみなしそのまま返す。
   * v1 は文脈を無視してマスター鍵で復号する(後方互換)。v2 は文脈が暗号化時と一致しなければ失敗する。
   * 復号できない場合(鍵不一致・文脈不一致・破損・未知バージョン)は例外を投げず null を返す。
   */
  decrypt(stored: string, ctx: EncryptionContext): Promise<string | null>;
}

/** `decryptWithInfo` の結果。 */
export interface DecryptInfo {
  /** 復号した平文。復号できなければ null(`decrypt` と同じ条件)。 */
  plain: string | null;
  /**
   * 現行の書き込み形式(現行鍵の v2)で保存し直すべきか。平文・v1・旧鍵で復号した値は true。
   * `plain` が null のときは常に false(直しようがない)。
   */
  needsRewrite: boolean;
}

/** 通常の Encryptor に、再暗号化の要否を返す `decryptWithInfo` を足したもの(呼び出し側は Encryptor として使う)。 */
export interface InspectableEncryptor extends Encryptor {
  decryptWithInfo(stored: string, ctx: EncryptionContext): Promise<DecryptInfo>;
}

export interface CreateEncryptorOptions {
  /** 復号専用の旧鍵(base64, 32バイト)。現行鍵で復号できなかったときに先頭から順に試す。 */
  previous?: readonly string[];
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

/** 1本のマスター鍵から作る復号・暗号の部品。 */
interface KeyMaterial {
  /** 現行形式(v2)で暗号化する。 */
  encrypt(plain: string, ctx: EncryptionContext): Promise<string>;
  /** 復号する。鍵不一致・文脈不一致・破損は null。 */
  decrypt(version: "v1" | "v2", ivBase64: string, ciphertextBase64: string, ctx: EncryptionContext): Promise<string | null>;
}

/**
 * 32バイトを base64 で表現した鍵文字列から KeyMaterial を作る。
 * 鍵の形式が不正(base64でない/32バイトでない)なら例外を投げる(同期的に検証する)。
 */
function createKeyMaterial(keyBase64: string, name: string): KeyMaterial {
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64(keyBase64);
  } catch {
    throw new Error(`${name}: key must be a valid base64 string`);
  }
  if (keyBytes.length !== KEY_BYTES) {
    throw new Error(`${name}: key must decode to ${KEY_BYTES} bytes (AES-256), got ${keyBytes.length}`);
  }

  // importKey / deriveKey は非同期だが、成功が保証されている(鍵長は既に検証済み)ため
  // Promise をそのまま保持して encrypt/decrypt から都度 await する(遅延インポート・使い回し)。
  // v1 用: マスター鍵そのもの(復号専用)。
  const v1KeyPromise = crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, ["decrypt"]);
  // v2 用: HKDF の入力鍵材料から用途別のサブ鍵を導出する。
  const hkdfKeyPromise = crypto.subtle.importKey("raw", keyBytes as BufferSource, "HKDF", false, ["deriveKey"]);
  const subKeyPromises = new Map<EncryptionPurpose, Promise<CryptoKey>>();

  function subKey(purpose: EncryptionPurpose): Promise<CryptoKey> {
    const info = HKDF_INFO[purpose];
    if (info === undefined) {
      // 型の外から不正な purpose が来た場合(JS 呼び出し・型アサーション)。サブ鍵は作らない。
      return Promise.reject(new Error(`crypto: unknown purpose "${String(purpose)}"`));
    }
    let p = subKeyPromises.get(purpose);
    if (!p) {
      p = hkdfKeyPromise.then((hkdfKey) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT as BufferSource, info: new TextEncoder().encode(info) as BufferSource },
          hkdfKey,
          { name: "AES-GCM", length: KEY_BYTES * 8 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
      subKeyPromises.set(purpose, p);
    }
    return p;
  }

  /** AAD = 用途 + NUL + ラベル。用途とラベルの境界があいまいにならないよう NUL で区切る。 */
  function aad(ctx: EncryptionContext): BufferSource {
    return new TextEncoder().encode(`${ctx.purpose}\u0000${ctx.label}`) as BufferSource;
  }

  return {
    async encrypt(plain: string, ctx: EncryptionContext): Promise<string> {
      const key = await subKey(ctx.purpose);
      const iv = new Uint8Array(IV_BYTES);
      crypto.getRandomValues(iv);
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(ctx) },
        key,
        new TextEncoder().encode(plain),
      );
      return `${V2_PREFIX}${encodeBase64(iv)}:${encodeBase64(new Uint8Array(ciphertext))}`;
    },

    async decrypt(version, ivBase64, ciphertextBase64, ctx): Promise<string | null> {
      try {
        const iv = decodeBase64(ivBase64);
        const ciphertext = decodeBase64(ciphertextBase64);
        const plainBytes =
          version === "v1"
            ? // v1: マスター鍵・AAD なし(ctx は見ない)。既存データ/発行済み Cookie の読み取り専用。
              await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, await v1KeyPromise, ciphertext as BufferSource)
            : await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(ctx) },
                await subKey(ctx.purpose),
                ciphertext as BufferSource,
              );
        return new TextDecoder().decode(plainBytes);
      } catch {
        // 鍵不一致・文脈不一致(認証タグ検証失敗)・破損した base64 など、復号に失敗した場合は例外を投げず null
        return null;
      }
    },
  };
}

/**
 * 32バイトを base64 で表現した鍵文字列から Encryptor を作る。
 * 鍵の形式が不正(base64でない/32バイトでない)なら例外を投げる(同期的に検証する)。
 * 旧鍵(`options.previous`)も同じ検証を通し、不正なものがあれば例外にする
 * (環境変数から組み立てる側 = apps/api の buildEncryptorFromEnv が、不正な旧鍵を警告つきで除外する)。
 */
export function createEncryptor(keyBase64: string, options: CreateEncryptorOptions = {}): InspectableEncryptor {
  const current = createKeyMaterial(keyBase64, "createEncryptor");
  const previous = (options.previous ?? []).map((k, i) => createKeyMaterial(k, `createEncryptor: previous[${i}]`));

  async function decryptWithInfo(stored: string, ctx: EncryptionContext): Promise<DecryptInfo> {
    if (!stored.startsWith(ENC_MARKER)) {
      // "enc:" プレフィクスが無い = 暗号化前の既存データ(平文)。そのまま読めるが、暗号化して保存し直したい。
      return { plain: stored, needsRewrite: true };
    }
    const isV1 = stored.startsWith(V1_PREFIX);
    if (!isV1 && !stored.startsWith(V2_PREFIX)) {
      // "enc:" だが v1/v2 ではない = 未知のバージョン。plaintext と誤認せず復号不可扱い。
      return { plain: null, needsRewrite: false };
    }
    const rest = stored.slice(isV1 ? V1_PREFIX.length : V2_PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep === -1) return { plain: null, needsRewrite: false };
    const version = isV1 ? "v1" : "v2";
    const iv = rest.slice(0, sep);
    const ciphertext = rest.slice(sep + 1);

    // 現行鍵 → 旧鍵の順。認証タグが通った鍵だけが平文を返す(GCM なので誤復号は起きない)。
    const viaCurrent = await current.decrypt(version, iv, ciphertext, ctx);
    if (viaCurrent !== null) return { plain: viaCurrent, needsRewrite: isV1 };
    for (const key of previous) {
      const plain = await key.decrypt(version, iv, ciphertext, ctx);
      if (plain !== null) return { plain, needsRewrite: true };
    }
    return { plain: null, needsRewrite: false };
  }

  return {
    encrypt: (plain, ctx) => current.encrypt(plain, ctx),
    async decrypt(stored: string, ctx: EncryptionContext): Promise<string | null> {
      return (await decryptWithInfo(stored, ctx)).plain;
    },
    decryptWithInfo,
  };
}
