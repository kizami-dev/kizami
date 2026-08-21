/**
 * KIZAMI 通知チャネル抽象。
 *
 * 制約(要件 §7/§8): ランタイム非依存。node:* を直接 import せず、fetch と設定注入
 * (URL・認証情報など)のみに依存する。Node からも Cloudflare Workers からも同じ
 * チャネル実装を呼べるようにするため。
 */

export interface NotificationRecipient {
  /** 通知先メールアドレス(smtpChannel が使う。webhookChannel は無視してよい) */
  email?: string;
}

export interface NotificationMessage {
  to: NotificationRecipient;
  title: string;
  body: string;
}

export interface NotificationChannel {
  /** チャネル種別の識別子(ログ・dispatch の結果集計に使う) */
  name: string;
  send(msg: NotificationMessage): Promise<void>;
}

export interface DispatchResult {
  channel: string;
  ok: boolean;
  /** ok=false のときの失敗理由(送信元チャネルが投げた値をそのまま保持する) */
  error?: unknown;
}
