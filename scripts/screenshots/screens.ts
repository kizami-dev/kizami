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
  /** 画面単位の言語上書き(既定は日本語)。多言語UIのデモ用。 */
  locale?: "en" | "ko" | "zh" | "zh-Hant";
  /**
   * requiresAuth 画面を、テナント管理者以外のユーザーとして撮る場合のキー。
   * capture.ts の CaptureParams.extraSessionCookies に対応するキーを指定する。
   * 省略時は管理者セッション(既定)で撮る。
   */
  authAs?: string;
  /**
   * 使い方ツアー(apps/web/src/components/Tour.tsx)を出したまま撮るか(既定 false)。
   *
   * ツアーは初回ログイン時に自動で始まるため、何もしないと**すべての画面**に暗幕が
   * かぶってしまう。そこで capture.ts が全画面で完了フラグ(kizami.tour.v1.done)を
   * 先に localStorage へ書き込み、この旗を立てた画面でだけ消す(= その画面でだけ始まる)。
   */
  tour?: boolean;
  /**
   * ページ全体ではなくビューポート分だけを撮るか(既定 false = fullPage)。
   * 画面に固定(position: fixed)された層を主役にする画面で使う — fullPage だと
   * 固定層がページ途中に写り込み、実際の見え方と食い違うため(モバイルのタブバーと同じ事情)。
   */
  viewportOnly?: boolean;
  /**
   * システムメールもサインアップも無い配備(セルフホスト)の見た目で撮るか(既定 false)。
   * 撮影用の API はシステムメールとサインアップを有効にして起動しているため、ログイン画面に
   * 「パスワードを忘れた」「新規登録」のリンクが出る。出ない版を撮るときだけ立てる。
   */
  selfHosted?: boolean;
  /**
   * 撮影前にクリックする要素(Playwright のセレクタ)と、その後に出るのを待つ要素(2026-10-05 追加)。
   * 行を開いて出る詳細(メンバーの詳細など)のように、URL だけでは開けない状態を撮るために使う。
   */
  clickBeforeCapture?: { selector: string; waitFor?: string };
}

