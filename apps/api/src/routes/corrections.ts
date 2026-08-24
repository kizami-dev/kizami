/**
 * GET /corrections, POST /corrections, POST /corrections/:id/approve,
 * POST /corrections/:id/reject, POST /corrections/:id/withdraw
 *
 * 打刻修正申請フロー(v0.2 第一弾)。参照: docs/design/v01-data-model.md §correction_requests。
 *
 * POST /corrections は本文に対象者 id を取らず、常に認証済みユーザー自身を対象・申請者とする
 * (代理申請は v0.2 の対象外)。withdraw も本人のみ(pending の取り下げは申請者本人の意思表示
 * であり、権限の話ではない)。
 *
 * 認可(2026-08-23 改定): 「単独テナント運用で申請が滞留しないための暫定実装(2026-08-21
 * 決定・requestedBy 自身のみが承認できる自己承認方式)」を、権限カタログに元々定義されていた
 * `attendance.correction.approve` + apps/api/src/lib/scope.ts の resolveAccessibleUserIds に
 * よるスコープ判定を使う本来の権限ベース方式へ統一する(routes/auto-break-waivers.ts と
 * 完全に同じ形。以前は auto-break-waivers.ts だけがこの方式で、このファイルと食い違っていた —
 * 今回でその食い違いを解消する)。本人が自分の申請を承認することも引き続き可能だが、
 * それには `attendance.correction.approve` 権限そのものを持っている必要がある(v0.1の
 * 「誰でも自分の申請は承認できる」ではなくなる — 権限を持たない一般従業員は自分の申請も
 * 承認できず、承認権限を持つ人の判断を待つことになる)。監査ログには引き続き selfApproved を
 * 残す。GET / のスコープも同様に統一する: `attendance.correction.view_all`
 * (`attendance.correction.approve` が含意展開で自動的に含む)を持たなければ自分の分だけ、
 * 持てば `?userId=` 指定 or スコープ内全員を返す(routes/auto-break-waivers.ts の GET / と
 * 同じ形)。
 *
 * 承認・却下時の本人通知(2026-08-23 追加): 決裁者が申請者本人と異なる場合のみ、
 * apps/api/src/lib/notification-channels.ts の buildPersonalChannels 経由で本人へ通知する
 * (routes/auto-break-waivers.ts の POST /:id/approve と同じ形。waiver は approve のみ通知する
 * が、このファイルは依頼により approve・reject の両方で通知する)。
 *
 * 締め後修正(amend, v0.4): POST / は締め済み月でも申請を作成できる(申請は意思表示の記録に
 * 過ぎない)。レスポンスの `targetMonthClosed` で対象月が締め済みかどうかを示し、UI が警告を
 * 出せるようにする。承認(POST /:id/approve)は締め済み月に影響する場合のみ `closing.unlock`
 * 権限を要求し(assertAmendAllowed)、許可されれば月を開けずに反映し、対象ユーザーの
 * スナップショットを再計算して新しい世代を保存 + closing_events に `amend` を追記する
 * (apps/api/src/lib/closing-guard.ts・closing-amend.ts 参照)。
 *
 * 承認依頼の通知(2026-08-23 追加): POST / で申請が作成されたら、apps/api/src/lib/approvers.ts
 * の resolveApproversForUser で APPROVE_PERMISSION をこの申請者をスコープに含む形で保持する
 * ユーザー(=この申請を承認できる人)を解決し、申請者自身を除いた各人へ通知する
 * (アプリ内通知 + buildPersonalChannels 経由の個人チャネル、カテゴリは新設の
 * approval_request)。加えてテナント共有 Webhook(buildTenantChannels)にも1件通知する —
 * こちらは「誰から・何の申請か」の最小限の文面のみで、理由・時刻等の個人の詳細は書かない
 * (lib/notification-channels.ts の設計原則: テナント共有チャネルに他人の勤怠情報を流さない)。
 * 通知は完全にベストエフォート(失敗しても申請作成自体は成功のまま返す — 承認・却下時の
 * 本人通知と同じ扱いで、ここでも例外を握りつぶす特別な try/catch は追加しない)。
 */

