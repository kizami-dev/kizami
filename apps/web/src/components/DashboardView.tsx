"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type AttendanceCapabilitiesDto,
  type AttendanceState,
  type AttendanceStatus,
  type CorrectionRequestDto,
  type LeaveBalanceDto,
  type LeaveRequestDto,
  type MonthlyAttendance,
  type NotificationDto,
  type PunchGpsInput,
  type PunchKind,
} from "../lib/api";
import { getCurrentPositionSafe } from "../lib/geolocation";
import { messages } from "../lib/messages";
import { notificationLinkFor } from "../lib/notifications";
import {
  currentYearMonthJst,
  dateStrFromEpochMinutesJst,
  formatDateLabel,
  formatDateTimeJst,
  formatDurationHm,
  formatMonthParam,
  nowMinutes,
} from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { AppHeader } from "./AppHeader";
import { OnboardingSection } from "./OnboardingSection";

const MAX_WARNING_DAYS_SHOWN = 5;
const MAX_NOTIFICATIONS_SHOWN = 3;

/**
 * ホーム(ダッシュボード、`/`、2026-08-22 新設)。docs/design/ui-direction.md
 * 「今後のUI作業 > 4. 全体像の入口」。
 *
 * 既存の5本のAPI(/attendance/status, /attendance/monthly, /corrections, /leave/balance,
 * /notifications)だけを組み合わせる(新しいAPIは作らない)。並行取得し、
 * 一部が失敗しても他は表示する(Promise.allSettled、失敗した枠は「情報なし」として
 * 静かに0件扱いにする — エラーバナーを画面いっぱいに出すと「今日やること」の一覧性を損なうため。
 * 個別のエラーは todoLoadFailed の一言だけ添える)。
 */
