/**
 * 最小の SMTP クライアント(ランタイム非依存、2026-10-07、docs/design/workers-d1.md「メール」)。
 *
 * Cloudflare Workers でテナントの SMTP(テナントの管理者が通知設定に登録した自社の SMTP サーバー)へ送るための
 * `SmtpSendFn`。Node は nodemailer(lib/smtp.ts)を使い、ここは使わない。TCP の接続そのものは注入する
 * (`SmtpConnector`)— Workers の実装は `cloudflare:sockets` の `connect()`(lib/workers-smtp-socket.ts。
 * workers.ts だけが import する)、テストは偽の接続。このファイル自体は node:* も cloudflare:* も import しない。
 *
 * ## なぜ自前か(判断点)
 *
 * workerd で動く既存の MIT ライブラリ `worker-mailer`(1.2.1、2025-11 が最終版、依存なし・約 14 KB)を読んだが
 * 採らなかった: (1) 応答の読み取りが接続の切断(`done`)で空回りし続ける、(2) STARTTLS を要求しても相手が
 * 広告しなければ黙って平文のまま AUTH を送る、(3) 件名を1つの encoded-word にして 75 文字を超える、
 * (4) EHLO の引数が角括弧の無い IP(`EHLO 127.0.0.1`)で厳しいサーバーに断られる、(5) 応答の待ち時間に
 * 接続の待ち時間の値を使っている。KIZAMI が要るのは「平文1通を1人に送る」だけなので、状態機械を
 * ここに書いた方が小さく、テストで縛れる。
 *
 * ## 手順
 *
 * 1. 接続(465 は最初から TLS、それ以外は平文で始めて STARTTLS)→ 220 の挨拶
 * 2. `EHLO [127.0.0.1]`(断られたら HELO。ESMTP の拡張は使えなくなる)
 * 3. 465 以外: STARTTLS が広告されていれば `STARTTLS` → 220 → TLS へ昇格 → もう一度 EHLO。
 *    **広告されていないのに認証情報があれば送らずに失敗する**(パスワードを平文で流さない。nodemailer の既定は
 *    平文のまま AUTH するので、ここだけ Node より厳しい)。認証情報が無ければ平文のまま送る(nodemailer と同じ)
 * 4. 認証情報(user と password の両方)があれば AUTH PLAIN、無ければ AUTH LOGIN(どちらも TLS の上でだけ)。
 *    どちらも広告されていなければ失敗
 * 5. `MAIL FROM:<…>` → `RCPT TO:<…>`(250/251)→ `DATA`(354)→ 本文(dot-stuffing 済み)+ `.` → 250
 * 6. `QUIT`(応答は待つが失敗は無視)→ 切断
 *
 * どの段階でも、応答を待つのは `replyTimeoutMs`(既定 30 秒)まで、1通全体で `totalTimeoutMs`(既定 60 秒)まで。
 * 時間切れ・失敗のどちらでも接続は必ず閉じる。エラーのメッセージには段階とサーバーの応答(200 文字まで)を
 * 入れ、**パスワードは入れない**。
 */

import type { NotificationMessage, SmtpChannelConfig, SmtpSendFn } from "@kizami/notify";
import { buildPlainTextMessage, dotStuff, parseMailbox, utf8ToBase64, type Mailbox } from "./mail-message.js";

/** 接続の向き(465 = 最初から TLS、それ以外 = 平文で始めて STARTTLS で昇格)。 */
export type SmtpSecurity = "implicit-tls" | "starttls";

/** 注入する TCP 接続。読み取りは届いた分のバイト列、切断なら null。 */
export interface SmtpConnection {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  /** STARTTLS の 220 を受けた後に呼ぶ。TLS に昇格した新しい接続を返す(古い接続はもう使わない) */
  startTls(): Promise<SmtpConnection>;
  close(): Promise<void>;
}

export type SmtpConnector = (target: { host: string; port: number; security: SmtpSecurity }) => Promise<SmtpConnection>;

export interface SmtpClientOptions {
  /** 1つの応答を待つ上限(ミリ秒)。既定 30 秒 */
  replyTimeoutMs?: number;
  /** 1通全体の上限(ミリ秒)。既定 60 秒 */
  totalTimeoutMs?: number;
  /** EHLO / HELO で名乗る名前。既定 `[127.0.0.1]`(アドレスリテラル。Workers には自分のホスト名が無い) */
  heloName?: string;
  /** 送る前の宛先の検査(SSRF の名前の検査・ポート 25 の拒否など)。投げれば接続しない */
  checkTarget?: (target: { host: string; port: number }) => void | Promise<void>;
  /** Date ヘッダの時刻(テスト用)。既定 Date.now */
  now?: () => number;
}

