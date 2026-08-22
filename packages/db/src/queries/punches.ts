/**
 * punch_events に対する最小限のクエリ層。
 *
 * - insertPunchEvent: 追記のみ(UPDATE/DELETE は行わない)
 * - listValidPunches: 有効打刻(他イベントの supersedes_id に参照されておらず kind != 'void')のみを
 *   occurred_at 昇順で返す
 */

import { and, asc, eq, gte, lte, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Database, Transaction } from "../migrate.js";
import { punchEvents } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type NewPunchEvent = Omit<typeof punchEvents.$inferInsert, "id"> & { id?: string };
export type PunchEvent = typeof punchEvents.$inferSelect;

/**
 * punch_events へ1件追記する。id を渡さなければ UUIDv7 を生成する。
 * トランザクション内(修正申請の承認反映等)からも呼べるよう `Database | Transaction` を受け取る。
 */
export async function insertPunchEvent(db: Database | Transaction, event: NewPunchEvent): Promise<PunchEvent> {
  const id = event.id ?? uuidv7();
  const [row] = await db
    .insert(punchEvents)
    .values({ ...event, id })
    .returning();
  if (!row) {
    throw new Error("insertPunchEvent: insert returned no row");
  }
  return row;
}

export interface ListValidPunchesParams {
  tenantId: string;
  userId: string;
  /** UTC エポック分(inclusive) */
  fromMinutes: number;
  /** UTC エポック分(inclusive) */
  toMinutes: number;
}

/**
 * 有効打刻(他イベントの supersedes_id に参照されておらず、kind != 'void')のみを
 * occurred_at 昇順で返す。
 *
 * `Database | Transaction` を受け取る(apps/api/src/lib/closing-amend.ts が締め後修正の
 * 反映と同一トランザクションで月次を再計算するために必要)。
 */
export async function listValidPunches(db: Database | Transaction, params: ListValidPunchesParams): Promise<PunchEvent[]> {
  const superseding = alias(punchEvents, "superseding");

  return db
    .select()
    .from(punchEvents)
    .where(
      and(
        eq(punchEvents.tenantId, params.tenantId),
        eq(punchEvents.userId, params.userId),
        gte(punchEvents.occurredAt, params.fromMinutes),
        lte(punchEvents.occurredAt, params.toMinutes),
        ne(punchEvents.kind, "void"),
        notExists(
          db.select({ id: superseding.id }).from(superseding).where(eq(superseding.supersedesId, punchEvents.id)),
        ),
      ),
    )
    .orderBy(asc(punchEvents.occurredAt));
}

/** id で1件取得する(有効性は問わない)。修正申請の「取消」承認時に対象の occurred_at を読むために使う。 */
export async function getPunchEventById(db: Database, id: string): Promise<PunchEvent | null> {
  const rows = await db.select().from(punchEvents).where(eq(punchEvents.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface GetValidPunchEventParams {
  tenantId: string;
  userId: string;
  id: string;
}

/**
 * (tenantId, userId) にスコープした「有効打刻」を id 指定で1件取得する。
 * 存在しない・他人のもの・既に無効化(supersede/void)済みのいずれかなら null。
 * 修正申請の作成時、target_event_id が「自分の有効打刻」であることの検証に使う。
 */
export async function getValidPunchEvent(db: Database, params: GetValidPunchEventParams): Promise<PunchEvent | null> {
  const superseding = alias(punchEvents, "superseding");

  const rows = await db
    .select()
    .from(punchEvents)
    .where(
      and(
        eq(punchEvents.id, params.id),
        eq(punchEvents.tenantId, params.tenantId),
        eq(punchEvents.userId, params.userId),
        ne(punchEvents.kind, "void"),
        notExists(
          db.select({ id: superseding.id }).from(superseding).where(eq(superseding.supersedesId, punchEvents.id)),
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
