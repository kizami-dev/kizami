"use client";

import { useMemo, useState } from "react";
import {
  api,
  ApiError,
  UnauthorizedError,
  type ApprovalFlowStateDto,
  type LeaveRequestDto,
  type LeaveRequestStatus,
} from "../lib/api";
import { mapLeaveRequestErrorMessage, messages } from "../lib/messages";
import { hasEffectivePermission } from "../lib/permissions";
import { formatDateLabel, formatDateTimeJst } from "../lib/time";
import { useEffectivePermissions } from "../lib/useEffectivePermissions";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * 休暇申請の承認(POST /leave/requests/:id/approve・reject)が要求する権限
 * (apps/api/src/routes/leave.ts の APPROVE_PERMISSION)。
 */
const APPROVE_PERMISSION = "leave.request.approve";

/**
 * 「未決裁」= まだ最終決裁に至っていない状態(2026-08-24 多段承認対応)。
 * pending は一次承認待ち、approved_step1 は一次承認済み・二次承認待ちで、どちらも
 * 取下げ可能・承認キューに出すべき行(docs/design/approval-flows.md)。
 */
function isOpenStatus(status: LeaveRequestStatus): boolean {
  return status === "pending" || status === "approved_step1";
}

/**
 * この行の「今の段」を、今ログインしている人が承認できるか(2026-08-24 多段承認対応)。
 *
 * 判断点: 二次承認(currentStep === 2)は leave.request.approve を **tenant スコープ** で
 * 持つ人しか行えない(apps/api は部署スコープの承認者に 403 を返す)。押しても必ず失敗する
 * ボタンは出さず、状態チップだけを見せる。「一次承認した本人は二次承認できない」
 * (409 same_approver_as_step1)はサーバーのエラー文言に委ねる。
 */
function canApproveCurrentStep(state: ApprovalFlowStateDto, canApprove: boolean, canApproveTenantWide: boolean): boolean {
  if (state.currentStep === 2) return canApproveTenantWide;
  return canApprove;
}

type Action = "approve" | "reject" | "withdraw";

interface ConfirmState {
  id: string;
  action: Action;
}

export interface LeaveRequestsListProps {
  requests: LeaveRequestDto[];
  currentUserId: string;
  /** 直近の申請作成で targetMonthClosed=true だった申請の ID(締め済み月への申請である旨の注記に使う)。 */
  closedMonthRequestId: string | null;
  onChanged: () => void;
  onUnauthorized: () => void;
}

