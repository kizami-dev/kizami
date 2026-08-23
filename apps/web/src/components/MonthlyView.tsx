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
  type DailyBreakdown,
  type MonthlyAttendance,
  type TimeCategory,
  type WorkStretch,
} from "../lib/api";
import { mapClosingErrorMessage, messages } from "../lib/messages";
import {
  currentYearMonthJst,
  dateStrFromEpochMinutesJst,
  diffCalendarDaysJst,
  formatDateLabel,
  formatDateTimeJst,
  formatDurationHm,
  formatMonthDayShort,
  formatMonthLabel,
  formatMonthParam,
  formatTimeJst,
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

/**
 * 36協定・原則(限度時間)の月あたり上限: 45時間(労基法36条4項)。
 * 特別条項による延長(年720時間等の例外上限)はここでは扱わない — 固定時間制のフレックス収支
 * バー置き換え(ui-direction.md「月次」節)は「原則の限度に対する位置」を示すためのもので、
 * 特別条項の適用有無はテナント側の36協定運用に依存し月次一覧単体では判定できないため。
 */
const AGREEMENT36_MONTHLY_LIMIT_MINUTES = 45 * 60;

/** 当初値との差分テーブルの1行(区分別合計5種+flex収支3種)。 */
interface DiffRow {
  key: string;
  label: string;
  original: number;
  current: number;
}

/**
 * 締め後修正の差分行を組み立てる。区分別合計(統計内・残業等)は制度によらず出す一方、
 * フレックス収支の差分行は現在・当初のどちらも flexBalance がある(=フレックス)ときだけ出す
 * — 固定時間制では flexBalance が null になる(packages/engine の契約、work-systems.md)ため。
 */
function buildDiffRows(data: MonthlyAttendance): DiffRow[] {
  if (!data.amended || !data.originalTotals) return [];
  const rows: DiffRow[] = TOTAL_CATEGORIES.map((cat) => ({
    key: cat,
    label: messages.totalsCategoryLabel[cat],
    original: data.originalTotals![cat],
    current: data.totals[cat],
  }));
  if (data.flexBalance && data.originalFlexBalance) {
    rows.push(
      { key: "flexFrame", label: messages.closing.diffFlexFrame, original: data.originalFlexBalance.frameMinutes, current: data.flexBalance.frameMinutes },
      { key: "flexActual", label: messages.closing.diffFlexActual, original: data.originalFlexBalance.actualMinutes, current: data.flexBalance.actualMinutes },
      { key: "flexDiff", label: messages.closing.diffFlexDiff, original: data.originalFlexBalance.diffMinutes, current: data.flexBalance.diffMinutes },
    );
  }
  return rows;
}

/** 勤務区間1件の出勤側表示(「9:00」)。2列表示・1セル表示の両方から使う。 */
function formatStretchClockIn(stretch: WorkStretch): string {
  return formatTimeJst(stretch.clockInAt);
}

/**
 * 勤務区間1件の退勤側表示。退勤の勤怠日(暦日、JST 0時基準)が行の日付より後なら「翌」を付け、
 * 2日以上先なら「翌々」ではなく日付そのもの(M/D)を出す(依頼どおり)。未退勤は stretchOpenEnded。
 * 2列表示・1セル表示の両方から使う。
 */
function formatStretchClockOut(rowDate: string, stretch: WorkStretch): string {
  if (stretch.clockOutAt === null) {
    return messages.monthly.stretchOpenEnded;
  }
  const outDateStr = dateStrFromEpochMinutesJst(stretch.clockOutAt);
  const dayDiff = diffCalendarDaysJst(rowDate, outDateStr);
  const outLabel = formatTimeJst(stretch.clockOutAt);
  if (dayDiff === 1) {
    return `${messages.monthly.stretchNextDayPrefix} ${outLabel}`;
  }
  if (dayDiff > 1) {
    return `${formatMonthDayShort(outDateStr)} ${outLabel}`;
  }
  return outLabel;
}

/** 勤務区間1件を「9:00 → 18:30」のような表示文字列にする(1セル表記、狭いビューポート用)。 */
function formatStretchRange(rowDate: string, stretch: WorkStretch): string {
  return `${formatStretchClockIn(stretch)} → ${formatStretchClockOut(rowDate, stretch)}`;
}

/**
 * 日界をまたぐ勤務区間(前日以前に出勤し、この日に退勤した区間)。
 * 勤務列(いつ職場にいたか)は区間の開始日に表示され、実労働(workedMinutes)は
 * 勤怠日(暦日)で配賦されるため、日界をまたぐ夜勤があると受け側の日で「勤務列の合計」と
 * 「実労働」が食い違って見える(勤務列だけを見ると説明がつかない)。開始日側には既に
 * 「→ 翌 07:00」という表記があり区間が続いていると分かるが、受け側の日には何の手掛かりも
 * 無かった。これはその非対称を埋めるための情報で、受け側の日の勤務列先頭に控えめに足す。
 *
 * 注意: 勤務列と実労働列はそもそも別のものを測っている(前者は在席していた時間帯、
 * 後者はその勤怠日に配賦された分数)。ここで両者の合計を一致させることは目的にしない
 * — 受け側に「なぜ実労働がこれだけあるのか」の手掛かりを足すことだけが目的。
 */
interface IncomingStretch {
  /** 区間が始まった日(表示する接頭辞の「前日から」/「M/D から」の判定に使う)。 */
  originDate: string;
  clockOutAt: number;
}

/**
 * rowDate(受け側候補の日)より前の日の stretches から、退勤がちょうど rowDate に
 * 落ちる区間を集める。API は月内の日しか返さないため、前月末からまたぐ夜勤の起点日は
 * データに無く検出できない(既知の制限)。
 */
function findIncomingStretches(days: DailyBreakdown[], rowIndex: number): IncomingStretch[] {
  const rowDate = days[rowIndex]?.date;
  if (!rowDate) return [];
  const incoming: IncomingStretch[] = [];
  for (let i = 0; i < rowIndex; i++) {
    const priorDay = days[i];
    if (!priorDay) continue;
    for (const stretch of priorDay.stretches) {
      if (stretch.clockOutAt === null) continue;
      if (dateStrFromEpochMinutesJst(stretch.clockOutAt) === rowDate) {
        incoming.push({ originDate: priorDay.date, clockOutAt: stretch.clockOutAt });
      }
    }
  }
  return incoming;
}

/**
 * 受け側の日の出勤列に出す接頭辞(「(前日から)」/「(M/D から)」)。stretchNextDayPrefix と
 * 対称の規則。2列表示・1セル表示の両方から使う。
 */
function formatIncomingClockIn(rowDate: string, incoming: IncomingStretch): string {
  const dayDiff = diffCalendarDaysJst(incoming.originDate, rowDate);
  return dayDiff === 1
    ? messages.monthly.stretchPrevDayLabel
    : messages.monthly.stretchFromDateLabel(formatMonthDayShort(incoming.originDate));
}

/** 受け側の日に出す「(前日から) → 07:00」のような表示文字列(1セル表記、狭いビューポート用)。 */
function formatIncomingStretch(rowDate: string, incoming: IncomingStretch): string {
  return `${formatIncomingClockIn(rowDate, incoming)} → ${formatTimeJst(incoming.clockOutAt)}`;
}

/**
 * その日に「何かあった」か(打刻・有給・法定休日労働のいずれか)。実労働・休憩・深夜の
 * 各列を 0:00 で埋めるか空セルにするかの基準をここ1箇所にまとめる(列ごとにばらけさせない)。
 * 単に isLegalHoliday(その日が法定休日かどうかの設定)だけでは、労働の無い普通の休日まで
 * 「意味のある日」に含めてしまうため、実際に働いた分数(legalHolidayMinutes > 0)で判定する。
 */
function dayHasActivity(day: DailyBreakdown): boolean {
  return day.stretches.length > 0 || day.isPaidLeave || day.legalHolidayMinutes > 0;
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
    let label = messages.warningLabel[w.kind];
    // 休憩不足は「あと何分か」まで添える。不足量が分からないと、休憩の打刻を直すべきか
    // 実際に休憩を取るよう促すべきかの判断ができない。
    if (w.kind === "insufficient_break" && w.break) {
      label += messages.monthly.breakShortfallSuffix(
        formatDurationHm(w.break.requiredMinutes),
        formatDurationHm(w.break.actualMinutes),
      );
    }
    const list = warningsByDate.get(w.date) ?? [];
    list.push(label);
    warningsByDate.set(w.date, list);
  }

  const flex = data?.flexBalance;
  const flexPercent = flex && flex.frameMinutes > 0 ? Math.min(100, Math.max(0, (flex.actualMinutes / flex.frameMinutes) * 100)) : 0;

  // 固定時間制: フレックス収支バーと同じ見た目で「36協定 月45時間に対する時間外の位置」を出す
  // (ui-direction.md「月次」節「フレックス収支バーの置き換え」)。
  const overtimeMinutes = data?.totals.overtime ?? 0;
  const overtimeOverLimit = Math.max(0, overtimeMinutes - AGREEMENT36_MONTHLY_LIMIT_MINUTES);
  const overtimePercent = Math.min(100, Math.max(0, (overtimeMinutes / AGREEMENT36_MONTHLY_LIMIT_MINUTES) * 100));

  const diffRows = data ? buildDiffRows(data) : [];

  function closingActorLabel(event: ClosingEventDto): string {
    return event.actorId === guard.user?.id ? messages.closing.historyActorSelf : event.actorId;
  }

  return (
    <div className="monthly">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="monthly" />
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

            {data.workSystem === "flex" ? (
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
            ) : (
              <div className="flex-balance">
                <span className="flex-balance__label">
                  {messages.monthly.overtimeBarLabel}
                  <HelpTip helpKey="agreement36.limits" />
                </span>
                <div
                  className={`flex-balance__track${overtimeOverLimit > 0 ? " flex-balance__track--over" : ""}`}
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={AGREEMENT36_MONTHLY_LIMIT_MINUTES}
                  aria-valuenow={overtimeMinutes}
                  aria-label={messages.monthly.overtimeBarLabel}
                >
                  <div className="flex-balance__fill" style={{ width: `${overtimePercent}%` }} />
                </div>
                <div className="flex-balance__numbers tabular-nums">
                  <span>
                    {formatDurationHm(overtimeMinutes)} / {formatDurationHm(AGREEMENT36_MONTHLY_LIMIT_MINUTES)}{" "}
                    {messages.monthly.overtimeBarUnit}
                  </span>
                  <span className={overtimeOverLimit > 0 ? "flex-balance__diff--negative" : "flex-balance__diff--positive"}>
                    {overtimeOverLimit > 0
                      ? `+${formatDurationHm(overtimeOverLimit)} ${messages.monthly.overtimeBarOverLabel}`
                      : `${messages.monthly.overtimeBarRemainingLabel} ${formatDurationHm(AGREEMENT36_MONTHLY_LIMIT_MINUTES - overtimeMinutes)}`}
                  </span>
                </div>
              </div>
            )}

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

            {/*
              いまどの制度で見ているかの明示(ui-direction.md「月次」節)。フレックスの利用者が
              「時間外列が無い」ことに気づいたとき、理由(制度の違い)に到達できるようにする。
            */}
            <p className="monthly-table__work-system">
              {messages.monthly.workSystemLabel}: <strong>{messages.monthly.workSystemValue[data.workSystem]}</strong>
              <HelpTip helpKey="attendance.work-system" />
            </p>

            <div className="monthly-table-wrap">
              {data.days.length === 0 ? (
                <p className="monthly-empty">{messages.monthly.empty}</p>
              ) : (
                <table className="monthly-table">
                  <thead>
                    <tr>
                      <th>{messages.monthly.columnDate}</th>
                      {/*
                        勤務列の見出し: 狭いビューポートでは「勤務」1列、広いビューポートでは
                        「出勤」「退勤」2列に分ける(2026-08-23 追加)。3つとも常に DOM に置き
                        CSS の table-cell display:none で排他表示する(列数の整合を保つため。
                        JS の matchMedia は SSR/ハイドレーション不整合の懸念があり避けた)。
                      */}
                      <th className="monthly-table__stretches">{messages.monthly.columnStretches}</th>
                      <th className="monthly-table__col-clock-in">{messages.monthly.columnClockIn}</th>
                      <th className="monthly-table__col-clock-out">{messages.monthly.columnClockOut}</th>
                      <th>{messages.monthly.columnWorked}</th>
                      <th>
                        {messages.monthly.columnBreak}
                        <HelpTip helpKey="attendance.auto-break" />
                      </th>
                      <th>
                        {messages.monthly.columnLateNight}
                        <HelpTip helpKey="attendance.late-night" />
                      </th>
                      {data.workSystem === "fixed" ? (
                        <th>
                          {messages.monthly.columnOvertime}
                          <HelpTip helpKey="attendance.fixed-overtime" />
                        </th>
                      ) : null}
                      <th>
                        {messages.monthly.columnWarning}
                        <HelpTip helpKey="attendance.warnings" />
                      </th>
                      <th>{messages.monthly.columnActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day, dayIndex) => {
                      const warnings = warningsByDate.get(day.date);
                      const hasWarning = !!warnings && warnings.length > 0;
                      const hasOvertime = day.statutoryOvertimeMinutes > 0;
                      const hasExtra = day.extraWithinStatutoryMinutes > 0;
                      const hasActivity = dayHasActivity(day);
                      const incomingStretches = findIncomingStretches(data.days, dayIndex);
                      // 出勤・退勤の2列表示(2026-08-23 追加)は、1セル表記(直下)と同じ順番
                      // (継続行→当日の各区間)で1行ずつ積む。同じ配列から出勤列・退勤列の両方を
                      // 描くことで、行の並び・件数が必ず一致し、左右の行が視覚的に揃う。
                      const stretchRows: Array<{ key: string; incoming: boolean; clockIn: string; clockOut: string }> = [
                        ...incomingStretches.map((incoming, i) => ({
                          key: `incoming-${i}`,
                          incoming: true,
                          clockIn: formatIncomingClockIn(day.date, incoming),
                          clockOut: formatTimeJst(incoming.clockOutAt),
                        })),
                        ...day.stretches.map((stretch, i) => ({
                          key: `stretch-${i}`,
                          incoming: false,
                          clockIn: formatStretchClockIn(stretch),
                          clockOut: formatStretchClockOut(day.date, stretch),
                        })),
                      ];
                      // 警告のある行は「Y」マーク(2026-08-23 廃止)の代わりに行全体の背景で示す
                      // (warningLabel の文言そのものが隣にあり、非色覚的な手掛かりは既に足りている)。
                      const rowClassName =
                        [
                          day.isLegalHoliday ? "monthly-table__row--holiday" : null,
                          hasWarning ? "monthly-table__row--warning" : null,
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined;
                      return (
                        <tr key={day.date} className={rowClassName}>
                          <td className="monthly-table__date">{formatDateLabel(day.date)}</td>
                          <td className="monthly-table__stretches" data-label={messages.monthly.columnStretches}>
                            {incomingStretches.map((incoming, i) => (
                              <div
                                key={`incoming-${i}`}
                                className="monthly-table__stretch monthly-table__stretch--incoming tabular-nums"
                              >
                                {formatIncomingStretch(day.date, incoming)}
                              </div>
                            ))}
                            {day.stretches.map((stretch, i) => (
                              <div key={i} className="monthly-table__stretch tabular-nums">
                                {formatStretchRange(day.date, stretch)}
                              </div>
                            ))}
                          </td>
                          <td className="monthly-table__col-clock-in" data-label={messages.monthly.columnClockIn}>
                            {stretchRows.map((row) => (
                              <div
                                key={row.key}
                                className={`monthly-table__stretch tabular-nums${row.incoming ? " monthly-table__stretch--incoming" : ""}`}
                              >
                                {row.clockIn}
                              </div>
                            ))}
                          </td>
                          <td className="monthly-table__col-clock-out" data-label={messages.monthly.columnClockOut}>
                            {stretchRows.map((row) => (
                              <div
                                key={row.key}
                                className={`monthly-table__stretch tabular-nums${row.incoming ? " monthly-table__stretch--incoming" : ""}`}
                              >
                                {row.clockOut}
                              </div>
                            ))}
                          </td>
                          <td className="monthly-table__num tabular-nums" data-label={messages.monthly.columnWorked}>
                            {/* 法定休日の労働は workedMinutes ではなく legalHolidayMinutes に分類される
                                (engine の DailyBreakdown 契約)。日別の行でも「その日働いた時間」として
                                見えるべきなので合算して表示する。区分の内訳は月合計のチップが担う。 */}
                            {hasActivity ? formatDurationHm(day.workedMinutes + day.legalHolidayMinutes) : null}
                          </td>
                          <td className="monthly-table__num" data-label={messages.monthly.columnBreak}>
                            {hasActivity ? (
                              <>
                                <div className="tabular-nums">{formatDurationHm(day.breakMinutes)}</div>
                                {day.autoDeductedBreakMinutes > 0 ? (
                                  <div className="monthly-table__break-extra tabular-nums">
                                    {messages.monthly.autoBreakLabel} {formatDurationHm(day.autoDeductedBreakMinutes)}
                                  </div>
                                ) : null}
                              </>
                            ) : null}
                          </td>
                          <td className="monthly-table__num tabular-nums" data-label={messages.monthly.columnLateNight}>
                            {hasActivity ? formatDurationHm(day.lateNightMinutes) : null}
                          </td>
                          {data.workSystem === "fixed" ? (
                            <td className="monthly-table__num" data-label={messages.monthly.columnOvertime}>
                              {hasOvertime || hasExtra ? (
                                <>
                                  {hasOvertime ? (
                                    <div className="monthly-table__overtime-main tabular-nums">
                                      {formatDurationHm(day.statutoryOvertimeMinutes)}
                                    </div>
                                  ) : null}
                                  {hasExtra ? (
                                    <div className="monthly-table__overtime-extra tabular-nums">
                                      {messages.monthly.overtimeExtraLabel} {formatDurationHm(day.extraWithinStatutoryMinutes)}
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                            </td>
                          ) : null}
                          <td className="monthly-table__warning" data-label={messages.monthly.columnWarning}>
                            {warnings
                              ? warnings.map((label, i) => (
                                  <span key={i}>
                                    {label}
                                    {i < warnings.length - 1 ? "。" : ""}
                                  </span>
                                ))
                              : null}
                          </td>
                          <td className="monthly-table__actions" data-label={messages.monthly.columnActions}>
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
          autoDeductedBreakMinutes={data?.days.find((d) => d.date === correctionDate)?.autoDeductedBreakMinutes ?? 0}
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
