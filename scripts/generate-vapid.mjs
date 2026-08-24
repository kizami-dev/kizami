/**
 * VAPID 鍵ペアを1組生成して表示する(ブラウザプッシュ通知の運用者向けセットアップ)。
 *
 *   pnpm generate-vapid
 *
 * 出力した3行を api / worker 両方の環境変数に設定する(deploy/k8s/README.md、
 * deploy/compose/compose.yaml)。`npx web-push generate-vapid-keys` と同じ形式
 * (base64url・パディング無し。公開鍵 65 バイトの非圧縮 EC 点、秘密鍵 32 バイトのスカラー)を
 * 出すので、既に web-push で作った鍵があればそのまま使える。
 *
 * 実装は WebCrypto のみ(node:crypto 不使用)。KIZAMI の Web Push 実装本体
 * (packages/notify/src/web-push.ts)がランタイム非依存である方針に合わせている。
 *
 * 鍵の性質(README にも書くこと):
 * - 秘密鍵は他の秘密情報と同じ扱い(Secret 経由で渡す・リポジトリに置かない)
 * - **鍵を変えると既存の購読はすべて無効になる**。ブラウザは購読時の公開鍵に紐づけて
 *   エンドポイントを発行するため、鍵を入れ替えた場合は全員に再購読してもらう必要がある
 *   (プッシュサービスが 403/410 を返し、KIZAMI 側は failed_at を立てて静かに止まる)。
 */

function base64UrlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

// 公開鍵は "raw"(非圧縮 EC 点 65 バイト)で取り出せる。秘密鍵は raw エクスポート不可なので
// JWK の `d`(base64url の 32 バイトスカラー)をそのまま使う。
const publicKey = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)));
const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
const privateKey = jwk.d;

if (base64UrlDecode(privateKey).length !== 32) {
  throw new Error(`generate-vapid: unexpected private key length (${base64UrlDecode(privateKey).length} bytes)`);
}

console.log("# KIZAMI ブラウザプッシュ通知(Web Push)用の VAPID 鍵");
console.log("# api / worker の両方に同じ値を設定してください。VAPID_SUBJECT は運用者の連絡先に置き換えること。");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:admin@example.com");
