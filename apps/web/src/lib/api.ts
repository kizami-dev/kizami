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

export type CorrectionStatus = "pending" | "approved" | "rejected" | "withdrawn";

/**
 * 打刻修正申請(v0.2)。target系/proposed系の組み合わせで3ケースを表す
 * (apps/api/src/routes/corrections.ts のコメント参照):
 * - targetEventId === null かつ proposedKind/proposedOccurredAt あり → 追加
 * - targetEventId あり かつ proposedKind/proposedOccurredAt あり → 訂正
 * - targetEventId のみ → 取消
 */
export interface CorrectionRequestDto {
  id: string;
  userId: string;
  requestedBy: string;
  status: CorrectionStatus;
  targetEventId: string | null;
  /** 対象打刻のスナップショット。承認で supersede された後も表示できるようAPIが同梱する */
  targetPunch: { kind: PunchKind; occurredAt: number } | null;
  proposedKind: PunchKind | null;
  proposedOccurredAt: number | null;
  reason: string;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  createdAt: number;
}

export interface CreateCorrectionInput {
  targetEventId?: string;
  proposedKind?: PunchKind;
  /** UTC エポック分 */
  proposedOccurredAt?: number;
  reason: string;
}

/** アプリ内通知(v0.2 第二弾)。apps/api/src/routes/notifications.ts の serializeNotification と一致。 */
export interface NotificationDto {
  id: string;
  type: string;
  subjectDate: string | null;
  title: string;
  body: string;
  /** UTC エポック分 */
  createdAt: number;
  /** UTC エポック分。未読なら null */
  readAt: number | null;
}

/**
 * テナント単位の通知チャネル設定(apps/api/src/routes/settings.ts の serialize と一致)。
 * webhookUrl と smtpPassword は秘密情報のためマスクして返る(configured/preview, smtpPasswordSet のみ)。
 */
export interface NotificationSettingsDto {
  webhookEnabled: boolean;
  webhookUrl: { configured: boolean; preview: string | null };
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  smtpPasswordSet: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

/**
 * PUT /settings/notifications の入力(3値ルール、apps/api/src/routes/settings.ts 参照):
 * フィールド省略=既存値維持、null/""=クリア、それ以外の文字列=置換。
 * webhookUrl/smtpPassword はマスクされて返ってくるため、Web側は「空欄なら省略(維持)・
 * 入力があれば新しい値として送る」という規約でこの3値ルールの一部だけを使う
 * (このUIからは明示的なクリア操作は提供しない。実装Bのコメント参照)。
 */
export interface UpdateNotificationSettingsInput {
  webhookEnabled: boolean;
  webhookUrl?: string;
  smtpEnabled: boolean;
  smtpHost?: string;
  smtpPort?: number | null;
  smtpUser?: string;
  smtpFrom?: string;
  smtpPassword?: string;
}

export interface NotificationTestResult {
  channel: string;
  ok: boolean;
  error?: string;
}

/** 権限のスコープ(狭い→広い: self < department < department_and_descendants < tenant)。packages/authz/src/types.ts と一致。 */
export type Scope = "self" | "department" | "department_and_descendants" | "tenant";

/** 部署(apps/api/src/routes/departments.ts の serialize と一致)。 */
export interface DepartmentDto {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface CreateDepartmentInput {
  name: string;
  parentId?: string;
}

/** name/parentId は省略時「変更しない」。parentId: null はトップレベル化。 */
export interface UpdateDepartmentInput {
  name?: string;
  parentId?: string | null;
}

/** メンバー(apps/api/src/routes/members.ts の GET / のレスポンス要素と一致)。 */
export interface MemberDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  department: { id: string; name: string } | null;
  presetNames: string[];
}

export interface PermissionGrantDto {
  key: string;
  scope: Scope;
}

/** 権限プリセット(apps/api/src/routes/presets.ts の serializePreset と一致)。 */
export interface PermissionPresetDto {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  grants: PermissionGrantDto[];
}

/** GET /presets/catalog(packages/authz/src/catalog.ts の PERMISSION_CATALOG そのまま)。 */
export interface PermissionCatalogEntryDto {
  key: string;
  labelJa: string;
  descriptionJa: string;
  scopes: Scope[];
  dangerous: boolean;
  impliesView: string[];
}

export interface CreatePresetInput {
  name: string;
  description?: string | null;
  grants: PermissionGrantDto[];
}

export interface UpdatePresetInput {
  name?: string;
  description?: string | null;
  grants?: PermissionGrantDto[];
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

