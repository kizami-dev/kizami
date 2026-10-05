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
 * コアタイム(フレックスタイム制で「必ず勤務すべき時間帯」。労基法32条の3、**任意**設定)。
 *
 * 制度上の性質(docs/design/work-systems.md「コアタイム」):
 * - コアタイムを定めるかどうかは労使協定の任意事項であり、定めなければスーパーフレックス
 * - コアタイム中の不在は「遅刻・早退」として扱えるが、**清算期間の総枠(集計)には影響しない**。
 *   フレックスの時間外は清算期間の総枠との差でしか決まらないため(work-systems.md 参照)、
 *   コアタイムを外れても労働時間そのものは1分も増減しない
 * - よって KIZAMI はコアタイムを **警告としてだけ**扱う(auto-break と同じ
 *   「計測と警告のみ、控除しない」— 賃金控除は給与側の責任、docs/design/breaks.md)
 *
 * 表現(判断点):
 * - `startMinutes` / `endMinutes` はローカル0時からの分(0〜1440)。`ShiftDay` と違い
 *   **日跨ぎ(endMinutes <= startMinutes)は表現しない** — コアタイムは「1日の中の、
 *   全員が居るべき日中の帯」という制度前提であり、夜勤の帯を表す必要がない。
 *   日跨ぎのコアタイムを許すと「その帯はどの勤怠日に属するのか」という
 *   (シフト制と違って所定の裏付けが無いまま解かねばならない)問題を抱え込む。
 *   不正な値は apps/api の POST /settings/work-policy が 400 で弾く。エンジン自体は
 *   純関数として意味的な妥当性までは関知しないが、帯として成立しない値
 *   (endMinutes <= startMinutes)は「帯が無い」とみなして警告を出さない(core-time.ts 参照)
 * - `weekdays` は「コアタイムが適用される曜日」。省略時は月〜金
 */
export interface CoreTime {
  /** ローカル0時からの分(0〜1440)。コアタイム開始 */
  startMinutes: number;
  /** ローカル0時からの分(0〜1440)。コアタイム終了。startMinutes より大きいこと */
  endMinutes: number;
  /**
   * コアタイムが適用される曜日(0=日曜)。省略時は月〜金(1〜5)。
   *
   * 判断点(2026-08-24): フレックスには monthly_variable の `ShiftDay` のような
   * 「所定労働日カレンダー」が無く、エンジンが日付から知りうる休みは**法定休日だけ**である。
   * 土曜のような所定休日(法定休日ではない非勤務日)を区別できないまま
   * `core_time_absence`(不在)を出すと、週休2日の会社では毎週土曜に誤報が出る。
   * 曜日の集合をコアタイム設定自体に持たせることで、追加のカレンダー機構を導入せずに
   * これを防ぐ(実務でもコアタイムは「平日10:00〜15:00」のように曜日とセットで定められる)。
   */
  weekdays?: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
}

/**
 * 労働時間制(判別可能ユニオン)。`kind` で分岐する。
 *
 * `standardDayMinutes` は flex/fixed の両方の branch に存在する。固定時間制では
 * 「所定労働時間」そのもの(日次の所定内/所定外法定内の境界に使う)、フレックスでは
 * 有給日の枠算入に使う値であり、意味は違うが「その日の基準となる労働時間」という役割は
 * 共通しているため、フィールド名を揃えている。
 *
 * `monthly_variable`(1ヶ月単位の変形労働時間制、労基法32条の2、docs/design/shift-work.md)は
 * `standardDayMinutes` を持たない — 日ごとの所定は定数ではなく `EngineInput.shifts` の
 * `ShiftDay` が個別に決めるため(シフト制の本質: 所定がテナント単位の定数から
 * user×日付の可変データになる)。
 */
