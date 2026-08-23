/**
 * shift_patterns / shift_plans / shift_days に対する最小限のクエリ層。
 * 参照: docs/design/shift-work.md 決定事項1・2、packages/db/src/schema/shifts.ts。
 *
 * shift_days は punch_events と同じ追記専用・supersedes 型。「有効行」の解決規則
 * (他のどの行の supersedes_id からも参照されていない行)は queries/punches.ts の
 * listValidPunches と完全に同じ NOT EXISTS パターンを使う。
 */

import { and, asc, eq, gte, isNull, lte, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Database, Transaction } from "../migrate.js";
import { shiftDays, shiftPatterns, shiftPlans } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type ShiftPattern = typeof shiftPatterns.$inferSelect;
export type ShiftPlan = typeof shiftPlans.$inferSelect;
export type ShiftDayRow = typeof shiftDays.$inferSelect;

// ---------------------------------------------------------------------------
// shift_patterns
// ---------------------------------------------------------------------------

export interface InsertShiftPatternParams {
  tenantId: string;
  name: string;
  dayType: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  createdAt: number;
}

export async function insertShiftPattern(db: Database | Transaction, params: InsertShiftPatternParams): Promise<ShiftPattern> {
  const [row] = await db
    .insert(shiftPatterns)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      name: params.name,
      dayType: params.dayType,
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
      breakMinutes: params.breakMinutes,
      createdAt: params.createdAt,
      archivedAt: null,
    })
    .returning();
  if (!row) throw new Error("insertShiftPattern: insert returned no row");
  return row;
}

/** テナントのシフトパターン一覧。既定では未アーカイブのみ(includeArchived で全件)。 */
export async function listShiftPatterns(
  db: Database | Transaction,
  params: { tenantId: string; includeArchived?: boolean },
): Promise<ShiftPattern[]> {
  const conditions = params.includeArchived
    ? eq(shiftPatterns.tenantId, params.tenantId)
    : and(eq(shiftPatterns.tenantId, params.tenantId), isNull(shiftPatterns.archivedAt));
  return db.select().from(shiftPatterns).where(conditions).orderBy(asc(shiftPatterns.createdAt));
}

export async function getShiftPatternById(
  db: Database | Transaction,
  params: { tenantId: string; id: string },
): Promise<ShiftPattern | null> {
  const rows = await db
    .select()
    .from(shiftPatterns)
    .where(and(eq(shiftPatterns.tenantId, params.tenantId), eq(shiftPatterns.id, params.id)))
    .limit(1);
  return rows[0] ?? null;
}

/** アーカイブ(論理削除)。既にアーカイブ済み・存在しなければ null。 */
export async function archiveShiftPattern(
  db: Database | Transaction,
  params: { tenantId: string; id: string; archivedAt: number },
): Promise<ShiftPattern | null> {
  const [row] = await db
    .update(shiftPatterns)
    .set({ archivedAt: params.archivedAt })
    .where(and(eq(shiftPatterns.tenantId, params.tenantId), eq(shiftPatterns.id, params.id), isNull(shiftPatterns.archivedAt)))
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// shift_plans
// ---------------------------------------------------------------------------

export interface InsertShiftPlanParams {
  tenantId: string;
  userId: string;
  /** ローカル日付 "YYYY-MM-DD" */
  periodStart: string;
  periodEnd: string;
  createdAt: number;
}

export async function insertShiftPlan(db: Database | Transaction, params: InsertShiftPlanParams): Promise<ShiftPlan> {
  const [row] = await db
    .insert(shiftPlans)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      userId: params.userId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      publishedAt: null,
      publishedBy: null,
      createdAt: params.createdAt,
    })
    .returning();
  if (!row) throw new Error("insertShiftPlan: insert returned no row");
  return row;
}

export async function getShiftPlanById(db: Database | Transaction, params: { tenantId: string; id: string }): Promise<ShiftPlan | null> {
  const rows = await db
    .select()
    .from(shiftPlans)
    .where(and(eq(shiftPlans.tenantId, params.tenantId), eq(shiftPlans.id, params.id)))
    .limit(1);
  return rows[0] ?? null;
}

/** userId・periodStart どちらも省略可(絞り込み条件)。periodStart 昇順で返す。 */
export async function listShiftPlans(
  db: Database | Transaction,
  params: { tenantId: string; userId?: string; periodStart?: string },
): Promise<ShiftPlan[]> {
  const conditions = [eq(shiftPlans.tenantId, params.tenantId)];
  if (params.userId !== undefined) conditions.push(eq(shiftPlans.userId, params.userId));
  if (params.periodStart !== undefined) conditions.push(eq(shiftPlans.periodStart, params.periodStart));
  return db
    .select()
    .from(shiftPlans)
    .where(and(...conditions))
    .orderBy(asc(shiftPlans.periodStart));
}

