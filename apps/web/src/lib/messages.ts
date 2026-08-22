/**
 * 表示文言の単一ソース(v0.1)。
 *
 * 将来 packages/help-content 相当の i18n キー化を見据え、フラットな
 * キー→文字列の辞書としてここに集約する(日本語のみ)。
 * 動詞ラベルは要件 §10「出勤/退勤/休憩に入る/休憩から戻る」で統一する。
 */
export const messages = {
  appName: "KIZAMI",
  tagline: "1分単位で時を刻む勤怠管理。",

  nav: {
    home: "打刻",
    monthly: "月次",
    corrections: "申請",
    leave: "有給",
    settings: "設定",
    logout: "ログアウト",
  },

  /** テーマ切り替え(ヘッダーのユーザーメニュー内、2026-08-22 ダーク対応で追加)。 */
  theme: {
    label: "テーマ",
    system: "システム設定に従う",
    light: "ライト",
    dark: "ダーク",
  },

  /** スコープの日本語名(要件 §4)。狭い→広い: self < department < department_and_descendants < tenant。 */
  scopeLabel: {
    self: "本人のみ",
    department: "自部署",
    department_and_descendants: "自部署+配下部署",
    tenant: "テナント全体",
  } satisfies Record<"self" | "department" | "department_and_descendants" | "tenant", string>,

  login: {
    title: "KIZAMI",
    tagline: "1分単位で時を刻む勤怠管理",
    emailLabel: "メールアドレス",
    passwordLabel: "パスワード",
    submit: "ログイン",
    submitting: "ログイン中…",
    invalidCredentials: "メールアドレスまたはパスワードが違います",
    genericError: "ログインに失敗しました。時間をおいて再度お試しください",
  },

  attendanceState: {
    out: "退勤中",
    working: "勤務中",
    onBreak: "休憩中",
  } satisfies Record<"out" | "working" | "onBreak", string>,

  punchButtons: {
    clockIn: "出勤",
    breakStart: "休憩に入る",
    breakEnd: "休憩から戻る",
    clockOut: "退勤",
  },

  punchHints: {
    clockInDisabled: "勤務外のみ操作できます",
    breakDisabled: "勤務中のみ操作できます",
    clockOutDisabled: "勤務中のみ操作できます",
  },

  punchKindLabel: {
    clock_in: "出勤",
    break_start: "休憩開始",
    break_end: "休憩終了",
    clock_out: "退勤",
  } satisfies Record<"clock_in" | "break_start" | "break_end" | "clock_out", string>,

  today: {
    title: "今日の打刻",
    empty: "まだ打刻がありません",
  },

  /**
   * GPS付き打刻(v0.4、docs/requirements.md §3)。
   * 「有効化時は従業員に取得中であることを明示する」を満たすため、GPSが有効なテナントでは
   * 打刻ボタンの近くに常時 noticeAlways を表示する(トグルやツールチップの奥に隠さない)。
   */
  punchGps: {
    noticeAlways: "この打刻には位置情報が記録されます",
    detailToggle: "詳しく",
    reason: "直行直帰などの打刻場所を確認できるよう、会社の設定でGPSでの記録が有効になっています。",
    retentionPrefix: "保持期間: ",
    retentionSameAsAttendance: "勤怠データと同一",
    retentionDaysSuffix: "日",
    locating: "位置情報を取得中…",
    unavailableNote: "位置情報を取得できなかったため、位置情報なしで記録しました",
  },

  /**
   * オフライン時の打刻(v0.4)。依頼どおり、v0.4ではオフラインでの打刻キューイングを
   * 実装しない(実際の打刻時刻と記録時刻がずれるため)。画面(アプリシェル)は
   * Service Worker のキャッシュで開けるが、打刻はネットワーク接続が必要なことを明示する。
   */
  offline: {
    banner: "オフラインです。画面は表示できますが、正確な時刻を記録するため打刻には接続が必要です。",
    punchDisabledHint: "オフラインのため打刻できません",
  },

  errors: {
    punchFailed: "打刻に失敗しました。もう一度お試しください",
    loadFailed: "データの取得に失敗しました。もう一度お試しください",
    network: "サーバーに接続できません",
  },

  loading: "読み込み中…",

  monthly: {
    title: "月次",
    prevMonth: "前月",
    nextMonth: "翌月",
    columnDate: "日付",
    columnWorked: "実労働",
    columnBreak: "休憩",
    columnLateNight: "深夜",
    columnWarning: "警告",
    columnActions: "操作",
    correctionAction: "修正",
    empty: "この月の打刻データはありません",
    flexBalanceLabel: "フレックス収支",
    flexBalanceUnit: "分",
    totalsLabel: "区分別合計",
  },

  totalsCategoryLabel: {
    statutory: "所定内",
    overtime: "残業",
    overtime60h: "残業(60h超)",
    lateNight: "深夜",
    statutoryHoliday: "法定休日",
  } satisfies Record<"statutory" | "overtime" | "overtime60h" | "lateNight" | "statutoryHoliday", string>,

  warningLabel: {
    missing_clock_out: "退勤打刻が無く、その勤務区間は集計から除外されました",
    duplicate_clock_in: "勤務中の重複した出勤打刻を無効にしました",
    clock_out_without_in: "出勤していない状態での退勤打刻を無効にしました",
    break_outside_work: "勤務外の休憩打刻を無効にしました",
    duplicate_break_start: "休憩中の重複した休憩開始打刻を無効にしました",
    unmatched_break_end: "対応する休憩開始のない休憩終了打刻を無効にしました",
    clock_out_during_break: "休憩中に退勤打刻があり、休憩を終えて退勤したものとして扱いました",
  } satisfies Record<
    | "missing_clock_out"
    | "duplicate_clock_in"
    | "clock_out_without_in"
    | "break_outside_work"
    | "duplicate_break_start"
    | "unmatched_break_end"
    | "clock_out_during_break",
    string
  >,

  corrections: {
    title: "打刻修正申請",
    tagline: "打刻の追加・訂正・取消を申請します。承認されると勤怠記録に反映されます。",

    formTitle: "の修正申請",
    formHint: "申請は承認されると打刻に反映され、月次集計に反映されます。",
    close: "閉じる",
    cancel: "キャンセル",
    submit: "申請する",
    submitting: "送信中…",
    submitted: "申請を送信しました。承認されると打刻に反映されます。",

    currentPunchesTitle: "この日の打刻",
    currentPunchesEmpty: "この日の打刻はまだありません",

    modeAdd: "打刻を追加",
    modeCorrect: "既存打刻を訂正",
    modeCancel: "既存打刻を取消",

    kindLabel: "種別",
    timeLabel: "時刻",
    targetLabel: "対象の打刻",
    targetPlaceholder: "対象を選択してください",
    targetEmpty: "対象にできる打刻がありません",
    reasonLabel: "理由",
    reasonPlaceholder: "修正が必要な理由を入力してください",

    typeAdd: "追加",
    typeCorrect: "訂正",
    typeCancel: "取消",
    targetUnavailable: "対象の打刻情報を取得できませんでした(反映済みなど)",

    statusLabel: {
      pending: "申請中",
      approved: "承認済",
      rejected: "却下",
      withdrawn: "取下げ",
    } satisfies Record<"pending" | "approved" | "rejected" | "withdrawn", string>,

    columnTarget: "対象日時",
    columnContent: "内容",
    columnReason: "理由",
    columnDecision: "決裁",

    approve: "承認",
    reject: "却下",
    withdraw: "取下げ",

    decidedByLabel: "決裁者",
    decidedAtLabel: "決裁日時",
    decisionNoteLabel: "決裁メモ",
    decisionNotePlaceholder: "メモ(任意)",
    decidedBySelf: "本人",

    confirmApproveTitle: "この申請を承認しますか",
    confirmApproveMessage:
      "承認すると勤怠記録に反映され、月次集計が変わります。この操作は監査ログに記録されます。",
    confirmApproveSelfNote: "自己承認として記録されます。",
    confirmRejectTitle: "この申請を却下しますか",
    confirmRejectMessage: "却下すると申請は却下済みとして記録され、打刻には反映されません。",
    confirmWithdrawTitle: "この申請を取り下げますか",
    confirmWithdrawMessage: "取り下げると申請中の状態が解除されます。必要であれば再度申請できます。",
    confirmProceed: "実行する",

    empty: "申請はまだありません",

    errors: {
      already_superseded: "対象の打刻は別の申請で既に修正されています",
      not_pending: "この申請は既に処理されています",
      not_found: "対象の申請が見つかりません",
      invalid_reason: "理由を1〜500文字で入力してください",
      invalid_target_event: "対象の打刻が見つかりません。選び直してください",
      invalid_proposed_kind: "打刻の種別を確認してください",
      invalid_proposed_occurred_at: "時刻の形式を確認してください",
      proposed_occurred_at_in_future: "未来の時刻は指定できません",
      invalid_request_shape: "入力内容を確認してください",
      invalid_body: "入力内容を確認してください",
      invalid_status: "表示できない状態が指定されました",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  notifications: {
    bellLabel: "通知",
    title: "通知",
    empty: "通知はありません",
    unread: "未読",
    markRead: "既読にする",
    markReadFailed: "既読にできませんでした。もう一度お試しください",
    subjectDateLabel: "対象日",
    receivedAtLabel: "受信",
    openCorrection: "この日の修正申請を開く",
    loadFailed: "通知の取得に失敗しました。もう一度お試しください",
  },

  settingsNotifications: {
    title: "通知設定(会社全体)",
    tagline: "テナント全体の通知チャネル(Webhook・メール)を設定します。",
    noPermission: "この設定を変更する権限がありません",
    /** docs/requirements.md §7: 個人設定(/settings/notifications/me)との違いを画面上で明示する。 */
    distinctionBanner:
      "こちらは会社全体のチャネル(SMTPサーバー・共有Webhookなど)の設定です。自分がどう通知を受け取るか(メール・個人Webhookの有効/無効)は「個人の通知設定」で設定してください。",
    linkToPersonalSettings: "個人の通知設定を開く →",

    webhookSectionTitle: "Webhook",
    webhookEnabledLabel: "Webhook通知を有効にする",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "設定済み",
    webhookUrlNotConfigured: "未設定",
    keepIfBlankHint: "変更しない場合は空のままにしてください",

    smtpSectionTitle: "メール(SMTP)",
    smtpEnabledLabel: "メール通知を有効にする",
    smtpHostLabel: "SMTPホスト",
    smtpPortLabel: "ポート",
    smtpUserLabel: "ユーザー名",
    smtpFromLabel: "差出人メールアドレス",
    smtpPasswordLabel: "パスワード",
    smtpPasswordConfigured: "設定済み",
    smtpPasswordNotConfigured: "未設定",

    save: "保存",
    saving: "保存中…",
    saveNote: "この設定はテナント全体に適用されます。変更は監査ログに記録されます。",
    saveSuccess: "設定を保存しました。",

    testSend: "テスト送信",
    testSendConfirmTitle: "テスト通知を送信しますか",
    testSendConfirmMessage: "保存されている設定で実際に1通送信します。",
    testSendConfirmLabel: "送信する",
    testSendResultTitle: "テスト送信結果",
    testSendOk: "成功",
    testSendFailed: "失敗",
    testSendChannelLabel: {
      webhook: "Webhook",
      smtp: "メール(SMTP)",
    } as Record<string, string>,

    loading: "読み込み中…",
    loadFailed: "設定の取得に失敗しました。もう一度お試しください",

    errors: {
      invalid_webhook_enabled: "入力内容を確認してください",
      invalid_smtp_enabled: "入力内容を確認してください",
      invalid_webhook_url: "Webhook URLの形式を確認してください(http/httpsで有効なURLを入力してください)",
      invalid_smtp_host: "SMTPホストを確認してください",
      invalid_smtp_user: "ユーザー名を確認してください",
      invalid_smtp_from: "差出人メールアドレスを確認してください",
      invalid_smtp_password: "パスワードを確認してください",
      invalid_smtp_port: "ポート番号は1〜65535の範囲で入力してください",
      invalid_smtp_config: "メール通知を有効にする場合は、ホスト・ポート・差出人をすべて入力してください",
      invalid_body: "入力内容を確認してください",
      not_configured: "有効なチャネルが設定されていません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /**
   * 個人の通知設定(/settings/notifications/me、2026-08-22 追加)。
   * docs/requirements.md §7「通知設定の2層構造」— テナント設定(settingsNotifications, 上記)とは
   * 別物。文言でも明確に区別する(依頼「既存の /settings/notifications との違いを画面上で明示する」)。
   */
  settingsPersonalNotifications: {
    title: "個人の通知設定",
    tagline: "自分がどう通知を受け取るかの設定です。誰でも自分の分だけを変更できます。",

    distinctionBanner:
      "こちらは自分の受け取り方の設定です。会社全体のチャネル(SMTPサーバー・共有Webhookなど)を設定するには「通知設定(会社全体)」を開いてください。",
    distinctionBannerNoAccess: "こちらは自分の受け取り方の設定です。会社全体のチャネル設定は管理者にご確認ください。",
    linkToTenantSettings: "通知設定(会社全体)を開く →",

    categoriesSectionTitle: "通知の種類ごとの受け取り方",
    categoryColumnInapp: "アプリ内",
    categoryColumnEmail: "メール",
    categoryColumnWebhook: "個人Webhook",
    inappAlwaysOnHint: "アプリ内通知は常にONです(変更できません)。",
    categories: {
      missing_clock_out: "打刻忘れ",
      overtime_alert: "36協定・時間外アラート",
      leave_alert: "有給の失効間近・年5日取得義務アラート",
    } as Record<string, string>,

    emailSectionTitle: "通知先メールアドレス",
    emailAddressLabel: "メールアドレス",
    emailAddressPlaceholder: "未入力ならアカウントのメールアドレスを使用します",
    emailAddressEffectiveHint: (email: string) => `現在の宛先: ${email}`,

    webhookSectionTitle: "個人 Webhook",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "設定済み",
    webhookUrlNotConfigured: "未設定",
    keepIfBlankHint: "変更しない場合は空のままにしてください",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "設定を保存しました。",

    testSend: "テスト送信",
    testSendConfirmTitle: "テスト通知を送信しますか",
    testSendConfirmMessage: "保存されている個人Webhookへ実際に1通送信します。",
    testSendConfirmLabel: "送信する",
    testSendResultTitle: "テスト送信結果",
    testSendOk: "成功",
    testSendFailed: "失敗",

    loading: "読み込み中…",
    loadFailed: "設定の取得に失敗しました。もう一度お試しください",

    errors: {
      invalid_body: "入力内容を確認してください",
      invalid_categories: "通知の種類の指定を確認してください",
      invalid_email_address: "メールアドレスの形式を確認してください",
      invalid_webhook_url: "Webhook URLの形式を確認してください(http/httpsで有効なURLを入力してください)",
      encryption_unavailable: "現在この項目を保存できません。管理者にお問い合わせください",
      not_configured: "個人Webhookが設定されていません",
      decryption_failed: "保存された値を読み取れませんでした。もう一度設定し直してください",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /**
   * Slackスラッシュコマンド打刻の連携設定(/settings/slack、2026-08-22 追加、会社全体)。
   * docs/external-api/slack.md が仕様の正。
   */
  settingsSlack: {
    title: "Slack連携",
    tagline: "Slackのスラッシュコマンド(/punch)から打刻できるようにする設定です。",
    noPermission: "この設定を変更する権限がありません",
    setupGuideHint: "導入手順(Slackアプリの作成・Signing Secretの控え方)は docs/external-api/slack.md を参照してください。",

    teamIdLabel: "Slack ワークスペースID(Team ID)",
    teamIdPlaceholder: "T0123456",
    teamIdHint: "Slackの「Basic Information」ページなどで確認できます。1テナントにつき1ワークスペースのみ設定できます。",

    signingSecretLabel: "Signing Secret",
    signingSecretConfigured: "設定済み",
    signingSecretNotConfigured: "未設定",
    keepIfBlankHint: "変更しない場合は空のままにしてください",

    enabledLabel: "Slack打刻を有効にする",
    enabledHint: "有効にするには、ワークスペースIDとSigning Secretの両方が設定されている必要があります。",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "設定を保存しました。",
    saveNote: "この設定はテナント全体に適用されます。変更は監査ログに記録されます。",

    loading: "読み込み中…",
    loadFailed: "設定の取得に失敗しました。もう一度お試しください",

    linkNavHint: "従業員自身のSlackアカウント連携は「",
    linkNavLinkLabel: "Slack連携用トークンの入力",
    linkNavHintSuffix: "」から行えます(権限不要)。",

    errors: {
      invalid_enabled: "入力内容を確認してください",
      invalid_team_id: "ワークスペースIDを確認してください",
      invalid_signing_secret: "Signing Secretを確認してください",
      invalid_slack_config: "有効にする場合は、ワークスペースIDとSigning Secretの両方を入力してください",
      invalid_body: "入力内容を確認してください",
      encryption_unavailable: "現在この項目を保存できません。管理者にお問い合わせください",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /**
   * Slack連携用トークンの入力(/settings/slack-link、2026-08-22 追加、権限不要・全従業員向け)。
   * Slackで `/punch link` を実行すると発行される、15分間有効なワンタイムトークンをここで入力する。
   */
  settingsSlackLink: {
    title: "Slack連携用トークンの入力",
    tagline: "Slackで `/punch link` を実行すると表示されるトークンを入力すると、自分のSlackアカウントと連携できます。",
    howToTitle: "手順",
    howTo1: "Slackで `/punch link` を実行する",
    howTo2: "表示されたトークン(15分間有効)をコピーする",
    howTo3: "下の欄に貼り付けて「連携する」を押す",

    tokenLabel: "トークン",
    tokenPlaceholder: "kzsl_...",
    submit: "連携する",
    submitting: "連携中…",

    successTitle: "連携しました",
    successMessage: (slackUserId: string) => `Slackアカウント(${slackUserId})と連携しました。以後 \`/punch in\` などが使えます。`,

    errors: {
      invalid_token: "トークンを入力してください",
      invalid_body: "入力内容を確認してください",
      invalid_or_expired_token: "トークンが無効か、期限切れ(15分)です。Slackで `/punch link` をもう一度実行してください",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /** 設定サブナビ(/settings/* 間の行き来。アクセス可能な項目のみ表示)。 */
  settingsNav: {
    label: "設定メニュー",
    /** 自己批評での改善: 単なる「設定」だと他のタブと同格の項目に見えてしまうため、
     * 「一覧に戻る」操作だと分かる文言にする(非エンジニアが迷わないための平易さの要件)。 */
    hubLink: "設定メニュー一覧",
    myNotifications: "個人の通知設定",
    notifications: "通知設定(会社全体)",
    departments: "部署",
    members: "メンバー",
    presets: "権限プリセット",
    tenantProfile: "テナントプロファイル",
    leave: "有給休暇",
    help: "社内規定",
    privacy: "個人情報",
    attendance: "勤怠ルール",
    apiKeys: "APIキー",
    slack: "Slack連携",
  },

  settingsHub: {
    title: "設定",
    tagline: "テナントの設定・組織・権限を管理します。アクセスできる項目のみ表示されます。",
    empty: "利用できる設定項目がありません。管理者にお問い合わせください。",
    /** 個人設定(全員)と会社設定(管理者向け)をカード群として明確に分ける見出し。 */
    personalGroupTitle: "自分の設定",
    tenantGroupTitle: "会社の設定",
    myNotificationsTitle: "個人の通知設定",
    myNotificationsDesc: "通知の種類ごとに、アプリ内・メール・個人Webhookでの受け取り方を設定します。",
    notificationsTitle: "通知設定(会社全体)",
    notificationsDesc: "Webhook・メール(SMTP)の通知チャネルを設定します。",
    departmentsTitle: "部署",
    departmentsDesc: "部署ツリーの作成・名称変更・異動・削除を行います。",
    membersTitle: "メンバー",
    membersDesc: "メンバーの所属変更、権限プリセットの割当、実効権限の確認を行います。",
    presetsTitle: "権限プリセット",
    presetsDesc: "権限のON/OFFとスコープを組み合わせたプリセットを作成・編集します。",
    attendanceTitle: "勤怠ルール",
    attendanceDesc: "日界・法定休日・休憩ルール・GPS・フレックス設定を、版を追加する形で変更します。",
    tenantProfileTitle: "テナントプロファイル",
    tenantProfileDesc: "企業規模・特例措置対象事業場・特別条項など、集計に影響する属性と適用予定の法改正を確認します。",
    leaveTitle: "有給休暇",
    leaveDesc: "付与方式・時間単位年休・積立休暇のテナント全体の設定を行います。",
    helpTitle: "社内規定",
    helpDesc: "ヘルプに表示する自社のルールと、就業規則へのリンクを設定します。",
    privacyTitle: "個人情報",
    privacyDesc: "従業員向けプライバシー通知・社内利用規約の雛形を、現在の設定から確認します。",
    apiKeysTitle: "APIキー",
    apiKeysDesc: "ICカードリーダー・Slack bot・MCPサーバーなど外部クライアントから打刻するためのAPIキーを発行・失効します。",
    slackTitle: "Slack連携",
    slackDesc: "Slackのスラッシュコマンド(/punch)から打刻できるようにする設定を行います。",
    slackLinkTitle: "Slack連携用トークンの入力",
    slackLinkDesc: "Slackで `/punch link` を実行して発行したトークンを入力し、自分のSlackアカウントと連携します。",
  },

  /** 月次締め・CSVエクスポート(/monthly 画面、v0.3)。要件 §6(締めと出口)・§10(コンテキストヘルプ)。 */
  closing: {
    closedBadge: "確定済み",
    amendedBadge: "締め後に修正あり",

    closeAction: "この月を締める",
    reopenAction: "確定を解除する",

    confirmCloseTitle: "この月を締めますか",
    confirmCloseMessage:
      "この月の勤怠を確定します。以後の打刻・修正は申請と承認が必要になります。この操作は監査ログに記録されます。",
    confirmCloseLabel: "締める",

    confirmReopenTitle: "確定を解除しますか",
    confirmReopenMessage: "確定を解除すると、この月は再び自由に編集できる状態になります。",
    confirmReopenExtraNote: "締めの解除は影響の大きい操作です。この操作は監査ログに記録されます。",
    confirmReopenLabel: "解除する",

    noteLabel: "メモ(任意)",
    notePlaceholder: "締め・解除の理由など(任意)",

    diffTitle: "当初値との差分",
    diffColumnCategory: "区分",
    diffColumnOriginal: "当初",
    diffColumnCurrent: "現在",
    diffColumnDelta: "差分",
    diffFlexFrame: "フレックス総枠",
    diffFlexActual: "フレックス実績",
    diffFlexDiff: "フレックス収支",

    historyTitle: "締め履歴",
    historyEmpty: "まだ締め・解除の履歴はありません",
    historyActorSelf: "本人",
    historyEventLabel: {
      close: "締め",
      reopen: "解除",
      amend: "修正反映",
    } satisfies Record<"close" | "reopen" | "amend", string>,
    historyCorrectionLink: "由来の修正申請を確認する",

    csvDownload: "CSVをダウンロード",
    csvDownloading: "作成中…",
    csvCompareOriginalLabel: "当初値との差分を含める",
    csvDownloadFailed: "CSVのダウンロードに失敗しました。もう一度お試しください",

    errors: {
      already_closed: "この月は既に締められています",
      not_closed: "この月はまだ締められていません",
      invalid_period: "対象月の指定を確認してください",
      invalid_note: "メモは500文字以内で入力してください",
      invalid_body: "入力内容を確認してください",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /** テナントプロファイル設定(/settings/tenant-profile、v0.3)。要件 §10(法制度に由来する表示にはヘルプを添える)。 */
  settingsTenantProfile: {
    title: "テナントプロファイル",
    tagline: "労働時間の集計・36協定アラートの前提になる、テナント全体の属性を設定します。",
    noPermission: "この設定を変更する権限がありません",
    loadFailed: "設定の取得に失敗しました。もう一度お試しください",

    smeLabel: "中小企業かどうか",
    smeHint: "法改正の施行日が企業規模で異なる項目(月60時間超の割増、36協定の上限規制)の判定に使います。",

    specialProvisionLabel: "特例措置対象事業場かどうか",
    specialProvisionHint:
      "商業・映画演劇業・保健衛生業・接客娯楽業で常時9人以下の事業場は、週の法定労働時間が44時間になります(労基法40条)。",

    specialClauseLabel: "特別条項の締結あり",
    specialClauseHint:
      "36協定の特別条項に関するアラート(月100時間未満・複数月平均80時間・年720時間・月45時間超は年6回)を有効にします。",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "設定を保存しました。",

    confirmTitle: "この設定を変更しますか",
    confirmMessage: "この設定は労働時間の集計に直接影響します。",
    confirmExtraNote: "変更は監査ログに記録されます。",
    confirmLabel: "変更する",

    currentRulesTitle: "現在適用中の主要な値",
    currentRulesWeekly: "週の法定労働時間",
    currentRulesAgreementMonthly: "36協定・月の上限",
    currentRulesAgreementAnnual: "36協定・年の上限",
    currentRulesHourlyLeave: "時間単位年休の上限日数",
    currentRulesHourlyLeaveUnit: "日/年",
    currentRulesSpecialClauseTitle: "特別条項時の上限(締結ありの場合)",
    currentRulesSpecialMonthlyCap: "単月",
    currentRulesSpecialMonthlyCapNote: "未満",
    currentRulesSpecialMultiMonth: "複数月平均",
    currentRulesSpecialAnnual: "年間",
    currentRulesSpecialExceedCount: "月45時間超が許される回数",
    currentRulesSpecialExceedCountUnit: "回/年",

    upcomingTitle: "適用予定の法改正",
    upcomingEmpty: "現在、適用予定の法改正はありません",
    upcomingEffectiveFrom: "施行日",
    upcomingBasis: "根拠",
    upcomingChangesPrefix: "変更点: ",
    upcomingRuleLabel: {
      weeklyStatutoryMinutes: "週の法定労働時間",
      lateNight: "深夜帯",
      overtime60h: "月60時間超の区分",
      agreement36: "36協定の上限",
      annualLeave: "年次有給休暇",
    } satisfies Record<"weeklyStatutoryMinutes" | "lateNight" | "overtime60h" | "agreement36" | "annualLeave", string>,

    errors: {
      invalid_is_small_or_medium_enterprise: "入力内容を確認してください",
      invalid_is_special_provision_workplace: "入力内容を確認してください",
      invalid_special_clause_enabled: "入力内容を確認してください",
      invalid_body: "入力内容を確認してください",
      tenant_not_found: "テナント情報が見つかりません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /**
   * 勤怠ルールの版管理(/settings/attendance、2026-08-22 追加)。
   * docs/design/v01-data-model.md 原則6(effective-dated): 編集は新しい版の追加のみ。
   * 既存の版は変更されない(過去の計算結果は変わらない)。
   */
  settingsAttendance: {
    title: "勤怠ルール",
    tagline: "日界・法定休日・休憩ルール・GPS・フレックス設定を、版を追加する形で変更します。",
    noPermission: "この設定を変更する権限がありません",
    loadFailed: "設定の取得に失敗しました。もう一度お試しください",

    currentTitle: "現在有効な設定",
    currentEffectiveFrom: "この版が有効になった日",
    dayBoundaryLabel: "日界(1日の起算時刻)",
    legalHolidayLabel: "法定休日",
    legalHolidayWeekday: "曜日指定",
    legalHolidayDates: "暦日指定",
    breakRuleLabel: "休憩ルール",
    breakRulePunch: "打刻方式",
    gpsLabel: "GPS打刻",
    gpsEnabledYes: "有効",
    gpsEnabledNo: "無効",
    gpsRetentionLabel: "GPS座標の保持期間",
    gpsRetentionSameAsAttendance: "勤怠データと同一",
    gpsRetentionDaysUnit: "日",
    flexLabel: "フレックス設定",
    flexSettlementMonthly: "月次清算",
    flexStandardDayMinutesLabel: "標準労働時間(1日、分)",
    noVersionYet: "まだ設定がありません",

    weekdayLabel: {
      0: "日曜日",
      1: "月曜日",
      2: "火曜日",
      3: "水曜日",
      4: "木曜日",
      5: "金曜日",
      6: "土曜日",
    } satisfies Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>,

    formTitle: "新しい版を追加",
    effectiveFromLabel: "適用開始日",
    effectiveFromHint: "この変更は指定日以降の計算にのみ影響し、過去の集計は変わりません。",
    dayBoundaryHint: "0時=00:00起算。深夜勤務がある職場は例えば05:00(300分)にすると日をまたぐ勤務が1日にまとまります。",
    legalHolidayKindLabel: "指定方法",
    legalHolidayWeekdayValueLabel: "休日とする曜日",
    legalHolidayDatesValueLabel: "休日とする日付(カンマ区切り、YYYY-MM-DD)",
    legalHolidayDatesPlaceholder: "例: 2026-05-05,2026-05-06",
    gpsEnabledCheckbox: "GPS打刻を有効にする",
    gpsWarning: "従業員に取得することを明示する必要があります。プライバシー通知の雛形をご確認ください。",
    gpsWarningLink: "個人情報の設定を見る →",
    gpsRetentionInputLabel: "保持期間(空欄なら勤怠データと同一)",
    flexStandardDayMinutesHint: "有給取得日にこの分数が労働時間として枠に算入されます。",

    submit: "この内容で版を追加",
    submitting: "追加中…",
    submitSuccess: "新しい版を追加しました。",

    workPolicyFormTitle: "フレックス設定の新しい版を追加",
    workPolicyNoPermission: "フレックス設定を変更する権限がありません",

    historyTitle: "版の履歴",
    workPolicyHistoryTitle: "フレックス設定の版の履歴",
    historyEmpty: "まだ履歴がありません",
    historyColumnEffectiveFrom: "適用開始日",
    historyColumnSummary: "内容",

    errors: {
      invalid_body: "入力内容を確認してください",
      invalid_effective_from: "適用開始日を確認してください",
      invalid_day_boundary_minutes: "日界は0〜1439の範囲(分)で入力してください",
      invalid_legal_holiday_rule: "法定休日の指定を確認してください",
      invalid_break_rule: "休憩ルールを確認してください",
      invalid_gps_enabled: "入力内容を確認してください",
      invalid_gps_retention_days: "GPS座標の保持期間は1以上の整数で入力してください",
      invalid_settlement_period: "清算期間はこのバージョンでは「月次清算」のみ選べます",
      invalid_standard_day_minutes: "標準労働時間は1〜1440の範囲(分)で入力してください",
      effective_from_in_past: "適用開始日は本日以降のみ指定できます(過去の計算結果が変わってしまうため)",
      version_already_exists: "その適用開始日にはすでに版があります。別の日付を指定してください",
      forbidden: "この操作を行う権限がありません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  departments: {
    title: "部署管理",
    tagline: "部署ツリーの作成・名称変更・異動・削除を行います。",
    noPermission: "この画面を利用する権限がありません",
    loadFailed: "部署一覧の取得に失敗しました。もう一度お試しください",
    empty: "まだ部署がありません。「部署を追加」から作成してください。",
    topLevel: "トップレベル",
    addRoot: "部署を追加",
    addChild: "配下に追加",
    rename: "名前・親を変更",
    delete: "削除",

    formTitleCreate: "部署を追加",
    formTitleEdit: "部署を編集",
    nameLabel: "部署名",
    namePlaceholder: "例: 営業部",
    parentLabel: "親部署",
    parentNone: "なし(トップレベル)",
    save: "保存",
    saving: "保存中…",
    cancel: "キャンセル",

    confirmDeleteTitle: "この部署を削除しますか",
    confirmDeleteMessage: "削除すると元に戻せません。配下の部署やメンバーが残っている場合は削除できません。",
    confirmDeleteLabel: "削除する",

    errors: {
      invalid_name: "部署名を1〜200文字で入力してください",
      invalid_parent_id: "指定した親部署が見つかりません",
      invalid_body: "入力内容を確認してください",
      circular_reference: "自分自身や配下の部署は親にできません",
      not_found: "対象の部署が見つかりません",
      department_not_empty: "配下の部署またはメンバーが残っています",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  members: {
    title: "メンバー管理",
    tagline: "所属部署の変更、権限プリセットの割当、実効権限(できること)の確認を行います。",
    noPermission: "この画面を利用する権限がありません",
    loadFailed: "メンバー一覧の取得に失敗しました。もう一度お試しください",
    empty: "メンバーがいません",

    columnName: "氏名",
    columnEmail: "メールアドレス",
    columnDepartment: "所属部署",
    columnPresets: "割当プリセット",
    columnHireDate: "入社日",
    columnActions: "操作",
    noDepartment: "未所属",
    noPresets: "割当なし",

    detailToggleOpen: "詳細を開く",
    detailToggleClose: "詳細を閉じる",

    departmentChangeLabel: "所属部署を変更",
    departmentChangeSaved: "所属部署を変更しました",

    hireDateLabel: "入社日を設定",
    hireDateSave: "保存",
    hireDateSaving: "保存中…",
    hireDateSaved: "入社日を保存しました",
    hireDateUnset: "未設定",
    hireDateWarning: "入社日が未設定のため、法定付与(有給休暇)が計算できません",

    presetAssignTitle: "割り当てるプリセット",
    presetAssignHint: "チェックを変更すると、下の「できること」にすぐ反映されます。保存するまで実際の割当は変わりません。",
    presetAssignSave: "割当を保存",
    presetAssignSaving: "保存中…",
    presetAssignSaved: "権限プリセットの割当を保存しました",
    presetAssignUnsaved: "保存されていない変更があります",
    noPresetsAvailable: "利用できる権限プリセットがありません",

    effectiveTitle: "このメンバーができること",
    effectiveHint: "常に本人の打刻・申請の起票・自分の記録の閲覧ができます(全員共通、設定変更不可)。",
    effectiveEmpty: "上記の基本操作以外に割り当てられている権限はありません。",
    effectiveScopeLabel: "適用範囲",
    effectiveSourceLabel: "由来",
    /** 自己批評での改善: プリセット名に直接続けて括弧書きしていたため密度が高く読みづらかった。
     * 先頭に句読点を足して文として区切り、平易な言い回しにした。 */
    effectiveViaImplication: "。他の権限に自動的に含まれる閲覧です",

    errors: {
      invalid_body: "入力内容を確認してください",
      invalid_department_id: "指定した部署が見つかりません",
      invalid_hire_date: "入社日はYYYY-MM-DD形式で入力してください",
      not_found: "対象のメンバーが見つかりません",
      invalid_preset_id: "指定した権限プリセットが見つかりません",
      self_escalation: "自分自身に新しい権限を付けることはできません",
      self_demotion: "自分から権限管理の権限を外すことはできません",
      last_admin: "権限管理ができる最後のメンバーからこの権限を外すことはできません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  presets: {
    title: "権限プリセット管理",
    tagline: "権限のON/OFFとスコープを組み合わせたプリセットを作成・編集します。1人に複数割り当てると合算されます。",
    noPermission: "この画面を利用する権限がありません",
    loadFailed: "権限プリセットの取得に失敗しました。もう一度お試しください",
    empty: "権限プリセットがありません",

    columnName: "名前",
    columnDescription: "説明",
    columnType: "種別",
    columnAssignedCount: "割当人数",
    columnActions: "操作",
    systemBadge: "標準",
    customBadge: "カスタム",
    noDescription: "(説明なし)",
    assignedCountUnit: "人",

    addNew: "プリセットを新規作成",
    edit: "編集",
    duplicate: "複製して編集",
    delete: "削除",

    formTitleCreate: "権限プリセットを新規作成",
    formTitleEdit: "権限プリセットを編集",
    formReadonlyNote: "標準プリセットは編集できません。内容を変更したい場合は「複製して編集」から新しいプリセットを作成してください。",
    nameLabel: "名前",
    namePlaceholder: "例: 経理マネージャー",
    descriptionLabel: "説明(任意)",
    descriptionPlaceholder: "このプリセットの用途を書いておくと迷わず選べます",
    permissionsLabel: "権限",
    scopeLabel: "適用範囲",
    dangerousBadge: "重要",
    dangerousNote: "この権限は影響が大きい操作です。付与する相手をよく確認してください。",
    impliesViewPrefix: "この権限には次の閲覧が含まれます: ",
    save: "保存",
    saving: "保存中…",
    cancel: "キャンセル",
    close: "閉じる",

    confirmDeleteTitle: "この権限プリセットを削除しますか",
    confirmDeleteMessage: "削除すると元に戻せません。メンバーに割り当てられている場合は削除できません。",
    confirmDeleteLabel: "削除する",

    errors: {
      invalid_name: "名前を1〜100文字で入力してください",
      invalid_description: "説明は500文字以内で入力してください",
      invalid_grants: "選択した権限の内容を確認してください",
      invalid_body: "入力内容を確認してください",
      not_found: "対象の権限プリセットが見つかりません",
      system_preset: "標準プリセットは編集・削除できません",
      preset_in_use: "このプリセットは現在メンバーに割り当てられているため削除できません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /** 有給休暇ホーム(/leave、v0.3)。docs/requirements.md §5・docs/design/ui-direction.md。 */
  leave: {
    title: "有給休暇",
    tagline: "残高の確認、休暇の申請、申請の承認を行います。",
    loadFailed: "有給休暇の情報取得に失敗しました。もう一度お試しください",

    balanceTitle: "残高",
    annualLabel: "年次有給",
    stockedLabel: "積立休暇",
    remainingLabel: "残り",
    grantedTotalLabel: "付与合計",
    usedTotalLabel: "消化済み",
    noGrants: "付与された有給がありません",
    grantBreakdownToggle: "付与ごとの内訳",
    grantColumnGrantedOn: "付与日",
    grantColumnDays: "日数",
    grantColumnExpiresOn: "期限",
    grantColumnRemaining: "残り",
    grantExpired: "時効消滅",
    expiringSoonTitle: "まもなく失効します",
    expiringSoonNote: "60日以内に期限を迎える付与があります。早めの取得をおすすめします。",

    mandatoryTitle: "年5日取得義務の状況",
    mandatoryNone: "対象となる付与(年10日以上)がありません",
    mandatoryTakenLabel: "取得",
    mandatoryRequiredLabel: "必要",
    mandatoryDeadlineLabel: "期限",
    mandatoryShortagePrefix: "あと",
    mandatoryShortageSuffix: "日",
    mandatorySatisfied: "達成",

    requestFormTitle: "休暇を申請",
    dateLabel: "対象日",
    unitLabel: "単位",
    unitFullDay: "全休",
    unitHalfDayAm: "午前半休",
    unitHalfDayPm: "午後半休",
    unitHourly: "時間単位",
    minutesLabel: "時間(分)",
    minutesPlaceholder: "例: 120",
    leaveTypeLabel: "消化する枠",
    leaveTypeAnnual: "年次有給",
    leaveTypeStocked: "積立休暇",
    reasonLabel: "理由",
    reasonPlaceholder: "休暇の理由を入力してください",
    hourlyQuotaPrefix: "時間単位で取得できるのは年5日分までです(現在 ",
    hourlyQuotaSeparator: " / 上限 ",
    hourlyQuotaSuffix: ")",
    submit: "申請する",
    submitting: "送信中…",
    submitted: "申請を送信しました。承認されると勤怠記録に反映されます。",
    targetMonthClosedNote: "この月は確定済みです。承認するには確定解除の権限が必要です。",

    requestsTitle: "申請一覧",
    requestsEmpty: "申請はまだありません",
    columnDate: "対象日",
    columnUnit: "単位",
    columnLeaveType: "枠",
    columnReason: "理由",
    columnDecision: "決裁",

    statusLabel: {
      pending: "申請中",
      approved: "承認済",
      rejected: "却下",
      withdrawn: "取下げ",
    } satisfies Record<"pending" | "approved" | "rejected" | "withdrawn", string>,

    unitLabelShort: {
      full_day: "全休",
      half_day_am: "午前半休",
      half_day_pm: "午後半休",
      hourly: "時間単位",
    } satisfies Record<"full_day" | "half_day_am" | "half_day_pm" | "hourly", string>,

    leaveTypeLabelShort: {
      annual: "年次有給",
      stocked: "積立休暇",
    } satisfies Record<"annual" | "stocked", string>,

    approve: "承認",
    reject: "却下",
    withdraw: "取下げ",
    decidedBySelf: "本人",
    decisionNoteLabel: "決裁メモ",
    decisionNotePlaceholder: "メモ(任意)",

    confirmApproveTitle: "この申請を承認しますか",
    confirmApproveMessage: "承認すると勤怠記録に反映され、月次集計が変わります。この操作は監査ログに記録されます。",
    confirmApproveSelfNote: "自己承認として記録されます。",
    confirmRejectTitle: "この申請を却下しますか",
    confirmRejectMessage: "却下すると申請は却下済みとして記録され、勤怠記録には反映されません。",
    confirmWithdrawTitle: "この申請を取り下げますか",
    confirmWithdrawMessage: "取り下げると申請中の状態が解除されます。必要であれば再度申請できます。",

    close: "閉じる",
    cancel: "キャンセル",

    errors: {
      invalid_leave_date: "対象日を確認してください",
      invalid_reason: "理由を1〜500文字で入力してください",
      invalid_unit: "単位を確認してください",
      invalid_leave_type: "消化する枠を確認してください",
      invalid_minutes: "時間(分)を正しく入力してください",
      invalid_body: "入力内容を確認してください",
      hourly_leave_disabled: "時間単位の取得はこのテナントでは有効になっていません",
      half_day_leave_disabled: "半休の取得はこのテナントでは有効になっていません",
      duplicate_request: "同じ日・同じ単位の申請が既にあります",
      exceeds_daily_hours: "1日の所定労働時間を超えています",
      insufficient_balance: "残日数が足りません",
      hourly_limit_exceeded: "時間単位で取得できる年間上限を超えます",
      not_pending: "この申請は既に処理されています",
      not_found: "対象の申請が見つかりません",
      forbidden: "この操作を行う権限がありません",
      month_closed_requires_unlock: "この月は確定済みです。承認するには確定解除の権限が必要です",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /** 有給休暇の制度設定(/settings/leave、v0.3)。GET/PUT /settings/leave と付与管理系エンドポイントの文言をまとめる。 */
  settingsLeave: {
    title: "有給休暇の設定",
    tagline: "付与方式・時間単位年休・積立休暇のテナント全体の設定を行います。",
    noPermission: "この設定を変更する権限がありません",
    loadFailed: "設定の取得に失敗しました。もう一度お試しください",

    grantMethodSectionTitle: "付与方式",
    grantMethodStatutory: "法定(入社日基準)",
    grantMethodFixedDate: "基準日方式(全社一斉)",
    fixedDateLabel: "基準日(月-日)",
    fixedDatePlaceholder: "例: 04-01",

    hourlySectionTitle: "時間単位年休",
    hourlyEnabledLabel: "時間単位年休を有効にする",
    hourlyMaxDaysLabel: "年間上限日数(1〜5)",

    halfDaySectionTitle: "半休",
    halfDayEnabledLabel: "半休を有効にする",

    stockSectionTitle: "失効分の積立",
    stockEnabledLabel: "失効分の積立を有効にする",
    stockHelp: "時効で失効する年次有給を別枠に積み立てる制度です。法定の制度ではなく、会社が任意に設ける制度です。",
    stockMaxDaysLabel: "積立の上限日数",
    stockExpiresMonthsLabel: "積立分の有効期限(月数、空欄なら無期限)",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "設定を保存しました。",
    saveNote: "この設定はテナント全体に適用されます。変更は監査ログに記録されます。",

    adminSectionTitle: "付与・積立の管理",
    adminSectionTagline: "対象メンバーを選んで実行します。この操作は監査ログに記録されます。",
    targetUserLabel: "対象メンバー",
    targetUserPlaceholder: "メンバーを選択してください",

    autoGrantTitle: "法定付与の実行",
    autoGrantDesc: "入社日から計算して未付与分を作成します。既に付与済みの分は作られません。",
    autoGrantRun: "法定付与を実行",
    autoGrantRunning: "実行中…",
    autoGrantResultCreatedPrefix: "",
    autoGrantResultCreatedSuffix: "件付与しました",
    autoGrantResultSkippedPrefix: "(付与済みなどでスキップ ",
    autoGrantResultSkippedSuffix: "件)",
    autoGrantEmpty: "新たに付与できる分はありませんでした",

    manualGrantTitle: "手動付与",
    manualGrantDesc: "任意の日数・期限で有給を付与します。",
    grantedOnLabel: "付与日",
    daysLabel: "日数",
    expiresOnLabel: "期限(空欄なら既定値: 年次有給は付与日+2年、積立は無期限)",
    leaveTypeLabel: "種別",
    leaveTypeAnnual: "年次有給",
    leaveTypeStocked: "積立休暇",
    noteLabel: "メモ(任意)",
    manualGrantSubmit: "付与する",
    manualGrantSubmitting: "処理中…",
    manualGrantSuccess: "付与しました。",

    convertTitle: "失効分の積立振替",
    convertDesc: "時効で失効した年次有給の未消化分を積立休暇に振り替えます。",
    convertRun: "積立振替を実行",
    convertRunning: "実行中…",
    convertResultTitle: "振替結果",
    convertResultConvertedPrefix: "振替日数: ",
    convertResultConvertedSuffix: "日",
    convertResultTruncatedPrefix: "(上限超過で切り捨て: ",
    convertResultTruncatedSuffix: "日)",
    convertResultEmpty: "振替対象はありませんでした",

    errors: {
      invalid_grant_method: "付与方式を確認してください",
      invalid_fixed_date_mm_dd: "基準日はMM-DD形式で入力してください",
      invalid_hourly_leave_enabled: "入力内容を確認してください",
      invalid_half_day_leave_enabled: "入力内容を確認してください",
      invalid_stock_conversion_enabled: "入力内容を確認してください",
      invalid_hourly_leave_max_days: "年間上限日数は1〜5の範囲で入力してください",
      invalid_stock_max_days: "積立の上限日数を正しく入力してください",
      invalid_stock_expires_months: "積立分の有効期限(月数)を正しく入力してください",
      invalid_body: "入力内容を確認してください",
      invalid_user_id: "対象メンバーを選択してください",
      invalid_granted_on: "付与日を確認してください",
      invalid_days: "日数を正しく入力してください",
      invalid_expires_on: "期限を確認してください",
      invalid_leave_type: "種別を確認してください",
      invalid_note: "メモを確認してください",
      not_found: "対象が見つかりません",
      hire_date_not_set: "対象メンバーの入社日が設定されていません",
      leave_settings_not_configured: "先に有給の制度設定を保存してください",
      stock_conversion_disabled: "積立の設定が有効になっていません",
      forbidden: "この操作を行う権限がありません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /**
   * 社内規定の編集画面(/settings/help、2026-08-22 追加)。
   * docs/design/ui-direction.md「ガイド・ヘルプの方針 > 社内規定の記入例」の3原則をそのまま画面上に明示する。
   */
  settingsHelp: {
    title: "社内規定",
    tagline: "組み込みのヘルプ(法令・KIZAMIの仕様)に、自社のルールを追記できます。",
    noPermission: "この設定を変更する権限がありません",
    loadFailed: "情報の取得に失敗しました。もう一度お試しください",

    guidelinesTitle: "書き方のガイドライン",
    guideline1: "法令の内容は書き写さない — 法令部分は自動で表示されます。重複させると、法改正でKIZAMI側だけが更新され、この欄に古い記述が残って矛盾します",
    guideline2: "自社で決めたことだけを書く — 期限・窓口・例外の扱いなど",
    guideline3: "就業規則の該当条文を参照する形が望ましい(例:「詳細は就業規則第○条」)",

    workRulesSectionTitle: "就業規則へのリンク",
    workRulesDesc: "就業規則(PDF等)のURLを設定すると、ヘルプ画面に「就業規則を見る」リンクが表示されます。",
    workRulesUrlLabel: "URL",
    workRulesUrlPlaceholder: "https://example.com/work-rules.pdf",
    workRulesSave: "保存",
    workRulesSaving: "保存中…",
    workRulesSaveSuccess: "就業規則のリンクを保存しました。",

    listTitle: "ヘルプ項目",
    listEmployeeGroup: "従業員向け",
    listAdminGroup: "労務担当者向け",
    originLaw: "法令",
    originProduct: "KIZAMIの仕様",
    hasOverrideBadge: "追記あり",
    selectPrompt: "左の一覧からヘルプ項目を選んでください。",

    referenceTitle: "組み込みの説明",
    editorTitle: "自社の規定",
    editorPlaceholderNote: "薄い文字は記入例です。そのまま使う場合はコピーしてください。",
    bodyLabel: "本文(Markdown)",
    save: "保存",
    saving: "保存中…",
    saveSuccess: "社内規定を保存しました。",
    deleteConfirmTitle: "社内規定を削除",
    deleteConfirmMessage: "この項目の自社の規定を削除します。組み込みの説明のみが表示される状態に戻ります。",
    delete: "削除",
    deleting: "削除中…",
    deleteSuccess: "社内規定を削除しました。",
    empty: "本文が空のため保存すると削除扱いになります。",

    errors: {
      invalid_help_key: "存在しないヘルプ項目です",
      invalid_body_md: "本文を確認してください",
      invalid_url: "URLはhttp(s)形式で入力してください",
      invalid_body: "入力内容を確認してください",
      forbidden: "この操作を行う権限がありません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },

  /**
   * 個人情報まわりの雛形画面(/settings/privacy、2026-08-22 追加)。
   * docs/design/ui-direction.md「個人情報まわりの雛形」の要件どおり、雛形であって
   * 法的助言ではないことを画面上に常時表示する。
   */
  settingsPrivacy: {
    title: "個人情報",
    tagline: "従業員向けプライバシー通知・社内利用規約の雛形を、現在の設定から生成します。",
    noPermission: "この設定を見る権限がありません",
    loadFailed: "情報の取得に失敗しました。もう一度お試しください",

    disclaimer:
      "この文面は KIZAMI が提供する雛形です。自社の実情に合わせて必ず見直し、必要に応じて専門家(社会保険労務士・弁護士等)に確認してください。法的助言ではありません。",

    generatedFromTitle: "この雛形のもとになった設定",
    generatedFromGpsOn: "GPS: 有効",
    generatedFromGpsOff: "GPS: 無効",
    generatedFromRetention: (days: number) => `位置情報の保持期間: ${days}日`,
    generatedFromRetentionSame: "位置情報の保持期間: 打刻記録と同一",
    generatedFromNote: "GPSの有効/無効や保持期間は「設定 > テナントプロファイル」等、テナント設定側の変更に応じて次回表示時に更新されます。",

    noticeSectionTitle: "従業員向けプライバシー通知",
    noticeSectionDesc: "取得する項目・利用目的・保存期間・開示等の請求先をまとめた雛形です。従業員への周知にご利用ください。",
    termsSectionTitle: "社内利用規約(打刻に関するルール)",
    termsSectionDesc: "正確な打刻の義務・代理打刻の禁止・修正申請の手続きなどをまとめた雛形です。",

    copy: "コピー",
    copied: "コピーしました",
    copyFailed: "コピーに失敗しました。手動で選択してコピーしてください",
    download: "Markdownをダウンロード",
    registerAsCompanyRule: "社内規定として登録",
    registering: "登録中…",
    registerSuccess: "社内規定として登録しました。「設定 > 社内規定」から編集できます。",
    registerFailed: "登録に失敗しました。もう一度お試しください",
  },

  /**
   * APIキー(公開打刻API、v0.4)の管理画面(/settings/api-keys)。
   * 権限は不要(自分のキーは誰でも発行・失効できる、依頼「自分用なので権限不要」)。
   */
  settingsApiKeys: {
    title: "APIキー",
    tagline: "ICカードリーダー・Slack bot・MCPサーバーなど、セッションCookieを持てない外部クライアントから打刻するためのキーです。",
    loadFailed: "情報の取得に失敗しました。もう一度お試しください",

    listTitle: "発行済みのキー",
    empty: "発行済みのAPIキーはありません。",
    columnName: "名前",
    columnScopes: "スコープ",
    columnCreated: "作成日",
    columnLastUsed: "最終使用",
    columnExpires: "有効期限",
    columnStatus: "状態",
    columnActions: "操作",
    neverUsed: "未使用",
    noExpiry: "無期限",
    statusActive: "有効",
    statusRevoked: "失効済み",
    statusExpired: "期限切れ",
    revoke: "失効させる",
    revoking: "失効させています…",

    revokeConfirmTitle: "APIキーを失効させる",
    revokeConfirmMessage: "このキーを使っている連携(ICカードリーダー・Slack bot・MCPサーバー等)は動作しなくなります。この操作は取り消せません。",

    scopePunch: "打刻(punch) — 自分の打刻の作成・参照",
    scopeRead: "参照(read) — 自分の勤怠の参照のみ",

    createTitle: "新しいキーを発行",
    nameLabel: "名前(用途がわかるもの)",
    namePlaceholder: "例: 2F入口ICカードリーダー",
    scopesLabel: "スコープ(複数選択可)",
    expiresLabel: "有効期限(任意)",
    expiresHint: "空欄のままにすると無期限になります。",
    issue: "発行する",
    issuing: "発行しています…",

    createdTitle: "キーを発行しました",
    createdWarning: "この値は二度と表示されません。安全な場所に保管してください。",
    createdTokenLabel: "APIキー",
    copy: "コピー",
    copied: "コピーしました",
    copyFailed: "コピーに失敗しました。手動で選択してコピーしてください",
    createdDone: "閉じる",

    usageExampleTitle: "使い方の例",
    usageExampleDesc: "発行したキーを Authorization ヘッダに Bearer トークンとして付けてリクエストしてください。",
    usageExampleCurlComment: "# 出勤打刻",

    errors: {
      invalid_name: "名前を1〜100文字で入力してください",
      invalid_scopes: "スコープを1つ以上選択してください",
      invalid_expires_at: "有効期限の形式を確認してください",
      not_found: "対象のキーが見つかりません",
      already_revoked: "このキーは既に失効しています",
      forbidden: "この操作を行う権限がありません",
      default: "処理に失敗しました。もう一度お試しください",
    },
  },
} as const;

/** apps/api のエラーコード({ error: string })を日本語文言へマッピングする(§10 コンテキストヘルプ・messages.ts 集約方針)。 */
export function mapCorrectionErrorMessage(body: unknown): string {
  const errors = messages.corrections.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.corrections.errors.default;
  }
  return messages.corrections.errors.default;
}

/** apps/api の通知設定エラーコード({ error: string })を日本語文言へマッピングする(messages.ts 集約方針)。 */
export function mapNotificationSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsNotifications.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsNotifications.errors.default;
  }
  return messages.settingsNotifications.errors.default;
}

/** apps/api の個人通知設定エラーコード({ error: string })を日本語文言へマッピングする(messages.ts 集約方針)。 */
export function mapPersonalNotificationSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsPersonalNotifications.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsPersonalNotifications.errors.default;
  }
  return messages.settingsPersonalNotifications.errors.default;
}

/** apps/api の Slack連携設定エラーコード({ error: string })を日本語文言へマッピングする(messages.ts 集約方針)。 */
export function mapSlackSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsSlack.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsSlack.errors.default;
  }
  return messages.settingsSlack.errors.default;
}

/** apps/api の Slack連携用トークン確定エラーコード({ error: string })を日本語文言へマッピングする(messages.ts 集約方針)。 */
export function mapSlackLinkErrorMessage(body: unknown): string {
  const errors = messages.settingsSlackLink.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsSlackLink.errors.default;
  }
  return messages.settingsSlackLink.errors.default;
}

function errorCodeOf(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return null;
}

export function mapDepartmentErrorMessage(body: unknown): string {
  const errors = messages.departments.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.departments.errors.default;
}

/** メンバーの所属変更(PATCH /members/:id)のエラーマッピング。 */
export function mapMemberErrorMessage(body: unknown): string {
  const errors = messages.members.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.members.errors.default;
}

/** 権限プリセット割当(PUT /members/:id/presets)のエラーマッピング。固定原則(自己昇格・自己降格・最後の権限管理保持者)を含む。 */
export function mapAssignmentErrorMessage(body: unknown): string {
  const errors = messages.members.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.members.errors.default;
}

export function mapPresetErrorMessage(body: unknown): string {
  const errors = messages.presets.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.presets.errors.default;
}

/** 月次締め(POST /closings/:period/close・/reopen)のエラーマッピング(v0.3)。 */
export function mapClosingErrorMessage(body: unknown): string {
  const errors = messages.closing.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.closing.errors.default;
}

/** テナントプロファイル(PUT /settings/tenant-profile)のエラーマッピング(v0.3)。 */
export function mapTenantProfileErrorMessage(body: unknown): string {
  const errors = messages.settingsTenantProfile.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsTenantProfile.errors.default;
}

/** 休暇申請(POST /leave/requests・:id/approve・reject・withdraw)のエラーマッピング(v0.3)。 */
export function mapLeaveRequestErrorMessage(body: unknown): string {
  const errors = messages.leave.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.leave.errors.default;
}

/** 有給の制度設定・付与管理(GET/PUT /settings/leave・POST /leave/grants*)のエラーマッピング(v0.3)。 */
export function mapLeaveSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsLeave.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsLeave.errors.default;
}

/** 社内規定(PUT/DELETE /help/overrides/:key・PUT /settings/work-rules-url)のエラーマッピング(2026-08-22)。 */
export function mapHelpSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsHelp.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsHelp.errors.default;
}

/**
 * 勤怠ルールの版管理(POST /settings/attendance・POST /settings/work-policy)のエラーマッピング
 * (2026-08-22 追加)。
 */
export function mapAttendanceSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsAttendance.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsAttendance.errors.default;
}

/** APIキー発行/失効(POST・DELETE /api-keys)のエラーマッピング(v0.4 追加)。 */
export function mapApiKeysErrorMessage(body: unknown): string {
  const errors = messages.settingsApiKeys.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsApiKeys.errors.default;
}
