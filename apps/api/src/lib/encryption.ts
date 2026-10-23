/**
 * 秘密情報(DB の webhookUrl / smtpPassword / Slack・OIDC の secret / 2FA の共有鍵)と封印 Cookie の
 * 暗号化に使う Encryptor を環境変数から組み立てる。
 *
 * - KIZAMI_ENCRYPTION_KEY(32バイトを base64 で表現した鍵): 現行鍵。書き込みは常にこの鍵。
 * - KIZAMI_ENCRYPTION_KEYS_PREVIOUS(任意。base64 の鍵をカンマ区切り): 復号専用の旧鍵。
 *   現行鍵で読めなかった値を先頭から順に試す。鍵のローテーション中だけ設定する
 *   (手順は deploy/k8s/README.md「鍵のローテーション」)。
 *
 * KIZAMI_ENCRYPTION_KEY が未設定、または形式が不正(base64でない/32バイトでない)な場合は例外を
 * 投げず null を返す(node.ts / worker.ts の起動自体は止めない。鍵が無い状態での運用は「秘密情報を
 * 含む保存を拒否する」という形で routes/settings.ts 側が守る — 平文フォールバックはしない)。
 * 旧鍵が不正な場合は、その位置(1 始まり)だけを警告に出して無視する — 現行鍵は無効にしない
 * (鍵の値はログに出さない)。
 */

import { createEncryptor, type EncryptionContext, type Encryptor, type InspectableEncryptor } from "@kizami/crypto";

const ENV_KEY = "KIZAMI_ENCRYPTION_KEY";
const ENV_KEYS_PREVIOUS = "KIZAMI_ENCRYPTION_KEYS_PREVIOUS";

export function buildEncryptorFromEnv(env: Record<string, string | undefined> = process.env): InspectableEncryptor | null {
  const keyBase64 = env[ENV_KEY];
  if (!keyBase64) return null;

  const previous: string[] = [];
  const previousRaw = env[ENV_KEYS_PREVIOUS];
  if (previousRaw) {
    previousRaw.split(",").forEach((raw, i) => {
      const candidate = raw.trim();
      if (candidate === "") return; // 末尾カンマ・空要素は無視(位置の数え方は元の並びのまま)
      try {
        createEncryptor(candidate); // 形式の検証だけ(値は保持しない)
        previous.push(candidate);
      } catch {
        // エラーオブジェクトは鍵の値を含みうるので出さない。位置だけ。
        console.warn(`${ENV_KEYS_PREVIOUS}: entry #${i + 1} is invalid (not a base64 32-byte key); ignored`);
      }
    });
  }

  try {
    return createEncryptor(keyBase64, { previous });
  } catch (err) {
    console.warn(`${ENV_KEY} is set but invalid; secret encryption stays disabled (plaintext fallback is NOT used):`, err);
    return null;
  }
}

/**
 * 暗号文を束ねる文脈(AAD)の定義。ラベルの文字列はここだけで組み立てる(呼び出し側で直書きしない)。
 *
 * DB の秘密情報(purpose: "at-rest")のラベルは `<table>.<column>:<所有者の不変 ID>`。
 * - テナント単位の列は tenantId、ユーザー単位の列は tenantId と userId の両方を束ねる。
 * - メールアドレスのように変更できる値は使わない。
 * ラベルを変えると既存の v2 値が読めなくなるため、変更しないこと
 * (v1 の値はラベルを見ないので、移行前のデータには影響しない)。
 */
export const secretContext = {
  /** tenant_notification_settings.webhook_url */
  tenantWebhookUrl: (tenantId: string): EncryptionContext => ({
    purpose: "at-rest",
    label: `tenant_notification_settings.webhook_url:${tenantId}`,
  }),
  /** tenant_notification_settings.smtp_password */
  tenantSmtpPassword: (tenantId: string): EncryptionContext => ({
    purpose: "at-rest",
    label: `tenant_notification_settings.smtp_password:${tenantId}`,
  }),
  /** user_notification_settings.webhook_url(主キーは tenantId + userId) */
  userWebhookUrl: (tenantId: string, userId: string): EncryptionContext => ({
    purpose: "at-rest",
    label: `user_notification_settings.webhook_url:${tenantId}:${userId}`,
  }),
  /** tenant_slack_settings.signing_secret */
  slackSigningSecret: (tenantId: string): EncryptionContext => ({
    purpose: "at-rest",
    label: `tenant_slack_settings.signing_secret:${tenantId}`,
  }),
  /** tenant_oidc_settings.client_secret */
  oidcClientSecret: (tenantId: string): EncryptionContext => ({
    purpose: "at-rest",
    label: `tenant_oidc_settings.client_secret:${tenantId}`,
  }),
  /** user_totp.secret_encrypted(主キーは userId、行は tenantId も持つ) */
  totpSecret: (tenantId: string, userId: string): EncryptionContext => ({
    purpose: "at-rest",
    label: `user_totp.secret_encrypted:${tenantId}:${userId}`,
  }),
};

/**
 * 封印 Cookie(purpose: "cookie")の文脈。ラベルは Cookie 名。
 * 別の Cookie に差し替えられても復号できない(ペイロードの `purpose` 検証と二重に守る)。
 */
export function cookieContext(cookieName: string): EncryptionContext {
  return { purpose: "cookie", label: cookieName };
}

/**
 * 保存値 `stored` を復号する。`encryptor` が無ければ暗号化済み("enc:" プレフィクス付き)の
 * 値は復号できない(null を返す) — 平文値(既存データ)は encryptor の有無に関わらずそのまま返す
 * (後方互換)。`ctx` は secretContext.* で作る(省略不可)。
 *
 * 戻り値 null は「読めない(鍵未設定・鍵不一致・文脈不一致・破損)」を意味する。呼び出し側は
 * 「未設定として扱い、警告ログを出す」こと(復号失敗を例外にしない)。
 */
export async function decryptSecret(
  encryptor: Encryptor | null | undefined,
  stored: string,
  ctx: EncryptionContext,
): Promise<string | null> {
  if (!stored.startsWith("enc:")) return stored;
  if (!encryptor) return null;
  return encryptor.decrypt(stored, ctx);
}

/**
 * サーバー自身が暗号化して渡した値(TOTP / OIDC の tx Cookie など)を復号する。
 * `decryptSecret` と違い平文フォールバックを持たない — "enc:v1:" / "enc:v2:" で始まらない値は null。
 * v1(旧形式・発行済みの Cookie)も有効期限が切れるまでは読む。
 *
 * Encryptor.decrypt は「"enc:" が無ければ平文の既存データ」として素通しするため、
 * クライアントが書き換えられる値にそのまま使うと、攻撃者が平文の JSON を置くだけで
 * 「サーバーが発行した値」として通ってしまう。Cookie の復号は必ずこちらを使うこと。
 */
export async function decryptSealed(encryptor: Encryptor, value: string, ctx: EncryptionContext): Promise<string | null> {
  if (!value.startsWith("enc:v1:") && !value.startsWith("enc:v2:")) return null;
  return encryptor.decrypt(value, ctx);
}

export type { EncryptionContext, Encryptor, InspectableEncryptor };