/** 確定(publish)する。既に確定済み・存在しなければ null(呼び出し側が 404/409 を判断する)。 */
export async function publishShiftPlan(
  db: Database | Transaction,
  params: { tenantId: string; id: string; publishedAt: number; publishedBy: string },
): Promise<ShiftPlan | null> {
  const [row] = await db
    .update(shiftPlans)
    .set({ publishedAt: params.publishedAt, publishedBy: params.publishedBy })
    .where(and(eq(shiftPlans.tenantId, params.tenantId), eq(shiftPlans.id, params.id), isNull(shiftPlans.publishedAt)))
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// shift_days(追記専用・supersedes 型)
// ---------------------------------------------------------------------------

/** shift_days 1行分の可変フィールド(punch と違い「その日全体」を1行で表す)。 */
export interface ShiftDayFields {
  dayType: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  patternId: string | null;
}

/** (tenantId, userId, date) の現在有効な shift_days 行を1件返す(無ければ null)。 */
export async function getValidShiftDayForDate(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; date: string },
): Promise<ShiftDayRow | null> {
  const superseding = alias(shiftDays, "superseding");
  const rows = await db
    .select()
    .from(shiftDays)
    .where(
      and(
        eq(shiftDays.tenantId, params.tenantId),
        eq(shiftDays.userId, params.userId),
        eq(shiftDays.date, params.date),
        notExists(db.select({ id: superseding.id }).from(superseding).where(eq(superseding.supersedesId, shiftDays.id))),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 有効な shift_days を fromDate〜toDate(両端含む)で返す(date 昇順)。
 * engine の `EngineInput.shifts` にそのまま変換して渡す入力になる
 * (docs/design/shift-work.md 決定事項5)。
 */
export async function listValidShiftDaysInRange(
  db: Database | Transaction,
  params: { tenantId: string; userId: string; fromDate: string; toDate: string },
): Promise<ShiftDayRow[]> {
  const superseding = alias(shiftDays, "superseding");
  return db
    .select()
    .from(shiftDays)
    .where(
      and(
        eq(shiftDays.tenantId, params.tenantId),
        eq(shiftDays.userId, params.userId),
        gte(shiftDays.date, params.fromDate),
        lte(shiftDays.date, params.toDate),
        notExists(db.select({ id: superseding.id }).from(superseding).where(eq(superseding.supersedesId, shiftDays.id))),
      ),
    )
    .orderBy(asc(shiftDays.date));
}

/** plan に属する有効な shift_days(date 昇順)。GET /shifts/plans/:id 相当の表示に使う。 */
export async function listValidShiftDaysForPlan(db: Database | Transaction, params: { tenantId: string; planId: string }): Promise<ShiftDayRow[]> {
  const superseding = alias(shiftDays, "superseding");
  return db
    .select()
    .from(shiftDays)
    .where(
      and(
        eq(shiftDays.tenantId, params.tenantId),
        eq(shiftDays.planId, params.planId),
        notExists(db.select({ id: superseding.id }).from(superseding).where(eq(superseding.supersedesId, shiftDays.id))),
      ),
    )
    .orderBy(asc(shiftDays.date));
}

/**
 * plan に属する全 shift_days(有効・無効を問わず、supersede チェーン込みの変更履歴)。
 * date 昇順→同日内は createdAt 昇順(= supersede された順)で返す。GET /shifts/plans/:id/history 用。
 */
export async function listShiftDayHistoryForPlan(db: Database | Transaction, params: { tenantId: string; planId: string }): Promise<ShiftDayRow[]> {
  return db
    .select()
    .from(shiftDays)
    .where(and(eq(shiftDays.tenantId, params.tenantId), eq(shiftDays.planId, params.planId)))
    .orderBy(asc(shiftDays.date), asc(shiftDays.createdAt));
}

/**
 * plan 単位の一括 upsert。`days` の各日付について、(tenant, user, date) の現在有効な行が
 * あればそれを supersede する新しい行を、無ければ新規行を追記する
 * (docs/design/shift-work.md 決定事項1: 確定前後を問わず同じ supersede メカニズムを使う。
 * 「未確定なら上書き」に見える挙動も、実体は supersede チェーンが積み上がっているだけ)。
 *
 * 同一 plan 内で同じ日付が2回以上渡された場合、後勝ち(配列の後の要素が前の要素を supersede
 * する形で連鎖する)。呼び出し側(apps/api/src/routes/shifts.ts)は通常この重複を作らないが、
 * クエリ層としても安全側(例外にせず最後の値が有効になる)に倒しておく。
 */
export async function upsertShiftDaysForPlan(
  db: Database | Transaction,
  params: {
    tenantId: string;
    userId: string;
    planId: string;
    days: Array<ShiftDayFields & { date: string }>;
    createdBy: string;
    createdAt: number;
  },
): Promise<ShiftDayRow[]> {
  const { tenantId, userId, planId, days, createdBy, createdAt } = params;
  const inserted: ShiftDayRow[] = [];
  // 同一 plan 内の日付重複(後勝ち)にも正しく連鎖させるため、直前にこの呼び出し内で
  // 作った行を優先して supersede 元にする(DB へ都度問い合わせなくても連鎖が追える)。
  const justInsertedByDate = new Map<string, ShiftDayRow>();

  for (const day of days) {
    const current = justInsertedByDate.get(day.date) ?? (await getValidShiftDayForDate(db, { tenantId, userId, date: day.date }));
    const [row] = await db
      .insert(shiftDays)
      .values({
        id: uuidv7(),
        tenantId,
        userId,
        date: day.date,
        dayType: day.dayType,
        startMinutes: day.startMinutes,
        endMinutes: day.endMinutes,
        breakMinutes: day.breakMinutes,
        patternId: day.patternId,
        planId,
        supersedesId: current?.id ?? null,
        createdBy,
        createdAt,
      })
      .returning();
    if (!row) throw new Error("upsertShiftDaysForPlan: insert returned no row");
    justInsertedByDate.set(day.date, row);
    inserted.push(row);
  }

  return inserted;
}
