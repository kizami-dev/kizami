/**
 * サインアップ招待コード(Closed Beta、SIGNUP_MODE=invite)の生成・正規化・ハッシュ。
 *
 * 運用者が人に口頭・チャットで渡し、人が打つ。そのため:
 * - 紛らわしい文字(I / O / 0 / 1)を除いた32文字のアルファベット(base32 風。5ビット/文字で
 *   剰余バイアスが出ない)で、4文字ずつハイフン区切り(`ABCD-EFGH-JKMN-PQRS`)
 * - 16文字 = 80ビットの乱数。推測は現実的でなく、加えて POST /signup は IP レート制限と
 *   Turnstile を通らないと試せない
 * - 照合は正規化(大文字化・ハイフン/空白除去)してから SHA-256 を取る。DB にはハッシュのみ
 *   保存し、平文は発行時に1度だけ表示する(トークン・API キーと同じ作法)
 */

import { sha256Hex } from "../auth/api-key.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;
const GROUP_SIZE = 4;

/** 新しい招待コードの平文を作る(`XXXX-XXXX-XXXX-XXXX`)。 */
export function generateSignupInviteCode(): string {
  const raw = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(raw);
  // 256 は 32 の倍数なので、下位5ビットを取ってもバイアスは出ない
  const chars = [...raw].map((b) => ALPHABET[b & 31]!);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += GROUP_SIZE) groups.push(chars.slice(i, i + GROUP_SIZE).join(""));
  return groups.join("-");
}

/** 入力された招待コードを照合用に正規化する(大文字化・ハイフンと空白の除去)。 */
export function normalizeSignupInviteCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

/** DB に保存・照合する SHA-256(hex)。入力は平文(表記ゆれは内部で正規化する)。 */
export async function hashSignupInviteCode(input: string): Promise<string> {
  return sha256Hex(normalizeSignupInviteCode(input));
}
