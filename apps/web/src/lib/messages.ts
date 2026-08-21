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
    logout: "ログアウト",
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
} as const;
