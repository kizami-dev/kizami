import { describe, expect, it } from "vitest";
import { buildPrivacyNotice, TEMPLATE_DISCLAIMER } from "../src/index.js";
import type { PrivacyTemplateInput } from "../src/index.js";

const BASE: PrivacyTemplateInput = {
  tenantName: "テスト株式会社",
  gpsEnabled: false,
  gpsRetentionDays: null,
  recordRetentionDescription: "打刻記録は5年間保存します。",
  workRulesUrl: null,
  contactPoint: null,
};

describe("buildPrivacyNotice", () => {
  it("先頭に雛形の注記(法的助言ではないこと)を必ず含む", () => {
    const notice = buildPrivacyNotice(BASE);
    expect(notice.startsWith(TEMPLATE_DISCLAIMER)).toBe(true);
    expect(notice).toContain("法的助言ではありません");
  });

  it("GPS 無効なら位置情報の項目・段落を一切出さない", () => {
    const notice = buildPrivacyNotice({ ...BASE, gpsEnabled: false });
    expect(notice).not.toContain("位置情報");
    expect(notice).not.toContain("GPS");
  });

  it("GPS 有効なら位置情報の項目と保持期間(日数指定あり)を出す", () => {
    const notice = buildPrivacyNotice({ ...BASE, gpsEnabled: true, gpsRetentionDays: 90 });
    expect(notice).toContain("位置情報(GPS座標)");
    expect(notice).toContain("取得から90日間保存");
  });

  it("GPS 有効かつ保持期間 null なら「打刻記録本体と同一の期間」と説明する", () => {
    const notice = buildPrivacyNotice({ ...BASE, gpsEnabled: true, gpsRetentionDays: null });
    expect(notice).toContain("位置情報(GPS座標)");
    expect(notice).toContain("打刻記録本体と同一の期間保存");
  });

  it("recordRetentionDescription をそのまま埋め込む", () => {
    const notice = buildPrivacyNotice({ ...BASE, recordRetentionDescription: "カスタムの保存期間説明。" });
    expect(notice).toContain("カスタムの保存期間説明。");
  });

  it("必須項目(打刻・IP・UA・打刻手段・利用目的・保存期間・開示訂正の請求先)が欠けない", () => {
    const notice = buildPrivacyNotice(BASE);
    expect(notice).toContain("打刻時刻");
    expect(notice).toContain("IPアドレス");
    expect(notice).toContain("ユーザーエージェント");
    expect(notice).toContain("打刻の手段");
    expect(notice).toContain("利用目的");
    expect(notice).toContain("保存期間");
    expect(notice).toContain("開示・訂正");
  });

  it("法令の根拠条文を明記する(個人情報保護法17条・18条・21条・33条・34条、労基法108条・109条)", () => {
    const notice = buildPrivacyNotice(BASE);
    expect(notice).toContain("個人情報保護法第17条");
    expect(notice).toContain("第18条");
    expect(notice).toContain("第21条");
    expect(notice).toContain("第33条");
    expect(notice).toContain("第34条");
    expect(notice).toContain("労働基準法第108条");
    expect(notice).toContain("労働基準法第109条");
  });

  it("利用目的の変更時の通知の根拠は個人情報保護法第21条第3項(第17条第3項ではない)", () => {
    const notice = buildPrivacyNotice(BASE);
    expect(notice).toContain("利用目的を変更する場合は、あらためて従業員に通知します(個人情報保護法第21条第3項)。");
    expect(notice).not.toContain("第17条第3項");
  });

  it("取得する情報にメールアドレス(アカウント管理・招待リンクの送付)を含む", () => {
    const notice = buildPrivacyNotice(BASE);
    expect(notice).toContain("メールアドレス(アカウント管理・招待リンクの送付)");
  });

  it("contactPoint が未設定なら記入例のプレースホルダを出す", () => {
    const notice = buildPrivacyNotice({ ...BASE, contactPoint: null });
    expect(notice).toContain("ここに開示・訂正等の請求を受け付ける窓口を記載してください");
  });

  it("contactPoint が設定されていればその値を出す", () => {
    const notice = buildPrivacyNotice({ ...BASE, contactPoint: "総務部 privacy@example.co.jp" });
    expect(notice).toContain("総務部 privacy@example.co.jp");
    expect(notice).not.toContain("ここに開示・訂正等の請求を受け付ける窓口を記載してください");
  });

  it("テナント名を本文に反映する", () => {
    const notice = buildPrivacyNotice({ ...BASE, tenantName: "サンプル物産" });
    expect(notice).toContain("サンプル物産");
  });

  it("workRulesUrl が設定されていれば案内文を出す", () => {
    const notice = buildPrivacyNotice({ ...BASE, workRulesUrl: "https://example.com/work-rules.pdf" });
    expect(notice).toContain("https://example.com/work-rules.pdf");
  });

  it("workRulesUrl が未設定なら案内文を出さない", () => {
    const notice = buildPrivacyNotice({ ...BASE, workRulesUrl: null });
    expect(notice).not.toContain("就業規則もあわせてご確認ください");
  });
});