import { Hono } from "hono";
import {
  appendClosingEvent,
  createCorrectionRequest,
  createNotificationIfAbsent,
  getClosingSnapshots,
  getClosingState,
  getCorrectionRequest,
  getPunchEventById,
  getUserById,
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
  type PunchEvent,
} from "@kizami/db";
import { dispatch } from "@kizami/notify";
import type { PunchKind } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { ForbiddenError, requirePermission, requireSelf } from "../authz.js";
import { resolveApproversForUser } from "../lib/approvers.js";
import { periodFromDate, resolveAttendanceDate } from "../lib/attendance-date.js";
import { assertAmendAllowed } from "../lib/closing-guard.js";
import { computeMonthlyOutputForUser } from "../lib/closing-amend.js";
import { engineOutputFromSnapshots, snapshotInputsFromEngineOutput, sumFixedBreakdown } from "../lib/closing-snapshot.js";
import { buildPersonalChannels, buildTenantChannels, type BuildPersonalChannelsOptions } from "../lib/notification-channels.js";
import { resolveAccessibleUserIds } from "../lib/scope.js";
import { FUTURE_TOLERANCE_MINUTES, isValidPunchKind } from "./punches.js";
import { nowMinutes, parseMonthParam } from "../lib/time.js";

const MAX_REASON_LENGTH = 500;

/** 承認・却下の両方が要求する権限(routes/auto-break-waivers.ts と共有する判断点コメント参照)。 */
const APPROVE_PERMISSION = "attendance.correction.approve";
/** 一覧で他者分を見るための権限。APPROVE_PERMISSION が含意展開で自動的に含む
 * (packages/authz/src/implied.ts)ため、承認権限だけを持つ人も一覧は見える。 */
const VIEW_ALL_PERMISSION = "attendance.correction.view_all";

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

export type CorrectionsRoutesDeps = BuildPersonalChannelsOptions;

