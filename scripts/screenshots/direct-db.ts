/**
 * スクリーンショット用シードのうち、HTTP では作れなくなった「過去日の打刻」を一時 DB へ直接書く。
 *
 * POST /punches はサーバー時刻の5分前〜1分先の打刻しか受け付けない(セキュリティ診断 M6、
 * apps/api/src/routes/punches.ts の PUNCH_PAST_GRACE_MINUTES)。デモの勤怠(先月・今月の過去の日)は
 * それより前の時刻なので、API と同じ一時 SQLite へ、打刻1件ずつ insertPunchEvent で入れる。
 * 本人が Web で押した打刻と同じ形(source="web"・actor=本人・受理時刻=打刻時刻)にする。
 *
 * 直接書くのは seed-http.ts の流れの中で(その打刻を前提に修正申請・締めを HTTP で続けるため)、
 * 書き込みは1件ずつ順に行う(API プロセスと同じファイルを開くが、同時には書かない)。
 * `@kizami/db` はルートから解決できないので、ソースを相対パスで読み込む(依存は packages/db 側で解決される)。
 */
import { createDatabase, insertPunchEvent, type Database } from "../../packages/db/src/node.ts";

export type BackdatedPunchWriter = (input: {
  userId: string;
  kind: string;
  occurredAt: number;
}) => Promise<{ id: string; kind: string; occurredAt: number }>;

export async function openBackdatedPunchWriter(databaseUrl: string): Promise<{ write: BackdatedPunchWriter; close: () => Promise<void> }> {
  const handle = await createDatabase(databaseUrl);
  const db: Database = handle.db;
  const tenantByUser = new Map<string, string>();

  const write: BackdatedPunchWriter = async ({ userId, kind, occurredAt }) => {
    let tenantId = tenantByUser.get(userId);
    if (!tenantId) {
      // drizzle-orm もルートからは解決できないので、テナントは素の SQL で引く(id は uuid のみ許す)
      if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error(`unexpected user id: ${userId}`);
      const { rows } = await handle.client.execute(`SELECT tenant_id FROM users WHERE id = '${userId}' LIMIT 1`);
      const value = rows[0]?.tenant_id;
      tenantId = typeof value === "string" ? value : undefined;
      if (!tenantId) throw new Error(`user ${userId} not found in the seed DB`);
      tenantByUser.set(userId, tenantId);
    }
    const event = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind,
      occurredAt,
      recordedAt: occurredAt,
      source: "web",
      actorId: userId,
      metaIp: null,
      metaUa: null,
      metaGpsLat: null,
      metaGpsLng: null,
    });
    return { id: event.id, kind: event.kind, occurredAt: event.occurredAt };
  };

  return { write, close: () => handle.client.close() };
}
