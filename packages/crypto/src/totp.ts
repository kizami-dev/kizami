/**
 * TOTP(RFC 6238)/ HOTP(RFC 4226)の自前実装。二要素認証(2FA)のワンタイムコード。
 *
 * ## なぜ自前実装なのか(判断点 2026-08-27)
 *
 * TOTP は「HMAC を1回計算して 31 ビットを切り出し 10 進 6 桁にする」だけの仕様で、
 * 本体は下の `hotp()` の 20 行に収まる。ここに依存パッケージを1つ増やすと、
 * **認証の中核が第三者のリリース運用に乗る**(サプライチェーンの面積が広がる)一方で、
 * 得られるものは 20 行の節約しかない。加えて KIZAMI は workerd(Cloudflare Workers)でも
 * 動かす前提で `node:crypto` を一切使わない制約があり、npm の TOTP 実装の多くは
 * `node:crypto` 前提で選択肢が狭い。よって WebCrypto(`crypto.subtle`)だけで自前実装し、
 * **RFC 6238 Appendix B のテストベクタをそのまま**テストへ入れて正しさを固定する
 * (test/totp.test.ts)。
 *
 * ## パラメータ(認証アプリの既定に合わせる)
 *
 * | 項目 | 値 | 理由 |
 * | --- | --- | --- |
 * | ハッシュ | SHA-1 | RFC 6238 の既定。Google Authenticator を含む主要アプリが SHA-1 しか読まない実装を持つため、相互運用性を優先する(TOTP における SHA-1 の用途は HMAC であり、衝突耐性への攻撃は該当しない) |
 * | 桁数 | 6 | 同上(8桁を読めないアプリがある) |
 * | 時間ステップ | 30秒 | 同上 |
 * | 許容ずれ | ±1ステップ | 端末の時計ずれ(数十秒)を吸収する現実的な最小値。±1 で受理窓は最大90秒 |
 *
 * ## 再利用(リプレイ)防止は呼び出し側の責務
 *
 * 同じコードは 30 秒間有効なので、盗み見られたコードがその窓の内に再送されうる。
 * これを防ぐには「最後に受理したカウンタ」を永続化して、それ以下のカウンタを拒否する必要がある。
 * このモジュールは純粋関数として `verifyTotp()` が **一致したカウンタ値**を返すところまでを担い、
 * 保存・比較は呼び出し側(apps/api、`user_totp.last_used_counter`)が行う。
 */

import { decodeBase32, encodeBase32 } from "./base32.js";

/** 時間ステップ(秒)。RFC 6238 の既定 T0=0, X=30。 */
export const TOTP_STEP_SECONDS = 30;

/** コードの桁数。 */
export const TOTP_DIGITS = 6;

/** 前後に許容するステップ数(±1 = 最大90秒の受理窓)。 */
export const TOTP_WINDOW_STEPS = 1;

/** 生成する共有鍵のバイト長。RFC 4226 §4 の推奨(160ビット= HMAC-SHA1 のブロック長に合う)。 */
const SECRET_BYTES = 20;

/** 共有鍵(base32、無パディング)を新規生成する。 */
export function generateTotpSecret(): string {
  const raw = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(raw);
  return encodeBase32(raw);
}

/** UTC 秒からカウンタ(= floor(t / step))を求める。 */
export function totpCounterAt(unixSeconds: number, stepSeconds: number = TOTP_STEP_SECONDS): number {
  return Math.floor(unixSeconds / stepSeconds);
}

/** カウンタを 8 バイトのビッグエンディアンへ("moving factor"、RFC 4226 §5.1)。 */
function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  // 2^53 まで安全に扱うため BigInt を経由する(RFC 6238 Appendix B の
  // T=20000000000 のようにステップ換算後も 32 ビットに収まらない値を試験するため)。
  let value = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/**
 * HOTP(RFC 4226)。共有鍵とカウンタから 10 進コードを作る。
 *
 * @param secret 共有鍵(生バイト列)
 * @param counter 移動因子
 * @param digits 桁数(6 または 8)
 */
