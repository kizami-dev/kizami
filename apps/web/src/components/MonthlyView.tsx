"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  downloadAttendanceCsv,
  probeAttendanceCsvAccess,
  type ClosingEventDto,
  type ClosingStateDto,
  type MonthlyAttendance,
  type TimeCategory,
} from "../lib/api";
import { mapClosingErrorMessage, messages } from "../lib/messages";
import {
  currentYearMonthJst,
  formatDateLabel,
  formatDateTimeJst,
  formatDurationHm,
  formatMonthLabel,
  formatMonthParam,
  parseMonthParam,
  shiftMonth,
  type YearMonth,
} from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { CorrectionForm } from "./CorrectionForm";
import { HelpTip } from "./HelpTip";

const TOTAL_CATEGORIES: TimeCategory[] = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"];

/** 当初値との差分テーブルの1行(区分別合計5種+flex収支3種)。 */
interface DiffRow {
  key: string;
  label: string;
  original: number;
  current: number;
}

function buildDiffRows(data: MonthlyAttendance): DiffRow[] {
  if (!data.amended || !data.originalTotals || !data.originalFlexBalance) return [];
  const rows: DiffRow[] = TOTAL_CATEGORIES.map((cat) => ({
    key: cat,
    label: messages.totalsCategoryLabel[cat],
    original: data.originalTotals![cat],
    current: data.totals[cat],
  }));
  rows.push(
    { key: "flexFrame", label: messages.closing.diffFlexFrame, original: data.originalFlexBalance.frameMinutes, current: data.flexBalance.frameMinutes },
    { key: "flexActual", label: messages.closing.diffFlexActual, original: data.originalFlexBalance.actualMinutes, current: data.flexBalance.actualMinutes },
    { key: "flexDiff", label: messages.closing.diffFlexDiff, original: data.originalFlexBalance.diffMinutes, current: data.flexBalance.diffMinutes },
  );
  return rows;
}

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

  // 締め状態(v0.3): GET /closings/:period が 403 ならパネル自体を非表示にする(依頼どおり)。
  const [closingState, setClosingState] = useState<ClosingStateDto | null>(null);
  const [closingForbidden, setClosingForbidden] = useState(false);

  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const [reopenPending, setReopenPending] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  // CSVエクスポート(v0.3): HEAD プローブで権限が無ければボタンごと出さない。
  const [csvAllowed, setCsvAllowed] = useState(false);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [compareOriginal, setCompareOriginal] = useState(false);

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

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    api
      .getClosingState(monthParam)
      .then((res) => {
        if (cancelled) return;
        setClosingState(res.closing);
        setClosingForbidden(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setClosingForbidden(true);
          setClosingState(null);
          return;
        }
        // 締めパネルは付加情報のため、それ以外のエラーは静かに諦める(本体の月次表示は継続する)
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, monthParam, reloadKey]);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    probeAttendanceCsvAccess(monthParam).then((ok) => {
      if (!cancelled) setCsvAllowed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [guard.status, monthParam]);

  async function handleCloseConfirm() {
    setClosePending(true);
    setCloseError(null);
    try {
      const res = await api.closeMonth(monthParam, closeNote.trim() === "" ? undefined : closeNote.trim());
      setClosingState(res.closing);
      setCloseConfirmOpen(false);
      setCloseNote("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setCloseError(err instanceof ApiError ? mapClosingErrorMessage(err.body) : messages.errors.network);
    } finally {
      setClosePending(false);
    }
  }

  async function handleReopenConfirm() {
    setReopenPending(true);
    setReopenError(null);
    try {
      const res = await api.reopenMonth(monthParam, reopenNote.trim() === "" ? undefined : reopenNote.trim());
      setClosingState(res.closing);
      setReopenConfirmOpen(false);
      setReopenNote("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setReopenError(err instanceof ApiError ? mapClosingErrorMessage(err.body) : messages.errors.network);
    } finally {
      setReopenPending(false);
    }
  }

  async function handleCsvDownload() {
    setCsvDownloading(true);
    setCsvError(null);
    try {
      const { blob, filename } = await downloadAttendanceCsv(monthParam, data?.amended === true && compareOriginal);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setCsvError(messages.closing.csvDownloadFailed);
    } finally {
      setCsvDownloading(false);
    }
  }

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
  const diffRows = data ? buildDiffRows(data) : [];

  function closingActorLabel(event: ClosingEventDto): string {
    return event.actorId === guard.user?.id ? messages.closing.historyActorSelf : event.actorId;
  }

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
            {data.closed ? (
              <div className="closing-status">
                <span className="closing-badge closing-badge--closed">{messages.closing.closedBadge}</span>
                {data.amended ? (
                  <span className="closing-badge closing-badge--amended">{messages.closing.amendedBadge}</span>
                ) : null}
              </div>
            ) : null}

            <div className="flex-balance">
              <span className="flex-balance__label">
                {messages.monthly.flexBalanceLabel}
                <HelpTip helpKey="attendance.flex-frame" />
              </span>
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

            {diffRows.length > 0 ? (
              <div className="closing-diff">
                <h2 className="closing-diff__title">
                  {messages.closing.diffTitle}
                  <HelpTip helpKey="closing.amend" />
                </h2>
                <div className="closing-diff__table-wrap">
                  <table className="closing-diff__table">
                    <thead>
                      <tr>
                        <th>{messages.closing.diffColumnCategory}</th>
                        <th>{messages.closing.diffColumnOriginal}</th>
                        <th>{messages.closing.diffColumnCurrent}</th>
                        <th>{messages.closing.diffColumnDelta}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffRows.map((row) => {
                        const delta = row.current - row.original;
                        return (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            <td className="closing-diff__num tabular-nums">{formatDurationHm(row.original)}</td>
                            <td className="closing-diff__num tabular-nums">{formatDurationHm(row.current)}</td>
                            <td
                              className={`closing-diff__num tabular-nums ${delta < 0 ? "closing-diff__delta--negative" : "closing-diff__delta--positive"}`}
                            >
                              {delta >= 0 ? "+" : ""}
                              {formatDurationHm(delta)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {!closingForbidden && closingState ? (
              <div className="closing-panel">
                <div className="closing-panel__actions">
                  {closingState.status === "open" ? (
                    <>
                      <button
                        type="button"
                        className="k-modal__confirm k-modal__confirm--neutral"
                        onClick={() => setCloseConfirmOpen(true)}
                      >
                        {messages.closing.closeAction}
                      </button>
                      <HelpTip helpKey="closing.execute" />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="k-modal__confirm k-modal__confirm--caution"
                        onClick={() => setReopenConfirmOpen(true)}
                      >
                        {messages.closing.reopenAction}
                      </button>
                      <HelpTip helpKey="closing.unlock" />
                    </>
                  )}
                </div>

                <details className="closing-history">
                  <summary>{messages.closing.historyTitle}</summary>
                  {closingState.history.length === 0 ? (
                    <p className="closing-history__empty">{messages.closing.historyEmpty}</p>
                  ) : (
                    <ul className="closing-history__list">
                      {[...closingState.history].reverse().map((event) => (
                        <li key={event.id} className={`closing-history__item closing-history__item--${event.event}`}>
                          <span className="closing-history__event">{messages.closing.historyEventLabel[event.event]}</span>
                          <span className="closing-history__actor">{closingActorLabel(event)}</span>
                          <span className="closing-history__time tabular-nums">{formatDateTimeJst(event.occurredAt)}</span>
                          {event.note ? <span className="closing-history__note">{event.note}</span> : null}
                          {event.correctionRequestId ? (
                            <Link to="/corrections" className="closing-history__link">
                              {messages.closing.historyCorrectionLink}
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </div>
            ) : null}

            {csvAllowed ? (
              <div className="csv-export">
                {data.amended ? (
                  <label className="csv-export__checkbox">
                    <input
                      type="checkbox"
                      checked={compareOriginal}
                      onChange={(e) => setCompareOriginal(e.target.checked)}
                    />
                    {messages.closing.csvCompareOriginalLabel}
                  </label>
                ) : null}
                <button
                  type="button"
                  className="k-modal__cancel"
                  onClick={handleCsvDownload}
                  disabled={csvDownloading}
                >
                  {csvDownloading ? messages.closing.csvDownloading : messages.closing.csvDownload}
                </button>
                {csvError ? (
                  <p className="correction-error" role="alert">
                    {csvError}
                  </p>
                ) : null}
              </div>
            ) : null}

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
                      <th>
                        {messages.monthly.columnLateNight}
                        <HelpTip helpKey="attendance.late-night" />
                      </th>
                      <th>
                        {messages.monthly.columnWarning}
                        <HelpTip helpKey="attendance.warnings" />
                      </th>
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

      {closeConfirmOpen ? (
        <ConfirmDialog
          title={messages.closing.confirmCloseTitle}
          message={messages.closing.confirmCloseMessage}
          confirmLabel={messages.closing.confirmCloseLabel}
          tone="neutral"
          note={closeNote}
          onNoteChange={setCloseNote}
          noteLabel={messages.closing.noteLabel}
          notePlaceholder={messages.closing.notePlaceholder}
          pending={closePending}
          error={closeError}
          onConfirm={handleCloseConfirm}
          onCancel={() => {
            setCloseConfirmOpen(false);
            setCloseError(null);
          }}
        />
      ) : null}

      {reopenConfirmOpen ? (
        <ConfirmDialog
          title={messages.closing.confirmReopenTitle}
          message={messages.closing.confirmReopenMessage}
          extraNote={messages.closing.confirmReopenExtraNote}
          confirmLabel={messages.closing.confirmReopenLabel}
          tone="caution"
          note={reopenNote}
          onNoteChange={setReopenNote}
          noteLabel={messages.closing.noteLabel}
          notePlaceholder={messages.closing.notePlaceholder}
          pending={reopenPending}
          error={reopenError}
          onConfirm={handleReopenConfirm}
          onCancel={() => {
            setReopenConfirmOpen(false);
            setReopenError(null);
          }}
        />
      ) : null}
    </div>
  );
}
