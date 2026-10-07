/**
 * Workers のテナント SMTP の状態機械(src/lib/smtp-client.ts)を、偽の接続(台本どおりに答える SMTP サーバー)で検査する。
 *
 * 実際の TCP(`cloudflare:sockets`)を通す確認は workerd レグ(test/workers/mail.test.ts)だが、そこで通るのは
 * **平文・AUTH なしの経路だけ**。465 の暗黙 TLS と STARTTLS(`startTls()` への昇格・昇格後の読み書き・閉じ方)を
 * 実際のソケットで通すテストは無く、手で確かめる(docs/design/workers-d1.md「テナントの SMTP」)。ここでは手順の分岐
 * — 465 の暗黙 TLS / STARTTLS / AUTH PLAIN・LOGIN / 平文の拒否 / HELO への後退 / 応答の分割・複数行 /
 * 失敗の段階 / 時間切れ / 切断 — を見る。
 */

import { describe, expect, it } from "vitest";
import type { NotificationMessage, SmtpChannelConfig } from "@kizami/notify";
import { createSmtpSendFn, SmtpError, type SmtpConnection, type SmtpConnector, type SmtpSecurity } from "../src/lib/smtp-client.js";

interface FakeServerOptions {
  /** EHLO に広告する拡張(既定 STARTTLS と AUTH PLAIN LOGIN) */
  extensions?: string[];
  /** TLS の後の EHLO の拡張(既定 AUTH PLAIN LOGIN) */
  extensionsAfterTls?: string[];
  /** EHLO を 502 で断る(HELO を待つ) */
  rejectEhlo?: boolean;
  /** コマンド(先頭の語)ごとの応答の上書き */
  replies?: Record<string, string>;
  /** 応答を1バイトずつ返す(読み取りの分割の検査) */
  dribble?: boolean;
  /** このコマンドを受けたら何も答えない(時間切れの検査) */
  silentOn?: string;
  /** このコマンドを受けたら切断する */
  closeOn?: string;
  /** STARTTLS の 220 に続けて、TLS の前に余計な応答を混ぜる(平文の注入) */
  injectBeforeTls?: boolean;
}

/** 台本どおりに答える SMTP サーバー(1接続ぶん)。受けたコマンドと DATA の本文を記録する。 */
class FakeSmtpServer {
  readonly commands: string[] = [];
  data = "";
  tls = false;
  security: SmtpSecurity | undefined;
  closed = false;
  startTlsCalls = 0;
  private outbox: Uint8Array[] = [];
  private waiters: Array<(chunk: Uint8Array | null) => void> = [];
  private inbound = "";
  private inData = false;
  private readonly encoder = new TextEncoder();

  constructor(private readonly options: FakeServerOptions = {}) {}

  connector: SmtpConnector = async ({ security }) => {
    this.security = security;
    this.tls = security === "implicit-tls";
    this.reply("220 fake.example.com ESMTP ready");
    return this.connection();
  };

  private connection(): SmtpConnection {
    return {
      read: () => this.read(),
      write: async (bytes) => this.receive(new TextDecoder().decode(bytes)),
      startTls: async () => {
        this.startTlsCalls += 1;
        this.tls = true;
        return this.connection();
      },
      close: async () => {
        this.closed = true;
        this.push(null);
      },
    };
  }

  private read(): Promise<Uint8Array | null> {
    const next = this.outbox.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private push(chunk: Uint8Array | null): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(chunk);
    else if (chunk !== null) this.outbox.push(chunk);
  }

  private reply(text: string): void {
    const bytes = this.encoder.encode(`${text.replace(/\n/g, "\r\n")}\r\n`);
    if (this.options.dribble) for (const b of bytes) this.push(Uint8Array.of(b));
    else this.push(bytes);
  }