export type WorkSystem =
  | {
      kind: "flex";
      settlement: "monthly";
      /**
       * コアタイム(労基法32条の3、任意設定)。null なら「コアタイムなし」
       * (スーパーフレックス)で、コアタイム由来の警告は一切出ない。
       */
      core: CoreTime | null;
      /**
       * 標準となる1日の労働時間(分)。有給日の枠算入に使う。`totalHoursBasis` が
       * "scheduled_days" のときは、契約上の枠(所定労働日数 × この値)の掛け算にも使う
       */
      standardDayMinutes: number;
      /**
       * 清算期間の総労働時間(労使協定で定める「清算期間における総労働時間」、労基法32条の3第1項2号)の
       * 決め方。省略時は "statutory_frame"(2026-10-05 より前と同じ挙動)。
       *
       * - "statutory_frame": 法定の枠(週の法定労働時間 × 暦日数 ÷ 7)をそのまま総労働時間とする。
       *   過不足も時間外も法定の枠と比べる2段の計算
       * - "scheduled_days": 契約上の枠 = 清算期間の所定労働日数 × `standardDayMinutes`。
       *   過不足は契約上の枠と比べ、契約上の枠〜法定の枠を法定内超過、法定の枠超を法定外とする
       *   3段の計算(flex.ts 参照)。所定労働日は `EngineInput.flexContract.scheduledWorkDates` で渡す
       *
       * 判断点(2026-10-05、時短勤務の第2段階): 既定を法定の枠にしたのは、既存のテナントの数字を
       * 1分も変えないため。所定6時間の人は法定の枠と比べると毎月大きな「不足」に見えるので、
       * 時短フレックスの制度では "scheduled_days" を選ぶ(docs/design/work-systems.md)。
       */
      totalHoursBasis?: FlexTotalHoursBasis;
      /**
       * 不足(契約上の枠に届かなかった時間)を翌月へ繰り越すか。省略時は false。
       *
       * 繰り越すと翌月の契約上の枠に上乗せされる。上乗せは翌月の法定の枠を超えない範囲に限り、
       * 超える分はその月の不足として確定する(`FlexBalance.confirmedShortfallMinutes`)。
       * **超過(余剰)は繰り越さない** — 当月の労働に対する賃金を翌月へ回すことは、賃金の
       * 全額払い(労基法24条)に反するため(昭63.1.1 基発1号)。
       * "statutory_frame" では上乗せの余地(法定の枠 − 総労働時間)が常に0なので、繰り越しは起きない
       * (API は "scheduled_days" でしか true を受け付けない)。
       */
      carryOverShortfall?: boolean;
    }
  | {
      kind: "fixed";
      /** 所定労働時間(分)。1日8時間(法定)以内で設定される前提 */
      standardDayMinutes: number;
    }
  | {
      kind: "monthly_variable";
      /**
       * 変形期間の起点日(1〜28、docs/design/shift-work.md 決定事項3)。
       * 期間はこの日から翌月の同日前日までの1ヶ月(例: 16なら16日〜翌15日)。
       * 1〜28に制限しているのは、29〜31日だと月によって存在せず期間の起点が
       * 一意に決まらなくなるため(2月は28日までしかない)。
       */
      periodStartDay: number;
    };

/** フレックス(月清算)の設定。`WorkSystem` の flex 分岐と同じ形(判別子 `kind` を除く)。 */
export type FlexSettings = Omit<Extract<WorkSystem, { kind: "flex" }>, "kind">;

/** フレックスの総労働時間の決め方(`WorkSystem` の flex 分岐の `totalHoursBasis` 参照) */
export type FlexTotalHoursBasis = "statutory_frame" | "scheduled_days";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 所定休日のカレンダー(2026-10-05、フレックスの契約上の枠のため)。テナントの設定で、
 * 「どの日が所定労働日か」を決める。
 *
 * 所定休日と法定休日の関係(判断点):
 * - **法定休日**(労基法35条: 毎週1日、または4週4日)は割増率(35%)の区分を決めるための休日で、
 *   既存の `LegalHolidayRule` が表す。**所定休日**は就業規則で「働かなくてよい」と定めた日の全体
 *   (土日・祝日・年末年始など)で、法定休日はその一部にあたる
 * - したがって所定労働日は「このカレンダーで所定休日でない」かつ「法定休日でない」日。カレンダーに
 *   法定休日の曜日を入れ忘れても、法定休日は必ず所定休日として扱う(calendar.ts)。逆に
 *   カレンダーの所定休日を法定休日として扱うことはない(割増の区分は法定休日の設定だけで決まる)
 * - 法定休日でない所定休日(週休2日の土曜など)に働いた時間は、フレックスでは通常の労働時間として
 *   総労働時間に積み上がる(所定休日の労働という独立した区分は持たない — payroll-export.ts の
 *   freee の列の扱いと同じ)
 */
