"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type AttendanceMemberDto,
  type ShiftDayDto,
  type ShiftDayInput,
  type ShiftPatternDto,
  type ShiftPlanHistoryDto,
  type ShiftPlanWithDaysDto,
} from "../lib/api";
import { mapShiftPlanCreateErrorMessage, mapShiftsErrorMessage, messages } from "../lib/messages";
import { hasEffectivePermission } from "../lib/permissions";
import {
  calendarDaysInPeriod,
  hasSufficientLegalHolidays,
  shiftScheduledMinutes,
  shiftVariablePeriodStart,
  statutoryFrameMinutes,
  variablePeriodBounds,
  variablePeriodStartContaining,
} from "../lib/shifts";
import { dateStrFromEpochMinutesJst, formatDurationHm, minutesToHm, nowMinutes } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useEffectivePermissions } from "../lib/useEffectivePermissions";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { ShiftBulkAssignPanel } from "./shifts/ShiftBulkAssignPanel";
import { ShiftCellDialog } from "./shifts/ShiftCellDialog";
import { ShiftWeekGrid } from "./shifts/ShiftWeekGrid";

/**
 * シフト表の作成・確定(/shifts、shift.manage 保持者、v0.7 フェーズ3、2026-08-24 追加)。
 * docs/design/shift-work.md 決定事項1・2・3、apps/api/src/routes/shifts.ts。
 *
 * 判断点(完了報告に明記): 変形期間の開始日(variablePeriodStartDay)は
 * `tenant_settings.calendar.manage` で保護された GET /settings/attendance からしか取得できず、
 * shift.manage(department スコープ)を持つだけの担当者は必ずしもこの権限を持たない。
 * そのため取得をベストエフォートにし、失敗時は既存プラン(GET /shifts/plans?userId= の
 * periodStart)から開始日を推測し、それも無ければ1日を仮定する。POST /shifts/plans が
 * 400 period_start_mismatch を返した場合は、レスポンスに含まれる正しい開始日で表示中の
 * 期間を補正する(サーバー側の値が常に権威を持つ、UI側の推測はあくまで初期表示の便宜)。
 */
