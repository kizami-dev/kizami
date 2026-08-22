/**
 * 業務タスク権限カタログ(UIがチェックボックスを描くための機械可読データ)。
 *
 * docs/design/permission-catalog.md §1(業務タスク単位の権限カタログ、30項目)をそのまま
 * コードへ転記したもの。v0.2 からはこのファイルを仕様の正とする
 * (依頼: 「ドキュメントとコードの二重管理になるが、v0.2ではコード側を正とし、
 * ドキュメントに『カタログの機械可読な正は packages/authz/src/catalog.ts』と書ける
 * ようにする」— ドキュメント側の追記は依頼者が別途行う)。
 *
 * impliesView は implied.ts の IMPLIED_VIEW_PERMISSIONS から導出し、重複定義しない
 * (依頼: 「既存の IMPLIED_VIEW_PERMISSIONS と整合させること。重複するなら片方から導出する」)。
 */

import { IMPLIED_VIEW_PERMISSIONS } from "./implied.js";
import type { PermissionKey, Scope } from "./types.js";

export interface PermissionCatalogEntry {
  key: PermissionKey;
  labelJa: string;
  descriptionJa: string;
  /** 編集UIで選択可能なスコープ(意味のあるものだけ。この30項目に "self" は登場しない)。 */
  scopes: readonly Scope[];
  /** 危険フラグ: 権限プリセット編集画面での重点表示対象(permission-catalog.md 前提参照)。 */
  dangerous: boolean;
  /** この権限をONにすると自動的に有効になる閲覧権限(「操作は閲覧を含意する」の展開)。 */
  impliesView: readonly PermissionKey[];
}

function entry(
  key: PermissionKey,
  labelJa: string,
  descriptionJa: string,
  scopes: readonly Scope[],
  dangerous: boolean,
): PermissionCatalogEntry {
  return { key, labelJa, descriptionJa, scopes, dangerous, impliesView: IMPLIED_VIEW_PERMISSIONS[key] ?? [] };
}

