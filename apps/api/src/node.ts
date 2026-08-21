import { serve } from "@hono/node-server";
import { migrateDb } from "@kizami/db";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

// Secure Cookie は既定 ON。http のみの環境では COOKIE_SECURE=false で無効化
// (localhost は secure context 扱いのため開発時も既定のままでよい)
const secureCookies = process.env.COOKIE_SECURE !== "false";

// 開発時は Waku dev サーバー(別オリジン)からの呼び出しを許可する
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

const { db } = await migrateDb({ url: databaseUrl });
const app = createApp({ db, secureCookies, corsOrigin });

serve({ fetch: app.fetch, port });
console.log(`kizami api listening on :${port}`);