export function ShiftsView() {
  const router = useRouter();
  const guard = useAuthGuard();
  const { loading: permsLoading, permissions } = useEffectivePermissions();
  const canManage = hasEffectivePermission(permissions, "shift.manage", "department");

  // 対象メンバーの初期値(2026-08-24 追加): ?userId= があればそれを使う(MonthlyView と同じ、
  // 共有可能なディープリンクのため — 管理者が特定メンバーのシフト表を直接開けるようにする)。
  // 省略時は自分自身。
  const queryUserId = new URLSearchParams(router.query).get("userId");
  const [members, setMembers] = useState<AttendanceMemberDto[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(queryUserId);

  const [patterns, setPatterns] = useState<ShiftPatternDto[]>([]);
  const [settingsStartDay, setSettingsStartDay] = useState<number | null>(null);
  const [referenceDate] = useState(() => dateStrFromEpochMinutesJst(nowMinutes()));
  const [navOffsetMonths, setNavOffsetMonths] = useState(0);

  const [plans, setPlans] = useState<ShiftPlanWithDaysDto[] | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [creatingPlan, setCreatingPlan] = useState(false);
  const [createPlanError, setCreatePlanError] = useState<string | null>(null);

  const [cellDialogDate, setCellDialogDate] = useState<string | null>(null);
  const [cellPending, setCellPending] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState(false);

  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [publishPending, setPublishPending] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ShiftPlanHistoryDto | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (guard.status === "authed" && guard.user && selectedUserId === null) {
      setSelectedUserId(guard.user.id);
    }
  }, [guard.status, guard.user, selectedUserId]);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    api
      .getAttendanceMembers()
      .then((res) => {
        if (!cancelled) setMembers(res.members);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [guard.status]);

  useEffect(() => {
    if (guard.status !== "authed" || !canManage) return;
    let cancelled = false;
    api
      .listShiftPatterns()
      .then((res) => {
        if (!cancelled) setPatterns(res.patterns);
      })
      .catch(() => {
        // tenant スコープの shift.manage を持たない担当者は 403 になりうる(ファイル冒頭コメント参照)。
        // パターンから選ぶ機能だけ使えなくなり、個別編集は引き続き使える。
        if (!cancelled) setPatterns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [guard.status, canManage, reloadKey]);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    api
      .getAttendanceSettings()
      .then((res) => {
        if (!cancelled && res.effective) setSettingsStartDay(res.effective.variablePeriodStartDay);
      })
      .catch(() => {
        // calendar.manage を持たない担当者は 403(ファイル冒頭コメント参照)。プラン履歴からの推測にフォールバックする。
      });
    return () => {
      cancelled = true;
    };
  }, [guard.status]);

  useEffect(() => {
    if (guard.status !== "authed" || !canManage || !selectedUserId) return;
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(null);
    api
      .listShiftPlans({ userId: selectedUserId })
      .then((res) => {
        if (!cancelled) setPlans(res.plans);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setPlansError(err instanceof ApiError ? messages.shifts.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, canManage, selectedUserId, reloadKey]);

  const inferredStartDay = plans && plans.length > 0 ? Number([...plans].sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0]?.periodStart.slice(8, 10)) : null;
  const effectiveStartDay = settingsStartDay ?? inferredStartDay ?? 1;
  const basePeriodStart = variablePeriodStartContaining(referenceDate, effectiveStartDay);
  const periodStart = shiftVariablePeriodStart(basePeriodStart, navOffsetMonths);
  const { periodEnd } = variablePeriodBounds(periodStart);

  const currentPlan = plans?.find((p) => p.periodStart === periodStart) ?? null;

  async function handleCreatePlan() {
    if (!selectedUserId) return;
    setCreatingPlan(true);
    setCreatePlanError(null);
    try {
      const { plan } = await api.createShiftPlan({ userId: selectedUserId, periodStart });
      setPlans((prev) => [...(prev ?? []), { ...plan, days: [] }]);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 400) {
        const code = err.body && typeof err.body === "object" && "error" in err.body ? (err.body as { error: unknown }).error : null;
        if (code === "period_start_mismatch" && "variablePeriodStartDay" in (err.body as object)) {
          const day = (err.body as { variablePeriodStartDay: unknown }).variablePeriodStartDay;
          if (typeof day === "number") setSettingsStartDay(day);
        }
      }
      setCreatePlanError(err instanceof ApiError ? mapShiftPlanCreateErrorMessage(err.body) : messages.errors.network);
    } finally {
      setCreatingPlan(false);
    }
  }

  function replacePlanDays(planId: string, days: ShiftDayDto[]) {
    setPlans((prev) => (prev ? prev.map((p) => (p.id === planId ? { ...p, days } : p)) : prev));
  }

  async function handleCellSubmit(input: ShiftDayInput) {
    if (!currentPlan) return;
    setCellPending(true);
    setCellError(null);
    try {
      const res = await api.updateShiftPlanDays(currentPlan.id, [input]);
      replacePlanDays(currentPlan.id, res.days);
      setCellDialogDate(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setCellError(err instanceof ApiError ? mapShiftsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setCellPending(false);
    }
  }

  async function handleBulkApply(days: ShiftDayInput[]) {
    if (!currentPlan) return;
    setBulkPending(true);
    setBulkError(null);
    setBulkSuccess(false);
    try {
      const res = await api.updateShiftPlanDays(currentPlan.id, days);
      replacePlanDays(currentPlan.id, res.days);
      setBulkSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setBulkError(err instanceof ApiError ? mapShiftsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setBulkPending(false);
    }
  }

  async function handlePublishConfirm() {
    if (!currentPlan) return;
    setPublishPending(true);
    setPublishError(null);
    try {
      const { plan } = await api.publishShiftPlan(currentPlan.id);
      setPlans((prev) =>
        prev ? prev.map((p) => (p.id === plan.id ? { ...p, publishedAt: plan.publishedAt, publishedBy: plan.publishedBy } : p)) : prev,
      );
      setPublishConfirmOpen(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setPublishError(err instanceof ApiError ? mapShiftsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setPublishPending(false);
    }
  }

  async function handleHistoryToggle() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (!currentPlan || history) return;
    setHistoryLoading(true);
    try {
      const res = await api.getShiftPlanHistory(currentPlan.id);
      setHistory(res);
    } catch {
      // 履歴は補助情報のため、失敗しても静かに諦める(空のまま)。
    } finally {
      setHistoryLoading(false);
    }
  }

  if (guard.status === "loading" || permsLoading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  if (!canManage) {
    return (
      <div className="shifts-view">
        <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="shifts" />
        <main className="shifts-view__main">
          <h1 className="shifts-view__title">{messages.shifts.title}</h1>
          <p className="org-settings__forbidden" role="alert">
            {messages.shifts.noPermission}
          </p>
          <Link to="/shifts/me" className="dashboard-card__link">
            {messages.nav.shifts} →
          </Link>
        </main>
      </div>
    );
  }

  const memberName = (id: string): string => members?.find((m) => m.id === id)?.name ?? id;

  const scheduledTotalMinutes = currentPlan ? currentPlan.days.reduce((sum, d) => sum + shiftScheduledMinutes(d), 0) : 0;
  const frameMinutes = statutoryFrameMinutes(periodStart, periodEnd);
  const legalHolidayCount = currentPlan ? currentPlan.days.filter((d) => d.dayType === "legal_holiday").length : 0;
  const legalHolidayOk = currentPlan ? hasSufficientLegalHolidays({ days: currentPlan.days, periodStart, periodEnd }) : false;
  const unassignedDays = currentPlan ? calendarDaysInPeriod(periodStart, periodEnd) - currentPlan.days.length : calendarDaysInPeriod(periodStart, periodEnd);
  const activePatterns = patterns.filter((p) => p.archivedAt === null);

  return (
    <div className="shifts-view">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="shifts" />
      <main className="shifts-view__main">
        <h1 className="shifts-view__title">{messages.shifts.title}</h1>
        <p className="shifts-view__tagline">{messages.shifts.tagline}</p>

        <div className="correction-field shifts-view__member-picker">
          <label htmlFor="shifts-member-select">{messages.shifts.memberLabel}</label>
          <select id="shifts-member-select" value={selectedUserId ?? ""} onChange={(e) => setSelectedUserId(e.target.value)}>
            {(members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === guard.user?.id ? messages.monthly.memberSwitcherSelfOption(m.name) : m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="shifts-view__period-nav">
          <button type="button" className="k-modal__cancel" onClick={() => setNavOffsetMonths((o) => o - 1)}>
            {messages.shifts.prevPeriod}
          </button>
          <span className="shifts-view__period-range tabular-nums">{messages.shifts.periodRangeLabel(periodStart, periodEnd)}</span>
          <button type="button" className="k-modal__cancel" onClick={() => setNavOffsetMonths((o) => o + 1)}>
            {messages.shifts.nextPeriod}
          </button>
        </div>

        {plansError ? <p className="monthly-error">{plansError}</p> : null}

        {plansLoading ? (
          <p className="monthly-loading">{messages.loading}</p>
        ) : !currentPlan ? (
          <div className="shifts-view__no-plan">
            <p>{messages.shifts.noPlanYet}</p>
            {createPlanError ? (
              <p className="correction-error" role="alert">
                {createPlanError}
              </p>
            ) : null}
            <button type="button" className="org-settings__primary-btn" onClick={handleCreatePlan} disabled={creatingPlan}>
              {creatingPlan ? messages.shifts.creatingPlan : messages.shifts.createPlan}
            </button>
          </div>
        ) : (
          <>
            <div className="shifts-view__status-row">
              <span className={`chip${currentPlan.publishedAt !== null ? " chip--system" : ""}`}>
                {currentPlan.publishedAt !== null ? messages.shifts.publishedBadge : messages.shifts.unpublishedBadge}
              </span>
              <button type="button" className="org-table__link-btn" onClick={handleHistoryToggle}>
                {historyOpen ? messages.shifts.historyToggleClose : messages.shifts.historyToggleOpen}
              </button>
            </div>

            {historyOpen ? (
              <div className="org-settings__table-wrap shifts-view__history">
                {historyLoading ? (
                  <p className="monthly-loading">{messages.loading}</p>
                ) : !history || history.history.length === 0 ? (
                  <p className="org-settings__empty">{messages.shifts.historyEmpty}</p>
                ) : (
                  <table className="org-table">
                    <thead>
                      <tr>
                        <th>{messages.shifts.historyColumnDate}</th>
                        <th>{messages.shifts.historyColumnDayType}</th>
                        <th>{messages.shifts.historyColumnTime}</th>
                        <th>{messages.shifts.historyColumnCreatedBy}</th>
                        <th>{messages.shifts.historyColumnCreatedAt}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.history.map((h) => (
                        <tr key={h.id}>
                          <td className="tabular-nums">{h.date}</td>
                          <td>{messages.shiftDayTypeLabel[h.dayType]}</td>
                          <td className="tabular-nums">{h.dayType === "work" ? `${minutesToHm(h.startMinutes)} → ${minutesToHm(h.endMinutes)}` : ""}</td>
                          <td>{memberName(h.createdBy)}</td>
                          <td className="tabular-nums">{new Date(h.createdAt * 60_000).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}

            <ShiftWeekGrid
              periodStart={periodStart}
              periodEnd={periodEnd}
              days={currentPlan.days}
              patterns={patterns}
              onCellClick={(date) => {
                setCellError(null);
                setCellDialogDate(date);
              }}
            />

            <ShiftBulkAssignPanel
              periodStart={periodStart}
              periodEnd={periodEnd}
              patterns={activePatterns}
              pending={bulkPending}
              error={bulkError}
              onApply={handleBulkApply}
            />
            {bulkSuccess ? <p className="attendance-settings__success">{messages.shifts.bulkAssignSuccess}</p> : null}

            <section className="shifts-aggregation">
              <h2 className="shifts-panel__title">{messages.shifts.aggregationTitle}</h2>
              <div className="totals-row">
                <span className="totals-chip">
                  <span className="totals-chip__label">{messages.shifts.aggregationScheduledLabel}</span>
                  <span className="totals-chip__value tabular-nums">{formatDurationHm(scheduledTotalMinutes)}</span>
                </span>
                <span className={`totals-chip${scheduledTotalMinutes > frameMinutes ? " totals-chip--overtime" : ""}`}>
                  <span className="totals-chip__label">{messages.shifts.aggregationStatutoryFrameLabel}</span>
                  <span className="totals-chip__value tabular-nums">{formatDurationHm(frameMinutes)}</span>
                </span>
                <span className="totals-chip">
                  <span className="totals-chip__label">{messages.shifts.aggregationLegalHolidayLabel}</span>
                  <span className="totals-chip__value tabular-nums">{legalHolidayCount}</span>
                </span>
                <span className="totals-chip">
                  <span className="totals-chip__label">{messages.shifts.aggregationUnassignedDaysLabel}</span>
                  <span className="totals-chip__value tabular-nums">{unassignedDays}</span>
                </span>
              </div>
              {scheduledTotalMinutes > frameMinutes ? <p className="shifts-aggregation__warning">{messages.shifts.aggregationOverLabel}</p> : null}
              <p className={legalHolidayOk ? "shifts-aggregation__ok" : "shifts-aggregation__warning"}>
                {legalHolidayOk ? messages.shifts.aggregationLegalHolidayOk : messages.shifts.aggregationLegalHolidayShortage}
              </p>
            </section>

            <div className="shifts-view__publish-row">
              <button
                type="button"
                className="org-settings__primary-btn"
                onClick={() => {
                  setPublishError(null);
                  setPublishConfirmOpen(true);
                }}
                disabled={currentPlan.publishedAt !== null}
              >
                {messages.shifts.publishAction}
              </button>
            </div>
          </>
        )}
      </main>

      {cellDialogDate && currentPlan ? (
        <ShiftCellDialog
          date={cellDialogDate}
          initial={currentPlan.days.find((d) => d.date === cellDialogDate) ?? null}
          patterns={patterns}
          pending={cellPending}
          error={cellError}
          onSubmit={handleCellSubmit}
          onCancel={() => setCellDialogDate(null)}
        />
      ) : null}

      {publishConfirmOpen ? (
        <ConfirmDialog
          title={messages.shifts.confirmPublishTitle}
          message={messages.shifts.confirmPublishMessage}
          confirmLabel={messages.shifts.confirmPublishLabel}
          tone="neutral"
          note=""
          pending={publishPending}
          error={publishError}
          onConfirm={handlePublishConfirm}
          onCancel={() => setPublishConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}
