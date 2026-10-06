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
 * どの段階でも(接続・書き込み・応答・TLS への昇格)、待つのは段階の開始から `replyTimeoutMs`(既定 30 秒)の
 * **絶対の締め切り**まで、1通全体で `totalTimeoutMs`(既定 60 秒)まで。応答の大きさ・行数にも上限がある
 * (`SMTP_LIMITS`)。時間切れ・失敗のどちらでも接続は必ず閉じる。エラーのメッセージには段階とサーバーの応答(200 文字まで)を
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

/**
 * 相手(テナントが登録した任意のホスト)が壊れていても悪意があっても、こちらの資源を際限なく使わせないための上限
 * (2026-10-07 セキュリティレビュー「resource-cap-defeat」)。
 *
 * - 応答の1行: RFC 5321 4.5.3.1.5 の 512 オクテットに余裕を持たせて 2,048 文字。改行が来ないまま超えても、
 *   1つの塊の中で改行より前に超えても失敗
 * - 1つの応答(複数行の `250-…` を含む)の合計: 16 KiB。EHLO の広告は普通 1 KiB に届かない
 * - 1つの応答の行数: 64 行(`250-` を延々と送り続ける相手を止める)
 * - 時間: 段階(接続・書き込み・応答の読み取り・TLS への昇格)ごとに**絶対の締め切り**を段階の開始時に決める
 *   (届いたバイトで延長しない — 1バイトずつ垂らす相手でも締め切りで切れる)。各段階の締め切りは1通全体の
 *   締め切り(既定 60 秒)を越えない
 * - 切断: 失敗・時間切れ・成功のどの終わり方でも接続を閉じ、閉じる操作自体にも上限(2 秒)を掛ける。打ち切った後は
 *   読み取りの続きを始めない(`SessionClock.aborted`)ので、閉じた接続の上で読み取りが回り続けることは無い。
 *   締め切りの後に遅れて返ってきた接続・昇格した接続も、使わずに閉じる
 *
 * AUTH の 334 のチャレンジは復号しない(PLAIN / LOGIN は中身を使わない)ので、巨大なチャレンジも応答の上限で止まる。
 */
export const SMTP_LIMITS = {
  maxLineChars: 2048,
  maxReplyBytes: 16 * 1024,
  maxReplyLines: 64,
  closeTimeoutMs: 2_000,
} as const;

function summarize(reply: SmtpReply): string {
  return `${reply.code} ${reply.lines.join(" / ")}`.slice(0, 200);
}

/** 1通ぶんの締め切りと中断の状態。 */
class SessionClock {
  aborted = false;
  constructor(
    private readonly overallDeadlineAt: number,
    private readonly stepTimeoutMs: number,
  ) {}

  /**
   * `promise` に段階の締め切りを掛ける。締め切りは**いま**から `stepTimeoutMs`(全体の締め切りを越えない)の
   * 絶対時刻で、途中で何が届いても延びない。時間切れになったら `aborted` を立てる(以後の読み書きを始めない)。
   */
  step<T>(promise: Promise<T>, stage: string): Promise<T> {
    if (this.aborted) {
      promise.catch(() => undefined);
      return Promise.reject(new SmtpError("timeout", `session aborted (${stage})`));
    }
    const remaining = this.overallDeadlineAt - Date.now();
    const byOverall = remaining < this.stepTimeoutMs;
    const ms = Math.max(0, byOverall ? remaining : this.stepTimeoutMs);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.aborted = true;
        reject(new SmtpError("timeout", byOverall ? `not finished within the overall deadline (${stage})` : `no reply within ${this.stepTimeoutMs}ms (${stage})`));
      }, ms);
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
  }
}

/** 応答を1つずつ読む(複数行の `250-…` を最後の `250 …` までまとめる)。上限は SMTP_LIMITS。 */
class ReplyReader {
  private buffer = "";
  private readonly decoder = new TextDecoder("utf-8");
  constructor(
    private conn: SmtpConnection,
    private readonly clock: SessionClock,
  ) {}

  /** STARTTLS 後に接続を差し替える(昇格前に届いた残りがあれば、それは平文の注入なので捨てずに失敗させる)。 */
  replace(conn: SmtpConnection): void {
    if (this.buffer !== "") throw new SmtpError("starttls", "unexpected data before the TLS handshake");
    this.conn = conn;
  }

