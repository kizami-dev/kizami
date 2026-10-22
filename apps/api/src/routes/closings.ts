/**
 * GET /closings, GET /closings/:period, POST /closings/:period/close, POST /closings/:period/reopen
 *
 * 月次締め(v0.3 第一弾)。参照: docs/design/v01-data-model.md §closings(締め)と
 * closing_snapshots、docs/requirements.md §6(締めと出口)、
 * docs/design/permission-catalog.md §1.5(締め)。
 *
 * 権限とスコープ(2026-10-22、セキュリティ指摘 M7 で変更):
 * - `closing.view`(閲覧): GET 系。最低 "department"(カタログの選択肢は department /
 *   department_and_descendants / tenant、§1.5)。締め状態(open/closed)と締め・解除の履歴は
 *   テナント単位の事実なのでどのスコープでも同じに見せるが、締め後修正(amend)の履歴は
 *   特定のメンバーの申請に由来するため、テナント全体スコープでなければ**スコープ内のメンバーの
 *   申請によるものだけ**を返す(filterHistoryForScope)
 * - `closing.execute` / `closing.unlock` による締め・解除: **テナント全体スコープが必要**。
 *
 * 判断点(締めはテナント単位のまま、部署スコープでは締め・解除させない): 設計方針1「締めは
 * テナント単位・月単位(全員まとめて確定)」により、closing_events は user_id も部署も持たず、
 * 1回の締め/解除は常にテナント全体の is_active ユーザーを対象にする(部署単位の部分締めという
 * データモデルが無い)。以前は「カタログが department_and_descendants を許すのは、テナント全体を
 * 締めてよいという許可の意味」と解釈して、自部署+配下部署スコープの保持者にもテナント全体の
 * 締め・解除を許していたが、それでは部署に絞って付与した権限が他部署の勤怠まで確定・再オープン
 * できてしまう。部署単位の締めを新設するのではなく、締め・解除そのものをテナント全体スコープに
 * 限る方を選んだ(部署単位の締めはデータモデル・スナップショット・締め済み判定のすべてを
 * 部署別に持ち直す大きな変更になるため)。
 * カタログの選択肢(自部署+配下部署)は残す: closing.unlock の自部署+配下部署は、締め済み月に
 * 影響するスコープ内メンバーの申請を承認する(amend、lib/closing-guard.ts)ためにいまも意味を持ち、
 * closing.execute の自部署+配下部署も含意される閲覧(締め状態・対象範囲の勤怠記録)を与える。
 * 選択肢を消すと既存のプリセットを保存し直せなくなる。
 */

import { Hono } from "hono";
import {
  closePeriod,
  getAutoBreakWaiverById,
  getClosingState,
  getCorrectionRequest,
  getLeaveRequest,
  listClosingStates,
  listTenantUsers,
  reopenPeriod,
  type ClosingEvent,
  type ClosingState,
  type Database,
} from "@kizami/db";
import type { EngineOutput } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { resolveAccessibleUserIds, type ScopeActor } from "../lib/scope.js";
import { snapshotInputsFromEngineOutput } from "../lib/closing-snapshot.js";
import { buildTenantMonthlyContext } from "../lib/closing-amend.js";
import { nowMinutes, parseMonthParam } from "../lib/time.js";
import { calculateMonthlyForUser } from "../reminders.js";

const VIEW_PERMISSION = "closing.view";
const EXECUTE_PERMISSION = "closing.execute";
const UNLOCK_PERMISSION = "closing.unlock";

const MAX_NOTE_LENGTH = 500;

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
    // event='amend' のとき、由来となった申請(いずれか一方のみ非null)。close/reopen は両方 null。
    correctionRequestId: event.correctionRequestId,
    leaveRequestId: event.leaveRequestId,
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

/** auto-break-waivers.ts が amend イベントの note に残す参照(closing_events に専用の列が無いため)。 */
const AUTO_BREAK_WAIVER_NOTE_PREFIX = "auto_break_waiver:";

/** amend イベントの由来となった申請の持ち主ユーザーID。由来が辿れなければ null。 */
async function amendOwnerUserId(db: Database, tenantId: string, event: ClosingEvent): Promise<string | null> {
  if (event.correctionRequestId !== null) {
    const request = await getCorrectionRequest(db, event.correctionRequestId);
    return request && request.tenantId === tenantId ? request.userId : null;
  }
  if (event.leaveRequestId !== null) {
    const request = await getLeaveRequest(db, event.leaveRequestId);
    return request && request.tenantId === tenantId ? request.userId : null;
  }
  if (event.note !== null && event.note.startsWith(AUTO_BREAK_WAIVER_NOTE_PREFIX)) {
    const waiver = await getAutoBreakWaiverById(db, event.note.slice(AUTO_BREAK_WAIVER_NOTE_PREFIX.length));
    return waiver && waiver.tenantId === tenantId ? waiver.userId : null;
  }
  return null;
}

/**
 * closing.view がテナント全体スコープでなければ、amend の履歴をスコープ内メンバーの申請による
 * ものだけにする(close / reopen はテナント単位の事実なのでそのまま)。status は全履歴から
 * 導出済みの値を変えない。lastEvent は見せる履歴の末尾に合わせる。
 */
