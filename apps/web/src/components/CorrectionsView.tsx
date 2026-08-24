"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type ApprovalFlowStateDto,
  type AutoBreakWaiverDto,
  type AutoBreakWaiverStatus,
  type CorrectionRequestDto,
  type CorrectionStatus,
  type PunchKind,
} from "../lib/api";
import { mapAutoBreakWaiverErrorMessage, mapCorrectionErrorMessage, messages } from "../lib/messages";
import { hasEffectivePermission } from "../lib/permissions";
import { formatDateTimeJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useEffectivePermissions } from "../lib/useEffectivePermissions";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { HelpTip } from "./HelpTip";

/**
 * 打刻修正申請の承認(POST /corrections/:id/approve・reject)が要求する権限
 * (apps/api/src/routes/corrections.ts の APPROVE_PERMISSION)。休憩自動控除の打ち消し申請
 * (POST /auto-break-waivers/:id/approve・reject)も同じキー・同じスコープを要求する
 * (apps/api/src/routes/auto-break-waivers.ts の APPROVE_PERMISSION 参照)ため、
 * 両方のキュー表示判定にこの1つの実効権限チェックを使い回す。
 */
const APPROVE_PERMISSION = "attendance.correction.approve";

/** 対象打刻の解決に使う参照範囲。過去分は widely だが、SQLite ローカル運用の規模を前提に許容する。 */

/**
 * 「未決裁」= まだ最終決裁に至っていない状態(2026-08-24 多段承認対応)。
 * pending は一次承認待ち、approved_step1 は一次承認済み・二次承認待ちで、どちらも
 * 取下げ可能・承認キューに出すべき行。apps/api の GET ...?status=pending もこの2つを返す
 * (docs/design/approval-flows.md)。
 */
function isOpenStatus(status: CorrectionStatus | AutoBreakWaiverStatus): boolean {
  return status === "pending" || status === "approved_step1";
}

