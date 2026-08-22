/**
 * KIZAMI 公開打刻API(docs/external-api/index.md)のレスポンス型。
 *
 * apps/mcp は独立したパッケージとして HTTP 経由でのみ KIZAMI と話すため(依頼の設計方針1)、
 * @kizami/engine や @kizami/leave の内部型を import せず、公開APIのJSON契約をここに
 * 独自定義する。内部実装(packages/*)が変わっても、公開APIの形が変わらない限り
 * この型定義は影響を受けない。
 */

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

/** 打刻の勤務状態。GET /attendance/status のトレースロジック(apps/api/src/routes/attendance.ts)と対応。 */
export type AttendanceState = "out" | "working" | "onBreak";

export interface PunchDto {
  id: string;
  kind: string;
  /** UTC エポック分 */
  occurredAt: number;
}

export interface StatusDto {
  state: AttendanceState;
  lastPunch: { kind: PunchKind; occurredAt: number } | null;
}

export interface CategorizedMinutesDto {
  statutory: number;
  overtime: number;
  overtime60h: number;
  lateNight: number;
  statutoryHoliday: number;
}

export interface FlexBalanceDto {
  frameMinutes: number;
  actualMinutes: number;
  diffMinutes: number;
}

export interface CalcWarningDto {
  kind: string;
  date: string;
  punchAt?: number;
}

export interface DailyBreakdownDto {
  date: string;
  workedMinutes: number;
  breakMinutes: number;
  lateNightMinutes: number;
  isLegalHoliday: boolean;
  legalHolidayMinutes: number;
  isPaidLeave: boolean;
  paidLeaveMinutes: number;
}

export interface MonthlySummaryDto {
  days: DailyBreakdownDto[];
  totals: CategorizedMinutesDto;
  flexBalance: FlexBalanceDto;
  warnings: CalcWarningDto[];
  closed: boolean;
  amended: boolean;
  originalTotals?: CategorizedMinutesDto;
  originalFlexBalance?: FlexBalanceDto;
}

export interface LeaveTypeSummaryDto {
  totalGrantedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
}

export interface MandatoryFiveDaysStatusDto {
  grantId: string;
  periodStart: string;
  periodEnd: string;
  taken: number;
  required: number;
  shortage: number;
  deadline: string;
  satisfied: boolean;
}

export interface LeaveBalanceDto {
  standardDayMinutes: number;
  annual: LeaveTypeSummaryDto;
  stocked: LeaveTypeSummaryDto;
  mandatoryFiveDays: MandatoryFiveDaysStatusDto[];
}

export type CorrectionStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface CorrectionRequestDto {
  id: string;
  status: CorrectionStatus;
  targetEventId: string | null;
  targetPunch: { kind: string; occurredAt: number } | null;
  proposedKind: string | null;
  proposedOccurredAt: number | null;
  reason: string;
  decidedAt: number | null;
  decisionNote: string | null;
  createdAt: number;
}
