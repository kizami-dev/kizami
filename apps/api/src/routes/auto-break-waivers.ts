/**
 * GET /auto-break-waivers, POST /auto-break-waivers, POST /auto-break-waivers/:id/approve,
 * POST /auto-break-waivers/:id/reject, POST /auto-break-waivers/:id/withdraw
 *
 * 休憩自動控除の打ち消し申請フロー(docs/design/breaks.md「採る設計」)。
 * routes/corrections.ts(打刻修正申請)を手本にする — 認可・締め済みガード・監査ログの
 * 流儀はすべて踏襲する。
 *
 * 承認の認可方式: 権限プリセット方式の `attendance.correction.approve`
 * (packages/authz/src/catalog.ts の判断点コメント: 「休憩の自動控除打ち消し申請の承認も
 * この権限で行う」)+ apps/api/src/lib/scope.ts の resolveAccessibleUserIds によるスコープ
 * 判定を使う。当初(2026-08-21)は corrections.ts / leave.ts が requestedBy 自身のみ承認できる
 * 暫定の自己承認方式のままで、このファイルだけが権限ベースという食い違いがあったが、
 * 2026-08-23 に corrections.ts / leave.ts 側もこのファイルと同じ権限ベース方式へ統一した
 * (routes/corrections.ts・routes/leave.ts のヘッダコメント参照)。3ファイルとも現在は
 * 同じ認可の形。
 *
 * 承認依頼の通知(2026-08-23 追加): POST / で申請が作成されたら承認者(申請者をスコープに
 * 含む形で APPROVE_PERMISSION を持つ人)へ通知する。routes/corrections.ts の POST / と同じ
 * 形(詳細な設計理由・テナント共有 Webhook の扱いはそちらのヘッダコメント参照)。
 */

import { Hono } from "hono";
import {
  appendClosingEvent,
  createAutoBreakWaiver,
  createNotificationIfAbsent,
  decideAutoBreakWaiver,
  getAutoBreakWaiverById,
  getClosingSnapshots,
  getClosingState,
  getUserById,
  insertAuditLog,
  isUniqueConstraintError,
  listAutoBreakWaivers,
  saveClosingSnapshots,
  withdrawAutoBreakWaiver,
  type AutoBreakWaiver,
  type AutoBreakWaiverStatus,
  type Database,
} from "@kizami/db";
import { dispatch } from "@kizami/notify";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requirePermission } from "../authz.js";
import { resolveApproversForUser } from "../lib/approvers.js";
import { computeMonthlyOutputForUser } from "../lib/closing-amend.js";
import { assertAmendAllowed } from "../lib/closing-guard.js";
import { engineOutputFromSnapshots, snapshotInputsFromEngineOutput, sumFixedBreakdown } from "../lib/closing-snapshot.js";
import { buildPersonalChannels, buildTenantChannels, type BuildPersonalChannelsOptions } from "../lib/notification-channels.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { nowMinutes, parseMonthParam } from "../lib/time.js";

const MAX_REASON_LENGTH = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 承認・却下の両方が要求する権限(カタログの判断点コメント参照)。 */
const APPROVE_PERMISSION = "attendance.correction.approve";
/** 一覧で他者分を見るための権限。attendance.correction.approve が含意展開で自動的に含む
 * (packages/authz/src/implied.ts)ため、承認権限だけを持つ人も一覧は見える。 */
const VIEW_ALL_PERMISSION = "attendance.correction.view_all";

/** pending 以外からの承認/却下操作を、行が見つからなかった場合と区別するための内部シグナル(corrections.ts と同じ形)。 */
class NotPendingConflictError extends Error {}

interface CreateWaiverBody {
  waiveDate?: unknown;
  reason?: unknown;
}

interface DecisionBody {
  note?: unknown;
}

