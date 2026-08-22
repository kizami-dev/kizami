/**
 * 集計エンジンの型契約。
 *
 * 原則(docs/design/v01-data-model.md):
 * - 時刻は UTC エポック分(integer)。秒を持たない
 * - 日付・時刻文字列はテナントのローカル(Asia/Tokyo 想定、固定オフセット)
 * - エンジンは純関数。I/O・現在時刻・タイムゾーンDBに依存しない
 */

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

/** 有効打刻(supersedes 解決済み)。DB の形をエンジンに持ち込まない。 */
export interface ValidPunch {
  kind: PunchKind;
  /** UTC エポック分 */
  occurredAt: number;
}

/** ローカル日付 "YYYY-MM-DD" */
export type PlainDateString = string;

export interface FlexSettings {
  settlement: "monthly";
  /** コアタイムは v0.1 では未対応(null 固定) */
  core: null;
  /** 標準となる1日の労働時間(分)。有給日の枠算入に使う */
  standardDayMinutes: number;
}

export type LegalHolidayRule =
  | { kind: "weekday"; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 } // 0=日曜
  | { kind: "dates"; dates: PlainDateString[] };

export interface CalcSettings {
  /** ローカルと UTC の差(分)。Asia/Tokyo = 540。エンジンは固定オフセットのみ扱う */
  tzOffsetMinutes: number;
  /** 日界: ローカル0時からの分(0〜1439)。既定 0 */
  dayBoundaryMinutes: number;
  legalHoliday: LegalHolidayRule;
  flex: FlexSettings;
  /** v0.1 は打刻方式のみ。自動控除は v1.0 */
  breakRule: { mode: "punch" };
}

/** effective-dated 設定(原則6)。from はローカル日付、その日から有効 */
export interface SettingsSpan {
  from: PlainDateString;
  settings: CalcSettings;
}

export interface EngineInput {
  punches: ValidPunch[];
  /** from 昇順。期間初日以前に有効な版を必ず1つ含むこと */
  settingsTimeline: SettingsSpan[];
  period: { year: number; month: number };
  /**
   * 有給取得(所定労働扱いで枠に算入)。
   * 全休は minutes = 所定労働時間、時間単位年休はその取得分数。
   * 同じ日に複数エントリがある場合は合算する(午前2時間+午後1時間など)。
   */
  paidLeave: PaidLeaveEntry[];
}

/** 有給の取得。日単位・時間単位のどちらも「その日に何分ぶん有給を使ったか」で表す */
export interface PaidLeaveEntry {
  date: PlainDateString;
  minutes: number;
}

/**
 * 不正打刻列の解釈ルール(2026-08-21 決定: 保守的解釈)
 * - 不完全な区間は労働時間に数えない(過大計上を構造的に防ぐ)
 * - 文脈上ありえない打刻は無効化する(データは残るため修正申請で正せる)
 * - いずれも必ず警告を発する
 */
export type WarningKind =
  /** clock_in のまま終端: その勤務区間全体を集計から除外 */
  | "missing_clock_out"
  /** 勤務中の再 clock_in: 無効化(先勝ち) */
  | "duplicate_clock_in"
  /** 勤務外の clock_out: 無効化 */
  | "clock_out_without_in"
  /** 勤務外の break 打刻: 無効化 */
  | "break_outside_work"
  /** 休憩中の再 break_start: 無効化 */
  | "duplicate_break_start"
  /** 休憩中でないのに break_end: 無効化 */
  | "unmatched_break_end"
  /** 休憩中に clock_out: 休憩を clock_out 時刻で閉じて退勤扱い(労働時間は減る方向) */
  | "clock_out_during_break";

export interface CalcWarning {
  kind: WarningKind;
  /** 帰属する勤怠日(ローカル) */
  date: PlainDateString;
  /** 対象打刻の時刻(UTC エポック分) */
  punchAt?: number;
}

export type TimeCategory =
  | "statutory"
  | "overtime"
  | "overtime60h"
  | "lateNight"
  | "statutoryHoliday";

export type CategorizedMinutes = Readonly<Record<TimeCategory, number>>;

export interface DailyBreakdown {
  date: PlainDateString;
  /** 実労働(休憩控除後)。法定休日の労働は workedMinutes に含めず legalHolidayMinutes へ */
  workedMinutes: number;
  breakMinutes: number;
  /** 暦時刻 22:00〜翌5:00 と実労働の重なり(法定休日分も含む) */
  lateNightMinutes: number;
  isLegalHoliday: boolean;
  legalHolidayMinutes: number;
  /** その日に有給を使ったか(全休・時間単位を問わず minutes > 0 なら true) */
  isPaidLeave: boolean;
  /** その日の有給分数(枠算入は flexBalance 側で行う) */
  paidLeaveMinutes: number;
}

export interface FlexBalance {
  /** 月の総枠: floor(週40h × 暦日数 / 7)(分) */
  frameMinutes: number;
  /** 実績: 法定休日以外の実労働 + 有給日 × standardDayMinutes */
  actualMinutes: number;
  /** actual - frame(負=不足) */
  diffMinutes: number;
}

export interface EngineOutput {
  days: DailyBreakdown[];
  totals: CategorizedMinutes;
  flexBalance: FlexBalance;
  warnings: CalcWarning[];
}
