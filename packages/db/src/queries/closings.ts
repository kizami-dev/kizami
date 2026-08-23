/**
 * closing_events / closing_snapshots に対するクエリ層。
 *
 * closing_events は追記専用(punch_events と同じ思想)。現在状態(open/closed)は
 * UPDATE ではなく「その period の最新イベントが close か reopen か」から導出する
 * (docs/design/v01-data-model.md §closings(締め)と closing_snapshots)。
 */

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Database, Transaction } from "../migrate.js";
import {
  ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX,
  closingEvents,
  closingSnapshots,
  type ClosingSnapshotCategory,
} from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type ClosingEvent = typeof closingEvents.$inferSelect;
/** close(締め) / reopen(解除) / amend(締め後修正の反映。締め状態は closed のまま) */
export type ClosingEventKind = "close" | "reopen" | "amend";
export type ClosingSnapshot = typeof closingSnapshots.$inferSelect;

/** getClosingSnapshots / getClosingSnapshotHistory が「現在の世代」とみなすイベント種別。 */
const SNAPSHOT_GENERATION_EVENTS = ["close", "amend"] as const;

export interface AppendClosingEventInput {
  tenantId: string;
  /** "YYYY-MM" */
  period: string;
  event: ClosingEventKind;
  actorId: string;
  note?: string | null;
  /** event='amend' かつ由来が打刻修正申請の場合のみ。それ以外は null */
  correctionRequestId?: string | null;
  /** event='amend' かつ由来が休暇申請の場合のみ。それ以外は null */
  leaveRequestId?: string | null;
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
      correctionRequestId: input.correctionRequestId ?? null,
      leaveRequestId: input.leaveRequestId ?? null,
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

/**
 * status は「直近の close/reopen イベント」から導出する(amend は締めを解除しないため無視する)。
 * lastEvent は履歴の本当の末尾(amend を含みうる) — 「誰が最後に触ったか」の表示に使う。
 */
function stateFromHistory(period: string, history: ClosingEvent[]): ClosingState {
  const lastEvent = history.length > 0 ? (history[history.length - 1] as ClosingEvent) : null;
  let status: "open" | "closed" = "open";
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i] as ClosingEvent;
    if (event.event === "close") {
      status = "closed";
      break;
    }
    if (event.event === "reopen") {
      status = "open";
      break;
    }
    // event.event === "amend": 締め状態を左右しないのでスキップし、さらに遡る
  }
  return {
    period,
    status,
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
  /**
   * ClosingSnapshotCategory(固定5+3+2種)、または手当の動的区分
   * `` `${typeof ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX}${definitionId}` ``
   * (schema/closings.ts のコメント参照。テンプレートリテラル型で「allowance: で始まる文字列」に
   * 絞ることで、無関係な任意文字列が category に紛れ込むのを型で防ぐ)。
   */
  category: ClosingSnapshotCategory | `${typeof ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX}${string}`;
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
 * (tenantId, period) の close/amend イベント(占め世代を構成するイベント)を occurred_at 昇順で返す。
 * getClosingSnapshots・getClosingSnapshotHistory の共通の下ごしらえ。
 */
async function listSnapshotGenerationEvents(
  db: Database | Transaction,
  params: { tenantId: string; period: string },
): Promise<ClosingEvent[]> {
  return db
    .select()
    .from(closingEvents)
    .where(
      and(
        eq(closingEvents.tenantId, params.tenantId),
        eq(closingEvents.period, params.period),
        inArray(closingEvents.event, SNAPSHOT_GENERATION_EVENTS),
      ),
    )
    .orderBy(asc(closingEvents.occurredAt), asc(closingEvents.id));
}

/**
 * (tenantId, period) の「現在のスナップショット」を全ユーザー分返す。period が一度も
 * 締められていなければ空配列。reopen 後で現在は open でも、直近の close/amend 時点の
 * スナップショットは残っているためそのまま返す(呼び出し側は getClosingState の status を見て
 * 「closed のときだけ呼ぶ」運用を想定 — apps/api/src/routes/attendance.ts・exports.ts 参照)。
 *
 * 判断点(amend 対応): 締め後修正(amend)は影響を受けたユーザーの行だけを新しい
 * closing_event_id に追加する設計(schema/closings.ts 判断点コメント参照)であり、
 * 「1つの closing_event_id に紐づく行の集合 = その period 全員分の現在値」という単純な前提が
 * もう成り立たない。そのためここでは close/amend イベントを時系列で辿り、ユーザーごとに
 * 「そのユーザーの行を含む最も新しいイベント」を特定し、そのイベントに紐づく行だけを採用する
 * (amend されていないユーザーは元の close のイベントの行がそのまま採用される)。
 *
 * `Database | Transaction` を受け取る(承認処理(corrections.ts・leave.ts)が amend の
 * 反映と同一トランザクションで「反映前の値」を読むために必要)。
 */
export async function getClosingSnapshots(
  db: Database | Transaction,
  params: { tenantId: string; period: string },
): Promise<ClosingSnapshot[]> {
  const events = await listSnapshotGenerationEvents(db, params);
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const allSnapshots = await db.select().from(closingSnapshots).where(inArray(closingSnapshots.closingEventId, eventIds));

  const eventOrder = new Map(events.map((e, index) => [e.id, index]));
  const latestEventIdByUser = new Map<string, string>();
  for (const s of allSnapshots) {
    const currentIndex = eventOrder.get(s.closingEventId) ?? -1;
    const existingEventId = latestEventIdByUser.get(s.userId);
    const existingIndex = existingEventId !== undefined ? (eventOrder.get(existingEventId) ?? -1) : -1;
    if (currentIndex > existingIndex) {
      latestEventIdByUser.set(s.userId, s.closingEventId);
    }
  }

  return allSnapshots.filter((s) => latestEventIdByUser.get(s.userId) === s.closingEventId);
}

/**
 * 複数ユーザーについて、現在のスナップショットをまとめて返す(CSVエクスポートが対象範囲の
 * ユーザーをまとめて出力するため)。userId → snapshot[] のマップ。
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

/**
 * (tenantId, period) の「最初の close」に紐づくスナップショットを全ユーザー分返す(当初の確定値、
 * amend による書き換えの影響を受けない)。period が一度も締められていなければ空配列。
 *
 * 判断点: reopen → 再締め(close)を経た period でも、依頼原文どおり「最初の close」を指す
 * ("最初の close に紐づく世代(当初の確定値)")。全体解除からの再締めは、そもそも amend とは
 * 別の既存ワークフロー("月全体を解除 → 修正 → 再締め")であり、その履歴も「当初どうだったか」
 * の一部として残しておく方が監査上安全という判断による。
 */
export async function getOriginalClosingSnapshots(
  db: Database,
  params: { tenantId: string; period: string },
): Promise<ClosingSnapshot[]> {
  const [firstClose] = await db
    .select()
    .from(closingEvents)
    .where(
      and(
        eq(closingEvents.tenantId, params.tenantId),
        eq(closingEvents.period, params.period),
        eq(closingEvents.event, "close"),
      ),
    )
    .orderBy(asc(closingEvents.occurredAt), asc(closingEvents.id))
    .limit(1);

  if (!firstClose) return [];

  return db.select().from(closingSnapshots).where(eq(closingSnapshots.closingEventId, firstClose.id));
}

/** getOriginalClosingSnapshots の複数ユーザー版(CSV エクスポートの `?compare=original` 用)。 */
export async function getOriginalClosingSnapshotsForUsers(
  db: Database,
  params: { tenantId: string; period: string; userIds: string[] },
): Promise<Map<string, ClosingSnapshot[]>> {
  const all = await getOriginalClosingSnapshots(db, { tenantId: params.tenantId, period: params.period });
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

export interface ClosingSnapshotGeneration {
  event: ClosingEvent;
  /** このイベントで「新たに追加された」行のみ(amend は影響ユーザーの行だけ)。 */
  snapshots: ClosingSnapshot[];
}

/**
 * (tenantId, period) の世代一覧(close 1件 + amend 0件以上)を時系列(古い順)で返す。
 * period が一度も締められていなければ空配列。GET /closings/:period 等、
 * 「誰がいつどの申請でスナップショットを更新したか」を辿る用途に使う。
 */
export async function getClosingSnapshotHistory(
  db: Database,
  params: { tenantId: string; period: string },
): Promise<ClosingSnapshotGeneration[]> {
  const events = await listSnapshotGenerationEvents(db, params);
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const allSnapshots = await db.select().from(closingSnapshots).where(inArray(closingSnapshots.closingEventId, eventIds));

  const byEvent = new Map<string, ClosingSnapshot[]>();
  for (const s of allSnapshots) {
    const list = byEvent.get(s.closingEventId) ?? [];
    list.push(s);
    byEvent.set(s.closingEventId, list);
  }

  return events.map((event) => ({ event, snapshots: byEvent.get(event.id) ?? [] }));
}
