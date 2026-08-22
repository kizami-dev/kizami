/**
 * GET /closings, GET /closings/:period, POST /closings/:period/close, POST /closings/:period/reopen
 *
 * 月次締め(v0.3 第一弾)。参照: docs/design/v01-data-model.md §closings(締め)と
 * closing_snapshots、docs/requirements.md §6(締めと出口)、
 * docs/design/permission-catalog.md §1.5(締め)。
 *
 * 権限とスコープ:
 * - `closing.view`(閲覧): GET 系。カタログのスコープ選択肢は department / department_and_descendants
 *   / tenant(§1.5)なので最低 "department" を要求する
 * - `closing.execute` / `closing.unlock`: カタログのスコープ選択肢は department_and_descendants /
 *   tenant のみ(§1.5)なので最低 "department_and_descendants" を要求する
 *
 * 判断点(締めのスコープ運用): 設計方針1「締めはテナント単位・月単位(全員まとめて確定)」により、
 * 締め/解除の実行そのものは常にテナント全体の is_active ユーザーを対象にする(department 単位の
 * 部分締めという概念が無い)。カタログが closing.execute/unlock に
 * department_and_descendants スコープを許容しているのは「その権限を持つ人物が、テナント全体を
 * 対象にした締め操作を実行してよい」という許可の意味であり、実際に締められる対象を actor の
 * 部署配下だけに絞り込むフィルタではない(apps/api/src/lib/scope.ts の
 * resolveAccessibleUserIds はここでは使わない — 使うと設計方針1に反する部分締めになってしまう)。
 */

import { Hono } from "hono";
import {
  appendClosingEvent,
  getClosingState,
  insertAuditLog,
  listClosingStates,
  listTenantUsers,
  saveClosingSnapshots,
  type ClosingEvent,
  type ClosingState,
  type Database,
} from "@kizami/db";
import type { EngineOutput } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { snapshotInputsFromEngineOutput } from "../lib/closing-snapshot.js";
import { nowMinutes, parseMonthParam } from "../lib/time.js";
import { calculateMonthlyForUser } from "../reminders.js";

const VIEW_PERMISSION = "closing.view";
const EXECUTE_PERMISSION = "closing.execute";
const UNLOCK_PERMISSION = "closing.unlock";

const MAX_NOTE_LENGTH = 500;

/** already_closed(close時)・not_closed(reopen時)を、行の有無と区別するための内部シグナル。 */
class AlreadyClosedConflictError extends Error {}
class NotClosedConflictError extends Error {}

function isValidPeriod(value: string | undefined): value is string {
  return value !== undefined && parseMonthParam(value) !== null;
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null) {
    return null;
  }
  return body as Record<string, unknown>;
}

function parseNote(body: Record<string, unknown>): { ok: true; note: string | null } | { ok: false } {
  if (body.note === undefined) return { ok: true, note: null };
  if (typeof body.note !== "string" || body.note.length > MAX_NOTE_LENGTH) return { ok: false };
  return { ok: true, note: body.note };
}

function serializeEvent(event: ClosingEvent) {
  return {
    id: event.id,
    event: event.event,
    actorId: event.actorId,
    note: event.note,
    occurredAt: event.occurredAt,
  };
}

function serializeState(state: ClosingState) {
  return {
    period: state.period,
    status: state.status,
    lastEvent: state.lastEvent ? serializeEvent(state.lastEvent) : null,
    history: state.history.map(serializeEvent),
  };
}

