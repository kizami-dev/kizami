import { TEMPLATE_DISCLAIMER } from "./disclaimer.js";
import type { PrivacyTemplateInput } from "./types.js";

/**
 * 社内利用規約(打刻に関するルール)の雛形(Markdown)を組み立てる。
 *
 * docs/design/ui-direction.md「個人情報まわりの雛形」が挙げる同梱内容(正確な打刻の義務・
 * 代理打刻の禁止・修正申請の手続き・不正打刻の扱い)をそのまま章立てにする。
 * この関数が使う入力のうち、通知(buildPrivacyNotice)と異なり GPS・保存期間には言及しない
 * (利用規約は「従業員が守るべきルール」であって、個人情報の取り扱い説明ではないため
 * 役割を分ける — 両者を混ぜると「何が法令で何が社内ルールか」が読み取りにくくなる、
 * という ui-direction.md「出所を必ず区別する」の考え方と同じ理由による判断)。
 */
export function buildInternalTerms(input: PrivacyTemplateInput): string {
  const { tenantName, workRulesUrl } = input;

  const workRulesLine = workRulesUrl ? `\n詳細は就業規則をご確認ください: ${workRulesUrl}\n` : "";

  return `${TEMPLATE_DISCLAIMER}

# ${tenantName} 勤怠打刻に関する社内利用規約

## 正確な打刻の義務

従業員は、自らの出勤・退勤・休憩の開始/終了について、実際の時刻を正確に打刻してください。打刻された記録は、労働時間の算定・賃金計算・法定帳簿(労働者名簿・賃金台帳、労働基準法第108条)の基礎資料になります。

## 代理打刻の禁止

他の従業員に依頼して自分の打刻を行わせること、また他の従業員に代わって打刻を行うことを禁止します。実際の労働時間と異なる打刻記録は、賃金計算の誤りや労働時間管理の不正確さにつながります。

## 打刻を忘れた・誤った場合の修正申請

打刻を忘れた場合や誤って打刻した場合は、システム上の修正申請の手続きにより実際の時刻を申請してください。修正申請には所定の承認手続きが必要です。

## 不正打刻の扱い

代理打刻・虚偽の修正申請など、実際の労働時間と異なる打刻を故意に行った場合は、就業規則の定めに基づき懲戒等の対象となることがあります。
${workRulesLine}`;
}