export function LeaveRequestsList({ requests, currentUserId, closedMonthRequestId, onChanged, onUnauthorized }: LeaveRequestsListProps) {
  const { permissions: effectivePermissions } = useEffectivePermissions();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [note, setNote] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openConfirm(id: string, action: Action) {
    setConfirmState({ id, action });
    setNote("");
    setActionError(null);
  }

  async function handleConfirm() {
    if (!confirmState) return;
    setActionPending(true);
    setActionError(null);
    try {
      if (confirmState.action === "approve") {
        await api.approveLeaveRequest(confirmState.id, note || undefined);
      } else if (confirmState.action === "reject") {
        await api.rejectLeaveRequest(confirmState.id, note || undefined);
      } else {
        await api.withdrawLeaveRequest(confirmState.id);
      }
      setConfirmState(null);
      setNote("");
      onChanged();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setActionError(err instanceof ApiError ? mapLeaveRequestErrorMessage(err.body) : messages.errors.network);
    } finally {
      setActionPending(false);
    }
  }

  const confirmContent = useMemo(() => {
    if (!confirmState) return null;
    const req = requests.find((r) => r.id === confirmState.id);
    const selfApproved = req ? req.requestedBy === currentUserId : false;
    if (confirmState.action === "approve") {
      return {
        title: messages.leave.confirmApproveTitle,
        message: messages.leave.confirmApproveMessage,
        extraNote: selfApproved ? messages.leave.confirmApproveSelfNote : undefined,
        confirmLabel: messages.leave.approve,
        tone: "neutral" as const,
        noteLabel: messages.leave.decisionNoteLabel,
      };
    }
    if (confirmState.action === "reject") {
      return {
        title: messages.leave.confirmRejectTitle,
        message: messages.leave.confirmRejectMessage,
        extraNote: undefined,
        confirmLabel: messages.leave.reject,
        tone: "caution" as const,
        noteLabel: messages.leave.decisionNoteLabel,
      };
    }
    return {
      title: messages.leave.confirmWithdrawTitle,
      message: messages.leave.confirmWithdrawMessage,
      extraNote: undefined,
      confirmLabel: messages.leave.withdraw,
      tone: "caution" as const,
      noteLabel: undefined,
    };
  }, [confirmState, requests, currentUserId]);

  function describeUnit(req: LeaveRequestDto): string {
    const label = messages.leave.unitLabelShort[req.unit];
    if (req.unit === "hourly" && req.minutes !== null) {
      return `${label}${messages.leave.hourlyMinutesSuffix(req.minutes)}`;
    }
    return label;
  }

  /**
   * own/queue の二段構成(2026-08-23、CorrectionsView・autoBreakWaiver と同じ形に統一)。
   * GET /leave/requests は view_all/approve 権限があればスコープ内全員分を返すため
   * (apps/api 側の挙動、routes/leave.ts のコメント参照)、自分の申請一覧とは別に
   * 「承認待ち(自分以外も含む)」のキューを設ける。queueRequests は own の pending も含む
   * (自己承認は queue 側の ConfirmDialog の selfApproved 表示で示す — 既存 UI を維持)。
   */
  const hasApprovePermission = hasEffectivePermission(effectivePermissions, APPROVE_PERMISSION, "department");
  /**
   * 二次承認(多段承認の2段目)を行えるか。同じ承認権限を **tenant スコープ** で持つ人だけが
   * 二次承認でき、部署スコープの承認者は apps/api 側で 403 になる(2026-08-24 追加)。
   */
  const hasTenantApprovePermission = hasEffectivePermission(effectivePermissions, APPROVE_PERMISSION, "tenant");
  const ownRequests = requests.filter((r) => r.requestedBy === currentUserId);
  // 承認キューは「未決裁」= pending(一次承認待ち)+ approved_step1(二次承認待ち)を対象にする。
  const queueRequests = hasApprovePermission ? requests.filter((r) => isOpenStatus(r.status)) : [];

  /**
   * 多段承認の状態表示(2026-08-24 追加、CorrectionsView と同じ作法)。
   * - 承認キューの行には「一次/二次のどちらの承認待ちか」を出す
   * - 二段承認の申請には「二次承認まで終わらないと反映されない」注記を出す(申請者向け)
   * - 二次承認待ちだが自分は二次承認できない場合は、承認ボタンの代わりに理由を出す
   */
  function renderApprovalStepChip(state: ApprovalFlowStateDto) {
    if (state.requiredSteps < 2 || state.currentStep === null) return null;
    return (
      <span className="correction-card__step">
        {state.currentStep === 2 ? messages.approvalSteps.awaitingStep2 : messages.approvalSteps.awaitingStep1}
      </span>
    );
  }

  function renderStep1DecidedRow(state: ApprovalFlowStateDto) {
    if (state.step1DecidedBy === null) return null;
    const bySelf = state.step1DecidedBy === currentUserId;
    return (
      <div className="correction-card__row">
        <dt>{messages.approvalSteps.step1DecidedLabel}</dt>
        <dd>
          {bySelf ? messages.approvalSteps.step1DecidedBySelf : state.step1DecidedBy}
          {state.step1DecidedAt !== null ? ` / ${formatDateTimeJst(state.step1DecidedAt)}` : ""}
        </dd>
      </div>
    );
  }

  function renderApprovalStepNotes(state: ApprovalFlowStateDto, options: { showApproveReject: boolean }) {
    if (state.requiredSteps < 2) return null;
    const blockedFromStep2 = options.showApproveReject && state.currentStep === 2 && !hasTenantApprovePermission;
    return (
      <>
        <p className="correction-card__note">{messages.approvalSteps.twoStepNote}</p>
        {blockedFromStep2 ? <p className="correction-card__note">{messages.approvalSteps.step2NotYours}</p> : null}
      </>
    );
  }

  function renderRequestCard(req: LeaveRequestDto, options: { showApproveReject: boolean; showWithdraw: boolean }) {
    // 「未決裁」(一次承認待ち・二次承認待ち)の間は決裁欄を出さず、操作ボタンを出す。
    const isOpen = isOpenStatus(req.status);
    const selfDecided = req.decidedBy !== null && req.decidedBy === currentUserId;
    // 二次承認待ちの行は、tenant スコープの承認権限を持つ人にだけ承認/却下ボタンを出す。
    const showApproveReject = options.showApproveReject && canApproveCurrentStep(req, hasApprovePermission, hasTenantApprovePermission);
    return (
      <li key={req.id} className="correction-card">
        <div className="correction-card__header">
          <span className={`correction-badge correction-badge--${req.status as LeaveRequestStatus}`}>
            {messages.leave.statusLabel[req.status]}
          </span>
          <span className="correction-card__type">{formatDateLabel(req.leaveDate)}</span>
          {renderApprovalStepChip(req)}
        </div>

        <dl className="correction-card__body">
          <div className="correction-card__row">
            <dt>{messages.leave.columnUnit}</dt>
            <dd className="tabular-nums">{describeUnit(req)}</dd>
          </div>
          <div className="correction-card__row">
            <dt>{messages.leave.columnLeaveType}</dt>
            <dd>{messages.leave.leaveTypeLabelShort[req.leaveType]}</dd>
          </div>
          <div className="correction-card__row">
            <dt>{messages.leave.columnReason}</dt>
            <dd>{req.reason}</dd>
          </div>
          {renderStep1DecidedRow(req)}
          {!isOpen ? (
            <div className="correction-card__row">
              <dt>{messages.leave.columnDecision}</dt>
              <dd>
                {req.decidedBy ? (selfDecided ? messages.leave.decidedBySelf : req.decidedBy) : "-"}
                {req.decidedAt !== null ? ` / ${formatDateTimeJst(req.decidedAt)}` : ""}
                {req.decisionNote ? `(${req.decisionNote})` : ""}
              </dd>
            </div>
          ) : null}
        </dl>

        {closedMonthRequestId === req.id ? <p className="leave-target-month-closed">{messages.leave.targetMonthClosedNote}</p> : null}

        {isOpen ? renderApprovalStepNotes(req, { showApproveReject: options.showApproveReject }) : null}

        {isOpen && (showApproveReject || options.showWithdraw) ? (
          <div className="correction-card__actions">
            {showApproveReject ? (
              <>
                <button
                  type="button"
                  className="correction-card__btn correction-card__btn--approve"
                  onClick={() => openConfirm(req.id, "approve")}
                >
                  {messages.leave.approve}
                </button>
                <button
                  type="button"
                  className="correction-card__btn correction-card__btn--reject"
                  onClick={() => openConfirm(req.id, "reject")}
                >
                  {messages.leave.reject}
                </button>
              </>
            ) : null}
            {options.showWithdraw ? (
              <button
                type="button"
                className="correction-card__btn correction-card__btn--withdraw"
                onClick={() => openConfirm(req.id, "withdraw")}
              >
                {messages.leave.withdraw}
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <>
      <section className="leave__section">
        <h2 className="leave__section-title">{messages.leave.requestsTitle}</h2>

        {ownRequests.length === 0 ? <p className="correction-form__empty">{messages.leave.requestsEmpty}</p> : null}

        {ownRequests.length > 0 ? (
          <ul className="leave-requests-list">
            {ownRequests.map((req) => renderRequestCard(req, { showApproveReject: hasApprovePermission, showWithdraw: true }))}
          </ul>
        ) : null}
      </section>

      {hasApprovePermission ? (
        <section className="leave__section">
          <h2 className="leave__section-title">{messages.leave.queueSectionTitle}</h2>
          <p className="leave__tagline">{messages.leave.queueSectionTagline}</p>

          {queueRequests.length === 0 ? <p className="correction-form__empty">{messages.leave.queueEmpty}</p> : null}

          {queueRequests.length > 0 ? (
            <ul className="leave-requests-list">
              {queueRequests.map((req) => renderRequestCard(req, { showApproveReject: true, showWithdraw: false }))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {confirmState && confirmContent ? (
        <ConfirmDialog
          title={confirmContent.title}
          message={confirmContent.message}
          extraNote={confirmContent.extraNote}
          confirmLabel={confirmContent.confirmLabel}
          tone={confirmContent.tone}
          note={note}
          onNoteChange={confirmContent.noteLabel ? setNote : undefined}
          noteLabel={confirmContent.noteLabel}
          notePlaceholder={messages.leave.decisionNotePlaceholder}
          pending={actionPending}
          error={actionError}
          onConfirm={handleConfirm}
          onCancel={() => {
            setConfirmState(null);
            setActionError(null);
          }}
        />
      ) : null}
    </>
  );
}
