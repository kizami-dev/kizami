"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type AttendanceRateReferenceDto,
  type CreateLeaveGrantInput,
  type LeaveGrantDto,
  type LeaveGrantMethod,
  type LeaveGrantProposalDto,
  type LeaveType,
  type MemberDto,
  type StockConversionCandidateDto,
  type TenantLeaveSettingsDto,
  type UpdateLeaveSettingsInput,
} from "../lib/api";
import { mapLeaveGrantProposalErrorMessage, mapLeaveSettingsErrorMessage, messages } from "../lib/messages";
import { formatDateTimeJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { HelpTip } from "./HelpTip";
import { SettingsNav } from "./SettingsNav";

interface FormState {
  grantMethod: LeaveGrantMethod;
  fixedDateMmDd: string;
  hourlyLeaveEnabled: boolean;
  hourlyLeaveMaxDays: string;
  halfDayLeaveEnabled: boolean;
  stockConversionEnabled: boolean;
  stockMaxDays: string;
  stockExpiresMonths: string;
}

/**
 * 出勤率の8割要件(労基法39条1項)を下回る「可能性」を示す閾値。あくまで注意喚起であり、
 * この値未満でも承認は妨げない(最終判断は人が行う、docs/requirements.md §11)。
 */
const ATTENDANCE_RATE_WARNING_THRESHOLD = 0.8;

/**
 * 出勤率の参考値の表示(小数第1位までの百分率)。rate が null(全労働日が0)のときは
 * 「—」を返す — 0% と取り違えられると「8割未満」の誤判断につながるため。
 *
 * messages はモジュールスコープで束縛せず、呼び出しのたびに参照する(lib/messages.ts の
 * Proxy 前提。ここで定数に取り出すと言語切替に追従しなくなる)。
 */
function formatAttendanceRate(rate: number | null): string {
  return rate === null ? messages.leaveGrantProposals.rateUnknown : `${(rate * 100).toFixed(1)}%`;
}

/** 出勤率の算定根拠のラベル(シフト表から算出したのか、暦日からの推定なのか)。 */
function attendanceBasisLabel(basis: AttendanceRateReferenceDto["basis"]): string {
  return basis === "shift" ? messages.leaveGrantProposals.basisShift : messages.leaveGrantProposals.basisCalendarEstimate;
}

/** 予告の休暇種別ラベル(annual=年次有給 / stocked=積立休暇)。 */
function proposalLeaveTypeLabel(leaveType: LeaveType): string {
  return leaveType === "annual" ? messages.leaveGrantProposals.leaveTypeAnnual : messages.leaveGrantProposals.leaveTypeStocked;
}

function toFormState(s: TenantLeaveSettingsDto): FormState {
  return {
    grantMethod: s.grantMethod,
    fixedDateMmDd: s.fixedDateMmDd ?? "",
    hourlyLeaveEnabled: s.hourlyLeaveEnabled,
    hourlyLeaveMaxDays: String(s.hourlyLeaveMaxDays),
    halfDayLeaveEnabled: s.halfDayLeaveEnabled,
    stockConversionEnabled: s.stockConversionEnabled,
    stockMaxDays: String(s.stockMaxDays),
    stockExpiresMonths: s.stockExpiresMonths !== null ? String(s.stockExpiresMonths) : "",
  };
}

/**
 * 有給休暇の制度設定(/settings/leave、v0.3)。GET/PUT /settings/leave はどちらも
 * leave.grant.manage(tenant スコープ)を要求する。判断点: 依頼の「これらは
 * leave.grant.manage 権限が必要」(付与実行・手動付与・積立振替)は制度設定そのものと
 * 同じ権限のため、GET /settings/leave が成功した時点で管理操作セクションも表示してよい
 * (2回目の権限確認は不要 — apps/api 側も同じキーで requirePermission している)。
 */
export function LeaveSettingsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [settings, setSettings] = useState<TenantLeaveSettingsDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [members, setMembers] = useState<MemberDto[]>([]);
  const [targetUserId, setTargetUserId] = useState("");

  const [autoGrantConfirmOpen, setAutoGrantConfirmOpen] = useState(false);
  const [autoGrantPending, setAutoGrantPending] = useState(false);
  const [autoGrantError, setAutoGrantError] = useState<string | null>(null);
  const [autoGrantResult, setAutoGrantResult] = useState<{ created: LeaveGrantDto[]; skipped: number } | null>(null);

  const [manualForm, setManualForm] = useState({
    grantedOn: "",
    days: "",
    expiresOn: "",
    leaveType: "annual" as LeaveType,
    note: "",
  });
  const [manualPending, setManualPending] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState(false);

  /*
   * 付与の予告(v0.7 フェーズ4、2026-08-24 追加)。日次ワーカーが作った予告を管理者が承認して
   * 初めて付与が確定する。取得は `status=all` の1回だけにして、未決裁(proposed)と決裁済み
   * (approved/rejected/superseded)をクライアント側で振り分ける — 未決裁の表と履歴の
   * <details> のために2回叩く必要が無く、両者が必ず同じ時点のスナップショットになるため。
   */
  const [proposals, setProposals] = useState<LeaveGrantProposalDto[] | null>(null);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [proposalsReloadKey, setProposalsReloadKey] = useState(0);
  const [proposalConfirm, setProposalConfirm] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [proposalNote, setProposalNote] = useState("");
  const [proposalPending, setProposalPending] = useState(false);
  const [proposalActionError, setProposalActionError] = useState<string | null>(null);
  const [proposalSuccess, setProposalSuccess] = useState<string | null>(null);

  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const [convertPending, setConvertPending] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertResult, setConvertResult] = useState<StockConversionCandidateDto[] | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .getLeaveSettings()
      .then((res) => {
        if (cancelled) return;
        setSettings(res);
        setForm(toFormState(res));
        // 対象メンバー選択は補助データのため個別に失敗しても致命的にしない。
        api
          .listMembers()
          .then((m) => {
            if (!cancelled) setMembers(m.members);
          })
          .catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError(err instanceof ApiError ? messages.settingsLeave.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  /*
   * 付与の予告の取得。制度設定の取得(上の useEffect)とは別に持つ — 予告は承認・却下のたびに
   * 取り直す必要があり、設定フォームの再初期化(toFormState)を巻き込みたくないため。
   * 403 は「この画面自体の権限が無い」ケースなので、上の forbidden バナーに任せて静かに空にする
   * (同じ leave.grant.manage を要求する API なので、ここだけ 403 になることは無い)。
   */
  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setProposalsError(null);
    api
      .listLeaveGrantProposals("all")
      .then((res) => {
        if (!cancelled) setProposals(res.proposals);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setProposals([]);
        if (err instanceof ApiError && err.status === 403) return;
        setProposalsError(err instanceof ApiError ? messages.leaveGrantProposals.loadFailed : messages.errors.network);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, proposalsReloadKey]);

  function updateForm(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSaveSuccess(false);

    const hourlyLeaveMaxDays = Number(form.hourlyLeaveMaxDays);
    if (!Number.isInteger(hourlyLeaveMaxDays) || hourlyLeaveMaxDays < 1 || hourlyLeaveMaxDays > 5) {
      setSaveError(messages.settingsLeave.errors.invalid_hourly_leave_max_days);
      return;
    }
    const stockMaxDays = Number(form.stockMaxDays);
    if (!Number.isInteger(stockMaxDays) || stockMaxDays <= 0) {
      setSaveError(messages.settingsLeave.errors.invalid_stock_max_days);
      return;
    }
    let stockExpiresMonths: number | null = null;
    if (form.stockExpiresMonths.trim() !== "") {
      const parsed = Number(form.stockExpiresMonths);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setSaveError(messages.settingsLeave.errors.invalid_stock_expires_months);
        return;
      }
      stockExpiresMonths = parsed;
    }
    if (form.grantMethod === "fixed_date" && !/^\d{2}-\d{2}$/.test(form.fixedDateMmDd)) {
      setSaveError(messages.settingsLeave.errors.invalid_fixed_date_mm_dd);
      return;
    }

    const body: UpdateLeaveSettingsInput = {
      grantMethod: form.grantMethod,
      ...(form.grantMethod === "fixed_date" ? { fixedDateMmDd: form.fixedDateMmDd } : {}),
      hourlyLeaveEnabled: form.hourlyLeaveEnabled,
      hourlyLeaveMaxDays,
      halfDayLeaveEnabled: form.halfDayLeaveEnabled,
      stockConversionEnabled: form.stockConversionEnabled,
      stockMaxDays,
      stockExpiresMonths,
    };

    setSaving(true);
    try {
      const updated = await api.updateLeaveSettings(body);
      setSettings(updated);
      setForm(toFormState(updated));
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapLeaveSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoGrantConfirm() {
    if (!targetUserId) return;
    setAutoGrantPending(true);
    setAutoGrantError(null);
    try {
      const res = await api.autoGrantLeave(targetUserId);
      setAutoGrantResult(res);
      setAutoGrantConfirmOpen(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setAutoGrantError(err instanceof ApiError ? mapLeaveSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setAutoGrantPending(false);
    }
  }

  async function handleManualGrantSubmit(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    setManualSuccess(false);
    if (!targetUserId) {
      setManualError(messages.settingsLeave.errors.invalid_user_id);
      return;
    }
    const days = Number(manualForm.days);
    if (!Number.isInteger(days) || days <= 0) {
      setManualError(messages.settingsLeave.errors.invalid_days);
      return;
    }
    if (!manualForm.grantedOn) {
      setManualError(messages.settingsLeave.errors.invalid_granted_on);
      return;
    }

    const input: CreateLeaveGrantInput = {
      userId: targetUserId,
      grantedOn: manualForm.grantedOn,
      days,
      leaveType: manualForm.leaveType,
      ...(manualForm.expiresOn ? { expiresOn: manualForm.expiresOn } : {}),
      ...(manualForm.note ? { note: manualForm.note } : {}),
    };

    setManualPending(true);
    try {
      await api.createLeaveGrant(input);
      setManualSuccess(true);
      setManualForm({ grantedOn: "", days: "", expiresOn: "", leaveType: "annual", note: "" });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setManualError(err instanceof ApiError ? mapLeaveSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setManualPending(false);
    }
  }

  /** 予告の承認・却下(pending/error/success の3状態は他の管理操作と同じ流儀)。 */
  async function handleProposalConfirm() {
    if (!proposalConfirm) return;
    setProposalPending(true);
    setProposalActionError(null);
    try {
      if (proposalConfirm.action === "approve") {
        await api.approveLeaveGrantProposal(proposalConfirm.id);
        setProposalSuccess(messages.leaveGrantProposals.approveSuccess);
      } else {
        const note = proposalNote.trim();
        await api.rejectLeaveGrantProposal(proposalConfirm.id, note !== "" ? note : undefined);
        setProposalSuccess(messages.leaveGrantProposals.rejectSuccess);
      }
      setProposalConfirm(null);
      setProposalNote("");
      // 決裁の結果(未決裁から履歴への移動)を反映させるため一覧を取り直す。
      setProposalsReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setProposalActionError(err instanceof ApiError ? mapLeaveGrantProposalErrorMessage(err.body) : messages.errors.network);
    } finally {
      setProposalPending(false);
    }
  }

  async function handleConvertConfirm() {
    if (!targetUserId) return;
    setConvertPending(true);
    setConvertError(null);
    try {
      const res = await api.convertExpiredLeave(targetUserId);
      setConvertResult(res.conversions);
      setConvertConfirmOpen(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setConvertError(err instanceof ApiError ? mapLeaveSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setConvertPending(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const convertedTotal = convertResult?.reduce((sum, c) => sum + c.convertedDays, 0) ?? 0;
  const truncatedTotal = convertResult?.reduce((sum, c) => sum + c.truncatedDays, 0) ?? 0;
  const autoGrantCreatedTotal = autoGrantResult?.created.length ?? 0;

  const proposedProposals = proposals?.filter((p) => p.status === "proposed") ?? [];
  const decidedProposals = proposals?.filter((p) => p.status !== "proposed") ?? [];

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main">
        <SettingsNav active="leave" />
        <h1 className="settings-notif__title">{messages.settingsLeave.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsLeave.tagline}</p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsLeave.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && form && settings ? (
          <>
            <form className="settings-notif__form" onSubmit={handleSave}>
              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">
                  {messages.settingsLeave.grantMethodSectionTitle}
                  <HelpTip helpKey="leave.grant" />
                </h2>
                <label className="settings-notif__checkbox">
                  <input
                    type="radio"
                    name="grant-method"
                    checked={form.grantMethod === "statutory"}
                    onChange={() => updateForm({ grantMethod: "statutory" })}
                  />
                  {messages.settingsLeave.grantMethodStatutory}
                </label>
                <label className="settings-notif__checkbox">
                  <input
                    type="radio"
                    name="grant-method"
                    checked={form.grantMethod === "fixed_date"}
                    onChange={() => updateForm({ grantMethod: "fixed_date" })}
                  />
                  {messages.settingsLeave.grantMethodFixedDate}
                </label>
                {form.grantMethod === "fixed_date" ? (
                  <div className="correction-field">
                    <label htmlFor="fixed-date">{messages.settingsLeave.fixedDateLabel}</label>
                    <input
                      id="fixed-date"
                      type="text"
                      placeholder={messages.settingsLeave.fixedDatePlaceholder}
                      value={form.fixedDateMmDd}
                      onChange={(e) => updateForm({ fixedDateMmDd: e.target.value })}
                    />
                  </div>
                ) : null}
              </section>

              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">
                  {messages.settingsLeave.hourlySectionTitle}
                  <HelpTip helpKey="leave.hourly" />
                </h2>
                <label className="settings-notif__checkbox">
                  <input
                    type="checkbox"
                    checked={form.hourlyLeaveEnabled}
                    onChange={(e) => updateForm({ hourlyLeaveEnabled: e.target.checked })}
                  />
                  {messages.settingsLeave.hourlyEnabledLabel}
                </label>
                <div className="correction-field">
                  <label htmlFor="hourly-max-days">{messages.settingsLeave.hourlyMaxDaysLabel}</label>
                  <input
                    id="hourly-max-days"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={5}
                    value={form.hourlyLeaveMaxDays}
                    onChange={(e) => updateForm({ hourlyLeaveMaxDays: e.target.value })}
                  />
                </div>
              </section>

              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">{messages.settingsLeave.halfDaySectionTitle}</h2>
                <label className="settings-notif__checkbox">
                  <input
                    type="checkbox"
                    checked={form.halfDayLeaveEnabled}
                    onChange={(e) => updateForm({ halfDayLeaveEnabled: e.target.checked })}
                  />
                  {messages.settingsLeave.halfDayEnabledLabel}
                </label>
              </section>

              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">{messages.settingsLeave.stockSectionTitle}</h2>
                <p className="leave-help">
                  <span className="leave-help__icon" aria-hidden="true">
                    ℹ
                  </span>
                  <span>{messages.settingsLeave.stockHelp}</span>
                </p>
                <label className="settings-notif__checkbox">
                  <input
                    type="checkbox"
                    checked={form.stockConversionEnabled}
                    onChange={(e) => updateForm({ stockConversionEnabled: e.target.checked })}
                  />
                  {messages.settingsLeave.stockEnabledLabel}
                </label>
                <div className="correction-field-row">
                  <div className="correction-field">
                    <label htmlFor="stock-max-days">{messages.settingsLeave.stockMaxDaysLabel}</label>
                    <input
                      id="stock-max-days"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={form.stockMaxDays}
                      onChange={(e) => updateForm({ stockMaxDays: e.target.value })}
                    />
                  </div>
                  <div className="correction-field">
                    <label htmlFor="stock-expires-months">{messages.settingsLeave.stockExpiresMonthsLabel}</label>
                    <input
                      id="stock-expires-months"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={form.stockExpiresMonths}
                      onChange={(e) => updateForm({ stockExpiresMonths: e.target.value })}
                    />
                  </div>
                </div>
              </section>

              {saveError ? (
                <p className="correction-error" role="alert">
                  {saveError}
                </p>
              ) : null}
              {saveSuccess ? <p className="settings-notif__success">{messages.settingsLeave.saveSuccess}</p> : null}

              <p className="settings-notif__save-note">{messages.settingsLeave.saveNote}</p>

              <div className="settings-notif__actions">
                <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                  {saving ? messages.settingsLeave.saving : messages.settingsLeave.save}
                </button>
              </div>
            </form>

            <section className="leave-admin-section">
              <h2 className="settings-notif__section-title">{messages.settingsLeave.adminSectionTitle}</h2>
              <p className="leave-admin-section__desc">{messages.settingsLeave.adminSectionTagline}</p>

              <div className="correction-field">
                <label htmlFor="target-user">{messages.settingsLeave.targetUserLabel}</label>
                <select id="target-user" value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)}>
                  <option value="" disabled>
                    {messages.settingsLeave.targetUserPlaceholder}
                  </option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}({m.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="leave-admin-section">
                <h3 className="settings-notif__section-title">{messages.settingsLeave.autoGrantTitle}</h3>
                <p className="leave-admin-section__desc">{messages.settingsLeave.autoGrantDesc}</p>
                <div className="settings-notif__actions">
                  <button
                    type="button"
                    className="k-modal__confirm k-modal__confirm--neutral"
                    disabled={!targetUserId}
                    onClick={() => {
                      setAutoGrantError(null);
                      setAutoGrantResult(null);
                      setAutoGrantConfirmOpen(true);
                    }}
                  >
                    {messages.settingsLeave.autoGrantRun}
                  </button>
                </div>
                {autoGrantResult ? (
                  <p className="leave-admin-result">
                    {autoGrantCreatedTotal > 0
                      ? `${messages.settingsLeave.autoGrantResultCreatedPrefix}${autoGrantCreatedTotal}${messages.settingsLeave.autoGrantResultCreatedSuffix}`
                      : messages.settingsLeave.autoGrantEmpty}
                    {autoGrantResult.skipped > 0
                      ? `${messages.settingsLeave.autoGrantResultSkippedPrefix}${autoGrantResult.skipped}${messages.settingsLeave.autoGrantResultSkippedSuffix}`
                      : ""}
                  </p>
                ) : null}
              </div>

              <div className="leave-admin-section">
                <h3 className="settings-notif__section-title">{messages.settingsLeave.manualGrantTitle}</h3>
                <p className="leave-admin-section__desc">{messages.settingsLeave.manualGrantDesc}</p>
                <form onSubmit={handleManualGrantSubmit} className="settings-notif__form">
                  <div className="correction-field-row">
                    <div className="correction-field">
                      <label htmlFor="manual-granted-on">{messages.settingsLeave.grantedOnLabel}</label>
                      <input
                        id="manual-granted-on"
                        type="date"
                        value={manualForm.grantedOn}
                        onChange={(e) => setManualForm((f) => ({ ...f, grantedOn: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="correction-field">
                      <label htmlFor="manual-days">{messages.settingsLeave.daysLabel}</label>
                      <input
                        id="manual-days"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={manualForm.days}
                        onChange={(e) => setManualForm((f) => ({ ...f, days: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  <div className="correction-field-row">
                    <div className="correction-field">
                      <label htmlFor="manual-expires-on">{messages.settingsLeave.expiresOnLabel}</label>
                      <input
                        id="manual-expires-on"
                        type="date"
                        value={manualForm.expiresOn}
                        onChange={(e) => setManualForm((f) => ({ ...f, expiresOn: e.target.value }))}
                      />
                    </div>
                    <div className="correction-field">
                      <label htmlFor="manual-leave-type">{messages.settingsLeave.leaveTypeLabel}</label>
                      <select
                        id="manual-leave-type"
                        value={manualForm.leaveType}
                        onChange={(e) => setManualForm((f) => ({ ...f, leaveType: e.target.value as LeaveType }))}
                      >
                        <option value="annual">{messages.settingsLeave.leaveTypeAnnual}</option>
                        <option value="stocked">{messages.settingsLeave.leaveTypeStocked}</option>
                      </select>
                    </div>
                  </div>
                  <div className="correction-field">
                    <label htmlFor="manual-note">{messages.settingsLeave.noteLabel}</label>
                    <input
                      id="manual-note"
                      type="text"
                      value={manualForm.note}
                      onChange={(e) => setManualForm((f) => ({ ...f, note: e.target.value }))}
                    />
                  </div>
                  {manualError ? (
                    <p className="correction-error" role="alert">
                      {manualError}
                    </p>
                  ) : null}
                  {manualSuccess ? <p className="settings-notif__success">{messages.settingsLeave.manualGrantSuccess}</p> : null}
                  <div className="settings-notif__actions">
                    <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={manualPending || !targetUserId}>
                      {manualPending ? messages.settingsLeave.manualGrantSubmitting : messages.settingsLeave.manualGrantSubmit}
                    </button>
                  </div>
                </form>
              </div>

              <div className="leave-admin-section">
                <h3 className="settings-notif__section-title">{messages.settingsLeave.convertTitle}</h3>
                <p className="leave-admin-section__desc">{messages.settingsLeave.convertDesc}</p>
                <div className="settings-notif__actions">
                  <button
                    type="button"
                    className="k-modal__confirm k-modal__confirm--neutral"
                    disabled={!targetUserId}
                    onClick={() => {
                      setConvertError(null);
                      setConvertResult(null);
                      setConvertConfirmOpen(true);
                    }}
                  >
                    {messages.settingsLeave.convertRun}
                  </button>
                </div>
                {convertResult ? (
                  convertResult.length === 0 ? (
                    <p className="leave-admin-result">{messages.settingsLeave.convertResultEmpty}</p>
                  ) : (
                    <div className="leave-admin-result">
                      <p>
                        {messages.settingsLeave.convertResultConvertedPrefix}
                        <span className="tabular-nums">{convertedTotal}</span>
                        {messages.settingsLeave.convertResultConvertedSuffix}
                        {truncatedTotal > 0 ? (
                          <>
                            {" "}
                            {messages.settingsLeave.convertResultTruncatedPrefix}
                            <span className="tabular-nums">{truncatedTotal}</span>
                            {messages.settingsLeave.convertResultTruncatedSuffix}
                          </>
                        ) : null}
                      </p>
                      <table className="leave-admin-result-table">
                        <thead>
                          <tr>
                            <th>{messages.leave.grantColumnGrantedOn}</th>
                            <th>{messages.settingsLeave.convertResultConvertedSuffix}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {convertResult.map((c) => (
                            <tr key={c.sourceGrantId}>
                              <td>{c.sourceGrantId}</td>
                              <td className="tabular-nums">{c.convertedDays}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : null}
              </div>
            </section>

            {/*
              ---- 付与の予告(v0.7 フェーズ4、2026-08-24 追加) ----
              docs/requirements.md §11「予告 → 管理者承認 → 本人通知」。この画面自体が
              leave.grant.manage を要求し、予告APIも同じ権限・同じスコープなので、ここでの
              追加の権限確認は行わない(このファイル冒頭のヘッダコメントと同じ理由)。
            */}
            <section className="leave-admin-section">
              <h2 className="settings-notif__section-title">{messages.leaveGrantProposals.sectionTitle}</h2>
              <p className="leave-admin-section__desc">{messages.leaveGrantProposals.sectionDesc}</p>

              {proposalsError ? (
                <p className="correction-error" role="alert">
                  {proposalsError}
                </p>
              ) : null}
              {proposalSuccess ? <p className="settings-notif__success">{proposalSuccess}</p> : null}

              {proposals === null ? (
                <p className="org-settings__empty">{messages.loading}</p>
              ) : proposedProposals.length === 0 ? (
                <p className="org-settings__empty">{messages.leaveGrantProposals.empty}</p>
              ) : (
                <div className="org-settings__table-wrap">
                  <table className="org-table">
                    <thead>
                      <tr>
                        <th>{messages.leaveGrantProposals.columnMember}</th>
                        <th>{messages.leaveGrantProposals.columnLeaveType}</th>
                        <th>{messages.leaveGrantProposals.columnGrantedOn}</th>
                        <th>{messages.leaveGrantProposals.columnDays}</th>
                        <th>{messages.leaveGrantProposals.columnAttendanceRate}</th>
                        <th>{messages.leaveGrantProposals.columnActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposedProposals.map((p) => {
                        const rate = p.attendanceRate.rate;
                        // null(全労働日0)は「不明」であって「8割未満」ではないため警告は出さない。
                        const belowThreshold = rate !== null && rate < ATTENDANCE_RATE_WARNING_THRESHOLD;
                        return (
                          <tr key={p.id}>
                            <td>{p.userName ?? p.userId}</td>
                            <td>{proposalLeaveTypeLabel(p.leaveType)}</td>
                            <td className="tabular-nums">{p.grantedOn}</td>
                            <td className="tabular-nums">
                              <div className="leave-proposal-days">
                                <span className="tabular-nums">{p.days}</span>
                                {/* 比例付与(労基法39条3項)のときだけ区分を出す。フルタイムの表と日数が
                                    違う理由をその場で読み取れるようにするため(2026-08-24 追加)。 */}
                                {p.leaveGrantClass !== null && p.leaveGrantClass !== "full" ? (
                                  <span className="chip">
                                    {messages.leaveGrantProposals.proportionalChip(
                                      messages.members.leaveGrantClassOption[p.leaveGrantClass],
                                    )}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="leave-proposal-rate">
                                <span className="tabular-nums">{formatAttendanceRate(rate)}</span>
                                <span className="leave-proposal-rate__basis">{attendanceBasisLabel(p.attendanceRate.basis)}</span>
                                {belowThreshold ? (
                                  <span className="chip chip--warning">{messages.leaveGrantProposals.rateBelowThreshold}</span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="org-table__actions">
                                <button
                                  type="button"
                                  className="org-table__link-btn"
                                  onClick={() => {
                                    setProposalActionError(null);
                                    setProposalSuccess(null);
                                    setProposalNote("");
                                    setProposalConfirm({ id: p.id, action: "approve" });
                                  }}
                                >
                                  {messages.leaveGrantProposals.approve}
                                </button>
                                <button
                                  type="button"
                                  className="org-table__link-btn org-table__link-btn--danger"
                                  onClick={() => {
                                    setProposalActionError(null);
                                    setProposalSuccess(null);
                                    setProposalNote("");
                                    setProposalConfirm({ id: p.id, action: "reject" });
                                  }}
                                >
                                  {messages.leaveGrantProposals.reject}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 決裁済みの履歴。既定では畳んでおく(日常的に見るのは未決裁の方だけのため)。 */}
              <details className="leave-grant-details leave-proposal-history">
                <summary>{messages.leaveGrantProposals.historyTitle}</summary>
                {decidedProposals.length === 0 ? (
                  <p className="org-settings__empty">{messages.leaveGrantProposals.historyEmpty}</p>
                ) : (
                  <div className="leave-grant-table-wrap">
                    <table className="leave-grant-table">
                      <thead>
                        <tr>
                          <th>{messages.leaveGrantProposals.columnStatus}</th>
                          <th>{messages.leaveGrantProposals.columnGrantedOn}</th>
                          <th>{messages.leaveGrantProposals.columnDays}</th>
                          <th>{messages.leaveGrantProposals.columnDecidedAt}</th>
                          <th>{messages.leaveGrantProposals.columnDecisionNote}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {decidedProposals.map((p) => (
                          <tr key={p.id}>
                            <td>{messages.leaveGrantProposals.statusLabel[p.status]}</td>
                            <td className="tabular-nums">{p.grantedOn}</td>
                            <td className="tabular-nums">{p.days}</td>
                            <td className="tabular-nums">{p.decidedAt !== null ? formatDateTimeJst(p.decidedAt) : "—"}</td>
                            <td>{p.decisionNote ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </section>
          </>
        ) : null}
      </main>

      {autoGrantConfirmOpen ? (
        <ConfirmDialog
          title={messages.settingsLeave.autoGrantTitle}
          message={messages.settingsLeave.autoGrantDesc}
          confirmLabel={messages.settingsLeave.autoGrantRun}
          tone="neutral"
          note=""
          pending={autoGrantPending}
          error={autoGrantError}
          onConfirm={handleAutoGrantConfirm}
          onCancel={() => {
            setAutoGrantConfirmOpen(false);
            setAutoGrantError(null);
          }}
        />
      ) : null}

      {proposalConfirm ? (
        <ConfirmDialog
          title={
            proposalConfirm.action === "approve"
              ? messages.leaveGrantProposals.confirmApproveTitle
              : messages.leaveGrantProposals.confirmRejectTitle
          }
          message={
            proposalConfirm.action === "approve"
              ? messages.leaveGrantProposals.confirmApproveMessage
              : messages.leaveGrantProposals.confirmRejectMessage
          }
          confirmLabel={
            proposalConfirm.action === "approve" ? messages.leaveGrantProposals.approve : messages.leaveGrantProposals.reject
          }
          tone={proposalConfirm.action === "approve" ? "neutral" : "caution"}
          note={proposalNote}
          onNoteChange={proposalConfirm.action === "reject" ? setProposalNote : undefined}
          noteLabel={proposalConfirm.action === "reject" ? messages.leaveGrantProposals.noteLabel : undefined}
          notePlaceholder={messages.leaveGrantProposals.notePlaceholder}
          pending={proposalPending}
          error={proposalActionError}
          onConfirm={handleProposalConfirm}
          onCancel={() => {
            setProposalConfirm(null);
            setProposalActionError(null);
          }}
        />
      ) : null}

      {convertConfirmOpen ? (
        <ConfirmDialog
          title={messages.settingsLeave.convertTitle}
          message={messages.settingsLeave.convertDesc}
          confirmLabel={messages.settingsLeave.convertRun}
          tone="neutral"
          note=""
          pending={convertPending}
          error={convertError}
          onConfirm={handleConvertConfirm}
          onCancel={() => {
            setConvertConfirmOpen(false);
            setConvertError(null);
          }}
        />
      ) : null}
    </div>
  );
}
