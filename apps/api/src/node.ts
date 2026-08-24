import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { migrateDb } from "@kizami/db";
import { createApp } from "./app.js";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { nodemailerSendFn } from "./lib/smtp.js";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

// Secure Cookie は既定 ON。http のみの環境では COOKIE_SECURE=false で無効化
// (localhost は secure context 扱いのため開発時も既定のままでよい)
const secureCookies = process.env.COOKIE_SECURE !== "false";

// 開発時は Waku dev サーバー(別オリジン)からの呼び出しを許可する
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

// 秘密情報(webhookUrl・smtpPassword)の暗号化に使う。未設定/不正なら null
// (settings.ts の PUT が秘密情報の保存を 503 で拒否する — 平文フォールバックはしない)。
const encryptor = buildEncryptorFromEnv();

// レート制限のクライアント IP 判定に CF-Connecting-IP / X-Forwarded-For を使ってよいか。
// 既定 ON(本番は Cloudflare Tunnel → Caddy → api の経路が保証されており、エッジが
// CF-Connecting-IP を必ず上書きするため信頼できる)。api を直接インターネットへ晒す配備では
// TRUST_PROXY=false にすること(ヘッダを偽装するだけでレート制限を回避できてしまうため)。
// 判断の背景は apps/api/src/lib/client-ip.ts 冒頭のコメント。
const trustProxy = process.env.TRUST_PROXY !== "false";

// OIDC(SSO)ログイン(docs/design/sso-oidc.md)。
// - APP_BASE_URL: 成功時 "/" ・失敗時 "/login?error=..." へ戻す Web アプリのベース URL。
//   本番は api と web を同一オリジンで配信する前提なので未設定(=相対パス)でよい。
//   開発時は web(:3000)と api(:3001)が別オリジンなので、CORS_ORIGIN を明示していれば
//   それを流用する(未設定なら相対パスのまま = 同一オリジン配信とみなす)。
// - OIDC_REDIRECT_URI: IdP に登録した戻り先。未設定ならリクエスト URL から導出する
//   (前段でホスト名を書き換えている配備では明示すること)。
const appBaseUrl = process.env.APP_BASE_URL ?? process.env.CORS_ORIGIN;
const oidcRedirectUri = process.env.OIDC_REDIRECT_URI;

const { db } = await migrateDb({ url: databaseUrl });
const app = createApp({
  db,
  secureCookies,
  corsOrigin,
  notify: { smtpSendFn: nodemailerSendFn },
  encryptor,
  trustProxy,
  oidc: {
    ...(appBaseUrl !== undefined ? { appBaseUrl } : {}),
    ...(oidcRedirectUri !== undefined ? { redirectUri: oidcRedirectUri } : {}),
  },
});

// リバースプロキシ/トンネルのパス振り分け(kizami.example.com/api/* → ここ)を
// パス書き換えなしで受けられるよう、/api プレフィクス付きでも同じアプリを提供する
const root = new Hono();
root.route("/api", app);
root.route("/", app);

serve({ fetch: root.fetch, port });
console.log(`kizami api listening on :${port}`);
