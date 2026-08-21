"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type MonthlyAttendance, type TimeCategory } from "../lib/api";
import { messages } from "../lib/messages";
import {
  currentYearMonthJst,
  formatDateLabel,
  formatDurationHm,
  formatMonthLabel,
  formatMonthParam,
  parseMonthParam,
  shiftMonth,
  type YearMonth,
} from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { CorrectionForm } from "./CorrectionForm";

const TOTAL_CATEGORIES: TimeCategory[] = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"];

export function MonthlyView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const queryParams = new URLSearchParams(router.query);
  const ym: YearMonth = parseMonthParam(queryParams.get("month")) ?? currentYearMonthJst();
  const monthParam = formatMonthParam(ym);
  /** 通知(打刻忘れ)からの導線: ?date=YYYY-MM-DD が付いていれば該当日の修正フォームを自動で開く。 */
  const autoOpenDate = queryParams.get("date");

  const [data, setData] = useState<MonthlyAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);

  useEffect(() => {
    if (autoOpenDate) setCorrectionDate(autoOpenDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenDate]);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .monthly(monthParam)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? messages.errors.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, monthParam, reloadKey]);

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const prevMonthParam = formatMonthParam(shiftMonth(ym, -1));
  const nextMonthParam = formatMonthParam(shiftMonth(ym, 1));

  const warningsByDate = new Map<string, string[]>();
  for (const w of data?.warnings ?? []) {
    const label = messages.warningLabel[w.kind];
    const list = warningsByDate.get(w.date) ?? [];
    list.push(label);
    warningsByDate.set(w.date, list);
  }

  const flex = data?.flexBalance;
  const flexPercent = flex && flex.frameMinutes > 0 ? Math.min(100, Math.max(0, (flex.actualMinutes / flex.frameMinutes) * 100)) : 0;

  return (
    <div className="monthly">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="monthly" />
      <main className="monthly__main">
        <div className="monthly__nav">
          <Link to={`/monthly?month=${prevMonthParam}`} className="monthly__nav-link">
            ← {messages.monthly.prevMonth}
          </Link>
          <h1 className="monthly__title">{formatMonthLabel(ym)}</h1>
          <Link to={`/monthly?month=${nextMonthParam}`} className="monthly__nav-link">
            {messages.monthly.nextMonth} →
          </Link>
        </div>

        {loading ? <p className="monthly-loading">{messages.loading}</p> : null}
        {error ? <p className="monthly-error">{error}</p> : null}

        {data ? (
          <>
            <div className="flex-balance">
              <span className="flex-balance__label">{messages.monthly.flexBalanceLabel}</span>
              <div
                className="flex-balance__track"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={flex?.frameMinutes ?? 0}
                aria-valuenow={flex?.actualMinutes ?? 0}
                aria-label={messages.monthly.flexBalanceLabel}
              >
                <div className="flex-balance__fill" style={{ width: `${flexPercent}%` }} />
              </div>
              <div className="flex-balance__numbers tabular-nums">
                <span>
                  {formatDurationHm(flex?.actualMinutes ?? 0)} / {formatDurationHm(flex?.frameMinutes ?? 0)}{" "}
                  {messages.monthly.flexBalanceUnit}
                </span>
                <span
                  className={
                    (flex?.diffMinutes ?? 0) < 0 ? "flex-balance__diff--negative" : "flex-balance__diff--positive"
                  }
                >
                  {(flex?.diffMinutes ?? 0) >= 0 ? "+" : ""}
                  {formatDurationHm(flex?.diffMinutes ?? 0)}
                </span>
              </div>
            </div>

            <div>
              <p className="flex-balance__label">{messages.monthly.totalsLabel}</p>
              <div className="totals-row">
                {TOTAL_CATEGORIES.map((cat) => (
                  <span key={cat} className={`totals-chip totals-chip--${cat}`}>
                    <span className="totals-chip__label">{messages.totalsCategoryLabel[cat]}</span>
                    <span className="totals-chip__value tabular-nums">{formatDurationHm(data.totals[cat])}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="monthly-table-wrap">
              {data.days.length === 0 ? (
                <p className="monthly-empty">{messages.monthly.empty}</p>
              ) : (
                <table className="monthly-table">
                  <thead>
                    <tr>
                      <th>{messages.monthly.columnDate}</th>
                      <th>{messages.monthly.columnWorked}</th>
                      <th>{messages.monthly.columnBreak}</th>
                      <th>{messages.monthly.columnLateNight}</th>
                      <th>{messages.monthly.columnWarning}</th>
                      <th>{messages.monthly.columnActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => {
                      const warnings = warningsByDate.get(day.date);
                      const hasWarning = !!warnings && warnings.length > 0;
                      return (
                        <tr key={day.date} className={day.isLegalHoliday ? "monthly-table__row--holiday" : undefined}>
                          <td>{formatDateLabel(day.date)}</td>
                          <td className="monthly-table__num tabular-nums">{formatDurationHm(day.workedMinutes)}</td>
                          <td className="monthly-table__num tabular-nums">{formatDurationHm(day.breakMinutes)}</td>
                          <td className="monthly-table__num tabular-nums">{formatDurationHm(day.lateNightMinutes)}</td>
                          <td className="monthly-table__warning">
                            {warnings
                              ? warnings.map((label, i) => (
                                  <span key={i}>
                                    <span className="monthly-table__warning-mark" aria-hidden="true">
                                      Y
                                    </span>
                                    {label}
                                    {i < warnings.length - 1 ? "。" : ""}
                                  </span>
                                ))
                              : null}
                          </td>
                          <td className="monthly-table__actions">
                            <button
                              type="button"
                              className={`monthly-table__correct-btn${hasWarning ? " monthly-table__correct-btn--warn" : ""}`}
                              onClick={() => setCorrectionDate(day.date)}
                            >
                              {messages.monthly.correctionAction}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </main>

      {correctionDate ? (
        <CorrectionForm
          date={correctionDate}
          onClose={() => setCorrectionDate(null)}
          onSubmitted={() => {
            setCorrectionDate(null);
            setReloadKey((k) => k + 1);
          }}
          onUnauthorized={() => {
            setCorrectionDate(null);
            router.push("/login");
          }}
        />
      ) : null}
    </div>
  );
}
