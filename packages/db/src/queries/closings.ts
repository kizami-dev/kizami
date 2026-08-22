/**
 * closing_events / closing_snapshots に対するクエリ層。
 *
 * closing_events は追記専用(punch_events と同じ思想)。現在状態(open/closed)は
 * UPDATE ではなく「その period の最新イベントが close か reopen か」から導出する
 * (docs/design/v01-data-model.md §closings(締め)と closing_snapshots)。
 */

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import { closingEvents, closingSnapshots, type ClosingSnapshotCategory } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type ClosingEvent = typeof closingEvents.$inferSelect;
export type ClosingEventKind = "close" | "reopen";
export type ClosingSnapshot = typeof closingSnapshots.$inferSelect;

export interface AppendClosingEventInput {
  tenantId: string;
  /** "YYYY-MM" */
  period: string;
  event: ClosingEventKind;
  actorId: string;
  note?: string | null;
  /** UTC エポック分 */
  occurredAt: number;
}

/** closing_events へ1件追記する(UPDATE/DELETE は行わない)。 */
export async function appendClosingEvent(db: Database | Transaction, input: AppendClosingEventInput): Promise<ClosingEvent> {
  const [row] = await db
    .insert(closingEvents)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      period: input.period,
      event: input.event,
      actorId: input.actorId,
      note: input.note ?? null,
      occurredAt: input.occurredAt,
    })
    .returning();
  if (!row) {
    throw new Error("appendClosingEvent: insert returned no row");
  }
  return row;
}

export interface ClosingState {
  period: string;
  status: "open" | "closed";
  /** 最新のイベント(1件も無ければ null = 未締め) */
  lastEvent: ClosingEvent | null;
  /** occurred_at, id 昇順(古い順) */
  history: ClosingEvent[];
}

function stateFromHistory(period: string, history: ClosingEvent[]): ClosingState {
  const lastEvent = history.length > 0 ? (history[history.length - 1] as ClosingEvent) : null;
  return {
    period,
    status: lastEvent?.event === "close" ? "closed" : "open",
    lastEvent,
    history,
  };
}

/** (tenantId, period) の現在状態を導出する。イベントが1件も無ければ open・履歴空。 */
export async function getClosingState(
  db: Database | Transaction,
  params: { tenantId: string; period: string },
): Promise<ClosingState> {
  const history = await db
    .select()
    .from(closingEvents)
    .where(and(eq(closingEvents.tenantId, params.tenantId), eq(closingEvents.period, params.period)))
    .orderBy(asc(closingEvents.occurredAt), asc(closingEvents.id));
  return stateFromHistory(params.period, history);
}

/** "YYYY-MM" を year*12+month(0-indexed month)の通し番号に変換する(暦月の列挙専用、TZ非依存)。 */
function periodToOrdinal(period: string): number {
  const parts = period.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  return year * 12 + (month - 1);
}

function ordinalToPeriod(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year}-${month < 10 ? `0${month}` : `${month}`}`;
}

/** [from, to] (共に "YYYY-MM"、inclusive) の暦月を昇順で列挙する。 */
function enumeratePeriods(from: string, to: string): string[] {
  const fromOrd = periodToOrdinal(from);
  const toOrd = periodToOrdinal(to);
  const result: string[] = [];
  for (let ord = fromOrd; ord <= toOrd; ord++) {
    result.push(ordinalToPeriod(ord));
  }
  return result;
}

/**
 * [from, to] (inclusive) の全月について状態を返す(イベントが無い月も open として含める)。
 * 呼び出し側(GET /closings)が月ごとに個別クエリを発行しなくて済むよう、範囲全体をまとめて返す。
 */
export async function listClosingStates(
  db: Database,
  params: { tenantId: string; from: string; to: string },
): Promise<ClosingState[]> {
  const rows = await db
    .select()
    .from(closingEvents)
    .where(
      and(
        eq(closingEvents.tenantId, params.tenantId),
        gte(closingEvents.period, params.from),
        lte(closingEvents.period, params.to),
      ),
    )
    .orderBy(asc(closingEvents.occurredAt), asc(closingEvents.id));

  const historyByPeriod = new Map<string, ClosingEvent[]>();
  for (const row of rows) {
    const list = historyByPeriod.get(row.period) ?? [];
    list.push(row);
    historyByPeriod.set(row.period, list);
  }

  return enumeratePeriods(params.from, params.to).map((period) => stateFromHistory(period, historyByPeriod.get(period) ?? []));
}

export interface NewClosingSnapshotInput {
  tenantId: string;
  closingEventId: string;
  userId: string;
  category: ClosingSnapshotCategory;
  minutes: number;
}

/** closing_snapshots へまとめて追記する(締め確定時に1テナント分をまとめて渡す想定)。 */
export async function saveClosingSnapshots(db: Database | Transaction, snapshots: NewClosingSnapshotInput[]): Promise<void> {
  if (snapshots.length === 0) return;
  await db.insert(closingSnapshots).values(
    snapshots.map((s) => ({
      id: uuidv7(),
      tenantId: s.tenantId,
      closingEventId: s.closingEventId,
      userId: s.userId,
      category: s.category,
      minutes: s.minutes,
    })),
  );
}

/**
 * (tenantId, period) の「直近の close イベント」に紐づくスナップショットを全ユーザー分返す。
 * period が一度も締められていなければ空配列。reopen 後で現在は open でも、直近の close 時点の
 * スナップショットは残っているためそのまま返す(呼び出し側は getClosingState の status を見て
 * 「closed のときだけ呼ぶ」運用を想定 — apps/api/src/routes/attendance.ts・exports.ts 参照)。
 */
export async function getClosingSnapshots(
  db: Database,
  params: { tenantId: string; period: string },
): Promise<ClosingSnapshot[]> {
  const [latestClose] = await db
    .select()
    .from(closingEvents)
    .where(
      and(
        eq(closingEvents.tenantId, params.tenantId),
        eq(closingEvents.period, params.period),
        eq(closingEvents.event, "close"),
      ),
    )
    .orderBy(desc(closingEvents.occurredAt), desc(closingEvents.id))
    .limit(1);

  if (!latestClose) return [];

  return db.select().from(closingSnapshots).where(eq(closingSnapshots.closingEventId, latestClose.id));
}

/**
 * 複数ユーザーについて、直近の close イベントのスナップショットをまとめて返す
 * (CSVエクスポートが対象範囲のユーザーをまとめて出力するため)。userId → snapshot[] のマップ。
 * closingEventId がユーザーごとに異なる可能性は無い(締めはテナント単位で単一イベント)ため、
 * getClosingSnapshots と同じ「直近の close」を1回だけ引いてから user_id で絞る。
 */
export async function getClosingSnapshotsForUsers(
  db: Database,
  params: { tenantId: string; period: string; userIds: string[] },
): Promise<Map<string, ClosingSnapshot[]>> {
  const all = await getClosingSnapshots(db, { tenantId: params.tenantId, period: params.period });
  const userIdSet = new Set(params.userIds);
  const map = new Map<string, ClosingSnapshot[]>();
  for (const row of all) {
    if (!userIdSet.has(row.userId)) continue;
    const list = map.get(row.userId) ?? [];
    list.push(row);
    map.set(row.userId, list);
  }
  return map;
}
