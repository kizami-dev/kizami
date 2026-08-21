/**
 * Slack/Discord 互換 Webhook チャネル。
 *
 * どちらの Webhook 種別かをこちら側で判別せずに済むよう、Slack が読む `text` と
 * Discord が読む `content` の両方に同じ本文を入れて POST する(双方とも自分が使わない
 * キーは無視するため、両立できる)。
 */

import type { NotificationChannel, NotificationMessage } from "./types.js";

export interface WebhookChannelOptions {
  /** fetch の差し替え(テスト用)。省略時はグローバル fetch を使う */
  fetchImpl?: typeof fetch;
}

export function webhookChannel(url: string, options: WebhookChannelOptions = {}): NotificationChannel {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "webhook",
    async send(msg: NotificationMessage): Promise<void> {
      const text = `${msg.title}\n${msg.body}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, text }),
      });
      if (!res.ok) {
        throw new Error(`webhookChannel: POST ${url} responded ${res.status}`);
      }
    },
  };
}
