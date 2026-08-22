import { describe, expect, it } from "vitest";
import { buildLawTimeline, listUpcomingChanges, resolveLawRules } from "../src/resolve.js";
import type { TenantLawProfile } from "../src/types.js";

const LARGE: TenantLawProfile = {
  isSmallOrMediumEnterprise: false,
  isSpecialProvisionWorkplace: false,
};
const SME: TenantLawProfile = {
  isSmallOrMediumEnterprise: true,
  isSpecialProvisionWorkplace: false,
};
const SPECIAL_PROVISION_LARGE: TenantLawProfile = {
  isSmallOrMediumEnterprise: false,
  isSpecialProvisionWorkplace: true,
};
const SPECIAL_PROVISION_SME: TenantLawProfile = {
  isSmallOrMediumEnterprise: true,
  isSpecialProvisionWorkplace: true,
};

describe("resolveLawRules — 基準日での解決", () => {
  it("2018年時点では年5日取得義務がない(requiredDays: 0)", () => {
    const rules = resolveLawRules("2018-06-01", LARGE);
    expect(rules.annualLeave.mandatoryTaking.requiredDays).toBe(0);
    expect(rules.annualLeave.hourlyMaxDays).toBe(5); // 2010年に導入済み
  });

  it("2020年時点では年5日取得義務がある(requiredDays: 5)", () => {
    const rules = resolveLawRules("2020-06-01", LARGE);
    expect(rules.annualLeave.mandatoryTaking.requiredDays).toBe(5);
    expect(rules.annualLeave.mandatoryTaking.grantedDaysThreshold).toBe(10);
  });

  it("基準版そのもの(2000-01-01ちょうど)は完全な LawRules を返す", () => {
    const rules = resolveLawRules("2000-01-01", LARGE);
    expect(rules.weeklyStatutoryMinutes).toBe(2400);
    expect(rules.lateNight).toEqual({ startMinutes: 1320, endMinutes: 300 });
    expect(rules.annualLeave.hourlyMaxDays).toBe(0);
    expect(rules.overtime60h.enabled).toBe(false);
  });

  it("基準版より前の日付は解決できずエラーになる", () => {
    expect(() => resolveLawRules("1999-12-31", LARGE)).toThrow();
  });

  it("有給の法定付与テーブルは全期間で変わらない(6ヶ月10日〜6年6ヶ月20日)", () => {
    const rules = resolveLawRules("2024-01-01", LARGE);
    expect(rules.annualLeave.grantTable).toEqual([
      { months: 6, days: 10 },
      { months: 18, days: 11 },
      { months: 30, days: 12 },
      { months: 42, days: 14 },
      { months: 54, days: 16 },
      { months: 66, days: 18 },
      { months: 78, days: 20 },
    ]);
    expect(rules.annualLeave.expiryMonths).toBe(24);
  });
});

describe("resolveLawRules — 企業規模による分岐(月60時間超の割増区分)", () => {
  it("2015年時点: 大企業は導入済み、中小企業は未導入", () => {
    const largeRules = resolveLawRules("2015-01-01", LARGE);
    const smeRules = resolveLawRules("2015-01-01", SME);
    expect(largeRules.overtime60h.enabled).toBe(true);
    expect(smeRules.overtime60h.enabled).toBe(false);
  });

  it("2023-04-01以降は両方とも導入済み", () => {
    const largeRules = resolveLawRules("2023-04-01", LARGE);
    const smeRules = resolveLawRules("2023-04-01", SME);
    expect(largeRules.overtime60h.enabled).toBe(true);
    expect(smeRules.overtime60h.enabled).toBe(true);
  });

  it("2023-03-31時点ではまだ中小企業は未導入(境界日の直前)", () => {
    const smeRules = resolveLawRules("2023-03-31", SME);
    expect(smeRules.overtime60h.enabled).toBe(false);
  });
});