export function createClosingsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!isValidPeriod(from) || !isValidPeriod(to) || from > to) {
      return c.json({ error: "invalid_range" }, 400);
    }

    const states = await listClosingStates(db, { tenantId: user.tenantId, from, to });
    return c.json({ closings: states.map(serializeState) });
  });

  app.get("/:period", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const period = c.req.param("period");
    if (!isValidPeriod(period)) {
      return c.json({ error: "invalid_period" }, 400);
    }

    const state = await getClosingState(db, { tenantId: user.tenantId, period });
    return c.json({ closing: serializeState(state) });
  });

  app.post("/:period/close", async (c) => {
    requirePermission(c, EXECUTE_PERMISSION, "department_and_descendants");
    const user = c.get("user");

    const period = c.req.param("period");
    if (!isValidPeriod(period)) {
      return c.json({ error: "invalid_period" }, 400);
    }
    const parsedMonth = parseMonthParam(period);
    if (!parsedMonth) {
      return c.json({ error: "invalid_period" }, 400);
    }

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    const noteResult = parseNote(body);
    if (!noteResult.ok) return c.json({ error: "invalid_note" }, 400);

    const currentState = await getClosingState(db, { tenantId: user.tenantId, period });
    if (currentState.status === "closed") {
      return c.json({ error: "already_closed" }, 409);
    }

    // calculate() 自体は純関数で DB アクセスを伴わない。ここで必要な読み取り(打刻・設定
    // タイムライン)はトランザクション開始前に済ませ、書き込み(スナップショット保存・
    // イベント追記・監査ログ)だけをアトミックにする(判断点: 「1トランザクションで calculate→
    // 保存→追記→監査」という依頼を、読み取りフェーズと書き込みフェーズに分けて解釈した。
    // 全テナントユーザー分の計算をトランザクション内で行うと libsql の1接続を長時間
    // 占有することになり、実務上の理由からも読み取りは外に出す方が安全)。
    const tenantUsers = await listTenantUsers(db, user.tenantId);
    const activeUsers = tenantUsers.filter((u) => u.isActive);

    const perUserOutputs: Array<{ userId: string; output: EngineOutput }> = [];
    for (const activeUser of activeUsers) {
      try {
        const { output } = await calculateMonthlyForUser(db, {
          tenantId: user.tenantId,
          userId: activeUser.id,
          year: parsedMonth.year,
          month: parsedMonth.month,
        });
        perUserOutputs.push({ userId: activeUser.id, output });
      } catch {
        // テナント設定・制度割当がまだ揃っていないユーザーはスキップする
        // (apps/api/src/reminders.ts runReminderScan と同じ方針: 個別ユーザーの不備で
        // 締め処理全体を失敗させない)。
      }
    }

    const now = nowMinutes();
    try {
      await db.transaction(async (tx) => {
        // トランザクション開始直前の再確認との間にも競合しうるため、書き込み直前にもう一度
        // 確認する(TOCTOU を完全には防げないが、同一テナント・同一月の締めが同時に競合する
        // ケースは実運用上稀という前提を置く。apps/api/src/routes/corrections.ts の
        // NotPendingConflictError と同じ考え方)。
        const raceState = await getClosingState(tx, { tenantId: user.tenantId, period });
        if (raceState.status === "closed") {
          throw new AlreadyClosedConflictError();
        }

        const event = await appendClosingEvent(tx, {
          tenantId: user.tenantId,
          period,
          event: "close",
          actorId: user.id,
          note: noteResult.note,
          occurredAt: now,
        });

        const snapshotInputs = perUserOutputs.flatMap(({ userId, output }) =>
          snapshotInputsFromEngineOutput({
            tenantId: user.tenantId,
            closingEventId: event.id,
            userId,
            totals: output.totals,
            flexBalance: output.flexBalance,
          }),
        );
        await saveClosingSnapshots(tx, snapshotInputs);

        await insertAuditLog(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "closing.close",
          targetType: "closing",
          targetId: period,
          detail: JSON.stringify({ period, note: noteResult.note, userCount: perUserOutputs.length }),
          occurredAt: now,
        });
      });
    } catch (err) {
      if (err instanceof AlreadyClosedConflictError) {
        return c.json({ error: "already_closed" }, 409);
      }
      throw err;
    }

    const state = await getClosingState(db, { tenantId: user.tenantId, period });
    return c.json({ closing: serializeState(state) }, 200);
  });

  app.post("/:period/reopen", async (c) => {
    requirePermission(c, UNLOCK_PERMISSION, "department_and_descendants");
    const user = c.get("user");

    const period = c.req.param("period");
    if (!isValidPeriod(period)) {
      return c.json({ error: "invalid_period" }, 400);
    }

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    const noteResult = parseNote(body);
    if (!noteResult.ok) return c.json({ error: "invalid_note" }, 400);

    const currentState = await getClosingState(db, { tenantId: user.tenantId, period });
    if (currentState.status !== "closed") {
      return c.json({ error: "not_closed" }, 409);
    }

    const now = nowMinutes();
    try {
      await db.transaction(async (tx) => {
        const raceState = await getClosingState(tx, { tenantId: user.tenantId, period });
        if (raceState.status !== "closed") {
          throw new NotClosedConflictError();
        }

        await appendClosingEvent(tx, {
          tenantId: user.tenantId,
          period,
          event: "reopen",
          actorId: user.id,
          note: noteResult.note,
          occurredAt: now,
        });

        await insertAuditLog(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "closing.reopen",
          targetType: "closing",
          targetId: period,
          detail: JSON.stringify({ period, note: noteResult.note }),
          occurredAt: now,
        });
      });
    } catch (err) {
      if (err instanceof NotClosedConflictError) {
        return c.json({ error: "not_closed" }, 409);
      }
      throw err;
    }

    const state = await getClosingState(db, { tenantId: user.tenantId, period });
    return c.json({ closing: serializeState(state) }, 200);
  });

  return app;
}
