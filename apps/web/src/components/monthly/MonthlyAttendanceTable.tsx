"use client";

import { type DailyBreakdown, type LeaveRequestDto, type MonthlyAttendance, type WorkStretch } from "../../lib/api";
import { messages } from "../../lib/messages";
import {
  dateStrFromEpochMinutesJst,
  diffCalendarDaysJst,
  formatDateLabel,
  formatDurationHm,
  formatMonthDayShort,
  formatTimeJst,
} from "../../lib/time";
import { HelpTip } from "../HelpTip";

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

export interface MonthlyAttendanceTableProps {
  data: MonthlyAttendance;
  leaveByDate: Map<string, LeaveRequestDto[]>;
  onCorrect: (date: string) => void;
}

/**
 * 月次一覧の本体テーブル。MonthlyView から切り出したもの(挙動不変、第3波分割)。
 */
export function MonthlyAttendanceTable({ data, leaveByDate, onCorrect }: MonthlyAttendanceTableProps) {
  const warningsByDate = new Map<string, string[]>();
  for (const w of data.warnings) {
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

  return (
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
                  <td className="monthly-table__date">
                    {formatDateLabel(day.date)}
                    {/* 承認済み休暇のマーカー(2026-08-23)。事前申請した将来の休暇日も
                        「この日は休みの予定」と月次から読めるようにする。時間単位は分数を添える。 */}
                    {(leaveByDate.get(day.date) ?? []).map((req) => (
                      <span key={req.id} className="monthly-table__leave-badge">
                        {messages.leave.unitLabelShort[req.unit]}
                        {req.unit === "hourly" && req.minutes ? ` ${formatDurationHm(req.minutes)}` : ""}
                      </span>
                    ))}
                  </td>
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
                  <td className="monthly-table__num" data-label={messages.monthly.columnLateNight}>
                    {hasActivity ? (
                      <>
                        <div className="tabular-nums">{formatDurationHm(day.lateNightMinutes)}</div>
                        {/*
                          手当対象時間(日別、docs/design/allowances.md「UI」節)。列は増やさず、
                          深夜列の下に「法定内残業」併記(monthly-table__overtime-extra)と同じ型で
                          小さく出す。法定区分とは独立の会社制度のためこのセルに紐付く意味はないが、
                          勤務列に一番近い数値セルであり、既存の「主表示の下に併記する」パターンを
                          そのまま踏襲できる場所として選んだ(詳細は完了報告に明記)。
                        */}
                        {day.allowances.map((a) => (
                          <div key={a.definitionId} className="monthly-table__allowance tabular-nums">
                            {data.allowanceDefinitions[a.definitionId] ?? a.definitionId} {formatDurationHm(a.minutes)}
                          </div>
                        ))}
                      </>
                    ) : null}
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
                      onClick={() => onCorrect(day.date)}
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
  );
}