/** SMTP の失敗。`stage` はどの段階で失敗したか(connect / greeting / ehlo / starttls / auth / mail / rcpt / data / timeout)。 */
export class SmtpError extends Error {
  readonly stage: string;
  readonly replyCode: number | undefined;
  constructor(stage: string, message: string, replyCode?: number) {
    super(`smtp ${stage}: ${message}`);
    this.name = "SmtpError";
    this.stage = stage;
    this.replyCode = replyCode;
  }
}

interface SmtpReply {
  code: number;
  /** 各行のコードの後ろ(`250-PIPELINING` なら `PIPELINING`) */
  lines: string[];
}

/** 応答の1行の上限(これを超えて改行が来なければ壊れた相手として切る)。RFC 5321 は 512 オクテット。 */
const MAX_REPLY_BUFFER = 64 * 1024;

function summarize(reply: SmtpReply): string {
  return `${reply.code} ${reply.lines.join(" / ")}`.slice(0, 200);
}

/** 応答を1つずつ読む(複数行の `250-…` を最後の `250 …` までまとめる)。 */
class ReplyReader {
  private buffer = "";
  private readonly decoder = new TextDecoder("utf-8");
  constructor(private conn: SmtpConnection) {}

  /** STARTTLS 後に接続を差し替える(昇格前に届いた残りがあれば、それは平文の注入なので捨てずに失敗させる)。 */
  replace(conn: SmtpConnection): void {
    if (this.buffer !== "") throw new SmtpError("starttls", "unexpected data before the TLS handshake");
    this.conn = conn;
  }

  async next(): Promise<SmtpReply> {
    const lines: string[] = [];
    let code: number | undefined;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        if (this.buffer.length > MAX_REPLY_BUFFER) throw new SmtpError("reply", "reply line is too long");
        const chunk = await this.conn.read();
        if (chunk === null) throw new SmtpError("reply", "connection closed by the server");
        this.buffer += this.decoder.decode(chunk, { stream: true });
        continue;
      }
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      const match = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (match === null) throw new SmtpError("reply", `malformed reply: ${line.slice(0, 100)}`);
      const lineCode = Number(match[1]);
      if (code !== undefined && lineCode !== code) throw new SmtpError("reply", `inconsistent multiline reply: ${line.slice(0, 100)}`);
      code = lineCode;
      lines.push(match[3] ?? "");
      if (match[2] !== "-") return { code, lines };
    }
  }
}

/** ESMTP の広告(EHLO の応答)から読み取ったもの。 */
interface Capabilities {
  startTls: boolean;
  auth: Set<string>;
}

function parseCapabilities(reply: SmtpReply): Capabilities {
  const auth = new Set<string>();
  let startTls = false;
  // 1行目は挨拶の名前なので2行目から
  for (const raw of reply.lines.slice(1)) {
    const line = raw.trim().toUpperCase();
    if (line === "STARTTLS") startTls = true;
    // `AUTH PLAIN LOGIN` と古い `AUTH=PLAIN LOGIN` の両方
    const authMatch = /^AUTH[ =](.*)$/.exec(line);
    if (authMatch) for (const mech of (authMatch[1] ?? "").split(/\s+/)) if (mech !== "") auth.add(mech);
  }
  return { startTls, auth };
}

const encoder = new TextEncoder();

