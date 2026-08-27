/**
 * notifications に対するクエリ層。
 *
 * - createNotificationIfAbsent: UNIQUE(tenant_id, user_id, type, subject_date) 違反時は
 *   何もせず null を返す(= 重複。呼び出し側はこれを「既に通知済み」の合図として扱う)
 * - notifications は「現在の既読状態」を持つ通常テーブルなので read_at の UPDATE を行う
 *   (punch_events と異なり追記専用ではない)
 */

import { and, count, desc, eq, isNull } from "drizzle-orm";
import { isUniqueConstraintError } from "../errors.js";
import type { Database } from "../types.js";
import { notifications } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type Notification = typeof notifications.$inferSelect;

export interface NewNotificationInput {
  tenantId: string;
  userId: string;
  type: string;
  /** ローカル日付 "YYYY-MM-DD"。紐づく勤怠日がなければ null */
  subjectDate?: string | null;
  title: string;
  body: string;
  /** UTC エポック分 */
  createdAt: number;
}

/**
 * notifications へ1件作成する。同じ (tenantId, userId, type, subjectDate) が既に存在する場合、
 * UNIQUE 制約違反を捕捉して何もせず null を返す(重複防止。呼び出し側で「新規作成できたか」の
 * 判定に使う — 外部チャネルへの送信は新規作成できたときだけ行う)。
 */
export async function createNotificationIfAbsent(db: Database, input: NewNotificationInput): Promise<Notification | null> {
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        id: uuidv7(),
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type,
        subjectDate: input.subjectDate ?? null,
        title: input.title,
        body: input.body,
        createdAt: input.createdAt,
        readAt: null,
      })
      .returning();
    return row ?? null;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return null;
    }
    throw err;
  }
}

export interface FindNotificationByTypeAndDateParams {
  tenantId: string;
  userId: string;
  type: string;
  /** ローカル日付 "YYYY-MM-DD"。null 相当("subject_date を持たない")の検索はサポートしない
   * (SQLite の NULL 比較は `=` では成立しないため、必要になった時点で専用関数を足す) */
  subjectDate: string;
}

/**
 * (tenantId, userId, type, subjectDate) に一致する通知が既にあるか調べる。
 *
 * 36協定アラート(overtime-alerts.ts)が「reached 通知が既にある月には projected を作らない」
 * を判定するために使う — createNotificationIfAbsent の UNIQUE 違反捕捉だけでは
 * 「別の type の通知が既にあるか」は分からないため、事前の存在確認として別関数にした。
 */
export async function findNotificationByTypeAndDate(
  db: Database,
  params: FindNotificationByTypeAndDateParams,
): Promise<Notification | null> {
  const [row] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, params.tenantId),
        eq(notifications.userId, params.userId),
        eq(notifications.type, params.type),
        eq(notifications.subjectDate, params.subjectDate),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface ListNotificationsParams {
  tenantId: string;
  userId: string;
  unreadOnly?: boolean;
  /** 既定 100 */
  limit?: number;
}

/** (tenantId, userId) にスコープし、新しい順(created_at, id の降順)で返す。既定 最大100件。 */
export async function listNotifications(db: Database, params: ListNotificationsParams): Promise<Notification[]> {
  const conditions = [eq(notifications.tenantId, params.tenantId), eq(notifications.userId, params.userId)];
  if (params.unreadOnly) {
    conditions.push(isNull(notifications.readAt));
  }

  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(params.limit ?? 100);
}

export interface MarkNotificationReadParams {
  id: string;
  tenantId: string;
  userId: string;
  /** UTC エポック分 */
  readAt: number;
}

/**
 * 指定の通知を既読にする((tenantId, userId) にスコープした条件付き UPDATE)。
 * 存在しない・他人のものならどちらも 0 件更新となり null を返す。
 */
export async function markNotificationRead(db: Database, params: MarkNotificationReadParams): Promise<Notification | null> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: params.readAt })
    .where(
      and(
        eq(notifications.id, params.id),
        eq(notifications.tenantId, params.tenantId),
        eq(notifications.userId, params.userId),
      ),
    )
    .returning();
  return row ?? null;
}

export interface CountUnreadParams {
  tenantId: string;
  userId: string;
}

/** (tenantId, userId) の未読件数を返す。 */
export async function countUnread(db: Database, params: CountUnreadParams): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(eq(notifications.tenantId, params.tenantId), eq(notifications.userId, params.userId), isNull(notifications.readAt)),
    );
  return row?.value ?? 0;
}
