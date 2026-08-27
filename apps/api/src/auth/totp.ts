/**
 * 二要素認証(TOTP)の apps/api 側の下回り(2026-08-27)。仕様の正は docs/design/two-factor-auth.md。
 *
 * アルゴリズム本体(HMAC-SHA1・base32)は packages/crypto(`@kizami/crypto`)にある
 * — workerd レグ(`pnpm test:workers`)でも同じテストが走るランタイム非依存の場所に置くため。
 * このファイルが持つのは「KIZAMI としての取り扱い」だけ:
 *
 * - ログイン第2段階を運ぶ暗号化 Cookie(`kizami_totp_tx`)の定義
 * - リカバリコードの生成・正規化・ハッシュ化
 * - 利用者が入力したコードの正規化(空白・ハイフンの除去)
 */

import { sha256Hex } from "./api-key.js";

/**
 * パスワード検証を通過したが 2FA が残っている状態を運ぶ Cookie。
 *
 * OIDC の認可リクエスト状態(routes/auth-oidc.ts の `kizami_oidc_tx`)と同じ作法:
 * **サーバー側に中間状態のテーブルを持たない**。中身は Encryptor(AES-256-GCM)で暗号化するので
 * クライアントは読むことも改竄することもできず、期限切れとともに自然に消える。
 *
 * セッション Cookie(`kizami_session`)とは名前も寿命も別で、**この Cookie だけでは何の
 * リクエストも通らない**(認証ミドルウェアは見ない)。コード検証に成功して初めて
 * セッションが発行される。
 */
export const TOTP_TX_COOKIE_NAME = "kizami_totp_tx";

/**
 * ログイン第2段階の有効期間(秒)。認証アプリを開いて6桁を写す操作に必要な時間だけ持たせる。
 * 5分あれば端末を探す余裕はあり、放置された「パスワードは通っている」状態を長く残さない。
 */
export const TOTP_TX_TTL_SECONDS = 300;

/** `kizami_totp_tx` の中身(暗号化して Cookie に載せる)。 */
export interface TotpTransaction {
  tenantId: string;
  userId: string;
  /** 発行時刻(UTC エポック分)。Cookie の Max-Age とは別に、サーバー側でも期限を確認する。 */
  issuedAt: number;
}

/** 有効期間(分)。`issuedAt` との比較に使う。 */
export const TOTP_TX_TTL_MINUTES = TOTP_TX_TTL_SECONDS / 60;

/** 復号済みの Cookie 値が TotpTransaction の形をしているか(改竄はできないが、版ズレはありうる)。 */
export function isTotpTransaction(value: unknown): value is TotpTransaction {
  if (typeof value !== "object" || value === null) return false;
  const tx = value as Record<string, unknown>;
  return typeof tx.tenantId === "string" && typeof tx.userId === "string" && typeof tx.issuedAt === "number";
}

/** 発行するリカバリコードの本数。 */
export const RECOVERY_CODE_COUNT = 10;

/**
 * リカバリコード1本の文字数(区切りを除く)。
 * base32 アルファベット(32種)から 10 文字 = 50 ビット。単回使用・本数10本・レート制限付きの
 * 用途には十分すぎるが、短くして総当たりの余地を作る理由もないのでこの長さにする。
 */
const RECOVERY_CODE_LENGTH = 10;

/**
 * 表示・入力に使う文字集合。base32(RFC 4648)から **0/1/8/9 と紛らわしい文字を除く**という
 * 発想の逆で、そもそも base32 のアルファベット(A-Z, 2-7)には 0/1/8/9 が無く、
 * O(オー)と 0(ゼロ)、I(アイ)と 1(イチ)の取り違えが起きない。紙に書き写して保管する
 * 前提のコードなのでこの性質が効く。
 */
const RECOVERY_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface GeneratedRecoveryCodes {
  /** 利用者へ1度だけ表示する平文(表示用に "XXXXX-XXXXX" の形)。 */
  codes: string[];
  /** DB に保存する SHA-256(hex)。`codes` と同じ並び。 */
  hashes: string[];
}

/** 乱数から `RECOVERY_CODE_ALPHABET` の1文字を偏りなく選ぶ(32 は 256 の約数なので剰余で偏らない)。 */
function randomCode(): string {
  const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length];
  // 表示は5文字ずつハイフンで区切る(手で書き写す/読み上げるときの取り違えを減らす)。
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** リカバリコードを `RECOVERY_CODE_COUNT` 本生成する(平文とハッシュの対)。 */
export async function generateRecoveryCodes(): Promise<GeneratedRecoveryCodes> {
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    const code = randomCode();
    // 同一バッチ内の重複は事実上起きない(50ビット)が、起きると1本ぶん損をするので弾く。
    if (!codes.includes(code)) codes.push(code);
  }
  const hashes = await Promise.all(codes.map((code) => sha256Hex(normalizeRecoveryCode(code))));
  return { codes, hashes };
}

/**
 * 入力されたリカバリコードを保存形式へ正規化する。
 * ハイフン・空白は表示のための飾りなので落とし、小文字は大文字へ寄せる
 * (利用者が紙から書き写す前提のため、この程度の揺れは受け入れる)。
 */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** リカバリコードのハッシュ(保存・照合に使う)。 */
export async function hashRecoveryCode(input: string): Promise<string> {
  return sha256Hex(normalizeRecoveryCode(input));
}

/**
 * 入力された TOTP コードを正規化する。認証アプリが "123 456" のように空白を挟んで表示する
 * ことがあり、コピー&貼り付けでその空白が混ざるため。
 */
export function normalizeTotpCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}