function serializeWaiver(row: AutoBreakWaiver) {
  return {
    id: row.id,
    userId: row.userId,
    requestedBy: row.requestedBy,
    status: row.status,
    waiveDate: row.waiveDate,
    reason: row.reason,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt,
  };
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

function isValidReason(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_REASON_LENGTH;
}

export type AutoBreakWaiversRoutesDeps = BuildPersonalChannelsOptions;

export function createAutoBreakWaiversRoutes(db: Database, deps: AutoBreakWaiversRoutesDeps = {}) {
  const app = new Hono<AppEnv>();

  // ---- GET / ----
  // 既定は自分の一覧。?userId= で他者を明示指定した場合、または VIEW_ALL_PERMISSION
  // (承認権限からの含意展開を含む)を持つ場合はスコープ内の他者分も返す
  // (GET /leave/balance?userId= と同じ「既定は自分・権限があれば拡張」の流儀)。
  app.get("/", async (c) => {
    const user = c.get("user");

    const statusParam = c.req.query("status") ?? "pending";
    let status: AutoBreakWaiverStatus | undefined;
    if (statusParam === "pending") {
      status = "pending";
    } else if (statusParam === "all") {
      status = undefined;
    } else {
      return c.json({ error: "invalid_status" }, 400);
    }

    const permissions = c.get("permissions");
    const queryUserId = c.req.query("userId");

    if (queryUserId !== undefined && queryUserId !== user.id) {
      const accessible = await resolveAccessibleUserIds(db, {
        actor: { id: user.id, tenantId: user.tenantId, permissions },
        permission: VIEW_ALL_PERMISSION,
      });
      if (accessible !== "all" && !accessible.has(queryUserId)) {
        throw new ForbiddenError(`target user ${queryUserId} is outside actor's scope`);
      }
      // 自テナントに実在するユーザーであることを確認する(2026-08-24 マルチテナント有効化)。
      // 他テナントのユーザーIDに 200(空配列)を返さないため。routes/corrections.ts の GET / と同じ。
      const target = await getUserById(db, { tenantId: user.tenantId, id: queryUserId });
      if (!target) return c.json({ error: "not_found" }, 404);
      const requests = await listAutoBreakWaivers(db, {
        tenantId: user.tenantId,
        userId: queryUserId,
        ...(status !== undefined ? { status } : {}),
      });
      return c.json({ requests: requests.map(serializeWaiver) });
    }

    // userId 未指定: VIEW_ALL_PERMISSION を持たなければ自分の分だけ(権限が無いのに
    // 「未指定=スコープ全員」を返すと事故になるため、明示的な userId 指定が無い限り自分に絞る)。
    if (permissions.get(VIEW_ALL_PERMISSION) === undefined) {
      const requests = await listAutoBreakWaivers(db, {
        tenantId: user.tenantId,
        userId: user.id,
        ...(status !== undefined ? { status } : {}),
      });
      return c.json({ requests: requests.map(serializeWaiver) });
    }

    // queries/auto-break-waivers.ts の listAutoBreakWaivers は複数ユーザーIDの一括絞り込みを
    // 持たない(packages/db は変更禁止のスコープ外)ため、tenantId のみで取得しアプリ層で
    // スコープ内に絞り込む(テナントあたり小規模という前提は apps/api/src/lib/scope.ts と同じ)。
    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions },
      permission: VIEW_ALL_PERMISSION,
    });
    const requests = await listAutoBreakWaivers(db, {
      tenantId: user.tenantId,
      ...(status !== undefined ? { status } : {}),
    });
    const scoped = accessible === "all" ? requests : requests.filter((r) => accessible.has(r.userId));
    return c.json({ requests: scoped.map(serializeWaiver) });
  });

  // ---- POST / ----
  // 本人申請のみ(代理申請は v0.2 第一弾の対象外。correction_requests / leave_requests と同じ)。
  //
  // 判断点(依頼に明記): waiveDate に実際に自動控除が発生しているかどうかはここで検証しない。
  // 申請時点ではその月の集計(computeMonthlyForUser)を回していないため、検証しようとすると
  // 月次計算をこのためだけに実行する必要があり、「打刻の存在しない日を指定した」等の
  // 素朴なミス以外はどのみち確実には弾けない(設定変更・他の修正申請の承認等で申請後に
  // 自動控除の有無が変わりうる)。承認者(attendance.correction.approve)が実際の月次を見て
  // 判断する運用にする方が、この申請テーブル自体を「追記専用の意思表示の記録」として単純に
  // 保てる(corrections.ts の POST / が締め済み月でも申請自体は常に作成できるのと同じ考え方)。
  app.post("/", async (c) => {
    const user = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { waiveDate, reason } = body as CreateWaiverBody;

    if (typeof waiveDate !== "string" || !DATE_RE.test(waiveDate)) {
      return c.json({ error: "invalid_waive_date" }, 400);
    }
    if (!isValidReason(reason)) {
      return c.json({ error: "invalid_reason" }, 400);
    }

    const created = await createAutoBreakWaiver(db, {
      tenantId: user.tenantId,
      userId: user.id,
      requestedBy: user.id,
      waiveDate,
      reason,
      createdAt: nowMinutes(),
    });

    // 承認依頼の通知(routes/corrections.ts の POST / と同じ形。詳細な設計理由は
    // routes/corrections.ts のヘッダコメント参照)。申請者自身が承認権限を持つ場合でも、
    // 自分の申請の通知は自分には送らない。
    const approverIds = (
      await resolveApproversForUser(db, { tenantId: user.tenantId, subjectUserId: user.id, permission: APPROVE_PERMISSION })
    ).filter((id) => id !== user.id);

    const notificationType = "approval_request_waiver";
    const title = "承認待ちの休憩自動控除打ち消し申請があります";
    const notificationBody = `${user.displayName}さんから休憩自動控除の打ち消し申請が届きました。確認してください。`;

    for (const approverId of approverIds) {
      const notification = await createNotificationIfAbsent(db, {
        tenantId: user.tenantId,
        userId: approverId,
        type: notificationType,
        subjectDate: null,
        title,
        body: notificationBody,
        createdAt: created.createdAt,
      });
      if (notification) {
        const channels = await buildPersonalChannels(db, { tenantId: user.tenantId, userId: approverId, notificationType }, deps);
        if (channels.length > 0) {
          await dispatch(channels, { to: {}, title, body: notificationBody });
        }
      }
    }

    // テナント共有 Webhook にも1件(routes/corrections.ts の POST / と同じ判断: 承認者が
    // 1人もいなくてもテナント側の共有チャネルが設定されていれば送る)。
    const tenantChannels = await buildTenantChannels(db, user.tenantId, deps);
    if (tenantChannels.length > 0) {
      await dispatch(tenantChannels, {
        to: {},
        title,
        body: `${user.displayName}さんから休憩自動控除の打ち消し申請が届きました。/auto-break-waivers で確認してください。`,
      });
    }

    // 締め後修正(amend): 申請自体は締め済み月でも作成できる(意思表示の記録に過ぎない —
    // corrections.ts / leave.ts と同じ)。承認時にのみ closing.unlock を要求する。
    const period = waiveDate.slice(0, 7);
    const closingState = await getClosingState(db, { tenantId: user.tenantId, period });

    return c.json({ waiver: serializeWaiver(created), targetMonthClosed: closingState.status === "closed" }, 201);
  });

  // ---- POST /:id/approve ----
  app.post("/:id/approve", async (c) => {
    const user = c.get("user");
    requirePermission(c, APPROVE_PERMISSION, "department");

    const body = await parseJsonBody(c);
    if (body === null || (body.note !== undefined && typeof body.note !== "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const note = ((body as DecisionBody).note as string | undefined) ?? null;

    const id = c.req.param("id");
    const existing = await getAutoBreakWaiverById(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }

    const permissions = c.get("permissions");
    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions },
      permission: APPROVE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(existing.userId)) {
      throw new ForbiddenError(`target user ${existing.userId} is outside actor's scope`);
    }

    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const now = nowMinutes();
    const selfApproved = existing.requestedBy === user.id;
    const period = existing.waiveDate.slice(0, 7);
    const parsedMonth = parseMonthParam(period);
    if (!parsedMonth) {
      throw new Error(`auto_break_waiver ${existing.id} has an unparsable waiveDate: ${existing.waiveDate}`);
    }

    let result: { updated: AutoBreakWaiver; amended: boolean };
    try {
      result = await db.transaction(async (tx) => {
        // 締め済み月への反映は closing.unlock を持つ場合のみ許可する(corrections.ts と同じ)。
        const wasClosed = await assertAmendAllowed(tx, { tenantId: user.tenantId, period, permissions });

        const updated = await decideAutoBreakWaiver(tx, {
          id: existing.id,
          tenantId: user.tenantId,
          status: "approved",
          decidedBy: user.id,
          decidedAt: now,
          decisionNote: note,
        });
        if (!updated) {
          throw new NotPendingConflictError();
        }

        await insertAuditLog(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "auto_break_waiver.approve",
          targetType: "auto_break_waiver",
          targetId: existing.id,
          detail: JSON.stringify({ selfApproved, userId: existing.userId, waiveDate: existing.waiveDate, amended: wasClosed }),
          occurredAt: now,
        });

        // amend: 締め済み月に影響する場合、月を開けずに対象ユーザーの集計を再計算し
        // 新しいスナップショット世代として保存 + closing_events に amend を追記する
        // (corrections.ts の POST /:id/approve と同じ形)。
        if (wasClosed) {
          const beforeSnapshots = (await getClosingSnapshots(tx, { tenantId: user.tenantId, period })).filter(
            (s) => s.userId === existing.userId,
          );
          const before = engineOutputFromSnapshots(beforeSnapshots);

          const output = await computeMonthlyOutputForUser(tx, {
            tenantId: user.tenantId,
            userId: existing.userId,
            year: parsedMonth.year,
            month: parsedMonth.month,
          });

          const amendEvent = await appendClosingEvent(tx, {
            tenantId: user.tenantId,
            period,
            event: "amend",
            actorId: user.id,
            // closing_events は correction_request_id / leave_request_id の2種類の構造化FKしか
            // 持たず、auto_break_waiver 用の列が無い(packages/db は今回変更禁止のスコープ外の
            // ため追加できない)。note に参照だけ残しておく — 完全な detail は直後の
            // closing.amend 監査ログ側に持たせる。
            note: `auto_break_waiver:${existing.id}`,
            occurredAt: now,
          });

          await saveClosingSnapshots(
            tx,
            snapshotInputsFromEngineOutput({
              tenantId: user.tenantId,
              closingEventId: amendEvent.id,
              userId: existing.userId,
              output,
            }),
          );

          await insertAuditLog(tx, {
            tenantId: user.tenantId,
            actorId: user.id,
            action: "closing.amend",
            targetType: "closing",
            targetId: period,
            detail: JSON.stringify({
              period,
              autoBreakWaiverId: existing.id,
              before,
              after: {
                totals: output.totals,
                flexBalance: output.flexBalance,
                fixedBreakdown: output.workSystem === "fixed" ? sumFixedBreakdown(output.days) : null,
              },
            }),
            occurredAt: now,
          });
        }

        return { updated, amended: wasClosed };
      });
    } catch (err) {
      if (err instanceof NotPendingConflictError) {
        return c.json({ error: "not_pending" }, 409);
      }
      if (isUniqueConstraintError(err)) {
        // 同一 (tenantId, userId, waiveDate) の approved 重複(部分 UNIQUE index、
        // queries/auto-break-waivers.ts の decideAutoBreakWaiver コメント参照)。
        return c.json({ error: "already_approved" }, 409);
      }
      throw err;
    }

    // 本人へ通知(承認は本人にとって「休憩が減り、実労働・残業が増える」変化であり、
    // 気づけることが自動控除機能自体の要件〔docs/design/breaks.md〕であるため、
    // 打ち消しの承認自体も本人へ知らせる。buildPersonalChannels 経由 —
    // テナント共有チャネルには個人の勤怠情報を流さない、apps/api/src/lib/notification-channels.ts
    // の設計原則をそのまま踏襲する)。作成できた(=重複していない)通知だけを外部送信する
    // (reminders.ts / leave-alerts.ts と同じ冪等パターン)。
    const notificationType = "auto_break_waiver_approved";
    const title = "休憩自動控除の打ち消しが承認されました";
    const notificationBody = `${existing.waiveDate} の休憩自動控除の打ち消し申請が承認されました。この日の自動控除は反映されません。`;
    const notification = await createNotificationIfAbsent(db, {
      tenantId: user.tenantId,
      userId: existing.userId,
      type: notificationType,
      subjectDate: existing.waiveDate,
      title,
      body: notificationBody,
      createdAt: now,
    });
    if (notification) {
      const channels = await buildPersonalChannels(
        db,
        { tenantId: user.tenantId, userId: existing.userId, notificationType },
        deps,
      );
      if (channels.length > 0) {
        await dispatch(channels, { to: {}, title, body: notificationBody });
      }
    }

    return c.json({ waiver: serializeWaiver(result.updated), amended: result.amended }, 200);
  });

  // ---- POST /:id/reject ----
  app.post("/:id/reject", async (c) => {
    const user = c.get("user");
    requirePermission(c, APPROVE_PERMISSION, "department");

    const body = await parseJsonBody(c);
    if (body === null || (body.note !== undefined && typeof body.note !== "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const note = ((body as DecisionBody).note as string | undefined) ?? null;

    const id = c.req.param("id");
    const existing = await getAutoBreakWaiverById(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }

    const permissions = c.get("permissions");
    const accessible = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions },
      permission: APPROVE_PERMISSION,
    });
    if (accessible !== "all" && !accessible.has(existing.userId)) {
      throw new ForbiddenError(`target user ${existing.userId} is outside actor's scope`);
    }

    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const now = nowMinutes();
    const selfApproved = existing.requestedBy === user.id;

    try {
      const updated = await db.transaction(async (tx) => {
        const result = await decideAutoBreakWaiver(tx, {
          id: existing.id,
          tenantId: user.tenantId,
          status: "rejected",
          decidedBy: user.id,
          decidedAt: now,
          decisionNote: note,
        });
        if (!result) {
          throw new NotPendingConflictError();
        }
        await insertAuditLog(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "auto_break_waiver.reject",
          targetType: "auto_break_waiver",
          targetId: existing.id,
          detail: JSON.stringify({ selfApproved, userId: existing.userId, waiveDate: existing.waiveDate }),
          occurredAt: now,
        });
        return result;
      });

      return c.json({ waiver: serializeWaiver(updated) }, 200);
    } catch (err) {
      if (err instanceof NotPendingConflictError) {
        return c.json({ error: "not_pending" }, 409);
      }
      throw err;
    }
  });

  // ---- POST /:id/withdraw ----
  // 本人のみ・pending のみ(corrections.ts と同じ)。
  app.post("/:id/withdraw", async (c) => {
    const user = c.get("user");

    const id = c.req.param("id");
    const existing = await getAutoBreakWaiverById(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (existing.requestedBy !== user.id) {
      throw new ForbiddenError("cannot withdraw another user's auto break waiver");
    }
    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const updated = await withdrawAutoBreakWaiver(db, { id: existing.id, tenantId: user.tenantId, userId: user.id });
    if (!updated) {
      return c.json({ error: "not_pending" }, 409);
    }

    return c.json({ waiver: serializeWaiver(updated) }, 200);
  });

  return app;
}
