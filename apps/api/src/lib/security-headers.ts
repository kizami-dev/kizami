/**
 * API の応答に付けるセキュリティヘッダ(2026-10-22、セキュリティレビュー M4)。
 *
 * 配備の形(Node + Caddy / Cloudflare Tunnel 直結 / k8s / Cloudflare Workers)によらず同じヘッダが付くよう、
 * リバースプロキシではなく **アプリ(createApp)で付ける**。node.ts / workers.ts のルート(`/api` を
 * 被せる外側の Hono)にも同じミドルウェアを掛け、どのルートにも当たらない 404 にも付ける。
 *
 * API は JSON(と CSV・ZIP・Prometheus のテキスト)しか返さず、HTML を返す経路が無い
 * (OIDC のコールバックも Web へ 302 で戻すだけ)。そのため CSP は「何も読み込ませない・どこにも
 * 埋め込ませない」最も厳しい `default-src 'none'; frame-ancestors 'none'` に固定する。
 * 将来 API が HTML を返す経路を足すときは、その経路だけ CSP を上書きすること。
 *
 * HSTS は HTTPS で届いたリクエストにだけ付ける(isHttpsRequest)。includeSubDomains / preload は
 * 付けない — 運用ドメインに KIZAMI 以外のサブドメインがあり得るため(bktsk.com 等)。
 */

import type { Context, MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

/** HTTPS の応答に付ける HSTS(1年。includeSubDomains / preload は付けない — 冒頭のコメント)。 */
export const HSTS_VALUE = "max-age=31536000";

/** API の CSP。JSON 等しか返さないので何も許可しない。 */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * このリクエストが HTTPS で届いたか。
 *
 * - URL のスキームが https(Workers・TLS 終端したアプリ)
 * - `X-Forwarded-Proto` の先頭が https(cloudflared・一般的なリバースプロキシ)
 * - `CF-Visitor` の scheme が https(Cloudflare のエッジが付ける。途中の Caddy 等が
 *   X-Forwarded-Proto を自分の接続(http)で書き換えても残る)
 * - 配備者が宣言したベース URL(APP_BASE_URL)が https
 *
 * ヘッダは偽装できるが、HTTP で届いた HSTS はブラウザが無視する(RFC 6797 §8.1)ので害は無い。
 */
export function isHttpsRequest(req: Request, declaredBaseUrl?: string): boolean {
  if (declaredBaseUrl !== undefined && declaredBaseUrl.startsWith("https://")) return true;
  if (new URL(req.url).protocol === "https:") return true;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return true;
  const cfVisitor = req.headers.get("cf-visitor");
  if (cfVisitor !== null && /"scheme"\s*:\s*"https"/i.test(cfVisitor)) return true;
  return false;
}

export interface ApiSecurityHeadersOptions {
  /** 配備者が宣言した Web のベース URL(APP_BASE_URL / CORS_ORIGIN)。https なら常に HSTS を付ける */
  appBaseUrl?: string;
}

/**
 * API 用のセキュリティヘッダのミドルウェア。Hono の secureHeaders に、KIZAMI の方針
 * (X-Frame-Options: DENY・Referrer-Policy: no-referrer・固定の CSP・HTTPS のときだけ HSTS)を載せる。
 */
export function apiSecurityHeaders(options: ApiSecurityHeadersOptions = {}): MiddlewareHandler {
  const base = secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    xFrameOptions: "DENY",
    xContentTypeOptions: true,
    referrerPolicy: "no-referrer",
    // HSTS は下で HTTPS のときだけ付ける(secureHeaders の既定は includeSubDomains 付きで常に付ける)
    strictTransportSecurity: false,
    // ブラウザ以外(打刻 API・Slack・MCP)も叩くので、ブラウザ向けの他の既定ヘッダは secureHeaders のまま
  });
  return async (c: Context, next) => {
    await base(c, async () => {
      await next();
    });
    if (isHttpsRequest(c.req.raw, options.appBaseUrl)) {
      c.res.headers.set("Strict-Transport-Security", HSTS_VALUE);
    }
  };
}
