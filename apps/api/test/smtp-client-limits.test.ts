/**
 * Workers のテナント SMTP(src/lib/smtp-client.ts)の資源の上限(2026-10-07 セキュリティレビュー「resource-cap-defeat」)。
 *
 * テナントは任意のホストを SMTP として登録できるので、壊れた・悪意のある相手でも、こちらのメモリ・時間・接続を
 * 際限なく使わせないことを、偽の接続で確かめる: 長すぎる行(改行なし / 1つの塊の中)、大きすぎる応答、終わらない
 * `250-` の続き、1バイトずつ垂らす相手(段階の締め切りは絶対で延びない)、全体の締め切り、TLS への昇格・
 * ハンドシェイクの停止、書き込みの停止(背圧)、接続の停止と遅れて返る接続、閉じる操作の停止。
 * どの場合も失敗のあとに読み取りが続かない(閉じた接続の上で回り続けない)ことも見る。
 */

import { describe, expect, it } from "vitest";
import type { NotificationMessage, SmtpChannelConfig } from "@kizami/notify";
import { createSmtpSendFn, SMTP_LIMITS, SmtpError, type SmtpConnection, type SmtpConnector } from "../src/lib/smtp-client.js";

const MESSAGE: NotificationMessage = { to: { email: "member@example.org" }, title: "t", body: "b" };
const PLAIN: SmtpChannelConfig = { host: "smtp.example.com", port: 587, from: "noreply@example.com" };
const AUTHED: SmtpChannelConfig = { ...PLAIN, user: "u", password: "p" };
const encoder = new TextEncoder();
const never = <T>() => new Promise<T>(() => undefined);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 台本の接続。`respond(line)` が受けたコマンド1行に対する応答(文字列 = すぐ返す、undefined = 黙る)。
 * `reads` は読み取りの回数(失敗のあとに増え続けないことの確認)。
 */
function scripted(params: {
  greeting?: string;
  respond?: (line: string) => string | undefined;
  /** 読み取りのたびに返す塊を作る(指定すると greeting / respond より優先) */
  feed?: (readIndex: number) => Promise<Uint8Array | null>;
  startTls?: () => Promise<SmtpConnection>;
  write?: (text: string) => Promise<void>;
  close?: () => Promise<void>;
  /** 応答を返すまでの遅れ(ミリ秒) */
  delayMs?: number;
}) {
  const state = { reads: 0, closed: false, writes: [] as string[] };
  const queue: Uint8Array[] = [];
  const waiters: Array<(chunk: Uint8Array | null) => void> = [];
  const push = (text: string) => {
    const chunk = encoder.encode(text);
    const waiter = waiters.shift();
    if (waiter) waiter(chunk);
    else queue.push(chunk);
  };
  if (params.greeting !== undefined) push(params.greeting);
  const conn: SmtpConnection = {
    read: () => {
      state.reads += 1;
      if (state.closed) return Promise.resolve(null);
      if (params.feed) return params.feed(state.reads);
      const next = queue.shift();
      if (next) return Promise.resolve(next);
      return new Promise((resolve) => waiters.push(resolve));
    },
    write: async (bytes) => {
      const text = new TextDecoder().decode(bytes);
      state.writes.push(text);
      if (params.write) return params.write(text);
      for (const line of text.split("\r\n").filter((l) => l !== "")) {
        const reply = params.respond?.(line);
        if (reply === undefined) continue;
        if (params.delayMs) setTimeout(() => push(reply), params.delayMs);
        else push(reply);
      }
    },
    startTls: params.startTls ?? (async () => conn),
    close: async () => {
      state.closed = true;
      for (const waiter of waiters.splice(0)) waiter(null);
      if (params.close) return params.close();
    },
  };
  const connector: SmtpConnector = async () => conn;
  return { conn, connector, state };
}

