/**
 * システムメール(運用者名義のメール)の、Cloudflare Email Service の Workers バインディングでの送信(2026-10-07)。
 *
 * Node は `SYSTEM_SMTP_URL` の SMTP へ nodemailer で送る(lib/system-mail.ts)。Workers は nodemailer が動かないので、
 * Email Service の `send_email` バインディング(`env.EMAIL.send()`、構造化の送信 API)で送る。送信関数の型は
 * Node と同じ `SystemMailSendFn` なので、使う側(サインアップ・本人用のパスワード再設定・退会のメール)は変わらない。
 *
 * - **設定**: `apps/api/wrangler.jsonc` の `send_email: [{ name: "EMAIL" }]` + vars の `SYSTEM_MAIL_FROM` /
 *   `APP_BASE_URL`。3つが揃ったときだけ「システムメールがある配備」になる(Node の3つ — SYSTEM_SMTP_URL /
 *   SYSTEM_MAIL_FROM / APP_BASE_URL — の SMTP の URL がバインディングに置き換わった形)
 * - 差出人のドメインは Email Sending に登録(onboard)済みであること(`wrangler email sending enable <domain>`)。
 *   未登録なら送信が `E_SENDER_NOT_VERIFIED` などで失敗する(送信の失敗は呼び出し側が握る — 従来どおり)
 * - `SYSTEM_MAIL_FROM` は `noreply@example.com` か `KIZAMI <noreply@example.com>`。表示名はバインディングの
 *   `{ email, name }` で渡す(ヘッダの組み立ては Email Service に任せる)
 * - 本文は平文だけ(`text`)。KIZAMI のシステムメールは平文で作っている(lib/system-mail-i18n.ts)
 *
 * このファイルは `cloudflare:*` を import しない(バインディングは引数で受ける)ので、Node のテストから偽の
 * バインディングで検査できる。バインディングの型は使う面だけを構造的に宣言する(@cloudflare/workers-types を
 * 型解決に持ち込まない — packages/db/src/d1.ts と同じ判断)。
 */

import { parseMailbox, type Mailbox } from "./mail-message.js";
import { present } from "./system-mail-config.js";
import type { SystemMailSendFn } from "./system-mail.js";

/** `send_email` バインディングの、使う面だけ(構造化の `send()`)。 */
export interface EmailSendBinding {
  send(message: {
    to: string;
    from: string | { email: string; name?: string };
    subject: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

/** Email Service の送信の失敗(バインディングが投げた `code` を残す。`E_SENDER_NOT_VERIFIED` など)。 */
export class EmailServiceSendError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined, cause: unknown) {
    super(message, { cause });
    this.name = "EmailServiceSendError";
    this.code = code;
  }
}

/** バインディングで1通送る `SystemMailSendFn` を作る。 */
export function createEmailServiceMailSender(params: { binding: EmailSendBinding; from: Mailbox }): SystemMailSendFn {
  const from = params.from.name !== undefined ? { email: params.from.address, name: params.from.name } : params.from.address;
  return async (mail) => {
    try {
      await params.binding.send({ to: mail.to, from, subject: mail.subject, text: mail.text });
    } catch (err) {
      const code = typeof (err as { code?: unknown })?.code === "string" ? ((err as { code: string }).code) : undefined;
      const message = err instanceof Error ? err.message : String(err);
      throw new EmailServiceSendError(`email service send failed${code !== undefined ? ` (${code})` : ""}: ${message}`, code, err);
    }
  };
}

export interface EmailServiceMailConfig {
  sendMail: SystemMailSendFn;
  /** メール内リンクの組み立てに使う Web のベース URL(末尾スラッシュ無し) */
  appBaseUrl: string;
}

export interface EmailServiceMailEnvResult {
  /** バインディング・SYSTEM_MAIL_FROM・APP_BASE_URL が揃っていて形式も正しいときだけ非 null */
  config: EmailServiceMailConfig | null;
  /** 欠けているもの(`EMAIL` はバインディング) */
  missing: string[];
  /** 値はあるが形式が不正なものの説明 */
  errors: string[];
}

/**
 * Workers の env からシステムメールの設定を読む(lib/system-mail-config.ts の parseSystemMailEnv の Workers 版)。
 * fail-fast はしない(判定材料を返すだけ — Node と同じ。workers.ts が警告を出す)。
 */
export function parseEmailServiceMailEnv(env: { EMAIL?: unknown; SYSTEM_MAIL_FROM?: string; APP_BASE_URL?: string }): EmailServiceMailEnvResult {
  const missing: string[] = [];
  const binding = env.EMAIL;
  const hasBinding = typeof binding === "object" && binding !== null && typeof (binding as { send?: unknown }).send === "function";
  if (!hasBinding) missing.push("EMAIL");
  if (!present(env.SYSTEM_MAIL_FROM)) missing.push("SYSTEM_MAIL_FROM");
  if (!present(env.APP_BASE_URL)) missing.push("APP_BASE_URL");

  const errors: string[] = [];
  let from: Mailbox | null = null;
  if (present(env.SYSTEM_MAIL_FROM)) {
    try {
      from = parseMailbox(env.SYSTEM_MAIL_FROM, "SYSTEM_MAIL_FROM");
    } catch {
      errors.push('SYSTEM_MAIL_FROM must be an email address or "Name <address>"');
    }
  }
  const baseUrl = env.APP_BASE_URL?.trim();
  if (baseUrl && !/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
    errors.push("APP_BASE_URL must be an absolute http(s) URL (e.g. https://app.kizami.dev)");
  }

  if (missing.length > 0 || errors.length > 0 || from === null || !baseUrl) return { config: null, missing, errors };
  return {
    config: {
      sendMail: createEmailServiceMailSender({ binding: binding as EmailSendBinding, from }),
      appBaseUrl: baseUrl.replace(/\/+$/, ""),
    },
    missing,
    errors,
  };
}
