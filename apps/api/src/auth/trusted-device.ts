/**
 * 信頼済み端末の Cookie(`kizami_trusted_device`、2026-10-22、セキュリティレビュー M3 の締め出し緩和)。
 *
 * ログインの失敗回数はメール単位の共有バケツ(lib/rate-limit.ts の `loginFailuresPerAccount`)で
 * 数えるため、攻撃者が IP を回して失敗を送り続けると、本人も正しいパスワードで入れなくなる。
 * そこで「この端末(ブラウザ)は以前このアカウントで最後までログインできた」ことを暗号化 Cookie に残し、
 * それを持つリクエストだけは共有バケツではなく**信頼済み端末のバケツ**(ユーザー単位)で数える。
 *
 * - 発行するのはログインが**最後まで**通ったとき(2FA が有効なら第2段階の後)だけ。パスワードだけでは出さない
 * - 中身は Encryptor(AES-256-GCM)で封をする。読むときは `decryptSealed` だけを使い、平文は受け付けない
 *   (中身を偽造すれば共有バケツを回避できてしまうため)
 * - Cookie はアカウントの実在について何も教えない: 持っていない相手の挙動は従来どおり(共有バケツ)
 * - この Cookie はセッションではない(認証ミドルウェアは見ない)。ログアウトしても消さない — 端末の信頼は
 *   ログイン状態とは別で、ログアウト中に締め出しを受けたときこそ要る
 * - 盗まれた Cookie で総当たりされないよう、信頼済み端末のバケツにも上限がある(`loginFailuresPerTrustedDevice`)。
 *   キーはユーザー単位(`trusted|tenantId|userId`)で、Cookie を何枚持っていても枠は共有される
 * - この経路で照合するのは **Cookie のアカウント1件だけ**(同じメールの別テナントのアカウントは照合しない)。
 *   照合先を絞らないと、自分のテナントで同じメールの Cookie を得た攻撃者が、共有バケツを使わずに
 *   別テナントの被害者を総当たりできてしまう
 *
 * SSO(OIDC)のログインでは発行しない: SSO の利用者はパスワードのバケツに締め出される経路を使わない。
 */

import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cookieContext, decryptSealed, type Encryptor } from "../lib/encryption.js";

export const TRUSTED_DEVICE_COOKIE_NAME = "kizami_trusted_device";

/** 有効期間(分)。セッションと同じ 30 日。最後まで通ったログインのたびに発行し直す。 */
export const TRUSTED_DEVICE_TTL_MINUTES = 30 * 24 * 60;

/** 封をした Cookie の用途の印(auth/totp.ts の TOTP_TX_PURPOSE の判断点)。 */
export const TRUSTED_DEVICE_PURPOSE = "trusted_device";

export interface TrustedDevice {
  purpose: typeof TRUSTED_DEVICE_PURPOSE;
  tenantId: string;
  userId: string;
  /** ログインに使ったメール(小文字化)。違うメールでのログインには効かせない。 */
  emailLower: string;
  /** 発行時刻(UTC エポック分)。 */
  issuedAt: number;
}

function isTrustedDevice(value: unknown): value is TrustedDevice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.purpose === TRUSTED_DEVICE_PURPOSE &&
    typeof v.tenantId === "string" &&
    typeof v.userId === "string" &&
    typeof v.emailLower === "string" &&
    typeof v.issuedAt === "number" &&
    Number.isFinite(v.issuedAt)
  );
}

export async function setTrustedDeviceCookie(
  c: Context,
  encryptor: Encryptor,
  device: TrustedDevice,
  options: { secure: boolean },
): Promise<void> {
  setCookie(c, TRUSTED_DEVICE_COOKIE_NAME, await encryptor.encrypt(JSON.stringify(device), cookieContext(TRUSTED_DEVICE_COOKIE_NAME)), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: options.secure,
    maxAge: TRUSTED_DEVICE_TTL_MINUTES * 60,
  });
}

export function clearTrustedDeviceCookie(c: Context): void {
  deleteCookie(c, TRUSTED_DEVICE_COOKIE_NAME, { path: "/" });
}

/**
 * リクエストの Cookie を読み、封が正しく期限内で、`emailLower` が一致するものだけを返す。
 * 平文・改竄・未来の issuedAt・期限切れ・別のメールは null(呼び出し側は通常の経路に戻る)。
 */
export async function readTrustedDevice(
  c: Context,
  encryptor: Encryptor,
  params: { emailLower: string; nowMinutes: number },
): Promise<TrustedDevice | null> {
  const raw = getCookie(c, TRUSTED_DEVICE_COOKIE_NAME);
  if (!raw) return null;
  const decrypted = await decryptSealed(encryptor, raw, cookieContext(TRUSTED_DEVICE_COOKIE_NAME));
  if (decrypted === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    return null;
  }
  if (!isTrustedDevice(parsed)) return null;
  const age = params.nowMinutes - parsed.issuedAt;
  if (age < 0 || age > TRUSTED_DEVICE_TTL_MINUTES) return null;
  if (parsed.emailLower !== params.emailLower) return null;
  return parsed;
}
