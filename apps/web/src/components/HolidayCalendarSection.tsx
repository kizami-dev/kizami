"use client";

import { useState } from "react";
import { api, ApiError, UnauthorizedError, type HolidayCalendarDto, type HolidayCalendarSettingsDto, type HolidayCalendarVersionDto } from "../lib/api";
import { mapHolidayCalendarErrorMessage, messages } from "../lib/messages";
import { formatEffectiveFrom } from "../lib/effective-from";
import { HelpTip } from "./HelpTip";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Notice } from "./ui/Notice";

// モジュールレベルで messages のプロパティを取り出すと言語切替に追従しない
// (SettingsAttendanceView 冒頭のコメントと同じ理由)。描画時に毎回引く。
const weekdayLabel = (w: number): string => messages.settingsAttendance.weekdayLabel[w as 0 | 1 | 2 | 3 | 4 | 5 | 6];

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** 曜日の並びの表示(月曜始まりで並べる — 「土・日」が末尾に来る、カレンダーの見慣れた順) */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function summarizeWeekdays(weekdays: readonly number[]): string {
  if (weekdays.length === 0) return messages.settingsHolidayCalendar.weekdaysNone;
  return DISPLAY_ORDER.filter((w) => weekdays.includes(w))
    .map((w) => weekdayLabel(w))
    .join("・");
}

function summarizeDates(dates: readonly string[]): string {
  return dates.length === 0 ? messages.settingsHolidayCalendar.none : dates.join(", ");
}

/** 版の履歴の「内容」欄 */
function summarizeCalendar(c: HolidayCalendarDto): string {
  const m = messages.settingsHolidayCalendar;
  return [
    `${m.weekdaysLabel}: ${summarizeWeekdays(c.weekdays)}`,
    `${m.nationalHolidaysLabel}: ${c.nationalHolidays ? m.nationalHolidaysValue.on : m.nationalHolidaysValue.off}`,
    `${m.extraHolidaysLabel}: ${summarizeDates(c.extraHolidays)}`,
    `${m.extraWorkdaysLabel}: ${summarizeDates(c.extraWorkdays)}`,
  ].join(" / ");
}

/** "2026-10" → 「2026年10月」など(言語ごとの月の表記) */
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return messages.time.monthLabel(y ?? 0, m ?? 0);
}

