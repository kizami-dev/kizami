/**
 * SMTP チャネル。
 *
 * ランタイム非依存の制約(要件 §7/§8: node:* を直接 import しない)を満たすため、
 * 実際の送信処理は呼び出し側が注入する `sendFn` に委譲する形にしている。
 * Node 実装(nodemailer)は apps/api 側に置く(apps/api/src/lib/smtp.ts)。
 * Cloudflare Workers 版エントリを追加する際は、fetch ベースのメール送信 API(Resend 等)を
 * 使う別の sendFn を注入すればよく、このファイル自体の変更は不要になる想定。
 */

import type { NotificationChannel, NotificationMessage } from "./types.js";

export interface SmtpChannelConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  password?: string;
  /**
   * TLS の SNI・証明書検証に使うホスト名。`host` に検査済みの IP を渡して接続するとき
   * (SSRF ガード、apps/api/src/lib/outbound-guard.ts)に、元のホスト名をここへ入れる。通常は省略。
   */
  servername?: string;
}

/** 実際の送信処理。設定とメッセージを受け取り、送信の成否は成功時 resolve / 失敗時 reject で表す。 */
export type SmtpSendFn = (config: SmtpChannelConfig, msg: NotificationMessage) => Promise<void>;

/** `config` を固定した状態の NotificationChannel を作る。送信自体は `sendFn` に委譲する。 */
export function createSmtpChannel(config: SmtpChannelConfig, sendFn: SmtpSendFn): NotificationChannel {
  return {
    name: "smtp",
    async send(msg: NotificationMessage): Promise<void> {
      await sendFn(config, msg);
    },
  };
}
