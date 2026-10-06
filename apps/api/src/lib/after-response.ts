/**
 * 応答を返した後も続く処理(撃ちっ放しのメール送信など)を、ランタイムに合わせて生かしておく(2026-10-07)。
 *
 * Node はプロセスが生きている限り、応答の後に残った Promise もそのまま走り切る。Cloudflare Workers は
 * **応答を返すと、`ctx.waitUntil()` に登録していない処理を打ち切りうる**。そこで Workers では Hono の
 * `c.executionCtx.waitUntil()` に登録する。Node(@hono/node-server)には ExecutionContext が無く、
 * `c.executionCtx` の読み出しが投げるので、そのときは何もしない(= 従来どおり)。
 *
 * 使う場所: 本人用のパスワード再設定(応答の後に探索・発行・送信)と、退会の申請を受け付けたメール。
 * どちらも Workers では D1 のトランザクション対応まで無効だが(workers.ts の D1_TRANSACTIONS_SUPPORTED)、
 * 有効になった時点で応答の後のメールが打ち切られないよう、先に通しておく。
 */

import type { Context } from "hono";

/** Workers なら `waitUntil`、Node なら null。 */
export function waitUntilOf(c: Context): ((promise: Promise<unknown>) => void) | null {
  let ctx: { waitUntil?: unknown } | undefined;
  try {
    ctx = c.executionCtx as { waitUntil?: unknown } | undefined;
  } catch {
    // Node: "This context has no ExecutionContext"
    return null;
  }
  if (ctx === undefined || typeof ctx.waitUntil !== "function") return null;
  const waitUntil = ctx.waitUntil as (promise: Promise<unknown>) => void;
  return (promise) => waitUntil.call(ctx, promise);
}

/**
 * `task` を応答の後(次のマクロタスク)に始める。Node は従来どおり投げっぱなし、Workers は `waitUntil` に載せる。
 * `task` は自分で失敗を握ること(ここは握らない — Node の従来の挙動を変えないため)。
 */
export function runAfterResponse(c: Context, task: () => Promise<void>): void {
  const waitUntil = waitUntilOf(c);
  if (waitUntil === null) {
    setTimeout(() => void task(), 0);
    return;
  }
  waitUntil(new Promise<void>((resolve) => setTimeout(resolve, 0)).then(task));
}
