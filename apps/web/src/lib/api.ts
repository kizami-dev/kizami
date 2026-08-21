/**
 * apps/api への薄い fetch クライアント。
 *
 * - すべて `credentials: "include"` でセッション Cookie を送る
 * - ベース URL は `WAKU_PUBLIC_API_URL`(未設定時は localhost:3001。apps/api の既定ポートと一致)
 * - 401 は `UnauthorizedError` として投げる。呼び出し側(useAuthGuard 等)が /login への誘導に使う
 */

const BASE_URL: string = import.meta.env.WAKU_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`api request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(body: unknown) {
    super(401, body);
    this.name = "UnauthorizedError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw new ApiError(0, { error: "network_error", cause });
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // レスポンスボディが無い/JSON でない場合は無視する
    }
    if (res.status === 401) {
      throw new UnauthorizedError(body);
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  tenantId?: string;
}

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";
export type AttendanceState = "out" | "working" | "onBreak";

export interface Punch {
  id: string;
  kind: PunchKind;
  /** UTC エポック分 */
  occurredAt: number;
}

export interface AttendanceStatus {
  state: AttendanceState;
  lastPunch: { kind: PunchKind; occurredAt: number } | null;
}

export type TimeCategory = "statutory" | "overtime" | "overtime60h" | "lateNight" | "statutoryHoliday";
export type CategorizedMinutes = Record<TimeCategory, number>;

export type WarningKind =
  | "missing_clock_out"
  | "duplicate_clock_in"
  | "clock_out_without_in"
  | "break_outside_work"
  | "duplicate_break_start"
  | "unmatched_break_end"
  | "clock_out_during_break";

export interface CalcWarning {
  kind: WarningKind;
  date: string;
  punchAt?: number;
}

export interface DailyBreakdown {
  date: string;
  workedMinutes: number;
  breakMinutes: number;
  lateNightMinutes: number;
  isLegalHoliday: boolean;
  legalHolidayMinutes: number;
  isPaidLeave: boolean;
}

export interface FlexBalance {
  frameMinutes: number;
  actualMinutes: number;
  diffMinutes: number;
}

export interface MonthlyAttendance {
  days: DailyBreakdown[];
  totals: CategorizedMinutes;
  flexBalance: FlexBalance;
  warnings: CalcWarning[];
}

export const api = {
  async login(email: string, password: string): Promise<{ user: AuthUser }> {
    return request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  },

  async logout(): Promise<void> {
    await request<void>("/auth/logout", { method: "POST" });
  },

  async me(): Promise<{ user: AuthUser }> {
    return request("/me");
  },

  async punch(kind: PunchKind): Promise<{ punch: Punch }> {
    return request("/punches", { method: "POST", body: JSON.stringify({ kind }) });
  },

  /** from/to は UTC エポック分(inclusive)。 */
  async listPunches(from: number, to: number): Promise<{ punches: Punch[] }> {
    return request(`/punches?from=${from}&to=${to}`);
  },

  async status(): Promise<AttendanceStatus> {
    return request("/attendance/status");
  },

  /** month は "YYYY-MM"。 */
  async monthly(month: string): Promise<MonthlyAttendance> {
    return request(`/attendance/monthly?month=${encodeURIComponent(month)}`);
  },
};
