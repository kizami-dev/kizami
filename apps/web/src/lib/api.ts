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
  /** 締め済みかどうか(apps/api/src/routes/attendance.ts の GET /attendance/monthly、v0.3 追加)。 */
  closed: boolean;
  /** 締め後修正(amend)が入っているか。true の場合のみ originalTotals/originalFlexBalance が入る。 */
  amended: boolean;
  /** 当初(最初の締め)の確定値。amended のときのみ存在する。 */
  originalTotals?: CategorizedMinutes;
  originalFlexBalance?: FlexBalance;
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

/**
 * 個人の通知受け取り設定(2026-08-22 追加、docs/requirements.md §7「通知設定の2層構造」)。
 * apps/api/src/routes/notification-preferences.ts の serialize と一致させる。
 * 上の NotificationSettingsDto(テナント共有のチャネル接続情報)とは別物 — 混同しないこと。
 */
export type PersonalNotificationCategory = "missing_clock_out" | "overtime_alert" | "leave_alert";

export interface PersonalNotificationCategoryPrefsDto {
  /** 常時 true(アプリ内通知はOFFにできない)。 */
  inapp: true;
  email: boolean;
  webhook: boolean;
}

export interface PersonalNotificationSettingsDto {
  categories: Record<PersonalNotificationCategory, PersonalNotificationCategoryPrefsDto>;
  /** value=個人設定の入力値(未入力なら null)。effective=実際に使われる宛先(未入力ならアカウントの email)。 */
  emailAddress: { value: string | null; effective: string };
  /** 秘密情報のためマスクして返る(configured/preview のみ、全文は返らない)。 */
  webhookUrl: { configured: boolean; preview: string | null };
  updatedAt: number | null;
}

/**
 * PUT /settings/notifications/me の入力。categories は省略したカテゴリ・省略したフィールド
 * (email/webhook)を維持する部分更新。emailAddress/webhookUrl は3値ルール
 * (省略=維持、空文字=クリア、文字列=置換)— このUIからは空文字での明示的なクリアも提供する。
 */