  async listCorrections(status: "pending" | "all" = "all"): Promise<{ requests: CorrectionRequestDto[] }> {
    return request(`/corrections?status=${status}`);
  },

  async createCorrection(input: CreateCorrectionInput): Promise<{ request: CorrectionRequestDto }> {
    return request("/corrections", { method: "POST", body: JSON.stringify(input) });
  },

  async approveCorrection(
    id: string,
    note?: string,
  ): Promise<{ request: CorrectionRequestDto; appliedEvent: { id: string; kind: PunchKind; occurredAt: number } }> {
    return request(`/corrections/${id}/approve`, { method: "POST", body: JSON.stringify(note ? { note } : {}) });
  },

  async rejectCorrection(id: string, note?: string): Promise<{ request: CorrectionRequestDto }> {
    return request(`/corrections/${id}/reject`, { method: "POST", body: JSON.stringify(note ? { note } : {}) });
  },

  async withdrawCorrection(id: string): Promise<{ request: CorrectionRequestDto }> {
    return request(`/corrections/${id}/withdraw`, { method: "POST" });
  },

  async unreadNotificationCount(): Promise<{ count: number }> {
    return request("/notifications/unread-count");
  },

  async listNotifications(unreadOnly?: boolean): Promise<{ notifications: NotificationDto[] }> {
    const query = unreadOnly !== undefined ? `?unreadOnly=${unreadOnly}` : "";
    return request(`/notifications${query}`);
  },

  async markNotificationRead(id: string): Promise<{ notification: NotificationDto }> {
    return request(`/notifications/${id}/read`, { method: "POST" });
  },

  async getNotificationSettings(): Promise<NotificationSettingsDto> {
    return request("/settings/notifications");
  },

  async updateNotificationSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettingsDto> {
    return request("/settings/notifications", { method: "PUT", body: JSON.stringify(input) });
  },

  async testNotificationSettings(): Promise<{ results: NotificationTestResult[] }> {
    return request("/settings/notifications/test", { method: "POST" });
  },

  async listDepartments(): Promise<{ departments: DepartmentDto[] }> {
    return request("/departments");
  },

  async createDepartment(input: CreateDepartmentInput): Promise<{ department: DepartmentDto }> {
    return request("/departments", { method: "POST", body: JSON.stringify(input) });
  },

  async updateDepartment(id: string, input: UpdateDepartmentInput): Promise<{ department: DepartmentDto }> {
    return request(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  },

  async deleteDepartment(id: string): Promise<{ ok: true }> {
    return request(`/departments/${id}`, { method: "DELETE" });
  },

  async listMembers(): Promise<{ members: MemberDto[] }> {
    return request("/members");
  },

  async updateMemberDepartment(id: string, departmentId: string): Promise<{ member: { id: string; departmentId: string } }> {
    return request(`/members/${id}`, { method: "PATCH", body: JSON.stringify({ departmentId }) });
  },

  async assignMemberPresets(id: string, presetIds: string[]): Promise<{ presetIds: string[] }> {
    return request(`/members/${id}/presets`, { method: "PUT", body: JSON.stringify({ presetIds }) });
  },

  async listPresets(): Promise<{ presets: PermissionPresetDto[] }> {
    return request("/presets");
  },

  async getPresetCatalog(): Promise<{ catalog: PermissionCatalogEntryDto[] }> {
    return request("/presets/catalog");
  },

  async createPreset(input: CreatePresetInput): Promise<{ preset: PermissionPresetDto }> {
    return request("/presets", { method: "POST", body: JSON.stringify(input) });
  },

  async updatePreset(id: string, input: UpdatePresetInput): Promise<{ preset: PermissionPresetDto }> {
    return request(`/presets/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  },

  async deletePreset(id: string): Promise<{ ok: true }> {
    return request(`/presets/${id}`, { method: "DELETE" });
  },
};
