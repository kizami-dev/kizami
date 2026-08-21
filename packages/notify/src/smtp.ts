/**
 * SMTP チャネル(スタブ)。
 *
 * TODO(v0.2時点で未実装): docs/requirements.md §7 のメール(SMTP)チャネル本体。
 * NotificationChannel の形だけをここで確定させ、呼び出し側(apps/api の worker/reminders)を
 * 先に組めるようにする。実装時はランタイム非依存の制約(node:net 等を直接使わない)を
 * どう満たすか — fetch ベースのメール送信 API(Resend 等)に寄せるか、Workers 非対応を
 * 受け入れて Node 側だけ node:net 実装を差し替え可能にするか — を先に決める。
 */

import type { NotificationChannel, NotificationMessage } from "./types.js";

export interface SmtpChannelOptions {
  host: string;
  port: number;
  from: string;
}

export function smtpChannel(_options: SmtpChannelOptions): NotificationChannel {
  return {
    name: "smtp",
    // biome/eslint 等は付けていないリポジトリだが、未使用引数であることを明示する
    async send(_msg: NotificationMessage): Promise<void> {
      throw new Error("smtpChannel is not implemented yet (v0.2 stub — see TODO in packages/notify/src/smtp.ts)");
    },
  };
}