export interface UpdatePersonalNotificationSettingsInput {
  categories: Partial<Record<PersonalNotificationCategory, { email?: boolean; webhook?: boolean }>>;
  emailAddress?: string;
  webhookUrl?: string;
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
  /** 入社日 "YYYY-MM-DD"。null = 未設定(法定付与の自動計算ができない)。 */
  hireDate: string | null;
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

/** 締め状態のイベント種別。close(締め)/reopen(解除)/amend(締め後修正の反映)。packages/db の ClosingEventKind と一致。 */
export type ClosingEventKind = "close" | "reopen" | "amend";

/** 月次締めの1イベント(apps/api/src/routes/closings.ts の serializeEvent と一致、v0.3)。 */
export interface ClosingEventDto {
  id: string;
  event: ClosingEventKind;
  actorId: string;
  note: string | null;
  /** event="amend" のとき、由来となった打刻修正申請ID(いずれか一方のみ非null)。 */
  correctionRequestId: string | null;
  /** event="amend" のとき、由来となった休暇申請ID(いずれか一方のみ非null)。 */
  leaveRequestId: string | null;
  /** UTC エポック分 */
  occurredAt: number;
}

/** 月次締めの現在状態(apps/api/src/routes/closings.ts の serializeState と一致、v0.3)。 */
export interface ClosingStateDto {
  period: string;
  status: "open" | "closed";
  lastEvent: ClosingEventDto | null;
  /** occurred_at 昇順(古い順) */
  history: ClosingEventDto[];
}

/**
 * テナントの法令プロファイル(apps/api/src/routes/settings.ts の GET/PUT /settings/tenant-profile と一致)。
 * この3値は集計(週法定労働時間・60時間超区分・36協定の各閾値)に直接影響する。
 */
export interface TenantLawProfileDto {
  isSmallOrMediumEnterprise: boolean;
  isSpecialProvisionWorkplace: boolean;
  specialClauseEnabled: boolean;
}

/** LegalHolidayRule(packages/engine の型、apps/web は依存を増やさずここに再定義)。 */
export type LegalHolidayRuleDto = { kind: "weekday"; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 } | { kind: "dates"; dates: string[] };

/**
 * テナント設定の版(apps/api/src/routes/settings.ts の GET/POST /settings/attendance と一致)。
 * effective-dated(原則6): 編集は「新しい版を追加」のみで、既存の版は変更されない。
 */
export interface AttendanceSettingVersionDto {
  effectiveFrom: string;
  dayBoundaryMinutes: number;
  legalHolidayRule: LegalHolidayRuleDto;
  breakRule: { mode: "punch" };
  gpsEnabled: boolean;
  gpsRetentionDays: number | null;
  createdAt: number;
}

/** GET /settings/attendance のレスポンス。 */
export interface AttendanceSettingsDto {
  effective: AttendanceSettingVersionDto | null;
  history: AttendanceSettingVersionDto[];
}

/** POST /settings/attendance の入力。新しい版を1件追加する(UPDATE ではない)。 */
export interface CreateAttendanceSettingVersionInput {
  effectiveFrom: string;
  dayBoundaryMinutes: number;
  legalHolidayRule: LegalHolidayRuleDto;
  breakRule: { mode: "punch" };
  gpsEnabled: boolean;
  gpsRetentionDays: number | null;
}

/** work_policy_versions(フレックス設定)の版(apps/api/src/routes/settings.ts の GET/POST /settings/work-policy と一致)。 */
export interface WorkPolicyVersionDto {
  effectiveFrom: string;
  settlementPeriod: string;
  standardDayMinutes: number;
  createdAt: number;
}

export interface WorkPolicySettingsDto {
  effective: WorkPolicyVersionDto | null;
  history: WorkPolicyVersionDto[];
}

export interface CreateWorkPolicyVersionInput {
  effectiveFrom: string;
  settlementPeriod: string;
  standardDayMinutes: number;
}

/** GET/PUT /settings/privacy-contact(保存期間の説明文・開示請求窓口)。 */
export interface PrivacyContactDto {
  recordRetentionDescription: string | null;
  privacyContactPoint: string | null;
}

/**
 * 有給休暇(v0.3、docs/requirements.md §5)。apps/api/src/routes/leave.ts の
 * serializeLeaveRequest/serializeLeaveGrant・GET /leave/balance・GET/PUT /settings/leave と
 * 一致させる。判断点: packages/leave の型は再利用せず(apps/web は packages/* への依存を
 * 追加しない既存方針、lib/permissions.ts のコメント参照)、DTO をここに再定義する。
 */
export type LeaveUnit = "full_day" | "half_day_am" | "half_day_pm" | "hourly";

/** annual: 通常の年次有給。stocked: 失効年休の積立休暇。 */
export type LeaveType = "annual" | "stocked";

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

/** 1件の付与について、消化・残高を分単位で表した状態(GET /leave/balance の byGrant/expiringSoon 要素)。 */
export interface LeaveGrantAllocationDto {
  id: string;
  leaveType: LeaveType;
  grantedOn: string;
  days: number;
  grantedMinutes: number;
  expiresOn: string;
  usedMinutes: number;
  /** unit='hourly' の消化のみの累計(年5日分上限の判定用参考値)。 */
  hourlyUsedMinutes: number;
  remainingMinutes: number;
  expired: boolean;
}

export interface LeaveTypeSummaryDto {
  totalGrantedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  expiringSoon: LeaveGrantAllocationDto[];
  byGrant: LeaveGrantAllocationDto[];
}

/** 年5日取得義務の状況(1付与=1期間)。taken/required/shortage は 0.5 日刻み。 */
export interface MandatoryFiveDaysStatusDto {
  grantId: string;
  periodStart: string;
  /** 排他的上限(この日を含まない)。 */
  periodEnd: string;
  taken: number;
  required: number;
  shortage: number;
  /** = periodEnd。この日の前日までに義務を満たす必要がある。 */
  deadline: string;
  satisfied: boolean;
}

export interface LeaveBalanceDto {
  standardDayMinutes: number;
  annual: LeaveTypeSummaryDto;
  stocked: LeaveTypeSummaryDto;
  mandatoryFiveDays: MandatoryFiveDaysStatusDto[];
}

export interface LeaveRequestDto {
  id: string;
  userId: string;
  requestedBy: string;
  status: LeaveRequestStatus;
  leaveDate: string;
  unit: LeaveUnit;
  minutes: number | null;
  leaveType: LeaveType;
  reason: string;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  createdAt: number;
}

/** unit を省略すると full_day、leaveType を省略すると annual(apps/api の既定値と一致)。 */
export interface CreateLeaveRequestInput {
  leaveDate: string;
  unit?: LeaveUnit;
  minutes?: number;
  leaveType?: LeaveType;
  reason: string;
}

export interface LeaveGrantDto {
  id: string;
  userId: string;
  leaveType: LeaveType;
  grantedOn: string;
  days: number;
  expiresOn: string;
  source: "auto" | "manual" | "conversion";
  convertedFromGrantId: string | null;
  note: string | null;
  createdAt: number;
}

/** テナントの有給付与方式。statutory=法定(入社日基準)、fixed_date=基準日方式(全社一斉)。 */
export type LeaveGrantMethod = "statutory" | "fixed_date";

export interface TenantLeaveSettingsDto {
  grantMethod: LeaveGrantMethod;
  fixedDateMmDd: string | null;
  hourlyLeaveEnabled: boolean;
  hourlyLeaveMaxDays: number;
  halfDayLeaveEnabled: boolean;
  stockConversionEnabled: boolean;
  stockMaxDays: number;
  stockExpiresMonths: number | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

/** 自分が休暇申請するときに必要な情報だけ(GET /leave/capabilities)。秘密情報を含まない。 */
export interface LeaveCapabilitiesDto {
  hourlyLeaveEnabled: boolean;
  hourlyLeaveMaxDays: number;
  halfDayLeaveEnabled: boolean;
  stockConversionEnabled: boolean;
  standardDayMinutes: number;
}

export interface UpdateLeaveSettingsInput {
  grantMethod: LeaveGrantMethod;
  fixedDateMmDd?: string | null;
  hourlyLeaveEnabled: boolean;
  hourlyLeaveMaxDays: number;
  halfDayLeaveEnabled: boolean;
  stockConversionEnabled: boolean;
  stockMaxDays: number;
  stockExpiresMonths?: number | null;
}

export interface CreateLeaveGrantInput {
  userId: string;
  grantedOn: string;
  days: number;
  expiresOn?: string;
  leaveType?: LeaveType;
  note?: string;
}

/** 失効した年次有給1件について、積立休暇への振替結果を表す(POST /leave/grants/convert-expired)。 */
/** GET /help/overrides のレスポンス(認証のみ、権限不要)。 */
export interface HelpOverridesDto {
  overrides: Record<string, { bodyMd: string; updatedAt: number }>;
  workRulesUrl: string | null;
}

/**
 * GET /settings/privacy-templates(notification.settings.manage、社内規定編集と同じ権限)のレスポンス。
 * generatedFrom は「どの設定値から生成したか」を担当者が確認できるように、実際に使った入力を返す。
 */
export interface PrivacyTemplatesDto {
  privacyNotice: string;
  internalTerms: string;
  generatedFrom: {
    tenantName: string;
    gpsEnabled: boolean;
    gpsRetentionDays: number | null;
    recordRetentionDescription: string;
    workRulesUrl: string | null;
    contactPoint: string | null;
  };
}

export interface StockConversionCandidateDto {
  sourceGrantId: string;
  leftoverMinutes: number;
  leftoverDays: number;
  convertedDays: number;
  truncatedDays: number;
}

/**
 * 公開打刻APIキー(v0.4)のスコープ。apps/api/src/auth/api-key-scopes.ts の ApiKeyScope と一致させる。
 * punch: 自分の打刻の作成・参照。read: 自分の勤怠の参照のみ。
 */
export type ApiKeyScope = "punch" | "read";

/**
 * APIキー一覧・単体の DTO(apps/api/src/routes/api-keys.ts の serialize と一致)。
 * 平文トークンも key_hash も含まない(発行直後のレスポンスのみ token を別途持つ、IssuedApiKeyDto 参照)。
 */
export interface ApiKeyDto {
  id: string;
  userId: string;
  name: string;
  scopes: ApiKeyScope[];
  /** UTC エポック分。null = 無期限 */
  expiresAt: number | null;
  /** UTC エポック分。未使用なら null */
  lastUsedAt: number | null;
  /** UTC エポック分。null = 有効 */
  revokedAt: number | null;
  createdBy: string;
  createdAt: number;
}

/** POST /api-keys のレスポンスのみ、平文トークンを含む(この後は二度と取得できない)。 */
export interface IssuedApiKeyDto extends ApiKeyDto {
  token: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  /** UTC エポック分。省略/null = 無期限 */
  expiresAt?: number | null;
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