/** 1通の送信(接続から切断まで)。 */
async function sendOnce(
  connector: SmtpConnector,
  config: SmtpChannelConfig,
  from: Mailbox,
  to: string,
  data: string,
  options: Required<Pick<SmtpClientOptions, "replyTimeoutMs" | "heloName">>,
  /** 今使っている接続を知らせる(STARTTLS で差し替わる。呼び出し側が最後に閉じる) */
  track: (conn: SmtpConnection) => void,
): Promise<void> {
  const security: SmtpSecurity = config.port === 465 ? "implicit-tls" : "starttls";
  let conn: SmtpConnection;
  try {
    conn = await connector({ host: config.host, port: config.port, security });
  } catch (err) {
    throw new SmtpError("connect", err instanceof Error ? err.message : String(err));
  }
  track(conn);
  const reader = new ReplyReader(conn);
  let tls = security === "implicit-tls";

  const withReplyTimeout = <T>(promise: Promise<T>, stage: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SmtpError("timeout", `no reply within ${options.replyTimeoutMs}ms (${stage})`)), options.replyTimeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });

  const send = (line: string) => conn.write(encoder.encode(`${line}\r\n`));
  const expect = async (stage: string, accept: (code: number) => boolean): Promise<SmtpReply> => {
    const reply = await withReplyTimeout(reader.next(), stage);
    if (!accept(reply.code)) throw new SmtpError(stage, summarize(reply), reply.code);
    return reply;
  };
  const command = async (line: string, stage: string, accept: (code: number) => boolean): Promise<SmtpReply> => {
    await send(line);
    return expect(stage, accept);
  };
  const is = (...codes: number[]) => (code: number) => codes.includes(code);

  await expect("greeting", is(220));

  const hello = async (): Promise<Capabilities | null> => {
    await send(`EHLO ${options.heloName}`);
    const reply = await withReplyTimeout(reader.next(), "ehlo");
    if (reply.code === 250) return parseCapabilities(reply);
    // ESMTP を話さない古いサーバー(5xx)には HELO で名乗り直す。拡張(STARTTLS・AUTH)は使えない
    if (reply.code >= 500) {
      await command(`HELO ${options.heloName}`, "helo", is(250));
      return null;
    }
    throw new SmtpError("ehlo", summarize(reply), reply.code);
  };

  let caps = await hello();
  const credentials = config.user !== undefined && config.password !== undefined ? { user: config.user, password: config.password } : null;

  if (!tls) {
    if (caps?.startTls) {
      await command("STARTTLS", "starttls", is(220));
      conn = await conn.startTls();
      track(conn);
      reader.replace(conn);
      tls = true;
      caps = await hello();
    } else if (credentials !== null) {
      throw new SmtpError("starttls", "the server does not offer STARTTLS; refusing to send credentials over plaintext");
    }
  }

  if (credentials !== null) {
    if (caps?.auth.has("PLAIN")) {
      // authzid は空、authcid = user、passwd(RFC 4616)。UTF-8 のまま base64 にする
      await command(`AUTH PLAIN ${utf8ToBase64(`\u0000${credentials.user}\u0000${credentials.password}`)}`, "auth", is(235));
    } else if (caps?.auth.has("LOGIN")) {
      await command("AUTH LOGIN", "auth", is(334));
      await command(utf8ToBase64(credentials.user), "auth", is(334));
      await command(utf8ToBase64(credentials.password), "auth", is(235));
    } else {
      throw new SmtpError("auth", "the server offers neither AUTH PLAIN nor AUTH LOGIN");
    }
  }

  await command(`MAIL FROM:<${from.address}>`, "mail", is(250));
  await command(`RCPT TO:<${to}>`, "rcpt", is(250, 251));
  await command("DATA", "data", is(354));
  await conn.write(encoder.encode(`${dotStuff(data)}.\r\n`));
  await expect("data", is(250));

  // QUIT の応答の失敗は送信の成否に関係しない(本文は 250 で受理済み)
  try {
    await command("QUIT", "quit", () => true);
  } catch {
    // 無視
  }
}

/**
 * `SmtpSendFn`(@kizami/notify の createSmtpChannel に注入する送信関数)を作る。
 * 本文は平文テキストを base64 で(lib/mail-message.ts)、宛先は `msg.to.email` の1人。
 */
export function createSmtpSendFn(connector: SmtpConnector, options: SmtpClientOptions = {}): SmtpSendFn {
  const replyTimeoutMs = options.replyTimeoutMs ?? 30_000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 60_000;
  const heloName = options.heloName ?? "[127.0.0.1]";
  const now = options.now ?? (() => Date.now());

  return async (config: SmtpChannelConfig, msg: NotificationMessage): Promise<void> => {
    const to = msg.to.email;
    if (!to) throw new SmtpError("prepare", "message has no recipient email address");
    await options.checkTarget?.({ host: config.host, port: config.port });

    // 組み立ては接続の前に(アドレスの誤りで接続を無駄にしない)
    const from = parseMailbox(config.from, "sender");
    const data = buildPlainTextMessage({ from, to, subject: msg.title, text: msg.body, date: now() });
    const recipient = to.trim();

    let current: SmtpConnection | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overall = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SmtpError("timeout", `not finished within ${totalTimeoutMs}ms`)), totalTimeoutMs);
    });
    const attempt = sendOnce(connector, config, from, recipient, data, { replyTimeoutMs, heloName }, (c) => {
      current = c;
    });
    // 全体の時間切れで先に返したあと、閉じた接続の上で attempt が遅れて失敗しても未処理の reject にしない
    attempt.catch(() => undefined);
    try {
      await Promise.race([attempt, overall]);
    } finally {
      clearTimeout(timer);
      // 成功でも失敗でも閉じる(STARTTLS の後は昇格した接続。閉じる失敗は無視)
      await current?.close().catch(() => undefined);
    }
  };
}
