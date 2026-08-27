import { describe, expect, it } from "vitest";
import { buildInternalTerms, TEMPLATE_DISCLAIMER } from "../src/index.js";
import type { PrivacyTemplateInput } from "../src/index.js";

const BASE: PrivacyTemplateInput = {
  tenantName: "テスト株式会社",
  gpsEnabled: false,
  gpsRetentionDays: null,
  recordRetentionDescription: "打刻記録は5年間保存します。",
  personalDataRetentionYears: 5,
  workRulesUrl: null,
  contactPoint: null,
};

describe("buildInternalTerms", () => {
  it("先頭に雛形の注記(法的助言ではないこと)を必ず含む", () => {
    const terms = buildInternalTerms(BASE);
    expect(terms.startsWith(TEMPLATE_DISCLAIMER)).toBe(true);
    expect(terms).toContain("法的助言ではありません");
  });

  it("正確な打刻の義務・代理打刻の禁止・修正申請の手続き・不正打刻の扱いをすべて含む", () => {
    const terms = buildInternalTerms(BASE);
    expect(terms).toContain("正確な打刻の義務");
    expect(terms).toContain("代理打刻");
    expect(terms).toContain("禁止");
    expect(terms).toContain("修正申請");
    expect(terms).toContain("不正打刻");
  });

  it("テナント名を本文に反映する", () => {
    const terms = buildInternalTerms({ ...BASE, tenantName: "サンプル物産" });
    expect(terms).toContain("サンプル物産");
  });

  it("workRulesUrl が設定されていれば「詳細は就業規則を参照」の導線を出す", () => {
    const terms = buildInternalTerms({ ...BASE, workRulesUrl: "https://example.com/work-rules.pdf" });
    expect(terms).toContain("就業規則");
    expect(terms).toContain("https://example.com/work-rules.pdf");
  });

  it("workRulesUrl が未設定なら詳細リンクを出さない", () => {
    const terms = buildInternalTerms({ ...BASE, workRulesUrl: null });
    expect(terms).not.toContain("詳細は就業規則をご確認ください");
  });

  it("GPS や保存期間には言及しない(利用規約は運用ルールであり個人情報の取扱説明とは役割を分ける)", () => {
    const terms = buildInternalTerms({ ...BASE, gpsEnabled: true, gpsRetentionDays: 30 });
    expect(terms).not.toContain("位置情報");
    expect(terms).not.toContain("GPS");
  });
});
