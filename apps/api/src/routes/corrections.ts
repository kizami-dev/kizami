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
 */

import { Hono } from "hono";
import {
  createCorrectionRequest,
  getCorrectionRequest,
  getPunchEventById,
  getValidPunchEvent,
  insertAuditLog,
  insertPunchEvent,
  isUniqueConstraintError,
  listCorrectionRequests,
  updateCorrectionStatus,
  type CorrectionRequest,
  type CorrectionStatus,
  type Database,
} from "@kizami/db";
import type { PunchKind } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requireSelf } from "../authz.js";
import { FUTURE_TOLERANCE_MINUTES, isValidPunchKind } from "./punches.js";
import { nowMinutes } from "../lib/time.js";

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

function serializeCorrectionRequest(row: CorrectionRequest) {
  return {
    id: row.id,
    userId: row.userId,
    requestedBy: row.requestedBy,
    status: row.status,
    targetEventId: row.targetEventId,
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
    return c.json({ requests: requests.map(serializeCorrectionRequest) });
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
    if (hasTarget) {
      // 自分の有効打刻であること(他人/存在しない/既に無効化済みはすべて null になり 400)
      const target = await getValidPunchEvent(db, { tenantId: user.tenantId, userId: user.id, id: targetEventId as string });
      if (!target) {
        return c.json({ error: "invalid_target_event" }, 400);
      }
      validatedTargetEventId = target.id;
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

    return c.json({ request: serializeCorrectionRequest(created) }, 201);
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

    // 取消(kind='void')の場合のみ、無効化対象イベントの occurred_at を引き継ぐ必要がある。
    // punch_events は不変(追記専用)なので、トランザクション外で読んでも値がずれる心配はない。
    let voidOccurredAt: number | null = null;
    if (existing.targetEventId && !existing.proposedKind) {
      const target = await getPunchEventById(db, existing.targetEventId);
      if (!target) {
        return c.json({ error: "not_found" }, 404);
      }
      voidOccurredAt = target.occurredAt;
    }

    try {
      const result = await db.transaction(async (tx) => {
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
          }),
          occurredAt: now,
        });

        return { correctionRequest: updated, newEvent };
      });

      return c.json(
        {
          request: serializeCorrectionRequest(result.correctionRequest),
          appliedEvent: { id: result.newEvent.id, kind: result.newEvent.kind, occurredAt: result.newEvent.occurredAt },
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
