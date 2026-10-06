/**
 * SMTP チャネルの Node 実装(nodemailer)。
 *
 * @kizami/notify の smtpChannel はランタイム非依存の制約(node:* 不使用)から
 * 「送信関数を注入する」形(createSmtpChannel(config, sendFn))になっている。ここではその
 * sendFn を nodemailer で実装し、Node ランタイム(src/worker.ts のリマインドスキャン、
 * src/routes/settings.ts のテスト送信)から注入して使う。
 *
 * Cloudflare Workers では nodemailer(node:net 依存)が動かないので、`cloudflare:sockets` の上の自前の
 * SMTP クライアント(lib/smtp-client.ts + lib/workers-smtp-socket.ts)を workers.ts が注入する
 * (2026-10-07。packages/notify 側は変更なし)。
 */

import nodemailer from "nodemailer";
import type { NotificationMessage, SmtpChannelConfig, SmtpSendFn } from "@kizami/notify";

export const nodemailerSendFn: SmtpSendFn = async (config: SmtpChannelConfig, msg: NotificationMessage): Promise<void> => {
  const to = msg.to.email;
  if (!to) {
    throw new Error("nodemailerSendFn: message has no recipient email address");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    // SSRF ガードが host を検査済みの IP に差し替えたときの、TLS の検証に使う元のホスト名
    ...(config.servername !== undefined ? { servername: config.servername } : {}),
    ...(config.user !== undefined && config.password !== undefined
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
  });

  await transporter.sendMail({ from: config.from, to, subject: msg.title, text: msg.body });
};
