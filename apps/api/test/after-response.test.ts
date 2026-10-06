/**
 * 応答の後の処理を Workers では waitUntil に載せる(src/lib/after-response.ts)。Node(ExecutionContext が無い)では
 * 従来どおり投げっぱなし。
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { runAfterResponse, waitUntilOf } from "../src/lib/after-response.js";

function appWith(task: () => Promise<void>) {
  const app = new Hono();
  app.get("/", (c) => {
    runAfterResponse(c, task);
    return c.json({ hasWaitUntil: waitUntilOf(c) !== null });
  });
  return app;
}

describe("runAfterResponse", () => {
  it("ExecutionContext が無ければ(Node)次のマクロタスクで投げっぱなし", async () => {
    let ran = false;
    const res = await appWith(async () => {
      ran = true;
    }).request("/");
    expect(await res.json()).toEqual({ hasWaitUntil: false });
    expect(ran).toBe(false); // 応答の時点ではまだ始まっていない
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ran).toBe(true);
  });

  it("ExecutionContext があれば(Workers)waitUntil に載せ、応答の後に始める", async () => {
    let ran = false;
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p), passThroughOnException: () => undefined, props: {} };
    const res = await appWith(async () => {
      ran = true;
    }).fetch(new Request("http://x/"), {}, ctx);
    expect(await res.json()).toEqual({ hasWaitUntil: true });
    expect(waited).toHaveLength(1);
    expect(ran).toBe(false);
    await waited[0];
    expect(ran).toBe(true);
  });
});