describe("resolveLawRules — 企業規模による分岐(36協定の罰則付き上限)", () => {
  it("2019-04-01時点: 大企業は特別条項に数値上限あり、中小企業はまだ(事実上無制限)", () => {
    const largeRules = resolveLawRules("2019-04-01", LARGE);
    const smeRules = resolveLawRules("2019-04-01", SME);
    expect(largeRules.agreement36.specialAnnualLimitMinutes).toBe(720 * 60);
    expect(smeRules.agreement36.specialAnnualLimitMinutes).toBe(Number.POSITIVE_INFINITY);
  });

  it("2020-04-01以降は中小企業にも数値上限が適用される", () => {
    const smeRules = resolveLawRules("2020-04-01", SME);
    expect(smeRules.agreement36.specialAnnualLimitMinutes).toBe(720 * 60);
    expect(smeRules.agreement36.monthlyLimitMinutes).toBe(45 * 60);
  });

  it("年5日取得義務は企業規模を問わず2019-04-01から一律に適用される", () => {
    const largeRules = resolveLawRules("2019-04-01", LARGE);
    const smeRules = resolveLawRules("2019-04-01", SME);
    expect(largeRules.annualLeave.mandatoryTaking.requiredDays).toBe(5);
    expect(smeRules.annualLeave.mandatoryTaking.requiredDays).toBe(5);
  });
});

describe("resolveLawRules — 差分適用", () => {
  it("2010-04-01は overtime60h と annualLeave.hourlyMaxDays だけを上書きし、他は基準版から引き継がれる", () => {
    const baseline = resolveLawRules("2000-01-01", LARGE);
    const after2010 = resolveLawRules("2010-04-01", LARGE);

    expect(after2010.overtime60h.enabled).toBe(true); // 上書きされた
    expect(after2010.annualLeave.hourlyMaxDays).toBe(5); // 上書きされた

    // 上書きされていないフィールドは基準版から引き継がれる
    expect(after2010.weeklyStatutoryMinutes).toBe(baseline.weeklyStatutoryMinutes);
    expect(after2010.lateNight).toEqual(baseline.lateNight);
    expect(after2010.agreement36).toEqual(baseline.agreement36);
    expect(after2010.annualLeave.grantTable).toEqual(baseline.annualLeave.grantTable);
    expect(after2010.annualLeave.expiryMonths).toBe(baseline.annualLeave.expiryMonths);
  });
});

describe("buildLawTimeline", () => {
  it("改正日をまたぐ期間で正しく分割する(2023-03-01〜2023-05-31、中小企業)", () => {
    const timeline = buildLawTimeline("2023-03-01", "2023-05-31", SME);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.from).toBe("2023-03-01");
    expect(timeline[0]?.law.overtime60h.enabled).toBe(false);
    expect(timeline[1]?.from).toBe("2023-04-01");
    expect(timeline[1]?.law.overtime60h.enabled).toBe(true);
  });

  it("期間初日以前に有効な版を必ず1つ含む(先頭要素の from は fromDate そのもの)", () => {
    const timeline = buildLawTimeline("2005-01-01", "2005-12-31", LARGE);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.from).toBe("2005-01-01");
    expect(timeline[0]?.law.weeklyStatutoryMinutes).toBe(2400);
  });

  it("改正がない期間は1区間のみを返す", () => {
    const timeline = buildLawTimeline("2021-01-01", "2021-12-31", LARGE);
    expect(timeline).toHaveLength(1);
  });

  it("同日に複数の改正がある期間もまとめて1区間に畳み込まれる(2019-04-01、大企業)", () => {
    const timeline = buildLawTimeline("2019-01-01", "2019-12-31", LARGE);
    const change = timeline.find((span) => span.from === "2019-04-01");
    expect(change).toBeDefined();
    expect(change?.law.annualLeave.mandatoryTaking.requiredDays).toBe(5);
    expect(change?.law.agreement36.specialAnnualLimitMinutes).toBe(720 * 60);
  });

  it("toDate が fromDate より前だとエラーになる", () => {
    expect(() => buildLawTimeline("2020-01-01", "2019-01-01", LARGE)).toThrow();
  });
});

describe("将来の版を先に書いておく仕組み", () => {
  it("将来日付の版を追加しても、その日までは現行の値が返る", () => {
    // LAW_VERSIONS には 2023-04-01 の版(中小企業への60h超割増適用)が既に「将来の版として」
    // 書かれている(このテストを書いている時点は現在日付を問わず未来の版として扱われる可能性がある)。
    // ここでは実際に存在する最新の施行日(2023-04-01)の「前日」で確認することで、
    // 「施行日が来るまでは古い値のまま」であることを検証する。
    const dayBefore = resolveLawRules("2023-03-31", SME);
    const dayOf = resolveLawRules("2023-04-01", SME);
    expect(dayBefore.overtime60h.enabled).toBe(false);
    expect(dayOf.overtime60h.enabled).toBe(true);
  });

  it("遠い未来日を渡しても現行の最新版の値がそのまま返る(未定義の将来改正を勝手に作らない)", () => {
    const farFuture = resolveLawRules("2099-01-01", SME);
    expect(farFuture.overtime60h.enabled).toBe(true);
    expect(farFuture.agreement36.monthlyLimitMinutes).toBe(45 * 60);
  });
});

