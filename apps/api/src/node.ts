import { serve } from "@hono/node-server";
import { migrateDb } from "@kizami/db";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

const { db } = await migrateDb({ url: databaseUrl });
const app = createApp({ db });

serve({ fetch: app.fetch, port });
console.log(`kizami api listening on :${port}`);
