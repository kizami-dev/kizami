import { Hono } from "hono";

/**
 * ランタイム非依存の Hono アプリ本体。
 * Node からは node.ts、Workers からは workers.ts がこれを共有する(要件 §8)。
 */
export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, name: "kizami" }));
