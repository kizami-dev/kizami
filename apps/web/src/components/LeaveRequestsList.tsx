"use client";

import { useMemo, useState } from "react";
import { api, ApiError, UnauthorizedError, type LeaveRequestDto, type LeaveRequestStatus } from "../lib/api";
import { mapLeaveRequestErrorMessage, messages } from "../lib/messages";
import { formatDateLabel, formatDateTimeJst } from "../lib/time";
import { ConfirmDialog } from "./ConfirmDialog";

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

  return (
    <section className="leave__section">
      <h2 className="leave__section-title">{messages.leave.requestsTitle}</h2>

      {requests.length === 0 ? <p className="correction-form__empty">{messages.leave.requestsEmpty}</p> : null}

      {requests.length > 0 ? (
        <ul className="leave-requests-list">
          {requests.map((req) => {
            const isPending = req.status === "pending";
            const selfDecided = req.decidedBy !== null && req.decidedBy === currentUserId;
            return (
              <li key={req.id} className="correction-card">
                <div className="correction-card__header">
                  <span className={`correction-badge correction-badge--${req.status as LeaveRequestStatus}`}>
                    {messages.leave.statusLabel[req.status]}
                  </span>
                  <span className="correction-card__type">{formatDateLabel(req.leaveDate)}</span>
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
                  {!isPending ? (
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

                {isPending ? (
                  <div className="correction-card__actions">
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
                    <button
                      type="button"
                      className="correction-card__btn correction-card__btn--withdraw"
                      onClick={() => openConfirm(req.id, "withdraw")}
                    >
                      {messages.leave.withdraw}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
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
    </section>
  );
}
