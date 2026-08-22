/**
 * 法令ルールの解決(engine の SettingsSpan と同じ effective-dated の考え方を法令データに適用する)。
 */

import { LAW_VERSIONS } from "./versions.js";
import type { LawRules, LawVersion, TenantLawProfile } from "./types.js";

function appliesToProfile(version: LawVersion, profile: TenantLawProfile): boolean {
  return version.appliesTo === undefined || version.appliesTo(profile);
}

function byEffectiveFromAscending(a: LawVersion, b: LawVersion): number {
  return a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0;
}

/**
 * 特例措置対象事業場(商業・映画演劇業・保健衛生業・接客娯楽業、常時9人以下)の週法定労働時間。
 * 労基法40条・労基法施行規則25条の2。1997-04-01の週40時間制完全実施後も現在まで存続している、
 * 過去の経過措置ではない「現行制度」。
 *
 * 判断点(独自判断): この特例は「いつ改正されたか」ではなく「その事業場が特例の要件を満たすか」
 * という恒常的な事業場属性で決まるため、LAW_VERSIONS の版(施行日ベースの差分)としてではなく、
 * TenantLawProfile による解決後の上書きとして表現する。isSmallOrMediumEnterprise(企業規模)とは
 * 独立した軸なので、互いに影響せず併存できる(特例措置対象かつ中小企業、なども自然に成立する)。
 *
 * フレックスの月間総枠(engine の calculateFlexBalance: floor(週法定労働時間 × 暦日数 / 7))に
 * 直接効く。例: 30日の月で通常 floor(2400×30/7) = 10285分、特例措置対象事業場は
 * floor(2640×30/7) = 11314分。
 */
const SPECIAL_PROVISION_WEEKLY_STATUTORY_MINUTES = 44 * 60; // 2640

function applySpecialProvisionWorkplaceOverride(rules: LawRules, profile: TenantLawProfile): LawRules {
  if (!profile.isSpecialProvisionWorkplace) return rules;
  return { ...rules, weeklyStatutoryMinutes: SPECIAL_PROVISION_WEEKLY_STATUTORY_MINUTES };
}

/**
 * 指定日・テナント属性で有効な版を、施行日の古い順に畳み込んで完全な LawRules を返す。
 *
 * 畳み込みは LawRules のトップレベルキー単位の浅いマージ(型 `Partial<LawRules>` どおり)。
 * 同じ施行日の版が複数あっても、配列内の順序に関わらず正しく畳み込まれる
 * (ここでは effectiveFrom の昇順ソートのみに依存し、同日内の順序には依存しない —
 * 同日の版どうしはキーが重ならない設計になっている前提)。
 *
 * 畳み込みの後、特例措置対象事業場(profile.isSpecialProvisionWorkplace)の上書きを適用する。
 * これは施行日を持たない恒常的な事業場属性であり、企業規模(isSmallOrMediumEnterprise)による
 * 版の分岐とは独立に効く。
 */
export function resolveLawRules(date: string, profile: TenantLawProfile): LawRules {
  const applicable = LAW_VERSIONS.filter(
    (version) => version.effectiveFrom <= date && appliesToProfile(version, profile),
  ).sort(byEffectiveFromAscending);

  if (applicable.length === 0) {
    throw new Error(
      `resolveLawRules: no law version is effective on or before ${date} for the given profile ` +
        "(the earliest baseline version's effectiveFrom is later than the requested date)",
    );
  }

  // 最初(最も古い)の適用版は基準版であり、完全な LawRules を持つことが前提
  // (直前で applicable.length === 0 を弾いているため、非 null は安全)
  const [baseline, ...rest] = applicable;
  let rules = { ...(baseline!.rules as LawRules) };
  for (const version of rest) {
    rules = { ...rules, ...version.rules };
  }
  return applySpecialProvisionWorkplaceOverride(rules, profile);
}

/**
 * 期間 [fromDate, toDate](ローカル日付、両端含む)内で法令が変わる日をすべて洗い出し、
 * engine の SettingsSpan と同じ形( { from, ... } の配列、from 昇順)で返す。
 * 期間初日以前に有効な版を必ず1つ含む(先頭要素の from は fromDate そのもの)。
 */
export function buildLawTimeline(
  fromDate: string,
  toDate: string,
  profile: TenantLawProfile,
): Array<{ from: string; law: LawRules }> {
  if (toDate < fromDate) {
    throw new Error(`buildLawTimeline: toDate (${toDate}) must not be before fromDate (${fromDate})`);
  }

  const changeDatesInRange = LAW_VERSIONS.filter(
    (version) =>
      appliesToProfile(version, profile) &&
      version.effectiveFrom > fromDate &&
      version.effectiveFrom <= toDate,
  ).map((version) => version.effectiveFrom);

  const sortedUniqueChangeDates = [...new Set(changeDatesInRange)].sort();

  return [fromDate, ...sortedUniqueChangeDates].map((from) => ({
    from,
    law: resolveLawRules(from, profile),
  }));
}

/**
 * afterDate より後に施行日を迎える、まだ発効していない版を施行日昇順で返す
 * (施行前に入れておいた将来の版を運用・UI で確認するためのもの)。
 */
export function listUpcomingChanges(afterDate: string, profile: TenantLawProfile): LawVersion[] {
  return LAW_VERSIONS.filter(
    (version) => appliesToProfile(version, profile) && version.effectiveFrom > afterDate,
  ).sort(byEffectiveFromAscending);
}
