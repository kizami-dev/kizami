/**
 * 法令ルールの型契約(packages/engine/src/types.ts の CalcSettings / SettingsSpan と同じ
 * effective-dated の流儀に揃える)。
 *
 * 原則:
 * - ランタイム非依存・純粋なデータ+関数。node:* も外部依存も使わない
 * - 日付は "YYYY-MM-DD"(ローカル日付、テナントのタイムゾーンで解釈)
 * - 時刻は「ローカル0時からの分」(dayBoundaryMinutes と同じ表現)
 */

/** テナントの属性。同じ改正でも企業規模で施行日が違うことがあるため、解決時に渡す */
export interface TenantLawProfile {
  /**
   * 中小企業かどうか。月60時間超の割増率(大企業2010-04-01・中小企業2023-04-01)や
   * 36協定の罰則付き上限(大企業2019-04-01・中小企業2020-04-01)など、企業規模で
   * 施行日が異なる改正の判定に使う。
   *
   * 判断点: 労基法上の「中小事業主」の定義は業種(小売業・サービス業・卸売業・その他)ごとに
   * 資本金または従業員数の閾値が異なる(労基法附則、旧138条等)。本パッケージはその判定ロジックを
   * 持たず、呼び出し側が業種別基準を踏まえて判定済みの boolean を渡す契約にしている。
   */
  isSmallOrMediumEnterprise: boolean;
  /**
   * 特例措置対象事業場かどうか。商業・映画演劇業・保健衛生業・接客娯楽業で常時使用する労働者が
   * 10人未満の事業場は、週40時間制が完全実施された現在も週44時間が法定労働時間となる
   * (労基法40条、労基法施行規則25条の2)。過去の経過措置ではなく現行制度。
   *
   * `isSmallOrMediumEnterprise` と同じ方針で、業種・人数の判定ロジックは持たず、
   * 判定済みの boolean を呼び出し側から受け取る契約にしている。
   */
  isSpecialProvisionWorkplace: boolean;
}

export interface LawRules {
  /** 週の法定労働時間(分)。原則 2400(40時間)。労基法32条1項 */
  weeklyStatutoryMinutes: number;
  /**
   * 1日の法定労働時間(分)。480(8時間)。労基法32条2項。
   * 特例措置対象事業場(週44時間)でも1日8時間は変わらない — 緩和されるのは週の方だけ
   * (労基法40条・労基法施行規則25条の2は「週」の特例であり「日」には及ばない)。
   * そのため `resolve.ts` の `applySpecialProvisionWorkplaceOverride` はこのフィールドを上書きしない。
   */
  dailyStatutoryMinutes: number;
  /**
   * 休憩の付与義務(労基法34条1項)。実労働が overMinutes を超えたら
   * minimumMinutes 以上の休憩が必要。閾値の大きい順に評価する。
   * 「超える」は厳密な超過(ちょうど overMinutes なら義務は発生しない)。
   * 判定側の実装は engine/src/break-check.ts 参照。
   */
  breakRequirements: ReadonlyArray<{ overMinutes: number; minimumMinutes: number }>;
  /** 深夜帯(ローカル時刻の分。22:00=1320, 翌5:00=300)。労基法37条4項 */
  lateNight: { startMinutes: number; endMinutes: number };
  /** 月60時間超の時間外に対する区分を分けるかと、その閾値(分)。労基法37条1項ただし書 */
  overtime60h: { enabled: boolean; thresholdMinutes: number };
  /** 36協定の上限(分)。v0.2で使う月45h、v0.3で使う年360h・特別条項 */
  agreement36: {
    /** 月45時間 = 2700分 */
    monthlyLimitMinutes: number;
    /** 年360時間 = 21600分 */
    annualLimitMinutes: number;
    /** 特別条項の月上限。100時間未満(=この値に達してはならない、比較は呼び出し側で `<`) */
    specialMonthlyCapMinutes: number;
    /** 特別条項時、複数月平均80時間 = 4800分 */
    specialMultiMonthAverageMinutes: number;
    /** 特別条項時、年720時間 = 43200分 */
    specialAnnualLimitMinutes: number;
    /** 月45時間超が許される回数、年6回まで */
    specialMonthlyExceedCountLimit: number;
  };
  /** 有給の法定付与(週所定5日/フルタイムの表。比例付与の日数表は @kizami/leave が持つ) */
  annualLeave: {
    /** 勤続月数 → 付与日数。昇順。例 [{months:6,days:10}, {months:18,days:11}, ...] */
    grantTable: Array<{ months: number; days: number }>;
    /** 時効(月数)。労基法115条により24 */
    expiryMonths: number;
    /** 年5日取得義務の対象となる付与日数の下限と、必要日数。義務がまだ存在しない期間は requiredDays: 0 で表す */
    mandatoryTaking: { grantedDaysThreshold: number; requiredDays: number };
    /** 時間単位年休の年間上限日数(法定5。労使協定でこれ以下に設定可)。制度導入前は 0 */
    hourlyMaxDays: number;
  };
}

export interface LawVersion {
  /** 適用開始日 "YYYY-MM-DD" */
  effectiveFrom: string;
  /** 適用条件(省略時は全テナント)。企業規模で施行日が違う改正で使う */
  appliesTo?: (profile: TenantLawProfile) => boolean;
  /** 根拠(条文・通達番号)。コメントではなくデータとして持つ */
  basis: string;
  /**
   * 前の版からの差分(部分適用)。最初の版(基準版)は完全な LawRules を持つこと。
   *
   * 差分の粒度は LawRules の「トップレベルのキー単位」。あるキー(例: agreement36)を
   * 版に含める場合は、そのキーの値をまるごと(サブフィールドも全部)指定する
   * — Partial<LawRules> は深いマージをしない(型どおりの浅いマージ)。
   */
  rules: Partial<LawRules> | LawRules;
}