export interface ScheduledHolidayCalendar {
  /** 所定休日の曜日(0=日曜)。既定は土・日 */
  weekdays: Weekday[];
  /** 国民の祝日(振替休日・国民の休日を含む)を所定休日にするか。既定は true */
  nationalHolidays: boolean;
  /** 曜日・祝日とは別に所定休日にする日(年末年始・夏季休業など) */
  extraHolidays: PlainDateString[];
  /**
   * 曜日・祝日の規則から外して所定労働日にする日(祝日だが営業する日など)。
   * `extraHolidays` と同じ日が両方にあれば所定労働日を優先する。法定休日は外せない
   */
  extraWorkdays: PlainDateString[];
}

/** effective-dated な所定休日のカレンダー(`SettingsSpan` と同じ「from 昇順、この日から有効」の契約) */
export interface CalendarTimelineSpan {
  from: PlainDateString;
  calendar: ScheduledHolidayCalendar;
}

/**
 * フレックスの契約上の枠と繰越の入力(`EngineInput.flexContract`)。
 * 期間開始日の制度が `totalHoursBasis: "scheduled_days"` のフレックスのときだけ使う。
 *
 * エンジンは「所定労働日の一覧」と「前月から受け入れる繰越」「翌月が受け入れられる繰越の上限」を
 * 受け取るだけで、前月・翌月を自分で計算しない(打刻・設定と同じ「入力は呼び出し側が集めて渡す」
 * 原則)。前月の繰越の取り方(締め済みはスナップショット、締め前はその場で計算、遡る深さの上限)は
 * apps/api/src/lib/flex-contract.ts が担う。
 */
export interface FlexContractInput {
  /**
   * 期間内の所定労働日(`listScheduledWorkDates` の結果)。契約上の枠 = これらの日の
   * `standardDayMinutes`(その日に有効な版)の合計
   */
  scheduledWorkDates: PlainDateString[];
  /** 前月の不足のうち、この月へ繰り越されてきた分(分、0以上)。前月の `carryOutMinutes` */
  carryInMinutes: number;
  /**
   * 翌月が受け入れられる繰越の上限(分、0以上)= 翌月の法定の枠 − 翌月の契約上の枠。
   * この月の不足のうち、これを超える分は繰り越さずこの月の不足として確定する。
   * 省略時は 0(全額をこの月で確定)。`carryOverShortfall` が false なら使わない
   */
  nextPeriodCarryCapacityMinutes?: number;
  /**
   * 前月の繰越を遡る深さの上限に達して、それより前の繰越を0とみなしたか
   * (true なら `flex_carry_chain_truncated` 警告を出す)
   */
  carryChainTruncated?: boolean;
  /**
   * 国民の祝日のデータが無い年を含むカレンダーで所定労働日を数えたか
   * (true なら `national_holiday_data_unavailable` 警告を出す。`listScheduledWorkDates` の結果をそのまま渡す)
   */
  nationalHolidayDataUnavailable?: boolean;
}

export type LegalHolidayRule =
  | { kind: "weekday"; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 } // 0=日曜
  | { kind: "dates"; dates: PlainDateString[] };

/**
 * シフト制(monthly_variable)における1日の所定(docs/design/shift-work.md 決定事項5)。
 *
 * 固定時間制・フレックスの所定はテナント設定の定数だったが、シフト制では所定が
 * user×日付の可変データになる。エンジンはこれを `EngineInput.shifts` という
 * 新しいタイムラインとして受け取る(打刻・設定・法令と同じ「入力は呼び出し側が集めて渡す」原則)。
 *
 * `dayType` が "work" 以外(legal_holiday/non_working)の日は startMinutes/endMinutes/
 * breakMinutes をすべて 0 にする契約(呼び出し側が保証する。エンジンはこれらのフィールドを
 * work 以外の日について参照しない — variable.ts の scheduledMinutesForShift 参照)。
 */
export interface ShiftDay {
  date: PlainDateString;
  dayType: ShiftDayType;
  /** ローカル0時からの分(dayBoundaryMinutes と同じ表現)。dayType が work 以外なら 0 */
  startMinutes: number;
  /**
   * ローカル0時からの分。startMinutes より小さければ日跨ぎ(翌日の朝にまたがる夜勤)を表す
   * (22:00〜翌6:00 = startMinutes:1320, endMinutes:360)。dayType が work 以外なら 0
   */
  endMinutes: number;
  /** dayType が work 以外なら 0 */
  breakMinutes: number;
}

