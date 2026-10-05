/**
 * 未認証の POST に掛けるログイン CSRF / フォーム自動送信対策(routes/signup.ts、routes/password-resets.ts の
 * 本人用再設定、および app.ts がログイン・2FA 第2段階・招待受諾・パスワード再設定の使用・OIDC の開始に
 * 掛ける)。
 *
 * - `Content-Type: application/json` でなければ 415(クロスオリジンからの JSON POST はプリフライトが
 *   要るため、他サイトのフォームの自動送信では送れない)
 * - Origin ヘッダがあって許可するオリジンのどれとも一致しなければ 403(ブラウザはクロスオリジンの
 *   POST に必ず Origin を付ける。無いのは curl 等の非ブラウザ)
 *
 * 判断の背景は routes/signup.ts 冒頭「ログイン CSRF 対策」。GET には何もしない。
 *
 * 許可するオリジンは1つ(signup / 再設定の `appBaseUrl`)でも複数(app.ts の認証系: `APP_BASE_URL` と
 * `CORS_ORIGIN`)でも渡せる。複数にしているのは、本番(同一オリジン配信)では `APP_BASE_URL`、
 * 開発(web と api が別オリジン)では `CORS_ORIGIN` がブラウザの Origin になるため。
 */

import type { MiddlewareHandler } from "hono";

export function jsonPostGuard(allowed: string | readonly string[]): MiddlewareHandler {
  const allowedOrigins = new Set((typeof allowed === "string" ? [allowed] : allowed).map((url) => new URL(url).origin));
  return async (c, next) => {
    if (c.req.method === "POST") {
      const origin = c.req.header("origin");
      if (origin !== undefined && !allowedOrigins.has(origin)) {
        return c.json({ error: "forbidden_origin" }, 403);
      }
      if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return c.json({ error: "unsupported_media_type" }, 415);
      }
    }
    await next();
  };
}

/**
 * 環境変数(`APP_BASE_URL` と `CORS_ORIGIN`)から、認証系の未認証 POST に許可するオリジンの一覧を作る。
 *
 * **どちらも明示されていなければ空配列 = ガードを掛けない**(開発・テスト・オリジンを宣言していない
 * 配備は従来どおり)。node.ts の `CORS_ORIGIN` は未設定でも開発用の既定値(localhost:3000)を持つが、
 * ここに渡すのは**明示された値だけ**にする(既定値を許可リストに入れると、同一オリジン配信で
 * どちらも未設定の本番が、自分自身の Origin を弾いてしまうため)。空文字は未設定扱い(compose が
 * 未設定の変数を空文字で渡してくる)。URL として読めない値は無視して警告する(起動は止めない)。
 */
export function authPostAllowedOrigins(values: ReadonlyArray<string | undefined>): string[] {
  const origins: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    try {
      const origin = new URL(trimmed).origin;
      if (origin !== "null" && !origins.includes(origin)) origins.push(origin);
    } catch {
      console.warn(`[origin-guard] ignoring an unparsable origin setting: ${trimmed}`);
    }
  }
  return origins;
}
