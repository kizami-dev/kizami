"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type CreateLeaveGrantInput,
  type LeaveGrantDto,
  type LeaveGrantMethod,
  type LeaveType,
  type MemberDto,
  type StockConversionCandidateDto,
  type TenantLeaveSettingsDto,
  type UpdateLeaveSettingsInput,
} from "../lib/api";
import { mapLeaveSettingsErrorMessage, messages } from "../lib/messages";
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

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="settings" />
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
