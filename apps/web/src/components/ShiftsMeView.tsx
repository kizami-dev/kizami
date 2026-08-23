"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type ShiftDayDto } from "../lib/api";
import { hasEffectivePermission } from "../lib/permissions";
import { messages } from "../lib/messages";
import { currentYearMonthJst, formatMonthLabel, formatMonthParam, monthDateRange, parseMonthParam, shiftMonth, type YearMonth } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useEffectivePermissions } from "../lib/useEffectivePermissions";
import { AppHeader } from "./AppHeader";
import { ShiftWeekGrid } from "./shifts/ShiftWeekGrid";

/**
 * 本人のシフト閲覧(/shifts/me、全員、v0.7 フェーズ3、2026-08-24 追加)。
 * 月カレンダー風に自分のシフト(パターン名・時間)を表示する(セルフサービス、権限不要)。
 */
export function ShiftsMeView() {
  const router = useRouter();
  const guard = useAuthGuard();
  const { permissions } = useEffectivePermissions();
  const canManage = hasEffectivePermission(permissions, "shift.manage", "department");

  const queryParams = new URLSearchParams(router.query);
  const ym: YearMonth = parseMonthParam(queryParams.get("month")) ?? currentYearMonthJst();
  const monthParam = formatMonthParam(ym);
  const { from, to } = monthDateRange(ym);

  const [shifts, setShifts] = useState<ShiftDayDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getMyShifts(from, to)
      .then((res) => {
        if (!cancelled) setShifts(res.shifts);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? messages.shiftsMe.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, from, to]);

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const prevMonthParam = formatMonthParam(shiftMonth(ym, -1));
  const nextMonthParam = formatMonthParam(shiftMonth(ym, 1));

  return (
    <div className="shifts-view">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="shifts" />
      <main className="shifts-view__main">
        <h1 className="shifts-view__title">{messages.shiftsMe.title}</h1>
        <p className="shifts-view__tagline">{messages.shiftsMe.tagline}</p>

        <div className="monthly__nav">
          <Link to={`/shifts/me?month=${prevMonthParam}`} className="monthly__nav-link">
            ← {messages.shiftsMe.prevMonth}
          </Link>
          <h2 className="monthly__title">{formatMonthLabel(ym)}</h2>
          <Link to={`/shifts/me?month=${nextMonthParam}`} className="monthly__nav-link">
            {messages.shiftsMe.nextMonth} →
          </Link>
        </div>

        {canManage ? (
          <Link to="/shifts" className="dashboard-card__link">
            {messages.shiftsMe.manageLink}
          </Link>
        ) : null}

        {loading ? <p className="monthly-loading">{messages.loading}</p> : null}
        {error ? <p className="monthly-error">{error}</p> : null}

        {!loading && shifts ? (
          shifts.length === 0 ? (
            <p className="org-settings__empty">{messages.shiftsMe.empty}</p>
          ) : (
            <ShiftWeekGrid periodStart={from} periodEnd={to} days={shifts} patterns={[]} />
          )
        ) : null}
      </main>
    </div>
  );
}
