/**
 * 秘密情報(tenant_notification_settings の webhookUrl / smtpPassword)の暗号化に使う
 * Encryptor を環境変数から組み立てる。
 *
 * 環境変数 KIZAMI_ENCRYPTION_KEY(32バイトを base64 で表現した鍵)が未設定、または
 * 形式が不正(base64でない/32バイトでない)な場合は例外を投げず null を返す
 * (node.ts / worker.ts の起動自体は止めない。鍵が無い状態での運用は「秘密情報を含む
 * 保存を拒否する」という形で routes/settings.ts 側が守る — 平文フォールバックはしない)。
 */

import { createEncryptor, type Encryptor } from "@kizami/crypto";

const ENV_KEY = "KIZAMI_ENCRYPTION_KEY";

export function buildEncryptorFromEnv(env: Record<string, string | undefined> = process.env): Encryptor | null {
  const keyBase64 = env[ENV_KEY];
  if (!keyBase64) return null;

  try {
    return createEncryptor(keyBase64);
  } catch (err) {
    console.warn(`${ENV_KEY} is set but invalid; secret encryption stays disabled (plaintext fallback is NOT used):`, err);
    return null;
  }
}

/**
 * 保存値 `stored` を復号する。`encryptor` が無ければ暗号化済み("enc:" プレフィクス付き)の
 * 値は復号できない(null を返す) — 平文値(既存データ)は encryptor の有無に関わらずそのまま返す
 * (後方互換)。
 *
 * 戻り値 null は「読めない(鍵未設定・鍵不一致・破損)」を意味する。呼び出し側は
 * 「未設定として扱い、警告ログを出す」こと(復号失敗を例外にしない)。
 */
export async function decryptSecret(encryptor: Encryptor | null | undefined, stored: string): Promise<string | null> {
  if (!stored.startsWith("enc:")) return stored;
  if (!encryptor) return null;
  return encryptor.decrypt(stored);
}

export type { Encryptor };
