/**
 * @kizami/privacy-template の型契約。
 *
 * 方針(docs/design/ui-direction.md「個人情報まわりの雛形」、README 冒頭参照):
 * - 純関数のみ。I/O・Date.now() 依存を持たない
 * - KIZAMI 自身の個人情報の管理者は導入企業であり、KIZAMI プロジェクトではない。
 *   このパッケージが作るのは「導入企業が義務を果たすための雛形」であって、
 *   KIZAMI が代わりに義務を履行するものではない
 */

/**
 * 雛形の組み立てに使うテナント設定の入力。
 *
 * 呼び出し側(apps/api)が DB から実際の値を解決して渡す。このパッケージ自身は
 * DB・HTTP のどちらにも依存しない。
 */
export interface PrivacyTemplateInput {
  /** テナント名(通知・規約の主体として文中に出す) */
  tenantName: string;
  /** GPS 打刻(位置情報取得)が有効かどうか。false なら通知に位置情報の項を出さない */
  gpsEnabled: boolean;
  /** GPS 座標の保持期間(日数)。null は「打刻記録と同一の保持期間」を意味する */
  gpsRetentionDays: number | null;
  /**
   * 打刻記録本体の保存期間の説明文(すでに文章化されたもの)。
   * 労働基準法109条の記録保存義務(原則5年・経過措置で当分の間3年)を踏まえた説明を
   * 呼び出し側で組み立てて渡す想定(このパッケージは受け取った文字列をそのまま埋め込む)。
   */
  recordRetentionDescription: string;
  /** 就業規則へのリンク。未設定なら null(その場合、雛形には案内文を出さない) */
  workRulesUrl: string | null;
  /**
   * 開示・訂正等の請求を受け付ける窓口(部署名・メールアドレス等の自由記述)。
   * 未設定なら null(その場合、雛形にはプレースホルダの記入例を出す)。
   */
  contactPoint: string | null;
}
