/**
 * punch_events に対する最小限のクエリ層。
 *
 * - insertPunchEvent: 追記のみ(UPDATE/DELETE は行わない)
 * - listValidPunches: 有効打刻(他イベントの supersedes_id に参照されておらず kind != 'void')のみを
 *   occurred_at 昇順で返す
 */

import { and, asc, eq, gte, lte, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Database } from "../migrate.js";
import { punchEvents } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type NewPunchEvent = Omit<typeof punchEvents.$inferInsert, "id"> & { id?: string };
export type PunchEvent = typeof punchEvents.$inferSelect;

/** punch_events へ1件追記する。id を渡さなければ UUIDv7 を生成する。 */
export async function insertPunchEvent(db: Database, event: NewPunchEvent): Promise<PunchEvent> {
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
 */
export async function listValidPunches(db: Database, params: ListValidPunchesParams): Promise<PunchEvent[]> {
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