  /** GET /settings/notifications/me(認証のみ、権限不要 — 自分の設定は誰でも読める)。 */
  async getPersonalNotificationSettings(): Promise<PersonalNotificationSettingsDto> {
    return request("/settings/notifications/me");
  },

  /** PUT /settings/notifications/me(認証のみ、権限不要)。 */
  async updatePersonalNotificationSettings(
    input: UpdatePersonalNotificationSettingsInput,
  ): Promise<PersonalNotificationSettingsDto> {
    return request("/settings/notifications/me", { method: "PUT", body: JSON.stringify(input) });
  },

  /** POST /settings/notifications/me/test(個人 Webhook のみが対象。未設定なら 400 not_configured)。 */
  async testPersonalWebhook(): Promise<{ result: NotificationTestResult | null }> {
    return request("/settings/notifications/me/test", { method: "POST" });
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

  /** PATCH /members/:id { hireDate }(member.profile.edit)。null で未設定に戻せる。 */
  async updateMemberHireDate(id: string, hireDate: string | null): Promise<{ member: { id: string; hireDate: string | null } }> {
    return request(`/members/${id}`, { method: "PATCH", body: JSON.stringify({ hireDate }) });
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

  /** period は "YYYY-MM"。GET /closings/:period(closing.view、最低 department スコープ)。 */
  async getClosingState(period: string): Promise<{ closing: ClosingStateDto }> {
    return request(`/closings/${encodeURIComponent(period)}`);
  },

  /** POST /closings/:period/close(closing.execute)。note は任意(500文字以内)。 */
  async closeMonth(period: string, note?: string): Promise<{ closing: ClosingStateDto }> {
    return request(`/closings/${encodeURIComponent(period)}/close`, {
      method: "POST",
      body: JSON.stringify(note ? { note } : {}),
    });
  },

  /** POST /closings/:period/reopen(closing.unlock)。note は任意(500文字以内)。 */
  async reopenMonth(period: string, note?: string): Promise<{ closing: ClosingStateDto }> {
    return request(`/closings/${encodeURIComponent(period)}/reopen`, {
      method: "POST",
      body: JSON.stringify(note ? { note } : {}),
    });
  },

  /** GET /settings/tenant-profile(alert.labor_limit.configure、tenant スコープ)。 */
  async getTenantProfile(): Promise<TenantLawProfileDto> {
    return request("/settings/tenant-profile");
  },

  /** PUT /settings/tenant-profile。3値とも必須(省略時維持ルールは無い、apps/api 側の契約どおり)。 */
  async updateTenantProfile(input: TenantLawProfileDto): Promise<TenantLawProfileDto> {
    return request("/settings/tenant-profile", { method: "PUT", body: JSON.stringify(input) });
  },

  /** GET /leave/balance。userId 省略時は本人。他者指定は leave.balance.view(department 以上)が必要。 */
  async getLeaveBalance(userId?: string): Promise<LeaveBalanceDto> {
    return request(`/leave/balance${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);
  },

  async listLeaveRequests(status: "pending" | "all" = "all"): Promise<{ requests: LeaveRequestDto[] }> {
    return request(`/leave/requests?status=${status}`);
  },

  /** POST /leave/requests。targetMonthClosed=true の場合、対象月は締め済み(承認には closing.unlock が必要)。 */
  async createLeaveRequest(input: CreateLeaveRequestInput): Promise<{ request: LeaveRequestDto; targetMonthClosed: boolean }> {
    return request("/leave/requests", { method: "POST", body: JSON.stringify(input) });
  },

  /** POST /leave/requests/:id/approve。amended=true の場合、締め済み月への反映(amend)が行われた。 */
  async approveLeaveRequest(id: string, note?: string): Promise<{ request: LeaveRequestDto; amended: boolean }> {
    return request(`/leave/requests/${id}/approve`, { method: "POST", body: JSON.stringify(note ? { note } : {}) });
  },

  async rejectLeaveRequest(id: string, note?: string): Promise<{ request: LeaveRequestDto }> {
    return request(`/leave/requests/${id}/reject`, { method: "POST", body: JSON.stringify(note ? { note } : {}) });
  },

  async withdrawLeaveRequest(id: string): Promise<{ request: LeaveRequestDto }> {
    return request(`/leave/requests/${id}/withdraw`, { method: "POST" });
  },

  /**
   * GET /leave/capabilities(認証のみ)。自分が申請するときに必要な情報。
   * テナント設定(/settings/leave)は管理権限が要り一般の従業員は読めないため、
   * 申請フォームの選択肢はこちらを使う。
   */
  async getLeaveCapabilities(): Promise<LeaveCapabilitiesDto> {
    return request("/leave/capabilities");
  },

  /** GET /settings/leave(leave.grant.manage、tenant スコープ)。 */
  async getLeaveSettings(): Promise<TenantLeaveSettingsDto> {
    return request("/settings/leave");
  },

  async updateLeaveSettings(input: UpdateLeaveSettingsInput): Promise<TenantLeaveSettingsDto> {
    return request("/settings/leave", { method: "PUT", body: JSON.stringify(input) });
  },

  /** POST /leave/grants(手動付与、leave.grant.manage)。 */
  async createLeaveGrant(input: CreateLeaveGrantInput): Promise<{ grant: LeaveGrantDto }> {
    return request("/leave/grants", { method: "POST", body: JSON.stringify(input) });
  },

  /** POST /leave/grants/auto(法定付与の冪等実行、leave.grant.manage)。 */
  async autoGrantLeave(userId: string): Promise<{ created: LeaveGrantDto[]; skipped: number }> {
    return request("/leave/grants/auto", { method: "POST", body: JSON.stringify({ userId }) });
  },

  /** POST /leave/grants/convert-expired(失効年休の積立振替、leave.grant.manage)。 */
  async convertExpiredLeave(userId: string): Promise<{ conversions: StockConversionCandidateDto[]; created: LeaveGrantDto[] }> {
    return request("/leave/grants/convert-expired", { method: "POST", body: JSON.stringify({ userId }) });
  },

  /** GET /help/overrides(認証のみ、権限不要 — 従業員も自社の規定を読む必要があるため)。 */
  async getHelpOverrides(): Promise<HelpOverridesDto> {
    return request("/help/overrides");
  },

  /** PUT /help/overrides/:key(notification.settings.manage)。bodyMd="" は削除扱い。 */
  async updateHelpOverride(key: string, bodyMd: string): Promise<{ helpKey?: string; bodyMd?: string; updatedAt?: number; deleted?: boolean }> {
    return request(`/help/overrides/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ bodyMd }) });
  },

