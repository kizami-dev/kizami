/**
 * 平文メールの組み立て(src/lib/mail-message.ts)。Workers のテナント SMTP(lib/smtp-client.ts)が DATA に流す本文。
 * 符号化(RFC 2047 の encoded-word・base64 の本文)、CRLF、dot-stuffing、ヘッダの注入の拒否を見る。
 */

import { describe, expect, it } from "vitest";
import {
  buildPlainTextMessage,
  dotStuff,
  encodeBody,
  encodeSubject,
  encodeWords,
  formatMailbox,
  formatRfc5322Date,
  MailMessageError,
  parseMailbox,
} from "../src/lib/mail-message.js";

/** encoded-word(B)を復号する(テスト用。語ごとに復号してつなぐ = 多くのメールソフトの読み方)。 */
function decodeWords(value: string): string {
  const words = value.split(/\r\n | /).filter((w) => w !== "");
  return words
    .map((word) => {
      const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/.exec(word);
      if (m === null) throw new Error(`not an encoded-word: ${word}`);
      const bytes = Uint8Array.from(atob(m[1] ?? ""), (c) => c.charCodeAt(0));
      // fatal: 語の境目で文字が割れていたら例外になる
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    })
    .join("");
}

describe("encodeWords / encodeSubject", () => {
  it("長い日本語の件名を 75 文字以内の語に、UTF-8 の文字の境目で分ける", () => {
    const subject = "【KIZAMI】打刻忘れのお知らせ:2026年4月1日(水)の退勤が記録されていません。勤怠の修正を申請してください🙏";
    const words = encodeWords(subject);
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeWords(words.join(" "))).toBe(subject);
  });

  it("件名は語と語を折り返し(CRLF + 空白)でつなぐ", () => {
    const encoded = encodeSubject("あ".repeat(40));
    expect(encoded).toContain("\r\n ");
    for (const line of encoded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(decodeWords(encoded)).toBe("あ".repeat(40));
  });

  it("印字可能な ASCII だけの件名はそのまま、`=?` を含むものは符号化する", () => {
    expect(encodeSubject("Weekly report")).toBe("Weekly report");
    expect(encodeSubject("=?UTF-8?B?x?=")).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeWords(encodeSubject("=?UTF-8?B?x?="))).toBe("=?UTF-8?B?x?=");
  });

  it("件名の改行は黙って消さずに断る(ヘッダの注入)", () => {
    expect(() => encodeSubject("hello\r\nBcc: attacker@example.com")).toThrow(MailMessageError);
    expect(() => encodeSubject("hello\nX: y")).toThrow(MailMessageError);
  });

  it("空の件名も1語になる", () => {
    expect(encodeWords("")).toEqual(["=?UTF-8?B??="]);
  });
});

describe("parseMailbox / formatMailbox", () => {
  it("差出人の書き方を読む", () => {
    expect(parseMailbox("noreply@example.com")).toEqual({ address: "noreply@example.com" });
    expect(parseMailbox("<noreply@example.com>")).toEqual({ address: "noreply@example.com" });
    expect(parseMailbox("KIZAMI <noreply@example.com>")).toEqual({ name: "KIZAMI", address: "noreply@example.com" });
    expect(parseMailbox('"Acme, Inc." <noreply@example.com>')).toEqual({ name: "Acme, Inc.", address: "noreply@example.com" });
    expect(parseMailbox("株式会社サンプル <noreply@example.com>")).toEqual({ name: "株式会社サンプル", address: "noreply@example.com" });
  });

  it("読めないアドレス・改行・ASCII 以外のアドレスは断る", () => {
    for (const bad of ["", "no-at-sign", "a@b@c", "user@exa mple.com", "ユーザー@example.com", "a@example.com\r\nBcc: x@y.z", "<a@example.com"]) {
      expect(() => parseMailbox(bad), bad).toThrow(MailMessageError);
    }
  });

  it("表示名: ASCII は引用符で囲み、それ以外は encoded-word にする", () => {
    expect(formatMailbox({ address: "a@example.com" })).toBe("a@example.com");
    expect(formatMailbox({ name: 'Acme "HQ"', address: "a@example.com" })).toBe('"Acme \\"HQ\\"" <a@example.com>');
    const encoded = formatMailbox({ name: "株式会社サンプル", address: "a@example.com" });
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?= <a@example\.com>$/);
    expect(decodeWords(encoded.replace(/ <a@example\.com>$/, ""))).toBe("株式会社サンプル");
  });
});

describe("encodeBody", () => {
  it("改行を CRLF にそろえてから UTF-8 の base64 にし、76 文字ごとに折る", () => {
    const text = "1行目\n2行目\r\n3行目\r" + "長".repeat(200);
    const encoded = encodeBody(text);
    const lines = encoded.split("\r\n");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(76);
    expect(lines.slice(0, -1).every((line) => line.length === 76)).toBe(true);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(lines.join("")), (c) => c.charCodeAt(0)));
    expect(decoded).toBe("1行目\r\n2行目\r\n3行目\r\n" + "長".repeat(200));
  });
});

describe("formatRfc5322Date", () => {
  it("UTC で +0000 を付ける", () => {
    expect(formatRfc5322Date(Date.UTC(2026, 9, 7, 1, 2, 3))).toBe("Wed, 07 Oct 2026 01:02:03 +0000");
  });
});

describe("buildPlainTextMessage", () => {
  it("ヘッダ・空行・base64 の本文を CRLF で組み立てる", () => {
    const message = buildPlainTextMessage({
      from: { name: "KIZAMI", address: "noreply@example.com" },
      to: " user@example.org ",
      subject: "打刻忘れ",
      text: "本文です。\n.で始まる行",
      date: Date.UTC(2026, 9, 7, 1, 2, 3),
      messageIdLocal: "fixed-id",
    });
    const [head, body] = message.split("\r\n\r\n");
    expect(head?.split("\r\n")).toEqual([
      "Date: Wed, 07 Oct 2026 01:02:03 +0000",
      'From: "KIZAMI" <noreply@example.com>',
      "To: user@example.org",
      `Subject: ${encodeSubject("打刻忘れ")}`,
      "Message-ID: <fixed-id@example.com>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ]);
    expect(body).toBe(`${encodeBody("本文です。\n.で始まる行")}\r\n`);
    // CR / LF が単独で現れない
    expect(message.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("宛先が不正なら組み立てを断る", () => {
    expect(() => buildPlainTextMessage({ from: { address: "a@example.com" }, to: "x@y.z\r\nBcc: e@f.g", subject: "s", text: "t" })).toThrow(MailMessageError);
  });
});

describe("dotStuff", () => {
  it("行頭の `.` だけを二重にする", () => {
    expect(dotStuff(".a\r\nb.\r\n.\r\n..c\r\n")).toBe("..a\r\nb.\r\n..\r\n...c\r\n");
    expect(dotStuff("a\r\nb\r\n")).toBe("a\r\nb\r\n");
    // LF だけの改行は行頭とみなさない(本文は CRLF にそろえてから渡す前提)
    expect(dotStuff("a\n.b\r\n")).toBe("a\n.b\r\n");
  });
});
