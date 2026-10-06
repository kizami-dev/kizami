/**
 * 平文テキストのメール(RFC 5322 + MIME)を組み立てる(ランタイム非依存、2026-10-07)。
 *
 * Workers のテナント SMTP(lib/smtp-client.ts)が DATA で送る本文を作る。Node は nodemailer が同じことを
 * するのでここを使わない。KIZAMI が送るメールは「件名 + 平文の本文」だけ(通知・システムメール)なので、
 * HTML・添付・multipart は持たない(判断点: 使わない機能の分だけ壊れ方が増える)。
 *
 * ## 作るもの
 *
 * ```
 * Date: Wed, 07 Oct 2026 01:23:45 +0000
 * From: =?UTF-8?B?…?= <noreply@example.com>
 * To: user@example.com
 * Subject: =?UTF-8?B?…?=
 *  =?UTF-8?B?…?=
 * Message-ID: <uuid@example.com>
 * MIME-Version: 1.0
 * Content-Type: text/plain; charset=UTF-8
 * Content-Transfer-Encoding: base64
 *
 * 5pys5paH…(76 文字ごとに改行)
 * ```
 *
 * - 改行はすべて CRLF(本文の LF / CR も CRLF にそろえてから符号化する)
 * - 件名・表示名は ASCII の印字可能文字だけならそのまま、そうでなければ RFC 2047 の encoded-word(B 符号化)。
 *   1語 75 文字以内に収まるよう **UTF-8 の文字の境目で**分け、語と語は折り返し(CRLF + 空白)でつなぐ
 * - 本文は base64(判断点: quoted-printable より長くなるが、日本語の本文では差が小さく、行頭の `.`・行末の空白・
 *   長い行といった SMTP の落とし穴がすべて消える)
 * - **ヘッダの注入を防ぐ**: アドレス・件名・表示名に CR / LF が含まれていたら組み立てを断る
 *   (件名は encoded-word にしても、元の文字列の改行は呼び出し側の誤りなので黙って消さない)
 * - アドレスは ASCII だけを受ける(SMTPUTF8 は扱わない。国際化ドメインは punycode で登録してもらう)
 *
 * DATA に流すときの行頭の `.` の二重化(dot-stuffing)は `dotStuff()`。base64 と encoded-word の行は `.` で
 * 始まらないが、ヘッダの値の折り返しなどで将来 `.` から始まる行が生まれても壊れないよう、送る直前に必ず通す。
 */

/** メールアドレス(ASCII のみ。局所部・ドメインに空白・山括弧・引用符・カンマ等を含まない)。 */
const ADDRESS_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

export class MailMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailMessageError";
  }
}

export interface Mailbox {
  /** 表示名(無ければ undefined) */
  name?: string;
  /** アドレス(エンベロープの MAIL FROM / RCPT TO にもこれを使う) */
  address: string;
}

function assertNoLineBreak(value: string, what: string): void {
  if (/[\r\n]/.test(value)) throw new MailMessageError(`${what} must not contain a line break`);
}

/** アドレスを検査して返す(前後の空白は落とす)。 */
export function normalizeAddress(value: string, what = "address"): string {
  const address = value.trim();
  assertNoLineBreak(address, what);
  if (!ADDRESS_RE.test(address)) throw new MailMessageError(`${what} is not a valid ASCII email address`);
  return address;
}

/**
 * `"表示名" <addr>` / `表示名 <addr>` / `<addr>` / `addr` を読む(差出人の設定値。テナントの smtpFrom・SYSTEM_MAIL_FROM)。
 * 読めなければ MailMessageError。
 */
export function parseMailbox(value: string, what = "address"): Mailbox {
  const trimmed = value.trim();
  assertNoLineBreak(trimmed, what);
  const angle = /^(.*?)\s*<([^<>]+)>$/.exec(trimmed);
  if (angle === null) return { address: normalizeAddress(trimmed, what) };
  let name = (angle[1] ?? "").trim();
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, "$1");
  const address = normalizeAddress(angle[2] ?? "", what);
  return name === "" ? { address } : { name, address };
}

const encoder = new TextEncoder();

/** バイト列を base64 に(btoa は Latin-1 の文字列しか受けないので、1バイト1文字の文字列を経由する)。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 文字列を UTF-8 で base64 に。 */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(encoder.encode(text));
}

