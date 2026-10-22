/**
 * Web(waku start)の応答に付けるセキュリティヘッダ(2026-10-22、セキュリティレビュー M4)。
 * 付けているのは src/waku.server.tsx(Waku のサーバーエントリ)。ここは文字列を組み立てる純粋な関数だけを置き、
 * apps/web/test/security-headers.test.ts から検査する。
 *
 * ## インラインスクリプトの扱い(nonce ではなくハッシュ)
 *
 * ほとんどのページは `render: "static"`(ビルド時に HTML を生成し、dist/public から静的配信)で、
 * HTML は全員に同じバイト列が返る。nonce はリクエストごとに変えなければ意味が無いので使えない。
 * 一方、HTML にはインラインスクリプトが必ず入る:
 *
 * - pages/_layout.tsx の2本(viewport メタの正規化・テーマの FOUC 防止)
 * - Waku が入れる2種類(プリロード失敗時の再読み込み・RSC のペイロード `self.__FLIGHT_DATA`)
 *
 * RSC のペイロードはページごとに中身が違うので、ビルド時の固定ハッシュ表も作れない。そこで
 * **HTML の応答ごとに本文を読み、中のインラインスクリプトの SHA-256 を `script-src` に並べる**
 * (inlineScriptHashes)。静的ページは十数 KB、動的ページ(招待・再設定・サインアップ確認)も小さいので、
 * 本文を読み切るコスト(ストリーミングが効かなくなること)は許容する。`'unsafe-inline'` は使わない。
 *
 * ## 許可している外部オリジン
 *
 * - Google Fonts(pages/_layout.tsx): スタイルシート fonts.googleapis.com・フォント fonts.gstatic.com
 * - Cloudflare Turnstile(components/TurnstileWidget.tsx。サイトキーは実行時に API から届くので常に許可):
 *   スクリプトと iframe の challenges.cloudflare.com
 * - API(lib/api.ts の WAKU_PUBLIC_API_URL): 同一オリジンの `/api`(既定の配備)なら `'self'` で足りる。
 *   別オリジンの URL でビルドしたときはそのオリジンを connect-src に足す(apiOrigin)
 *
 * connect-src に Google Fonts と Turnstile も入れているのは Service Worker(public/sw.js)のため:
 * SW は静的アセット(フォント・スタイルシート・スクリプト)を自分で fetch() し直すので、sw.js の応答に
 * 付いた CSP の connect-src でそれらが許されていないと、SW 経由の読み込みが失敗する。
 */

/** HTTPS の応答に付ける HSTS(1年。includeSubDomains / preload は付けない — 運用ドメインに別のサブドメインがある)。 */
export const HSTS_VALUE = "max-age=31536000";

export const GOOGLE_FONTS_STYLES = "https://fonts.googleapis.com";
export const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** 打刻の位置情報(lib/geolocation.ts)だけは自オリジンで使う。カメラ・マイク等は使わない。 */
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(self), payment=(), usb=()";

/**
 * WAKU_PUBLIC_API_URL から、connect-src に足すべき API のオリジンを返す。
 * 相対パス(既定の `/api`)や同一オリジンなら null(`'self'` で足りる)。
 */
export function apiOrigin(apiUrl: string | undefined): string | null {
  if (apiUrl === undefined || apiUrl === "" || apiUrl.startsWith("/")) return null;
  try {
    return new URL(apiUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Web の CSP を組み立てる。`scriptHashes` は HTML 中のインラインスクリプトの
 * `'sha256-...'`(inlineScriptHashes の戻り値)。HTML 以外の応答では空でよい。
 */
export function buildWebCsp(options: { scriptHashes?: string[]; apiOrigin?: string | null } = {}): string {
  const scriptHashes = options.scriptHashes ?? [];
  const connect = ["'self'"];
  if (options.apiOrigin) connect.push(options.apiOrigin);
  connect.push(GOOGLE_FONTS_STYLES, GOOGLE_FONTS_FILES, TURNSTILE_ORIGIN);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...scriptHashes, TURNSTILE_ORIGIN]],
    ["style-src", ["'self'", GOOGLE_FONTS_STYLES]],
    ["font-src", ["'self'", GOOGLE_FONTS_FILES]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["connect-src", connect],
    ["frame-src", [TURNSTILE_ORIGIN]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** `src` を持たない(= インラインの)`<script>` の中身を、HTML に現れた順に返す。 */
export function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(re)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attrs) || body === "") continue;
    scripts.push(body);
  }
  return scripts;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** HTML 中のインラインスクリプトの CSP ハッシュ(`'sha256-...'`、重複なし)を返す。 */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  const hashes = new Set<string>();
  const encoder = new TextEncoder();
  for (const script of inlineScripts(html)) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(script));
    hashes.add(`'sha256-${toBase64(new Uint8Array(digest))}'`);
  }
  return [...hashes];
}

/**
 * このリクエストが HTTPS で届いたか(apps/api/src/lib/security-headers.ts の isHttpsRequest と同じ判定)。
 * URL のスキーム、`X-Forwarded-Proto` の先頭(cloudflared 等)、`CF-Visitor` の scheme(Cloudflare のエッジ。
 * 途中の Caddy が X-Forwarded-Proto を http で書き換えても残る)のどれかが https なら真。
 * ヘッダは偽装できるが、HTTP で届いた HSTS はブラウザが無視するので害は無い。
 */
export function isHttpsRequest(req: Request): boolean {
  if (new URL(req.url).protocol === "https:") return true;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return true;
  const cfVisitor = req.headers.get("cf-visitor");
  return cfVisitor !== null && /"scheme"\s*:\s*"https"/i.test(cfVisitor);
}

/**
 * Waku の応答にセキュリティヘッダを付けた応答を返す。HTML なら本文を読んでインラインスクリプトの
 * ハッシュを CSP に入れる。`csp: false` は開発サーバー(Vite の HMR がインラインスクリプトと
 * WebSocket を使う)用で、CSP 以外のヘッダは付ける。
 */
export async function withSecurityHeaders(
  req: Request,
  res: Response,
  options: { csp?: boolean; apiOrigin?: string | null } = {},
): Promise<Response> {
  const { csp = true } = options;
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  if (isHttpsRequest(req)) headers.set("Strict-Transport-Security", HSTS_VALUE);

  const isHtml = (headers.get("content-type") ?? "").toLowerCase().startsWith("text/html");
  let body: BodyInit | null = res.body;
  const apiOriginValue = options.apiOrigin ?? null;
  if (csp && res.status !== 304) {
    // 304 には付けない: ブラウザはキャッシュ済みの応答のヘッダを 304 のヘッダで上書きするため、
    // ハッシュ無しの CSP が HTML の CSP を潰してしまう
    if (!isHtml) {
      headers.set("Content-Security-Policy", buildWebCsp({ apiOrigin: apiOriginValue }));
    } else if (res.body !== null && !headers.has("content-encoding")) {
      const html = await res.text();
      body = html;
      headers.delete("content-length");
      headers.set("Content-Security-Policy", buildWebCsp({ scriptHashes: await inlineScriptHashes(html), apiOrigin: apiOriginValue }));
    }
    // 圧縮済みの HTML は本文を読めない(ハッシュを出せない)ので CSP を付けない。Waku の Node アダプタは
    // 圧縮しないのでこの経路には来ない — 前段で圧縮するなら、CSP より後(外側)で掛けること
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}
