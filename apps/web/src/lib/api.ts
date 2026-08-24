/**
 * apps/api への薄い fetch クライアント。
 *
 * - すべて `credentials: "include"` でセッション Cookie を送る
 * - ベース URL は `WAKU_PUBLIC_API_URL`(未設定時は localhost:3001。apps/api の既定ポートと一致)
 * - 401 は `UnauthorizedError` として投げる。呼び出し側(useAuthGuard 等)が /login への誘導に使う
 */

const BASE_URL: string = import.meta.env.WAKU_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * apps/api のベース URL。SSO 設定画面が「IdP に登録するリダイレクト URI」を組み立てるために
 * 参照する(それ以外の用途では `request()` を通すこと)。
 */
export const API_BASE_URL = BASE_URL;

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

/** ログイン時、同一メール+パスワードが複数テナントに一致した場合の選択肢(2026-08-23 追加)。 */
export interface LoginTenantOption {
  id: string;
  name: string | null;
}

function isMultipleTenantsBody(body: unknown): body is { error: "multiple_tenants"; tenants: LoginTenantOption[] } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { error?: unknown }).error === "multiple_tenants" &&
    Array.isArray((body as { tenants?: unknown }).tenants)
  );
}

/** POST /auth/login が 409 multiple_tenants を返したときに投げる(apps/api/src/routes/auth.ts と対応)。
 * 呼び出し側(LoginForm)は err.tenants を選択肢として表示し、選ばれた tenantId で再送する。 */
export class MultipleTenantsError extends ApiError {
  readonly tenants: LoginTenantOption[];

