/**
 * 集計エンジンの型契約。
 *
 * 原則(docs/design/v01-data-model.md):
 * - 時刻は UTC エポック分(integer)。秒を持たない
 * - 日付・時刻文字列はテナントのローカル(Asia/Tokyo 想定、固定オフセット)
 * - エンジンは純関数。I/O・現在時刻・タイムゾーンDBに依存しない
 *
 * 判断点(2026-08-22, 法令パッケージの結線): 週法定労働時間・深夜帯・60時間超区分の
 * 有効/閾値・36協定の各上限といった法令由来の値は、以前は本パッケージ内にハードコードして
 * いたが、法改正の施行日で自動的に切り替わるべき値であるため `@kizami/law` の `LawRules` を
 * 入力(`EngineInput.lawTimeline`)として受け取る形に変更した。`@kizami/law` は
 * ランタイム非依存・依存ゼロの純粋パッケージであり、engine → law の一方向依存は
 * 「純関数のみ・DB非依存」という本パッケージの制約(要件 §8/§9)を破らない。
 */
import type { LawRules } from "@kizami/law";

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

/** 有効打刻(supersedes 解決済み)。DB の形をエンジンに持ち込まない。 */
export interface ValidPunch {
  kind: PunchKind;
  /** UTC エポック分 */
  occurredAt: number;
}

/** ローカル日付 "YYYY-MM-DD" */
export type PlainDateString = string;

/**
 * 労働時間制(判別可能ユニオン)。`kind` で分岐する。
 *
 * `standardDayMinutes` は両方の branch に存在する。固定時間制では「所定労働時間」そのもの
 * (日次の所定内/所定外法定内の境界に使う)、フレックスでは有給日の枠算入に使う値であり、
 * 意味は違うが「その日の基準となる労働時間」という役割は共通しているため、フィールド名を揃えている。
 */
export type WorkSystem =
  | {
      kind: "flex";
      settlement: "monthly";
      /** コアタイムは v0.1 では未対応(null 固定) */
      core: null;
      /** 標準となる1日の労働時間(分)。有給日の枠算入に使う */
      standardDayMinutes: number;
    }
  | {
      kind: "fixed";
      /** 所定労働時間(分)。1日8時間(法定)以内で設定される前提 */
      standardDayMinutes: number;
    };

/** フレックス(月清算)の設定。`WorkSystem` の flex 分岐と同じ形(判別子 `kind` を除く)。 */
export type FlexSettings = Omit<Extract<WorkSystem, { kind: "flex" }>, "kind">;

export type LegalHolidayRule =
  | { kind: "weekday"; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 } // 0=日曜
  | { kind: "dates"; dates: PlainDateString[] };

export interface CalcSettings {
  /** ローカルと UTC の差(分)。Asia/Tokyo = 540。エンジンは固定オフセットのみ扱う */
  tzOffsetMinutes: number;
  /** 日界: ローカル0時からの分(0〜1439)。既定 0 */
  dayBoundaryMinutes: number;
  /**
   * 週の起算曜日(0=日曜)。固定時間制の週法定労働時間の判定(labor law §32-1)に使う。
   * フレックスの月枠計算では使わない(月枠は暦日数ベースのため)。
   */
  weekStartWeekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  legalHoliday: LegalHolidayRule;
  workSystem: WorkSystem;
  /** v0.1 は打刻方式のみ。自動控除は v1.0 */
  breakRule: { mode: "punch" };
}

/** effective-dated 設定(原則6)。from はローカル日付、その日から有効 */
export interface SettingsSpan {
  from: PlainDateString;
  settings: CalcSettings;
}

/**
 * effective-dated な法令ルール(`settingsTimeline` と同じ流儀)。`@kizami/law` の
 * `buildLawTimeline` が返す形とそのまま一致する。from はローカル日付、その日から有効。
 */
export interface LawTimelineSpan {
  from: PlainDateString;
  law: LawRules;
}

export interface EngineInput {
  punches: ValidPunch[];
  /** from 昇順。期間初日以前に有効な版を必ず1つ含むこと */
  settingsTimeline: SettingsSpan[];
  /** from 昇順。期間初日以前に有効な版を必ず1つ含むこと(`@kizami/law` の `buildLawTimeline` と同じ契約) */
  lawTimeline: LawTimelineSpan[];
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
  | "clock_out_during_break"
  /** 期間の途中で労働時間制(flex/fixed)が切り替わった: 期間開始日の版で計算を続行する */
  | "mixed_work_system"
  /** 勤務区間の実労働に対して休憩(合計)が労基法34条1項の必要分に満たない: 不足量を警告 */
  | "insufficient_break";

export interface CalcWarning {
  kind: WarningKind;
  /** 帰属する勤怠日(ローカル) */
  date: PlainDateString;
  /** 対象打刻の時刻(UTC エポック分) */
  punchAt?: number;
  /**
   * insufficient_break のとき: 必要だった休憩と実際の休憩(分)。UI が不足量
   * (requiredMinutes - actualMinutes)を出すのに使う。他の警告種別では未設定。
   */
  break?: { requiredMinutes: number; actualMinutes: number };
}

export type TimeCategory =
  | "statutory"
  | "overtime"
  | "overtime60h"
  | "lateNight"
  | "statutoryHoliday";

export type CategorizedMinutes = Readonly<Record<TimeCategory, number>>;

/** その勤怠日に始まった勤務区間(出勤〜退勤の1まとまり)。打刻の事実を表示するための情報。 */
export interface WorkStretch {
  /** UTC エポック分 */
  clockInAt: number;
  /** 退勤打刻。未退勤(missing_clock_out で集計除外)なら null */
  clockOutAt: number | null;
  /**
   * この勤務区間の実労働(休憩控除後、分)。休憩不足判定(labor law §34-1)は
   * 勤怠日ではなくこの単位で行う(break-check.ts 参照)。未退勤なら null(確定していない)。
   */
  workedMinutes: number | null;
  /** この勤務区間の休憩合計(分)。未退勤なら null */
  breakMinutes: number | null;
}

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
  /**
   * その日に始まった勤務区間。中抜けがあれば複数。集計対象外(missing_clock_out で
   * discard された未退勤の区間)も打刻の事実として含む — 集計と表示は別物として扱う。
   */
  stretches: WorkStretch[];
  /** 所定内(実労働のうち標準労働時間まで)。固定時間制のみ。フレックスでは 0 */
  withinScheduledMinutes: number;
  /** 所定外だが法定内(所定超〜1日8時間)。固定時間制のみ。フレックスでは 0 */
  extraWithinStatutoryMinutes: number;
  /** 法定時間外(日8時間超 + 週法定超)。固定時間制のみ。フレックスでは 0 */
  statutoryOvertimeMinutes: number;
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
  /** フレックスのみ。固定時間制では null */
  flexBalance: FlexBalance | null;
  /** 期間開始日に有効だった労働時間制 */
  workSystem: "flex" | "fixed";
  warnings: CalcWarning[];
}