  private receive(text: string): void {
    this.inbound += text;
    for (;;) {
      if (this.inData) {
        const end = this.inbound.indexOf("\r\n.\r\n");
        if (end < 0) return;
        this.data = this.inbound.slice(0, end + 2);
        this.inbound = this.inbound.slice(end + 5);
        this.inData = false;
        this.reply(this.options.replies?.["."] ?? "250 2.0.0 queued");
        continue;
      }
      const newline = this.inbound.indexOf("\r\n");
      if (newline < 0) return;
      const line = this.inbound.slice(0, newline);
      this.inbound = this.inbound.slice(newline + 2);
      this.handle(line);
    }
  }

  private handle(line: string): void {
    this.commands.push(line);
    const verb = (line.split(/[ :]/)[0] ?? "").toUpperCase();
    if (this.options.closeOn === verb) {
      this.closed = true;
      this.push(null);
      return;
    }
    if (this.options.silentOn === verb) return;
    const override = this.options.replies?.[verb];
    if (override !== undefined) {
      this.reply(override);
      if (verb === "DATA" && override.startsWith("354")) this.inData = true;
      return;
    }
    switch (verb) {
      case "EHLO": {
        if (this.options.rejectEhlo) return this.reply("502 5.5.2 command not recognized");
        const ext = this.tls ? (this.options.extensionsAfterTls ?? ["AUTH PLAIN LOGIN"]) : (this.options.extensions ?? ["STARTTLS", "AUTH PLAIN LOGIN"]);
        return this.reply(["250-fake.example.com", ...ext.map((e) => `250-${e}`), "250 8BITMIME"].join("\n"));
      }
      case "HELO":
        return this.reply("250 fake.example.com");
      case "STARTTLS":
        return this.reply(this.options.injectBeforeTls ? "220 2.0.0 go ahead\n250 injected" : "220 2.0.0 go ahead");
      case "AUTH":
        if (line.startsWith("AUTH LOGIN")) return this.reply("334 VXNlcm5hbWU6");
        return this.reply("235 2.7.0 authenticated");
      case "MAIL":
      case "RCPT":
        return this.reply("250 2.1.0 ok");
      case "DATA":
        this.inData = true;
        return this.reply("354 end with <CRLF>.<CRLF>");
      case "QUIT":
        return this.reply("221 2.0.0 bye");
      default:
        // AUTH LOGIN のユーザー名・パスワードの行
        if (this.commands.at(-2)?.startsWith("AUTH LOGIN")) return this.reply("334 UGFzc3dvcmQ6");
        if (this.commands.at(-3)?.startsWith("AUTH LOGIN")) return this.reply("235 2.7.0 authenticated");
        return this.reply("500 5.5.1 unknown");
    }
  }
}

const MESSAGE: NotificationMessage = { to: { email: "member@example.org" }, title: "打刻忘れのお知らせ", body: "4/1 の退勤が\n.記録されていません" };
const AUTHED: SmtpChannelConfig = { host: "smtp.example.com", port: 587, from: "KIZAMI <noreply@example.com>", user: "mailer", password: "s3cret-パス" };

function b64decode(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
}

