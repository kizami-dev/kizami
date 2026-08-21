/**
 * 複数チャネルへの送信をまとめて行う。
 *
 * 1チャネルの失敗が他チャネルの送信を止めないよう Promise.allSettled で並行実行し、
 * 各チャネルの成否を配列で返す(呼び出し側がログ・リトライ判断に使えるように)。
 */

import type { DispatchResult, NotificationChannel, NotificationMessage } from "./types.js";

export async function dispatch(channels: NotificationChannel[], msg: NotificationMessage): Promise<DispatchResult[]> {
  const settled = await Promise.allSettled(channels.map((channel) => channel.send(msg)));

  return settled.map((result, i) => {
    const channel = channels[i] as NotificationChannel;
    if (result.status === "fulfilled") {
      return { channel: channel.name, ok: true };
    }
    return { channel: channel.name, ok: false, error: result.reason };
  });
}