export async function hotp(secret: Uint8Array, counter: number, digits: number = TOTP_DIGITS): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterToBytes(counter) as BufferSource));

  // Dynamic Truncation(RFC 4226 §5.3): 最終バイトの下位4ビットをオフセットとして
  // 4バイトを取り出し、最上位ビットを落として 31 ビットの整数にする。
  const offset = (mac[19] as number) & 0x0f;
  const binary =
    (((mac[offset] as number) & 0x7f) << 24) |
    (((mac[offset + 1] as number) & 0xff) << 16) |
    (((mac[offset + 2] as number) & 0xff) << 8) |
    ((mac[offset + 3] as number) & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** TOTP コードを生成する(base32 の共有鍵と UTC 秒から)。 */
export async function generateTotp(
  secretBase32: string,
  unixSeconds: number,
  options: { digits?: number; stepSeconds?: number } = {},
): Promise<string> {
  const digits = options.digits ?? TOTP_DIGITS;
  const stepSeconds = options.stepSeconds ?? TOTP_STEP_SECONDS;
  return hotp(decodeBase32(secretBase32), totpCounterAt(unixSeconds, stepSeconds), digits);
}

/** 文字列を timing-safe に比較する(長さが違う場合は即 false — 桁数は秘密ではない)。 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface VerifyTotpParams {
  /** 共有鍵(base32)。 */
  secret: string;
  /** 利用者が入力したコード(前後の空白・区切りは呼び出し側で除去済みであること)。 */
  code: string;
  /** 検証時刻(UTC 秒)。 */
  unixSeconds: number;
  /** 前後に許容するステップ数(既定 ±1)。 */
  windowSteps?: number;
  /**
   * リプレイ防止。**このカウンタ以下は受理しない**(最後に受理したカウンタを渡す)。
   * 未使用(初回)は null。
   */
  minCounterExclusive?: number | null;
  digits?: number;
  stepSeconds?: number;
}

export interface VerifyTotpResult {
  /** 一致したカウンタ。呼び出し側はこれを永続化して次回の `minCounterExclusive` に使う。 */
  counter: number;
}

/**
 * TOTP コードを検証する。一致すればそのカウンタを返し、しなければ null。
 *
 * 窓の走査は「中央(現在) → -1 → +1」の順ではなく **昇順**で行う。どちらでも結果は同じだが、
 * 昇順の方が「最初に一致したカウンタ = 最小のカウンタ」となり、リプレイ判定の意味が単純になる
 * (同じ鍵・同じ窓で複数のカウンタが同じコードを出すことは事実上ないが、順序を決めておく)。
 */
export async function verifyTotp(params: VerifyTotpParams): Promise<VerifyTotpResult | null> {
  const digits = params.digits ?? TOTP_DIGITS;
  const stepSeconds = params.stepSeconds ?? TOTP_STEP_SECONDS;
  const windowSteps = params.windowSteps ?? TOTP_WINDOW_STEPS;

  // 形式が違うものは HMAC を計算せずに落とす(桁数・数字以外は秘密に関係しない公開情報)。
  if (!new RegExp(`^[0-9]{${digits}}$`).test(params.code)) return null;

  const secret = decodeBase32(params.secret);
  const center = totpCounterAt(params.unixSeconds, stepSeconds);
  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const counter = center + offset;
    if (counter < 0) continue;
    // リプレイ防止: 既に受理済みのカウンタ(およびそれ以前)は、コードが正しくても拒否する。
    if (params.minCounterExclusive !== null && params.minCounterExclusive !== undefined && counter <= params.minCounterExclusive) {
      continue;
    }
    const expected = await hotp(secret, counter, digits);
    if (timingSafeEqualString(expected, params.code)) return { counter };
  }
  return null;
}

export interface OtpauthUriParams {
  /** 発行者(認証アプリの一覧に出る名前)。テナント名 or 製品名。 */
  issuer: string;
  /** アカウント名(通常はメールアドレス)。 */
  accountName: string;
  /** 共有鍵(base32)。 */
  secret: string;
  digits?: number;
  stepSeconds?: number;
}

/**
 * `otpauth://totp/...` URI を組み立てる(認証アプリの QR / 手動登録用)。
 *
 * ラベルは慣習に従い `issuer:accountName`(コロン区切り)にし、`issuer` パラメータも重複して
 * 付ける — 古いアプリはラベル側だけ、新しいアプリはパラメータ側だけを読むため、両方載せるのが
 * 最も相互運用性が高い(Key URI Format の慣習)。
 */
export function buildOtpauthUri(params: OtpauthUriParams): string {
  const digits = params.digits ?? TOTP_DIGITS;
  const period = params.stepSeconds ?? TOTP_STEP_SECONDS;
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