describe("createSmtpSendFn", () => {
  it("587: STARTTLS で昇格し、もう一度 EHLO してから AUTH PLAIN で送る", async () => {
    const server = new FakeSmtpServer();
    await createSmtpSendFn(server.connector)(AUTHED, MESSAGE);

    expect(server.security).toBe("starttls");
    expect(server.startTlsCalls).toBe(1);
    const auth = server.commands.find((c) => c.startsWith("AUTH PLAIN "));
    expect(server.commands.map((c) => (c.startsWith("AUTH PLAIN ") ? "AUTH PLAIN …" : c))).toEqual([
      "EHLO [127.0.0.1]",
      "STARTTLS",
      "EHLO [127.0.0.1]",
      "AUTH PLAIN …",
      "MAIL FROM:<noreply@example.com>",
      "RCPT TO:<member@example.org>",
      "DATA",
      "QUIT",
    ]);
    // RFC 4616: \0user\0password(UTF-8 のパスワードもそのまま)
    expect(b64decode(auth!.slice("AUTH PLAIN ".length))).toBe("\u0000mailer\u0000s3cret-パス");
    // 本文: ヘッダ + base64。行頭の `.` は本文の base64 には現れず、DATA の終端の手前で切れている
    expect(server.data).toContain("To: member@example.org\r\n");
    expect(server.data).toContain("Content-Transfer-Encoding: base64\r\n");
    expect(server.data.endsWith("\r\n")).toBe(true);
    expect(server.closed).toBe(true);
  });

  it("465: 最初から TLS で接続し、STARTTLS は送らない", async () => {
    const server = new FakeSmtpServer({ extensions: ["AUTH PLAIN"] });
    await createSmtpSendFn(server.connector)({ ...AUTHED, port: 465 }, MESSAGE);
    expect(server.security).toBe("implicit-tls");
    expect(server.commands).not.toContain("STARTTLS");
    expect(server.commands.some((c) => c.startsWith("AUTH PLAIN "))).toBe(true);
  });

  it("PLAIN が無ければ AUTH LOGIN(ユーザー名・パスワードを1行ずつ)", async () => {
    const server = new FakeSmtpServer({ extensionsAfterTls: ["AUTH LOGIN"] });
    await createSmtpSendFn(server.connector)(AUTHED, MESSAGE);
    const i = server.commands.indexOf("AUTH LOGIN");
    expect(i).toBeGreaterThan(0);
    expect(b64decode(server.commands[i + 1]!)).toBe("mailer");
    expect(b64decode(server.commands[i + 2]!)).toBe("s3cret-パス");
  });

  it("STARTTLS が広告されないのに認証情報があれば、送らずに失敗する(パスワードを平文で流さない)", async () => {
    const server = new FakeSmtpServer({ extensions: ["AUTH PLAIN LOGIN"] });
    const err = await createSmtpSendFn(server.connector)(AUTHED, MESSAGE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect((err as SmtpError).stage).toBe("starttls");
    expect(server.commands.some((c) => c.startsWith("AUTH"))).toBe(false);
    expect(server.commands.join("\n")).not.toContain(btoa("mailer"));
    expect(server.closed).toBe(true);
  });

  it("認証情報が無ければ、STARTTLS が無いサーバーへ平文のまま送る(nodemailer と同じ)", async () => {
    const server = new FakeSmtpServer({ extensions: [] });
    await createSmtpSendFn(server.connector)({ host: "relay.example.com", port: 2525, from: "noreply@example.com" }, MESSAGE);
    expect(server.startTlsCalls).toBe(0);
    expect(server.commands.slice(0, 2)).toEqual(["EHLO [127.0.0.1]", "MAIL FROM:<noreply@example.com>"]);
  });

  it("PLAIN も LOGIN も無ければ AUTH の段階で失敗する", async () => {
    const server = new FakeSmtpServer({ extensionsAfterTls: ["AUTH CRAM-MD5"] });
    await expect(createSmtpSendFn(server.connector)(AUTHED, MESSAGE)).rejects.toMatchObject({ stage: "auth" });
    expect(server.commands.some((c) => c.startsWith("MAIL"))).toBe(false);
  });

  it("EHLO を断る古いサーバーには HELO で名乗り直す", async () => {
    const server = new FakeSmtpServer({ rejectEhlo: true });
    await createSmtpSendFn(server.connector)({ host: "old.example.com", port: 587, from: "noreply@example.com" }, MESSAGE);
    expect(server.commands.slice(0, 3)).toEqual(["EHLO [127.0.0.1]", "HELO [127.0.0.1]", "MAIL FROM:<noreply@example.com>"]);
  });

  it("1バイトずつ届く応答・複数行の応答を読める", async () => {
    const server = new FakeSmtpServer({ dribble: true });
    await createSmtpSendFn(server.connector)(AUTHED, MESSAGE);
    expect(server.commands).toContain("QUIT");
  });

  it("宛先の拒否(550)は rcpt の段階の失敗で、応答のコードを持ち、パスワードを含まない", async () => {
    const server = new FakeSmtpServer({ replies: { RCPT: "550 5.1.1 user unknown" } });
    const err = (await createSmtpSendFn(server.connector)(AUTHED, MESSAGE).catch((e: unknown) => e)) as SmtpError;
    expect(err).toBeInstanceOf(SmtpError);
    expect(err).toMatchObject({ stage: "rcpt", replyCode: 550 });
    expect(err.message).toContain("user unknown");
    expect(err.message).not.toContain("s3cret");
    expect(server.closed).toBe(true);
  });

  it("本文の受理の拒否(554)は data の段階の失敗", async () => {
    const server = new FakeSmtpServer({ replies: { ".": "554 5.7.1 rejected" } });
    await expect(createSmtpSendFn(server.connector)(AUTHED, MESSAGE)).rejects.toMatchObject({ stage: "data", replyCode: 554 });
  });

  it("応答が来なければ時間切れで失敗し、接続を閉じる", async () => {
    const server = new FakeSmtpServer({ silentOn: "MAIL" });
    await expect(createSmtpSendFn(server.connector, { replyTimeoutMs: 30 })(AUTHED, MESSAGE)).rejects.toMatchObject({ stage: "timeout" });
    expect(server.closed).toBe(true);
  });

  it("1通全体の上限でも打ち切る", async () => {
    const server = new FakeSmtpServer({ silentOn: "DATA" });
    await expect(createSmtpSendFn(server.connector, { replyTimeoutMs: 10_000, totalTimeoutMs: 30 })(AUTHED, MESSAGE)).rejects.toMatchObject({
      stage: "timeout",
    });
    expect(server.closed).toBe(true);
  });

  it("途中で切断されたら空回りせずに失敗する", async () => {
    const server = new FakeSmtpServer({ closeOn: "RCPT" });
    await expect(createSmtpSendFn(server.connector)(AUTHED, MESSAGE)).rejects.toThrow(/connection closed/);
  });

  it("STARTTLS の 220 の後、TLS の前に混ぜられた応答は受け付けない(平文の注入)", async () => {
    const server = new FakeSmtpServer({ injectBeforeTls: true });
    await expect(createSmtpSendFn(server.connector)(AUTHED, MESSAGE)).rejects.toMatchObject({ stage: "starttls" });
    expect(server.commands.some((c) => c.startsWith("AUTH"))).toBe(false);
  });

  it("checkTarget が断れば接続しない", async () => {
    let connected = false;
    const connector: SmtpConnector = async () => {
      connected = true;
      throw new Error("unreachable");
    };
    const send = createSmtpSendFn(connector, {
      checkTarget: ({ port }) => {
        if (port === 25) throw new SmtpError("prepare", "port 25 is blocked");
      },
    });
    await expect(send({ ...AUTHED, port: 25 }, MESSAGE)).rejects.toMatchObject({ stage: "prepare" });
    expect(connected).toBe(false);
  });

  it("宛先が無い・差出人が読めないなら接続しない", async () => {
    const server = new FakeSmtpServer();
    const send = createSmtpSendFn(server.connector);
    await expect(send(AUTHED, { ...MESSAGE, to: {} })).rejects.toMatchObject({ stage: "prepare" });
    await expect(send({ ...AUTHED, from: "not an address" }, MESSAGE)).rejects.toThrow(/sender/);
    expect(server.security).toBeUndefined();
  });

  it("接続の失敗は connect の段階の失敗", async () => {
    const connector: SmtpConnector = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(createSmtpSendFn(connector)(AUTHED, MESSAGE)).rejects.toMatchObject({ stage: "connect" });
  });
});
