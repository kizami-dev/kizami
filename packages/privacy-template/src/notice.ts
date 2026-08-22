import { TEMPLATE_DISCLAIMER } from "./disclaimer.js";
import type { PrivacyTemplateInput } from "./types.js";

/**
 * 従業員向けプライバシー通知の雛形(Markdown)を組み立てる。
 *
 * 前提(docs/design/ui-direction.md「個人情報まわりの雛形」):
 * KIZAMI 自身に OAuth 目的のプライバシーポリシーは不要だが、打刻記録・IP・UA・GPS 座標は
 * 従業員の個人情報であり、個人情報保護法上の義務(利用目的の特定・公表、GPS取得時の明示)を
 * 負うのは導入企業である。この関数は導入企業がその義務を果たすための雛形を生成するだけで、
 * KIZAMI プロジェクトが義務を代わりに履行するものではない。
 *
 * 法令上の根拠として明記する条文(2026-08-22 時点、要確認事項は完了報告に記載):
 * - 個人情報保護法17条(利用目的の特定)・18条(利用目的による制限)・21条(取得に際しての
 *   利用目的の通知等)・33条(開示)・34条(訂正等)
 * - 労働基準法108条(賃金台帳の調製義務)・109条(記録の保存)
 *
 * GPS が無効なら位置情報に関する項目・段落を一切出さない(要件どおり)。
 */
export function buildPrivacyNotice(input: PrivacyTemplateInput): string {
  const { tenantName, gpsEnabled, gpsRetentionDays, recordRetentionDescription, workRulesUrl, contactPoint } = input;

  const collectedItems = [
    "打刻時刻(出勤・退勤・休憩の開始/終了時刻)",
    "打刻を行った端末のIPアドレス",
    "打刻を行った端末のユーザーエージェント(ブラウザ・OS等の識別情報)",
    "打刻の手段(Web・PWA・Slack等、打刻に用いた経路)",
    ...(gpsEnabled ? ["打刻時点の位置情報(GPS座標)"] : []),
  ];

  const gpsSection = gpsEnabled
    ? `\n## 位置情報の取得について\n\n打刻の記録に位置情報(GPS座標)を利用するため、打刻の都度、端末から位置情報を取得します。取得は打刻のタイミングに限られ、打刻以外の場面で継続的に位置を追跡することはありません。\n`
    : "";

  const gpsRetentionSentence = gpsEnabled
    ? gpsRetentionDays !== null
      ? `位置情報は取得から${gpsRetentionDays}日間保存し、期間の経過後は位置情報の項目のみを削除します(打刻記録そのものは残ります)。`
      : "位置情報は打刻記録本体と同一の期間保存します。"
    : null;

  const contactLine = contactPoint ?? "(ここに開示・訂正等の請求を受け付ける窓口を記載してください。例: 総務部 privacy@example.com)";

  const workRulesLine = workRulesUrl ? `\n就業規則もあわせてご確認ください: ${workRulesUrl}\n` : "";

  return `${TEMPLATE_DISCLAIMER}

# ${tenantName} 従業員向けプライバシー通知(勤怠管理)

${tenantName}(以下「当社」)は、勤怠管理システム(KIZAMI)を用いて従業員の勤怠に関する情報を取得・利用します。個人情報の保護に関する法律(以下「個人情報保護法」)第17条・第18条・第21条に基づき、取得する情報の項目・利用目的・保存期間を以下のとおりお知らせします。

## 取得する情報

${collectedItems.map((item) => `- ${item}`).join("\n")}
${gpsSection}
## 利用目的

取得した情報は、次の目的にのみ利用します(個人情報保護法第17条・第18条)。

1. 労働時間の把握(労働基準法に基づく労働時間管理)
2. 労働者名簿・賃金台帳など法定帳簿の作成(労働基準法第108条)
3. 賃金計算の基礎資料としての利用

上記の目的以外に利用することはありません。利用目的を変更する場合は、あらためて従業員に通知します(個人情報保護法第17条第3項)。

## 保存期間

${recordRetentionDescription}

${gpsRetentionSentence ? `${gpsRetentionSentence}\n\n` : ""}これらの保存期間は、労働基準法第109条が定める記録の保存義務(原則5年間。ただし経過措置により当分の間3年間)を踏まえたものです。

## 開示・訂正等の請求

ご自身の情報について、開示・訂正・利用停止等を求める場合は、以下の窓口までご連絡ください(個人情報保護法第33条・第34条)。

${contactLine}
${workRulesLine}`;
}