/** 印字可能な ASCII(空白を含む)だけか。 */
function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/** encoded-word 1語に入る UTF-8 のバイト数。`=?UTF-8?B?` + `?=` の 12 文字を除いた 63 文字 → 4 の倍数の 60 文字 = 45 バイト。 */
const ENCODED_WORD_MAX_BYTES = 45;

/**
 * RFC 2047 の encoded-word(B 符号化)の列にする。1語 75 文字以内、UTF-8 の文字の境目でだけ分ける
 * (多バイト文字を2語にまたがらせると、語ごとに復号するメールソフトで化ける)。
 */
export function encodeWords(value: string): string[] {
  const words: string[] = [];
  let current: number[] = [];
  for (const char of value) {
    const bytes = encoder.encode(char);
    if (current.length + bytes.length > ENCODED_WORD_MAX_BYTES && current.length > 0) {
      words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(current))}?=`);
      current = [];
    }
    current.push(...bytes);
  }
  if (current.length > 0 || words.length === 0) words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(current))}?=`);
  return words;
}

/** ASCII だけでそのまま書ける件名の上限(これより長い件名は encoded-word にして折り返す)。 */
const RAW_SUBJECT_MAX = 900;

/** 件名のヘッダ値(折り返しを含む)。 */
export function encodeSubject(subject: string): string {
  assertNoLineBreak(subject, "subject");
  // `=?` を含む ASCII はメールソフトが encoded-word と誤読しうるので、符号化に回す
  if (isPrintableAscii(subject) && !subject.includes("=?") && subject.length <= RAW_SUBJECT_MAX) return subject;
  return encodeWords(subject).join("\r\n ");
}

/** From / To のヘッダ値。 */
export function formatMailbox(mailbox: Mailbox): string {
  if (mailbox.name === undefined || mailbox.name === "") return mailbox.address;
  assertNoLineBreak(mailbox.name, "display name");
  if (isPrintableAscii(mailbox.name) && !mailbox.name.includes("=?")) {
    // 引用符で囲む(`,` `;` などの特殊文字を含んでも1つの表示名として読ませる)
    return `"${mailbox.name.replace(/(["\\])/g, "\\$1")}" <${mailbox.address}>`;
  }
  return `${encodeWords(mailbox.name).join(" ")} <${mailbox.address}>`;
}

/** RFC 5322 の日時(UTC、`+0000`)。 */
export function formatRfc5322Date(epochMs: number): string {
  const d = new Date(epochMs);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

/** 本文を CRLF にそろえて UTF-8 の base64 にし、76 文字ごとに改行する。 */
export function encodeBody(text: string): string {
  const normalized = text.replace(/\r\n|\r|\n/g, "\r\n");
  const base64 = utf8ToBase64(normalized);
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 76) lines.push(base64.slice(i, i + 76));
  return lines.join("\r\n");
}

export interface PlainTextMail {
  from: Mailbox;
  to: string;
  subject: string;
  text: string;
  /** Date ヘッダ(ミリ秒)。テスト用。既定は今 */
  date?: number;
  /** Message-ID の左側。テスト用。既定は crypto.randomUUID() */
  messageIdLocal?: string;
}

/** メッセージ全体(ヘッダ + 空行 + 本文、末尾 CRLF)。DATA に流す前に `dotStuff()` を通すこと。 */
export function buildPlainTextMessage(mail: PlainTextMail): string {
  const to = normalizeAddress(mail.to, "recipient");
  const fromAddress = normalizeAddress(mail.from.address, "sender");
  const domain = fromAddress.slice(fromAddress.lastIndexOf("@") + 1);
  const headers = [
    `Date: ${formatRfc5322Date(mail.date ?? Date.now())}`,
    `From: ${formatMailbox({ ...mail.from, address: fromAddress })}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Message-ID: <${mail.messageIdLocal ?? crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${encodeBody(mail.text)}\r\n`;
}

/**
 * DATA の本文の行頭の `.` を二重にする(RFC 5321 4.5.2)。`message` は CRLF 区切りで末尾が CRLF であること。
 * 終端の `.` 行は付けない(送る側が `.\r\n` を足す)。
 */
export function dotStuff(message: string): string {
  return message.replace(/(^|\r\n)\./g, "$1..");
}