  /** DELETE /help/overrides/:key(notification.settings.manage)。 */
  async deleteHelpOverride(key: string): Promise<{ deleted: true }> {
    return request(`/help/overrides/${encodeURIComponent(key)}`, { method: "DELETE" });
  },

  /** PUT /settings/work-rules-url(notification.settings.manage)。url="" で削除。 */
  async updateWorkRulesUrl(url: string): Promise<{ workRulesUrl: string | null }> {
    return request("/settings/work-rules-url", { method: "PUT", body: JSON.stringify({ url }) });
  },

  /** GET /settings/privacy-templates(notification.settings.manage)。現在の設定から生成された雛形2種を返す。 */
  async getPrivacyTemplates(): Promise<PrivacyTemplatesDto> {
    return request("/settings/privacy-templates");
  },

  /** GET /settings/attendance(tenant_settings.calendar.manage)。現在有効な版+版の履歴。 */
  async getAttendanceSettings(): Promise<AttendanceSettingsDto> {
    return request("/settings/attendance");
  },

  /**
   * POST /settings/attendance。新しい版を1件追加する(UPDATE ではない)。
   * effectiveFrom が過去日なら 409 effective_from_in_past、既存版と同日なら 409 version_already_exists。
   * GPS の値(gpsEnabled/gpsRetentionDays)が現在の実効値から変わる場合は
   * tenant_settings.gps.manage も必要(calendar.manage だけだと 403)。
   */
  async createAttendanceSettingVersion(input: CreateAttendanceSettingVersionInput): Promise<{ version: AttendanceSettingVersionDto }> {
    return request("/settings/attendance", { method: "POST", body: JSON.stringify(input) });
  },

