/**
 * システムメール(運用者名義の、テナントに属さないメール)の送信。
 *
 * 既存の SMTP(lib/smtp.ts / tenant_notification_settings)は**テナント単位の通知チャネル設定**で、
 * 「そのテナントの管理者が自社の SMTP を登録する」ためのもの。サインアップ確認メールは
 * テナントがまだ存在しない時点で、運用者の名義で出す必要があるので別系統にする。
 *
 * - 接続先は環境変数 `SYSTEM_SMTP_URL`(`smtp://user:pass@host:587` / `smtps://...:465`)、
 *   差出人は `SYSTEM_MAIL_FROM`。送信先は Cloudflare Email Service や Amazon SES などの
 *   SMTP 送信を想定しているが、汎用の SMTP として書いてありサービス固有の処理は無い
 * - 送信関数(`SystemMailSendFn`)は注入可能。routes/signup.ts は型だけに依存し、実装
 *   (`createSystemMailSender`)は node.ts が渡す。テストは偽の送信関数を差し込んで実送信しない
 * - nodemailer は node:net 依存で workerd では動かない。このファイルを routes/ から**値として
 *   import しない**こと(型のみ)。Workers エントリは signup を常に無効にしている(workers.ts)
 */

import nodemailer from "nodemailer";

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
}

/** 1通送る。失敗は例外(呼び出し側が握る)。 */
export type SystemMailSendFn = (mail: SystemMail) => Promise<void>;

/**
 * nodemailer 実装の送信関数を作る。transport は URL ごとに1度だけ作って使い回す
 * (smtps:// なら TLS、smtp:// なら STARTTLS の可否は nodemailer が接続先と交渉する)。
 */
export function createSystemMailSender(params: { smtpUrl: string; from: string }): SystemMailSendFn {
  const transporter = nodemailer.createTransport(params.smtpUrl);
  return async (mail) => {
    await transporter.sendMail({ from: params.from, to: mail.to, subject: mail.subject, text: mail.text });
  };
}
