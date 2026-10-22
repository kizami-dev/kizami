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
 * **どちらも明示されていなければ空配列**(app.ts はこのとき下の sameOriginPostGuard を代わりに掛ける)。
 * node.ts の `CORS_ORIGIN` は未設定でも開発用の既定値(localhost:3000)を持つが、
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

/**
 * 許可するオリジンが宣言されていない配備(`APP_BASE_URL` も `CORS_ORIGIN` も未設定)向けの代わりのガード
 * (2026-10-22、セキュリティレビュー Low「APP_BASE_URL 未設定時のログイン CSRF」)。
 *
 * 以前はこの場合ガードを一切掛けておらず、他サイトのフォーム(`enctype="text/plain"` で JSON 風の本文を
 * 作れる)からログインを POST させ、被害者のブラウザを攻撃者のアカウントでログインさせられた。
 * 宣言が無くても「リクエストが届いた自分自身のオリジン」は分かるので、それを許可オリジンとして扱う:
 *
 * - Origin があれば、そのホストがリクエストの Host(または前段プロキシが付けた X-Forwarded-Host)と
 *   一致するか、`extraOrigins`(CORS を許しているオリジン。開発の web → api の別ポート)に入っていれば通す。
 *   それ以外は 403。X-Forwarded-Host を見てよいのは、ブラウザがクロスサイトの POST にこのヘッダを
 *   プリフライト無しで付けられないため(攻撃者のページからは偽れない)
 * - Origin が無く `Sec-Fetch-Site: cross-site` なら 403(ブラウザが Origin を落とした場合の保険)。
 *   Origin も Sec-Fetch-Site も無いのは curl 等の非ブラウザなので通す(jsonPostGuard と同じ)
 * - `Content-Type: application/json` でなければ 415(jsonPostGuard と同じ)
 */
export function sameOriginPostGuard(extraOrigins: readonly string[] = []): MiddlewareHandler {
  const extra = new Set(authPostAllowedOrigins(extraOrigins));
  return async (c, next) => {
    if (c.req.method === "POST") {
      const origin = c.req.header("origin");
      if (origin !== undefined) {
        if (!extra.has(origin) && !isRequestHostOrigin(origin, c.req.url, c.req.header("x-forwarded-host"))) {
          return c.json({ error: "forbidden_origin" }, 403);
        }
      } else if ((c.req.header("sec-fetch-site") ?? "").toLowerCase() === "cross-site") {
        return c.json({ error: "forbidden_origin" }, 403);
      }
      if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return c.json({ error: "unsupported_media_type" }, 415);
      }
    }
    await next();
  };
}

/** Origin のホスト(host:port)が、リクエストの宛先ホストか X-Forwarded-Host の先頭と一致するか。 */
function isRequestHostOrigin(origin: string, requestUrl: string, forwardedHost: string | undefined): boolean {
  let originHost: string;
  try {
    const parsed = new URL(origin);
    if (parsed.origin === "null") return false;
    originHost = parsed.host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [new URL(requestUrl).host.toLowerCase()];
  const forwarded = forwardedHost?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) hosts.push(forwarded);
  return hosts.includes(originHost);
}
