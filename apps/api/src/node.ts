import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`kizami api listening on :${port}`);