const DEPT_SCOPES: readonly Scope[] = ["department", "department_and_descendants", "tenant"];
const DEPT_AND_DESCENDANTS_UP: readonly Scope[] = ["department_and_descendants", "tenant"];
const TENANT_ONLY: readonly Scope[] = ["tenant"];

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  // 1.1 打刻(代理操作)
  entry(
    "attendance.punch.proxy",
    "他者の打刻を代理で記録できる",
    "IC障害・打刻忘れ等の際に、他のメンバーに代わって出退勤・休憩の打刻を登録できる",
    DEPT_SCOPES,
    false,
  ),

  // 1.2 修正申請・承認
  entry(
    "attendance.correction.request_for_others",
    "他者に代わって修正申請を起票できる",
    "本人が申請できない事情がある場合に、担当者が本人に代わって打刻修正申請を作成できる",
    DEPT_SCOPES,
    false,
  ),
  // 判断点(2026-08-23): 休憩の自動控除打ち消し申請(auto_break_waivers)の承認もこの権限で
  // 行う。承認者は打刻修正と運用上同じ層であり、カタログ項目を分けるとプリセット編集UIの
  // チェックボックスが増えるだけで判断は変わらない。ラベルは両方を正直にカバーする文言にする。
  entry(
    "attendance.correction.approve",
    "勤怠の修正系申請を承認できる",
    "メンバーから提出された打刻修正申請・休憩の自動控除打ち消し申請を承認し、勤怠記録に反映する",
    DEPT_SCOPES,
    false,
  ),
  entry(
    "attendance.correction.view_all",
    "他者の修正申請状況を閲覧できる",
    "承認権限がなくても、修正申請の提出・承認状況を確認できる(人事の状況把握等)",
    DEPT_SCOPES,
    false,
  ),

  // 1.3 勤怠記録閲覧
  entry(
    "attendance.record.view",
    "他者の勤怠記録(日次・月次)を閲覧できる",
    "自分以外のメンバーの日次・月次の勤怠記録・集計結果を確認できる",
    DEPT_SCOPES,
    false,
  ),

  // 1.4 休暇(申請・承認・付与管理)
  entry("leave.request.approve", "休暇申請を承認できる", "メンバーから提出された休暇申請を承認できる", DEPT_SCOPES, false),
  entry(
    "leave.request.view_all",
    "他者の休暇申請状況を閲覧できる",
    "承認権限がなくても、休暇申請の提出・承認状況を確認できる",
    DEPT_SCOPES,
    false,
  ),
  entry(
    "leave.grant.manage",
    "有給休暇の付与・残日数を管理できる",
    "法定基準日方式等に基づく有給付与の実行、残日数の個別調整ができる",
    DEPT_AND_DESCENDANTS_UP,
    true,
  ),
  entry(
    "leave.balance.view",
    "他者の有給残日数を閲覧できる",
    "付与権限がなくても、メンバーの有給残日数・取得状況を閲覧できる",
    DEPT_SCOPES,
    false,
  ),
  entry(
    "leave.mandatory_five_days.view",
    "年5日取得義務の状況を閲覧できる",
    "対象者ごとの年5日取得義務の充足状況・未達アラートを確認できる",
    DEPT_SCOPES,
    false,
  ),

  // 1.5 締め
  entry(
    "closing.execute",
    "月次締めを実行できる",
    "対象月の勤怠を確定させ、以後の直接的な変更をロックする",
    DEPT_AND_DESCENDANTS_UP,
    true,
  ),
  entry(
    "closing.unlock",
    "締めを解除できる",
    "確定済みの月次締めを再オープンし、遡及修正を可能にする",
    DEPT_AND_DESCENDANTS_UP,
    true,
  ),
  entry("closing.view", "締め状態・履歴を閲覧できる", "各月の締め状態(未締め/締め済み)と解除履歴を確認できる", DEPT_SCOPES, false),

  // 1.6 エクスポート
  entry(
    "export.attendance.run",
    "勤怠データをCSV/API出力できる",
    "区分別時間数を含む勤怠データをCSVまたは外部連携用に出力できる",
    DEPT_SCOPES,
    true,
  ),

  // 1.7 36協定アラート
  entry(
    "alert.labor_limit.view",
    "36協定アラート(時間外超過状況)を閲覧できる",
    "時間外労働の月45h等の閾値に対する実績・超過見込みを確認できる",
    DEPT_SCOPES,
    false,
  ),
  entry(
    "alert.labor_limit.configure",
    "36協定アラートの閾値・通知先を設定できる",
    "法定上限に対するアラート閾値や通知先チャネルを設定できる",
    TENANT_ONLY,
    true,
  ),

  // 1.8 メンバー管理
  entry("member.invite", "メンバーを招待・追加できる", "新しいメンバーをテナントに招待し、アカウントを作成できる", DEPT_SCOPES, false),
  entry(
    "member.profile.edit",
    "メンバーの基本情報を編集できる",
    "氏名・所属部署・雇用形態などメンバーの基本情報を編集できる",
    DEPT_SCOPES,
    false,
  ),
  entry(
    "member.deactivate",
    "メンバーを無効化(退職処理)できる",
    "退職・休職等によりメンバーのアカウントを無効化し、ログインを停止できる",
    DEPT_SCOPES,
    true,
  ),
  entry("member.view", "メンバー一覧・詳細を閲覧できる", "メンバーの一覧および詳細プロフィールを閲覧できる", DEPT_SCOPES, false),

  // 1.9 部署管理
  entry(
    "department.manage",
    "部署ツリーを管理できる",
    "部署の作成・編集・異動(部署ツリーの構成変更)を行える",
    DEPT_AND_DESCENDANTS_UP,
    // 2026-08-22 に危険フラグへ格上げ。スコープの実判定(apps/api/src/lib/scope.ts)が入り、
    // 部署の移動が「誰が誰を閲覧・承認できるか」を変えるようになったため、実質的に権限変更にあたる。
    true,
  ),

  // 1.10 テナント設定
  entry(
    "tenant_settings.calendar.manage",
    "日界・法定休日カレンダーを設定できる",
    "1日の起算時刻(日界)や法定休日の曜日・暦日指定を設定できる",
    TENANT_ONLY,
    false,
  ),
  entry("tenant_settings.flex.manage", "フレックスタイム設定を管理できる", "清算期間などフレックス勤務設定を管理できる", TENANT_ONLY, false),
  entry(
    "tenant_settings.gps.manage",
    "GPS打刻の設定を管理できる",
    "GPS座標取得のopt-in有効化や保持期間を設定できる",
    TENANT_ONLY,
    true,
  ),
  entry(
    "tenant_settings.auto_deduction.manage",
    "休憩自動控除ルールを設定できる",
    "6時間超45分・8時間超1時間等の休憩自動控除ルールを設定できる",
    TENANT_ONLY,
    true,
  ),

  // 1.11 通知設定
  entry(
    "notification.settings.manage",
    "通知チャネルを設定できる",
    "メール(SMTP)・Slack/Discord Webhook・Web Push等の通知チャネルを設定できる",
    TENANT_ONLY,
    false,
  ),

  // 1.12 権限管理
  entry(
    "permission.preset.manage",
    "権限プリセットを編集できる",
    "権限プリセットの内容(権限のON/OFFとスコープの組合せ)を新規作成・編集できる",
    TENANT_ONLY,
    true,
  ),
  entry(
    "permission.assignment.manage",
    "メンバーへの権限プリセット割当を変更できる",
    "メンバーに対する権限プリセットの割当・解除を行える",
    DEPT_SCOPES,
    true,
  ),

  // 1.13 監査ログ
  entry("audit_log.view", "監査ログを閲覧できる", "打刻・修正・承認・締め・権限変更などの不可変監査ログを閲覧できる", DEPT_SCOPES, true),

  // 1.14 APIキー/MCP接続管理
  entry(
    "api_key.manage",
    "APIキー/MCP接続を管理できる",
    "公開打刻API・MCPサーバー接続用のAPIキーの発行・失効を行える",
    TENANT_ONLY,
    true,
  ),
];
