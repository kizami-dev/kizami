/**
 * @kizami/leave の型契約。
 *
 * 原則(packages/engine と同じ方針、docs/requirements.md §5/§9):
 * - 純関数のみ。I/O・Date.now()・タイムゾーン暗黙依存を持たない
 * - 日付は "YYYY-MM-DD"(呼び出し側のローカル日付。テナントのローカル解決は apps/api が担う)
 * - **残高・消化はすべて「分」で管理する**(2026-08-22 仕様拡張: 時間単位年休対応)。
 *   `days`(付与日数)は法令上の管理単位として保持するが、内部の消化・残高計算は
 *   `days × standardDayMinutes` に換算した分単位で行う。
 * - 呼び出し側(apps/api)が unit(全休/半休/時間単位)ごとの分数をあらかじめ解決してから
 *   渡す設計とし、本パッケージは「標準的な1日の分数(標準労働時間)」を係数として使うだけに
 *   留める(半休の分数計算=standardDayMinutes/2、時間単位=申請された分、のいずれも
 *   呼び出し側で解決してから LeaveUsageInput.minutes に入れる)。
 */

export type PlainDateString = string;

/** テナントの有給付与方式。 */
export type GrantMethod = "statutory" | "fixed_date";

/** annual: 通常の年次有給休暇。stocked: 時効失効分の積立休暇(失効年休積立制度)。 */
export type LeaveType = "annual" | "stocked";

/**
 * 取得単位(2026-08-22 仕様拡張)。法的な扱いが異なるため区別する:
 * - full_day: 全休。労使協定不要。年5日取得義務に1.0日としてカウント
 * - half_day_am / half_day_pm: 半休。労使協定不要(行政解釈)。年5日取得義務に0.5日としてカウント。
 *   時間単位年休の「年5日分上限」の対象外
 * - hourly: 時間単位年休。労使協定が前提(テナント設定 hourlyLeaveEnabled)。
 *   年5日取得義務には一切カウントできない。年5日分(5×standardDayMinutes)の専用上限を持つ
 */
export type LeaveUnit = "full_day" | "half_day_am" | "half_day_pm" | "hourly";

/** calculateStatutoryGrants() が返す、まだ DB に永続化されていない付与予定。 */
export interface CalculatedGrant {
  leaveType: "annual";
  grantedOn: PlainDateString;
  days: number;
  expiresOn: PlainDateString;
}

/** 残高計算に使う、既に存在する付与(DB行相当)。 */
export interface LeaveGrantInput {
  id: string;
  leaveType: LeaveType;
  grantedOn: PlainDateString;
  days: number;
  expiresOn: PlainDateString;
}

/**
 * 残高計算に使う、既に承認済み(または検証対象の候補)の1件の休暇消化。
 * `minutes` は呼び出し側で unit ごとに解決済みの分数(下記参照)。
 */
export interface LeaveUsageInput {
  id: string;
  date: PlainDateString;
  unit: LeaveUnit;
  /** 消化する分数。呼び出し側で解決する: full_day=standardDayMinutes / half_day_*=standardDayMinutes/2 / hourly=申請された分 */
  minutes: number;
  leaveType: LeaveType;
}

/** 1件の付与について、消化・残高を分単位で表した状態。 */
export interface GrantAllocationState {
  id: string;
  leaveType: LeaveType;
  grantedOn: PlainDateString;
  days: number;
  /** days × standardDayMinutes */
  grantedMinutes: number;
  expiresOn: PlainDateString;
  usedMinutes: number;
  /** unit='hourly' の消化のみの累計(年5日分上限の判定に使う) */
  hourlyUsedMinutes: number;
  /** 時効済み(asOf >= expiresOn)の場合は 0 に補正される */
  remainingMinutes: number;
  expired: boolean;
}

export type UsageRejectReason = "no_capacity" | "hourly_limit_exceeded";

/** 1件の消化が、どの付与から充当されたか(充当できなければ null + 理由)。 */
export interface UsageAllocationResult {
  usageId: string;
  grantId: string | null;
  reason?: UsageRejectReason;
}

export interface AllocationResult {
  byGrant: GrantAllocationState[];
  usages: UsageAllocationResult[];
}

export interface LeaveTypeSummary {
  totalGrantedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  expiringSoon: GrantAllocationState[];
  byGrant: GrantAllocationState[];
}

export interface LeaveBalanceResult {
  standardDayMinutes: number;
  annual: LeaveTypeSummary;
  stocked: LeaveTypeSummary;
}

/** 年5日取得義務の状況(1付与=1期間)。taken/shortage は 0.5 日刻み(半休の0.5日算入があるため)。 */
export interface MandatoryFiveDaysStatus {
  grantId: string;
  periodStart: PlainDateString;
  /** 排他的上限(この日を含まない) */
  periodEnd: PlainDateString;
  taken: number;
  required: number;
  shortage: number;
  /** = periodEnd。この日の前日までに義務を満たす必要がある */
  deadline: PlainDateString;
  satisfied: boolean;
}

/** 失効した年次有給1件について、積立休暇への振替候補を表す。 */
export interface StockConversionCandidate {
  sourceGrantId: string;
  leftoverMinutes: number;
  leftoverDays: number;
  convertedDays: number;
  truncatedDays: number;
}

/**
 * allocateLeaveUsages / calculateBalance に共通のオプション。
 *
 * hourlyLeaveMaxDays: 時間単位年休の年度あたり上限日数(労使協定、1〜5日。既定5)。
 * 上限(分)は `hourly.ts` の hourlyLeaveCapMinutes(standardDayMinutes, hourlyLeaveMaxDays) で算出する
 * (1時間未満切り上げ。根拠は hourly.ts のコメント参照)。
 */
export interface AllocationOptions {
  standardDayMinutes: number;
  hourlyLeaveMaxDays: number;
  asOf: PlainDateString;
}