export type ShiftDayType = "work" | "legal_holiday" | "non_working";

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
  /**
   * シフト(monthly_variable の所定、docs/design/shift-work.md 決定事項5)。
   *
   * 契約: `period` の月内の日だけでなく、**変形期間全体**(`periodStartDay` 起点の1ヶ月。
   * 月をまたぐため前後の月の日を含みうる)ぶんを渡すこと。③期間段の時間外判定
   * (variable.ts)には期間全体の実労働・所定が要るため、`punches` も同様に期間全体分を
   * 渡す前提になる(`period` の月範囲外の日は `EngineOutput.days` には出さないが、
   * ③の計算には使う)。monthly_variable 以外の労働時間制では無視して構わない。
   */
  shifts?: ShiftDay[];
  /**
   * 判定基準日(ローカル日付、通常は「今日」)。指定すると、この日**以降**(当日を含む)の
   * `shift_absence`(欠勤の可能性)は出さない — まだ来ていない勤務日や進行中の当日に
   * 「実労働がありません」と警告するのは誤報であり、2026-08-24 の撮影で未来日が全行警告に
   * なる形で表面化した。省略時は従来どおり全日を判定する(締め済み月の再計算など、
   * 期間全体が過去で確定している呼び出し向け)。エンジンは Date.now() を持たない純関数
   * なので、基準日は呼び出し側が渡す。
   */
  asOfDate?: PlainDateString;
  /**
   * フレックスの契約上の枠と繰越(2026-10-05、`FlexContractInput` 参照)。期間開始日の制度が
   * `totalHoursBasis: "scheduled_days"` のフレックスでなければ無視する。
   * "scheduled_days" なのに省略された場合は所定労働日0日(契約上の枠0分)として扱う —
   * 呼び出し側の配線漏れを、法定の枠にこっそり戻すのではなく数字の異常として表に出すため。
   */
  flexContract?: FlexContractInput;
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
  /** 期間の途中で労働時間制(flex/fixed/monthly_variable)が切り替わった: 期間開始日の版で計算を続行する */
  | "mixed_work_system"
  /** 勤務区間の実労働に対して休憩(合計)が労基法34条1項の必要分に満たない: 不足量を警告 */
  | "insufficient_break"
  /**
   * シフト予実の乖離(docs/design/shift-work.md「予実の突合」、shift-variance.ts)。
   * 集計(totals)には反映しない — 遅刻控除等の賃金処理は給与側の責任という既存の原則を踏襲する。
   */
  /** monthly_variable なのにその日の ShiftDay が無く、かつ実労働がある: 所定0として①②を判定した */
  | "missing_shift"
  /** シフトの開始時刻より遅い最初の出勤 */
  | "shift_late_arrival"
  /** シフトの終了時刻より早い最後の退勤 */
  | "shift_early_leave"
  /** シフトが work 以外(legal_holiday/non_working)の日に実労働がある */
  | "shift_unplanned_work"
  /** シフトが work の日に実労働が0分、かつ有給取得もない */
  | "shift_absence"
  /**
   * コアタイムの予実乖離(labor law §32-3、core-time.ts)。フレックスかつコアタイムを
   * 設定しているときのみ出る。shift_* と同じく集計(totals)には一切反映しない —
   * コアタイム中の不在は「遅刻・早退」だが、フレックスの時間外は清算期間の総枠との差で
   * しか決まらないため、労働時間は1分も変わらない(賃金控除は給与側の責任)。
   */
  /** コアタイム開始より遅い最初の出勤 */
  | "core_time_late_arrival"
  /** コアタイム終了より早い最後の退勤 */
  | "core_time_early_leave"
  /** コアタイムが適用される日に実労働が0分、かつ有給取得もない */
  | "core_time_absence"
  /**
   * フレックスの契約上の枠(2026-10-05、flex.ts)。いずれも期間開始日に1件だけ出し、
   * `flexFrame` に分数を添える。
   */
  /** 所定労働日数 × 標準労働時間が法定の枠を超えたため、法定の枠で頭打ちにした */
  | "flex_contract_frame_capped"
  /** 前月から繰り越されてきた不足が、この月の上乗せの余地(法定の枠 − 契約上の枠)を超えたため切り詰めた */
  | "flex_carry_in_clipped"
  /** 前月の繰越を遡る深さの上限に達し、それより前の繰越を0とみなした(締めれば遡りはそこで止まる) */
  | "flex_carry_chain_truncated"
  /** 国民の祝日のデータが無い年の所定労働日を数えた(祝日を所定休日として数えられていない) */
  | "national_holiday_data_unavailable";

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
  /**
   * シフト予実乖離の警告(missing_shift・shift_late_arrival・shift_early_leave・
   * shift_unplanned_work・shift_absence)のとき: UI が乖離の分数を表示するための値。
   * 警告種別ごとに埋まるフィールドが異なる(shift-variance.ts 参照。すべて省略可)。他の警告種別では未設定。
   */
  shift?: { scheduledMinutes?: number; actualMinutes?: number; deltaMinutes?: number };
  /**
   * コアタイム警告(core_time_late_arrival・core_time_early_leave・core_time_absence)の
   * とき: UI が乖離の分数を表示するための値。`shift` と同じ役割だが、コアタイムには
   * 「所定(scheduledMinutes)」に相当する概念が無い(フレックスの所定はコアタイムでは
   * 決まらない)ため、乖離量だけを持つ独立したフィールドにしている。
   *
   * `deltaMinutes` の意味は種別ごとに異なる:
   * - late_arrival: コアタイム開始から最初の出勤までの分(コアタイムに不在だった前半)
   * - early_leave: 最後の退勤からコアタイム終了までの分(不在だった後半)
   * - absence: コアタイムの帯の長さそのもの(終日不在なので全部が不在)
   */
  core?: { deltaMinutes: number };
  /**
   * flex_contract_frame_capped・flex_carry_in_clipped のとき: 求められた分数と、頭打ちにした上限。
   * - contract_frame_capped: requestedMinutes = 所定労働日数 × 標準労働時間、capMinutes = 法定の枠
   * - carry_in_clipped: requestedMinutes = 前月から送られてきた繰越、capMinutes = 受け入れた分
   */
  flexFrame?: { requestedMinutes: number; capMinutes: number };
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
  /**
   * その日の所定労働時間(分、docs/design/shift-work.md)。monthly_variable のみ
   * ShiftDay(dayType が work の日)から埋まる。flex/fixed では常に 0
   * (固定時間制の所定は `withinScheduledMinutes` の境界として使うのみで、この
   * フィールド自体には表れない — standardDayMinutes はテナント単位の定数であり
   * 「その日固有の値」を持つ意味がないため)。
   */
  scheduledMinutes: number;
  /**
   * 所定内(実労働のうち所定労働時間まで)。固定時間制・monthly_variable で埋まる。
   * フレックスでは 0。monthly_variable では日ごとの所定が ShiftDay により異なるため、
   * この値は `scheduledMinutes` を上限に決まる(variable.ts 参照)。
   */
  withinScheduledMinutes: number;
  /**
   * 所定外だが法定内(所定超〜1日8時間、または所定が8時間超の日は常に0)。
   * 固定時間制・monthly_variable で埋まる。フレックスでは 0
   */
  extraWithinStatutoryMinutes: number;
  /** 法定時間外(日8時間超 + 週法定超、monthly_variable はさらに期間総枠超も加わりうる)。固定時間制・monthly_variable で埋まる。フレックスでは 0 */
  statutoryOvertimeMinutes: number;
  /**
   * この日の手当対象時間(定義ごと)。0分になった定義は含めない(sparse — UI は
   * 「手当対象時間がある日だけ小さく表示する」ため、空配列がほとんどの日の既定値になる想定)。
   * 法定区分(lateNightMinutes 等)とは独立で、同じ1分が両方に計上されることもある
   * (docs/design/allowances.md「エンジンでの算出」)。
   */
  allowances: Array<{ definitionId: string; minutes: number }>;
}

