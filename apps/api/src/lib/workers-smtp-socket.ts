/**
 * テナントの SMTP の、Cloudflare Workers での TCP 接続(`cloudflare:sockets` の `connect()`、2026-10-07)。
 *
 * SMTP の手順そのものは lib/smtp-client.ts(ランタイム非依存)。ここは `SmtpConnector` を workerd のソケットで
 * 実装するだけ。**`cloudflare:sockets` は workerd にしか無いので、このファイルを import するのは workers.ts だけ**
 * (Node の経路・テストからは読まない。Node は nodemailer — lib/smtp.ts)。
 *
 * - 465 は `secureTransport: "on"`(最初から TLS)、それ以外は `"starttls"`(平文で始め、STARTTLS の 220 の後に
 *   `startTls()` で昇格)。証明書は接続先のホスト名で検証される(Workers の既定)
 * - **送信ポート 25 は Workers が塞いでいる**(接続できない)。分かりやすいエラーにするため、接続の前に断る
 *   (`WORKERS_SMTP_BLOCKED_PORTS`。workers.ts の checkTarget)
 * - Workers の外向きソケットはプライベートアドレス(RFC 1918・ループバック等)へ届かない(Cloudflare の網の外へ
 *   出る)。SSRF の扱いは lib/outbound-hostname-guard.ts と docs/design/workers-d1.md「メール」
 */

import { connect, type Socket } from "cloudflare:sockets";
import { SmtpError, type SmtpConnection, type SmtpConnector } from "./smtp-client.js";

/** Workers からつなげない送信ポート(25 は Cloudflare が塞いでいる)。 */
export const WORKERS_SMTP_BLOCKED_PORTS: ReadonlySet<number> = new Set([25]);

/** 接続の確立を待つ上限(ミリ秒)。 */
const CONNECT_TIMEOUT_MS = 15_000;

function wrap(socket: Socket): SmtpConnection {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  return {
    async read() {
      const { value, done } = await reader.read();
      if (done) return null;
      return value ?? new Uint8Array();
    },
    write: (data) => writer.write(data),
    async startTls() {
      // 読み書きのロックを外してから昇格する(昇格後は新しいソケットだけを使う)
      reader.releaseLock();
      writer.releaseLock();
      return wrap(socket.startTls());
    },
    async close() {
      try {
        await socket.close();
      } catch {
        // 既に閉じている
      }
    },
  };
}

export const workersSmtpConnector: SmtpConnector = async ({ host, port, security }) => {
  const socket = connect({ hostname: host, port }, { secureTransport: security === "implicit-tls" ? "on" : "starttls", allowHalfOpen: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SmtpError("connect", `could not connect within ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    await socket.close().catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return wrap(socket);
};
