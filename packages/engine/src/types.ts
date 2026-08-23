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
  breakRule: BreakRule;
}

/**
 * 自動控除のルール1件(docs/design/breaks.md「採る設計」)。
 * 実労働(休憩控除後)が `overMinutes` を超えたら発動し、`deductMinutes`(モードによる調整後)
 * と「実労働 − overMinutes」の小さい方を実効控除として控除する — 控除しても実労働が
 * `overMinutes` を割り込むことはない。複数ルールが同時に発動する場合は実効控除が最大の
 * ものを採用する(同値なら `overMinutes` が大きい方)。判定・適用の詳細な意味論(閾値の
 * 選び方・punch/both との組み合わせ)は auto-break.ts の selectRule 参照。
 */
export interface AutoBreakRule {
  overMinutes: number;
  deductMinutes: number;
}

/**
 * 休憩控除のルール(判別可能ユニオン、docs/design/breaks.md)。
 * 自動控除を「打刻を生成する」形で実装しない代わりに、集計時にこのルールで控除する
 * (breaks.md「採る設計」節)。
 */
export type BreakRule =
  /** 打刻された休憩のみ控除(現行) */
  | { mode: "punch" }
  /** 打刻を無視し、実労働に応じた所定の休憩を控除する。rules は複数件でも良い(閾値の異なる階層) */
  | { mode: "auto"; rules: AutoBreakRule[] }
  /** 打刻された休憩を使い、rules の控除量に満たなければ差分を追加控除する */
  | { mode: "both"; rules: AutoBreakRule[] };

/** effective-dated 設定(原則6)。from はローカル日付、その日から有効 */
export interface SettingsSpan {
  from: PlainDateString;
  settings: CalcSettings;
}

/**
 * 手当定義(docs/design/allowances.md)。金額は持たない — エンジンが算出するのは
 * 「対象になる勤務が何分あったか」まで(要件§1、割増率・支給額は給与側の責任)。
 *
 * `conditions` は次の AND 条件(すべて省略可、省略した条件は「制約なし」):
 * - `dates`: 特定日のリスト。"2027-01-01"(固定日付)と "--12-31"(毎年、月日のみ一致)の
 *   両形式を混在させられる
 * - `weekdays`: 曜日のリスト(0=日曜〜6=土曜)
 * - `timeBand`: 時間帯(ローカル分、0〜1439)。startMinutes > endMinutes で日跨ぎを表す
 *   (22:00〜翌6:00 = startMinutes:1320, endMinutes:360)。startMinutes < endMinutes は
 *   日をまたがない帯(6:00〜8:00)。省略時は終日
 *
 * 全条件を省略した定義(=常に全時間が対象)は意味を持たない設定ミスであり、apps/api の
 * バリデーションで作成時に弾く(engine 自体は「全時間帯が対象」として素直に扱う — 純関数と
 * して「入力の意味的な妥当性」までは関知しないという既存の役割分担に合わせた)。
 */
export interface AllowanceDefinition {
  id: string;
  name: string;
  conditions: {
    dates?: PlainDateString[];
    weekdays?: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
    timeBand?: { startMinutes: number; endMinutes: number };
  };
}

/**
 * effective-dated な手当定義(`settingsTimeline` と同じ「from 昇順、from はこの日から有効」の
 * 契約)。ただし settingsTimeline(テナントにつき1系列)と違い、複数の手当定義が並行して
 * 存在しうる(定義ごとに独立した版の系列を持つ) — `definition.id` が系列の識別子であり、
 * 同じ `id` を持つ span の中で `from <= 対象日` の最大のものがその日に有効な版になる
 * (allowances.ts の resolveAllowanceDefinitionsForDate 参照)。
 */
export interface AllowanceTimelineSpan {
  from: PlainDateString;
  definition: AllowanceDefinition;
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
  /**
   * 承認済みの自動控除打ち消し(waiver)日。ここに含まれる日に始まる勤務区間には
   * 自動控除(breakRule の auto/both)を適用しない(docs/design/breaks.md「採る設計」)。
   * 打刻を修正するのではなく独立した申請として扱うため、打刻列とは別にこの配列で渡す。
   */
  autoBreakWaivedDates?: PlainDateString[];
  /**
   * 手当定義(effective-dated)。省略・空配列なら手当算出は行わず、全日の
   * `DailyBreakdown.allowances` は空配列、`EngineOutput.allowanceTotals` も空配列になる
   * (省略可能にしているのは、手当を1件も定義していないテナントで無駄な計算をしないため)。
   */
  allowances?: AllowanceTimelineSpan[];
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
   * この勤務区間の実労働(分)。**自動控除(breakRule の auto/both)を適用した後**の値
   * (auto-break.ts 参照)。休憩不足判定(labor law §34-1)は勤怠日ではなくこの単位で行う
   * (break-check.ts 参照)。未退勤なら null(確定していない)。
   */
  workedMinutes: number | null;
  /**
   * この勤務区間の打刻由来の休憩合計(分)。自動控除は含まない
   * (`autoDeductedBreakMinutes` に分けて持つ — DailyBreakdown と同じ理由)。未退勤なら null
   */
  breakMinutes: number | null;
  /**
   * この勤務区間で自動控除された休憩(分)。breakRule が "punch" か、waiver 適用日か、
   * 実労働がどのルールの閾値にも届かなければ 0。未退勤なら null(自動控除もまだ確定しない)
   */
  autoDeductedBreakMinutes: number | null;
}

export interface DailyBreakdown {
  date: PlainDateString;
  /** 実労働(休憩控除後)。法定休日の労働は workedMinutes に含めず legalHolidayMinutes へ */
  workedMinutes: number;
  /** 打刻由来の休憩(分)。自動控除は含まない(下記 autoDeductedBreakMinutes 参照) */
  breakMinutes: number;
  /**
   * 自動控除された休憩(分、breakRule が auto/both のときのみ非0になりうる)。
   * breakMinutes(打刻由来)とは合算しない — 本人が「これは自動で引かれた分だ」と
   * 気づけることが要件だから(docs/design/breaks.md「採る設計」)。
   */
  autoDeductedBreakMinutes: number;
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
  /**
   * この日の手当対象時間(定義ごと)。0分になった定義は含めない(sparse — UI は
   * 「手当対象時間がある日だけ小さく表示する」ため、空配列がほとんどの日の既定値になる想定)。
   * 法定区分(lateNightMinutes 等)とは独立で、同じ1分が両方に計上されることもある
   * (docs/design/allowances.md「エンジンでの算出」)。
   */
  allowances: Array<{ definitionId: string; minutes: number }>;
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
  /**
   * 手当定義ごとの月合計(分)。期間内のいずれかの日に有効だった定義は、その月の合計が
   * 0分でも1件として含める(締め・CSV で「定義はあるが今月は対象時間なし」を表現するため —
   * DailyBreakdown.allowances が sparse なのとは扱いを変えている)。
   */
  allowanceTotals: Array<{ definitionId: string; minutes: number }>;
}
