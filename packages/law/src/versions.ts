/**
 * 実際の日本の法令史を反映した法令版データ。
 *
 * 原則(README.md も参照):
 * - **過去の版は絶対に書き換えない**。書き換えると過去期間の再計算結果が変わってしまう。
 *   改正が来たら、この配列に新しい版を1つ「追加」する(既存の版には触らない)
 * - 施行日が未来の版を先に追加しておいてよい。resolveLawRules はその日が来るまで
 *   古い版を返し続け、施行日を迎えた瞬間に自動で切り替わる
 * - `basis` には根拠条文・通達番号を必ず書く。史実として日付・条文番号に確証が持てない箇所は
 *   コード中に「要確認」と明記し、このパッケージの完了報告にも含めている
 *
 * 判断点(独自判断): `effectiveFrom` が同一の版が複数存在してよい(例: 2019-04-01 の
 * 年5日義務と36協定上限は appliesTo が異なる別々の版として分離している)。resolveLawRules は
 * 同日の版をすべて畳み込むので、施行日の重複自体は問題にならない。
 */

import type { LawRules, LawVersion } from "./types.js";

/**
 * 有給の法定付与日数テーブル(勤続月数 → 付与日数、週所定5日/フルタイム)。労基法39条2項。
 * 6ヶ月=10 / 1年6ヶ月=11 / 2年6ヶ月=12 / 3年6ヶ月=14 / 4年6ヶ月=16 / 5年6ヶ月=18 / 6年6ヶ月以降=20。
 * このテーブル自体は基準版から現在まで変更がない(packages/leave の付与ロジックと同じ数字)。
 */
const STATUTORY_GRANT_TABLE: LawRules["annualLeave"]["grantTable"] = [
  { months: 6, days: 10 },
  { months: 18, days: 11 },
  { months: 30, days: 12 },
  { months: 42, days: 14 },
  { months: 54, days: 16 },
  { months: 66, days: 18 },
  { months: 78, days: 20 },
];

/** 基準版(2019年改正前)の annualLeave。時間単位年休なし・年5日義務なし。 */
const ANNUAL_LEAVE_BASELINE: LawRules["annualLeave"] = {
  grantTable: STATUTORY_GRANT_TABLE,
  expiryMonths: 24,
  mandatoryTaking: { grantedDaysThreshold: 10, requiredDays: 0 },
  hourlyMaxDays: 0,
};

/** 2010-04-01 以降の annualLeave。時間単位年休(年5日)が加わる。 */
const ANNUAL_LEAVE_WITH_HOURLY: LawRules["annualLeave"] = {
  ...ANNUAL_LEAVE_BASELINE,
  hourlyMaxDays: 5,
};

/** 2019-04-01 以降の annualLeave。年5日取得義務が加わる。 */
const ANNUAL_LEAVE_WITH_MANDATORY_TAKING: LawRules["annualLeave"] = {
  ...ANNUAL_LEAVE_WITH_HOURLY,
  mandatoryTaking: { grantedDaysThreshold: 10, requiredDays: 5 },
};

/**
 * 2019年働き方改革関連法(平30法71)による罰則付き36協定上限の実数値
 * (月45h・年360h・特別条項時 月100h未満/複数月平均80h/年720h/月45h超は年6回まで)。
 * 大企業版(2019-04-01)・中小企業版(2020-04-01)で同じ数値を使う。
 */
const AGREEMENT36_PENAL_LIMITS: LawRules["agreement36"] = {
  monthlyLimitMinutes: 45 * 60, // 2700
  annualLimitMinutes: 360 * 60, // 21600
  specialMonthlyCapMinutes: 100 * 60, // 6000(100時間未満)
  specialMultiMonthAverageMinutes: 80 * 60, // 4800
  specialAnnualLimitMinutes: 720 * 60, // 43200
  specialMonthlyExceedCountLimit: 6,
};

