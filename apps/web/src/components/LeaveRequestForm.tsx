"use client";

import { useState } from "react";
import { api, ApiError, UnauthorizedError, type LeaveType, type LeaveUnit, type LeaveCapabilitiesDto } from "../lib/api";
import { mapLeaveRequestErrorMessage, messages } from "../lib/messages";

const MAX_REASON_LENGTH = 500;
const HOURLY_LEAVE_MAX_DAYS_DEFAULT = 5;

/**
 * packages/leave/src/hourly.ts の ceilToHourMinutes/hourlyLeaveCapMinutes を最小限だけ再実装する
 * (apps/web は packages/* への依存を追加しない既存方針、lib/permissions.ts のコメントと同じ判断)。
 * 根拠: 労働基準法39条4項・平21.5.29基発0529001号。1日分は所定労働時間を1時間単位に
 * 切り上げ、上限日数を掛けたものが年度の時間単位年休の上限(分)になる。
 */
function hourlyLeaveCapMinutes(standardDayMinutes: number, hourlyLeaveMaxDays: number): number {
  const ceiledDay = Math.ceil(standardDayMinutes / 60) * 60;
  return ceiledDay * hourlyLeaveMaxDays;
}

export interface LeaveRequestFormProps {
  standardDayMinutes: number;
  /**
   * GET /settings/leave の結果。leave.grant.manage が無いユーザーは 403 になり取得できないため
   * null になりうる(独自判断点)。その場合は API 既定値(hourlyLeaveEnabled=false,
   * halfDayLeaveEnabled=true, hourlyLeaveMaxDays=5)相当にフォールバックし、実際の許可判定は
   * 常にサーバー側(hourly_leave_disabled 等のエラー)に委ねる。
   */
  settings: LeaveCapabilitiesDto | null;
  /** 当年度の時間単位年休の消化済み分(概算。複数の年次付与が跨る場合は概算になる)。 */
  hourlyUsedMinutes: number;
  onSubmitted: (result: { requestId: string; targetMonthClosed: boolean }) => void;
  onUnauthorized: () => void;
}

export function LeaveRequestForm({ standardDayMinutes, settings, hourlyUsedMinutes, onSubmitted, onUnauthorized }: LeaveRequestFormProps) {
  const halfDayEnabled = settings?.halfDayLeaveEnabled ?? true;
  const hourlyEnabled = settings?.hourlyLeaveEnabled ?? false;
  const hourlyLeaveMaxDays = settings?.hourlyLeaveMaxDays ?? HOURLY_LEAVE_MAX_DAYS_DEFAULT;
  const hourlyCapMinutes = hourlyLeaveCapMinutes(standardDayMinutes, hourlyLeaveMaxDays);

  const [leaveDate, setLeaveDate] = useState("");
  const [unit, setUnit] = useState<LeaveUnit>("full_day");
  const [minutes, setMinutes] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const unitOptions: { value: LeaveUnit; label: string }[] = [
    { value: "full_day", label: messages.leave.unitFullDay },
    ...(halfDayEnabled
      ? ([
          { value: "half_day_am", label: messages.leave.unitHalfDayAm },
          { value: "half_day_pm", label: messages.leave.unitHalfDayPm },
        ] as const)
      : []),
    ...(hourlyEnabled ? ([{ value: "hourly", label: messages.leave.unitHourly }] as const) : []),
  ];

  function handleUnitChange(next: LeaveUnit) {
    setUnit(next);
    setFormError(null);
    if (next !== "hourly") setMinutes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!leaveDate) {
      setFormError(messages.leave.errors.invalid_leave_date);
      return;
    }
    if (reason.length < 1 || reason.length > MAX_REASON_LENGTH) {
      setFormError(messages.leave.errors.invalid_reason);
      return;
    }
    let parsedMinutes: number | undefined;
    if (unit === "hourly") {
      parsedMinutes = Number(minutes);
      if (!Number.isInteger(parsedMinutes) || parsedMinutes <= 0) {
        setFormError(messages.leave.errors.invalid_minutes);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await api.createLeaveRequest({
        leaveDate,
        unit,
        ...(parsedMinutes !== undefined ? { minutes: parsedMinutes } : {}),
        leaveType,
        reason,
      });
      setLeaveDate("");
      setUnit("full_day");
      setMinutes("");
      setLeaveType("annual");
      setReason("");
      onSubmitted({ requestId: res.request.id, targetMonthClosed: res.targetMonthClosed });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setFormError(err instanceof ApiError ? mapLeaveRequestErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="leave-request-form" onSubmit={handleSubmit}>
      <div className="correction-field">
        <label htmlFor="leave-date">{messages.leave.dateLabel}</label>
        <input id="leave-date" type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} required />
      </div>

      <div className="correction-field">
        <span>{messages.leave.unitLabel}</span>
        <div className="leave-unit-group" role="radiogroup" aria-label={messages.leave.unitLabel}>
          {unitOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={unit === opt.value}
              className={`leave-unit-btn${unit === opt.value ? " leave-unit-btn--active" : ""}`}
              onClick={() => handleUnitChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {unit === "hourly" ? (
        <div className="correction-field">
          <label htmlFor="leave-minutes">{messages.leave.minutesLabel}</label>
          <input
            id="leave-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={messages.leave.minutesPlaceholder}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            required
          />
          <p className="leave-hourly-hint tabular-nums">
            {messages.leave.hourlyQuotaPrefix}
            {Math.floor(hourlyUsedMinutes / 60)}時間{messages.leave.hourlyQuotaSeparator}
            {Math.floor(hourlyCapMinutes / 60)}時間{messages.leave.hourlyQuotaSuffix}
          </p>
        </div>
      ) : null}

      <div className="correction-field">
        <label htmlFor="leave-type">{messages.leave.leaveTypeLabel}</label>
        <select id="leave-type" value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
          <option value="annual">{messages.leave.leaveTypeAnnual}</option>
          <option value="stocked">{messages.leave.leaveTypeStocked}</option>
        </select>
      </div>

      <div className="correction-field">
        <label htmlFor="leave-reason">{messages.leave.reasonLabel}</label>
        <textarea
          id="leave-reason"
          value={reason}
          maxLength={MAX_REASON_LENGTH}
          placeholder={messages.leave.reasonPlaceholder}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        <span className="correction-field__counter tabular-nums">
          {reason.length}/{MAX_REASON_LENGTH}
        </span>
      </div>

      {formError ? (
        <p className="correction-error" role="alert">
          {formError}
        </p>
      ) : null}

      <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={submitting}>
        {submitting ? messages.leave.submitting : messages.leave.submit}
      </button>
    </form>
  );
}