export function DashboardView() {
  const router = useRouter();
  const guard = useAuthGuard();
  const isOnline = useOnlineStatus();

  const monthParam = formatMonthParam(currentYearMonthJst());
  const todayDate = dateStrFromEpochMinutesJst(nowMinutes());

  // ---- 打刻(最上部、1画面で完結させる) ----
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [monthly, setMonthly] = useState<MonthlyAttendance | null>(null);
  const [capabilities, setCapabilities] = useState<AttendanceCapabilitiesDto | null>(null);
  const [punchDataLoaded, setPunchDataLoaded] = useState(false);

  const [pending, setPending] = useState(false);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [gpsLocating, setGpsLocating] = useState(false);
  const [gpsUnavailableNote, setGpsUnavailableNote] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // ---- 要対応(打刻とは独立: 打刻のたびに叩き直す必要はない) ----
  const [unread, setUnread] = useState<NotificationDto[] | null>(null);
  const [pendingCorrections, setPendingCorrections] = useState<CorrectionRequestDto[] | null>(null);
  const [pendingLeaveRequests, setPendingLeaveRequests] = useState<LeaveRequestDto[] | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalanceDto | null>(null);
  const [todoDataLoaded, setTodoDataLoaded] = useState(false);
  const [todoLoadFailed, setTodoLoadFailed] = useState(false);

  // 打刻の状態・今日今月の要点(status, monthly)。打刻するたびに reloadKey で再取得する。
  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;

    Promise.allSettled([api.status(), api.monthly(monthParam), api.getAttendanceCapabilities()]).then((results) => {
      if (cancelled) return;
      const [statusResult, monthlyResult, capsResult] = results;
      if (statusResult.status === "fulfilled") setStatus(statusResult.value);
      else if (statusResult.reason instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      if (monthlyResult.status === "fulfilled") setMonthly(monthlyResult.value);
      else if (monthlyResult.reason instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setCapabilities(capsResult.status === "fulfilled" ? capsResult.value : { gpsEnabled: false, gpsRetentionDays: null });
      setPunchDataLoaded(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, monthParam, reloadKey]);

  // 要対応の材料(通知・承認待ち申請・有給残高)。打刻では変わらないため1回だけ取得する。
  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;

    Promise.allSettled([
      api.listNotifications(true),
      api.listCorrections("pending"),
      api.listLeaveRequests("pending"),
      api.getLeaveBalance(),
    ]).then((results) => {
      if (cancelled) return;
      const [notifResult, correctionsResult, leaveReqResult, balanceResult] = results;
      let unauthorized = false;
      let anyFailed = false;

      if (notifResult.status === "fulfilled") setUnread(notifResult.value.notifications);
      else {
        anyFailed = true;
        if (notifResult.reason instanceof UnauthorizedError) unauthorized = true;
      }
      if (correctionsResult.status === "fulfilled") setPendingCorrections(correctionsResult.value.requests);
      else {
        anyFailed = true;
        if (correctionsResult.reason instanceof UnauthorizedError) unauthorized = true;
      }
      if (leaveReqResult.status === "fulfilled") setPendingLeaveRequests(leaveReqResult.value.requests);
      else {
        anyFailed = true;
        if (leaveReqResult.reason instanceof UnauthorizedError) unauthorized = true;
      }
      if (balanceResult.status === "fulfilled") setLeaveBalance(balanceResult.value);
      else {
        anyFailed = true;
        if (balanceResult.reason instanceof UnauthorizedError) unauthorized = true;
      }

      if (unauthorized) {
        router.push("/login");
        return;
      }
      setTodoLoadFailed(anyFailed);
      setTodoDataLoaded(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  async function handlePunch(kind: PunchKind) {
    if (!isOnline) return;
    setPending(true);
    setPunchError(null);
    setGpsUnavailableNote(false);
    try {
      let gps: PunchGpsInput | undefined;
      if (capabilities?.gpsEnabled) {
        setGpsLocating(true);
        const position = await getCurrentPositionSafe();
        setGpsLocating(false);
        if (position) {
          gps = { gpsLat: position.lat, gpsLng: position.lng };
        } else {
          setGpsUnavailableNote(true);
        }
      }
      await api.punch(kind, gps);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setPunchError(err instanceof ApiError ? messages.errors.punchFailed : messages.errors.network);
    } finally {
      setPending(false);
      setGpsLocating(false);
    }
  }

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const state: AttendanceState = status?.state ?? "out";
  const canClockIn = state === "out";
  const canBreak = state !== "out";
  const canClockOut = state !== "out";
  const breakKind: PunchKind = state === "onBreak" ? "break_end" : "break_start";
  const breakLabel = state === "onBreak" ? messages.punchButtons.breakEnd : messages.punchButtons.breakStart;

  const todayWorkedMinutes = monthly?.days.find((d) => d.date === todayDate)?.workedMinutes ?? 0;
  const flex = monthly?.figures.flexBalance;
  const flexPercent = flex && flex.frameMinutes > 0 ? Math.min(100, Math.max(0, (flex.actualMinutes / flex.frameMinutes) * 100)) : 0;

  const warningDates = monthly ? Array.from(new Set(monthly.warnings.map((w) => w.date))).sort() : [];
  const shownWarningDates = warningDates.slice(0, MAX_WARNING_DAYS_SHOWN);
  const extraWarningDaysCount = Math.max(0, warningDates.length - shownWarningDates.length);

  const mandatoryShortages = leaveBalance ? leaveBalance.mandatoryFiveDays.filter((m) => !m.satisfied) : [];
  const expiringSoonCount = (leaveBalance?.annual.expiringSoon.length ?? 0) + (leaveBalance?.stocked.expiringSoon.length ?? 0);

  const unreadShown = unread?.slice(0, MAX_NOTIFICATIONS_SHOWN) ?? [];
  const unreadCount = unread?.length ?? 0;
  const pendingCorrectionsCount = pendingCorrections?.length ?? 0;
  const pendingLeaveCount = pendingLeaveRequests?.length ?? 0;

  const hasTodo =
    unreadCount > 0 ||
    pendingCorrectionsCount > 0 ||
    pendingLeaveCount > 0 ||
    warningDates.length > 0 ||
    mandatoryShortages.length > 0 ||
    expiringSoonCount > 0;

  return (
    <div className="dashboard">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="dashboard" />
      <main className="dashboard__main">
        {/* ---- 0. はじめに(未完了の項目だけ、2026-08-22 追加) ---- */}
        <OnboardingSection authed={guard.status === "authed"} refreshKey={reloadKey} />

        {/* ---- 1. 打刻: 現在の状態と、その状態で押せるボタン ---- */}
        <section className="dashboard-punch" aria-label={messages.dashboard.punchSectionTitle}>
          <div className={`dashboard-punch__state dashboard-punch__state--${state}`}>
            <span className="dashboard-punch__state-label">{messages.attendanceState[state]}</span>
          </div>

          {punchError ? (
            <p className="punch-error" role="alert">
              {punchError}
            </p>
          ) : null}
          {!isOnline ? (
            <p className="punch-offline-banner" role="status">
              {messages.offline.banner}
            </p>
          ) : null}
          {capabilities?.gpsEnabled ? (
            <p className="dashboard-punch__gps-note">
              {messages.punchGps.noticeAlways}
              {gpsLocating ? <span className="punch-gps-notice__locating"> {messages.punchGps.locating}</span> : null}
            </p>
          ) : null}
          {gpsUnavailableNote ? <p className="punch-gps-notice__unavailable">{messages.punchGps.unavailableNote}</p> : null}

          <div className="dashboard-punch__pad">
            <button
              type="button"
              className="punch-button punch-button--in"
              disabled={!canClockIn || pending || !isOnline}
              onClick={() => handlePunch("clock_in")}
            >
              <span>{messages.punchButtons.clockIn}</span>
            </button>
            <button
              type="button"
              className="punch-button punch-button--break"
              disabled={!canBreak || pending || !isOnline}
              onClick={() => handlePunch(breakKind)}
            >
              <span>{breakLabel}</span>
            </button>
            <button
              type="button"
              className="punch-button punch-button--out"
              disabled={!canClockOut || pending || !isOnline}
              onClick={() => handlePunch("clock_out")}
            >
              <span>{messages.punchButtons.clockOut}</span>
            </button>
          </div>

          <Link to="/punch" className="dashboard-punch__stamp-link">
            {messages.mobileNav.stampScreenLink}
          </Link>
        </section>

        {/* ---- 2〜3. 今日/今月の要点・要対応(2026-08-23: 外枠が wide になった分、
             1カラムを間延びさせず横並びにする。dashboard.css の .dashboard-grid 参照) ---- */}
        <div className="dashboard-grid">
        {/* ---- 2. 今日/今月の要点 ---- */}
        <section className="dashboard-card" aria-label={messages.dashboard.todayTitle}>
          <h2 className="dashboard-card__title">{messages.dashboard.todayTitle}</h2>
          <div className="dashboard-today-row">
            <span className="dashboard-today-row__label">{messages.dashboard.todayWorkedLabel}</span>
            <span className="dashboard-today-row__value tabular-nums">
              {punchDataLoaded ? formatDurationHm(todayWorkedMinutes) : "—:—"}
            </span>
          </div>

          <div className="flex-balance">
            <span className="flex-balance__label">{messages.dashboard.monthFlexLabel}</span>
            <div
              className="flex-balance__track"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={flex?.frameMinutes ?? 0}
              aria-valuenow={flex?.actualMinutes ?? 0}
              aria-label={messages.dashboard.monthFlexLabel}
            >
              <div className="flex-balance__fill" style={{ width: `${flexPercent}%` }} />
            </div>
            <div className="flex-balance__numbers tabular-nums">
              <span>
                {formatDurationHm(flex?.actualMinutes ?? 0)} / {formatDurationHm(flex?.frameMinutes ?? 0)}
              </span>
              <span className={(flex?.diffMinutes ?? 0) < 0 ? "flex-balance__diff--negative" : "flex-balance__diff--positive"}>
                {(flex?.diffMinutes ?? 0) >= 0 ? "+" : ""}
                {formatDurationHm(flex?.diffMinutes ?? 0)}
              </span>
            </div>
          </div>
          <Link to={`/monthly?month=${monthParam}`} className="dashboard-card__link">
            {messages.dashboard.monthFlexMoreLink}
          </Link>
        </section>

        {/* ---- 3. 要対応(あるものだけ) ---- */}
        <section className="dashboard-card" aria-label={messages.dashboard.todoTitle}>
          <h2 className="dashboard-card__title">{messages.dashboard.todoTitle}</h2>

          {!todoDataLoaded ? (
            <p className="monthly-loading">{messages.loading}</p>
          ) : !hasTodo ? (
            <p className="dashboard-todo__empty">{messages.dashboard.todoEmpty}</p>
          ) : (
            <div className="dashboard-todo">
              {unreadCount > 0 ? (
                <div className="dashboard-todo__group">
                  <p className="dashboard-todo__group-title">
                    {messages.dashboard.todoNotificationsTitle}
                    <span className="dashboard-todo__count tabular-nums">
                      {unreadCount}
                      {messages.dashboard.todoNotificationsCountSuffix}
                    </span>
                  </p>
                  <ul className="dashboard-todo__notif-list">
                    {unreadShown.map((n) => {
                      const link = notificationLinkFor(n);
                      return (
                        <li key={n.id} className="dashboard-todo__notif-item">
                          <span className="dashboard-todo__notif-title">{n.title}</span>
                          <span className="dashboard-todo__notif-time tabular-nums">{formatDateTimeJst(n.createdAt)}</span>
                          {link ? (
                            <Link to={link.href} className="dashboard-todo__notif-link">
                              {link.label}
                            </Link>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {unreadCount > unreadShown.length ? (
                    <p className="dashboard-todo__more">{messages.dashboard.todoNotificationsMore}</p>
                  ) : null}
                </div>
              ) : null}

              {pendingCorrectionsCount > 0 || pendingLeaveCount > 0 ? (
                <div className="dashboard-todo__group">
                  <p className="dashboard-todo__group-title">{messages.dashboard.todoApprovalsTitle}</p>
                  {pendingCorrectionsCount > 0 ? (
                    <p className="dashboard-todo__row">
                      <span>
                        {messages.dashboard.todoApprovalsCorrections}
                        <span className="dashboard-todo__count tabular-nums">
                          {pendingCorrectionsCount}
                          {messages.dashboard.todoApprovalsCountSuffix}
                        </span>
                      </span>
                      <Link to="/corrections" className="dashboard-todo__row-link">
                        {messages.dashboard.todoApprovalsGoCorrections}
                      </Link>
                    </p>
                  ) : null}
                  {pendingLeaveCount > 0 ? (
                    <p className="dashboard-todo__row">
                      <span>
                        {messages.dashboard.todoApprovalsLeave}
                        <span className="dashboard-todo__count tabular-nums">
                          {pendingLeaveCount}
                          {messages.dashboard.todoApprovalsCountSuffix}
                        </span>
                      </span>
                      <Link to="/leave" className="dashboard-todo__row-link">
                        {messages.dashboard.todoApprovalsGoLeave}
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {warningDates.length > 0 ? (
                <div className="dashboard-todo__group">
                  <p className="dashboard-todo__group-title">{messages.dashboard.todoWarningsTitle}</p>
                  <ul className="dashboard-todo__warning-list">
                    {shownWarningDates.map((date) => (
                      <li key={date} className="dashboard-todo__warning-item">
                        <span>{formatDateLabel(date)}</span>
                        <Link to={`/monthly?month=${date.slice(0, 7)}&date=${date}`} className="dashboard-todo__row-link">
                          {messages.dashboard.todoWarningsFix}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {extraWarningDaysCount > 0 ? (
                    <p className="dashboard-todo__more">{messages.dashboard.todoWarningsMore(extraWarningDaysCount)}</p>
                  ) : null}
                </div>
              ) : null}

              {mandatoryShortages.length > 0 || expiringSoonCount > 0 ? (
                <div className="dashboard-todo__group">
                  <p className="dashboard-todo__group-title">{messages.dashboard.todoDeadlinesTitle}</p>
                  {mandatoryShortages.map((m) => (
                    <p key={m.grantId} className="dashboard-todo__row">
                      <span>
                        {messages.dashboard.todoDeadlinesMandatoryPrefix}
                        {m.shortage}
                        {messages.dashboard.todoDeadlinesMandatorySuffix}
                        {m.deadline}
                        {messages.dashboard.todoDeadlinesMandatorySuffix2}
                      </span>
                      <Link to="/leave" className="dashboard-todo__row-link">
                        {messages.dashboard.todoDeadlinesGoLeave}
                      </Link>
                    </p>
                  ))}
                  {expiringSoonCount > 0 ? (
                    <p className="dashboard-todo__row">
                      <span>{messages.dashboard.todoDeadlinesExpiring}</span>
                      <Link to="/leave" className="dashboard-todo__row-link">
                        {messages.dashboard.todoDeadlinesGoLeave}
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {todoLoadFailed ? <p className="dashboard-todo__load-failed">{messages.dashboard.todoLoadFailed}</p> : null}
        </section>
        </div>

        {/* ---- 4. クイックリンク ---- */}
        <section className="dashboard-card" aria-label={messages.dashboard.quickLinksTitle}>
          <h2 className="dashboard-card__title">{messages.dashboard.quickLinksTitle}</h2>
          <div className="settings-hub__grid">
            <Link to={`/monthly?month=${monthParam}`} className="settings-hub__card">
              <span className="settings-hub__card-title">{messages.dashboard.quickLinkMonthlyTitle}</span>
              <span className="settings-hub__card-desc">{messages.dashboard.quickLinkMonthlyDesc}</span>
            </Link>
            <Link to="/corrections" className="settings-hub__card">
              <span className="settings-hub__card-title">{messages.dashboard.quickLinkCorrectionsTitle}</span>
              <span className="settings-hub__card-desc">{messages.dashboard.quickLinkCorrectionsDesc}</span>
            </Link>
            <Link to="/leave" className="settings-hub__card">
              <span className="settings-hub__card-title">{messages.dashboard.quickLinkLeaveTitle}</span>
              <span className="settings-hub__card-desc">{messages.dashboard.quickLinkLeaveDesc}</span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