/**
 * この行の「今の段」を、今ログインしている人が承認できるか(2026-08-24 多段承認対応)。
 *
 * 判断点: 二次承認(currentStep === 2)は、同じ承認権限を **tenant スコープ** で持つ人しか
 * 行えない(apps/api は department スコープの承認者に 403 を返す)。押しても必ず失敗する
 * ボタンは出さず、状態チップだけを見せる。一次承認(currentStep === 1)の条件は従来どおり。
 *
 * なお「一次承認した本人は二次承認できない」(409 same_approver_as_step1)はここでは判定せず、
 * サーバーのエラー文言に委ねる(キューの表示が古いままでも正しく弾けるのはサーバー側だけのため)。
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
  const { permissions: effectivePermissions } = useEffectivePermissions();

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
   * 承認キュー(打刻修正申請・休憩自動控除の打ち消し申請の両方)を出すかどうかの判定
   * (2026-08-23 レビュー第2波)。
   *
   * 以前は apps/api に「自分の実効権限」を返すエンドポイントが無く、fetched 一覧に自分以外の
   * userId が1件でも含まれるかどうかで推定していた(既知の false negative: 他の従業員が
   * まだ申請していないテナントでは、承認権限を持っていてもキューが出なかった)。
   * GET /me/effective-permissions の追加により、この推定は不要になった。
   */
  const hasApprovePermission = hasEffectivePermission(effectivePermissions, APPROVE_PERMISSION, "department");
  /**
   * 二次承認(多段承認の2段目)を行えるか。同じ承認権限を **tenant スコープ** で持つ人だけが
   * 二次承認でき、部署スコープの承認者は apps/api 側で 403 になる
   * (2026-08-24 追加、docs/design/approval-flows.md)。
   */
  const hasTenantApprovePermission = hasEffectivePermission(effectivePermissions, APPROVE_PERMISSION, "tenant");

  const selfUserId = guard.user.id;
  const ownWaivers = waivers?.filter((w) => w.userId === selfUserId) ?? [];
  // 承認キューは「未決裁」= pending(一次承認待ち)+ approved_step1(二次承認待ち)を対象にする。
  const queueWaivers = hasApprovePermission ? (waivers ?? []).filter((w) => isOpenStatus(w.status)) : [];

  /**
   * 打刻修正申請の own/queue 分割(2026-08-23、waiver と同じ二段構成に統一)。GET /corrections は
   * view_all/approve 権限があればスコープ内全員分を返すため(apps/api 側の挙動、
   * routes/corrections.ts のコメント参照)、自分の申請一覧とは別に「承認待ち(自分以外も含む)」の
   * キューを設ける。queueCorrections は own の pending も含む(自己承認は queue 側の
   * ConfirmDialog の selfApproved 表示で示す — 既存 UI を維持)。
   */
  const ownCorrections = requests?.filter((r) => r.requestedBy === selfUserId) ?? [];
  const queueCorrections = hasApprovePermission ? (requests ?? []).filter((r) => isOpenStatus(r.status)) : [];

  /**
   * 多段承認の状態表示(2026-08-24 追加)。打刻修正申請・休憩自動控除の打ち消し申請で
   * 完全に同じ形なので、DTO ではなく ApprovalFlowStateDto を受け取る共通関数にする。
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
    const bySelf = state.step1DecidedBy === selfUserId;
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
    // 二次承認待ちなのに自分は二次承認できない場合だけ、その理由を添える。
    const blockedFromStep2 = options.showApproveReject && state.currentStep === 2 && !hasTenantApprovePermission;
    return (
      <>
        <p className="correction-card__note">{messages.approvalSteps.twoStepNote}</p>
        {blockedFromStep2 ? <p className="correction-card__note">{messages.approvalSteps.step2NotYours}</p> : null}
      </>
    );
  }

  function waiverDecisionText(w: AutoBreakWaiverDto): string {
    const decidedByLabel = w.decidedBy ? (w.decidedBy === guard.user?.id ? messages.autoBreakWaiver.decidedBySelf : w.decidedBy) : "-";
    const at = w.decidedAt !== null ? ` / ${formatDateTimeJst(w.decidedAt)}` : "";
    const note = w.decisionNote ? `(${w.decisionNote})` : "";
    return `${decidedByLabel}${at}${note}`;
  }

  /**
   * 1件分の休憩自動控除の打ち消し申請カード。2026-08-24 の多段承認対応で own/queue に
   * ほぼ同じ JSX が二重にあった状態を解消し、renderCorrectionCard と同じ
   * 「options でボタンだけ出し分ける」形に揃えた(own: 取下げのみ、queue: 承認/却下のみ)。
   */
  function renderWaiverCard(w: AutoBreakWaiverDto, options: { showApproveReject: boolean; showWithdraw: boolean }) {
    const isOpen = isOpenStatus(w.status);
    const showApproveReject = options.showApproveReject && canApproveCurrentStep(w, hasApprovePermission, hasTenantApprovePermission);
    return (
      <li key={w.id} className="correction-card">
        <div className="correction-card__header">
          <span className={`correction-badge correction-badge--${w.status as AutoBreakWaiverStatus}`}>
            {messages.autoBreakWaiver.statusLabel[w.status]}
          </span>
          <span className="correction-card__type">{messages.autoBreakWaiver.typeLabel}</span>
          {renderApprovalStepChip(w)}
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
          {renderStep1DecidedRow(w)}
          {!isOpen ? (
            <div className="correction-card__row">
              <dt>{messages.autoBreakWaiver.columnDecision}</dt>
              <dd>{waiverDecisionText(w)}</dd>
            </div>
          ) : null}
        </dl>

        {isOpen ? renderApprovalStepNotes(w, { showApproveReject: options.showApproveReject }) : null}

        {isOpen && (showApproveReject || options.showWithdraw) ? (
          <div className="correction-card__actions">
            {showApproveReject ? (
              <>
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
              </>
            ) : null}
            {options.showWithdraw ? (
              <button
                type="button"
                className="correction-card__btn correction-card__btn--withdraw"
                onClick={() => openWaiverConfirm(w.id, "withdraw")}
              >
                {messages.autoBreakWaiver.withdraw}
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  /**
   * 1件分の修正申請カード。own/queue の両セクションで共通の見た目を使い、ボタンの出し分けだけを
   * 引数で切り替える(own: 承認権限があれば自己承認として承認/却下ボタンも出し、常に取下げボタンも
   * 出す。queue: 承認/却下ボタンのみ・取下げは出さない — 自分の申請ではない可能性があるため)。
   */
  function renderCorrectionCard(req: CorrectionRequestDto, options: { showApproveReject: boolean; showWithdraw: boolean }) {
    // 「未決裁」(一次承認待ち・二次承認待ち)の間は決裁欄を出さず、操作ボタンを出す。
    const isOpen = isOpenStatus(req.status);
    const selfDecided = req.decidedBy !== null && guard.user && req.decidedBy === guard.user.id;
    // 二次承認待ちの行は、tenant スコープの承認権限を持つ人にだけ承認/却下ボタンを出す。
    const showApproveReject = options.showApproveReject && canApproveCurrentStep(req, hasApprovePermission, hasTenantApprovePermission);
    return (
      <li key={req.id} className="correction-card">
        <div className="correction-card__header">
          <span className={`correction-badge correction-badge--${req.status as CorrectionStatus}`}>
            {messages.corrections.statusLabel[req.status]}
          </span>
          <span className="correction-card__type">{describeType(req)}</span>
          {renderApprovalStepChip(req)}
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
          {renderStep1DecidedRow(req)}
          {!isOpen ? (
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
                  {messages.corrections.approve}
                </button>
                <button
                  type="button"
                  className="correction-card__btn correction-card__btn--reject"
                  onClick={() => openConfirm(req.id, "reject")}
                >
                  {messages.corrections.reject}
                </button>
              </>
            ) : null}
            {options.showWithdraw ? (
              <button
                type="button"
                className="correction-card__btn correction-card__btn--withdraw"
                onClick={() => openConfirm(req.id, "withdraw")}
              >
                {messages.corrections.withdraw}
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
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

          {requests && ownCorrections.length === 0 ? <p className="corrections__empty">{messages.corrections.empty}</p> : null}

          {ownCorrections.length > 0 ? (
            <ul className="corrections__list">
              {ownCorrections.map((req) => renderCorrectionCard(req, { showApproveReject: hasApprovePermission, showWithdraw: true }))}
            </ul>
          ) : null}
        </section>

        {hasApprovePermission ? (
          <section className="corrections__section">
            <h2 className="corrections__section-title">{messages.corrections.queueSectionTitle}</h2>
            <p className="corrections__tagline">{messages.corrections.queueSectionTagline}</p>

            {queueCorrections.length === 0 ? <p className="corrections__empty">{messages.corrections.queueEmpty}</p> : null}

            {queueCorrections.length > 0 ? (
              <ul className="corrections__list">
                {queueCorrections.map((req) => renderCorrectionCard(req, { showApproveReject: true, showWithdraw: false }))}
              </ul>
            ) : null}
          </section>
        ) : null}

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
              {ownWaivers.map((w) => renderWaiverCard(w, { showApproveReject: false, showWithdraw: true }))}
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
                {queueWaivers.map((w) => renderWaiverCard(w, { showApproveReject: true, showWithdraw: false }))}
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