/**
 * フレックスの収支(清算期間1か月)。
 *
 * 2026-10-05(契約上の枠): `frameMinutes` は「過不足を比べる枠」を表す。総労働時間の決め方が
 * 法定の枠("statutory_frame"、既定)なら法定の枠そのもので、従来と1分も変わらない。
 * 契約上の枠("scheduled_days")なら「契約上の枠 + 前月からの繰越の受け入れ」になる。
 * どちらでも `diffMinutes = actualMinutes − frameMinutes` は保たれる。
 *
 * 3段の区分(法定の枠が基準なら2段目は常に0):
 * - 枠内: min(実績, frame) — totals.statutory の一部
 * - 法定内超過: frame〜法定の枠 — `withinStatutoryExcessMinutes`(totals.statutory の一部、割増なし)
 * - 法定外: 法定の枠超 — totals.overtime(割増あり)
 * よって totals.statutory = min(実績, 法定の枠) は従来と同じ定義のまま。
 */
export interface FlexBalance {
  /**
   * 過不足を比べる枠(分)。法定の枠が基準なら `statutoryFrameMinutes` と同じ値
   * (floor(週法定労働時間 × 暦日数 / 7))。契約上の枠が基準なら
   * `contractFrameMinutes + carryInMinutes`(法定の枠を超えない)
   */
  frameMinutes: number;
  /** 実績: 法定休日以外の実労働 + 有給日 × standardDayMinutes */
  actualMinutes: number;
  /** actual - frame(負=不足) */
  diffMinutes: number;
  /** 法定の枠: floor(週法定労働時間 × 暦日数 / 7)(分)。これを超えた分が法定外 */
  statutoryFrameMinutes: number;
  /**
   * 契約上の枠(分): 所定労働日の標準労働時間の合計。法定の枠で頭打ちにした後の値。
   * 総労働時間の決め方が法定の枠なら null
   */
  contractFrameMinutes: number | null;
  /** 前月から繰り越されてきた不足のうち、この月の枠に上乗せした分(分) */
  carryInMinutes: number;
  /** 法定内超過(分): frame を超え、法定の枠以内の部分。法定の枠が基準なら常に0 */
  withinStatutoryExcessMinutes: number;
  /** この月の不足のうち、翌月へ繰り越す分(分)。繰り越さない設定なら常に0。超過は繰り越さない */
  carryOutMinutes: number;
  /** この月の不足として確定した分(分) = 不足 − 繰り越す分。給与で控除の対象になりうる時間 */
  confirmedShortfallMinutes: number;
}