  constructor(body: { error: "multiple_tenants"; tenants: LoginTenantOption[] }) {
    super(409, body);
    this.name = "MultipleTenantsError";
    this.tenants = body.tenants;
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

/** GET /me が併せて返すテナント情報(2026-08-23 追加)。表示専用の最小限(社名のみ)。 */
export interface AuthTenant {
  name: string | null;
}

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";
export type AttendanceState = "out" | "working" | "onBreak";

export interface Punch {
  id: string;
  kind: PunchKind;
  /** UTC エポック分 */
  occurredAt: number;
}

/**
 * GPS付き打刻(v0.4、PWA+GPS打刻)。テナントでGPSが有効なときだけ Web 側が実際の値を送る。
 * サーバー側も再確認する(テナントでGPSが無効なら、送っても保存されない。
 * apps/api/src/routes/punches.ts のコメント参照)。
 */
export interface PunchGpsInput {
  gpsLat: number;
  gpsLng: number;
}

export interface AttendanceStatus {
  state: AttendanceState;
  lastPunch: { kind: PunchKind; occurredAt: number } | null;
}

/** GET /attendance/members の1件(2026-08-23 新設、月次の閲覧対象切替UI向け)。 */
export interface AttendanceMemberDto {
  id: string;
  name: string;
  departmentId: string | null;
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
  | "clock_out_during_break"
  /** 期間の途中で労働時間制(flex/fixed/monthly_variable)が切り替わった(2026-08-23 追加、packages/engine)。 */
  | "mixed_work_system"
  /** 勤務区間の休憩が労基法34条の最低時間に足りない(2026-08-23 追加、packages/engine)。 */
  | "insufficient_break"
  /**
   * シフト予実の乖離(2026-08-24 追加、v0.7 フェーズ3、docs/design/shift-work.md「予実の突合」)。
   * monthly_variable の日別 ShiftDay と実労働(DailyBreakdown)を突き合わせた結果。
   * 集計(totals)には反映されない(遅刻控除等は給与側の責任)。
   */
  | "missing_shift"
  | "shift_late_arrival"
  | "shift_early_leave"
  | "shift_unplanned_work"
  | "shift_absence";

export interface CalcWarning {
  kind: WarningKind;
  date: string;
  punchAt?: number;
  /** insufficient_break のとき: 必要だった休憩と実際の休憩(分)。 */
  break?: { requiredMinutes: number; actualMinutes: number };
  /**
   * シフト予実乖離の警告(missing_shift・shift_late_arrival・shift_early_leave・
   * shift_unplanned_work・shift_absence)のとき: 乖離の分数(packages/engine/src/shift-variance.ts
   * と一致、すべて省略可)。missing_shift は actualMinutes のみ(deltaMinutes は無い)。
   */
  shift?: { scheduledMinutes?: number; actualMinutes?: number; deltaMinutes?: number };
}

/** その勤怠日に始まった勤務区間(出勤〜退勤の1まとまり)。中抜けがあれば複数。 */
export interface WorkStretch {
  /** UTC エポック分 */
  clockInAt: number;
  /** 退勤打刻。未退勤(missing_clock_out で集計除外)なら null */
  clockOutAt: number | null;
}

export interface DailyBreakdown {
  date: string;
  workedMinutes: number;
  breakMinutes: number;
  /**
   * 休憩の自動控除(分、2026-08-23 追加、docs/design/breaks.md「採る設計」)。
   * 打刻由来の breakMinutes とは別。合算しない — 本人が「自動で引かれた分」に気づけることが要件。
   */
  autoDeductedBreakMinutes: number;
  lateNightMinutes: number;
  isLegalHoliday: boolean;
  legalHolidayMinutes: number;
  isPaidLeave: boolean;
  /** その日の有給分数(2026-08-23 追加、packages/engine の DailyBreakdown と一致)。 */
  paidLeaveMinutes: number;
  /** その日に始まった勤務区間。打刻時刻の表示用(2026-08-23 追加)。 */
  stretches: WorkStretch[];
  /**
   * その日の所定労働時間(分、2026-08-24 追加、v0.7 フェーズ3)。monthly_variable のみ
   * ShiftDay(dayType が work の日)から埋まる。flex/fixed では常に 0。
   */
  scheduledMinutes: number;
  /** 所定内(実労働のうち標準労働時間まで)。固定時間制・monthly_variable のみ。フレックスでは 0 */
  withinScheduledMinutes: number;
  /** 所定外だが法定内(所定超〜1日8時間、いわゆる法定内残業)。固定時間制のみ。フレックスでは 0 */
  extraWithinStatutoryMinutes: number;
  /** 法定時間外(日8時間超 + 週法定超)。固定時間制のみ。フレックスでは 0 */
  statutoryOvertimeMinutes: number;
  /**
   * この日の手当対象時間(定義ごと、docs/design/allowances.md、2026-08-23 追加)。
   * 0分になった定義は含めない(sparse — packages/engine の DailyBreakdown.allowances と一致)。
   * 法定区分(lateNightMinutes 等)とは独立で、同じ1分が両方に計上されることもある。
   */
  allowances: Array<{ definitionId: string; minutes: number }>;
}

export interface FlexBalance {
  frameMinutes: number;
  actualMinutes: number;
  diffMinutes: number;
}

/** 固定時間制の月合計内訳(所定内・法定内残業)。フレックスでは null。 */
export interface FixedBreakdown {
  withinScheduledMinutes: number;
  extraWithinStatutoryMinutes: number;
}

/** 手当定義ごとの分数(月合計、definitionId ベース)。 */
export type AllowanceTotals = Array<{ definitionId: string; minutes: number }>;

/**
 * monthly_variable の変形期間サマリ(2026-08-24 追加、v0.7 フェーズ3、
 * packages/engine の VariablePeriodSummary、docs/design/shift-work.md 決定事項3)。
 */
export interface VariablePeriodSummaryDto {
  periodStart: string;
  periodEnd: string;
  /** 期間の法定総枠(分、40時間 × 暦日数 ÷ 7)。 */
  statutoryFrameMinutes: number;
  /** 期間の所定合計(分、ShiftDay 由来)。 */
  scheduledTotalMinutes: number;
  /** 期間の実労働合計(分)。 */
  workedTotalMinutes: number;
  /** 期間段(③)の時間外(分)。①②で時間外にした分を除く。 */
  periodOvertimeMinutes: number;
  /**
   * periodOvertimeMinutes がこの月の totals.overtime に加算済みかどうか。false のときは
   * 「期間の終了日が属する月」がまだ来ていない(決定事項3、期間はこの月をまたいで継続中)。
   */
  attributedToThisMonth: boolean;
}

/**
 * 締め保護の対象となる集計値一式(区分別合計・フレックス収支・固定時間制内訳・手当合計)。
 * `source` が "snapshot" のときはすべて締めスナップショット由来の確定値
 * (docs/design/v01-data-model.md「GET /attendance/monthly レスポンス契約」)。
 */
export interface MonthlyFigures {
  source: "live" | "snapshot";
  totals: CategorizedMinutes;
  /** フレックスのみ。固定時間制・monthly_variable では null。 */
  flexBalance: FlexBalance | null;
  /** 固定時間制のみ。フレックス・monthly_variable では null。 */
  fixedBreakdown: FixedBreakdown | null;
  /**
   * monthly_variable かつ source が "live" のときのみ非null(2026-08-24 追加)。
   * 締め済み月(source: "snapshot")は常に null(決定事項3、締めスナップショットは既存の
   * totals 経由でそのまま扱う)。
   */
  variablePeriod: VariablePeriodSummaryDto | null;
  allowanceTotals: AllowanceTotals;
  /** 締め後修正(amend)が入っている月のみ、当初(最初の締め)の値をここに持つ。 */
  original?: {
    totals: CategorizedMinutes;
    flexBalance: FlexBalance | null;
    fixedBreakdown: FixedBreakdown | null;
    allowanceTotals: AllowanceTotals;
  };
}

/**
 * GET /attendance/monthly のレスポンス(2026-08-23 破壊的変更、旧形の12キーのフラット構造を廃止)。
 * 設計判断は docs/design/v01-data-model.md「GET /attendance/monthly レスポンス契約」節。
 */
export interface MonthlyAttendance {
  /** 誰の月次か(他人の勤怠閲覧、?userId= 省略時も自分自身の { id, name } が入る)。 */
  user: { id: string; name: string };
  /** 期間開始日に有効だった労働時間制。monthly_variable(シフト制)は2026-08-24 追加。 */
  workSystem: "flex" | "fixed" | "monthly_variable";
  days: DailyBreakdown[];
  warnings: CalcWarning[];
  /** 締め保護の対象(集計値)。日別内訳・warnings とは異なり締め済み月はスナップショット固定になる。 */
  figures: MonthlyFigures;
  /** 定義ID → 名前(表示用、締め済み・未締めを問わず常に付く。締め保護の対象外)。 */
  allowanceDefinitions: Record<string, string>;
  closing: { closed: boolean; amended: boolean };
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
/**
 * "approval_request"(2026-08-23 Tier 0 その4 追加): 承認権限を持つ人向けの「承認依頼が届いた」
 * カテゴリ(apps/api/src/lib/notification-preferences.ts の CATEGORIES と一致)。他カテゴリと違い
 * 「申請者本人」ではなく承認権限のある人に配られる通知だが、個人設定の型・UIとしては同格に扱う。
 *
 * "shift_variance"(2026-08-24 追加): 前日の自分の勤務がシフトとずれたことを本人へ知らせる
 * カテゴリ(apps/api/src/shift-variance-alerts.ts の日次スキャン)。受け手は本人に戻る。
 */
export type PersonalNotificationCategory =
  | "missing_clock_out"
  | "overtime_alert"
  | "leave_alert"
  | "correction_alert"
  | "approval_request"
  | "shift_variance";

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

/**
 * Slackスラッシュコマンド打刻の連携設定(テナント単位。2026-08-22 追加、docs/external-api/slack.md)。
 * apps/api/src/routes/settings.ts の GET/PUT /settings/slack と一致させる。
 * Signing Secret は秘密情報のため全文は返らない(configured相当の signingSecretSet のみ)。
 */
export interface SlackSettingsDto {
  teamId: string | null;
  enabled: boolean;
  signingSecretSet: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

/**
 * PUT /settings/slack の入力(3値ルール、apps/api/src/routes/settings.ts 参照):
 * フィールド省略=既存値維持、null/""=クリア、それ以外の文字列=置換。
 * signingSecretはマスクされて返ってくるため、Web側は「空欄なら省略(維持)・入力があれば新しい値」
 * という規約でこの3値ルールの一部だけを使う(PUT /settings/notifications と同じ考え方)。
 */
export interface UpdateSlackSettingsInput {
  enabled: boolean;
  teamId?: string;
  signingSecret?: string;
}

/** POST /settings/slack-link(Slack連携用ワンタイムトークンの確定)のレスポンス。 */
export interface SlackLinkResultDto {
  linked: true;
  slackUserId: string;
}

/**
 * SSO(OIDC)のテナント設定(2026-08-24 追加、docs/design/sso-oidc.md)。
 * apps/api/src/routes/settings/sso.ts の GET/PUT /settings/sso と一致させる。
 * clientSecret は秘密情報のため全文もプレビューも返らない(clientSecretSet のみ)。
 */
export interface SsoSettingsDto {
  issuer: string | null;
  clientId: string | null;
  enabled: boolean;
  allowUnverifiedEmail: boolean;
  clientSecretSet: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

/**
 * PUT /settings/sso の入力(3値ルール、Slack 設定と同じ):
 * フィールド省略=既存値維持、null/""=クリア、それ以外の文字列=置換。
 * clientSecret はマスクされて返るため、Web 側は「空欄なら省略(維持)・入力があれば新しい値」
 * という規約でこの3値ルールの一部だけを使う。
 */
export interface UpdateSsoSettingsInput {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  allowUnverifiedEmail?: boolean;
}

/**
 * GET /auth/oidc/available のレスポンス要素(未認証で叩ける)。
 * **SSO が有効なテナントしか返らない**(在籍の有無を無闇に漏らさないための設計 —
 * apps/api/src/routes/auth-oidc.ts のコメント参照)ため、ssoEnabled は常に true になる。
 */
export interface SsoAvailableTenant {
  id: string;
  name: string | null;
  ssoEnabled: boolean;
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

/**
 * 招待式登録(2026-08-23 追加)の状態。apps/api/src/routes/members.ts の InviteStatus と一致。
 * active=受諾済み、invited=招待中(有効な招待あり)、invite_expired=それ以外(未招待・取消・期限切れをまとめる)。
 */
export type InviteStatus = "active" | "invited" | "invite_expired";

/**
 * 労働時間制の種別(apps/api/src/routes/members.ts の GET/POST /:id/work-policy と一致)。
 * monthly_variable(1ヶ月単位の変形労働時間制、シフト制)は2026-08-24 追加、v0.7 フェーズ3。
 */
export type WorkSystemKind = "flex" | "fixed" | "monthly_variable";

/**
 * 年次有給休暇の付与区分(2026-08-24 追加、労基法39条3項・労基法施行規則24条の3)。
 * "full" = 通常(週5日以上)、それ以外は比例付与(週所定労働日数4/3/2/1日)。
 * @kizami/leave の LeaveGrantClass と一致させる。
 */
export type LeaveGrantClass = "full" | "days4" | "days3" | "days2" | "days1";

/** メンバー(apps/api/src/routes/members.ts の GET / のレスポンス要素と一致)。 */
export interface MemberDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  /** 入社日 "YYYY-MM-DD"。null = 未設定(法定付与の自動計算ができない)。 */
  hireDate: string | null;
  /** 有給付与の区分(比例付与、2026-08-24 追加)。既定 "full"。 */
  leaveGrantClass: LeaveGrantClass;
  department: { id: string; name: string } | null;
  presetNames: string[];
  inviteStatus: InviteStatus;
  /** パスワードリセット(管理者発行、2026-08-23 Tier 0 その4 追加)の未処理トークン有無。一覧のバッジ用。 */
  hasPendingPasswordReset: boolean;
  /**
   * 現在の労働時間制(2026-08-23 Tier 0 その4 追加)。null = 割当が一度も無い、または解決不能。
   * apps/api/src/routes/members.ts の workSystemKind と一致(一覧のバッジ用の参考値であり、
   * 実際に計算へ使われる値は engine 側が effective-dated に解決する)。
   */
  workSystemKind: WorkSystemKind | null;
}

/**
 * 招待式登録(2026-08-23 追加、docs/requirements.md §7)。
 * POST /members・POST /members/:id/invitations のレスポンスのみ、平文トークンを含む
 * (この後は二度と取得できない、routes/api-keys.ts の IssuedApiKeyDto と同じ作法)。
 * 完成URL(`${location.origin}/invite/${token}`)はAPIが組み立てないため、フロント側で組み立てる
 * (apps/api/src/routes/members.ts のコメント: APIはWebのオリジンを知らないため)。
 */
export interface IssuedInvitationDto {
  id: string;
  token: string;
  /** UTC エポック分。7日後。 */
  expiresAt: number;
}

/** POST /members の入力。email/name は必須、それ以外は任意。 */
export interface CreateMemberInput {
  email: string;
  name: string;
  departmentId?: string;
  /** "YYYY-MM-DD" */
  hireDate?: string;
  presetIds?: string[];
}

/** POST /members のレスポンス(招待発行を兼ねる)。 */
export interface CreateMemberResultDto {
  member: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    hireDate: string | null;
    department: { id: string } | null;
  };
  invitation: IssuedInvitationDto;
}

/** GET /invitations/:token(公開・未認証)のレスポンス。受諾画面の表示用。 */
export interface InvitationPreviewDto {
  tenantName: string | null;
  userName: string;
  email: string;
}

/**
 * パスワードリセットの管理者発行(2026-08-23 Tier 0 その4 追加、招待と同型)。
 * POST /members/:id/password-resets のレスポンスのみ、平文トークンを含む(この後は二度と
 * 取得できない、IssuedInvitationDto と同じ作法)。完成URL(`${location.origin}/reset/${token}`)は
 * APIが組み立てないため、フロント側で組み立てる(招待と同じ理由)。
 */
export interface IssuedPasswordResetDto {
  id: string;
  token: string;
  /** UTC エポック分。 */
  expiresAt: number;
}

/** GET /password-resets/:token(公開・未認証)のレスポンス。再設定画面の表示用。 */
export interface PasswordResetPreviewDto {
  tenantName: string | null;
  userName: string;
  email: string;
}

/**
 * メンバー個別の労働時間制割当1件(2026-08-23 Tier 0 その4 追加)。
 * GET /members/:id/work-policy のレスポンス要素と一致。
 */
export interface MemberWorkPolicyAssignmentDto {
  effectiveFrom: string;
  kind: WorkSystemKind;
  standardDayMinutes: number;
  workPolicyName: string;
}

/** GET /members/:id/work-policy のレスポンス。 */
export interface MemberWorkPolicySettingsDto {
  effective: MemberWorkPolicyAssignmentDto | null;
  history: MemberWorkPolicyAssignmentDto[];
}

/** POST /members/:id/work-policy の入力。 */
export interface CreateMemberWorkPolicyInput {
  kind: WorkSystemKind;
  effectiveFrom: string;
  /**
   * 1日あたりの基準所定時間(分、1〜1440)。省略するとテナント既定ポリシーの値を引き継ぐ。
   * kind: "monthly_variable" ではこの値が「有給1日を何分に換算するか」を意味する
   * (シフトが無い日の有給換算に使う、v0.7 フェーズ4、2026-08-24 追加)。
   */
  standardDayMinutes?: number;
}

/** POST /members/:id/work-policy のレスポンス(workPolicyName は含まない — GET と異なる形なので別型にする)。 */
export interface CreateMemberWorkPolicyResultDto {
  kind: WorkSystemKind;
  effectiveFrom: string;
  standardDayMinutes: number;
}

export interface PermissionGrantDto {
  key: string;
  scope: Scope;
}

/**
 * GET /me/effective-permissions の1要素(2026-08-23 追加)。PermissionGrantDto と形は同じだが、
 * 「プリセットの合算・含意展開・セルフサービス込みの最終形」であることを型名で区別する
 * (lib/useEffectivePermissions.ts・lib/permissions.ts#hasEffectivePermission 参照)。
 */
export interface EffectivePermissionDto {
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
 * 休憩の自動控除ルール1件(2026-08-23 追加、docs/design/breaks.md「採る設計」)。
 * overMinutes(この分数を超えたら)・deductMinutes(控除する分数)。apps/api の
 * routes/settings.ts isValidBreakRule と同じ制約(昇順・重複なし・高々3件)はサーバー側で検証される。
 */
export interface AutoBreakRuleDto {
  overMinutes: number;
  deductMinutes: number;
}

/**
 * 休憩ルール(BreakRule、packages/engine の型を apps/web の既存方針どおりここに再定義)。
 * punch=打刻のみ、auto=自動控除のみ(打刻の休憩は無視)、both=打刻された休憩を使い
 * 法定最低に満たなければ差分を追加控除。
 */
export type BreakRuleDto = { mode: "punch" } | { mode: "auto" | "both"; rules: AutoBreakRuleDto[] };

/**
 * テナント設定の版(apps/api/src/routes/settings.ts の GET/POST /settings/attendance と一致)。
 * effective-dated(原則6): 編集は「新しい版を追加」のみで、既存の版は変更されない。
 */
export interface AttendanceSettingVersionDto {
  effectiveFrom: string;
  dayBoundaryMinutes: number;
  /**
   * 週の起算曜日(0=日曜〜6=土曜)。週40時間判定(固定時間制の週次時間外)の週の区切り。
   * 2026-08-23 追加 — 既存の版管理フォームがこのフィールドを送っておらず
   * POST /settings/attendance が invalid_week_start_weekday で必ず 400 になっていた
   * (apps/web 側の既存バグ、本タスクで発覚・修正。完了報告に明記)。
   */
  weekStartWeekday: number;
  /**
   * 変形期間の開始日(1〜28、2026-08-24 追加、v0.7 フェーズ3、docs/design/shift-work.md 決定事項3)。
   * monthly_variable を使わないテナントでも常に持つ(POST のたびに必須で送る、apps/api の流儀)。
   */
  variablePeriodStartDay: number;
  legalHolidayRule: LegalHolidayRuleDto;
  breakRule: BreakRuleDto;
  gpsEnabled: boolean;
  gpsRetentionDays: number | null;
  createdAt: number;
}

/** GET /settings/attendance のレスポンス。 */
export interface AttendanceSettingsDto {
  effective: AttendanceSettingVersionDto | null;
  history: AttendanceSettingVersionDto[];
}

/**
 * GET /settings/attendance/capabilities(認証のみ、権限不要)のレスポンス。
 * 打刻画面が「GPSを取得して送るかどうか」を判断するために必要な最小限の情報のみ
 * (GET /settings/attendance のような日界・法定休日等は含まない。routes/settings.ts 参照)。
 */
export interface AttendanceCapabilitiesDto {
  gpsEnabled: boolean;
  gpsRetentionDays: number | null;
}

/** POST /settings/attendance の入力。新しい版を1件追加する(UPDATE ではない)。 */
export interface CreateAttendanceSettingVersionInput {
  effectiveFrom: string;
  dayBoundaryMinutes: number;
  weekStartWeekday: number;
  variablePeriodStartDay: number;
  legalHolidayRule: LegalHolidayRuleDto;
  breakRule: BreakRuleDto;
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

/**
 * 手当定義の適用条件(AllowanceDefinition["conditions"]、packages/engine の型を apps/web の
 * 既存方針どおりここに再定義する。docs/design/allowances.md「手当定義」)。
 * すべて省略可・AND 条件。`dates` は "2027-01-01"(固定日付)と "--12-31"(毎年、月日のみ一致)の
 * 両形式を混在させられる。`timeBand` は startMinutes > endMinutes で日跨ぎを表す。
 * 全条件を省略した組み合わせは POST /settings/allowances* が 400 conditions_required で拒否する。
 */
export interface AllowanceConditionsDto {
  dates?: string[];
  weekdays?: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
  timeBand?: { startMinutes: number; endMinutes: number };
}

/** 手当定義の版(apps/api/src/routes/settings.ts の GET/POST /settings/allowances* と一致)。 */
export interface AllowanceDefinitionVersionDto {
  effectiveFrom: string;
  name: string;
  conditions: AllowanceConditionsDto;
  createdAt: number;
}

/**
 * 手当定義1件(GET /settings/allowances のレスポンス要素)。work_policy と違い
 * テナントにつき何件でも並行して存在しうるため、定義ごとに { id, effective, history } を持つ。
 */
export interface AllowanceDefinitionDto {
  id: string;
  effective: AllowanceDefinitionVersionDto | null;
  history: AllowanceDefinitionVersionDto[];
}

/** POST /settings/allowances の入力。新しい手当定義(識別子+初版)を1件作成する。 */
export interface CreateAllowanceDefinitionInput {
  effectiveFrom: string;
  name: string;
  conditions: AllowanceConditionsDto;
}

/** POST /settings/allowances/:definitionId/versions の入力。新しい版を1件追加する(UPDATE ではない)。 */
export interface CreateAllowanceDefinitionVersionInput {
  effectiveFrom: string;
  name: string;
  conditions: AllowanceConditionsDto;
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
  /** proposal: 予告フロー(GET /leave/grant-proposals → 承認)由来の付与(v0.7 フェーズ4 追加)。 */
  source: "auto" | "manual" | "conversion" | "proposal";
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

/**
 * 有給付与の予告(v0.7 フェーズ4、2026-08-24 追加)。日次ワーカーが作った「予告」を
 * 管理者が承認して初めて付与が確定する(機械は付与を確定させない)。
 * apps/api/src/routes/leave.ts の serializeLeaveGrantProposal と一致させる。
 */
export type LeaveGrantProposalStatus = "proposed" | "approved" | "rejected" | "superseded";

/** 出勤率の算定根拠。shift=シフト表から算出、calendar_estimate=暦日からの推定。 */
export type AttendanceRateBasis = "shift" | "calendar_estimate";

/**
 * 出勤率の参考値(労基法39条1項の8割要件の判断材料)。あくまで参考値であり、
 * 最終判断は人が行う。rate は 0〜1、workingDays が 0 のときは null(=不明。0% ではない)。
 */
export interface AttendanceRateReferenceDto {
  periodFrom: string;
  periodTo: string;
  workingDays: number;
  attendedDays: number;
  rate: number | null;
  basis: AttendanceRateBasis;
}

export interface LeaveGrantProposalDto {
  id: string;
  userId: string;
  /** 退職者などで解決できない場合 null(呼び出し側は userId を代わりに出す)。 */
  userName: string | null;
  /**
   * 対象者の現在の有給付与区分(2026-08-24 追加)。"full" 以外なら比例付与であり、
   * days がフルタイムの表と異なる理由を管理者に示すために使う。解決できない場合 null。
   */
  leaveGrantClass: LeaveGrantClass | null;
  leaveType: LeaveType;
  grantedOn: string;
  days: number;
  expiresOn: string;
  attendanceRate: AttendanceRateReferenceDto;
  status: LeaveGrantProposalStatus;
  proposedAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  grantId: string | null;
  createdAt: number;
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

export type AutoBreakWaiverStatus = "pending" | "approved" | "rejected" | "withdrawn";

/**
 * 休憩自動控除の打ち消し申請(auto_break_waivers、2026-08-23 追加、docs/design/breaks.md「採る設計」)。
 * apps/api/src/routes/auto-break-waivers.ts の serializeWaiver と一致させる。
 * correction_requests とは別テーブル(打刻の存在しない自動控除には correction_requests が
 * 使えないため) — CorrectionRequestDto とは意図的に別の型にする。
 */
export interface AutoBreakWaiverDto {
  id: string;
  userId: string;
  requestedBy: string;
  status: AutoBreakWaiverStatus;
  waiveDate: string;
  reason: string;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  createdAt: number;
}

export interface CreateAutoBreakWaiverInput {
  /** "YYYY-MM-DD" */
  waiveDate: string;
  reason: string;
}

/**
 * GET /audit-logs の1件(apps/api/src/routes/audit-logs.ts の AuditLogDto と一致、Tier 1 新設)。
 * detail は JSON 文字列のまま(整形はUI側)。読み取り専用 — 監査ログの更新・削除APIは存在しない。
 */
export interface AuditLogDto {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  occurredAt: number;
}

export interface ListAuditLogsParams {
  actorId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  /** UTC エポック分(inclusive)。 */
  from?: number;
  /** UTC エポック分(inclusive)。 */
  to?: number;
  /** 前ページ最後の id(カーソルページング)。 */
  cursor?: string;
  /** 既定50・上限200(apps/api/src/routes/audit-logs.ts)。 */
  limit?: number;
}

/**
 * シフト制(v0.7 フェーズ3、2026-08-24 追加)。docs/design/shift-work.md 決定事項1・2・3、
 * apps/api/src/routes/shifts.ts・routes/settings/shift-patterns.ts と一致させる。
 */
export type ShiftDayType = "work" | "legal_holiday" | "non_working";

/** シフトパターン(apps/api/src/routes/settings/shift-patterns.ts の serializeShiftPattern と一致)。 */
export interface ShiftPatternDto {
  id: string;
  name: string;
  dayType: ShiftDayType;
  /** dayType が work 以外なら 0。 */
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  createdAt: number;
  /** UTC エポック分。null = アーカイブされていない。 */
  archivedAt: number | null;
}

/** POST /settings/shift-patterns の入力。dayType が work 以外なら start/end/breakMinutes は省略可(サーバー側で0固定)。 */
export interface CreateShiftPatternInput {
  name: string;
  dayType: ShiftDayType;
  startMinutes?: number;
  endMinutes?: number;
  breakMinutes?: number;
}

/** shift_days の1件(apps/api/src/routes/shifts.ts の serializeShiftDay と一致)。 */
export interface ShiftDayDto {
  id: string;
  date: string;
  dayType: ShiftDayType;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  /** パターンから割り当てた場合のパターンID。個別編集なら null。 */
  patternId: string | null;
  planId: string;
  /** supersede 元の shift_days.id。確定+追記型の変更履歴(決定事項1)。 */
  supersedesId: string | null;
  createdBy: string;
  createdAt: number;
}

/** シフト表(shift_plans、apps/api/src/routes/shifts.ts の serializePlan と一致)。 */
export interface ShiftPlanDto {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  /** UTC エポック分。null = 未確定。 */
  publishedAt: number | null;
  publishedBy: string | null;
  createdAt: number;
}

/** GET /shifts/plans・PUT /shifts/plans/:id/days のレスポンスに含まれる、その時点の有効な shift_days 込みの1件。 */
export interface ShiftPlanWithDaysDto extends ShiftPlanDto {
  days: ShiftDayDto[];
}

/**
 * PUT /shifts/plans/:id/days の1要素。patternId 指定ならパターンの値を、個別指定なら
 * 渡した値をそのまま採用する(決定事項2「パターン割当+個別編集」、apps/api の normalizeDayInput)。
 * dayType が work 以外のときは start/end/breakMinutes を省略できる(サーバー側で0固定)。
 */
export type ShiftDayInput =
  | { date: string; patternId: string }
  | { date: string; dayType: ShiftDayType; startMinutes?: number; endMinutes?: number; breakMinutes?: number };

/** GET /shifts/plans/:id/history のレスポンス。history は supersede チェーンをすべて含む(古い順)。 */
export interface ShiftPlanHistoryDto {
  plan: ShiftPlanDto;
  history: ShiftDayDto[];
}

export const api = {
  /**
   * tenantId 省略時、同一メール+パスワードが複数テナントに一致すると 409 multiple_tenants
   * (`MultipleTenantsError`)を投げる。呼び出し側はそれを選択肢として表示し、選ばれた
   * tenantId を付けて同じ email/password で再送する(パスワードは検証済みのため再入力不要)。
   */
  async login(email: string, password: string, tenantId?: string): Promise<{ user: AuthUser }> {
    try {
      return await request("/auth/login", {
        method: "POST",
        body: JSON.stringify(tenantId ? { email, password, tenantId } : { email, password }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isMultipleTenantsBody(err.body)) {
        throw new MultipleTenantsError(err.body);
      }
      throw err;
    }
  },

  async logout(): Promise<void> {
    await request<void>("/auth/logout", { method: "POST" });
  },

  async me(): Promise<{ user: AuthUser; tenant: AuthTenant }> {
    return request("/me");
  },

  /**
   * GET /me/effective-permissions(2026-08-23 API側新設)。認証ユーザー自身の実効権限の最終形
   * (プリセットの合算・「操作は閲覧を含意」の展開・セルフサービス権限込み)を返す。
   *
   * このバッチ(レビュー第2波)以前は、apps/api にこのエンドポイントが無かったため、Web 側は
   * 「一覧 GET を叩いて 200/403 で判定する」(useSettingsAccess)・「自分の presetNames を
   * GET /presets と突き合わせて computeEffectivePermissions で再計算する」(MembersView の
   * canInvite・CorrectionsView の hasApprovePermission)という3方式のクライアント側推定に
   * 頼っていた。本エンドポイントの追加によりそれらは全廃し、ここから取得した1つの実効権限一覧を
   * 共有フック(lib/useEffectivePermissions.ts)経由で全画面が参照する形に統一する。
   */
  async getEffectivePermissions(): Promise<{ permissions: EffectivePermissionDto[] }> {
    return request("/me/effective-permissions");
  },

  /** gps 省略時は座標なしで打刻する(位置情報が取得できなかった/許可されなかった場合)。 */
  async punch(kind: PunchKind, gps?: PunchGpsInput): Promise<{ punch: Punch }> {
    return request("/punches", { method: "POST", body: JSON.stringify({ kind, ...gps }) });
  },

  /** from/to は UTC エポック分(inclusive)。 */
  async listPunches(from: number, to: number): Promise<{ punches: Punch[] }> {
    return request(`/punches?from=${from}&to=${to}`);
  },

  async status(): Promise<AttendanceStatus> {
    return request("/attendance/status");
  },

  /**
   * month は "YYYY-MM"。userId 省略時は自分自身。他人を指定するには
   * attendance.record.view(department スコープ以上)が必要(apps/api/src/routes/attendance.ts)。
   * スコープ外・存在しない userId は 404(存在推測を避けるための一律404、同ファイル冒頭コメント参照)。
   */
  async monthly(month: string, userId?: string): Promise<MonthlyAttendance> {
    const query = userId !== undefined ? `&userId=${encodeURIComponent(userId)}` : "";
    return request(`/attendance/monthly?month=${encodeURIComponent(month)}${query}`);
  },

  /**
   * GET /attendance/members(2026-08-23 新設)。月次の「閲覧対象を切り替える」UI向けに、
   * 実効権限のスコープ内メンバー一覧を返す。attendance.record.view を持たない一般従業員は
   * 自分1人だけの配列を受け取る(このエンドポイント自体は権限が無くても403にしない)。
   */
  async getAttendanceMembers(): Promise<{ members: AttendanceMemberDto[] }> {
    return request("/attendance/members");
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

  /**
   * GET /auto-break-waivers。status 省略時は pending。userId 省略時は自分の分
   * (VIEW_ALL_PERMISSION を持つ場合は自動的にスコープ内全員分になる、apps/api 側の挙動)。
   */
  async listAutoBreakWaivers(status: "pending" | "all" = "pending", userId?: string): Promise<{ requests: AutoBreakWaiverDto[] }> {
    const params = new URLSearchParams({ status });
    if (userId) params.set("userId", userId);
    return request(`/auto-break-waivers?${params.toString()}`);
  },

  /** POST /auto-break-waivers。本人分のみ作成できる。targetMonthClosed=true なら対象月は締め済み。 */
  async createAutoBreakWaiver(input: CreateAutoBreakWaiverInput): Promise<{ waiver: AutoBreakWaiverDto; targetMonthClosed: boolean }> {
    return request("/auto-break-waivers", { method: "POST", body: JSON.stringify(input) });
  },

  /** POST /auto-break-waivers/:id/approve(attendance.correction.approve)。amended=true なら締め済み月に反映された。 */
  async approveAutoBreakWaiver(id: string, note?: string): Promise<{ waiver: AutoBreakWaiverDto; amended: boolean }> {
    return request(`/auto-break-waivers/${id}/approve`, { method: "POST", body: JSON.stringify(note ? { note } : {}) });
  },

  /** POST /auto-break-waivers/:id/reject(attendance.correction.approve)。 */
  async rejectAutoBreakWaiver(id: string, note?: string): Promise<{ waiver: AutoBreakWaiverDto }> {
    return request(`/auto-break-waivers/${id}/reject`, { method: "POST", body: JSON.stringify(note ? { note } : {}) });
  },

  /** POST /auto-break-waivers/:id/withdraw(本人のみ・pending のみ)。 */
  async withdrawAutoBreakWaiver(id: string): Promise<{ waiver: AutoBreakWaiverDto }> {
    return request(`/auto-break-waivers/${id}/withdraw`, { method: "POST" });
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

  async getSlackSettings(): Promise<SlackSettingsDto> {
    return request("/settings/slack");
  },

  async updateSlackSettings(input: UpdateSlackSettingsInput): Promise<SlackSettingsDto> {
    return request("/settings/slack", { method: "PUT", body: JSON.stringify(input) });
  },

  /** Slackの `/punch link` が発行したワンタイムトークンを、自分のKIZAMIアカウントに連携する。 */
  async redeemSlackLinkToken(token: string): Promise<SlackLinkResultDto> {
    return request("/settings/slack-link", { method: "POST", body: JSON.stringify({ token }) });
  },

  async getSsoSettings(): Promise<SsoSettingsDto> {
    return request("/settings/sso");
  },

  async updateSsoSettings(input: UpdateSsoSettingsInput): Promise<SsoSettingsDto> {
    return request("/settings/sso", { method: "PUT", body: JSON.stringify(input) });
  },

  /**
   * ログイン画面で「SSO でログイン」ボタンを出すかどうかの照会(未認証・レート制限あり)。
   * 該当が無い場合も空配列で 200 が返る(存在しないメールアドレスと区別できない)。
   */
  async ssoAvailable(email: string): Promise<{ tenants: SsoAvailableTenant[] }> {
    return request(`/auth/oidc/available?email=${encodeURIComponent(email)}`);
  },

  /**
   * SSO ログインの開始。IdP の認可エンドポイントへの URL を返すので、呼び出し側は
   * `window.location.assign()` でそこへ遷移する(状態は httpOnly Cookie 側に入る)。
   */
  async startSso(tenantId: string): Promise<{ redirectUrl: string }> {
    return request("/auth/oidc/start", { method: "POST", body: JSON.stringify({ tenantId }) });
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

  /** POST /members(member.invite)。メンバー作成 + 招待発行を1回で行う。 */
  async createMember(input: CreateMemberInput): Promise<CreateMemberResultDto> {
    return request("/members", { method: "POST", body: JSON.stringify(input) });
  },

  /** POST /members/:id/invitations(member.invite)。招待の再発行(旧招待は自動的に無効化される)。 */
  async reissueInvitation(memberId: string): Promise<{ invitation: IssuedInvitationDto }> {
    return request(`/members/${encodeURIComponent(memberId)}/invitations`, { method: "POST" });
  },

  /** DELETE /members/:id/invitations(member.invite)。招待の取り消し。 */
  async revokeInvitation(memberId: string): Promise<{ invitation: { id: string; revokedAt: number } }> {
    return request(`/members/${encodeURIComponent(memberId)}/invitations`, { method: "DELETE" });
  },

  /** GET /invitations/:token(公開・未認証)。受諾画面の表示情報のみ返す。 */
  async getInvitationPreview(token: string): Promise<InvitationPreviewDto> {
    return request(`/invitations/${encodeURIComponent(token)}`);
  },

  /**
   * POST /invitations/:token/accept(公開・未認証)。成功するとセッションCookieが発行され、
   * そのままログイン状態になる。
   *
   * 判断点: アカウント自体の作成には成功したがセッション発行だけ失敗した場合(2026-08-23
   * API側新設)、apps/api は 200 のまま `{ accountActivated: true, error: "session_issuance_failed" }`
   * を返す(エラーとして throw されない — HTTP ステータス自体は成功のため)。呼び出し側
   * (InviteAcceptView)はレスポンスの形で分岐し、この場合はログイン画面へ誘導する文言を出す。
   */
  async acceptInvitation(
    token: string,
    password: string,
  ): Promise<{ user: AuthUser } | { accountActivated: true; error: "session_issuance_failed" }> {
    return request(`/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", body: JSON.stringify({ password }) });
  },

  /**
   * POST /members/:id/password-resets(member.invite)。パスワードリセットの管理者発行。
   * 対象は受諾済みメンバーに限る(409 not_active/member_inactive)。
   */
  async issueMemberPasswordReset(memberId: string): Promise<{ passwordReset: IssuedPasswordResetDto }> {
    return request(`/members/${encodeURIComponent(memberId)}/password-resets`, { method: "POST" });
  },

  /** DELETE /members/:id/password-resets(member.invite)。未処理のリセットトークンの取り消し。 */
  async revokeMemberPasswordReset(memberId: string): Promise<{ passwordReset: { id: string; revokedAt: number } }> {
    return request(`/members/${encodeURIComponent(memberId)}/password-resets`, { method: "DELETE" });
  },

  /** GET /password-resets/:token(公開・未認証)。再設定画面の表示情報のみ返す。 */
  async getPasswordResetPreview(token: string): Promise<PasswordResetPreviewDto> {
    return request(`/password-resets/${encodeURIComponent(token)}`);
  },

  /**
   * POST /password-resets/:token/use(公開・未認証)。成功するとセッションCookieが発行され、
   * そのままログイン状態になる(routes/password-resets.ts の判断点コメントと同じ、
   * acceptInvitation と同型)。
   */
  async usePasswordReset(
    token: string,
    password: string,
  ): Promise<{ user: AuthUser } | { passwordUpdated: true; error: "session_issuance_failed" }> {
    return request(`/password-resets/${encodeURIComponent(token)}/use`, { method: "POST", body: JSON.stringify({ password }) });
  },

  /** POST /members/:id/deactivate(member.deactivate)。退職処理(無効化)。 */
  async deactivateMember(memberId: string): Promise<{ member: { id: string; isActive: boolean } }> {
    return request(`/members/${encodeURIComponent(memberId)}/deactivate`, { method: "POST" });
  },

  /** POST /members/:id/reactivate(member.deactivate)。再有効化。 */
  async reactivateMember(memberId: string): Promise<{ member: { id: string; isActive: boolean } }> {
    return request(`/members/${encodeURIComponent(memberId)}/reactivate`, { method: "POST" });
  },

  /** GET /members/:id/work-policy(tenant_settings.flex.manage)。現在実効の割当+割当履歴。 */
  async getMemberWorkPolicy(memberId: string): Promise<MemberWorkPolicySettingsDto> {
    return request(`/members/${encodeURIComponent(memberId)}/work-policy`);
  },

  /** POST /members/:id/work-policy(tenant_settings.flex.manage)。新しい割当を1件追記する。 */
  async assignMemberWorkPolicy(
    memberId: string,
    input: CreateMemberWorkPolicyInput,
  ): Promise<{ assignment: CreateMemberWorkPolicyResultDto }> {
    return request(`/members/${encodeURIComponent(memberId)}/work-policy`, { method: "POST", body: JSON.stringify(input) });
  },

  async updateMemberDepartment(id: string, departmentId: string): Promise<{ member: { id: string; departmentId: string } }> {
    return request(`/members/${id}`, { method: "PATCH", body: JSON.stringify({ departmentId }) });
  },

  /** PATCH /members/:id { hireDate }(member.profile.edit)。null で未設定に戻せる。 */
  async updateMemberHireDate(id: string, hireDate: string | null): Promise<{ member: { id: string; hireDate: string | null } }> {
    return request(`/members/${id}`, { method: "PATCH", body: JSON.stringify({ hireDate }) });
  },

  /**
   * PATCH /members/:id { leaveGrantClass }(member.profile.edit)。
   * 比例付与の区分(労基法39条3項)。hireDate と違い null は無い(該当しない人は "full")。
   */
  async updateMemberLeaveGrantClass(
    id: string,
    leaveGrantClass: LeaveGrantClass,
  ): Promise<{ member: { id: string; leaveGrantClass: LeaveGrantClass } }> {
    return request(`/members/${id}`, { method: "PATCH", body: JSON.stringify({ leaveGrantClass }) });
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

  /** userId 省略時は自分自身。他人を指定するには leave.request.view_all 相当の権限が要る(apps/api/src/routes/leave.ts GET /requests)。 */
  async listLeaveRequests(status: "pending" | "all" = "all", userId?: string): Promise<{ requests: LeaveRequestDto[] }> {
    return request(`/leave/requests?status=${status}${userId ? `&userId=${encodeURIComponent(userId)}` : ""}`);
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

  /**
   * GET /leave/grant-proposals(leave.grant.manage、department_and_descendants スコープ)。
   * status 省略時は "proposed"。"all" を渡すと決裁済み(approved/rejected/superseded)も含む。
   */
  async listLeaveGrantProposals(status: LeaveGrantProposalStatus | "all" = "proposed"): Promise<{ proposals: LeaveGrantProposalDto[] }> {
    return request(`/leave/grant-proposals?status=${status}`);
  },

  /** POST /leave/grant-proposals/:id/approve(leave.grant.manage)。承認すると付与が確定する。 */
  async approveLeaveGrantProposal(id: string): Promise<{ proposal: LeaveGrantProposalDto; grant: LeaveGrantDto }> {
    return request(`/leave/grant-proposals/${encodeURIComponent(id)}/approve`, { method: "POST" });
  },

  /** POST /leave/grant-proposals/:id/reject(leave.grant.manage)。note は任意・500文字以内。 */
  async rejectLeaveGrantProposal(id: string, note?: string): Promise<{ proposal: LeaveGrantProposalDto }> {
    return request(`/leave/grant-proposals/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify(note ? { note } : {}),
    });
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

  /** GET /settings/attendance/capabilities(認証のみ、権限不要)。打刻画面がGPS要否を判断するために使う。 */
  async getAttendanceCapabilities(): Promise<AttendanceCapabilitiesDto> {
    return request("/settings/attendance/capabilities");
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

  /** GET /settings/allowances(tenant_settings.calendar.manage、勤怠設定と同じ権限)。定義ごとの現在有効な版+版の履歴。 */
  async getAllowances(): Promise<{ definitions: AllowanceDefinitionDto[] }> {
    return request("/settings/allowances");
  },

  /**
   * POST /settings/allowances。新しい手当定義(識別子+初版)を1件作成する。
   * conditions が全省略なら 400 conditions_required、effectiveFrom が過去日なら 409 effective_from_in_past。
   */
  async createAllowanceDefinition(input: CreateAllowanceDefinitionInput): Promise<{ id: string; version: AllowanceDefinitionVersionDto }> {
    return request("/settings/allowances", { method: "POST", body: JSON.stringify(input) });
  },

  /**
   * POST /settings/allowances/:definitionId/versions。既存の手当定義に新しい版を1件追加する
   * (UPDATE ではない)。既存版と同じ effectiveFrom なら 409 version_already_exists。
   */
  async createAllowanceDefinitionVersion(
    definitionId: string,
    input: CreateAllowanceDefinitionVersionInput,
  ): Promise<{ version: AllowanceDefinitionVersionDto }> {
    return request(`/settings/allowances/${encodeURIComponent(definitionId)}/versions`, { method: "POST", body: JSON.stringify(input) });
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

  /**
   * GET /audit-logs(audit_log.view、department スコープ以上、Tier 1 新設)。読み取り専用。
   * カーソルページング: nextCursor が null でなければ、それを次呼び出しの params.cursor に渡すと続きを取れる。
   */
  async listAuditLogs(params: ListAuditLogsParams = {}): Promise<{ logs: AuditLogDto[]; nextCursor: string | null }> {
    const qs = new URLSearchParams();
    if (params.actorId !== undefined) qs.set("actorId", params.actorId);
    if (params.targetType !== undefined) qs.set("targetType", params.targetType);
    if (params.targetId !== undefined) qs.set("targetId", params.targetId);
    if (params.action !== undefined) qs.set("action", params.action);
    if (params.from !== undefined) qs.set("from", String(params.from));
    if (params.to !== undefined) qs.set("to", String(params.to));
    if (params.cursor !== undefined) qs.set("cursor", params.cursor);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request(`/audit-logs${query ? `?${query}` : ""}`);
  },

  // ---- シフト制(v0.7 フェーズ3、2026-08-24 追加) ----

  /** GET /settings/shift-patterns(shift.manage、tenant スコープ)。includeArchived 省略時はアーカイブ済みを含まない。 */
  async listShiftPatterns(includeArchived?: boolean): Promise<{ patterns: ShiftPatternDto[] }> {
    const query = includeArchived ? "?includeArchived=true" : "";
    return request(`/settings/shift-patterns${query}`);
  },

  /** POST /settings/shift-patterns(shift.manage、tenant スコープ)。 */
  async createShiftPattern(input: CreateShiftPatternInput): Promise<{ pattern: ShiftPatternDto }> {
    return request("/settings/shift-patterns", { method: "POST", body: JSON.stringify(input) });
  },

  /** POST /settings/shift-patterns/:id/archive(shift.manage、tenant スコープ)。編集APIは無い(作成専用のためアーカイブのみ)。 */
  async archiveShiftPattern(id: string): Promise<{ pattern: ShiftPatternDto }> {
    return request(`/settings/shift-patterns/${encodeURIComponent(id)}/archive`, { method: "POST" });
  },

  /**
   * GET /shifts/plans?userId=&periodStart=。userId 省略時は自分自身(権限不要のセルフサービス)。
   * 他人を指定するには shift.manage(department スコープ以上)が必要。periodStart 省略時は
   * その対象者の全期間のプランを返す(期間ナビゲーションが既存プランを一覧できるようにするため)。
   */
  async listShiftPlans(params: { userId?: string; periodStart?: string } = {}): Promise<{ plans: ShiftPlanWithDaysDto[] }> {
    const qs = new URLSearchParams();
    if (params.userId !== undefined) qs.set("userId", params.userId);
    if (params.periodStart !== undefined) qs.set("periodStart", params.periodStart);
    const query = qs.toString();
    return request(`/shifts/plans${query ? `?${query}` : ""}`);
  },

  /**
   * POST /shifts/plans(shift.manage、department スコープ以上)。periodStart の日はテナント設定の
   * variablePeriodStartDay と一致している必要がある — 一致しなければ 400 period_start_mismatch
   * (レスポンスボディに正しい variablePeriodStartDay を含む、apps/api/src/routes/shifts.ts 参照)。
   */
  async createShiftPlan(input: { userId: string; periodStart: string }): Promise<{ plan: ShiftPlanDto }> {
    return request("/shifts/plans", { method: "POST", body: JSON.stringify(input) });
  },

  /**
   * PUT /shifts/plans/:id/days(shift.manage、department スコープ以上)。days は期間内の一部だけでもよい
   * (全件を毎回送る必要はない)。確定後の変更も同じ API(確定+追記型、決定事項1)。
   */
  async updateShiftPlanDays(planId: string, days: ShiftDayInput[]): Promise<ShiftPlanWithDaysDto> {
    return request(`/shifts/plans/${encodeURIComponent(planId)}/days`, { method: "PUT", body: JSON.stringify({ days }) });
  },

  /**
   * POST /shifts/plans/:id/publish(shift.manage、department スコープ以上)。
   * 409 legal_holiday_shortage(週1日/4週4日を満たさない)・already_published を返しうる。
   */
  async publishShiftPlan(planId: string): Promise<{ plan: ShiftPlanDto }> {
    return request(`/shifts/plans/${encodeURIComponent(planId)}/publish`, { method: "POST" });
  },

  /** GET /shifts/plans/:id/history(shift.manage、department スコープ以上)。変更履歴(supersede チェーン)。 */
  async getShiftPlanHistory(planId: string): Promise<ShiftPlanHistoryDto> {
    return request(`/shifts/plans/${encodeURIComponent(planId)}/history`);
  },

  /** GET /shifts/me?from=&to=(セルフサービス、権限不要)。本人のシフト(予定)を閲覧する。 */
  async getMyShifts(from: string, to: string): Promise<{ shifts: ShiftDayDto[] }> {
    return request(`/shifts/me?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
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