export function createCorrectionsRoutes(db: Database, deps: CorrectionsRoutesDeps = {}) {
  const app = new Hono<AppEnv>();

  // ---- GET / ----
  // 既定は自分の一覧。?userId= で他者を明示指定した場合、または VIEW_ALL_PERMISSION
  // (承認権限からの含意展開を含む)を持つ場合はスコープ内の他者分も返す
  // (routes/auto-break-waivers.ts の GET / と同じ形)。
  app.get("/", async (c) => {
    const user = c.get("user");

    const statusParam = c.req.query("status") ?? "pending";
    let status: CorrectionStatus | undefined;
    if (statusParam === "pending") {
      status = "pending";
    } else if (statusParam === "all") {
      status = undefined;
    } else {
      return c.json({ error: "invalid_status" }, 400);
    }

    const permissions = c.get("permissions");
    const queryUserId = c.req.query("userId");

    let requests: CorrectionRequest[];
    if (queryUserId !== undefined && queryUserId !== user.id) {
      const accessible = await resolveAccessibleUserIds(db, {
        actor: { id: user.id, tenantId: user.tenantId, permissions },
        permission: VIEW_ALL_PERMISSION,
      });
      if (accessible !== "all" && !accessible.has(queryUserId)) {
        throw new ForbiddenError(`target user ${queryUserId} is outside actor's scope`);
      }
      // 自テナントに実在するユーザーであることを確認する(2026-08-24 マルチテナント有効化)。
      // 無いと他テナントのユーザーIDでも 200(空配列)を返してしまい、テナント越えの
      // 問い合わせがエラーにならない。GET /attendance/monthly?userId= と同じ 404 に揃える。
      const target = await getUserById(db, { tenantId: user.tenantId, id: queryUserId });
      if (!target) return c.json({ error: "not_found" }, 404);
      requests = await listCorrectionRequests(db, {
        tenantId: user.tenantId,
        userId: queryUserId,
        ...(status !== undefined ? { status } : {}),
      });
    } else if (permissions.get(VIEW_ALL_PERMISSION) === undefined) {
      // userId 未指定: VIEW_ALL_PERMISSION を持たなければ自分の分だけ(権限が無いのに
      // 「未指定=スコープ全員」を返すと事故になるため)。
      requests = await listCorrectionRequests(db, {
        tenantId: user.tenantId,
        userId: user.id,
        ...(status !== undefined ? { status } : {}),
      });
    } else {
      // queries/corrections.ts の listCorrectionRequests は複数ユーザーIDの一括絞り込みを
      // 持たないため、tenantId のみで取得しアプリ層でスコープ内に絞り込む
      // (apps/api/src/lib/scope.ts と同じ「テナントあたり小規模」の前提)。
      const accessible = await resolveAccessibleUserIds(db, {
        actor: { id: user.id, tenantId: user.tenantId, permissions },
        permission: VIEW_ALL_PERMISSION,
      });
      const all = await listCorrectionRequests(db, {
        tenantId: user.tenantId,
        ...(status !== undefined ? { status } : {}),
      });
      requests = accessible === "all" ? all : all.filter((r) => accessible.has(r.userId));
    }

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

    // 承認依頼の通知(ヘッダコメント参照)。申請者自身が承認権限を持ち自分に対して
    // 承認できる場合でも、自分の申請の通知は自分には送らない。
    const approverIds = (
      await resolveApproversForUser(db, { tenantId: user.tenantId, subjectUserId: user.id, permission: APPROVE_PERMISSION })
    ).filter((id) => id !== user.id);

    const notificationType = "approval_request_correction";
    const title = "承認待ちの打刻修正申請があります";
    const notificationBody = `${user.displayName}さんから打刻修正申請が届きました。確認してください。`;

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

    // テナント共有 Webhook にも1件(理由・時刻等の個人の詳細は書かない — ヘッダコメント参照)。
    // 承認者が(自己承認除外の結果)1人もいない場合でも、テナント側の共有チャネルが
    // 設定されていれば送る(buildTenantChannels が未設定なら自然に空配列になる)。
    const tenantChannels = await buildTenantChannels(db, user.tenantId, deps);
    if (tenantChannels.length > 0) {
      await dispatch(tenantChannels, {
        to: {},
        title,
        body: `${user.displayName}さんから打刻修正申請が届きました。/corrections で確認してください。`,
      });
    }

    return c.json({ request: serializeCorrectionRequest(created), targetMonthClosed }, 201);
  });

  app.post("/:id/approve", async (c) => {
    const user = c.get("user");
    requirePermission(c, APPROVE_PERMISSION, "department");

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

    let result: { correctionRequest: CorrectionRequest; newEvent: PunchEvent; amendedPeriods: string[] };
    try {
      result = await db.transaction(async (tx) => {
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
    } catch (err) {
      if (err instanceof NotPendingConflictError) {
        return c.json({ error: "not_pending" }, 409);
      }
      if (isUniqueConstraintError(err)) {
        return c.json({ error: "already_superseded" }, 409);
      }
      throw err;
    }

    // 本人へ通知(決裁者が申請者本人と異なる場合のみ。自己承認では自分に通知しない —
    // routes/auto-break-waivers.ts の POST /:id/approve と同じ判断。ただし waiver は
    // approve のみ通知するが、依頼によりこちらは approve・reject の両方で通知する)。
    if (!selfApproved) {
      const notificationType = "correction_request_approved";
      const title = "打刻修正申請が承認されました";
      const notificationBody = `あなたの打刻修正申請(理由: ${existing.reason})が承認され、勤怠記録に反映されました。`;
      const notification = await createNotificationIfAbsent(db, {
        tenantId: user.tenantId,
        userId: existing.userId,
        type: notificationType,
        // 対象打刻の日は訂正・追加・取消で意味が異なり、常に単一の代表日を選べるとは限らない
        // ため subject_date は使わない(null 同士は UNIQUE 制約で重複と判定されない —
        // packages/db/src/schema/notifications.ts の判断点コメント参照)。承認は pending から
        // 一度しか遷移できないため、この呼び出し自体は元々冪等でありこの選択で通知が
        // 重複作成される心配もない。
        subjectDate: null,
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
    }

    return c.json(
      {
        request: serializeCorrectionRequest(result.correctionRequest),
        appliedEvent: { id: result.newEvent.id, kind: result.newEvent.kind, occurredAt: result.newEvent.occurredAt },
        amended: result.amendedPeriods.length > 0,
        amendedPeriods: result.amendedPeriods,
      },
      200,
    );
  });

  app.post("/:id/reject", async (c) => {
    const user = c.get("user");
    requirePermission(c, APPROVE_PERMISSION, "department");

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

    let updated: CorrectionRequest;
    try {
      updated = await db.transaction(async (tx) => {
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
    } catch (err) {
      if (err instanceof NotPendingConflictError) {
        return c.json({ error: "not_pending" }, 409);
      }
      throw err;
    }

    if (!selfApproved) {
      const notificationType = "correction_request_rejected";
      const title = "打刻修正申請が却下されました";
      const notificationBody = note
        ? `あなたの打刻修正申請(理由: ${existing.reason})が却下されました。コメント: ${note}`
        : `あなたの打刻修正申請(理由: ${existing.reason})が却下されました。`;
      const notification = await createNotificationIfAbsent(db, {
        tenantId: user.tenantId,
        userId: existing.userId,
        type: notificationType,
        subjectDate: null,
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
    }

    return c.json({ request: serializeCorrectionRequest(updated) }, 200);
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
