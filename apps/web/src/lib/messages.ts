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
    settings: "設定",
    logout: "ログアウト",
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
    title: "通知設定",
    tagline: "テナント全体の通知チャネル(Webhook・メール)を設定します。",
    noPermission: "この設定を変更する権限がありません",

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

  /** 設定サブナビ(/settings/* 間の行き来。アクセス可能な項目のみ表示)。 */
  settingsNav: {
    label: "設定メニュー",
    /** 自己批評での改善: 単なる「設定」だと他のタブと同格の項目に見えてしまうため、
     * 「一覧に戻る」操作だと分かる文言にする(非エンジニアが迷わないための平易さの要件)。 */
    hubLink: "設定メニュー一覧",
    notifications: "通知",
    departments: "部署",
    members: "メンバー",
    presets: "権限プリセット",
  },

  settingsHub: {
    title: "設定",
    tagline: "テナントの設定・組織・権限を管理します。アクセスできる項目のみ表示されます。",
    empty: "利用できる設定項目がありません。管理者にお問い合わせください。",
    notificationsTitle: "通知",
    notificationsDesc: "Webhook・メール(SMTP)の通知チャネルを設定します。",
    departmentsTitle: "部署",
    departmentsDesc: "部署ツリーの作成・名称変更・異動・削除を行います。",
    membersTitle: "メンバー",
    membersDesc: "メンバーの所属変更、権限プリセットの割当、実効権限の確認を行います。",
    presetsTitle: "権限プリセット",
    presetsDesc: "権限のON/OFFとスコープを組み合わせたプリセットを作成・編集します。",
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
    columnActions: "操作",
    noDepartment: "未所属",
    noPresets: "割当なし",

    detailToggleOpen: "詳細を開く",
    detailToggleClose: "詳細を閉じる",

    departmentChangeLabel: "所属部署を変更",
    departmentChangeSaved: "所属部署を変更しました",

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