  /** GET /settings/work-policy(tenant_settings.flex.manage)。現在有効な版+版の履歴。 */
  async getWorkPolicySettings(): Promise<WorkPolicySettingsDto> {
    return request("/settings/work-policy");
  },

  /** POST /settings/work-policy。新しい版を1件追加する(UPDATE ではない)。 */
  async createWorkPolicyVersion(input: CreateWorkPolicyVersionInput): Promise<{ version: WorkPolicyVersionDto }> {
    return request("/settings/work-policy", { method: "POST", body: JSON.stringify(input) });
  },

  /** GET /settings/privacy-contact(notification.settings.manage、社内規定編集と同じ権限)。 */
  async getPrivacyContact(): Promise<PrivacyContactDto> {
    return request("/settings/privacy-contact");
  },

  /** PUT /settings/privacy-contact。省略=維持、null/""=クリア、文字列=置換。 */
  async updatePrivacyContact(input: { recordRetentionDescription?: string | null; privacyContactPoint?: string | null }): Promise<PrivacyContactDto> {
    return request("/settings/privacy-contact", { method: "PUT", body: JSON.stringify(input) });
  },

  /** GET /api-keys(権限不要、自分のキーのみ)。v0.4。 */
  async listApiKeys(): Promise<{ apiKeys: ApiKeyDto[] }> {
    return request("/api-keys");
  },

