/**
 * 表示文言(日本語、既定ロケール)。
 *
 * 4言語対応(2026-08-23、日/英/韓/中)の基準となる辞書。他ロケール(en/ko/zh)は
 * この型(`Messages = typeof ja`)を `satisfies Messages` で満たす形で用意し、
 * キーの過不足をコンパイルエラーで検出する(apps/web/src/lib/i18n/index.ts)。
 * 動詞ラベルは要件 §10「出勤/退勤/休憩に入る/休憩から戻る」で統一する。
 */
export const ja = {
  appName: "KIZAMI",
  tagline: "1分単位で時を刻む勤怠管理。",

  nav: {
    dashboard: "ホーム",
    punch: "打刻",
    monthly: "月次",
    corrections: "申請",
    leave: "有給",
    settings: "設定",
    logout: "ログアウト",
  },

  /** モバイル下部タブバー・「その他」シート(2026-08-22 ナビ作り直しで追加)。 */
  mobileNav: {
    more: "その他",
    moreAriaLabel: "その他のメニューを開く",
    sheetTitle: "メニュー",
    close: "閉じる",
    openNotifications: "通知を見る",
    /** 通知一覧画面(/notifications、2026-08-22 追加)への導線。openNotifications(ベルを開く)とは別物。 */
    allNotifications: "すべての通知を見る",
    stampScreenLink: "スタンプ演出のある打刻画面を開く →",
  },

  /** 全画面共通ヘッダーのテナント名表示(2026-08-23 追加)。ロゴだけでは
   * 「どの会社のインスタンスか」が分からないという要望への対応。 */
  header: {
    tenantAriaLabel: "所属組織",
  },

  /** ホーム(ダッシュボード、2026-08-22 新設)。docs/design/ui-direction.md「今後のUI作業 > 4」。 */
  dashboard: {
    title: "ホーム",
    punchSectionTitle: "打刻",
    todayTitle: "今日・今月",
    todayWorkedLabel: "今日の実労働",
    monthFlexLabel: "今月のフレックス収支",
    monthFlexMoreLink: "月次を見る →",

    todoTitle: "要対応",
    todoEmpty: "対応が必要なものはありません。",
    todoLoadFailed: "一部の情報を取得できませんでした。",

    todoNotificationsTitle: "未読の通知",
    todoNotificationsCountSuffix: "件",
    todoNotificationsMore: "ほかにも未読があります",

    todoApprovalsTitle: "承認待ちの申請",
    todoApprovalsCorrections: "打刻の修正申請",
    todoApprovalsLeave: "休暇申請",
    todoApprovalsCountSuffix: "件",
    todoApprovalsGoCorrections: "修正申請を見る →",
    todoApprovalsGoLeave: "有給休暇を見る →",

    todoWarningsTitle: "打刻に警告のある日",
    todoWarningsMore: (n: number) => `ほかに${n}日`,
    todoWarningsFix: "修正する",

    todoDeadlinesTitle: "期限が近い義務",
    todoDeadlinesMandatoryPrefix: "年5日取得義務まであと",
    todoDeadlinesMandatorySuffix: "日分不足しています(期限: ",
    todoDeadlinesMandatorySuffix2: ")",
    todoDeadlinesExpiring: "まもなく失効する有給休暇があります",
    todoDeadlinesGoLeave: "有給休暇を見る →",

    quickLinksTitle: "よく使う画面",
    quickLinkMonthlyTitle: "月次",
    quickLinkMonthlyDesc: "実労働・フレックス収支・警告のある日を確認します。",
    quickLinkCorrectionsTitle: "申請",
    quickLinkCorrectionsDesc: "打刻の追加・訂正・取消を申請します。",
    quickLinkLeaveTitle: "有給休暇",
    quickLinkLeaveDesc: "残高の確認、休暇の申請を行います。",
  },

  /**
   * ダッシュボードの「はじめに」セクション(2026-08-22 追加)。docs/design/ui-direction.md
   * 「今後のUI作業 > 5. オンボーディング」。未完了の項目だけを静かに列挙する
   * (モーダルでは操作を強制しない)。
   */
  onboarding: {
    title: "はじめに",
    dismiss: "もう表示しない",

    punchTitle: "まず打刻してみましょう",
    punchReason: "打刻すると、その日から実労働時間の集計が始まります。",
    punchAction: "打刻画面を開く →",

    notifPrefsTitle: "通知の受け取り方を設定できます",
    notifPrefsReason: "既定ではアプリ内通知のみです。メールやWebhookでも受け取れます。",
    notifPrefsAction: "通知設定を開く →",

    attendanceTitle: "勤怠設定がまだ初期値のままです",
    attendanceReason: "日界・法定休日・GPS・フレックスなどの設定を、実態に合わせて確認してください。",
    attendanceAction: "勤怠設定を開く →",

    channelsTitle: "通知チャネルが未設定です",
    channelsReason: "メールやWebhookを設定すると、打刻忘れなどのアラートを従業員に届けられます。",
    channelsAction: "通知設定(会社全体)を開く →",

    soloTitle: "メンバーがまだ自分だけです",
    soloReason: "メンバーを招待すると、他の従業員の打刻・申請を管理できるようになります。",
    soloAction: "メンバーを招待する →",

    hireDateTitle: (count: number) => `入社日が未設定のメンバーが${count}名います`,
    hireDateReason: "入社日が未設定だと、有給休暇の法定付与日数を自動計算できません。",
    hireDateAction: "メンバー設定を開く →",
  },

  /** テーマ切り替え(ヘッダーのユーザーメニュー内、2026-08-22 ダーク対応で追加)。 */
  theme: {
    label: "テーマ",
    system: "システム設定に従う",
    light: "ライト",
    dark: "ダーク",
  },

  /**
   * 言語切り替え(ヘッダーのユーザーメニュー内、2026-08-23 4言語対応で追加)。
   * ThemeToggle と同じ場所・同じ作法(k-header__theme 相当の見た目)で配置する。
   * 選択肢のラベル自体(日本語 / English / 한국어 / 简体中文)は各言語の自称のため
   * ロケールに関わらず固定 — messages ではなく lib/i18n/index.ts の LOCALE_NATIVE_NAMES で持つ。
   */
  language: {
    label: "言語",
  },

  /** 汎用の細かい断片(区切り記号など、複数画面で使い回すもの)。 */
  common: {
    /** 2つの短い補足文をゆるく区切る記号(例:「設定済み(…)」・「変更しない場合は空のままに」)。 */
    hintSeparator: " ・ ",
  },

  /**
   * HelpTip(法令/KIZAMIの仕様/自社の規定バッジ付きヘルプ、docs/design/ui-direction.md
   * 「ガイド・ヘルプの方針」)の周辺 UI 文言。ヘルプ本文自体(@kizami/help-content)は
   * 日本語のみで今回のスコープ外(.en.md 等の拡張は将来対応)。
   */
  helpTip: {
    originLaw: "法令",
    originProduct: "KIZAMIの仕様",
    originCompany: "自社の規定",
    ariaLabelPrefix: "ヘルプ",
    detailLink: "詳しく見る →",
    workRulesLink: "就業規則を見る →",
  },

  /**
   * 日時表示の共通フォーマット(lib/time.ts から参照、2026-08-23 4言語対応で追加)。
   * タイムゾーンは JST 固定のまま(time.ts 冒頭のコメント参照)。曜日・月日の「見せ方」だけを
   * ロケールごとに切り替える。
   */
  time: {
    /** getUTCDay() の並び(0=日曜)に対応する曜日の短縮表記。 */
    weekdayShort: ["日", "月", "火", "水", "木", "金", "土"] as readonly [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ],
    /** "YYYY年M月"(月次画面の見出し等)。 */
    monthLabel: (year: number, month: number) => `${year}年${month}月`,
    /** "M/D(曜)"。 */
    dateLabel: (month: number, day: number, weekday: string) => `${month}/${day}(${weekday})`,
    /** formatDaysHoursMinutes(有給残高の表示)の単位・区切り。 */
    unitDay: "日",
    unitHour: "時間",
    unitMinute: "分",
    durationJoin: "",
  },

  /** 打刻画面の大時計(PunchHome)。 */
  punchClock: {
    currentTimeAriaLabel: (hm: string, ss: string) => `現在時刻 ${hm}分${ss}秒`,
  },

  /** スコープの日本語名(要件 §4)。狭い→広い: self < department < department_and_descendants < tenant。 */
  scopeLabel: {
    self: "本人のみ",
    department: "自部署",
    department_and_descendants: "自部署+配下部署",
    tenant: "テナント全体",
  } satisfies Record<"self" | "department" | "department_and_descendants" | "tenant", string>,

  /**
   * 権限プリセット関連の表示文言(lib/permissions.ts 参照、2026-08-23 i18n 対応で追加)。
   * 元は lib/permissions.ts の PERMISSION_CATEGORIES.labelJa・INTERNAL_VIEW_LABELS に
   * 日本語がハードコードされていた(EffectivePermissionsPanel・PresetFormDialog が参照)。
   */
  permissions: {
    /** lib/permissions.ts の PERMISSION_CATEGORIES の id → 業務グループの表示名。 */
    categoryLabel: {
      attendance: "打刻・申請と承認",
      leave: "休暇",
      closing: "締めとエクスポート",
      org: "メンバーと組織",
      settings: "設定と権限",
      other: "その他",
    } as Record<string, string>,
    /** lib/permissions.ts の INTERNAL_VIEW_KEYS(カタログに存在しない「閲覧のみ含意される」内部キー)の表示名。 */
    internalViewLabel: {
      "department.view": "部署ツリーの閲覧",
      "tenant_settings.view": "テナント設定の閲覧",
      "permission_preset.view": "権限プリセット一覧の閲覧",
      "permission_assignment.effective_view": "メンバーの実効権限(できること)の閲覧",
      "api_key.view": "APIキー一覧の閲覧",
    } as Record<string, string>,
  },

  login: {
    title: "KIZAMI",
    tagline: "1分単位で時を刻む勤怠管理",
    emailLabel: "メールアドレス",
    passwordLabel: "パスワード",
    submit: "ログイン",
    submitting: "ログイン中…",
    invalidCredentials: "メールアドレスまたはパスワードが違います",
    genericError: "ログインに失敗しました。時間をおいて再度お試しください",

    /** 同一メール+パスワードが複数テナントに一致した場合のテナント選択(2026-08-23 追加)。
     * Slack のワークスペース選択に近い体験を意図し、パスワードの再入力は求めない
     * (直前の検証結果をそのまま使い、選んだテナント宛に再送するだけ)。 */
    tenantSelectTitle: "ログインする会社を選んでください",
    tenantSelectDescription: "同じメールアドレスで複数の会社にアカウントがあります。",
    tenantUnnamed: "(名称未設定)",
    backToEmail: "別のアカウントでログイン",
  },

  /**
   * 招待受諾画面(/invite/[token]、認証ガード無し・公開、2026-08-23 追加)。
   * docs/requirements.md §7「登録は招待式のみ」。ログイン画面と同じ「紙白+中央カード」の構成。
   * 従業員が最初に触るKIZAMIの画面のため、文言は特に丁寧に(怖がらせない・迷わせない)。
   */
  inviteAccept: {
    invitedBySuffix: " があなたを招待しています",
    invitedByUnnamed: "会社",
    nameLabel: "氏名",
    emailLabel: "メールアドレス",
    passwordLabel: "パスワード(12文字以上)",
    passwordConfirmLabel: "パスワード(確認)",
    passwordMismatch: "パスワードが一致しません",
    passwordTooShort: "パスワードは12文字以上で入力してください",
    submit: "登録してはじめる",
    submitting: "登録しています…",
    loading: "招待の内容を確認しています…",

    invalidTitle: "この招待リンクは無効です",
    invalidMessage: "この招待リンクは無効です。管理者に確認してください。",
    expiredTitle: "この招待は期限切れです",
    expiredMessage: "この招待は期限切れです。管理者に再発行を依頼してください。",
    acceptedRedirecting: "登録が完了しました。移動しています…",

    /**
     * アカウント作成には成功したがセッション発行だけ失敗した場合(2026-08-23 API側新設、
     * `{ accountActivated: true, error: "session_issuance_failed" }`)。自動ログインには
     * 失敗したがアカウント自体は使える状態のため、ログイン画面への導線を示す。
     */
    sessionIssuanceFailedTitle: "アカウントを作成しました",
    sessionIssuanceFailedMessage: "アカウントは作成されました。ログインページからサインインしてください。",
    goToLogin: "ログインページへ",

    errors: {
      invalid_password: "パスワードは12文字以上で入力してください",
      default: "処理に失敗しました。もう一度お試しください",
    },
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
    /** 打刻時刻(出勤→退勤)の列(2026-08-23 追加)。 */
    columnStretches: "勤務",
    /**
     * 広いビューポートでは「勤務」1列を出勤・退勤の2列に分ける(2026-08-23 追加)。
     * 意味は columnStretches の1セル表記(formatStretchRange 等)と同じで、表示形の違いのみ。
     */
    columnClockIn: "出勤",
    columnClockOut: "退勤",
    columnWorked: "実労働",
    /** insufficient_break の警告文言に添える不足量(必要・実際)。 */
    breakShortfallSuffix: (required: string, actual: string) => `(必要 ${required}・実際 ${actual})`,
    columnBreak: "休憩",
    /** 休憩の自動控除の併記ラベル(2026-08-23 追加、docs/design/breaks.md「UI 上の扱い」)。 */
    autoBreakLabel: "自動",
    columnLateNight: "深夜",
    /** 固定時間制のときだけ出す時間外列(2026-08-23 追加)。 */
    columnOvertime: "時間外",
    columnWarning: "警告",
    columnActions: "操作",
    correctionAction: "修正",
    empty: "この月の打刻データはありません",

    /** 未退勤の勤務区間(clockOutAt: null)。 */
    stretchOpenEnded: "—",
    /** 退勤が翌日の暦日にまたがるときの接頭辞。 */
    stretchNextDayPrefix: "翌",
    /**
     * 日界をまたぐ勤務の「受け側」の日の勤務列先頭に出す接頭辞(2026-08-23 追加)。
     * 「翌」表記(区間の開始日側)と対称: 前日からなら stretchPrevDayLabel、
     * 2日以上前からなら stretchFromDateLabel(M/D)を使う。
     */
    stretchPrevDayLabel: "(前日から)",
    stretchFromDateLabel: (monthDay: string) => `(${monthDay} から)`,
    /** 法定内残業(extraWithinStatutoryMinutes)の併記ラベル。 */
    overtimeExtraLabel: "法定内",

    /** 表示中の労働時間制の明示(2026-08-23 追加、ui-direction.md「月次」節)。 */
    workSystemLabel: "表示中の労働時間制",
    workSystemValue: {
      flex: "フレックスタイム制",
      fixed: "固定時間制",
    } satisfies Record<"flex" | "fixed", string>,

    flexBalanceLabel: "フレックス収支",
    flexBalanceUnit: "分",
    /** 固定時間制での「フレックス収支バー」置き換え(2026-08-23 追加)。36協定の月45時間に対する時間外の位置。 */
    overtimeBarLabel: "時間外(36協定 月45時間の上限に対して)",
    overtimeBarUnit: "分",
    /** 上限に対する残り(下回っているとき)。 */
    overtimeBarRemainingLabel: "残り",
    /** 上限を超えたとき(頭打ち表示だけでなく文言でも分かるように)。 */
    overtimeBarOverLabel: "上限を超過",

    totalsLabel: "区分別合計",
    /** 手当対象時間の月合計の見出し(docs/design/allowances.md「UI」節、2026-08-23 追加)。 */
    allowanceTotalsLabel: "手当対象時間",
    /** 締め後修正の差分テーブルで、手当の行だと分かるよう名前の前に付ける。 */
    allowanceDiffPrefix: "手当: ",
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
    mixed_work_system:
      "この期間の途中で労働時間制が変更されました。期間開始日時点の制度で月全体を集計しています。集計対象の期間を分けて確認したい場合は管理者にご相談ください",
    insufficient_break: "この勤務の休憩が法律で必要な時間に足りていません。休憩の打刻漏れがないか確認してください",
  } satisfies Record<
    | "missing_clock_out"
    | "duplicate_clock_in"
    | "clock_out_without_in"
    | "break_outside_work"
    | "duplicate_break_start"
    | "unmatched_break_end"
    | "clock_out_during_break"
    | "mixed_work_system"
    | "insufficient_break",
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

    /** 追加/訂正/取消(/休憩打ち消し)モードを選ぶ radiogroup の aria-label。 */
    modeGroupAriaLabel: "操作の種類",
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

    /**
     * 承認待ちキュー(2026-08-23 追加、autoBreakWaiver の own/queue 二段構成と同じ形に統一)。
     * GET /corrections は view_all/approve 権限があればスコープ内全員分を返すため、
     * 自分の申請一覧(上記 title/empty)とは別に「承認待ち(自分以外も含む)」を出す。
     */
    queueSectionTitle: "承認待ちの修正申請",
    queueSectionTagline: "承認権限のある範囲内で、承認待ちの修正申請です。",
    queueEmpty: "承認待ちの申請はありません",

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

  /**
   * 休憩自動控除の打ち消し申請(2026-08-23 追加)。docs/design/breaks.md「採る設計」の
   * UI 側。correction_requests(打刻修正申請)とは別テーブル・別フローだが、
   * 承認画面は同じ場所(/corrections)・同じ作法(ConfirmDialog・k-modal)を踏襲する。
   */
  autoBreakWaiver: {
    /** CorrectionForm(月次の修正モーダル)内の新モードタブ。 */
    modeWaiver: "休憩を取れなかった",
    /** 自動控除がある日にモーダル上部へ出す注記。 */
    deductedNotice: (amount: string) => `この日は自動 ${amount} が休憩として控除されています。`,
    formHint: "実際には休憩を取れなかった場合の申請です。承認されるとこの日の自動控除がなくなり、休憩不足であれば警告が表示されます。",
    reasonLabel: "理由",
    reasonPlaceholder: "休憩を取れなかった理由を入力してください",
    submit: "申請する",
    submitting: "送信中…",

    typeLabel: "休憩自動控除の打ち消し",
    columnDate: "対象日",
    columnReason: "理由",
    columnDecision: "決裁",

    ownSectionTitle: "休憩自動控除の打ち消し申請",
    ownSectionTagline: "自分が申請した、休憩自動控除の打ち消し申請の一覧です。",
    queueSectionTitle: "承認待ちの打ち消し申請",
    queueSectionTagline: "承認権限のある範囲内で、承認待ちの打ち消し申請です。",
    empty: "申請はまだありません",
    queueEmpty: "承認待ちの申請はありません",

    statusLabel: {
      pending: "申請中",
      approved: "承認済",
      rejected: "却下",
      withdrawn: "取下げ",
    } satisfies Record<"pending" | "approved" | "rejected" | "withdrawn", string>,

    approve: "承認",
    reject: "却下",
    withdraw: "取下げ",
    decisionNoteLabel: "決裁メモ",
    decisionNotePlaceholder: "メモ(任意)",
    decidedBySelf: "本人",

    confirmApproveTitle: "この申請を承認しますか",
    confirmApproveMessage:
      "承認するとこの日の自動控除がなくなり、月次集計が変わります。休憩不足であれば警告が表示されます。この操作は監査ログに記録されます。",
    confirmApproveSelfNote: "自己承認として記録されます。",
    confirmRejectTitle: "この申請を却下しますか",
    confirmRejectMessage: "却下すると申請は却下済みとして記録され、自動控除はそのまま残ります。",
    confirmWithdrawTitle: "この申請を取り下げますか",
    confirmWithdrawMessage: "取り下げると申請中の状態が解除されます。必要であれば再度申請できます。",

    errors: {
      invalid_waive_date: "対象日を確認してください",
      invalid_reason: "理由を1〜500文字で入力してください",
      invalid_body: "入力内容を確認してください",
      invalid_status: "表示できない状態が指定されました",
      not_pending: "この申請は既に処理されています",
      already_approved: "この日の打ち消しは既に承認されています",
      not_found: "対象の申請が見つかりません",
      forbidden: "この操作を行う権限がありません",
      month_closed_requires_unlock: "この月は確定済みです。承認するには確定解除の権限が必要です",
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
    /** leave_* 種別からの導線(2026-08-22 追加、通知一覧画面)。 */
    openLeave: "有給休暇画面を開く",
    /** overtime_* 種別からの導線(2026-08-22 追加、通知一覧画面)。 */
    openMonthly: "月次画面を開く",
    loadFailed: "通知の取得に失敗しました。もう一度お試しください",
    /** ベルのドロップダウン末尾の導線(2026-08-22 追加)。 */
    viewAll: "すべての通知を見る →",
  },

  /** 通知一覧画面(/notifications、2026-08-22 追加)。ベルのドロップダウンとは別に過去の通知を遡れる。 */
  notificationsPage: {
    title: "通知",
    tagline: "過去の通知を確認できます。",
    filterStatusGroupLabel: "既読状態で絞り込み",
    filterStatusAll: "すべて",
    filterStatusUnread: "未読のみ",
    filterTypeGroupLabel: "種別で絞り込み",
    filterTypeAll: "すべての種別",
    filterTypeMissingClockOut: "打刻忘れ",
    filterTypeOvertime: "36協定",
    filterTypeLeave: "有給",
    markAllRead: "表示中をまとめて既読にする",
    markAllReadPending: "処理中…",
    empty: "通知はありません",
    emptyFiltered: "この条件に一致する通知はありません",
    /** APIが最大100件までしか返さないため(仕様上の制約、APIは変更しない)。 */
    truncatedNotice: "直近100件のみ表示しています。それより古い通知は表示されません。",
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
      /** 2026-08-23 追加。修正系申請(休憩自動控除の打ち消し等)の承認・却下通知。 */
      correction_alert: "申請の承認・却下(休憩自動控除の打ち消しなど)",
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
    allowances: "手当対象時間",
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
    allowancesTitle: "手当対象時間",
    allowancesDesc: "特定日・曜日・時間帯の条件に一致した実労働時間を、手当支給の対象時間として定義します。",
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
      "商業・映画演劇業・保健衛生業・接客娯楽業で常時10人未満の事業場は、週の法定労働時間が44時間になります(労基法40条)。",

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
    /**
     * 週の起算曜日(2026-08-23 追加)。週40時間判定(固定時間制の週次時間外)の週の区切り。
     * 法定休日の曜日指定(legalHolidayWeekday)とは別概念 — 混同しない。
     */
    weekStartWeekdayLabel: "週の起算曜日",
    weekStartWeekdayHint: "週40時間の判定に使う週の区切り。就業規則に定めがなければ日曜日起算が原則です(昭和63年基発第1号)。",
    legalHolidayLabel: "法定休日",
    legalHolidayWeekday: "曜日指定",
    legalHolidayDates: "暦日指定",
    breakRuleLabel: "休憩ルール",
    breakRulePunch: "打刻方式",
    /** 休憩の自動控除(2026-08-23 追加、docs/design/breaks.md「採る設計」)。 */
    breakRuleModeAuto: "自動控除",
    breakRuleModeBoth: "併用",
    breakRuleRulesTitle: "控除ルール",
    breakRuleOverSuffix: "超えたら",
    breakRuleDeductSuffix: "分を控除",
    breakRuleAddRule: "行を追加する",
    breakRuleRemoveRule: "削除",
    breakRuleRuleOverLabel: "基準の労働時間",
    breakRuleRuleDeductLabel: "控除する分数",
    breakRuleMaxRulesHint: "最大3行まで設定できます。",
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
      invalid_week_start_weekday: "週の起算曜日を確認してください",
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

  /**
   * 手当対象時間の設定(/settings/allowances、docs/design/allowances.md、2026-08-23 追加)。
   * 金額は計算しない — KIZAMI が算出するのは「この手当の対象になる勤務が何分あったか」まで。
   * settingsAttendance と同じ effective-dated の版管理 UI(SettingsAttendanceView を手本にした)だが、
   * 定義はテナントにつき何件でも並行して存在しうるため、定義ごとに現在値・版追加・履歴を持つ。
   */
  settingsAllowances: {
    title: "手当対象時間",
    tagline: "特定日・曜日・時間帯の条件に一致した実労働時間を、手当支給の対象時間として算出します。手当単価・支給額の計算は行いません。",
    noPermission: "この設定を変更する権限がありません",
    loadFailed: "設定の取得に失敗しました。もう一度お試しください",

    listTitle: "手当定義一覧",
    empty: "まだ手当定義がありません",
    currentConditionsLabel: "現在の条件",
    currentEffectiveFrom: "この版が有効になった日",
    noVersionYet: "まだ有効な版がありません(適用開始日が未来の版のみ登録されています)",

    nameLabel: "手当名",
    namePlaceholder: "例: 早朝手当",
    effectiveFromLabel: "適用開始日",
    effectiveFromHint: "この変更は指定日以降の計算にのみ影響し、過去の集計は変わりません。",

    conditionsSectionHint: "少なくとも1つの条件を指定してください。指定した条件はすべて AND(重なった場合のみ対象)です。",
    datesFieldLabel: "特定日",
    datesFieldHint:
      "特定の日付を対象にします。「毎年」を指定すると年を無視して月日だけで一致します(年末年始手当など)。日付欄に表示される年は「毎年」指定時は意味を持ちません。",
    addDateRow: "日付を追加",
    removeDateRow: "削除",
    dateYearlyCheckbox: "毎年(年を無視して月日のみ一致)",
    dateRowAriaLabel: "対象日",
    weekdaysFieldLabel: "曜日",
    weekdaysFieldHint: "指定した曜日のみを対象にします。",
    timeBandFieldLabel: "時間帯",
    timeBandEnabledCheckbox: "時間帯を指定する",
    timeBandStartLabel: "開始時刻",
    timeBandEndLabel: "終了時刻",
    timeBandHint: "終了時刻が開始時刻以前の場合、日をまたぐ時間帯として扱われます(例: 22:00〜翌5:00)。",

    createDefinitionTitle: "新しい手当定義を作成",
    createDefinitionButton: "この内容で作成",
    creating: "作成中…",
    createSuccess: "手当定義を作成しました。",

    addVersionTitle: "新しい版を追加",
    addVersionSubmit: "この内容で版を追加",
    addingVersion: "追加中…",
    submitSuccess: "新しい版を追加しました。",

    historyTitle: "版の履歴",
    historyEmpty: "まだ履歴がありません",
    historyColumnEffectiveFrom: "適用開始日",
    historyColumnName: "手当名",
    historyColumnConditions: "条件",

    /** summarizeAllowanceConditions(lib/allowances.ts)が使う要約の書式トークン。 */
    summaryYearlyPrefix: "毎年 ",
    summaryDateRangeSeparator: "〜",
    summaryListSeparator: "、",
    summaryPartsSeparator: " の ",
    summaryNextDayPrefix: "翌",

    errors: {
      invalid_body: "入力内容を確認してください",
      invalid_effective_from: "適用開始日を確認してください",
      invalid_name: "手当名を入力してください",
      invalid_conditions: "条件の入力内容を確認してください(特定日は日付を、時間帯は開始・終了に異なる時刻を指定してください)",
      conditions_required: "少なくとも1つの条件(特定日・曜日・時間帯)を指定してください",
      effective_from_in_past: "適用開始日は本日以降のみ指定できます(過去の計算結果が変わってしまうため)",
      version_already_exists: "その適用開始日にはすでに版があります。別の日付を指定してください",
      not_found: "対象の手当定義が見つかりません",
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
    columnInviteStatus: "招待状況",
    columnActions: "操作",
    noDepartment: "未所属",
    noPresets: "割当なし",

    detailToggleOpen: "詳細を開く",
    detailToggleClose: "詳細を閉じる",

    /**
     * 招待式登録(2026-08-23 追加、docs/requirements.md §7「登録は招待式のみ」)。
     * メンバー作成は同時に招待発行を兼ねる(POST /members)。
     */
    inviteButton: "メンバーを招待",
    inviteFormTitle: "メンバーを招待",
    inviteFormHint: "氏名とメールアドレスを入力すると、招待リンクが発行されます。所属部署・入社日・権限プリセットは後からでも設定できます。",
    inviteEmailLabel: "メールアドレス",
    inviteEmailPlaceholder: "例: yamada@example.com",
    inviteNameLabel: "氏名",
    inviteNamePlaceholder: "例: 山田 太郎",
    inviteDepartmentLabel: "所属部署(任意)",
    inviteHireDateLabel: "入社日(任意)",
    invitePresetsLabel: "権限プリセット(任意)",
    inviteCancel: "キャンセル",
    inviteSubmit: "招待リンクを発行",
    inviteSubmitting: "発行中…",

    inviteLinkTitle: "招待リンクを発行しました",
    inviteLinkTargetPrefix: "招待先: ",
    inviteLinkWarning: "このリンクは今だけ表示されます。閉じると再表示できません(再発行は可能です)。",
    inviteLinkLabel: "招待リンク",
    inviteLinkCopy: "リンクをコピー",
    inviteLinkCopied: "コピーしました",
    inviteLinkCopyFailed: "コピーに失敗しました。手動で選択してコピーしてください",
    inviteLinkExpiresLabel: "有効期限",
    inviteLinkDone: "閉じる",

    inviteStatusBadge: {
      invited: "招待中",
      invite_expired: "期限切れ",
    } as Record<string, string>,

    reissueButton: "再発行",
    reissueConfirmTitle: "招待を再発行しますか",
    reissueConfirmMessage: "新しい招待リンクを発行します。以前のリンクは使えなくなります。",

    revokeInviteButton: "取り消し",
    revokeInviteConfirmTitle: "招待を取り消しますか",
    revokeInviteConfirmMessage: "この招待リンクは使えなくなります。必要であれば後から再発行できます。",

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
      invalid_email: "メールアドレスの形式を確認してください",
      invalid_name: "氏名を1〜200文字で入力してください",
      invalid_department_id: "指定した部署が見つかりません",
      invalid_hire_date: "入社日はYYYY-MM-DD形式で入力してください",
      email_already_exists: "このメールアドレスは既に登録されています",
      not_found: "対象のメンバーが見つかりません",
      invalid_preset_id: "指定した権限プリセットが見つかりません",
      self_escalation: "自分自身に新しい権限を付けることはできません",
      self_demotion: "自分から権限管理の権限を外すことはできません",
      last_admin: "権限管理ができる最後のメンバーからこの権限を外すことはできません",
      /** 招待の再発行・取り消し(2026-08-23 追加)。 */
      already_active: "このメンバーは既に本登録済みです(招待の再発行は不要です)",
      already_accepted: "この招待は既に受諾されています",
      already_revoked: "この招待は既に取り消し済みです",
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
    /** 「複製して編集」時の初期名(元の名前の後ろに付ける)。 */
    duplicateNameSuffix: (name: string) => `${name}のコピー`,
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

    /** 承認待ちキュー(2026-08-23 追加、CorrectionsView・autoBreakWaiver と同じ own/queue 二段構成)。 */
    queueSectionTitle: "承認待ちの休暇申請",
    queueSectionTagline: "承認権限のある範囲内で、承認待ちの休暇申請です。",
    queueEmpty: "承認待ちの申請はありません",

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

    /** 時間単位の申請一覧で unitLabelShort.hourly の後に添える「(120分)」のような補足。 */
    hourlyMinutesSuffix: (minutes: number) => `(${minutes}分)`,

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
};
