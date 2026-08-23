"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type AutoBreakWaiverDto,
  type CorrectionRequestDto,
  type CorrectionStatus,
  type PunchKind,
} from "../lib/api";
import { mapAutoBreakWaiverErrorMessage, mapCorrectionErrorMessage, messages } from "../lib/messages";
import { formatDateTimeJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { HelpTip } from "./HelpTip";

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

  // 休憩自動控除の打ち消し申請(2026-08-23 追加、docs/design/breaks.md)。
  const [waivers, setWaivers] = useState<AutoBreakWaiverDto[] | null>(null);
  const [waiverLoadError, setWaiverLoadError] = useState<string | null>(null);
  const [waiverReloadKey, setWaiverReloadKey] = useState(0);

  const [waiverConfirmState, setWaiverConfirmState] = useState<ConfirmState | null>(null);
  const [waiverNote, setWaiverNote] = useState("");
  const [waiverActionPending, setWaiverActionPending] = useState(false);
  const [waiverActionError, setWaiverActionError] = useState<string | null>(null);

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

  /**
   * GET /auto-break-waivers?status=all(userId 省略)は、承認権限
   * (attendance.correction.approve から含意される attendance.correction.view_all)を持たない
   * 場合は自分の分だけ、持つ場合はスコープ内全員分を返す(apps/api 側の挙動、routes/auto-break-waivers.ts
   * のコメント参照)。この1回のフェッチ結果から「自分の申請」と「承認キュー」の両方を作る
   * (下の hasApprovePermission 参照)。
   */
  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setWaiverLoadError(null);
    api
      .listAutoBreakWaivers("all")
      .then((res) => {
        if (!cancelled) setWaivers(res.requests);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setWaiverLoadError(err instanceof ApiError ? messages.errors.loadFailed : messages.errors.network);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, waiverReloadKey]);

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

  function openWaiverConfirm(id: string, action: Action) {
    setWaiverConfirmState({ id, action });
    setWaiverNote("");
    setWaiverActionError(null);
  }

  async function handleWaiverConfirm() {
    if (!waiverConfirmState) return;
    setWaiverActionPending(true);
    setWaiverActionError(null);
    try {
      if (waiverConfirmState.action === "approve") {
        await api.approveAutoBreakWaiver(waiverConfirmState.id, waiverNote || undefined);
      } else if (waiverConfirmState.action === "reject") {
        await api.rejectAutoBreakWaiver(waiverConfirmState.id, waiverNote || undefined);
      } else {
        await api.withdrawAutoBreakWaiver(waiverConfirmState.id);
      }
      setWaiverConfirmState(null);
      setWaiverNote("");
      setWaiverReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setWaiverActionError(err instanceof ApiError ? mapAutoBreakWaiverErrorMessage(err.body) : messages.errors.network);
    } finally {
      setWaiverActionPending(false);
    }
  }

  const waiverConfirmContent = useMemo(() => {
    if (!waiverConfirmState) return null;
    const w = waivers?.find((r) => r.id === waiverConfirmState.id);
    const selfApproved = w && guard.user ? w.requestedBy === guard.user.id : false;
    if (waiverConfirmState.action === "approve") {
      return {
        title: messages.autoBreakWaiver.confirmApproveTitle,
        message: messages.autoBreakWaiver.confirmApproveMessage,
        extraNote: selfApproved ? messages.autoBreakWaiver.confirmApproveSelfNote : undefined,
        confirmLabel: messages.autoBreakWaiver.approve,
        tone: "neutral" as const,
        noteLabel: messages.autoBreakWaiver.decisionNoteLabel,
      };
    }
    if (waiverConfirmState.action === "reject") {
      return {
        title: messages.autoBreakWaiver.confirmRejectTitle,
        message: messages.autoBreakWaiver.confirmRejectMessage,
        extraNote: undefined,
        confirmLabel: messages.autoBreakWaiver.reject,
        tone: "caution" as const,
        noteLabel: messages.autoBreakWaiver.decisionNoteLabel,
      };
    }
    return {
      title: messages.autoBreakWaiver.confirmWithdrawTitle,
      message: messages.autoBreakWaiver.confirmWithdrawMessage,
      extraNote: undefined,
      confirmLabel: messages.autoBreakWaiver.withdraw,
      tone: "caution" as const,
      noteLabel: undefined,
    };
  }, [waiverConfirmState, waivers, guard.user]);

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  /**
   * 承認キューを出すかどうかの判定(判断点、完了報告に明記): apps/api には「自分の実効権限」を
   * 返すエンドポイントが無く、GET /auto-break-waivers はユーザー指定なしだと「権限が無ければ
   * 自分の分だけ・あればスコープ内全員分」を返す(routes/auto-break-waivers.ts 参照)。
   * そのため fetched 一覧に自分以外の userId が1件でも含まれていれば、それは
   * VIEW_ALL_PERMISSION(attendance.correction.approve から含意)を持っている確実な証拠になる。
   * 逆に「他人の分が1件も無い」ケース(他の従業員がまだ申請していない等)は権限の有無を
   * 判別できないため、安全側に倒して承認キューを出さない(自分の申請1件だけを承認したい
   * 単独テナントの管理者は、取り下げてから improvement を待つか、他の従業員の申請が
   * 出た後に承認できるようになる — 既知の制限)。
   */
  const selfUserId = guard.user.id;
  const ownWaivers = waivers?.filter((w) => w.userId === selfUserId) ?? [];
  const hasApprovePermission = (waivers ?? []).some((w) => w.userId !== selfUserId);
  const queueWaivers = hasApprovePermission ? (waivers ?? []).filter((w) => w.status === "pending") : [];

  function waiverDecisionText(w: AutoBreakWaiverDto): string {
    const decidedByLabel = w.decidedBy ? (w.decidedBy === guard.user?.id ? messages.autoBreakWaiver.decidedBySelf : w.decidedBy) : "-";
    const at = w.decidedAt !== null ? ` / ${formatDateTimeJst(w.decidedAt)}` : "";
    const note = w.decisionNote ? `(${w.decisionNote})` : "";
    return `${decidedByLabel}${at}${note}`;
  }

  return (
    <div className="corrections">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="corrections" />
      <main className="corrections__main">
        <h1 className="corrections__title">{messages.nav.corrections}</h1>
        <p className="corrections__tagline">{messages.corrections.tagline}</p>

        <section className="corrections__section">
          <h2 className="corrections__section-title">{messages.corrections.title}</h2>

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
        </section>

        <section className="corrections__section">
          <h2 className="corrections__section-title">
            {messages.autoBreakWaiver.ownSectionTitle}
            <HelpTip helpKey="attendance.auto-break" />
          </h2>
          <p className="corrections__tagline">{messages.autoBreakWaiver.ownSectionTagline}</p>

          {waiverLoadError ? <p className="monthly-error">{waiverLoadError}</p> : null}
          {waivers && ownWaivers.length === 0 ? <p className="corrections__empty">{messages.autoBreakWaiver.empty}</p> : null}

          {ownWaivers.length > 0 ? (
            <ul className="corrections__list">
              {ownWaivers.map((w) => (
                <li key={w.id} className="correction-card">
                  <div className="correction-card__header">
                    <span className={`correction-badge correction-badge--${w.status}`}>
                      {messages.autoBreakWaiver.statusLabel[w.status]}
                    </span>
                    <span className="correction-card__type">{messages.autoBreakWaiver.typeLabel}</span>
                  </div>

                  <dl className="correction-card__body">
                    <div className="correction-card__row">
                      <dt>{messages.autoBreakWaiver.columnDate}</dt>
                      <dd className="tabular-nums">{w.waiveDate}</dd>
                    </div>
                    <div className="correction-card__row">
                      <dt>{messages.autoBreakWaiver.columnReason}</dt>
                      <dd>{w.reason}</dd>
                    </div>
                    {w.status !== "pending" ? (
                      <div className="correction-card__row">
                        <dt>{messages.autoBreakWaiver.columnDecision}</dt>
                        <dd>{waiverDecisionText(w)}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {w.status === "pending" ? (
                    <div className="correction-card__actions">
                      <button
                        type="button"
                        className="correction-card__btn correction-card__btn--withdraw"
                        onClick={() => openWaiverConfirm(w.id, "withdraw")}
                      >
                        {messages.autoBreakWaiver.withdraw}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {hasApprovePermission ? (
          <section className="corrections__section">
            <h2 className="corrections__section-title">{messages.autoBreakWaiver.queueSectionTitle}</h2>
            <p className="corrections__tagline">{messages.autoBreakWaiver.queueSectionTagline}</p>

            {queueWaivers.length === 0 ? <p className="corrections__empty">{messages.autoBreakWaiver.queueEmpty}</p> : null}

            {queueWaivers.length > 0 ? (
              <ul className="corrections__list">
                {queueWaivers.map((w) => (
                  <li key={w.id} className="correction-card">
                    <div className="correction-card__header">
                      <span className={`correction-badge correction-badge--${w.status}`}>
                        {messages.autoBreakWaiver.statusLabel[w.status]}
                      </span>
                      <span className="correction-card__type">{messages.autoBreakWaiver.typeLabel}</span>
                    </div>

                    <dl className="correction-card__body">
                      <div className="correction-card__row">
                        <dt>{messages.autoBreakWaiver.columnDate}</dt>
                        <dd className="tabular-nums">{w.waiveDate}</dd>
                      </div>
                      <div className="correction-card__row">
                        <dt>{messages.autoBreakWaiver.columnReason}</dt>
                        <dd>{w.reason}</dd>
                      </div>
                    </dl>

                    <div className="correction-card__actions">
                      <button
                        type="button"
                        className="correction-card__btn correction-card__btn--approve"
                        onClick={() => openWaiverConfirm(w.id, "approve")}
                      >
                        {messages.autoBreakWaiver.approve}
                      </button>
                      <button
                        type="button"
                        className="correction-card__btn correction-card__btn--reject"
                        onClick={() => openWaiverConfirm(w.id, "reject")}
                      >
                        {messages.autoBreakWaiver.reject}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
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

      {waiverConfirmState && waiverConfirmContent ? (
        <ConfirmDialog
          title={waiverConfirmContent.title}
          message={waiverConfirmContent.message}
          extraNote={waiverConfirmContent.extraNote}
          confirmLabel={waiverConfirmContent.confirmLabel}
          tone={waiverConfirmContent.tone}
          note={waiverNote}
          onNoteChange={waiverConfirmContent.noteLabel ? setWaiverNote : undefined}
          noteLabel={waiverConfirmContent.noteLabel}
          notePlaceholder={messages.autoBreakWaiver.decisionNotePlaceholder}
          pending={waiverActionPending}
          error={waiverActionError}
          onConfirm={handleWaiverConfirm}
          onCancel={() => {
            setWaiverConfirmState(null);
            setWaiverActionError(null);
          }}
        />
      ) : null}
    </div>
  );
}
