/**
 * クライアント IP の判定(レート制限のキーに使う、2026-08-24 追加)。
 *
 * ## なぜヘッダを信じてよいのか、そしてどこまで信じてはいけないのか
 *
 * KIZAMI の本番配備は **Cloudflare Tunnel(cloudflared)→ Caddy → api** の順に通る。
 * この経路では:
 *
 * - `CF-Connecting-IP` は Cloudflare のエッジが**必ず上書きして**付ける。クライアントが
 *   偽装して送っても、エッジで実 IP に置き換わるため信頼できる。
 * - `X-Forwarded-For` は「エッジが付けた値 + 途中のプロキシが追記した値」の並びで、
 *   先頭が最も原始的なクライアント側の申告になる。Cloudflare 経由なら先頭は実 IP だが、
 *   一般には**クライアントが自由に捏造できるヘッダ**である。
 *
 * つまりこれらのヘッダが信用できるのは「アプリへの到達経路が Cloudflare Tunnel に限られて
 * いる」という配備上の前提があるからに過ぎない。api を直接インターネットへ晒す配備
 * (プロキシ無し、あるいは信用できないプロキシの背後)では、攻撃者が
 * `CF-Connecting-IP: 1.2.3.4` を毎回変えて送るだけでレート制限を無効化できてしまう。
 *
 * そのため **`TRUST_PROXY=false`(node.ts が読む環境変数)を用意した**。false のときは
 * ヘッダを一切見ず、TCP のソースアドレスだけを使う。直接公開する配備では必ず false にすること。
 *
 * ## ソースアドレスの取り方
 *
 * app.ts はランタイム非依存(Node / Cloudflare Workers 双方から使う)なので、
 * `@hono/node-server` の `getConnInfo` を直接 import しない。代わりに `c.env` を
 * ダックタイピングで覗く(Node アダプタでは `c.env.incoming` が Node の IncomingMessage)。
 * 取得できない環境(vitest から `app.request()` を直接叩く単体テスト等)では "unknown" を返す
 * ため、その場合すべてのリクエストが同じキーに落ちる点に注意
 * (テストで IP 別の挙動を見るときは trustProxy を有効にしてヘッダで指定する)。
 *
 * **Cloudflare Workers では `c.env` はバインディング(D1 等)のオブジェクト**で `incoming` を
 * 持たない。そのためソースアドレスは常に取れず "unknown" に落ちるが、Workers の前段は必ず
 * Cloudflare のエッジで `CF-Connecting-IP` が付くため、`trustProxy: true`(既定)の経路で
 * 正しい IP が得られる。逆に Workers で `TRUST_PROXY=false` にすると全リクエストが
 * 1つのバケツに落ちるので指定しないこと(docs/design/workers-d1.md)。
 */

import type { Context } from "hono";

/** IP が取れなかった場合のキー。全リクエストが1つのバケツに落ちる(安全側)。 */
export const UNKNOWN_CLIENT_IP = "unknown";

interface NodeAdapterEnv {
  incoming?: { socket?: { remoteAddress?: string | null } | null } | null;
}

/** Node アダプタ(@hono/node-server)経由なら TCP のソースアドレスを取り出す。 */
function socketAddress(c: Context): string | null {
  const env = c.env as NodeAdapterEnv | undefined;
  const address = env?.incoming?.socket?.remoteAddress;
  return typeof address === "string" && address !== "" ? address : null;
}

/**
 * レート制限のキーに使うクライアント IP を求める。
 *
 * @param trustProxy 前段プロキシ(Cloudflare Tunnel)を信頼してヘッダを見るか。
 *   false ならヘッダを完全に無視し、ソースアドレスのみを使う。
 */
export function getClientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const cfConnectingIp = c.req.header("cf-connecting-ip")?.trim();
    if (cfConnectingIp) return cfConnectingIp;

    // X-Forwarded-For は "client, proxy1, proxy2" の並び。先頭がクライアント側の申告。
    const forwardedFor = c.req.header("x-forwarded-for");
    const firstHop = forwardedFor?.split(",")[0]?.trim();
    if (firstHop) return firstHop;
  }
  return socketAddress(c) ?? UNKNOWN_CLIENT_IP;
}