/** カンマ・改行・空白で区切られた日付の入力を配列にする(空要素は捨てる。形式の検証はサーバー) */
function parseDateList(text: string): string[] {
  return text
    .split(/[\s,、]+/)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

interface CalendarFormState {
  effectiveFrom: string;
  weekdays: boolean[];
  nationalHolidays: boolean;
  extraHolidaysText: string;
  extraWorkdaysText: string;
}

function initialForm(effectiveFrom: string, base: HolidayCalendarDto): CalendarFormState {
  return {
    effectiveFrom,
    weekdays: ALL_WEEKDAYS.map((w) => base.weekdays.includes(w)),
    nationalHolidays: base.nationalHolidays,
    extraHolidaysText: base.extraHolidays.join(", "),
    extraWorkdaysText: base.extraWorkdays.join(", "),
  };
}

/** 最新の版(将来日の版を含む)。版の追加フォームの初期値に使う */
function latestVersion(data: HolidayCalendarSettingsDto): HolidayCalendarVersionDto | null {
  return data.history.length > 0 ? (data.history[data.history.length - 1] ?? null) : null;
}

export interface HolidayCalendarSectionProps {
  /** 初回の GET /settings/holiday-calendar の結果(親が勤怠ルールと一緒に取得する) */
  initial: HolidayCalendarSettingsDto;
  /** 今日("YYYY-MM-DD")。版の追加の適用開始日の下限 */
  todayDate: string;
  /** 版の追加フォームの適用開始日の初期値(親と同じ「翌月1日」) */
  defaultEffectiveFrom: string;
  onUnauthorized: () => void;
}

/**
 * 勤怠ルール画面の「所定休日のカレンダー」区画(2026-10-05、時短勤務の第2段階)。
 *
 * フレックスの総労働時間を「所定日数 × 標準時間」で決める制度の、所定労働日の数え方を決める。
 * 他の区画と同じ effective-dated の作法: 現在の値・版の追加(過去の集計は変わらない旨を添える)・
 * 版の履歴を並べる。版が1つも無いテナントは既定(土日・祝日)で数えているので、そのことを明示する。
 * 法定休日は所定休日の一部で、ここに入れなくても必ず休日として数える(上の区画の法定休日の設定が効く)。
 */
export function HolidayCalendarSection({ initial, todayDate, defaultEffectiveFrom, onUnauthorized }: HolidayCalendarSectionProps) {
  const [data, setData] = useState<HolidayCalendarSettingsDto>(initial);
  const [form, setForm] = useState<CalendarFormState>(() => initialForm(defaultEffectiveFrom, latestVersion(initial) ?? initial.defaults));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const m = messages.settingsHolidayCalendar;
  const current: HolidayCalendarDto = data.effective ?? data.defaults;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await api.createHolidayCalendarVersion({
        effectiveFrom: form.effectiveFrom,
        weekdays: ALL_WEEKDAYS.filter((w) => form.weekdays[w]),
        nationalHolidays: form.nationalHolidays,
        extraHolidays: parseDateList(form.extraHolidaysText),
        extraWorkdays: parseDateList(form.extraWorkdaysText),
      });
      const next = await api.getHolidayCalendar();
      setData(next);
      setFeedback({ tone: "success", text: m.submitSuccess });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setFeedback({ tone: "danger", text: err instanceof ApiError ? mapHolidayCalendarErrorMessage(err.body) : messages.errors.network });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="attendance-settings__section" data-testid="holiday-calendar-section">
      <h2 className="attendance-settings__section-title">
        {m.sectionTitle}
        <HelpTip helpKey="attendance.holiday-calendar" />
      </h2>
      <p className="section-lead">{m.sectionLead}</p>
      <Notice tone="info">{m.legalHolidayNote}</Notice>

      <div className="attendance-settings__current">
        <div className="attendance-settings__current-row">
          <span className="attendance-settings__current-label">{m.weekdaysLabel}</span>
          <span className="attendance-settings__current-value">{summarizeWeekdays(current.weekdays)}</span>
        </div>
        <div className="attendance-settings__current-row">
          <span className="attendance-settings__current-label">{m.nationalHolidaysLabel}</span>
          <span className="attendance-settings__current-value">
            {current.nationalHolidays ? m.nationalHolidaysValue.on : m.nationalHolidaysValue.off}
          </span>
        </div>
        <div className="attendance-settings__current-row">
          <span className="attendance-settings__current-label">{m.extraHolidaysLabel}</span>
          <span className="attendance-settings__current-value tabular-nums">{summarizeDates(current.extraHolidays)}</span>
        </div>
        <div className="attendance-settings__current-row">
          <span className="attendance-settings__current-label">{m.extraWorkdaysLabel}</span>
          <span className="attendance-settings__current-value tabular-nums">{summarizeDates(current.extraWorkdays)}</span>
        </div>
        {data.effective ? (
          <p className="attendance-settings__current-effective-from tabular-nums">
            {messages.settingsAttendance.currentEffectiveFrom}: {formatEffectiveFrom(data.effective.effectiveFrom)}
          </p>
        ) : (
          <p className="attendance-settings__current-effective-from">{m.defaultInUse}</p>
        )}
      </div>

      {data.preview.length > 0 ? (
        <div className="holiday-calendar__preview">
          <p className="flex-balance__label">{m.previewTitle}</p>
          <div className="totals-row">
            {data.preview.map((p) => (
              <span key={p.month} className="totals-chip">
                <span className="totals-chip__label">{monthLabel(p.month)}</span>
                <span className="totals-chip__value tabular-nums">{m.previewDays(p.scheduledWorkDays)}</span>
              </span>
            ))}
          </div>
          <p className="field__hint">
            {m.previewHint} {m.holidayDataRange(data.nationalHolidayDataRange.firstYear, data.nationalHolidayDataRange.lastYear)}
          </p>
          {data.preview.some((p) => p.nationalHolidayDataUnavailable) ? <Notice tone="caution">{m.holidayDataUnavailable}</Notice> : null}
        </div>
      ) : null}

      <form className="attendance-settings__form" onSubmit={handleSubmit}>
        <h3 className="attendance-settings__form-title">{m.formTitle}</h3>
        <Notice tone="caution">
          {messages.settingsAttendance.effectiveFromHint}
          <HelpTip helpKey="law.versioning" />
        </Notice>
        <Field label={messages.settingsAttendance.effectiveFromLabel} htmlFor="holiday-calendar-effective-from">
          <input
            id="holiday-calendar-effective-from"
            type="date"
            min={todayDate}
            value={form.effectiveFrom}
            onChange={(e) => setForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
            required
          />
        </Field>

        <fieldset className="field attendance-settings__field">
          <legend>{m.weekdaysLabel}</legend>
          <div className="attendance-settings__weekdays">
            {DISPLAY_ORDER.map((w) => (
              <label key={w} className="check">
                <input
                  type="checkbox"
                  checked={form.weekdays[w] ?? false}
                  onChange={() => setForm((prev) => ({ ...prev, weekdays: prev.weekdays.map((checked, idx) => (idx === w ? !checked : checked)) }))}
                />
                <span>{weekdayLabel(w)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="check">
          <input type="checkbox" checked={form.nationalHolidays} onChange={(e) => setForm((prev) => ({ ...prev, nationalHolidays: e.target.checked }))} />
          <span>{m.nationalHolidaysCheckbox}</span>
        </label>

        <Field label={m.extraHolidaysLabel} htmlFor="holiday-calendar-extra-holidays" hint={m.extraHolidaysHint}>
          <textarea
            id="holiday-calendar-extra-holidays"
            rows={2}
            className="tabular-nums"
            placeholder={m.datesPlaceholder}
            value={form.extraHolidaysText}
            onChange={(e) => setForm((prev) => ({ ...prev, extraHolidaysText: e.target.value }))}
          />
        </Field>
        <Field label={m.extraWorkdaysLabel} htmlFor="holiday-calendar-extra-workdays" hint={m.extraWorkdaysHint}>
          <textarea
            id="holiday-calendar-extra-workdays"
            rows={2}
            className="tabular-nums"
            placeholder={m.datesPlaceholder}
            value={form.extraWorkdaysText}
            onChange={(e) => setForm((prev) => ({ ...prev, extraWorkdaysText: e.target.value }))}
          />
        </Field>

        {feedback ? (
          <Notice tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>
            {feedback.text}
          </Notice>
        ) : null}
        <div className="btn-row">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? m.submitting : m.submit}
          </Button>
        </div>
      </form>

      {data.history.length > 0 ? (
        <>
          <h3 className="attendance-settings__form-title">{m.historyTitle}</h3>
          <div className="org-settings__table-wrap">
            <table className="org-table">
              <thead>
                <tr>
                  <th>{m.historyColumnEffectiveFrom}</th>
                  <th>{m.historyColumnSummary}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.history].reverse().map((v) => (
                  <tr key={v.effectiveFrom}>
                    <td className="tabular-nums">{formatEffectiveFrom(v.effectiveFrom)}</td>
                    <td>{summarizeCalendar(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
