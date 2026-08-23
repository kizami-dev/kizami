/**
 * 招待トークン(メンバー招待式登録、docs/requirements.md §認証)。
 *
 * セッション(auth/session.ts)・APIキー(auth/api-key.ts)と同じ方式を踏襲する:
 * 32バイト乱数の base64url をクライアントに1度だけ渡し、DB(invitations.token_hash)には
 * SHA-256(hex)のみ保存する(DBが読み出されても有効なトークンを復元できない)。
 * APIキーと異なりプレフィックスは付けない(招待は漏洩検出のための恒久的な識別性より、
 * URLに埋め込んで一度きり使い切る短命トークンであることを優先した)。
 */

import { sha256Hex } from "./api-key.js";

/** 7日(分単位)。docs/requirements.md §認証の「7日期限」。 */
export const INVITATION_TTL_MINUTES = 7 * 24 * 60;

const TOKEN_BYTES = 32;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export interface GeneratedInvitationToken {
  /** クライアント(招待リンク)にのみ渡すトークン。DB には保存しない */
  token: string;
  /** DB に保存する SHA-256(hex) */
  hash: string;
}

/** 新しい招待トークンを生成する。 */
export async function generateInvitationToken(): Promise<GeneratedInvitationToken> {
  const raw = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(raw);
  const token = base64url(raw);
  const hash = await sha256Hex(token);
  return { token, hash };
}
