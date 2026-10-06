/**
 * workerd レグのテスト用の偽の SMTP サーバー(**Node 側**で動く。apps/api/vitest.workers.config.ts が起動する)。
 *
 * workerd の中のテスト(test/workers/mail.test.ts)が、配備するのと同じ `cloudflare:sockets` の接続
 * (src/lib/workers-smtp-socket.ts)で実際に TCP をつなぎ、SMTP で1通送れることを確かめるための相手。
 * 平文・認証なし(STARTTLS も AUTH も広告しない)— TLS の証明書を用意せずに済む範囲で、ソケットの読み書きと
 * SMTP の往復を本物の TCP で通す。TLS・AUTH の分岐は Node の test/smtp-client.test.ts が偽の接続で見る。
 *
 * 受けたメールは同じプロセスの HTTP(`inboxUrl`)で JSON として読める(GET = 一覧、DELETE = 空にする)。
 * どちらのサーバーも unref するので、テストの終了を妨げない。
 */

import http from "node:http";
import net from "node:net";

export interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
}

export async function startFakeSmtpServer(): Promise<{ smtpPort: number; inboxUrl: string }> {
  const inbox: ReceivedMail[] = [];

  const smtp = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;
    let current: ReceivedMail = { from: "", to: [], data: "" };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 fake-smtp.test ESMTP");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          current.data = buffer.slice(0, end + 2);
          buffer = buffer.slice(end + 5);
          inData = false;
          inbox.push(current);
          current = { from: "", to: [], data: "" };
          reply("250 2.0.0 queued");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const verb = (line.split(/[ :]/)[0] ?? "").toUpperCase();
        if (verb === "EHLO") reply("250-fake-smtp.test\r\n250 8BITMIME");
        else if (verb === "HELO") reply("250 fake-smtp.test");
        else if (verb === "MAIL") {
          current.from = line;
          reply("250 2.1.0 ok");
        } else if (verb === "RCPT") {
          current.to.push(line);
          reply("250 2.1.5 ok");
        } else if (verb === "DATA") {
          inData = true;
          reply("354 go ahead");
        } else if (verb === "QUIT") {
          reply("221 bye");
          socket.end();
        } else reply("502 5.5.2 not implemented");
      }
    });
    socket.on("error", () => undefined);
  });

  const inboxServer = http.createServer((req, res) => {
    if (req.method === "DELETE") inbox.length = 0;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(inbox));
  });

  const listen = (server: net.Server) =>
    new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        resolve((server.address() as net.AddressInfo).port);
      });
    });
  const smtpPort = await listen(smtp);
  const inboxPort = await listen(inboxServer);
  return { smtpPort, inboxUrl: `http://127.0.0.1:${inboxPort}/` };
}