  /** POST /api-keys(権限不要、自分用に発行)。レスポンスの token は発行直後のみ取得できる。 */
  async createApiKey(input: CreateApiKeyInput): Promise<{ apiKey: IssuedApiKeyDto }> {
    return request("/api-keys", { method: "POST", body: JSON.stringify(input) });
  },

  /** DELETE /api-keys/:id(権限不要、自分のキーのみ失効可)。 */
  async revokeApiKey(id: string): Promise<{ apiKey: ApiKeyDto }> {
    return request(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

/**
 * CSV エクスポート(GET /exports/attendance.csv)は JSON ではないため request<T> を使わず、
 * 直接 fetch する。ブラウザ側からの権限有無の確認(ボタン表示可否)は、実際のダウンロードと
 * 同じ URL への HEAD リクエストで行う(hono は HEAD を自動的に GET と同じルーティング・
 * ミドルウェア(権限チェック含む)にディスパッチしボディだけ捨てるため、CSV本体を
 * 二重に転送せずに 200/403 を判定できる — apps/api/node_modules/hono の #dispatch 実装より)。
 */
export async function probeAttendanceCsvAccess(month: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/exports/attendance.csv?month=${encodeURIComponent(month)}`, {
      method: "HEAD",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface AttendanceCsvDownload {
  blob: Blob;
  filename: string;
}

/** GET /exports/attendance.csv[?compare=original] を blob として取得する。Content-Disposition のファイル名を尊重する。 */
export async function downloadAttendanceCsv(month: string, compareOriginal: boolean): Promise<AttendanceCsvDownload> {
  const query = `?month=${encodeURIComponent(month)}${compareOriginal ? "&compare=original" : ""}`;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/exports/attendance.csv${query}`, { credentials: "include" });
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
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? `kizami-${month}.csv`;
  const blob = await res.blob();
  return { blob, filename };
}
