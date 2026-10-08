/**
 * closing_events / closing_snapshots に対するクエリ層。
 *
 * closing_events は追記専用(punch_events と同じ思想)。現在状態(open/closed)は
 * UPDATE ではなく「その period の最新イベントが close か reopen か」から導出する
 * (docs/design/v01-data-model.md §closings(締め)と closing_snapshots)。
 */

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { AtomicPlan, chunkRowsForInsert, insertSelectWhere, runAtomic, type AtomicExecutor } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import {
  ALLOWANCE_CLOSING_SNAPSHOT_CATEGORY_PREFIX,
  closingEvents,
  closingSnapshots,
  type ClosingSnapshotCategory,
} from "../schema/index.js";
import { uuidv7 } from "../uuid.js";
import { auditLogInsertQuery, type NewAuditLogInput } from "./audit.js";

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

/**
 * closing_snapshots への insert ビルダを、D1 のバインド変数上限(1文 100 個)に収まる塊ごとに
 * 返す(実行しない)。1テナント全員分を1文で入れると、数人を超えた時点で D1 が拒否する
 * (1行 6 列 → 1文あたり 16 行まで)。
 */
export function closingSnapshotInsertQueries(q: AtomicExecutor, snapshots: NewClosingSnapshotInput[]) {
  return chunkRowsForInsert(closingSnapshots, snapshots).map((chunk) => closingSnapshotInsertQuery(q, chunk));
}

/** closing_snapshots への insert ビルダ1文(塊への分割は呼び出し側 — closingSnapshotInsertQueries)。 */
function closingSnapshotInsertQuery(q: AtomicExecutor, chunk: NewClosingSnapshotInput[]) {
  return q.insert(closingSnapshots).values(
    chunk.map((s) => ({
      id: uuidv7(),
      tenantId: s.tenantId,
      closingEventId: s.closingEventId,
      userId: s.userId,
      category: s.category,
      minutes: s.minutes,
    })),
  );
}

/** closing_snapshots へまとめて追記する(締め確定時に1テナント分をまとめて渡す想定)。 */
export async function saveClosingSnapshots(db: Database | Transaction, snapshots: NewClosingSnapshotInput[]): Promise<void> {
  for (const query of closingSnapshotInsertQueries(db, snapshots)) {
    await query;
  }
}

/**
 * (tenantId, period) の締め状態を決めるイベント(close/reopen の最新1件)の種別を返す SQL 式。
 * 1件も無ければ 'reopen'(= open)。stateFromHistory と同じ並び(occurred_at, id の降順の先頭)。
 */
function latestStateEventSql(q: AtomicExecutor, params: { tenantId: string; period: string }): SQL {
  const latest = q
    .select({ event: closingEvents.event })
    .from(closingEvents)
    .where(
      and(
        eq(closingEvents.tenantId, params.tenantId),
        eq(closingEvents.period, params.period),
        inArray(closingEvents.event, ["close", "reopen"]),
      ),
    )
    .orderBy(desc(closingEvents.occurredAt), desc(closingEvents.id))
    .limit(1);
  return sql`coalesce((${latest}), 'reopen')`;
}

/**
 * 「`periods` のどれもまだ締められていない(最新の close/reopen が close でない)」を表す SQL 条件。
 * 承認(修正申請・休暇申請・休憩自動控除の打ち消し)の atomic plan で、計画の前に読んだ
 * 「締め前」が書き込みの時点でも成り立つことを条件付き文 + ガードで担保するために使う
 * (docs/design/d1-atomic-writes.md §6 の #14・#16・#18)。`periods` が空なら常に真。
 */
export function periodsOpenCondition(q: AtomicExecutor, params: { tenantId: string; periods: readonly string[] }): SQL {
  if (params.periods.length === 0) return sql`1 = 1`;
  return sql.join(
    params.periods.map((period) => sql`${latestStateEventSql(q, { tenantId: params.tenantId, period })} <> 'close'`),
    sql` and `,
  );
}

/** periodsOpenCondition と組にする直列化キー(closePeriod / reopenPeriod と同じキー)。 */
export function closingSerializeKey(tenantId: string, period: string): string {
  return `closing:${tenantId}:${period}`;
}

/** close/reopen の監査ログ(tenantId・actorId・occurredAt は締め操作と同じ値を使う)。 */
export type ClosingAuditInput = Omit<NewAuditLogInput, "tenantId" | "actorId" | "occurredAt">;

