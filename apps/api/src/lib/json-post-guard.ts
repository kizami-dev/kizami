/**
 * 未認証の POST に掛けるログイン CSRF / フォーム自動送信対策(routes/signup.ts と
 * routes/password-resets.ts の本人用再設定が共有する)。
 *
 * - `Content-Type: application/json` でなければ 415(クロスオリジンからの JSON POST はプリフライトが
 *   要るため、他サイトのフォームの自動送信では送れない)
 * - Origin ヘッダがあって `appBaseUrl` のオリジンと一致しなければ 403(ブラウザはクロスオリジンの
 *   POST に必ず Origin を付ける。無いのは curl 等の非ブラウザ)
 *
 * 判断の背景は routes/signup.ts 冒頭「ログイン CSRF 対策」。GET には何もしない。
 */

import type { MiddlewareHandler } from "hono";

export function jsonPostGuard(appBaseUrl: string): MiddlewareHandler {
  const allowedOrigin = new URL(appBaseUrl).origin;
  return async (c, next) => {
    if (c.req.method === "POST") {
      const origin = c.req.header("origin");
      if (origin !== undefined && origin !== allowedOrigin) {
        return c.json({ error: "forbidden_origin" }, 403);
      }
      if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return c.json({ error: "unsupported_media_type" }, 415);
      }
    }
    await next();
  };
}
