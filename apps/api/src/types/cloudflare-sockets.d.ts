/**
 * `cloudflare:sockets`(workerd の TCP ソケット API)の、lib/workers-smtp-socket.ts が使う面だけの宣言。
 *
 * `@cloudflare/workers-types` を型解決に持ち込むと @types/node のグローバル(fetch・Request 等)と衝突するため、
 * 必要な面だけを構造的に宣言する(packages/db/src/d1.ts の D1DatabaseBinding、test/workers/cloudflare-test.d.ts と
 * 同じ判断)。実体は workerd が提供し、Node では import できない(このモジュールを import するのは workers.ts の経路だけ)。
 */
declare module "cloudflare:sockets" {
  export interface SocketAddress {
    hostname: string;
    port: number;
  }

  export interface SocketOptions {
    /** "off" = 平文、"on" = 最初から TLS、"starttls" = 平文で始めて startTls() で昇格できる */
    secureTransport?: "off" | "on" | "starttls";
    allowHalfOpen?: boolean;
  }

  export interface Socket {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    /** 接続が確立したら解決する(失敗なら reject) */
    readonly opened: Promise<unknown>;
    readonly closed: Promise<void>;
    close(): Promise<void>;
    /** `secureTransport: "starttls"` で開いたときだけ使える。TLS に昇格した新しいソケットを返す */
    startTls(options?: { expectedServerHostname?: string }): Socket;
  }

  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket;
}