export const SCREENS: Screen[] = [
  {
    slug: "login",
    path: "/login",
    title: "ログイン",
    caption: "紙白の上に中央カード1枚。ロゴマークと文字ロゴのみで演出はしない。右上に控えめな言語切り替えがある。(システムメールのないセルフホスト版)",
    requiresAuth: false,
    mobile: true,
    selfHosted: true,
  },
  {
    slug: "login-cloud",
    path: "/login",
    title: "ログイン(パスワードを忘れた・新規登録つき)",
    caption: "システムメールとサインアップがある配備では、ログインの下に「パスワードを忘れた場合」と「新規登録」のリンクが出る。",
    requiresAuth: false,
    mobile: true,
  },
  {
    slug: "forgot-password",
    path: "/forgot-password",
    title: "パスワードを忘れた場合",
    caption: "メールアドレスを送ると、該当するアカウントがあれば再設定のメールが届く(該当の有無は画面に出さない)。",
    requiresAuth: false,
    mobile: true,
  },
  {
    slug: "signup",
    path: "/signup",
    title: "新規登録",
    caption: "組織名・管理者名・メールアドレスを入れると確認メールが届く。パスワードは確認リンクの先で本人が決める。",
    requiresAuth: false,
    mobile: true,
  },
  {
    slug: "reset-accept",
    path: "/reset/{resetToken}",
    title: "パスワードの再設定",
    caption: "管理者が発行したリセットリンクを開いた画面。新しいパスワードを設定するとそのままログインされる(自前認証でも詰まない)。",
    requiresAuth: false,
    mobile: false,
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
    slug: "tour",
    path: "/",
    title: "使い方ツアー(初回ログイン)",
    caption: "初めてログインすると、打刻から申請までの流れを画面上で案内する。権限に応じて管理者向けの手順が続き、あとから設定ハブでいつでも見直せる。",
    requiresAuth: true,
    mobile: true,
    tour: true,
    viewportOnly: true,
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
    slug: "monthly-en",
    path: "/monthly?month={prevMonth}",
    title: "月次(英語表示)",
    caption: "UIは日・英・韓・中(簡体・繁体)の5言語。言語の切り替えは「設定 > 言語と表示」にあり、選択は保持される。",
    requiresAuth: true,
    mobile: false,
    locale: "en",
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
    slug: "monthly-variable",
    path: "/monthly",
    title: "月次(変形労働時間制)",
    caption: "シフト制メンバー本人としてログインした今月分。所定列・期間の法定総枠に対する実労働バー、シフト予実の乖離警告。",
    requiresAuth: true,
    mobile: true,
    authAs: "variable-member",
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
    slug: "shifts",
    path: "/shifts?userId={variableMemberId}",
    title: "シフト表",
    caption: "メンバーごとに変形期間のシフト表を作成・確定する。まとめて割当と、確定前に法定休日の充足を確認できる集計。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "shifts-me",
    path: "/shifts/me",
    title: "自分のシフト",
    caption: "確定したシフト表(予定)を月カレンダーで確認する。権限不要、全員が使えるセルフサービス画面。",
    requiresAuth: true,
    mobile: true,
    authAs: "variable-member",
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
    title: "設定: 勤怠ルール・労働時間制の制度",
    caption:
      "日界・法定休日・休憩ルール・GPSの版と、名前付きの労働時間制の制度(「固定・時短(6時間)」など)。制度ごとに所定・割当人数・版の履歴を並べる。",
    requiresAuth: true,
    mobile: true,
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
    slug: "settings-security",
    path: "/settings/security",
    title: "設定: ログインとセキュリティ",
    caption: "本人によるパスワード変更(表示切替つき)と、二要素認証(TOTP)の状態。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-approval-flow",
    path: "/settings/approval-flow",
    title: "設定: 多段承認",
    caption: "修正・休暇の申請を一次承認だけにするか、二次承認まで必要にするかを決める。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-audit-logs",
    path: "/settings/audit-logs",
    title: "設定: 監査ログ",
    caption: "誰がいつ何を変えたかの記録。絞り込みと、詳細の展開ができる(改ざんできない一覧)。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "settings-slack-link",
    path: "/settings/slack-link",
    title: "設定: Slack連携(本人)",
    caption: "Slackで発行したトークンを入力して、自分のSlackアカウントと連携する。権限は不要。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "shifts-me-empty",
    path: "/shifts/me",
    title: "自分のシフト(確定前・空の状態)",
    caption: "シフト表がまだ確定していない人の画面。空の状態はトンボの線画と一言で案内する。",
    requiresAuth: true,
    mobile: true,
    authAs: "fixed-member",
  },
  {
    slug: "invite-accept",
    path: "/invite/{inviteToken}",
    title: "招待の受諾",
    caption: "招待リンクを開いた従業員が最初に見る画面。社名と自分の名前を確認し、パスワードを設定するだけで始められる。",
    requiresAuth: false,
    mobile: true,
    waitForSelector: ".invite-accept, .login-card, main",
  },
  {
    slug: "settings-allowances",
    path: "/settings/allowances",
    title: "設定: 手当",
    caption: "特定日・曜日・時間帯の組み合わせで手当対象時間を定義する。金額は計算せず、対象分数の算出まで(給与システムが金額化)。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-shift-patterns",
    path: "/settings/shift-patterns",
    title: "設定: シフトパターン",
    caption: "早番・遅番・休日などのシフトパターンを定義する。シフト表作成時にこのパターンを日ごとへ割り当てる。",
    requiresAuth: true,
    mobile: false,
  },
  {
    slug: "settings-members",
    path: "/settings/members",
    title: "設定: メンバー",
    caption: "所属部署・入社日・権限プリセットをメンバーごとに確認する。",
    requiresAuth: true,
    mobile: true,
  },
  {
    slug: "settings-members-detail",
    path: "/settings/members",
    title: "設定: メンバー(詳細)",
    caption: "メンバーの詳細を開いたところ。労働時間制は種類ではなく制度を名前で選んで割り当てる(時短勤務のメンバー)。",
    requiresAuth: true,
    mobile: true,
    clickBeforeCapture: { selector: 'tr:has-text("伊藤 美咲") button[aria-expanded]', waitFor: ".member-work-policy__current" },
  },
  {
    slug: "settings-presets",
    path: "/settings/presets",
    title: "設定: 権限プリセット",
    caption: "標準3種(管理者/マネージャー/メンバー)とカスタムプリセットの一覧。",
    requiresAuth: true,
    mobile: true,
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
    slug: "settings-display",
    path: "/settings/display",
    title: "設定: 言語と表示",
    caption: "表示言語(5言語)と配色(ライト・ダーク・システム)を選ぶ。本人用の設定で権限は不要。",
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
