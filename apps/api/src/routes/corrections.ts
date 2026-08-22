/**
 * GET /corrections, POST /corrections, POST /corrections/:id/approve,
 * POST /corrections/:id/reject, POST /corrections/:id/withdraw
 *
 * 打刻修正申請フロー(v0.2 第一弾)。参照: docs/design/v01-data-model.md §correction_requests。
 *
 * v0.1 と同じく本人スコープのみ(requireSelf)。POST /corrections は本文に対象者 id を
 * 取らず、常に認証済みユーザー自身を対象・申請者とする(代理申請は v0.2 の対象外)。
 *
 * 認可(暫定運用, 2026-08-21 決定): 単独テナント運用で申請が滞留しないよう、
 * 自分が提出した申請の承認・却下を許可する。監査ログには selfApproved を残す。
 * 他人の申請の承認は今回スコープ外(403)。
 *
 * 締め後修正(amend, v0.4): POST / は締め済み月でも申請を作成できる(申請は意思表示の記録に
 * 過ぎない)。レスポンスの `targetMonthClosed` で対象月が締め済みかどうかを示し、UI が警告を
 * 出せるようにする。承認(POST /:id/approve)は締め済み月に影響する場合のみ `closing.unlock`
 * 権限を要求し(assertAmendAllowed)、許可されれば月を開けずに反映し、対象ユーザーの
 * スナップショットを再計算して新しい世代を保存 + closing_events に `amend` を追記する
 * (apps/api/src/lib/closing-guard.ts・closing-amend.ts 参照)。
 */

import { Hono } from "hono";
import {
  appendClosingEvent,
  createCorrectionRequest,
  getClosingSnapshots,
  getClosingState,
  getCorrectionRequest,
  getPunchEventById,
  getValidPunchEvent,
  insertAuditLog,
  insertPunchEvent,
  isUniqueConstraintError,
  listCorrectionRequests,
  saveClosingSnapshots,
  updateCorrectionStatus,
  type CorrectionRequest,
  type CorrectionStatus,
  type Database,
} from "@kizami/db";
import type { PunchKind } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requireSelf } from "../authz.js";
import { periodFromDate, resolveAttendanceDate } from "../lib/attendance-date.js";
import { assertAmendAllowed } from "../lib/closing-guard.js";
import { computeMonthlyOutputForUser } from "../lib/closing-amend.js";
import { engineOutputFromSnapshots, snapshotInputsFromEngineOutput, sumFixedBreakdown } from "../lib/closing-snapshot.js";
import { FUTURE_TOLERANCE_MINUTES, isValidPunchKind } from "./punches.js";
import { nowMinutes, parseMonthParam } from "../lib/time.js";

const MAX_REASON_LENGTH = 500;

/** pending 以外からの承認/却下操作を、行が見つからなかった場合と区別するための内部シグナル。 */
class NotPendingConflictError extends Error {}

interface CreateCorrectionBody {
  targetEventId?: unknown;
  proposedKind?: unknown;
  proposedOccurredAt?: unknown;
  reason?: unknown;
}

interface DecisionBody {
  note?: unknown;
}

/**
 * 対象打刻のスナップショット。承認後に対象が supersede されると有効打刻から
 * 消えるため、クライアントが後から引き直せない。申請の表示に必要な最小限を返す。
 */
interface TargetPunchSnapshot {
  kind: string;
  occurredAt: number;
}