function createHistoryFilter(db: Database, actor: ScopeActor) {
  let accessible: Promise<Set<string> | "all"> | null = null;
  const ownerCache = new Map<string, Promise<string | null>>();
  return async (state: ClosingState): Promise<ClosingState> => {
    if (!state.history.some((e) => e.event === "amend")) return state;
    accessible ??= resolveAccessibleUserIds(db, { actor, permission: VIEW_PERMISSION });
    const userIds = await accessible;
    if (userIds === "all") return state;
    const history: ClosingEvent[] = [];
    for (const event of state.history) {
      if (event.event !== "amend") {
        history.push(event);
        continue;
      }
      let owner = ownerCache.get(event.id);
      if (!owner) {
        owner = amendOwnerUserId(db, actor.tenantId, event);
        ownerCache.set(event.id, owner);
      }
      const ownerId = await owner;
      if (ownerId !== null && userIds.has(ownerId)) history.push(event);
    }
    return { ...state, history, lastEvent: history.length > 0 ? (history[history.length - 1] as ClosingEvent) : null };
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
    const filterHistory = createHistoryFilter(db, { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") });
    const visible: ClosingState[] = [];
    for (const state of states) visible.push(await filterHistory(state));
    return c.json({ closings: visible.map(serializeState) });
  });

  app.get("/:period", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const period = c.req.param("period");
    if (!isValidPeriod(period)) {
      return c.json({ error: "invalid_period" }, 400);
    }

    const state = await getClosingState(db, { tenantId: user.tenantId, period });
    const filterHistory = createHistoryFilter(db, { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") });
    return c.json({ closing: serializeState(await filterHistory(state)) });
  });

  app.post("/:period/close", async (c) => {
    requirePermission(c, EXECUTE_PERMISSION, "tenant");
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

    // N+1解消: 締める対象は全員が同じテナント・同じ月なので、law/allowance/テナント設定版は
    // ユーザー数だけ繰り返さず1回だけ構築する(apps/api/src/lib/closing-amend.ts 冒頭の
    // 判断点参照)。構築自体が失敗した場合(テナント設定が一切無い等)は、以前この失敗が
    // 個々のユーザーの calculateMonthlyForUser 呼び出しの中で起きて全員スキップになっていた
    // のと同じ結果になるよう、ここでも例外にはせず null のまま扱い、以降の per-user 呼び出しで
    // 従来どおり自前取得(= 同じ理由で同じく失敗)にフォールバックさせる(挙動不変)。
    const tenantContext = await buildTenantMonthlyContext(db, { tenantId: user.tenantId, year: parsedMonth.year, month: parsedMonth.month }).catch(
      () => undefined,
    );

    const perUserOutputs: Array<{ userId: string; output: EngineOutput }> = [];
    // レビュー指摘(締めのサイレントスキップ可視化): 誰が・何人スキップされたかがこれまで
    // どこにも残らず、締め結果の userCount だけでは「意図的に対象外なのか、設定不備で
    // 落ちたのか」を後から区別できなかった。スキップしたユーザーIDを集め、監査ログの detail に
    // skippedUserIds として記録する(下記 insertAuditLog 呼び出し参照)。
    const skippedUserIds: string[] = [];
    for (const activeUser of activeUsers) {
      try {
        const { output } = await calculateMonthlyForUser(
          db,
          {
            tenantId: user.tenantId,
            userId: activeUser.id,
            year: parsedMonth.year,
            month: parsedMonth.month,
          },
          tenantContext,
        );
        perUserOutputs.push({ userId: activeUser.id, output });
      } catch {
        // テナント設定・制度割当がまだ揃っていないユーザーはスキップする
        // (apps/api/src/reminders.ts runReminderScan と同じ方針: 個別ユーザーの不備で
        // 締め処理全体を失敗させない)。どのユーザーがスキップされたかは skippedUserIds に
        // 記録し、監査ログから追跡できるようにする。
        skippedUserIds.push(activeUser.id);
      }
    }

    const now = nowMinutes();
    // 書き込み(close イベント・スナップショット・監査ログ)は closePeriod が1単位で行う。
    // 判断点(2026-10-07、docs/design/d1-atomic-writes.md): 以前はトランザクション内で状態を
    // 読み直して「閉じていなければ追記」していたが、一意制約が無いため PostgreSQL では同時の
    // 2件が両方とも締められた(TOCTOU)。いまは close イベントの insert 自体が「最新が close で
    // なければ」の条件付きで、負けた側は何も書かずに already_closed になる。D1 でも動く。
    const closed = await closePeriod(db, {
      tenantId: user.tenantId,
      period,
      actorId: user.id,
      note: noteResult.note,
      occurredAt: now,
      buildSnapshots: (closingEventId) =>
        perUserOutputs.flatMap(({ userId, output }) =>
          snapshotInputsFromEngineOutput({
            tenantId: user.tenantId,
            closingEventId,
            userId,
            output,
          }),
        ),
      audit: {
        action: "closing.close",
        targetType: "closing",
        targetId: period,
        detail: JSON.stringify({ period, note: noteResult.note, userCount: perUserOutputs.length, skippedUserIds }),
      },
    });
    if (!closed.ok) {
      return c.json({ error: "already_closed" }, 409);
    }

    const state = await getClosingState(db, { tenantId: user.tenantId, period });
    return c.json({ closing: serializeState(state) }, 200);
  });

  app.post("/:period/reopen", async (c) => {
    requirePermission(c, UNLOCK_PERMISSION, "tenant");
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
    // reopen イベントと監査ログを1単位で書く(条件付き insert。closePeriod と同じ考え方)
    const reopened = await reopenPeriod(db, {
      tenantId: user.tenantId,
      period,
      actorId: user.id,
      note: noteResult.note,
      occurredAt: now,
      audit: {
        action: "closing.reopen",
        targetType: "closing",
        targetId: period,
        detail: JSON.stringify({ period, note: noteResult.note }),
      },
    });
    if (!reopened.ok) {
      return c.json({ error: "not_closed" }, 409);
    }

    const state = await getClosingState(db, { tenantId: user.tenantId, period });
    return c.json({ closing: serializeState(state) }, 200);
  });

  return app;
}
