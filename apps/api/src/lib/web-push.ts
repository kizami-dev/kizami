/**
 * VAPID 鍵(ブラウザプッシュ通知)の環境変数からの読み込み。
 *
 * 設計は docs/design/web-push.md。encryption.ts の buildEncryptorFromEnv() と同じ流儀で、
 * 「環境変数が無ければ null を返し、機能ごと静かに無効化する」ことを徹底する:
 *
 * - 鍵が無い配備ではプッシュ通知チャネルが存在しないものとして扱う。GET
 *   /settings/notifications/me は `pushAvailable: false` を返し、Web UI は購読ボタンも
 *   カテゴリ別のプッシュ列も表示しない。日次スキャンは push チャネルを組み立てず、
 *   個人設定で push=true になっていても何も送らない(エラーにもしない)。
 * - 鍵の生成は運用者の作業(`pnpm generate-vapid`、または `npx web-push generate-vapid-keys`)。
 *   deploy/k8s/README.md・deploy/compose/compose.yaml を参照。
 *
 * 形式の検証はここで済ませる(base64url としてデコードでき、公開鍵 65 バイト・秘密鍵 32 バイト
 * であること)。形式が不正なら null を返して警告する — 起動を止めない(打刻など本体機能は
 * プッシュ通知と無関係に動き続けるべきなので、鍵のタイポでインスタンス全体が落ちるのは過剰)。
 */

import { base64UrlDecode, type VapidKeys } from "@kizami/notify";

/** VAPID の `sub` に使える形式(RFC 8292: mailto: か https: の URL)。 */
function isValidSubject(subject: string): boolean {
  return subject.startsWith("mailto:") || subject.startsWith("https://");
}

function decodedLength(value: string): number | null {
  try {
    return base64UrlDecode(value).length;
  } catch {
    return null;
  }
}

/**
 * 3つの環境変数 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT が揃っていて
 * 形式も正しければ VapidKeys を返す。1つでも欠けている・形式が不正なら null。
 */
export function buildVapidFromEnv(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;

  // 3つとも未設定 = プッシュ通知を使わない配備。警告は出さない(既定の状態なので)。
  if (!publicKey && !privateKey && !subject) return null;

  if (!publicKey || !privateKey || !subject) {
    console.warn(
      "[web-push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT はすべて設定する必要があります。プッシュ通知を無効化します",
    );
    return null;
  }
  if (!isValidSubject(subject)) {
    console.warn(`[web-push] VAPID_SUBJECT must start with "mailto:" or "https://"; disabling push notifications`);
    return null;
  }
  if (decodedLength(publicKey) !== 65) {
    console.warn("[web-push] VAPID_PUBLIC_KEY must be a base64url-encoded 65-byte EC point; disabling push notifications");
    return null;
  }
  if (decodedLength(privateKey) !== 32) {
    console.warn("[web-push] VAPID_PRIVATE_KEY must be a base64url-encoded 32-byte scalar; disabling push notifications");
    return null;
  }

  return { publicKey, privateKey, subject };
}
