/**
 * routes/settings/ 配下のドメイン間で使い回している権限定数。
 * 2026-08-23、routes/settings.ts(1430行・22ルート)を挙動不変で分割した際に切り出した
 * (各定数のコメント〔なぜ新しい権限キーを追加せず既存キーを転用するか〕は元の文言のまま移送)。
 */

import { HELP_OVERRIDES_PERMISSION } from "../help.js";

export const NOTIFICATION_SETTINGS_PERMISSION = "notification.settings.manage";

/**
 * GET/PUT /settings/leave が要求する権限(2026-08-22 追加)。
 *
 * 判断点: docs/design/permission-catalog.md の `tenant_settings.*` グループには
 * 有給休暇の付与方式・時間単位年休・積立休暇を表す target が定義されていない
 * (テナント設定リソースの target は calendar/flex/gps/auto_deduction/notification の5種)。
 * 一方でカタログ§1.4には `leave.grant.manage`(有給休暇の付与・残日数を管理できる。
 * scope 自部署+配下部署/テナント全体、危険フラグあり)が既に存在し、有給運用の
 * 管理者権限として意味的に最も近い。ここでは新規キーを追加せず、`leave.grant.manage` を
 * scope "tenant" で要求することでテナント全体設定相当の権限チェックとする
 * (依頼「tenant_settings.calendar.manage 相当。適切な権限キーをカタログから選ぶこと」への回答)。
 */
export const LEAVE_SETTINGS_PERMISSION = "leave.grant.manage";

/**
 * GET/PUT /settings/tenant-profile(2026-08-22 追加: 法令パッケージ結線・36協定完全版)が
 * 要求する権限。
 *
 * 判断点: 依頼は「`tenant_settings.calendar.manage` 相当の適切なものをカタログから選ぶ」と
 * 指示している。`tenant_settings.*` 系(calendar/flex/gps/auto_deduction)はどれも
 * 「集計の入力になるテナント設定」という点では近いが、このエンドポイントが扱う3値
 * (企業規模・特例措置対象事業場・特別条項締結)は具体的には「36協定アラートの各閾値の
 * 決定に直結する」ものであり、`alert.labor_limit.configure`(36協定アラートの閾値・通知先を
 * 設定できる。テナント全体のみ・危険フラグあり)の対象範囲(「法定上限に対するアラート閾値」の
 * 設定)に最も具体的に一致する。フレックス総枠にも影響する(特例措置対象事業場)ため
 * `tenant_settings.flex.manage` も候補になりうるが、この依頼の主眼が36協定アラート完全版で
 * あることを踏まえ `alert.labor_limit.configure` を採用した(独自判断、完了報告に明記)。
 */
export const TENANT_PROFILE_PERMISSION = "alert.labor_limit.configure";

/**
 * PUT /settings/work-rules-url(就業規則リンク。2026-08-22、社内規定追記機能で追加)が
 * 要求する権限。routes/help.ts の HELP_OVERRIDES_PERMISSION と同一(notification.settings.manage
 * の転用理由は help.ts 冒頭コメント参照) — 就業規則リンクも社内規定と同じ「全社員向けヘルプの
 * 補足情報」なので、書き込み権限も help_overrides と揃える。
 */
export const WORK_RULES_URL_PERMISSION = HELP_OVERRIDES_PERMISSION;

/**
 * GET /settings/privacy-templates(個人情報まわりの雛形。2026-08-22 追加)が要求する権限。
 *
 * 依頼どおり「権限は社内規定の編集と同じもの」— HELP_OVERRIDES_PERMISSION
 * (notification.settings.manage の転用。理由は help.ts 冒頭コメント参照)をそのまま使う。
 */
export const PRIVACY_TEMPLATES_PERMISSION = HELP_OVERRIDES_PERMISSION;

/**
 * GET/POST /settings/attendance(日界・法定休日・休憩ルール・GPS の版管理。2026-08-22 追加)が
 * 要求する権限。
 *
 * 判断点(完了報告に明記): この1エンドポイントは1行(tenant_setting_versions の1版)に
 * 日界・法定休日・休憩ルール・GPS の4項目をまとめて持つため、カタログ上は別々の権限キー
 * (`tenant_settings.calendar.manage` と `tenant_settings.gps.manage`)に分かれる項目が
 * 同じ POST 1回に載る。依頼の「項目ごとに正しく振り分けること」を満たすため、
 * ①GET/POST とも常に `tenant_settings.calendar.manage` を要求し(日界・法定休日・休憩ルールは
 * 常にこの権限で編集できる)、②POST で GPS の値(gpsEnabled/gpsRetentionDays)が現在の
 * 実効値から変わる場合のみ、追加で `tenant_settings.gps.manage` も要求する(値を変えず
 * そのまま送っただけなら calendar.manage だけで通る)。これにより「カレンダー担当者は
 * GPSを勝手に有効化できない」が両立する。
 */
export const ATTENDANCE_CALENDAR_PERMISSION = "tenant_settings.calendar.manage";
export const ATTENDANCE_GPS_PERMISSION = "tenant_settings.gps.manage";

/** GET/POST /settings/work-policy(フレックス設定の版管理。2026-08-22 追加)が要求する権限。 */
export const WORK_POLICY_PERMISSION = "tenant_settings.flex.manage";

/**
 * GET/POST /settings/allowances(手当定義の版管理。docs/design/allowances.md、2026-08-23 追加)が
 * 要求する権限。依頼どおり「権限は勤怠設定と同じもの」— ATTENDANCE_CALENDAR_PERMISSION
 * (tenant_settings.calendar.manage)をそのまま再利用する(手当専用の新規キーは増やさない)。
 */
export const ALLOWANCE_SETTINGS_PERMISSION = ATTENDANCE_CALENDAR_PERMISSION;

/**
 * GET/PUT /settings/privacy-contact(保存期間の説明文・開示請求窓口。2026-08-22 追加)が
 * 要求する権限。判断点: この2項目は GET /settings/privacy-templates の入力そのものなので、
 * 同エンドポイントと同じ PRIVACY_TEMPLATES_PERMISSION(上で定義済み。HELP_OVERRIDES_PERMISSION の
 * 転用)をそのまま使う(新規の権限キーは増やさない)。
 */

/**
 * GET/PUT /settings/slack(Slackスラッシュコマンド打刻の連携設定。docs/external-api/slack.md)が
 * 要求する権限。
 *
 * 判断点(完了報告に明記): カタログに `notification.settings.manage`
 * (「メール(SMTP)・Slack/Discord Webhook・Web Push等の通知チャネルを設定できる」)が既にあり、
 * 説明文が Slack 連携という「外部サービスとの連携チャネルの設定」を明示的に含んでいる。
 * 新規の権限キーを増やさず、テナント単位の通知チャネル設定(GET/PUT /settings/notifications)と
 * 同じ NOTIFICATION_SETTINGS_PERMISSION 定数をそのまま再利用する。
 */
export const SLACK_SETTINGS_PERMISSION = NOTIFICATION_SETTINGS_PERMISSION;
