/**
 * 撮影対象の画面一覧。`caption` は一覧ページ(gallery.ts)にそのまま出す一言説明
 * (「何の画面か・何ができるか」)。
 *
 * モバイルは主要画面のみ(判断: 日常的にスマホから使う画面 — ログイン・ダッシュボード・
 * 打刻・月次・修正申請・有給・通知・設定ハブ — に絞る。設定の個別画面(通知チャネルや
 * 権限プリセットの管理など)は管理者がデスクトップで行う運用を想定し、モバイルでは撮らない)。
 */
export interface Screen {
  /** ファイル名の元になる識別子(英数とハイフンのみ)。 */
  slug: string;
  /** 撮影する URL パス(クエリ文字列を含めてよい)。 */
  path: string;
  /** 一覧ページに出す画面名。 */
  title: string;
  /** 一覧ページに出す一言説明。 */
  caption: string;
  /** true の場合ログイン前(Cookie無し)のコンテキストで撮る。 */
  requiresAuth: boolean;
  /** モバイル(390px)でも撮る主要画面か。 */
  mobile: boolean;
  /** 撮影前に待つ追加のセレクタ(データ読み込み完了の目印)。省略時は body のみ待つ。 */
  waitForSelector?: string;
  /**
   * requiresAuth 画面を、テナント管理者以外のユーザーとして撮る場合のキー。
   * capture.ts の CaptureParams.extraSessionCookies に対応するキーを指定する。
   * 省略時は管理者セッション(既定)で撮る。
   */
  authAs?: string;
}

export const SCREENS: Screen[] = [
  {
    slug: "login",
    path: "/login",
    title: "ログイン",
    caption: "紙白の上に中央カード1枚。ロゴマークと文字ロゴのみで演出はしない。",
    requiresAuth: false,
    mobile: true,
  },
  {
    slug: "dashboard",
    path: "/",
    title: "ダッシュボード",
    caption: "今日の状態・未処理の申請・期限が近い義務を一望する入口。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "punch",
    path: "/punch",
    title: "打刻(ホーム)",
    caption: "今日の一枚。状態スタンプと出勤/休憩/退勤の3ボタン、当日のトンボ列。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "monthly",
    path: "/monthly?month={prevMonth}",
    title: "月次(締め済み)",
    caption: "先月分。区分別の集計とフレックス収支バー、締め済みバッジ。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "monthly-fixed",
    path: "/monthly",
    title: "月次(固定時間制)",
    caption: "固定時間制メンバー本人としてログインした今月分。時間外・法定内残業の併記と36協定バー。",
    requiresAuth: true,
    mobile: true,
    authAs: "fixed-member",
  },
  {
    slug: "corrections",
    path: "/corrections",
    title: "修正申請",
    caption: "打刻の追加・訂正・取消を申請する一覧。申請中と承認済みが並ぶ。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "leave",
    path: "/leave",
    title: "有給休暇",
    caption: "残高・付与履歴・年5日義務の状況と、休暇申請の一覧。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "notifications",
    path: "/notifications",
    title: "通知一覧",
    caption: "打刻忘れ・有給失効間近・年5日義務など、過去の通知を遡れる一覧。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "settings",
    path: "/settings",
    title: "設定ハブ",
    caption: "権限に応じて出し分けられる設定画面への入口。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "settings-notifications",
    path: "/settings/notifications",
    title: "設定: 通知チャネル",
    caption: "テナント共有のWebhook/メール送信設定。秘密情報はマスクして表示。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-notifications-me",
    path: "/settings/notifications/me",
    title: "設定: 個人通知",
    caption: "自分宛の通知をメール/Webhookでも受け取るかのカテゴリ別設定。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-attendance",
    path: "/settings/attendance",
    title: "設定: 勤怠・フレックス",
    caption: "日界・法定休日・GPS取得の可否と、フレックス清算期間の設定(版の履歴つき)。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-leave",
    path: "/settings/leave",
    title: "設定: 有給休暇",
    caption: "付与方式・半休/時間単位年休の可否・積立休暇の上限を設定する。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-departments",
    path: "/settings/departments",
    title: "設定: 部署",
    caption: "部署の木構造(本社/営業部/開発部)を作成・編集する。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-members",
    path: "/settings/members",
    title: "設定: メンバー",
    caption: "所属部署・入社日・権限プリセットをメンバーごとに確認する。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-presets",
    path: "/settings/presets",
    title: "設定: 権限プリセット",
    caption: "標準3種(管理者/マネージャー/メンバー)とカスタムプリセットの一覧。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-tenant-profile",
    path: "/settings/tenant-profile",
    title: "設定: テナントプロファイル",
    caption: "36協定の集計に直接影響する企業区分・特別条項の設定。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-api-keys",
    path: "/settings/api-keys",
    title: "設定: APIキー",
    caption: "公開打刻APIのキーを発行・失効する。トークンは発行直後のみ表示。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-slack",
    path: "/settings/slack",
    title: "設定: Slack連携",
    caption: "Signing Secretとアカウント連携状態、ワンタイムトークンでの紐付け。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-help",
    path: "/settings/help",
    title: "設定: ヘルプ",
    caption: "法令・KIZAMIの仕様の説明に、自社の規定を追記する編集画面。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-privacy",
    path: "/settings/privacy",
    title: "設定: プライバシー",
    caption: "打刻記録の保存期間・開示請求窓口と、通知/利用規約の雛形生成。",
    requiresAuth: true,
    mobile: false,
  },
];