export const LAW_VERSIONS: LawVersion[] = [
  // ---------------------------------------------------------------------
  // 基準版
  // ---------------------------------------------------------------------
  {
    effectiveFrom: "2000-01-01",
    basis:
      "労働基準法(昭和22年法律第49号)32条(週40時間)・37条4項(深夜)・39条(年次有給休暇)。" +
      "要確認: 2000-01-01 は本パッケージが計算対象にする起点として置いた「システム基準日」であり、" +
      "各条文の実際の施行日(週40時間制は業種により1988〜1997年にかけて段階施行、有給付与テーブルは" +
      "昭和62年改正・1988年前後)そのものではない。2000-01-01より前の日付を resolveLawRules に渡すと" +
      "有効な版が見つからずエラーになる(意図的な仕様。詳細は resolve.ts コメント参照)。",
    rules: {
      weeklyStatutoryMinutes: 40 * 60, // 2400
      // 特例措置対象事業場でも週とは独立に常に480分(労基法32条2項、resolve.ts 参照)。
      // 全期間を通じて変更がないため基準版のみに置き、以降の版では差分に含めない。
      dailyStatutoryMinutes: 8 * 60, // 480
      // 休憩の付与義務(労基法34条1項)。1947年の制定以来変更がないため、dailyStatutoryMinutes と
      // 同じ理由で基準版のみに置き、以降の版では差分に含めない。
      breakRequirements: [
        { overMinutes: 6 * 60, minimumMinutes: 45 }, // 6時間超で45分以上
        { overMinutes: 8 * 60, minimumMinutes: 60 }, // 8時間超で60分以上
      ],
      lateNight: { startMinutes: 22 * 60, endMinutes: 5 * 60 }, // 1320, 300
      // 月60時間超の割増区分は2010年改正で初めて導入されるため、基準版では無効
      overtime60h: { enabled: false, thresholdMinutes: 60 * 60 },
      agreement36: {
        // 平成10年労働省告示第154号(限度基準告示)による目安が月45h・年360hだったとされる。
        // 要確認: 告示の正式な公布日・施行日(本パッケージでは特定できず、システム基準日を代用)。
        monthlyLimitMinutes: 45 * 60,
        annualLimitMinutes: 360 * 60,
        // 判断点(独自判断): 2019年改正前は特別条項に法定の数値上限が存在しなかった
        // (労使が合意すれば理論上青天井だった、というのが働き方改革の主要な批判点の一つ)。
        // これを 0 にすると「特別条項自体が使えない」という誤った意味になってしまうため、
        // 「事実上の上限なし」を表す値として Number.POSITIVE_INFINITY を採用している。
        specialMonthlyCapMinutes: Number.POSITIVE_INFINITY,
        specialMultiMonthAverageMinutes: Number.POSITIVE_INFINITY,
        specialAnnualLimitMinutes: Number.POSITIVE_INFINITY,
        specialMonthlyExceedCountLimit: Number.POSITIVE_INFINITY,
      },
      annualLeave: ANNUAL_LEAVE_BASELINE,
    } satisfies LawRules,
  },

  // ---------------------------------------------------------------------
  // 2010-04-01: 月60時間超の割増区分(大企業のみ)
  // ---------------------------------------------------------------------
  {
    effectiveFrom: "2010-04-01",
    appliesTo: (profile) => !profile.isSmallOrMediumEnterprise,
    basis:
      "労働基準法37条1項ただし書(平20法89、2010-04-01施行)。中小企業は同法附則(旧138条)により" +
      "適用が猶予され、働き方改革関連法(平30法71)による同条廃止で 2023-04-01 に適用開始(下記の別版)。",
    rules: {
      overtime60h: { enabled: true, thresholdMinutes: 60 * 60 },
    },
  },

  // ---------------------------------------------------------------------
  // 2010-04-01: 時間単位年休の導入(企業規模を問わず)
  // ---------------------------------------------------------------------
  {
    effectiveFrom: "2010-04-01",
    basis: "労働基準法39条4項(平20法89、2010-04-01施行)。労使協定により年5日を限度に時間単位で付与可能。",
    rules: {
      annualLeave: ANNUAL_LEAVE_WITH_HOURLY,
    },
  },

  // ---------------------------------------------------------------------
  // 2019-04-01: 年5日取得義務の導入(企業規模を問わず)
  // ---------------------------------------------------------------------
  {
    effectiveFrom: "2019-04-01",
    basis: "労働基準法39条7項・8項(平30法71、2019-04-01施行)。10日以上付与された労働者に年5日の時季指定義務。",
    rules: {
      annualLeave: ANNUAL_LEAVE_WITH_MANDATORY_TAKING,
    },
  },

  // ---------------------------------------------------------------------
  // 2019-04-01: 36協定の罰則付き上限(大企業)
  // ---------------------------------------------------------------------
  {
    effectiveFrom: "2019-04-01",
    appliesTo: (profile) => !profile.isSmallOrMediumEnterprise,
    basis:
      "労働基準法36条6項(平30法71、大企業2019-04-01施行)。月45h・年360h、特別条項時は月100時間未満・" +
      "複数月平均80時間・年720時間・月45時間超は年6回まで。",
    rules: {
      agreement36: AGREEMENT36_PENAL_LIMITS,
    },
  },

  // ---------------------------------------------------------------------
  // 2020-04-01: 36協定の罰則付き上限(中小企業、1年猶予後)
  // ---------------------------------------------------------------------
  {
    effectiveFrom: "2020-04-01",
    appliesTo: (profile) => profile.isSmallOrMediumEnterprise,
    basis:
      "労働基準法36条6項(平30法71)。中小企業は同法附則により1年猶予され 2020-04-01 施行。" +
      "要確認: 猶予根拠の附則条番号、および「最低限」の指示にはなかった版で本パッケージ独自に追加した区分" +
      "(指示の2019-04-01版は企業規模を区別していなかったが、史実としては大企業と中小企業で施行日が" +
      "異なるため、60時間超の割増と同じ appliesTo パターンで分離した)。",
    rules: {
      agreement36: AGREEMENT36_PENAL_LIMITS,
    },
  },

  // ---------------------------------------------------------------------
  // 2023-04-01: 月60時間超の割増区分(中小企業にも適用)
  // ---------------------------------------------------------------------
  {
    effectiveFrom: "2023-04-01",
    appliesTo: (profile) => profile.isSmallOrMediumEnterprise,
    basis:
      "労働基準法37条1項ただし書。中小企業に対する適用猶予(旧附則138条)が働き方改革関連法(平30法71)により" +
      "廃止され、2023-04-01から中小企業にも適用開始。",
    rules: {
      overtime60h: { enabled: true, thresholdMinutes: 60 * 60 },
    },
  },
];
