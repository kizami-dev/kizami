"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type CorrectionRequestDto,
  type CorrectionStatus,
  type PunchKind,
} from "../lib/api";
import { mapCorrectionErrorMessage, messages } from "../lib/messages";
import { formatDateTimeJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";

/** 対象打刻の解決に使う参照範囲。過去分は widely だが、SQLite ローカル運用の規模を前提に許容する。 */

type Action = "approve" | "reject" | "withdraw";

interface ConfirmState {
  id: string;
  action: Action;
}

function describeType(req: CorrectionRequestDto): string {
  if (req.targetEventId === null) return messages.corrections.typeAdd;
  if (req.proposedKind !== null) return messages.corrections.typeCorrect;
  return messages.corrections.typeCancel;
}

function describeContent(req: CorrectionRequestDto): string {
  if (req.proposedKind !== null && req.proposedOccurredAt !== null) {
    return `${messages.punchKindLabel[req.proposedKind]} ${formatDateTimeJst(req.proposedOccurredAt)}`;
  }
  return messages.corrections.typeCancel;
}

export function CorrectionsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [requests, setRequests] = useState<CorrectionRequestDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [note, setNote] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .listCorrections("all")
      .then((correctionsRes) => {
        if (cancelled) return;
        setRequests(correctionsRes.requests);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setLoadError(err instanceof ApiError ? messages.errors.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, reloadKey]);

  function describeTarget(req: CorrectionRequestDto): string {
    if (req.targetEventId === null) {
      return req.proposedOccurredAt !== null ? formatDateTimeJst(req.proposedOccurredAt) : "-";
    }
    const target = req.targetPunch;
    if (!target) return messages.corrections.targetUnavailable;
    return `${messages.punchKindLabel[target.kind as PunchKind]} ${formatDateTimeJst(target.occurredAt)}`;
  }

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
        await api.approveCorrection(confirmState.id, note || undefined);
      } else if (confirmState.action === "reject") {
        await api.rejectCorrection(confirmState.id, note || undefined);
      } else {
        await api.withdrawCorrection(confirmState.id);
      }
      setConfirmState(null);
      setNote("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setActionError(err instanceof ApiError ? mapCorrectionErrorMessage(err.body) : messages.errors.network);
    } finally {
      setActionPending(false);
    }
  }

  const confirmContent = useMemo(() => {
    if (!confirmState) return null;
    const req = requests?.find((r) => r.id === confirmState.id);
    const selfApproved = req && guard.user ? req.requestedBy === guard.user.id : false;
    if (confirmState.action === "approve") {
      return {
        title: messages.corrections.confirmApproveTitle,
        message: messages.corrections.confirmApproveMessage,
        extraNote: selfApproved ? messages.corrections.confirmApproveSelfNote : undefined,
        confirmLabel: messages.corrections.approve,
        tone: "neutral" as const,
        noteLabel: messages.corrections.decisionNoteLabel,
      };
    }
    if (confirmState.action === "reject") {
      return {
        title: messages.corrections.confirmRejectTitle,
        message: messages.corrections.confirmRejectMessage,
        extraNote: undefined,
        confirmLabel: messages.corrections.reject,
        tone: "caution" as const,
        noteLabel: messages.corrections.decisionNoteLabel,
      };
    }
    return {
      title: messages.corrections.confirmWithdrawTitle,
      message: messages.corrections.confirmWithdrawMessage,
      extraNote: undefined,
      confirmLabel: messages.corrections.withdraw,
      tone: "caution" as const,
      noteLabel: undefined,
    };
  }, [confirmState, requests, guard.user]);

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="corrections">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="corrections" />
      <main className="corrections__main">
        <h1 className="corrections__title">{messages.corrections.title}</h1>
        <p className="corrections__tagline">{messages.corrections.tagline}</p>

        {loading ? <p className="monthly-loading">{messages.loading}</p> : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {requests && requests.length === 0 ? <p className="corrections__empty">{messages.corrections.empty}</p> : null}

        {requests && requests.length > 0 ? (
          <ul className="corrections__list">
            {requests.map((req) => {
              const isPending = req.status === "pending";
              const selfDecided = req.decidedBy !== null && guard.user && req.decidedBy === guard.user.id;
              return (
                <li key={req.id} className="correction-card">
                  <div className="correction-card__header">
                    <span className={`correction-badge correction-badge--${req.status as CorrectionStatus}`}>
                      {messages.corrections.statusLabel[req.status]}
                    </span>
                    <span className="correction-card__type">{describeType(req)}</span>
                  </div>

                  <dl className="correction-card__body">
                    <div className="correction-card__row">
                      <dt>{messages.corrections.columnTarget}</dt>
                      <dd className="tabular-nums">{describeTarget(req)}</dd>
                    </div>
                    {req.targetEventId !== null && req.proposedKind !== null ? (
                      <div className="correction-card__row">
                        <dt>{messages.corrections.columnContent}</dt>
                        <dd className="tabular-nums">
                          {messages.corrections.typeCorrect} → {describeContent(req)}
                        </dd>
                      </div>
                    ) : null}
                    {req.targetEventId === null ? (
                      <div className="correction-card__row">
                        <dt>{messages.corrections.columnContent}</dt>
                        <dd className="tabular-nums">
                          {messages.corrections.typeAdd}: {describeContent(req)}
                        </dd>
                      </div>
                    ) : null}
                    <div className="correction-card__row">
                      <dt>{messages.corrections.columnReason}</dt>
                      <dd>{req.reason}</dd>
                    </div>
                    {!isPending ? (
                      <div className="correction-card__row">
                        <dt>{messages.corrections.columnDecision}</dt>
                        <dd>
                          {req.decidedBy ? (selfDecided ? messages.corrections.decidedBySelf : req.decidedBy) : "-"}
                          {req.decidedAt !== null ? ` / ${formatDateTimeJst(req.decidedAt)}` : ""}
                          {req.decisionNote ? `(${req.decisionNote})` : ""}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {isPending ? (
                    <div className="correction-card__actions">
                      <button
                        type="button"
                        className="correction-card__btn correction-card__btn--approve"
                        onClick={() => openConfirm(req.id, "approve")}
                      >
                        {messages.corrections.approve}
                      </button>
                      <button
                        type="button"
                        className="correction-card__btn correction-card__btn--reject"
                        onClick={() => openConfirm(req.id, "reject")}
                      >
                        {messages.corrections.reject}
                      </button>
                      <button
                        type="button"
                        className="correction-card__btn correction-card__btn--withdraw"
                        onClick={() => openConfirm(req.id, "withdraw")}
                      >
                        {messages.corrections.withdraw}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </main>

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
          notePlaceholder={messages.corrections.decisionNotePlaceholder}
          pending={actionPending}
          error={actionError}
          onConfirm={handleConfirm}
          onCancel={() => {
            setConfirmState(null);
            setActionError(null);
          }}
        />
      ) : null}
    </div>
  );
}