function serializeCorrectionRequest(row: CorrectionRequest, target?: TargetPunchSnapshot | null) {
  return {
    id: row.id,
    userId: row.userId,
    requestedBy: row.requestedBy,
    status: row.status,
    targetEventId: row.targetEventId,
    targetPunch: target ?? null,
    proposedKind: row.proposedKind,
    proposedOccurredAt: row.proposedOccurredAt,
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

export function createCorrectionsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const statusParam = c.req.query("status") ?? "pending";
    let status: CorrectionStatus | undefined;
    if (statusParam === "pending") {
      status = "pending";
    } else if (statusParam === "all") {
      status = undefined;
    } else {
      return c.json({ error: "invalid_status" }, 400);
    }

    const requests = await listCorrectionRequests(db, {
      tenantId: user.tenantId,
      userId: user.id,
      ...(status !== undefined ? { status } : {}),
    });
    // 対象打刻は superseded 後も参照できるよう、ここで解決して同梱する
    const targets = new Map<string, TargetPunchSnapshot>();
    for (const id of new Set(requests.map((r) => r.targetEventId).filter((id): id is string => id !== null))) {
      const event = await getPunchEventById(db, id);
      if (event) targets.set(id, { kind: event.kind, occurredAt: event.occurredAt });
    }

    return c.json({
      requests: requests.map((r) =>
        serializeCorrectionRequest(r, r.targetEventId ? (targets.get(r.targetEventId) ?? null) : null),
      ),
    });
  });

  app.post("/", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const body = await parseJsonBody(c);
    if (body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { targetEventId, proposedKind, proposedOccurredAt, reason } = body as CreateCorrectionBody;

    if (!isValidReason(reason)) {
      return c.json({ error: "invalid_reason" }, 400);
    }

    const hasTarget = targetEventId !== undefined;
    const hasProposed = proposedKind !== undefined || proposedOccurredAt !== undefined;

    if (hasTarget && typeof targetEventId !== "string") {
      return c.json({ error: "invalid_target_event" }, 400);
    }

    // 3ケースの判別: 訂正(target + proposed両方) / 追加(target無し + proposed両方) / 取消(targetのみ)
    const isCorrection = hasTarget && proposedKind !== undefined && proposedOccurredAt !== undefined;
    const isAddition = !hasTarget && proposedKind !== undefined && proposedOccurredAt !== undefined;
    const isCancellation = hasTarget && !hasProposed;

    if (!isCorrection && !isAddition && !isCancellation) {
      return c.json({ error: "invalid_request_shape" }, 400);
    }

    let validatedKind: PunchKind | null = null;
    let validatedOccurredAt: number | null = null;
    if (isCorrection || isAddition) {
      if (!isValidPunchKind(proposedKind)) {
        return c.json({ error: "invalid_proposed_kind" }, 400);
      }
      if (typeof proposedOccurredAt !== "number" || !Number.isInteger(proposedOccurredAt)) {
        return c.json({ error: "invalid_proposed_occurred_at" }, 400);
      }
      const now = nowMinutes();
      if (proposedOccurredAt > now + FUTURE_TOLERANCE_MINUTES) {
        return c.json({ error: "proposed_occurred_at_in_future" }, 400);
      }
      validatedKind = proposedKind;
      validatedOccurredAt = proposedOccurredAt;
    }

    let validatedTargetEventId: string | null = null;
    let targetOccurredAt: number | null = null;
    if (hasTarget) {
      // 自分の有効打刻であること(他人/存在しない/既に無効化済みはすべて null になり 400)
      const target = await getValidPunchEvent(db, { tenantId: user.tenantId, userId: user.id, id: targetEventId as string });
      if (!target) {
        return c.json({ error: "invalid_target_event" }, 400);
      }
      validatedTargetEventId = target.id;
      targetOccurredAt = target.occurredAt;
    }

    // 締め後修正(amend): 申請自体は締め済み月でも作成できる(意思表示の記録に過ぎない —
    // 承認時にのみ closing.unlock を要求する。POST /:id/approve 参照)。対象打刻の元の日
    // (訂正・取消)と、申請内容の日(訂正・追加)のいずれかが締め済み月なら
    // targetMonthClosed=true を返し、UI が警告を出せるようにする。
    const candidateOccurredAts = [targetOccurredAt, validatedOccurredAt].filter((v): v is number => v !== null);
    const candidatePeriods = new Set<string>();
    for (const occurredAt of candidateOccurredAts) {
      const date = await resolveAttendanceDate(db, { tenantId: user.tenantId, occurredAt });
      candidatePeriods.add(periodFromDate(date));
    }
    let targetMonthClosed = false;
    for (const period of candidatePeriods) {
      const state = await getClosingState(db, { tenantId: user.tenantId, period });
      if (state.status === "closed") {
        targetMonthClosed = true;
        break;
      }
    }

    const created = await createCorrectionRequest(db, {
      tenantId: user.tenantId,
      userId: user.id,
      requestedBy: user.id,
      targetEventId: validatedTargetEventId,
      proposedKind: validatedKind,
      proposedOccurredAt: validatedOccurredAt,
      reason,
      createdAt: nowMinutes(),
    });

    return c.json({ request: serializeCorrectionRequest(created), targetMonthClosed }, 201);
  });

  app.post("/:id/approve", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const body = await parseJsonBody(c);
    if (body === null || (body.note !== undefined && typeof body.note !== "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const note = ((body as DecisionBody).note as string | undefined) ?? null;

    const id = c.req.param("id");
    const existing = await getCorrectionRequest(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }
    // v0.1 暫定運用: 自分が提出した申請のみ承認できる(他人の申請の承認は今回スコープ外)
    if (existing.requestedBy !== user.id) {
      throw new ForbiddenError("cannot approve another user's correction request");
    }
    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const now = nowMinutes();
    const selfApproved = existing.requestedBy === user.id;

    // 対象打刻の occurred_at を読む(取消の場合は void イベントに引き継ぐ必要があるが、
    // 訂正の場合も締め済み月ガードで「対象打刻の元の日」を見るために必要)。
    // punch_events は不変(追記専用)なので、トランザクション外で読んでも値がずれる心配はない。
    let voidOccurredAt: number | null = null;
    let originalTargetOccurredAt: number | null = null;
    if (existing.targetEventId) {
      const target = await getPunchEventById(db, existing.targetEventId);
      if (!target) {
        return c.json({ error: "not_found" }, 404);
      }
      originalTargetOccurredAt = target.occurredAt;
      if (!existing.proposedKind) {
        voidOccurredAt = target.occurredAt;
      }
    }

    // 反映先(訂正・追加の proposedOccurredAt、取消の voidOccurredAt)と、対象打刻の元の日
    // (訂正・取消)の両方を対象月として集める(POST /corrections の作成時と同じ理由)。
    const candidateOccurredAts = [originalTargetOccurredAt, existing.proposedOccurredAt, voidOccurredAt].filter(
      (v): v is number => v !== null,
    );
    const candidatePeriods = new Set<string>();
    for (const occurredAt of candidateOccurredAts) {
      const date = await resolveAttendanceDate(db, { tenantId: user.tenantId, occurredAt });
      candidatePeriods.add(periodFromDate(date));
    }

    const permissions = c.get("permissions");

    try {
      const result = await db.transaction(async (tx) => {
        // 締め済み月への反映は closing.unlock を持つ場合のみ許可する(assertAmendAllowed)。
        // 申請作成後に締められた場合にも対応できるよう、書き込み直前(tx 内)で再評価する。
        // closed だった period は amendedPeriods に集め、反映後にスナップショットを
        // 再計算・保存し amend イベントを追記する(依頼: 同一トランザクションで行う)。
        const amendedPeriods: string[] = [];
        for (const period of candidatePeriods) {
          const wasClosed = await assertAmendAllowed(tx, { tenantId: user.tenantId, period, permissions });
          if (wasClosed) amendedPeriods.push(period);
        }

        let newEvent;
        if (existing.targetEventId && existing.proposedKind && existing.proposedOccurredAt !== null) {
          // 訂正
          newEvent = await insertPunchEvent(tx, {
            tenantId: user.tenantId,
            userId: existing.userId,
            kind: existing.proposedKind,
            occurredAt: existing.proposedOccurredAt,
            recordedAt: now,
            source: "web",
            actorId: user.id,
            supersedesId: existing.targetEventId,
            correctionRequestId: existing.id,
          });
        } else if (!existing.targetEventId && existing.proposedKind && existing.proposedOccurredAt !== null) {
          // 追加
          newEvent = await insertPunchEvent(tx, {
            tenantId: user.tenantId,
            userId: existing.userId,
            kind: existing.proposedKind,
            occurredAt: existing.proposedOccurredAt,
            recordedAt: now,
            source: "web",
            actorId: user.id,
            correctionRequestId: existing.id,
          });
        } else if (existing.targetEventId && !existing.proposedKind && voidOccurredAt !== null) {
          // 取消
          newEvent = await insertPunchEvent(tx, {
            tenantId: user.tenantId,
            userId: existing.userId,
            kind: "void",
            occurredAt: voidOccurredAt,
            recordedAt: now,
            source: "web",
            actorId: user.id,
            supersedesId: existing.targetEventId,
            correctionRequestId: existing.id,
          });
        } else {
          throw new Error(`correction_request ${existing.id} has an unrecognized shape`);
        }

        const updated = await updateCorrectionStatus(tx, {
          id: existing.id,
          tenantId: user.tenantId,
          fromStatus: "pending",
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
          action: "correction.approve",
          targetType: "correction_request",
          targetId: existing.id,
          detail: JSON.stringify({
            selfApproved,
            targetEventId: existing.targetEventId,
            appliedEventId: newEvent.id,
            amendedPeriods,
          }),
          occurredAt: now,
        });

        // amend: 影響を受けた締め済み月ごとに、対象ユーザーの集計を再計算し新しい
        // スナップショット世代として保存 + closing_events に amend を追記する。
        for (const period of amendedPeriods) {
          const parsedMonth = parseMonthParam(period);
          if (!parsedMonth) {
            throw new Error(`amendedPeriods contained an unparsable period: ${period}`);
          }

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
            note: null,
            correctionRequestId: existing.id,
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
              correctionRequestId: existing.id,
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

        return { correctionRequest: updated, newEvent, amendedPeriods };
      });

      return c.json(
        {
          request: serializeCorrectionRequest(result.correctionRequest),
          appliedEvent: { id: result.newEvent.id, kind: result.newEvent.kind, occurredAt: result.newEvent.occurredAt },
          amended: result.amendedPeriods.length > 0,
          amendedPeriods: result.amendedPeriods,
        },
        200,
      );
    } catch (err) {
      if (err instanceof NotPendingConflictError) {
        return c.json({ error: "not_pending" }, 409);
      }
      if (isUniqueConstraintError(err)) {
        return c.json({ error: "already_superseded" }, 409);
      }
      throw err;
    }
  });

  app.post("/:id/reject", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const body = await parseJsonBody(c);
    if (body === null || (body.note !== undefined && typeof body.note !== "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const note = ((body as DecisionBody).note as string | undefined) ?? null;

    const id = c.req.param("id");
    const existing = await getCorrectionRequest(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (existing.requestedBy !== user.id) {
      throw new ForbiddenError("cannot reject another user's correction request");
    }
    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const now = nowMinutes();
    const selfApproved = existing.requestedBy === user.id;

    try {
      const updated = await db.transaction(async (tx) => {
        const result = await updateCorrectionStatus(tx, {
          id: existing.id,
          tenantId: user.tenantId,
          fromStatus: "pending",
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
          action: "correction.reject",
          targetType: "correction_request",
          targetId: existing.id,
          detail: JSON.stringify({ selfApproved }),
          occurredAt: now,
        });
        return result;
      });

      return c.json({ request: serializeCorrectionRequest(updated) }, 200);
    } catch (err) {
      if (err instanceof NotPendingConflictError) {
        return c.json({ error: "not_pending" }, 409);
      }
      throw err;
    }
  });

  app.post("/:id/withdraw", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const id = c.req.param("id");
    const existing = await getCorrectionRequest(db, id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return c.json({ error: "not_found" }, 404);
    }
    // 申請者本人のみ
    if (existing.requestedBy !== user.id) {
      throw new ForbiddenError("cannot withdraw another user's correction request");
    }
    if (existing.status !== "pending") {
      return c.json({ error: "not_pending" }, 409);
    }

    const updated = await updateCorrectionStatus(db, {
      id: existing.id,
      tenantId: user.tenantId,
      fromStatus: "pending",
      status: "withdrawn",
    });
    if (!updated) {
      return c.json({ error: "not_pending" }, 409);
    }

    return c.json({ request: serializeCorrectionRequest(updated) }, 200);
  });

  return app;
}
