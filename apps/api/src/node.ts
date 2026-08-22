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

const { db } = await migrateDb({ url: databaseUrl });
const app = createApp({ db, secureCookies, corsOrigin, notify: { smtpSendFn: nodemailerSendFn }, encryptor });

// リバースプロキシ/トンネルのパス振り分け(kizami.example.com/api/* → ここ)を
// パス書き換えなしで受けられるよう、/api プレフィクス付きでも同じアプリを提供する
const root = new Hono();
root.route("/api", app);
root.route("/", app);

serve({ fetch: root.fetch, port });
console.log(`kizami api listening on :${port}`);