/** 普通の SMTP サーバーの応答(上書き用の土台)。 */
function normal(line: string): string | undefined {
  const verb = (line.split(/[ :]/)[0] ?? "").toUpperCase();
  if (verb === "EHLO") return "250-fake\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n";
  if (verb === "STARTTLS") return "220 go ahead\r\n";
  if (verb === "DATA") return "354 go\r\n";
  if (verb === "QUIT") return "221 bye\r\n";
  return "250 ok\r\n";
}

async function failure(promise: Promise<unknown>): Promise<SmtpError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SmtpError);
  return err as SmtpError;
}

/** 失敗のあと、しばらく待っても読み取りが増えない(読み取りのループが残っていない)。 */
async function expectNoDanglingReads(state: { reads: number }): Promise<void> {
  const after = state.reads;
  await sleep(40);
  expect(state.reads).toBe(after);
}

describe("SMTP の資源の上限", () => {
  it("改行の来ない長すぎる行で切る(RFC 5321 の 512 オクテット + 余裕)", async () => {
    const s = scripted({ greeting: `220 ${"x".repeat(SMTP_LIMITS.maxLineChars + 10)}` });
    const err = await failure(createSmtpSendFn(s.connector)(PLAIN, MESSAGE));
    expect(err.message).toMatch(/too long/);
    expect(s.state.closed).toBe(true);
  });

  it("1つの塊の中で改行より前に上限を超える行も切る", async () => {
    const s = scripted({ greeting: `220 ${"x".repeat(SMTP_LIMITS.maxLineChars + 10)}\r\n` });
    expect((await failure(createSmtpSendFn(s.connector)(PLAIN, MESSAGE))).message).toMatch(/too long/);
  });

  it("1つの応答の合計の大きさで切る(行ごとは上限内でも)", async () => {
    const line = `250-${"y".repeat(SMTP_LIMITS.maxLineChars - 10)}\r\n`;
    const s = scripted({ greeting: "220 hi\r\n", respond: (l) => (l.startsWith("EHLO") ? line.repeat(12) + "250 end\r\n" : normal(l)) });
    expect((await failure(createSmtpSendFn(s.connector)(PLAIN, MESSAGE))).message).toMatch(/too large/);
  });

  it("終わらない `250-` の続きを行数の上限で止め、読み取りを続けない", async () => {
    let greeted = false;
    const s = scripted({
      feed: async () => {
        if (!greeted) {
          greeted = true;
          return encoder.encode("220 hi\r\n");
        }
        return encoder.encode("250-more\r\n");
      },
    });
    const err = await failure(createSmtpSendFn(s.connector)(PLAIN, MESSAGE));
    expect(err.message).toMatch(/too many reply lines/);
    expect(s.state.reads).toBeLessThanOrEqual(SMTP_LIMITS.maxReplyLines + 2);
    await expectNoDanglingReads(s.state);
  });

  it("1バイトずつ垂らす相手でも、段階の締め切りは延びない(絶対の締め切り)", async () => {
    let i = 0;
    const s = scripted({
      // 10ms ごとに1バイト。改行は来ない(行の上限にも届かない速さ)
      feed: async () => {
        await sleep(10);
        i += 1;
        return encoder.encode(i === 1 ? "2" : "x");
      },
    });
    const started = Date.now();
    const err = await failure(createSmtpSendFn(s.connector, { replyTimeoutMs: 100, totalTimeoutMs: 10_000 })(PLAIN, MESSAGE));
    expect(err.stage).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(500);
    expect(s.state.closed).toBe(true);
    await expectNoDanglingReads(s.state);
  });

  it("各応答は段階の締め切りに間に合っても、1通全体の締め切りで打ち切る", async () => {
    // 毎回 40ms 遅れて答える(段階の 100ms には間に合うが、往復が 6 回以上あるので全体の 150ms を越える)
    const s = scripted({ greeting: "220 hi\r\n", respond: normal, delayMs: 40 });
    const started = Date.now();
    const err = await failure(createSmtpSendFn(s.connector, { replyTimeoutMs: 100, totalTimeoutMs: 150 })(PLAIN, MESSAGE));
    expect(err.stage).toBe("timeout");
    expect(err.message).toMatch(/overall|150ms/);
    expect(Date.now() - started).toBeLessThan(400);
    expect(s.state.closed).toBe(true);
    expect(s.state.writes.some((w) => w.startsWith("QUIT"))).toBe(false);
  });

  it("TLS への昇格が返ってこなければ締め切りで切り、遅れて返った接続も閉じる", async () => {
    let lateClosed = false;
    const s = scripted({
      greeting: "220 hi\r\n",
      respond: normal,
      startTls: async () => {
        await sleep(150);
        const late = scripted({});
        late.conn.close = async () => {
          lateClosed = true;
        };
        return late.conn;
      },
    });
    const err = await failure(createSmtpSendFn(s.connector, { replyTimeoutMs: 50 })(AUTHED, MESSAGE));
    expect(err.stage).toBe("timeout");
    expect(err.message).toContain("starttls");
    expect(s.state.closed).toBe(true);
    await sleep(150);
    expect(lateClosed).toBe(true);
  });

  it("昇格のあとハンドシェイクで止まる相手(読み取りが返らない)も、直後の EHLO の締め切りで切る", async () => {
    const upgraded = scripted({ feed: () => never() });
    const s = scripted({ greeting: "220 hi\r\n", respond: normal, startTls: async () => upgraded.conn });
    const err = await failure(createSmtpSendFn(s.connector, { replyTimeoutMs: 50 })(AUTHED, MESSAGE));
    expect(err.stage).toBe("timeout");
    expect(err.message).toContain("ehlo");
    expect(upgraded.state.closed).toBe(true);
    expect(upgraded.state.writes.some((w) => w.startsWith("AUTH"))).toBe(false);
  });

  it("書き込みが返らない(相手が読まない背圧)と、書き込みの締め切りで切る", async () => {
    const s = scripted({ greeting: "220 hi\r\n", respond: normal });
    const base = s.conn.write;
    s.conn.write = (bytes) => (new TextDecoder().decode(bytes).startsWith("MAIL") ? never<void>() : base(bytes));
    const err = await failure(createSmtpSendFn(s.connector, { replyTimeoutMs: 50 })(PLAIN, MESSAGE));
    expect(err.stage).toBe("timeout");
    expect(err.message).toContain("mail");
    expect(s.state.closed).toBe(true);
  });

  it("接続が返ってこなければ締め切りで切り、遅れて返った接続は使わずに閉じる", async () => {
    const late = scripted({ greeting: "220 hi\r\n", respond: normal });
    const connector: SmtpConnector = async () => {
      await sleep(120);
      return late.conn;
    };
    const err = await failure(createSmtpSendFn(connector, { replyTimeoutMs: 50 })(PLAIN, MESSAGE));
    expect(err.stage).toBe("timeout");
    expect(err.message).toContain("connect");
    await sleep(120);
    expect(late.state.closed).toBe(true);
    expect(late.state.writes).toEqual([]);
  });

  it("閉じる操作が返らなくても、送信関数は閉じる操作の上限で戻る", async () => {
    const s = scripted({ greeting: "220 hi\r\n", respond: normal, close: () => never() });
    const started = Date.now();
    await createSmtpSendFn(s.connector)(PLAIN, MESSAGE);
    expect(Date.now() - started).toBeLessThan(SMTP_LIMITS.closeTimeoutMs + 500);
  }, 10_000);

  it("AUTH LOGIN の巨大なチャレンジも応答の上限で止まる(復号しない)", async () => {
    const s = scripted({
      greeting: "220 hi\r\n",
      respond: (l) => {
        if (l.startsWith("EHLO")) return "250-fake\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n";
        if (l === "AUTH LOGIN") return `334 ${"QUFB".repeat(SMTP_LIMITS.maxReplyBytes)}\r\n`;
        return normal(l);
      },
    });
    expect((await failure(createSmtpSendFn(s.connector)(AUTHED, MESSAGE))).message).toMatch(/too (large|long)/);
  });
});