describe("listUpcomingChanges", () => {
  it("将来の版だけを返す(過去・当日の版は含まない)", () => {
    const upcoming = listUpcomingChanges("2018-01-01", LARGE);
    // 2018-01-01 より後の大企業向け版: 2019-04-01(年5日義務・36協定上限)のみ
    // (SME 向けの appliesTo を持つ版は LARGE には含まれない)
    expect(upcoming.every((v) => v.effectiveFrom > "2018-01-01")).toBe(true);
    expect(upcoming.some((v) => v.effectiveFrom === "2019-04-01")).toBe(true);
    expect(upcoming.some((v) => v.effectiveFrom === "2010-04-01")).toBe(false);
  });

  it("SME プロファイルでは2020-04-01・2023-04-01の版も未来として見える", () => {
    const upcoming = listUpcomingChanges("2019-01-01", SME);
    const dates = upcoming.map((v) => v.effectiveFrom);
    expect(dates).toContain("2020-04-01");
    expect(dates).toContain("2023-04-01");
  });

  it("施行日昇順で返す", () => {
    const upcoming = listUpcomingChanges("2000-01-01", LARGE);
    const dates = upcoming.map((v) => v.effectiveFrom);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("afterDate 以前の版は含まれない", () => {
    const upcoming = listUpcomingChanges("2099-01-01", LARGE);
    expect(upcoming).toHaveLength(0);
  });
});

describe("resolveLawRules — 特例措置対象事業場(週44時間)", () => {
  it("特例措置対象事業場では weeklyStatutoryMinutes が 2640 になる", () => {
    const rules = resolveLawRules("2024-01-01", SPECIAL_PROVISION_LARGE);
    expect(rules.weeklyStatutoryMinutes).toBe(2640);
  });

  it("通常の事業場では 2400 のまま", () => {
    const rules = resolveLawRules("2024-01-01", LARGE);
    expect(rules.weeklyStatutoryMinutes).toBe(2400);
  });

  it("企業規模の分岐(36協定・60時間超)と独立して動く: 特例措置対象かつ中小企業", () => {
    const rules = resolveLawRules("2024-01-01", SPECIAL_PROVISION_SME);

    // 特例措置(週法定労働時間)は事業場属性どおり反映される
    expect(rules.weeklyStatutoryMinutes).toBe(2640);
    // 企業規模由来の値(2024年時点なので中小企業にも両方適用済み)はそのまま反映される
    expect(rules.overtime60h.enabled).toBe(true);
    expect(rules.agreement36.specialAnnualLimitMinutes).toBe(720 * 60);
  });

  it("企業規模の分岐と独立して動く: 特例措置対象かつ大企業", () => {
    const rules = resolveLawRules("2024-01-01", SPECIAL_PROVISION_LARGE);
    expect(rules.weeklyStatutoryMinutes).toBe(2640);
    expect(rules.overtime60h.enabled).toBe(true);
  });

  it("2015年時点でも特例措置対象事業場は2640分のまま(60時間超の企業規模分岐と無関係)", () => {
    const specialSme = resolveLawRules("2015-01-01", SPECIAL_PROVISION_SME);
    expect(specialSme.weeklyStatutoryMinutes).toBe(2640);
    // この時点の中小企業はまだ60時間超区分が未導入(特例措置とは独立した軸)
    expect(specialSme.overtime60h.enabled).toBe(false);
  });

  it("buildLawTimeline でも特例措置の上書きが各区間に反映される", () => {
    const timeline = buildLawTimeline("2023-03-01", "2023-05-31", SPECIAL_PROVISION_SME);
    expect(timeline.every((span) => span.law.weeklyStatutoryMinutes === 2640)).toBe(true);
  });

  it("月間総枠の計算例: 30日の月で通常10285分、特例措置対象事業場は11314分(floor(週法定分×暦日数/7))", () => {
    const normal = resolveLawRules("2024-01-01", LARGE);
    const special = resolveLawRules("2024-01-01", SPECIAL_PROVISION_LARGE);
    const daysInMonth = 30;

    const normalFrameMinutes = Math.floor((normal.weeklyStatutoryMinutes * daysInMonth) / 7);
    const specialFrameMinutes = Math.floor((special.weeklyStatutoryMinutes * daysInMonth) / 7);

    expect(normalFrameMinutes).toBe(10285);
    expect(specialFrameMinutes).toBe(11314);
  });
});
