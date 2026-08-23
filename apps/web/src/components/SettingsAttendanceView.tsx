"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type AttendanceSettingsDto,
  type AttendanceSettingVersionDto,
  type AutoBreakRuleDto,
  type BreakRuleDto,
  type LegalHolidayRuleDto,
  type WorkPolicySettingsDto,
  type WorkPolicyVersionDto,
} from "../lib/api";
import { mapAttendanceSettingsErrorMessage, messages } from "../lib/messages";
import { currentYearMonthJst, dateStrFromEpochMinutesJst, formatDurationHm, formatMonthParam, nowMinutes, shiftMonth } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { HelpTip } from "./HelpTip";
import { SettingsNav } from "./SettingsNav";

/** 分(0〜1439) → "HH:MM"。 */
function minutesToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? `0${h}` : h}:${m < 10 ? `0${m}` : m}`;
}

/** "HH:MM" → 分(0〜1439)。不正な形式は null。 */
function hmToMinutes(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// モジュールレベルで messages のプロパティを取り出して定数化すると、import 時の言語
// (通常は既定の日本語)で凍結され、言語切替に追従しない(messages は Proxy 経由で
// 現在ロケールを返すが、取り出した先のオブジェクトはただの値のため)。
// 描画時に毎回引く関数にする(2026-08-23、SettingsAllowancesView 実装時に発見された同型バグの修正)。
const weekdayLabel = (w: 0 | 1 | 2 | 3 | 4 | 5 | 6): string => messages.settingsAttendance.weekdayLabel[w];

function summarizeLegalHoliday(rule: LegalHolidayRuleDto): string {
  if (rule.kind === "weekday") {
    return `${messages.settingsAttendance.legalHolidayWeekday}: ${weekdayLabel(rule.weekday)}`;
  }
  return `${messages.settingsAttendance.legalHolidayDates}: ${rule.dates.join("、")}`;
}

/**
 * 休憩ルールの要約文字列(現在有効な設定の表示・版の履歴の両方で使う)。
 * auto/both は「◯:◯超えたら◯:◯控除」を「、」区切りで並べる(rules は最大3件)。
 */
function summarizeBreakRule(rule: BreakRuleDto): string {
  if (rule.mode === "punch") return messages.settingsAttendance.breakRulePunch;
  const modeLabel = rule.mode === "auto" ? messages.settingsAttendance.breakRuleModeAuto : messages.settingsAttendance.breakRuleModeBoth;
  const rulesText = rule.rules
    .map((r) => `${formatDurationHm(r.overMinutes)}${messages.settingsAttendance.breakRuleOverSuffix} → ${formatDurationHm(r.deductMinutes)}${messages.settingsAttendance.breakRuleDeductSuffix}`)
    .join("、");
  return `${modeLabel}(${rulesText})`;
}

function summarizeAttendanceVersion(v: AttendanceSettingVersionDto): string {
  const gps = v.gpsEnabled
    ? `GPS: ${messages.settingsAttendance.gpsEnabledYes}${v.gpsRetentionDays ? `(${v.gpsRetentionDays}${messages.settingsAttendance.gpsRetentionDaysUnit})` : ""}`
    : `GPS: ${messages.settingsAttendance.gpsEnabledNo}`;
  return `${messages.settingsAttendance.dayBoundaryLabel} ${minutesToHm(v.dayBoundaryMinutes)} / ${messages.settingsAttendance.weekStartWeekdayLabel}: ${weekdayLabel(v.weekStartWeekday as 0 | 1 | 2 | 3 | 4 | 5 | 6)} / ${summarizeLegalHoliday(v.legalHolidayRule)} / ${messages.settingsAttendance.breakRuleLabel}: ${summarizeBreakRule(v.breakRule)} / ${gps}`;
}

/**
 * フォームの休憩ルール行 → API 入力の BreakRuleDto。
 * 不正な行(時刻・控除分数のいずれかが解釈できない、行が0件)があれば null を返す
 * (呼び出し側で invalid_break_rule として表示する)。昇順・重複なし・高々3件の検証は
 * サーバー側(routes/settings.ts isValidBreakRule)に委ねる — ここでは形式だけ検証する。
 */
function buildBreakRule(mode: "punch" | "auto" | "both", rows: BreakRuleRowForm[]): BreakRuleDto | null {
  if (mode === "punch") return { mode: "punch" };

  const rules: AutoBreakRuleDto[] = [];
  for (const row of rows) {
    const overMinutes = hmToMinutes(row.overHm);
    const deductMinutes = Number(row.deductMinutes);
    if (overMinutes === null || !Number.isInteger(deductMinutes) || deductMinutes < 1) return null;
    rules.push({ overMinutes, deductMinutes });
  }
  if (rules.length === 0) return null;
  return { mode, rules };
}

function summarizeWorkPolicyVersion(v: WorkPolicyVersionDto): string {
  return `${messages.settingsAttendance.flexStandardDayMinutesLabel}: ${v.standardDayMinutes}分`;
}

/** 休憩の自動控除ルール1行の編集用フォーム状態(2026-08-23 追加)。overHm は "HH:MM" 表示。 */
interface BreakRuleRowForm {
  overHm: string;
  deductMinutes: string;
}

/**
 * auto/both を選んだ直後にプレフィルする初期値(労基法34条の法定最低、docs/design/breaks.md)。
 * 6時間超で45分・8時間超で60分。
 */
const LEGAL_MINIMUM_BREAK_RULE_ROWS: BreakRuleRowForm[] = [
  { overHm: "06:00", deductMinutes: "45" },
  { overHm: "08:00", deductMinutes: "60" },
];

const MAX_BREAK_RULE_ROWS = 3;

interface AttendanceFormState {
  effectiveFrom: string;
  dayBoundaryHm: string;
  weekStartWeekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  legalHolidayKind: "weekday" | "dates";
  legalHolidayWeekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  legalHolidayDatesText: string;
  breakRuleMode: "punch" | "auto" | "both";
  /** mode が punch のときも保持しておく(auto/both に切り替えた瞬間に空にならないように)。 */
  breakRuleRows: BreakRuleRowForm[];
  gpsEnabled: boolean;
  gpsRetentionDays: string;
}

function defaultNextMonthFirstDay(): string {
  const next = shiftMonth(currentYearMonthJst(), 1);
  return `${formatMonthParam(next)}-01`;
}

function initialAttendanceForm(effective: AttendanceSettingVersionDto | null): AttendanceFormState {
  const breakRule = effective?.breakRule;
  return {
    effectiveFrom: defaultNextMonthFirstDay(),
    dayBoundaryHm: effective ? minutesToHm(effective.dayBoundaryMinutes) : "00:00",
    weekStartWeekday: (effective?.weekStartWeekday as 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined) ?? 0,
    legalHolidayKind: effective?.legalHolidayRule.kind ?? "weekday",
    legalHolidayWeekday: effective?.legalHolidayRule.kind === "weekday" ? effective.legalHolidayRule.weekday : 0,
    legalHolidayDatesText: effective?.legalHolidayRule.kind === "dates" ? effective.legalHolidayRule.dates.join(",") : "",
    breakRuleMode: breakRule?.mode ?? "punch",
    breakRuleRows:
      breakRule && breakRule.mode !== "punch"
        ? breakRule.rules.map((r) => ({ overHm: minutesToHm(r.overMinutes), deductMinutes: String(r.deductMinutes) }))
        : LEGAL_MINIMUM_BREAK_RULE_ROWS,
    gpsEnabled: effective?.gpsEnabled ?? false,
    gpsRetentionDays: effective?.gpsRetentionDays != null ? String(effective.gpsRetentionDays) : "",
  };
}

interface WorkPolicyFormState {
  effectiveFrom: string;
  standardDayMinutes: string;
}

function initialWorkPolicyForm(effective: WorkPolicyVersionDto | null): WorkPolicyFormState {
  return {
    effectiveFrom: defaultNextMonthFirstDay(),
    standardDayMinutes: effective ? String(effective.standardDayMinutes) : "480",
  };
}

/**
 * 勤怠ルールの版管理画面(/settings/attendance、2026-08-22 追加)。
 *
 * docs/design/v01-data-model.md 原則6(effective-dated)を UI 上でも徹底する:
 * - 「現在有効な設定」と「版の履歴」を必ず両方表示する
 * - 新しい版の追加フォームには「過去の集計は変わらない」ことを明示する一文を必ず添える
 * - GPS を有効にする変更には追加の警告(プライバシー通知の雛形への導線)を出す
 *
 * 日界・法定休日・休憩ルール・GPS(tenant_setting_versions)とフレックス設定
 * (work_policy_versions)は別の権限(tenant_settings.calendar.manage / .gps.manage /
 * .flex.manage)で保護されているため、2つの GET を独立に叩き、それぞれ 403 なら
 * そのセクションだけ非表示にする(依頼「権限がなければナビにも出さない」は
 * useSettingsAccess 側で担保し、ここでは「見えるが一部だけ触れない」状態も自然に扱う)。
 */
export function SettingsAttendanceView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [attendance, setAttendance] = useState<AttendanceSettingsDto | null>(null);
  const [attendanceForbidden, setAttendanceForbidden] = useState(false);
  const [workPolicy, setWorkPolicy] = useState<WorkPolicySettingsDto | null>(null);
  const [workPolicyForbidden, setWorkPolicyForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [attendanceForm, setAttendanceForm] = useState<AttendanceFormState | null>(null);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [attendanceSuccess, setAttendanceSuccess] = useState(false);

  const [workPolicyForm, setWorkPolicyForm] = useState<WorkPolicyFormState | null>(null);
  const [workPolicySaving, setWorkPolicySaving] = useState(false);
  const [workPolicyError, setWorkPolicyError] = useState<string | null>(null);
  const [workPolicySuccess, setWorkPolicySuccess] = useState(false);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setAttendanceForbidden(false);
    setWorkPolicyForbidden(false);

    Promise.allSettled([api.getAttendanceSettings(), api.getWorkPolicySettings()])
      .then(([attendanceRes, workPolicyRes]) => {
        if (cancelled) return;

        if (attendanceRes.status === "fulfilled") {
          setAttendance(attendanceRes.value);
          setAttendanceForm(initialAttendanceForm(attendanceRes.value.effective));
        } else if (attendanceRes.reason instanceof UnauthorizedError) {
          router.push("/login");
          return;
        } else if (attendanceRes.reason instanceof ApiError && attendanceRes.reason.status === 403) {
          setAttendanceForbidden(true);
        } else {
          setLoadError(messages.settingsAttendance.loadFailed);
        }

        if (workPolicyRes.status === "fulfilled") {
          setWorkPolicy(workPolicyRes.value);
          setWorkPolicyForm(initialWorkPolicyForm(workPolicyRes.value.effective));
        } else if (workPolicyRes.reason instanceof UnauthorizedError) {
          router.push("/login");
          return;
        } else if (workPolicyRes.reason instanceof ApiError && workPolicyRes.reason.status === 403) {
          setWorkPolicyForbidden(true);
        } else {
          setLoadError(messages.settingsAttendance.loadFailed);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, reloadKey]);

  function updateBreakRuleRow(index: number, patch: Partial<BreakRuleRowForm>) {
    setAttendanceForm((prev) =>
      prev ? { ...prev, breakRuleRows: prev.breakRuleRows.map((row, i) => (i === index ? { ...row, ...patch } : row)) } : prev,
    );
  }

  function addBreakRuleRow() {
    setAttendanceForm((prev) =>
      prev && prev.breakRuleRows.length < MAX_BREAK_RULE_ROWS
        ? { ...prev, breakRuleRows: [...prev.breakRuleRows, { overHm: "00:00", deductMinutes: "" }] }
        : prev,
    );
  }

  function removeBreakRuleRow(index: number) {
    setAttendanceForm((prev) =>
      prev && prev.breakRuleRows.length > 1 ? { ...prev, breakRuleRows: prev.breakRuleRows.filter((_, i) => i !== index) } : prev,
    );
  }

  async function handleAttendanceSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!attendanceForm) return;

    const dayBoundaryMinutes = hmToMinutes(attendanceForm.dayBoundaryHm);
    if (dayBoundaryMinutes === null) {
      setAttendanceError(messages.settingsAttendance.errors.invalid_day_boundary_minutes);
      return;
    }

    const legalHolidayRule: LegalHolidayRuleDto =
      attendanceForm.legalHolidayKind === "weekday"
        ? { kind: "weekday", weekday: attendanceForm.legalHolidayWeekday }
        : { kind: "dates", dates: attendanceForm.legalHolidayDatesText.split(",").map((d) => d.trim()).filter((d) => d.length > 0) };

    const breakRule = buildBreakRule(attendanceForm.breakRuleMode, attendanceForm.breakRuleRows);
    if (breakRule === null) {
      setAttendanceError(messages.settingsAttendance.errors.invalid_break_rule);
      return;
    }

    const gpsRetentionDays = attendanceForm.gpsRetentionDays.trim() === "" ? null : Number(attendanceForm.gpsRetentionDays);

    setAttendanceSaving(true);
    setAttendanceError(null);
    setAttendanceSuccess(false);
    try {
      await api.createAttendanceSettingVersion({
        effectiveFrom: attendanceForm.effectiveFrom,
        dayBoundaryMinutes,
        weekStartWeekday: attendanceForm.weekStartWeekday,
        legalHolidayRule,
        breakRule,
        gpsEnabled: attendanceForm.gpsEnabled,
        gpsRetentionDays,
      });
      setAttendanceSuccess(true);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setAttendanceError(err instanceof ApiError ? mapAttendanceSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setAttendanceSaving(false);
    }
  }

  async function handleWorkPolicySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workPolicyForm) return;

    const standardDayMinutes = Number(workPolicyForm.standardDayMinutes);
    if (!Number.isInteger(standardDayMinutes) || standardDayMinutes <= 0) {
      setWorkPolicyError(messages.settingsAttendance.errors.invalid_standard_day_minutes);
      return;
    }

    setWorkPolicySaving(true);
    setWorkPolicyError(null);
    setWorkPolicySuccess(false);
    try {
      await api.createWorkPolicyVersion({
        effectiveFrom: workPolicyForm.effectiveFrom,
        settlementPeriod: "monthly",
        standardDayMinutes,
      });
      setWorkPolicySuccess(true);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setWorkPolicyError(err instanceof ApiError ? mapAttendanceSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setWorkPolicySaving(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const todayDate = dateStrFromEpochMinutesJst(nowMinutes());
  const showNothing = attendanceForbidden && workPolicyForbidden;

  return (
    <div className="attendance-settings">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="attendance-settings__main">
        <SettingsNav active="attendance" />
        <h1 className="attendance-settings__title">{messages.settingsAttendance.title}</h1>
        <p className="attendance-settings__tagline">{messages.settingsAttendance.tagline}</p>

        {showNothing ? (
          <p className="attendance-settings__forbidden" role="alert">
            {messages.settingsAttendance.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!attendanceForbidden && attendance && attendanceForm ? (
          <section className="attendance-settings__section">
            <h2 className="attendance-settings__section-title">{messages.settingsAttendance.currentTitle}</h2>
            {attendance.effective ? (
              <div className="attendance-settings__current">
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">
                    {messages.settingsAttendance.dayBoundaryLabel}
                    <HelpTip helpKey="attendance.day-boundary" />
                  </span>
                  <span className="attendance-settings__current-value tabular-nums">{minutesToHm(attendance.effective.dayBoundaryMinutes)}</span>
                </div>
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">{messages.settingsAttendance.weekStartWeekdayLabel}</span>
                  <span className="attendance-settings__current-value">
                    {weekdayLabel(attendance.effective.weekStartWeekday as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
                  </span>
                </div>
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">
                    {messages.settingsAttendance.legalHolidayLabel}
                    <HelpTip helpKey="attendance.legal-holiday" />
                  </span>
                  <span className="attendance-settings__current-value">{summarizeLegalHoliday(attendance.effective.legalHolidayRule)}</span>
                </div>
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">
                    {messages.settingsAttendance.breakRuleLabel}
                    <HelpTip helpKey="attendance.auto-break" />
                  </span>
                  <span className="attendance-settings__current-value">{summarizeBreakRule(attendance.effective.breakRule)}</span>
                </div>
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">{messages.settingsAttendance.gpsLabel}</span>
                  <span className="attendance-settings__current-value">
                    {attendance.effective.gpsEnabled ? messages.settingsAttendance.gpsEnabledYes : messages.settingsAttendance.gpsEnabledNo}
                    {attendance.effective.gpsEnabled ? (
                      <>
                        {" "}
                        (
                        {attendance.effective.gpsRetentionDays != null
                          ? `${attendance.effective.gpsRetentionDays}${messages.settingsAttendance.gpsRetentionDaysUnit}`
                          : messages.settingsAttendance.gpsRetentionSameAsAttendance}
                        )
                      </>
                    ) : null}
                  </span>
                </div>
                <p className="attendance-settings__current-effective-from tabular-nums">
                  {messages.settingsAttendance.currentEffectiveFrom}: {attendance.effective.effectiveFrom}
                </p>
              </div>
            ) : (
              <p className="attendance-settings__empty">{messages.settingsAttendance.noVersionYet}</p>
            )}

            <h3 className="attendance-settings__form-title">{messages.settingsAttendance.formTitle}</h3>
            <form className="attendance-settings__form" onSubmit={handleAttendanceSubmit}>
              <p className="attendance-settings__effective-hint">
                {messages.settingsAttendance.effectiveFromHint}
                <HelpTip helpKey="law.versioning" />
              </p>

              <label className="attendance-settings__field">
                <span>{messages.settingsAttendance.effectiveFromLabel}</span>
                <input
                  type="date"
                  min={todayDate}
                  value={attendanceForm.effectiveFrom}
                  onChange={(e) => setAttendanceForm((prev) => (prev ? { ...prev, effectiveFrom: e.target.value } : prev))}
                  required
                />
              </label>

              <label className="attendance-settings__field">
                <span>
                  {messages.settingsAttendance.dayBoundaryLabel}
                  <HelpTip helpKey="attendance.day-boundary" />
                </span>
                <input
                  type="time"
                  value={attendanceForm.dayBoundaryHm}
                  onChange={(e) => setAttendanceForm((prev) => (prev ? { ...prev, dayBoundaryHm: e.target.value } : prev))}
                  required
                />
                <span className="attendance-settings__field-hint">{messages.settingsAttendance.dayBoundaryHint}</span>
              </label>

              <label className="attendance-settings__field">
                <span>{messages.settingsAttendance.weekStartWeekdayLabel}</span>
                <select
                  value={attendanceForm.weekStartWeekday}
                  onChange={(e) =>
                    setAttendanceForm((prev) =>
                      prev ? { ...prev, weekStartWeekday: Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6 } : prev,
                    )
                  }
                >
                  {([0, 1, 2, 3, 4, 5, 6] as const).map((w) => (
                    <option key={w} value={w}>
                      {weekdayLabel(w)}
                    </option>
                  ))}
                </select>
                <span className="attendance-settings__field-hint">{messages.settingsAttendance.weekStartWeekdayHint}</span>
              </label>

              <fieldset className="attendance-settings__field">
                <legend>
                  {messages.settingsAttendance.legalHolidayLabel}
                  <HelpTip helpKey="attendance.legal-holiday" />
                </legend>
                <label className="attendance-settings__radio">
                  <input
                    type="radio"
                    name="legalHolidayKind"
                    checked={attendanceForm.legalHolidayKind === "weekday"}
                    onChange={() => setAttendanceForm((prev) => (prev ? { ...prev, legalHolidayKind: "weekday" } : prev))}
                  />
                  {messages.settingsAttendance.legalHolidayWeekday}
                </label>
                {attendanceForm.legalHolidayKind === "weekday" ? (
                  <select
                    aria-label={messages.settingsAttendance.legalHolidayWeekdayValueLabel}
                    value={attendanceForm.legalHolidayWeekday}
                    onChange={(e) =>
                      setAttendanceForm((prev) =>
                        prev ? { ...prev, legalHolidayWeekday: Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6 } : prev,
                      )
                    }
                  >
                    {([0, 1, 2, 3, 4, 5, 6] as const).map((w) => (
                      <option key={w} value={w}>
                        {weekdayLabel(w)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <label className="attendance-settings__radio">
                  <input
                    type="radio"
                    name="legalHolidayKind"
                    checked={attendanceForm.legalHolidayKind === "dates"}
                    onChange={() => setAttendanceForm((prev) => (prev ? { ...prev, legalHolidayKind: "dates" } : prev))}
                  />
                  {messages.settingsAttendance.legalHolidayDates}
                </label>
                {attendanceForm.legalHolidayKind === "dates" ? (
                  <input
                    type="text"
                    aria-label={messages.settingsAttendance.legalHolidayDatesValueLabel}
                    placeholder={messages.settingsAttendance.legalHolidayDatesPlaceholder}
                    value={attendanceForm.legalHolidayDatesText}
                    onChange={(e) => setAttendanceForm((prev) => (prev ? { ...prev, legalHolidayDatesText: e.target.value } : prev))}
                  />
                ) : null}
              </fieldset>

              <fieldset className="attendance-settings__field">
                <legend>
                  {messages.settingsAttendance.breakRuleLabel}
                  <HelpTip helpKey="attendance.auto-break" />
                </legend>
                <label className="attendance-settings__radio">
                  <input
                    type="radio"
                    name="breakRuleMode"
                    checked={attendanceForm.breakRuleMode === "punch"}
                    onChange={() => setAttendanceForm((prev) => (prev ? { ...prev, breakRuleMode: "punch" } : prev))}
                  />
                  {messages.settingsAttendance.breakRulePunch}
                </label>
                <label className="attendance-settings__radio">
                  <input
                    type="radio"
                    name="breakRuleMode"
                    checked={attendanceForm.breakRuleMode === "auto"}
                    onChange={() => setAttendanceForm((prev) => (prev ? { ...prev, breakRuleMode: "auto" } : prev))}
                  />
                  {messages.settingsAttendance.breakRuleModeAuto}
                </label>
                <label className="attendance-settings__radio">
                  <input
                    type="radio"
                    name="breakRuleMode"
                    checked={attendanceForm.breakRuleMode === "both"}
                    onChange={() => setAttendanceForm((prev) => (prev ? { ...prev, breakRuleMode: "both" } : prev))}
                  />
                  {messages.settingsAttendance.breakRuleModeBoth}
                </label>

                {attendanceForm.breakRuleMode !== "punch" ? (
                  <div className="attendance-settings__break-rules">
                    <p className="attendance-settings__field-hint">{messages.settingsAttendance.breakRuleRulesTitle}</p>
                    {attendanceForm.breakRuleRows.map((row, i) => (
                      <div className="attendance-settings__break-rule-row" key={i}>
                        <input
                          type="time"
                          aria-label={messages.settingsAttendance.breakRuleRuleOverLabel}
                          value={row.overHm}
                          onChange={(e) => updateBreakRuleRow(i, { overHm: e.target.value })}
                        />
                        <span>{messages.settingsAttendance.breakRuleOverSuffix}</span>
                        <input
                          type="number"
                          min={1}
                          aria-label={messages.settingsAttendance.breakRuleRuleDeductLabel}
                          value={row.deductMinutes}
                          onChange={(e) => updateBreakRuleRow(i, { deductMinutes: e.target.value })}
                        />
                        <span>{messages.settingsAttendance.breakRuleDeductSuffix}</span>
                        <button
                          type="button"
                          className="attendance-settings__break-rule-remove"
                          onClick={() => removeBreakRuleRow(i)}
                          disabled={attendanceForm.breakRuleRows.length <= 1}
                        >
                          {messages.settingsAttendance.breakRuleRemoveRule}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="k-modal__cancel"
                      onClick={addBreakRuleRow}
                      disabled={attendanceForm.breakRuleRows.length >= MAX_BREAK_RULE_ROWS}
                    >
                      {messages.settingsAttendance.breakRuleAddRule}
                    </button>
                    <span className="attendance-settings__field-hint">{messages.settingsAttendance.breakRuleMaxRulesHint}</span>
                  </div>
                ) : null}
              </fieldset>

              <label className="attendance-settings__checkbox">
                <input
                  type="checkbox"
                  checked={attendanceForm.gpsEnabled}
                  onChange={(e) => setAttendanceForm((prev) => (prev ? { ...prev, gpsEnabled: e.target.checked } : prev))}
                />
                {messages.settingsAttendance.gpsEnabledCheckbox}
              </label>
              {attendanceForm.gpsEnabled ? (
                <>
                  <p className="attendance-settings__gps-warning" role="alert">
                    {messages.settingsAttendance.gpsWarning}{" "}
                    <Link to="/settings/privacy">{messages.settingsAttendance.gpsWarningLink}</Link>
                  </p>
                  <label className="attendance-settings__field">
                    <span>{messages.settingsAttendance.gpsRetentionInputLabel}</span>
                    <input
                      type="number"
                      min={1}
                      value={attendanceForm.gpsRetentionDays}
                      onChange={(e) => setAttendanceForm((prev) => (prev ? { ...prev, gpsRetentionDays: e.target.value } : prev))}
                    />
                  </label>
                </>
              ) : null}

              {attendanceError ? (
                <p className="correction-error" role="alert">
                  {attendanceError}
                </p>
              ) : null}
              {attendanceSuccess ? <p className="attendance-settings__success">{messages.settingsAttendance.submitSuccess}</p> : null}

              <div className="attendance-settings__actions">
                <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={attendanceSaving}>
                  {attendanceSaving ? messages.settingsAttendance.submitting : messages.settingsAttendance.submit}
                </button>
              </div>
            </form>

            <h3 className="attendance-settings__form-title">{messages.settingsAttendance.historyTitle}</h3>
            {attendance.history.length === 0 ? (
              <p className="attendance-settings__empty">{messages.settingsAttendance.historyEmpty}</p>
            ) : (
              <div className="org-settings__table-wrap">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>{messages.settingsAttendance.historyColumnEffectiveFrom}</th>
                      <th>{messages.settingsAttendance.historyColumnSummary}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...attendance.history].reverse().map((v) => (
                      <tr key={v.effectiveFrom}>
                        <td className="tabular-nums">{v.effectiveFrom}</td>
                        <td>{summarizeAttendanceVersion(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {!workPolicyForbidden && workPolicy && workPolicyForm ? (
          <section className="attendance-settings__section">
            <h2 className="attendance-settings__section-title">
              {messages.settingsAttendance.flexLabel}
              <HelpTip helpKey="attendance.flex-frame" />
            </h2>
            {workPolicy.effective ? (
              <div className="attendance-settings__current">
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">{messages.settingsAttendance.flexStandardDayMinutesLabel}</span>
                  <span className="attendance-settings__current-value tabular-nums">{workPolicy.effective.standardDayMinutes}</span>
                </div>
                <p className="attendance-settings__current-effective-from tabular-nums">
                  {messages.settingsAttendance.currentEffectiveFrom}: {workPolicy.effective.effectiveFrom}
                </p>
              </div>
            ) : (
              <p className="attendance-settings__empty">{messages.settingsAttendance.noVersionYet}</p>
            )}

            <h3 className="attendance-settings__form-title">{messages.settingsAttendance.workPolicyFormTitle}</h3>
            <form className="attendance-settings__form" onSubmit={handleWorkPolicySubmit}>
              <p className="attendance-settings__effective-hint">
                {messages.settingsAttendance.effectiveFromHint}
                <HelpTip helpKey="law.versioning" />
              </p>
              <label className="attendance-settings__field">
                <span>{messages.settingsAttendance.effectiveFromLabel}</span>
                <input
                  type="date"
                  min={todayDate}
                  value={workPolicyForm.effectiveFrom}
                  onChange={(e) => setWorkPolicyForm((prev) => (prev ? { ...prev, effectiveFrom: e.target.value } : prev))}
                  required
                />
              </label>
              <label className="attendance-settings__field">
                <span>{messages.settingsAttendance.flexStandardDayMinutesLabel}</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={workPolicyForm.standardDayMinutes}
                  onChange={(e) => setWorkPolicyForm((prev) => (prev ? { ...prev, standardDayMinutes: e.target.value } : prev))}
                  required
                />
                <span className="attendance-settings__field-hint">{messages.settingsAttendance.flexStandardDayMinutesHint}</span>
              </label>

              {workPolicyError ? (
                <p className="correction-error" role="alert">
                  {workPolicyError}
                </p>
              ) : null}
              {workPolicySuccess ? <p className="attendance-settings__success">{messages.settingsAttendance.submitSuccess}</p> : null}

              <div className="attendance-settings__actions">
                <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={workPolicySaving}>
                  {workPolicySaving ? messages.settingsAttendance.submitting : messages.settingsAttendance.submit}
                </button>
              </div>
            </form>

            <h3 className="attendance-settings__form-title">{messages.settingsAttendance.workPolicyHistoryTitle}</h3>
            {workPolicy.history.length === 0 ? (
              <p className="attendance-settings__empty">{messages.settingsAttendance.historyEmpty}</p>
            ) : (
              <div className="org-settings__table-wrap">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>{messages.settingsAttendance.historyColumnEffectiveFrom}</th>
                      <th>{messages.settingsAttendance.historyColumnSummary}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...workPolicy.history].reverse().map((v) => (
                      <tr key={v.effectiveFrom}>
                        <td className="tabular-nums">{v.effectiveFrom}</td>
                        <td>{summarizeWorkPolicyVersion(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