/**
 * monthly_variable の変形期間サマリ(docs/design/shift-work.md 決定事項3)。
 *
 * `periodStart`〜`periodEnd` は `periodStartDay` 起点の1ヶ月(月をまたぐ)。この期間の
 * **終了日が属する月の締めでのみ** `periodOvertimeMinutes` が `EngineOutput.totals.overtime`
 * に加算される(`attributedToThisMonth: true`)。期間が完結していなければ(monthly_variable
 * 採用直後で完結した前期間が存在しない等)計算自体は返すが加算しない —
 * 「判断される事実が発生した日」の原則(v01-data-model.md)の適用。
 */
export interface VariablePeriodSummary {
  periodStart: PlainDateString;
  periodEnd: PlainDateString;
  /** floor(週法定労働時間 × 期間の暦日数 / 7)。flex.ts の月枠と同じ日割り按分 */
  statutoryFrameMinutes: number;
  /** 期間全体のシフト所定合計(分) */
  scheduledTotalMinutes: number;
  /** 期間全体の実労働合計(分、法定休日労働を除く) */
  workedTotalMinutes: number;
  /** 期間の実労働合計 −(①②で時間外にした分)− statutoryFrameMinutes の正の部分 */
  periodOvertimeMinutes: number;
  /** true のときのみ periodOvertimeMinutes が totals.overtime に加算されている */
  attributedToThisMonth: boolean;
}

export interface EngineOutput {
  days: DailyBreakdown[];
  totals: CategorizedMinutes;
  /** フレックスのみ。固定時間制・monthly_variable では null */
  flexBalance: FlexBalance | null;
  /** 期間開始日に有効だった労働時間制 */
  workSystem: "flex" | "fixed" | "monthly_variable";
  warnings: CalcWarning[];
  /**
   * 手当定義ごとの月合計(分)。期間内のいずれかの日に有効だった定義は、その月の合計が
   * 0分でも1件として含める(締め・CSV で「定義はあるが今月は対象時間なし」を表現するため —
   * DailyBreakdown.allowances が sparse なのとは扱いを変えている)。
   */
  allowanceTotals: Array<{ definitionId: string; minutes: number }>;
  /** monthly_variable のみ。他の労働時間制では未設定 */
  variablePeriod?: VariablePeriodSummary;
}