  /** 応答を1つ読む。締め切りは呼び出し側が `clock.step()` で掛ける(1つの応答に1つの絶対の締め切り)。 */
  async next(): Promise<SmtpReply> {
    const lines: string[] = [];
    let code: number | undefined;
    let replyBytes = 0;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        if (this.buffer.length > SMTP_LIMITS.maxLineChars) throw new SmtpError("reply", "reply line is too long");
        // 打ち切られた後は読み取りを続けない(閉じた接続の上で回り続けない)
        if (this.clock.aborted) throw new SmtpError("timeout", "session aborted");
        const chunk = await this.conn.read();
        if (chunk === null) throw new SmtpError("reply", "connection closed by the server");
        replyBytes += chunk.byteLength;
        if (replyBytes > SMTP_LIMITS.maxReplyBytes) throw new SmtpError("reply", "reply is too large");
        this.buffer += this.decoder.decode(chunk, { stream: true });
        continue;
      }
      if (newline > SMTP_LIMITS.maxLineChars) throw new SmtpError("reply", "reply line is too long");
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      const match = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (match === null) throw new SmtpError("reply", `malformed reply: ${line.slice(0, 100)}`);
      const lineCode = Number(match[1]);
      if (code !== undefined && lineCode !== code) throw new SmtpError("reply", `inconsistent multiline reply: ${line.slice(0, 100)}`);
      code = lineCode;
      lines.push(match[3] ?? "");
      if (match[2] !== "-") return { code, lines };
      if (lines.length >= SMTP_LIMITS.maxReplyLines) throw new SmtpError("reply", "too many reply lines");
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

/** 閉じる(失敗は無視。閉じる操作自体にも上限)。 */
async function closeQuietly(conn: SmtpConnection): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      conn.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SMTP_LIMITS.closeTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 接続を返す操作(接続・TLS への昇格)に締め切りを掛ける。締め切りの後に遅れて返ってきた接続は使わずに閉じる。
 */
async function acquire(clock: SessionClock, pending: Promise<SmtpConnection>, stage: string): Promise<SmtpConnection> {
  let abandoned = false;
  const tracked = pending.then((c) => {
    if (abandoned) void closeQuietly(c);
    return c;
  });
  try {
    return await clock.step(tracked, stage);
  } catch (err) {
    abandoned = true;
    tracked.catch(() => undefined);
    throw err;
  }
}

/** 1通の送信(接続から切断まで)。すべての待ちに `clock.step()` の締め切りを掛ける。 */
async function sendOnce(
  connector: SmtpConnector,
  config: SmtpChannelConfig,
  from: Mailbox,
  to: string,
  data: string,
  heloName: string,
  clock: SessionClock,
  /** 今使っている接続を知らせる(STARTTLS で差し替わる。呼び出し側が最後に閉じる) */
  track: (conn: SmtpConnection) => void,
): Promise<void> {
  const security: SmtpSecurity = config.port === 465 ? "implicit-tls" : "starttls";
  let conn: SmtpConnection;
  try {
    conn = await acquire(clock, connector({ host: config.host, port: config.port, security }), "connect");
  } catch (err) {
    if (err instanceof SmtpError) throw err;
    throw new SmtpError("connect", err instanceof Error ? err.message : String(err));
  }
  track(conn);
  const reader = new ReplyReader(conn, clock);
  let tls = security === "implicit-tls";

  // 書き込みにも締め切り(読まない相手の背圧で止まらない)
  const write = (text: string, stage: string) => clock.step(conn.write(encoder.encode(text)), stage);
  const read = (stage: string) => clock.step(reader.next(), stage);
  const expect = async (stage: string, accept: (code: number) => boolean): Promise<SmtpReply> => {
    const reply = await read(stage);
    if (!accept(reply.code)) throw new SmtpError(stage, summarize(reply), reply.code);
    return reply;
  };
  const command = async (line: string, stage: string, accept: (code: number) => boolean): Promise<SmtpReply> => {
    await write(`${line}\r\n`, stage);
    return expect(stage, accept);
  };
  const is = (...codes: number[]) => (code: number) => codes.includes(code);

  await expect("greeting", is(220));

  const hello = async (): Promise<Capabilities | null> => {
    await write(`EHLO ${heloName}\r\n`, "ehlo");
    const reply = await read("ehlo");
    if (reply.code === 250) return parseCapabilities(reply);
    // ESMTP を話さない古いサーバー(5xx)には HELO で名乗り直す。拡張(STARTTLS・AUTH)は使えない
    if (reply.code >= 500) {
      await command(`HELO ${heloName}`, "helo", is(250));
      return null;
    }
    throw new SmtpError("ehlo", summarize(reply), reply.code);
  };

  let caps = await hello();
  const credentials = config.user !== undefined && config.password !== undefined ? { user: config.user, password: config.password } : null;

  if (!tls) {
    if (caps?.startTls) {
      await command("STARTTLS", "starttls", is(220));
      // 昇格そのものにも締め切り。Workers はハンドシェイクを昇格後の最初の読み書きで行うので、そこで止まる相手は
      // 直後の EHLO の締め切りで切れる
      conn = await acquire(clock, conn.startTls(), "starttls");
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
      // 334 のチャレンジ(Username: / Password:)は復号しない
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
  await write(`${dotStuff(data)}.\r\n`, "data");
  await expect("data", is(250));

  // QUIT の応答の失敗は送信の成否に関係しない(本文は 250 で受理済み)。締め切りは他と同じ
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

    const clock = new SessionClock(Date.now() + totalTimeoutMs, replyTimeoutMs);
    let current: SmtpConnection | undefined;
    // 各段階の締め切りが全体の締め切りを越えないので、全体の時間切れは段階の時間切れとして現れる。
    // 外側にも同じ締め切りを置いて二重にする(段階の外で止まることは無いが、保険)
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overall = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        clock.aborted = true;
        reject(new SmtpError("timeout", `not finished within ${totalTimeoutMs}ms`));
      }, totalTimeoutMs);
    });
    const attempt = sendOnce(connector, config, from, recipient, data, heloName, clock, (c) => {
      current = c;
    });
    // 時間切れで先に返したあと、閉じた接続の上で attempt が遅れて失敗しても未処理の reject にしない
    attempt.catch(() => undefined);
    try {
      await Promise.race([attempt, overall]);
    } finally {
      clearTimeout(timer);
      clock.aborted = true;
      // 成功でも失敗でも閉じる(STARTTLS の後は昇格した接続。閉じる失敗は無視、閉じる操作にも上限)
      if (current !== undefined) await closeQuietly(current);
    }
  };
}