export interface ClosePeriodInput {
  tenantId: string;
  /** "YYYY-MM" */
  period: string;
  actorId: string;
  note: string | null;
  /** UTC エポック分 */
  occurredAt: number;
  /** 新しい close イベントの id を受け取り、保存するスナップショット行を返す */
  buildSnapshots: (closingEventId: string) => NewClosingSnapshotInput[];
  audit: ClosingAuditInput;
}

export type ClosePeriodResult = { ok: true; event: ClosingEvent } | { ok: false; reason: "already_closed" };

/**
 * 締める: close イベントの追記・スナップショット保存・監査ログを1単位で行う
 * (apps/api/src/routes/closings.ts の POST /closings/:period/close)。
 *
 * 判断点(2026-10-07、D1 対応と TOCTOU の解消。docs/design/d1-atomic-writes.md):
 * 以前はトランザクション内で getClosingState を読み直して「閉じていなければ追記」していたが、
 * closing_events に一意制約は無く、PostgreSQL(READ COMMITTED)では同時の2件が互いの
 * 未コミット行を見ずに両方とも締められた。ここでは **close イベントの insert 自体を
 * 「最新の close/reopen が close でなければ」の条件付き(INSERT ... SELECT ... WHERE)** にし、
 * 0 行ならガードで計画ごと失敗させる(スナップショットも監査ログも書かない)。
 * PostgreSQL では同じ (tenant, period) の計画を advisory lock で直列化し、後続の計画が
 * 先行のコミット済み close を見てから判定するようにしている(src/atomic.ts「直列化キー」)。
 */
export async function closePeriod(db: Database, input: ClosePeriodInput): Promise<ClosePeriodResult> {
  const eventId = uuidv7();
  const snapshots = input.buildSnapshots(eventId);
  const plan = new AtomicPlan();
  plan.serialize(closingSerializeKey(input.tenantId, input.period));
  const inserted = plan.add((q) =>
    insertSelectWhere(
      q,
      closingEvents,
      {
        id: eventId,
        tenantId: input.tenantId,
        period: input.period,
        event: "close",
        actorId: input.actorId,
        note: input.note,
        correctionRequestId: null,
        leaveRequestId: null,
        occurredAt: input.occurredAt,
      },
      sql`${latestStateEventSql(q, input)} <> 'close'`,
    ).returning(),
  );
  plan.guard("closing.already_closed");
  for (const chunk of chunkRowsForInsert(closingSnapshots, snapshots)) {
    plan.add((q) => closingSnapshotInsertQuery(q, chunk));
  }
  plan.add((q) =>
    auditLogInsertQuery(q, { ...input.audit, tenantId: input.tenantId, actorId: input.actorId, occurredAt: input.occurredAt }),
  );

  const result = await runAtomic(db, plan);
  if (!result.ok) return { ok: false, reason: "already_closed" };
  const [event] = result.get(inserted);
  if (!event) throw new Error("closePeriod: close event insert returned no row after the guard passed");
  return { ok: true, event };
}

export interface ReopenPeriodInput {
  tenantId: string;
  /** "YYYY-MM" */
  period: string;
  actorId: string;
  note: string | null;
  /** UTC エポック分 */
  occurredAt: number;
  audit: ClosingAuditInput;
}

export type ReopenPeriodResult = { ok: true; event: ClosingEvent } | { ok: false; reason: "not_closed" };

/**
 * 締めを解除する: reopen イベントの追記・監査ログを1単位で行う(POST /closings/:period/reopen)。
 * 条件付き insert とガード・直列化の考え方は closePeriod と同じ(条件が「最新が close」に変わるだけ)。
 */
export async function reopenPeriod(db: Database, input: ReopenPeriodInput): Promise<ReopenPeriodResult> {
  const plan = new AtomicPlan();
  plan.serialize(closingSerializeKey(input.tenantId, input.period));
  const inserted = plan.add((q) =>
    insertSelectWhere(
      q,
      closingEvents,
      {
        id: uuidv7(),
        tenantId: input.tenantId,
        period: input.period,
        event: "reopen",
        actorId: input.actorId,
        note: input.note,
        correctionRequestId: null,
        leaveRequestId: null,
        occurredAt: input.occurredAt,
      },
      sql`${latestStateEventSql(q, input)} = 'close'`,
    ).returning(),
  );
  plan.guard("closing.not_closed");
  plan.add((q) =>
    auditLogInsertQuery(q, { ...input.audit, tenantId: input.tenantId, actorId: input.actorId, occurredAt: input.occurredAt }),
  );

  const result = await runAtomic(db, plan);
  if (!result.ok) return { ok: false, reason: "not_closed" };
  const [event] = result.get(inserted);
  if (!event) throw new Error("reopenPeriod: reopen event insert returned no row after the guard passed");
  return { ok: true, event };
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
