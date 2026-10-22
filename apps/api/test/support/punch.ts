/**
 * テスト用: 打刻を「その打刻時刻に押したこと」にして POST /punches する。
 *
 * POST /punches はクライアント指定の occurredAt をサーバー現在時刻の前後わずかな幅
 * (PUNCH_PAST_GRACE_MINUTES / PUNCH_FUTURE_SKEW_MINUTES、apps/api/src/routes/punches.ts)
 * しか受け付けない。過去の月の勤怠を組み立てるテストは、リクエストの間だけシステム時刻を
 * occurredAt に合わせ、終わったら元に戻す(本番の打刻と同じく「いま押した」打刻になる)。
 * occurredAt を省略した場合や JSON でない場合は時刻を動かさずにそのまま送る。
 */
import { vi } from "vitest";

interface RequestLike {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}

export async function requestPunch(app: RequestLike, init: RequestInit): Promise<Response> {
  let occurredAt: unknown;
  try {
    occurredAt = typeof init.body === "string" ? (JSON.parse(init.body) as { occurredAt?: unknown }).occurredAt : undefined;
  } catch {
    occurredAt = undefined;
  }
  if (typeof occurredAt !== "number" || !Number.isInteger(occurredAt)) {
    return app.request("/punches", init);
  }

  const wasFake = vi.isFakeTimers();
  const previousNow = Date.now();
  if (!wasFake) {
    vi.useFakeTimers({ toFake: ["Date"] });
  }
  vi.setSystemTime(occurredAt * 60_000);
  try {
    return await app.request("/punches", init);
  } finally {
    if (wasFake) {
      vi.setSystemTime(previousNow);
    } else {
      vi.useRealTimers();
    }
  }
}
