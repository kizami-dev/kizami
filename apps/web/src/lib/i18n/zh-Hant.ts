/**
 * 表示文言(繁體中文・臺灣)。lib/i18n/ja.ts の構造をそのまま繁體字の中國語(臺灣の用語)に訳したもの。
 * 型は ja から導出される Messages を `satisfies` で満たし、キーの過不足をコンパイルエラーにする。
 */
import type { Messages } from "./index";

export const zhHant = {
  appName: "KIZAMI",
  tagline: "以分鐘為單位精準記錄的考勤管理系統。",

  nav: {
    dashboard: "首頁",
    punch: "打卡",
    monthly: "月度",
    corrections: "申請",
    leave: "年假",
    /** 排班(/shifts, /shifts/me)。擁有 shift.manage 權限的使用者前往 /shifts,其他使用者前往 /shifts/me。 */
    shifts: "排班",
    settings: "設定",
    logout: "登出",
  },

  /** 行動版底部分頁列與「更多」面板。 */
  mobileNav: {
    more: "更多",
    moreAriaLabel: "開啟更多選單",
    sheetTitle: "選單",
    close: "關閉",
    openNotifications: "檢視通知",
    /** 通知一覽頁面(/notifications)的入口,與 openNotifications(開啟鈴鐺)不同。 */
    allNotifications: "檢視全部通知",
    stampScreenLink: "開啟帶打卡動畫的打卡頁面 →",
  },

  /** 全域公共頁頭的租用戶名稱顯示。僅有 Logo 時無法看出「屬於哪家公司的執行個體」。 */
  header: {
    tenantAriaLabel: "所屬組織",
  },

  /** 首頁(儀表板)。 */
  dashboard: {
    title: "首頁",
    punchSectionTitle: "打卡",
    todayTitle: "今日與本月",
    todayWorkedLabel: "今日實際工作時長",
    monthFlexLabel: "本月彈性工作時間收支",
    monthFlexMoreLink: "檢視月度 →",
    todayWorkedProvisional: "工作中(未確定)",
    todayWorkedProvisionalNote: "自上班起的經過時間減去休息的估算值,下班後確定。",

    /** 今天、明天的排班。若完全沒有排班,則不顯示該卡片。 */
    shiftCardTitle: "今天・明天的排班",
    shiftCardTodayLabel: "今天",
    shiftCardTomorrowLabel: "明天",

    todoTitle: "待處理",
    todoEmpty: "沒有需要處理的事項。",
    todoLoadFailed: "部分資訊取得失敗。",

    todoNotificationsTitle: "未讀通知",
    todoNotificationsCountSuffix: "條",
    todoNotificationsMore: "還有其他未讀通知",

    todoApprovalsTitle: "待簽核的申請",
    todoApprovalsCorrections: "打卡修正申請",
    todoApprovalsLeave: "休假申請",
    /** 年假授予預告(v0.7 第4階段,2026-08-24 新增)。僅對擁有 leave.grant.manage 權限的使用者顯示。 */
    todoApprovalsProposals: "年假授予預告",
    todoApprovalsCountSuffix: "條",
    todoApprovalsGoCorrections: "檢視修正申請 →",
    todoApprovalsGoLeave: "檢視帶薪年假 →",
    todoApprovalsGoProposals: "檢視授予預告 →",

    todoWarningsTitle: "有警告的打卡日期",
    todoWarningsMore: (n: number) => `還有${n}天`,
    todoWarningsFix: "去修正",

    todoDeadlinesTitle: "臨近期限的義務事項",
    todoDeadlinesMandatoryPrefix: "距離年5天帶薪年假強制使用義務還差",
    todoDeadlinesMandatorySuffix: "天不足(期限: ",
    todoDeadlinesMandatorySuffix2: ")",
    todoDeadlinesExpiring: "有即將失效的帶薪年假",
    todoDeadlinesGoLeave: "檢視帶薪年假 →",
    todoDeadlinesMandatoryExpired: (n: number) => `年5天強制使用義務未達標(已逾期)${n} 項`,

    quickLinksTitle: "常用頁面",
    quickLinkMonthlyTitle: "月度",
    quickLinkMonthlyDesc: "檢視實際工作時長、彈性工作時間收支以及有警告的日期。",
    quickLinkCorrectionsTitle: "申請",
    quickLinkCorrectionsDesc: "申請新增、更正或撤銷打卡紀錄。",
    quickLinkLeaveTitle: "帶薪年假",
    quickLinkLeaveDesc: "檢視餘額、申請休假。",
  },

  /**
   * 儀表板的「使用指南」區塊。只靜靜列出未完成的項目(不使用強制回應對話方塊強制操作)。
   */
  onboarding: {
    title: "使用指南",
    dismiss: "不再顯示",

    punchTitle: "先試著打一次卡吧",
    punchReason: "打卡後,系統會從當天起開始統計實際工作時長。",
    punchAction: "開啟打卡頁面 →",

    notifPrefsTitle: "可以設定通知的接收方式",
    notifPrefsReason: "預設僅接收應用程式內通知,也可以透過電子郵件或 Webhook 接收。",
    notifPrefsAction: "開啟通知設定 →",

    attendanceTitle: "考勤設定目前仍為初始值",
    attendanceReason: "請根據實際情況檢查日界、法定休息日、GPS、彈性工作時間等設定。",
    attendanceAction: "開啟考勤設定 →",

    channelsTitle: "尚未設定通知管道",
    channelsReason: "設定電子郵件或 Webhook 後,可以向員工推送忘記打卡等提醒。",
    channelsAction: "開啟通知設定(公司全域) →",

    soloTitle: "目前只有你一名成員",
    soloReason: "邀請成員後,即可管理其他員工的打卡與申請。",
    soloAction: "邀請成員 →",

    hireDateTitle: (count: number) => `有 ${count} 名成員尚未設定入職日期`,
    hireDateReason: "未設定入職日期將無法自動計算帶薪年假的法定授予天數。",
    hireDateAction: "開啟成員設定 →",
  },

  /** 使用嚮導(components/Tour.tsx,2026-08-27 新增)。steps 的鍵與 lib/tour.ts 的 TourStepId 一一對應。 */
  tour: {
    ariaLabel: "使用嚮導",
    progress: (current: number, total: number) => `${current} / ${total}`,
    next: "下一步",
    prev: "上一步",
    finish: "結束",
    skip: "跳過",
    restartTitle: "檢視使用嚮導",
    restartDesc: "跟隨實際畫面,瞭解從打卡到送出申請的流程。",
    steps: {
      dashboard: {
        title: "這裡是入口",
        body: "未讀通知、待簽核的申請、臨近期限的事項都會集中在這一欄。這裡為空,就說明今天沒有待辦。",
      },
      punch: {
        title: "打卡",
        body: "用這些按鈕記錄上班、休息與下班。可按的按鈕取決於目前狀態。",
      },
      monthly: {
        title: "檢視本月紀錄",
        body: "按區分統計的合計時長。每日明細排在下方表格中,打卡缺失的日期會帶有警告。",
      },
      corrections: {
        title: "修正打卡",
        body: "漏打或打錯都從這裡送出申請。在月度表格中選擇日期也可以送出同樣的申請。",
      },
      leave: {
        title: "申請休假",
        body: "一邊檢視剩餘年假,一邊選擇日期與型別。能否按半天或按小時休取決於公司設定。",
      },
      notifPrefs: {
        title: "接收通知的方式",
        body: "漏打卡提醒與簽核結果也可以透過電子郵件或瀏覽器通知送達,可按類別分別選擇。",
      },
      settingsHub: {
        title: "公司設定",
        body: "考勤規則、成員、通知傳送管道都從這裡開啟。顯示哪些項目取決於你擁有的權限。",
      },
      members: {
        title: "邀請成員",
        body: "傳送邀請連結後,對方只需設定密碼即可開始使用。填寫入職日期後即可計算帶薪年假的授予天數。",
      },
      attendance: {
        title: "考勤規則",
        body: "設定日界、法定休息日與彈性工作制的結算期間。變更會記錄為版本,過去的統計不會改變。",
      },
      closing: {
        title: "月度結算",
        body: "結算後即可確定該月統計並交給薪資系統。結算後若有修正,該月會保留「已修正」標記。",
      },
    },
  },

  /** 主題切換(「語言與顯示」設定 /settings/display 內。2026-08-22 為支援深色模式而新增,2026-10-05 從頁首使用者選單移至此處)。 */
  theme: {
    label: "主題",
    system: "跟隨系統設定",
    light: "淺色",
    dark: "深色",
  },

  /**
   * 語言切換(「語言與顯示」設定內。2026-08-23 為支援4種語言而新增,2026-10-05 從頁首使用者選單移至此處)。
   * 選項本身的名稱(日本語 / English / 한국어 / 簡體中文 / 繁體中文)是各語言的自稱,
   * 因此不隨語言變化 — 不在 messages 中維護,而由 lib/i18n/index.ts 的 LOCALE_NATIVE_NAMES 提供。
   */
  language: {
    label: "語言",
  },

  /** 通用的細碎片段(分隔符等,多個頁面共用)。 */
  common: {
    /** 用於鬆散分隔兩段簡短補充說明的符號(例如「已設定(…)」「不更改時請留空」)。 */
    hintSeparator: " · ",
    initialVersion: "初始設定",
    showPassword: "顯示",
    hidePassword: "隱藏",
  },

  /**
   * HelpTip(附帶法規/KIZAMI規格/公司規定標籤的說明提示)相關的介面文案。
   * 說明正文本身(@kizami/help-content)目前僅提供日語版本,不在本次翻譯範圍內。
   */
  helpTip: {
    originLaw: "法規",
    originProduct: "KIZAMI 規格",
    originCompany: "公司規定",
    ariaLabelPrefix: "說明",
    detailLink: "檢視詳情 →",
    workRulesLink: "檢視工作規則 →",
  },

  /**
   * 日期時間顯示的通用格式(由 lib/time.ts 引用)。時區固定為 JST 不變,
   * 僅按語言切換星期、月日的「呈現方式」。
   */
  time: {
    /** 對應 getUTCDay()(0=週日)順序的星期縮寫。 */
    weekdayShort: ["日", "一", "二", "三", "四", "五", "六"] as readonly [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ],
    /** "YYYY年M月"(月度頁面標題等)。 */
    monthLabel: (year: number, month: number) => `${year}年${month}月`,
    /** "M/D(週X)"。 */
    dateLabel: (month: number, day: number, weekday: string) => `${month}/${day}(週${weekday})`,
    /** formatDaysHoursMinutes(帶薪年假餘額顯示)的單位與分隔符。 */
    unitDay: "天",
    unitHour: "小時",
    unitMinute: "分鐘",
    durationJoin: "",
  },

  /** 打卡頁面的大時鐘(PunchHome)。 */
  punchClock: {
    currentTimeAriaLabel: (hm: string, ss: string) => `目前時間 ${hm}:${ss}`,
  },

  /** 權限適用範圍。由窄到寬: self < department < department_and_descendants < tenant。 */
  scopeLabel: {
    self: "僅本人",
    department: "本部門",
    department_and_descendants: "本部門+下屬部門",
    tenant: "整個租用戶",
  } satisfies Record<"self" | "department" | "department_and_descendants" | "tenant", string>,

  permissions: {
    categoryLabel: {
      attendance: "打卡、申請與簽核",
      leave: "休假",
      closing: "結算與匯出",
      org: "成員與組織",
      settings: "設定與權限",
      other: "其他",
    } as Record<string, string>,
    internalViewLabel: {
      "department.view": "檢視部門樹",
      "tenant_settings.view": "檢視租用戶設定",
      "permission_preset.view": "檢視權限預設清單",
      "permission_assignment.effective_view": "檢視成員的實際權限(可執行的操作)",
      "api_key.view": "檢視API金鑰清單",
    } as Record<string, string>,
  },

  login: {
    title: "KIZAMI",
    tagline: "以分鐘為單位精準記錄的考勤管理",
    emailLabel: "電子郵件地址",
    passwordLabel: "密碼",
    submit: "登入",
    submitting: "登入中…",
    /** 自助註冊(僅當 SIGNUP_MODE 不是 off 時顯示,2026-10-03)。 */
    signupPrompt: "初次使用?",
    signupLink: "註冊新帳號",
    forgotPasswordLink: "忘記密碼?",
    errors: {
      invalid_credentials: "電子郵件地址或密碼錯誤",
      rate_limited: "嘗試次數過多,請稍後再試",
    /** SSO(OIDC)登入失敗原因(2026-08-24 新增)。這些程式碼與 apps/api/src/lib/oidc.ts 的
     * OidcErrorCode 一一對應(回撥會 302 重定向到 /login?error=<code>)。 */
      sso_not_enabled: "本公司未啟用 SSO 登入",
      sso_config_incomplete: "SSO 尚未設定完成,請聯絡管理員",
      sso_discovery_failed: "無法連線到身分提供者(IdP),請聯絡管理員",
      sso_token_failed: "SSO 認證失敗,請重試",
      sso_invalid_token: "無法驗證 SSO 憑證,請重試",
      sso_state_mismatch: "SSO 登入流程已中斷,請重試",
      sso_email_missing: "未能從 IdP 取得電子郵件地址,請聯絡管理員",
      sso_email_unverified: "IdP 未將該電子郵件地址標記為已驗證,請聯絡管理員",
      sso_user_not_found: "找不到使用該電子郵件地址的使用者,請向管理員申請邀請",
      sso_failed: "SSO 登入失敗,請重試",
      encryption_unavailable: "目前無法使用 SSO 登入,請聯絡管理員",
      default: "登入失敗,請稍後重試",
    },

    /** 同一電子郵件+密碼符合多個租用戶時的租用戶選擇。類似 Slack 的工作區選擇,不再要求重新輸入密碼
     * (沿用剛才的驗證結果,僅向所選租用戶重新發送即可)。 */
    tenantSelectTitle: "請選擇要登入的公司",
    tenantSelectDescription: "該電子郵件地址在多家公司擁有帳號。",
    tenantUnnamed: "(未命名)",
    backToEmail: "使用其他帳號登入",

    /** SSO(OIDC)登入(2026-08-24 新增)。輸入電子郵件地址後,透過 GET /auth/oidc/available
     * 查詢該使用者所屬公司中已啟用 SSO 的公司,若有符合則顯示按鈕。密碼登入仍然可用。 */
    ssoDivider: "或",
    ssoButton: "使用 SSO 登入",
    ssoButtonForTenant: (tenantName: string) => `使用 SSO 登入 ${tenantName}`,
    ssoStarting: "正在前往 SSO…",

    totpTitle: "請輸入驗證碼",
    totpDescription: "請輸入驗證器應用程式中顯示的6位驗證碼。",
    totpCodeLabel: "6位驗證碼",
    totpSubmit: "驗證",
    totpSubmitting: "正在驗證…",
    totpUseRecovery: "使用復原碼",
    totpUseCode: "使用驗證器應用程式的驗證碼",
    totpRecoveryLabel: "復原碼",
    totpRecoveryDescription: "如果無法使用驗證器應用程式,請輸入開啟兩步驟驗證時儲存的其中一個復原碼(每個只能使用一次)。",
    totpBack: "從登入重新開始",
    totpExpiredNotice: "驗證已逾時,請重新登入",
    totpErrors: {
      invalid_body: "請檢查驗證碼的格式",
      invalid_code: "驗證碼不正確,請重試",
      totp_expired: "驗證已逾時,請重新登入",
      rate_limited: "嘗試次數過多,請稍後再試",
      encryption_unavailable: "目前無法執行此操作,請聯絡管理員",
      default: "驗證失敗,請重試",
    },
  },

  /**
   * 接受邀請頁面(/invite/[token],無需登入、公開存取)。
   * 註冊僅限邀請制。與登入頁保持相同的「紙白+居中卡片」樣式。
   * 這是員工首次接觸 KIZAMI 的頁面,文案需格外親切(不嚇人、不迷惑)。
   */
  inviteAccept: {
    invitedBySuffix: " 邀請你加入",
    invitedByUnnamed: "該公司",
    nameLabel: "姓名",
    emailLabel: "電子郵件地址",
    passwordLabel: "密碼(至少12位)",
    passwordConfirmLabel: "確認密碼",
    passwordMismatch: "兩次輸入的密碼不一致",
    passwordTooShort: "密碼至少需要12位",
    submit: "註冊並開始使用",
    submitting: "註冊中…",
    loading: "正在確認邀請資訊…",

    invalidTitle: "此邀請連結無效",
    invalidMessage: "此邀請連結無效,請聯絡管理員確認。",
    expiredTitle: "此邀請已過期",
    expiredMessage: "此邀請已過期,請聯絡管理員重新發放。",
    acceptedRedirecting: "註冊完成,正在前往…",

    sessionIssuanceFailedTitle: "帳戶已建立",
    sessionIssuanceFailedMessage: "帳戶已建立。請前往登入頁面登入。",
    goToLogin: "前往登入頁面",

    errors: {
      invalid_password: "密碼至少需要12位",
      rate_limited: "嘗試次數過多,請稍後再試",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 自助註冊頁面(/signup,無需認證·公開,KIZAMI Cloud,2026-10-03)。
   * 與登入、邀請接受相同的"紙白色+居中卡片"。SIGNUP_MODE 為 off 的部署中,
   * GET /signup/config 返回 mode: "off",此頁面只顯示提示(不顯示錶單)。
   * 註冊後,點擊確認電子郵件中的連結(/signup/verify/[token])即可建立租用戶。
   */
  signup: {
    title: "註冊新帳號",
    tagline: "建立組織,開始以分鐘為單位的考勤管理",
    loading: "載入中…",
    closedTitle: "暫不接受新註冊",
    closedMessage: "本服務目前不接受新的註冊。",
    organizationNameLabel: "組織名稱(公司名稱)",
    adminNameLabel: "您的姓名",
    emailLabel: "電子郵件地址",
    inviteCodeLabel: "邀請碼",
    inviteCodeHint: "請輸入營運方告知您的邀請碼",
    turnstileRequired: "請完成「我不是機器人」驗證",
    submit: "傳送確認電子郵件",
    submitting: "傳送中…",
    sentTitle: "已傳送確認電子郵件",
    sentMessage: (email: string) =>
      `已向 ${email} 傳送確認電子郵件。開啟電子郵件中的連結即可完成註冊(24小時內有效)。如未收到,請檢查垃圾郵件資料夾。`,
    backToLogin: "返回登入頁面",
    haveAccount: "已有帳號?",
    errors: {
      invalid_email: "電子郵件地址格式不正確",
      invalid_organization_name: "請輸入組織名稱",
      invalid_name: "請輸入姓名",
      invalid_invite_code: "邀請碼無效,請檢查",
      turnstile_failed: "驗證失敗,請重試",
      turnstile_unavailable: "無法連線驗證服務,請稍後重試",
      rate_limited: "嘗試次數過多,請稍候再試",
      default: "註冊失敗,請重試",
    },
  },

  /**
   * 註冊電子郵件確認頁面(/signup/verify/[token],無需認證·公開,2026-10-03)。
   * 與 inviteAccept 相同的狀態機。點擊確認按鈕後即建立租用戶,
   * 並以已登入狀態跳轉到首頁。
   */
  signupVerify: {
    loading: "正在確認註冊內容…",
    intro: "將按以下內容建立組織。請設定密碼。",
    passwordLabel: "密碼(12位以上)",
    passwordConfirmLabel: "密碼(確認)",
    passwordMismatch: "兩次輸入的密碼不一致",
    passwordTooShort: "密碼請輸入12位以上",
    organizationLabel: "組織名稱",
    nameLabel: "姓名",
    emailLabel: "電子郵件地址",
    submit: "確認並開始",
    submitting: "建立中…",
    created: "組織已建立。正在前往…",
    invalidTitle: "此確認連結無效",
    invalidMessage: "此確認連結無效或已被使用。如已註冊,請從登入頁面登入。",
    expiredTitle: "此確認連結已過期",
    expiredMessage: "確認連結(24小時有效)已過期。請重新註冊。",
    sessionIssuanceFailedTitle: "組織已建立",
    sessionIssuanceFailedMessage: "組織已建立。請從登入頁面登入。",
    goToLogin: "前往登入頁面",
    goToSignup: "前往註冊",
    errors: {
      invalid_password: "密碼請輸入12位以上",
      invite_code_unavailable: "邀請碼已無法使用,請聯絡營運方",
      rate_limited: "嘗試次數過多,請稍候再試",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 密碼重設接受頁面(/reset/[token],2026-08-23 Tier 0 第4部分新增,無需認證·公開)。
   * 參照 inviteAccept 的結構(構成、狀態機、文案基調都沿用)。使用管理員發放的重設連結
   * 設定新密碼後會直接進入登入狀態(routes/password-resets.ts)。
   */
  /**
   * 「パスワードを忘れた」畫面(/forgot-password、認証ガード無し・公開、2026-10-04)。
   * システムメールがある配備でだけ有効(GET /password-resets/config の selfService)。
   */
  forgotPassword: {
    loading: "正在確認…",
    closedTitle: "目前環境不可用",
    closedMessage: "目前環境不支援透過電子郵件重設密碼。請聯絡管理員重設密碼。",
    tagline: "請輸入註冊時使用的電子郵件地址。如果有符合的帳號,我們會透過電子郵件傳送密碼重設連結。",
    emailLabel: "電子郵件地址",
    submit: "傳送重設電子郵件",
    submitting: "正在傳送…",
    turnstileRequired: "請完成人機驗證",
    sentTitle: "電子郵件已傳送",
    sentMessage: "如果有符合的帳號,我們已傳送密碼重設電子郵件。請在1小時內透過電子郵件中的連結設定新密碼。若未收到,請檢查垃圾郵件資料夾,等待約5分鐘後重試。",
    backToLogin: "返回登入",
    errors: {
      invalid_email: "電子郵件地址格式不正確",
      turnstile_failed: "驗證失敗,請重試",
      turnstile_unavailable: "無法連線驗證服務,請稍後再試",
      rate_limited: "嘗試次數過多,請稍後再試",
      default: "傳送失敗,請重試",
    },
  },

  passwordResetAccept: {
    tenantUnnamed: "該公司",
    introSuffix: " 正在重設帳戶密碼",
    nameLabel: "姓名",
    emailLabel: "電子郵件地址",
    newPasswordLabel: "新密碼(至少12位)",
    newPasswordConfirmLabel: "確認新密碼",
    passwordMismatch: "兩次輸入的密碼不一致",
    passwordTooShort: "密碼至少需要12位",
    submit: "重設密碼",
    submitting: "重設中…",
    loading: "正在確認重設連結…",

    invalidTitle: "此重設連結無效",
    invalidMessage: "此重設連結無效,請聯絡管理員確認。",
    expiredTitle: "此重設連結已過期",
    expiredMessage: "此重設連結已過期。請從登入頁面的「忘記密碼?」重新操作,或請管理員重新發放。",
    acceptedRedirecting: "密碼已重設,正在前往…",

    sessionIssuanceFailedTitle: "密碼已更新",
    sessionIssuanceFailedMessage: "密碼已更新完成。抱歉給您帶來不便,請前往登入頁面重新登入。",
    goToLogin: "前往登入頁面",
    /** 2FA 利用者には使用直後のセッションを発行しない(`status: "login_required"`、routes/password-resets.ts)。 */
    loginRequiredTitle: "密碼已重設",
    loginRequiredMessage: "由於已啟用雙重驗證,不會自動登入。請使用新密碼登入,並輸入驗證器應用程式中的驗證碼。",

    errors: {
      invalid_password: "密碼至少需要12位",
      rate_limited: "嘗試次數過多,請稍後再試",
      default: "處理失敗,請重試",
    },
  },

  attendanceState: {
    out: "未上班",
    working: "工作中",
    onBreak: "休息中",
  } satisfies Record<"out" | "working" | "onBreak", string>,

  punchButtons: {
    clockIn: "上班打卡",
    breakStart: "開始休息",
    breakEnd: "結束休息",
    clockOut: "下班打卡",
  },

  punchHints: {
    clockInDisabled: "僅可在未上班狀態下操作",
    breakDisabled: "僅可在工作中狀態下操作",
    clockOutDisabled: "僅可在工作中狀態下操作",
  },

  punchKindLabel: {
    clock_in: "上班打卡",
    break_start: "開始休息",
    break_end: "結束休息",
    clock_out: "下班打卡",
  } satisfies Record<"clock_in" | "break_start" | "break_end" | "clock_out", string>,

  today: {
    title: "今日打卡紀錄",
    empty: "暫無打卡紀錄",
    nowLabel: "現在",
  },

  /**
   * 附帶GPS的打卡(v0.4)。為滿足「啟用時需向員工明確告知正在採集」的要求,
   * 在啟用GPS的租用戶中,打卡按鈕附近會始終顯示 noticeAlways(不藏在開關或提示氣泡背後)。
   */
  punchGps: {
    noticeAlways: "此次打卡將記錄位置資訊",
    detailToggle: "詳情",
    reason: "為便於確認外勤等情況下的打卡地點,公司已在設定中啟用了GPS紀錄功能。",
    retentionPrefix: "保留期限: ",
    retentionSameAsAttendance: "與考勤資料相同",
    retentionDaysSuffix: "天",
    locating: "正在取得位置資訊…",
    unavailableNote: "未能取得位置資訊,已在不含位置資訊的情況下紀錄",
  },

  /**
   * 離線狀態下的打卡(v0.4)。按要求,v0.4 暫不實現離線打卡排隊功能
   * (會導致實際打卡時間與紀錄時間不一致)。頁面(應用外殼)可透過 Service Worker 快取開啟,
   * 但打卡本身仍需連線網路,以確保紀錄準確的時間。
   */
  offline: {
    banner: "目前處於離線狀態。頁面可以正常顯示,但為確保紀錄準確時間,打卡需要連線網路。",
    punchDisabledHint: "離線狀態下無法打卡",
  },

  errors: {
    punchFailed: "打卡失敗,請重試",
    loadFailed: "資料取得失敗,請重試",
    network: "無法連線到伺服器",
  },

  loading: "載入中…",

  monthly: {
    title: "月度",
    prevMonth: "上月",
    nextMonth: "下月",
    columnDate: "日期",
    /** 打卡時間(上班→下班)列。 */
    /** 僅憑星期無法判斷的休假日標記(日本國定假日、在休假日行事曆中追加的休假日) */
    holidayMark: { national: "國定假日", company: "公司休假" },
    columnStretches: "工作時段",
    /**
     * 在較寬的視口下,將「工作時段」1列拆分為上班、下班2列。
     * 含義與 columnStretches 單元格表示(formatStretchRange 等)相同,僅顯示形式不同。
     */
    columnClockIn: "上班",
    columnClockOut: "下班",
    columnWorked: "實際工作",
    /** 休息不足警告文案中附加的差額說明(應休·實際)。 */
    breakShortfallSuffix: (required: string, actual: string) => `(應休 ${required}·實際 ${actual})`,
    columnBreak: "休息",
    /** 休息自動扣除的並列標籤。 */
    autoBreakLabel: "自動",
    columnLateNight: "深夜",
    /** 僅固定工作時間制下顯示的加班列。 */
    columnOvertime: "加班",
    columnWarning: "警告",
    columnActions: "操作",
    correctionAction: "修正",
    empty: "本月沒有打卡資料",

    /** 尚未下班的工作時段(clockOutAt: null)。 */
    stretchOpenEnded: "—",
    /** 下班時間跨到次日曆日時的字首。 */
    stretchNextDayPrefix: "次日",
    /**
     * 跨日工作在「接收方」日期的工作列開頭顯示的字首。
     * 與「次日」標記(區間開始日一側)對稱: 若從前一天開始則用 stretchPrevDayLabel,
     * 若從2天以上之前開始則用 stretchFromDateLabel(M/D)。
     */
    stretchPrevDayLabel: "(從前一天開始)",
    stretchFromDateLabel: (monthDay: string) => `(從 ${monthDay} 開始)`,
    /** 法定內加班(extraWithinStatutoryMinutes)的並列標籤。 */
    overtimeExtraLabel: "法定內",

    /** 明確標註目前顯示的工作時間制度。 */
    workSystemLabel: "目前顯示的工作時間制度",
    workSystemValue: {
      flex: "彈性工作時間制",
      fixed: "固定工作時間制",
      monthly_variable: "1個月單位變形工作時間制",
    } satisfies Record<"flex" | "fixed" | "monthly_variable", string>,

    flexBalanceLabel: "彈性工作時間收支",
    flexBalanceUnit: "分鐘",
    flexShortLabel: "不足",
    /** 彈性工作時間的約定總額度(2026-10-05)。僅在總工作時間依「所定天數 × 標準時間」決定的制度中顯示。 */
    flexContractBreakdownLabel: "彈性工作時間明細",
    flexContractBasisNote: "差額依約定總額度(所定工作日數 × 標準工作時間)比較。",
    flexContractFrameLabel: "約定總額度",
    flexCarryInLabel: "上月結轉",
    flexStatutoryFrameLabel: "法定總額度",
    flexWithinStatutoryExcessLabel: "法定內超出",
    flexOvertimeLabel: "法定外",
    flexCarryOutLabel: "結轉至下月",
    flexConfirmedShortfallLabel: "確定的不足",
    /** 固定工作時間制下替代「彈性工作時間收支條」的展示。相對於36協定月度45小時上限的加班位置。 */
    overtimeBarLabel: "加班(相對於36協定月度45小時上限)",
    overtimeBarUnit: "分鐘",
    /** 距上限還剩多少(未超過時)。 */
    overtimeBarRemainingLabel: "剩餘",
    /** 超過上限時(不僅靠封頂展示,也用文字明確提示)。 */
    overtimeBarOverLabel: "已超過上限",

    /**
     * monthly_variable 下替代「彈性工作時間收支條」的展示。相對於統計期間法定總額度
     * (figures.variablePeriod.statutoryFrameMinutes)的實際工作位置。
     */
    variablePeriodBarLabel: "相對於期間法定總額度的實際工作時間",
    variablePeriodBarUnit: "分鐘",
    variablePeriodBarRemainingLabel: "剩餘",
    variablePeriodBarOverLabel: "已超過總額度",
    variablePeriodScheduledLabel: "應工作時間合計",
    variablePeriodRangeLabel: (start: string, end: string) => `變形期間 ${start} 〜 ${end}`,
    /** attributedToThisMonth 為 false 時(決定事項3: 期間層面的加班尚未計入本月)。 */
    variablePeriodNotAttributedNote: "期間層面的加班將在期間結束所在月的結算中一併計入,本月尚未計入",
    /** 已結算的月份(figures.source === "snapshot")variablePeriod 本身會返回 null。 */
    variablePeriodUnavailableNote: "本月已結算,因此不顯示變形期間明細(加班已包含在分類合計中)",

    /** monthly_variable 的每日「應工作時間」列(DailyBreakdown.scheduledMinutes)。 */
    columnScheduled: "應工作時間",

    /** 排班預實偏差警告附加的分鐘數(與 insufficient_break 的 breakShortfallSuffix 同類型)。 */
    shiftDeltaSuffix: (delta: string) => `(偏差 ${delta})`,
    shiftActualOnlySuffix: (actual: string) => `(實際工作 ${actual})`,
    /** 核心時間偏差(勞基法32條之3,2026-08-24 新增)。並列顯示核心時間內缺勤的分鐘數。 */
    coreTimeDeltaSuffix: (delta: string) => `(核心時間缺勤 ${delta})`,

    totalsLabel: "分類合計",
    /** 津貼對象時間月合計的標題(docs/design/allowances.md「UI」小節,2026-08-23 新增)。 */
    allowanceTotalsLabel: "津貼對象時間",
    /** 結算後修改的差異表中,加在津貼行名稱前以便識別。 */
    allowanceDiffPrefix: "津貼: ",

    fixedBreakdownLabel: "所定內・法定內加班(月合計)",
    fixedBreakdownWithinScheduledLabel: "所定內工作時間",
    fixedBreakdownExtraLabel: "法定內加班",

    memberSwitcherLabel: "檢視對象",
    memberSwitcherSelfOption: (name: string) => `${name}(本人)`,
    memberSwitcherOthersGroup: "成員",
    memberSwitcherNoDepartment: "無部門",
    memberSwitcherUnknownDepartment: "未知部門",
    viewingOthersLabel: (name: string) => `${name}的月度考勤(僅檢視)`,
  },

  totalsCategoryLabel: {
    statutory: "法定內",
    overtime: "加班",
    overtime60h: "加班(超過60小時)",
    lateNight: "深夜",
    statutoryHoliday: "法定休息日",
  } satisfies Record<"statutory" | "overtime" | "overtime60h" | "lateNight" | "statutoryHoliday", string>,

  /** 排班日型別標籤(shift_patterns.dayType・shift_days.dayType 通用)。 */
  shiftDayTypeLabel: {
    work: "工作",
    legal_holiday: "法定休息日",
    non_working: "非工作",
  } satisfies Record<"work" | "legal_holiday" | "non_working", string>,

  warningLabel: {
    missing_clock_out: "缺少下班打卡,該工作時段已從統計中排除",
    duplicate_clock_in: "已作廢工作中重複出現的上班打卡",
    clock_out_without_in: "已作廢未上班狀態下的下班打卡",
    break_outside_work: "已作廢非工作時間內的休息打卡",
    duplicate_break_start: "已作廢休息中重複出現的開始休息打卡",
    unmatched_break_end: "已作廢沒有對應開始休息紀錄的結束休息打卡",
    clock_out_during_break: "休息期間存在下班打卡,已按結束休息後下班處理",
    mixed_work_system:
      "本統計期間內工作時間制度發生了變更。系統按期間開始日當時的制度統計整月資料。如需分段檢視統計結果,請聯絡管理員",
    insufficient_break: "本次工作的休息時間未達到法律要求的時長,請確認是否存在漏打卡的情況",
    /** 排班預實偏差(docs/design/shift-work.md「預實對照」)。偏差分鐘數透過 monthly.shiftDeltaSuffix 等並列顯示。 */
    missing_shift: "在未登記排班的日期存在實際工作時間,請確認排班表",
    shift_late_arrival: "上班時間晚於排班的開始時間",
    shift_early_leave: "下班時間早於排班的結束時間",
    shift_unplanned_work: "在排班中定為休息的日期存在實際工作時間",
    shift_absence: "在排班中定為工作的日期沒有實際工作時間",
    /** 核心時間偏差(勞基法32條之3,2026-08-24 新增)。缺勤分鐘數透過 monthly.coreTimeDeltaSuffix 並列顯示。 */
    core_time_late_arrival: "核心時間遲到 — 晚於核心時間開始時刻上班",
    core_time_early_leave: "核心時間早退 — 早於核心時間結束時刻下班",
    core_time_absence: "核心時間缺勤 — 設有核心時間的日期沒有實際工作",
    flex_contract_frame_capped: "所定工作日數 × 標準工作時間超過法定總額度,因此以法定總額度作為約定總額度。請檢查標準工作時間或所定休息日行事曆",
    flex_carry_in_clipped: "上月結轉的不足超出本月可追加的範圍(至法定總額度為止),已予以截斷",
    flex_carry_chain_truncated: "已達可回溯未結算月份的上限(3個月),更早的結轉視為0。結算之前的月份即可解除",
    national_holiday_data_unavailable: "該年度的國民節日資料尚未收錄,節日被計為所定工作日",
  } satisfies Record<
    | "missing_clock_out"
    | "duplicate_clock_in"
    | "clock_out_without_in"
    | "break_outside_work"
    | "duplicate_break_start"
    | "unmatched_break_end"
    | "clock_out_during_break"
    | "mixed_work_system"
    | "insufficient_break"
    | "missing_shift"
    | "shift_late_arrival"
    | "shift_early_leave"
    | "shift_unplanned_work"
    | "shift_absence"
    | "core_time_late_arrival"
    | "core_time_early_leave"
    | "core_time_absence"
    | "flex_contract_frame_capped"
    | "flex_carry_in_clipped"
    | "flex_carry_chain_truncated"
    | "national_holiday_data_unavailable",
    string
  >,

  /**
   * 多級(兩級)簽核的通用文案(2026-08-24 新增,詳見 docs/design/approval-flows.md)。
   *
   * 判斷點:打卡修正申請、休假申請、休息自動扣除撤銷申請這三類的文案完全相同,
   * 因此不在各自的 section(corrections / autoBreakWaiver / leave)裡各寫一遍,
   * 而是集中到一處(3 類 × 4 種語言 = 12 處重複,以及由此產生的措辭不一致)。
   * 只有狀態標籤本身(approved_step1)保留在各自的 statusLabel 旁邊。
   */
  approvalSteps: {
    /** 顯示在 requiredSteps >= 2 的申請卡片上,說明「已核准卻仍未生效」的原因。 */
    twoStepNote: "此申請為兩級簽核。一級簽核之後,還需擁有租用戶全域簽核權限的人完成二級簽核才會生效。",
    /** 顯示在簽核佇列每一行上,表示目前在等待哪一級簽核。 */
    awaitingStep1: "待一級簽核",
    awaitingStep2: "待二級簽核",
    /** 顯示給已完成一級簽核、但沒有二級簽核權限(租用戶全域範圍)的人。 */
    step2NotYours: "二級簽核由擁有租用戶全域簽核權限的人執行。",
    /** 一級簽核的執行人與時間的標題。 */
    step1DecidedLabel: "一級簽核",
    /** 與各 section 的 decidedBySelf 保持一致。 */
    step1DecidedBySelf: "本人",
  },

  corrections: {
    title: "打卡修正申請",
    tagline: "申請新增、更正或撤銷打卡紀錄。簽核通過後將反映到考勤紀錄中。",

    formTitle: "的修正申請",
    newRequestAction: "申請修正",
    tabOwn: "我的申請",
    tabQueue: (n: number) => `待審核(${n})`,
    formHint: "申請簽核通過後將反映到打卡紀錄及月度統計中。",
    close: "關閉",
    cancel: "取消",
    submit: "送出申請",
    submitting: "送出中…",
    submitted: "申請已送出。簽核通過後將反映到打卡紀錄中。",

    currentPunchesTitle: "當日打卡紀錄",
    currentPunchesEmpty: "當日暫無打卡紀錄",

    /** 用於選擇新增/更正/撤銷(/休息撤銷)模式的單選組的 aria-label。 */
    modeGroupAriaLabel: "操作型別",
    modeAdd: "新增打卡",
    modeCorrect: "更正已有打卡",
    modeCancel: "撤銷已有打卡",

    kindLabel: "型別",
    timeLabel: "時間",
    targetLabel: "目標打卡紀錄",
    targetPlaceholder: "請選擇目標紀錄",
    targetEmpty: "沒有可選的目標打卡紀錄",
    reasonLabel: "理由",
    reasonPlaceholder: "請輸入需要修正的理由",

    typeAdd: "新增",
    typeCorrect: "更正",
    typeCancel: "撤銷",
    targetUnavailable: "無法取得目標打卡資訊(可能已被處理)",

    statusLabel: {
      pending: "簽核中",
      /** 僅在兩級簽核時出現的中間狀態,此時尚未反映到考勤紀錄。 */
      approved_step1: "已一級核准(待二級)",
      approved: "已核准",
      rejected: "已駁回",
      withdrawn: "已撤回",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    columnTarget: "目標日期時間",
    columnContent: "內容",
    columnReason: "理由",
    columnDecision: "簽核",

    approve: "核准",
    reject: "駁回",
    withdraw: "撤回",

    decidedByLabel: "簽核人",
    decidedAtLabel: "簽核時間",
    decisionNoteLabel: "簽核備註",
    decisionNotePlaceholder: "備註(選填)",
    decidedBySelf: "本人",

    confirmApproveTitle: "確定要核准此申請嗎",
    confirmApproveMessage: "核准後將反映到考勤紀錄,月度統計也會隨之變化。此操作將被記錄到稽核日誌中。",
    confirmApproveSelfNote: "將被記錄為自行核准。",
    confirmRejectTitle: "確定要駁回此申請嗎",
    confirmRejectMessage: "駁回後申請將被記錄為已駁回狀態,不會反映到打卡紀錄中。",
    confirmWithdrawTitle: "確定要撤回此申請嗎",
    confirmWithdrawMessage: "撤回後將解除簽核中狀態。如有需要可重新送出申請。",
    confirmProceed: "執行",

    empty: "暫無申請紀錄",

    queueSectionTitle: "待簽核的修正申請",
    queueSectionTagline: "在您的簽核權限範圍內,待簽核的修正申請。",
    queueEmpty: "暫無待簽核的申請",

    errors: {
      already_superseded: "目標打卡紀錄已被其他申請修正",
      not_pending: "此申請已被處理",
      not_found: "找不到目標申請",
      invalid_reason: "請輸入1〜500字的理由",
      invalid_target_event: "找不到目標打卡紀錄,請重新選擇",
      invalid_proposed_kind: "請確認打卡型別",
      invalid_proposed_occurred_at: "請確認時間格式",
      proposed_occurred_at_in_future: "不能指定未來的時間",
      invalid_request_shape: "請確認輸入內容",
      invalid_body: "請確認輸入內容",
      invalid_status: "指定了無法顯示的狀態",
      /** 409。兩級簽核中,完成一級簽核的本人試圖進行二級簽核。 */
      /** 403。例如沒有租用戶全域範圍的簽核人嘗試進行二級簽核。 */
      forbidden: "沒有執行此操作的權限",
      same_approver_as_step1: "完成一級簽核的本人無法進行二級簽核,請交由其他簽核人處理",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 休息自動扣除撤銷申請。與打卡修正申請(corrections)是不同的資料表、不同的流程,
   * 但簽核頁面沿用同一位置(/corrections)與同一互動方式(ConfirmDialog、k-modal)。
   */
  autoBreakWaiver: {
    /** CorrectionForm(月度修正強制回應對話方塊)內的新模式標籤。 */
    modeWaiver: "未能休息",
    /** 當天存在自動扣除時,在強制回應對話方塊頂部顯示的提示。 */
    deductedNotice: (amount: string) => `當天已自動扣除 ${amount} 作為休息時間。`,
    formHint: "此為實際未能休息時的申請。核准後將取消當天的自動扣除,若休息時間不足將顯示警告。",
    reasonLabel: "理由",
    reasonPlaceholder: "請輸入未能休息的理由",
    submit: "送出申請",
    submitting: "送出中…",

    typeLabel: "休息自動扣除撤銷",
    columnDate: "目標日期",
    columnReason: "理由",
    columnDecision: "簽核",

    ownSectionTitle: "休息自動扣除撤銷申請",
    ownSectionTagline: "你送出的休息自動扣除撤銷申請清單。",
    queueSectionTitle: "待簽核的撤銷申請",
    queueSectionTagline: "在你的簽核權限範圍內、待簽核的撤銷申請。",
    empty: "暫無申請紀錄",
    queueEmpty: "沒有待簽核的申請",

    statusLabel: {
      pending: "簽核中",
      /** 僅在兩級簽核時出現的中間狀態,此時尚未反映到考勤紀錄。 */
      approved_step1: "已一級核准(待二級)",
      approved: "已核准",
      rejected: "已駁回",
      withdrawn: "已撤回",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    approve: "核准",
    reject: "駁回",
    withdraw: "撤回",
    decisionNoteLabel: "簽核備註",
    decisionNotePlaceholder: "備註(選填)",
    decidedBySelf: "本人",

    confirmApproveTitle: "確定要核准此申請嗎",
    confirmApproveMessage:
      "核准後將取消當天的自動扣除,月度統計將隨之變化。若休息時間不足將顯示警告。此操作將被記錄到稽核日誌中。",
    confirmApproveSelfNote: "將被記錄為自行核准。",
    confirmRejectTitle: "確定要駁回此申請嗎",
    confirmRejectMessage: "駁回後申請將被記錄為已駁回狀態,自動扣除將保持不變。",
    confirmWithdrawTitle: "確定要撤回此申請嗎",
    confirmWithdrawMessage: "撤回後將解除簽核中狀態。如有需要可重新送出申請。",

    errors: {
      invalid_waive_date: "請確認目標日期",
      invalid_reason: "請輸入1〜500字的理由",
      invalid_body: "請確認輸入內容",
      invalid_status: "指定了無法顯示的狀態",
      not_pending: "此申請已被處理",
      already_approved: "當天的撤銷申請已被核准",
      not_found: "找不到目標申請",
      forbidden: "沒有執行此操作的權限",
      /** 409。兩級簽核中,完成一級簽核的本人試圖進行二級簽核。 */
      same_approver_as_step1: "完成一級簽核的本人無法進行二級簽核,請交由其他簽核人處理",
      month_closed_requires_unlock: "本月已確定結算。需要解除結算權限才能核准",
      default: "處理失敗,請重試",
    },
  },

  notifications: {
    bellLabel: "通知",
    title: "通知",
    empty: "暫無通知",
    unread: "未讀",
    markRead: "標為已讀",
    markReadFailed: "標記已讀失敗,請重試",
    subjectDateLabel: "目標日期",
    receivedAtLabel: "接收時間",
    openCorrection: "開啟當日的修正申請",
    /** 來自 leave_* 型別的入口(通知一覽頁面)。 */
    openLeave: "開啟帶薪年假頁面",
    openLeaveSettings: "開啟帶薪年假設定頁面",
    /** 來自 overtime_* 型別的入口(通知一覽頁面)。 */
    openMonthly: "開啟月度頁面",
    loadFailed: "通知取得失敗,請重試",
    /** 鈴鐺下拉式清單末尾的入口。 */
    viewAll: "檢視全部通知 →",
  },

  /** 通知一覽頁面(/notifications)。與鈴鐺下拉式清單不同,可回溯檢視歷史通知。 */
  notificationsPage: {
    title: "通知",
    tagline: "可以檢視歷史通知。",
    filterStatusGroupLabel: "按已讀狀態篩選",
    filterStatusAll: "全部",
    filterStatusUnread: "僅未讀",
    filterTypeGroupLabel: "按型別篩選",
    filterTypeAll: "全部型別",
    filterTypeMissingClockOut: "忘記打卡",
    filterTypeOvertime: "36協定",
    filterTypeLeave: "帶薪年假",
    markAllRead: "將目前顯示內容全部標為已讀",
    markAllReadPending: "處理中…",
    empty: "暫無通知",
    emptyFiltered: "沒有符合條件的通知",
    /** 介面最多隻返回100條(規格限制,介面不作調整)。 */
    truncatedNotice: "僅顯示最近100條,更早的通知將不再顯示。",
  },

  settingsNotifications: {
    title: "通知設定(公司全域)",
    tagline: "設定整個租用戶的通知管道(Webhook、電子郵件)。",
    noPermission: "沒有權限更改此設定",
    /** 需在介面上明確區分本設定與個人設定(/settings/notifications/me)。 */
    distinctionBanner:
      "此處為公司全域管道(SMTP伺服器、共享Webhook等)的設定。若要設定個人的通知接收方式(電子郵件、個人Webhook的啟用/停用),請前往「個人通知設定」。",
    linkToPersonalSettings: "打開個人通知設定 →",

    webhookSectionTitle: "Webhook",
    webhookEnabledLabel: "啟用Webhook通知",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "已設定",
    webhookUrlNotConfigured: "未設定",
    keepIfBlankHint: "如不更改,請保留為空",

    smtpSectionTitle: "電子郵件(SMTP)",
    smtpEnabledLabel: "啟用電子郵件通知",
    smtpHostLabel: "SMTP主機",
    smtpPortLabel: "埠",
    smtpUserLabel: "使用者名稱",
    smtpFromLabel: "發件人電子郵件地址",
    smtpPasswordLabel: "密碼",
    smtpPasswordConfigured: "已設定",
    smtpPasswordNotConfigured: "未設定",

    save: "儲存",
    saving: "儲存中…",
    saveNote: "此設定適用於整個租用戶,更改將被記錄到稽核日誌中。",
    saveSuccess: "設定已儲存。",

    testSend: "傳送測試",
    testSendConfirmTitle: "要傳送測試通知嗎",
    testSendConfirmMessage: "將使用已儲存的設定實際傳送一條通知。",
    testSendConfirmLabel: "傳送",
    testSendResultTitle: "測試傳送結果",
    testSendOk: "成功",
    testSendFailed: "失敗",
    testSendChannelLabel: {
      webhook: "Webhook",
      smtp: "電子郵件(SMTP)",
    } as Record<string, string>,

    loading: "載入中…",
    loadFailed: "設定取得失敗,請重試",

    errors: {
      invalid_webhook_enabled: "請確認輸入內容",
      invalid_smtp_enabled: "請確認輸入內容",
      invalid_webhook_url: "請確認Webhook URL的格式(請輸入有效的http/https URL)",
      invalid_smtp_host: "請確認SMTP主機",
      invalid_smtp_user: "請確認使用者名稱",
      invalid_smtp_from: "請確認發件人電子郵件地址",
      invalid_smtp_password: "請確認密碼",
      invalid_smtp_port: "埠號請輸入1〜65535範圍內的數值",
      invalid_smtp_config: "啟用電子郵件通知時,請填寫主機、埠和發件人",
      invalid_body: "請確認輸入內容",
      not_configured: "沒有已設定的有效管道",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 個人通知設定(/settings/notifications/me)。與租用戶設定(settingsNotifications,上文)
   * 是不同的層級,需在文案上明確區分。
   */
  settingsPersonalNotifications: {
    title: "個人通知設定",
    tagline: "設定你個人的通知接收方式。每個人都只能更改自己的設定。",

    distinctionBanner:
      "此處為你個人的接收方式設定。如需設定公司全域管道(SMTP伺服器、共享Webhook等),請前往「通知設定(公司全域)」。",
    distinctionBannerNoAccess: "此處為你個人的接收方式設定。公司全域管道設定請諮詢管理員。",
    linkToTenantSettings: "開啟通知設定(公司全域) →",

    categoriesSectionTitle: "各類通知的接收方式",
    categoryColumnInapp: "應用程式內",
    categoryColumnEmail: "電子郵件",
    categoryColumnWebhook: "個人Webhook",
    /** 2026-08-24 新增。僅在已設定 VAPID 金鑰的部署(pushAvailable=true)中顯示該列。 */
    categoryColumnPush: "推送通知",
    inappAlwaysOnHint: "應用程式內通知始終開啟(無法更改)。",
    categories: {
      missing_clock_out: "忘記打卡",
      overtime_alert: "36協定·加班提醒",
      leave_alert: "帶薪年假即將失效·年5天強制使用義務提醒",
      /** 修正類申請(如休息自動扣除撤銷等)的核准/駁回通知。 */
      correction_alert: "申請的核准/駁回(如休息自動扣除撤銷等)",
      /** 2026-08-23 Tier 0 第4部分新增。面向擁有核准權限的人 — 管轄範圍內成員送出申請時的通知。 */
      approval_request: "簽核請求(管轄範圍內成員送出申請時。面向擁有核准權限的人)",
      /** 2026-08-24 追加。前日の自分の勤務がシフトとずれたときの本人向け通知。 */
      shift_variance: "與排班的偏差(自己的出勤與排班不一致時。遲到、早退、可能缺勤等)",
    } as Record<string, string>,

    emailSectionTitle: "通知電子郵件地址",
    emailAddressLabel: "電子郵件地址",
    emailAddressPlaceholder: "留空則使用帳號電子郵件地址",
    emailAddressEffectiveHint: (email: string) => `目前接收地址: ${email}`,

    webhookSectionTitle: "個人 Webhook",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "已設定",
    webhookUrlNotConfigured: "未設定",
    keepIfBlankHint: "如不更改,請保留為空",


    /**
     * 瀏覽器推送通知(2026-08-24 新增,docs/design/web-push.md)。
     * 訂閱需要**按瀏覽器**分別進行(電腦和手機需各自授權)。
     */
    pushSectionTitle: "瀏覽器推送通知",
    pushHint: "訂閱需要按瀏覽器分別進行。若想在其他裝置或瀏覽器上也接收,請在那裡執行相同的操作。",
    pushEnable: "在此瀏覽器接收推送通知",
    pushEnabling: "設定中…",
    pushDisable: "停止在此瀏覽器接收",
    pushDisabling: "解除中…",
    pushSubscribed: "此瀏覽器已訂閱。",
    pushNotSubscribed: "此瀏覽器尚未訂閱。",
    pushUnsupported: "此瀏覽器不支援推送通知。",
    pushPermissionDenied:
      "通知已被阻止。請從瀏覽器位址列的鎖形(或網站資訊)圖示開啟網站設定,將「通知」改為「允許」後再試一次。",
    pushPermissionDismissed: "未獲得通知權限,請重試。",
    pushUnavailable: "此 KIZAMI 未啟用推送通知,請聯絡管理員。",
    pushFailed: "推送通知設定失敗,請重試。",

    save: "儲存",
    saving: "儲存中…",
    saveSuccess: "設定已儲存。",

    testSend: "傳送測試",
    testSendConfirmTitle: "要傳送測試通知嗎",
    testSendConfirmMessage: "將向已儲存的個人Webhook實際傳送一條通知。",
    testSendConfirmLabel: "傳送",
    testSendResultTitle: "測試傳送結果",
    testSendOk: "成功",
    testSendFailed: "失敗",

    loading: "載入中…",
    loadFailed: "設定取得失敗,請重試",

    errors: {
      invalid_body: "請確認輸入內容",
      invalid_categories: "請確認通知型別的指定",
      invalid_email_address: "請確認電子郵件地址格式",
      invalid_webhook_url: "請確認Webhook URL的格式(請輸入有效的http/https URL)",
      encryption_unavailable: "目前無法儲存此項,請聯絡管理員",
      not_configured: "尚未設定個人Webhook",
      decryption_failed: "無法讀取已儲存的值,請重新設定",
      default: "處理失敗,請重試",
    },
  },

  /**
   * Slack斜線命令打卡的整合設定(/settings/slack,公司全域)。
   * docs/external-api/slack.md 為規格權威來源。
   */
  settingsSlack: {
    title: "Slack整合",
    tagline: "設定透過Slack斜線命令(/punch)進行打卡的功能。",
    noPermission: "沒有權限更改此設定",
    setupGuideHint: "關於設定步驟(建立Slack 應用程式、儲存Signing Secret的方法),請參見下方頁面。",
    setupGuideLinkLabel: "Slack 整合設定步驟",

    teamIdLabel: "Slack 工作區ID(Team ID)",
    teamIdPlaceholder: "T0123456",
    teamIdHint: "可在Slack的「Basic Information」頁面等處檢視。每個租用戶只能設定一個工作區。",

    signingSecretLabel: "Signing Secret",
    signingSecretConfigured: "已設定",
    signingSecretNotConfigured: "未設定",
    keepIfBlankHint: "如不更改,請保留為空",

    enabledLabel: "啟用Slack打卡",
    enabledHint: "啟用前需要同時設定工作區ID和Signing Secret。",

    save: "儲存",
    saving: "儲存中…",
    saveSuccess: "設定已儲存。",
    saveNote: "此設定適用於整個租用戶,更改將被記錄到稽核日誌中。",

    loading: "載入中…",
    loadFailed: "設定取得失敗,請重試",

    linkNavHint: "員工本人的Slack帳號關聯可透過「",
    linkNavLinkLabel: "輸入Slack關聯權杖",
    linkNavHintSuffix: "」進行(無需權限)。",

    errors: {
      invalid_enabled: "請確認輸入內容",
      invalid_team_id: "請確認工作區ID",
      invalid_signing_secret: "請確認Signing Secret",
      invalid_slack_config: "啟用時請同時輸入工作區ID和Signing Secret",
      invalid_body: "請確認輸入內容",
      encryption_unavailable: "目前無法儲存此項,請聯絡管理員",
      default: "處理失敗,請重試",
    },
  },

  /** SSO(OIDC)設定介面(/settings/sso,2026-08-24 新增)。docs/design/sso-oidc.md 為規格正本。 */
  settingsSso: {
    title: "SSO(OIDC)",
    tagline: "透過 OIDC 與 Google Workspace、Entra ID 等身分提供者串接,啟用 SSO 登入。",
    noPermission: "沒有權限更改此設定",
    setupGuideHint: "身分提供者一側的應用程式註冊步驟,以及本介面各項的含義,請參見下方頁面。",
    setupGuideLinkLabel: "SSO(OIDC)登入的設計與設定步驟",

    noAutoProvisioningNote: "SSO 是現有成員的登入方式。即使在身分提供者擁有帳號,未被邀請加入 KIZAMI 的人也無法登入(不會自動建立成員)。",

    redirectUriLabel: "需在身分提供者登記的重定向 URI",
    redirectUriHint: "請在身分提供者的應用程式設定中,將此 URL 登記為「已授權的重定向 URI」。",

    issuerLabel: "issuer(頒發者 URL)",
    issuerPlaceholder: "https://accounts.google.com",
    issuerHint: "只能填寫以 https 開頭的 URL。設定資訊會自動從 {issuer}/.well-known/openid-configuration 取得。",

    clientIdLabel: "用戶端 ID",
    clientIdHint: "在身分提供者註冊應用程式後簽發。它不屬於機密資訊,因此在此介面原樣顯示。",

    clientSecretLabel: "用戶端金鑰",
    clientSecretConfigured: "已設定",
    clientSecretNotConfigured: "未設定",
    keepIfBlankHint: "如不更改,請保留為空",

    allowUnverifiedLabel: "電子郵件地址未驗證時也允許登入",
    allowUnverifiedHint: "預設關閉。開啟後,即使身分提供者不返回 email_verified 也能登入;但在允許使用者自稱任意電子郵件地址的身分提供者下可能被冒充,因此請僅在自建身分提供者等特殊情況下開啟。",

    enabledLabel: "啟用 SSO 登入",
    enabledHint: "啟用前需要同時設定 issuer、用戶端 ID 和用戶端金鑰。",

    save: "儲存",
    saving: "儲存中…",
    saveSuccess: "設定已儲存。",
    saveNote: "此設定適用於整個租用戶,更改將被記錄到稽核日誌中。",

    loading: "載入中…",
    loadFailed: "設定取得失敗,請重試",

    errors: {
      invalid_enabled: "請確認輸入內容",
      invalid_issuer: "issuer 必須是以 https 開頭的 URL(不能帶查詢引數或片段)",
      invalid_client_id: "請確認用戶端 ID",
      invalid_client_secret: "請確認用戶端金鑰",
      invalid_allow_unverified_email: "請確認輸入內容",
      invalid_sso_config: "啟用時請同時輸入 issuer、用戶端 ID 和用戶端金鑰",
      invalid_body: "請確認輸入內容",
      encryption_unavailable: "目前無法儲存此項,請聯絡管理員",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 多級簽核設定(/settings/approval-flow,2026-08-24 新增)。以 docs/design/approval-flows.md 為準。
   * 介面只是按型別選擇「1 級」或「2 級(一級+二級簽核)」,但它改變的是整個簽核體制,
   * 因此最容易被誤解的兩點(不影響已送出的申請、二級簽核人需要租用戶全域範圍)必須顯示在頁面上。
   */
  settingsApprovalFlow: {
    title: "多級簽核",
    tagline: "按申請型別決定簽核是 1 級,還是 2 級(一級簽核+二級簽核)。",
    noPermission: "您沒有更改此設定的權限",
    loadFailed: "取得設定失敗,請重試",

    defaultSingleHint: "預設全部為 1 級。保持不變時,與以往一樣一次核准即可生效。",
    twoStepHint: "設為 2 級後,一級簽核仍由擁有該型別簽核權限的人執行,二級簽核則由以「租用戶全域」範圍擁有同一權限的人(人事、總部等)執行。在二級簽核完成之前,申請不會生效。",
    sameApproverHint: "一級簽核與二級簽核不能由同一人執行。",
    frozenAtCreationHint: "更改此設定不會改變已經送出的申請的級數。申請會按建立時的級數一直走到最後。",
    tenantApproverRequiredHint: "改為 2 級之前,請確認至少有 1 人以「租用戶全域」範圍擁有該簽核權限。否則申請會一直卡在待二級簽核狀態。",

    correctionLabel: "打卡修正申請",
    correctionHint: "打卡紀錄的補錄、修正、撤銷申請。簽核權限為「核准打卡修正」。",
    leaveLabel: "休假申請",
    leaveHint: "帶薪年假等的使用申請。簽核權限為「核准休假申請」。",
    autoBreakWaiverLabel: "休息自動扣除撤銷申請",
    autoBreakWaiverHint: "用於撤銷實際未能休息當天的自動扣除。簽核權限與打卡修正申請相同。",

    optionOneStep: "1 級(單級)",
    optionTwoSteps: "2 級(一級+二級簽核)",

    save: "儲存",
    saving: "儲存中…",
    saveSuccess: "設定已儲存。",
    saveNote: "此設定適用於整個租用戶,且僅對此後送出的申請生效。更改會記錄到稽核日誌。",

    errors: {
      invalid_correction_steps: "打卡修正申請的級數請選擇 1 級或 2 級",
      invalid_leave_steps: "休假申請的級數請選擇 1 級或 2 級",
      invalid_auto_break_waiver_steps: "休息自動扣除撤銷申請的級數請選擇 1 級或 2 級",
      invalid_body: "請確認輸入內容",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 輸入Slack關聯權杖(/settings/slack-link,無需權限,全員可用)。
   * 在Slack中執行 `/punch link` 後會產生一個15分鐘內有效的一次性權杖,在此輸入即可完成關聯。
   */
  settingsSlackLink: {
    title: "輸入Slack關聯權杖",
    tagline: "在Slack中執行 `/punch link` 後會顯示一個權杖,輸入該權杖即可關聯你的Slack帳號。",
    howToTitle: "操作步驟",
    howTo1: "在Slack中執行 `/punch link`",
    howTo2: "複製顯示的權杖(有效期15分鐘)",
    howTo3: "貼上到下方輸入框並點擊「關聯」",

    tokenLabel: "權杖",
    tokenPlaceholder: "kzsl_...",
    submit: "關聯",
    submitting: "關聯中…",

    successTitle: "關聯成功",
    successMessage: (slackUserId: string) =>
      `已關聯Slack帳號(${slackUserId})。此後可以使用 \`/punch in\` 等命令。`,

    errors: {
      invalid_token: "請輸入權杖",
      invalid_body: "請確認輸入內容",
      invalid_or_expired_token: "權杖無效或已過期(15分鐘)。請在Slack中重新執行 `/punch link`",
      default: "處理失敗,請重試",
    },
  },

  /** 設定子導航(/settings/* 之間的切換,僅顯示有權限存取的項目)。 */
  settingsNav: {
    label: "設定選單",
    /** 若僅顯示「設定」,會與其他標籤看起來同級,因此改為清楚表明是「返回清單」的操作。 */
    hubLink: "返回設定選單清單",
    myNotifications: "個人通知設定",
    notifications: "通知設定(公司全域)",
    departments: "部門",
    members: "成員",
    presets: "權限預設",
    approvalFlow: "多級簽核",
    tenantProfile: "租用戶設定檔",
    leave: "帶薪年假",
    help: "公司內部規定",
    privacy: "個人資料",
    attendance: "考勤規則",
    allowances: "津貼對象時間",
    shiftPatterns: "排班範本",
    security: "安全",
    display: "語言與顯示",
    apiKeys: "API金鑰",
    slack: "Slack整合",
    sso: "SSO(OIDC)",
    auditLogs: "稽核日誌",
  },

  settingsHub: {
    title: "設定",
    tagline: "管理租用戶的設定、組織架構和權限。僅顯示你有權限存取的項目。",
    empty: "沒有可用的設定項目,請聯絡管理員。",
    /** 明確區分個人設定(全員)與公司設定(面向管理員)的分組標題。 */
    personalGroupTitle: "個人設定",
    tenantGroupTitle: "公司設定",
    groupOrgTitle: "組織與權限",
    groupAttendanceTitle: "出勤·休假·津貼",
    groupIntegrationsTitle: "整合與通知",
    groupRecordsTitle: "法規與記錄",
    myNotificationsTitle: "個人通知設定",
    myNotificationsDesc: "按通知型別分別設定應用程式內、電子郵件、個人Webhook的接收方式。",
    notificationsTitle: "通知設定(公司全域)",
    notificationsDesc: "設定Webhook、電子郵件(SMTP)通知管道。",
    departmentsTitle: "部門",
    departmentsDesc: "建立部門樹、修改名稱、調整隸屬關係及刪除部門。",
    membersTitle: "成員",
    membersDesc: "變更成員所屬部門、分配權限預設、檢視實際生效的權限。",
    presetsTitle: "權限預設",
    presetsDesc: "建立和編輯組合了權限開關與適用範圍的預設。",
    approvalFlowTitle: "多級簽核",
    approvalFlowDesc: "設定打卡修正、休假、休息自動扣除撤銷申請需要 1 級簽核還是 2 級(一級+二級簽核)。",
    attendanceTitle: "考勤規則",
    attendanceDesc: "以新增版本的方式變更日界、法定休息日、休息規則、GPS 及工時制度等設定。",
    allowancesTitle: "津貼對象時間",
    allowancesDesc: "將符合特定日期、星期、時間段條件的實際工作時間,定義為津貼發放對象時間。",
    shiftPatternsTitle: "排班範本",
    shiftPatternsDesc: "定義早班、晚班、休息等排班範本。建立排班表時按日期分配。",
    tenantProfileTitle: "租用戶設定檔",
    tenantProfileDesc: "檢視影響統計的企業規模、特例措施適用單位、特別條款等屬性,以及即將生效的法規修訂。",
    leaveTitle: "帶薪年假",
    leaveDesc: "設定授予方式、按小時計年假、結轉休假等租用戶全域設定。",
    helpTitle: "公司內部規定",
    helpDesc: "設定說明中顯示的自有公司規定,以及工作規則的連結。",
    privacyTitle: "個人資料",
    privacyDesc: "根據目前設定檢視面向員工的隱私權聲明與公司內部使用條款的範本。",
    securityTitle: "登入與安全",
    securityDesc: "修改密碼,並設定使用驗證器應用程式6位驗證碼的兩步驟驗證。",
    displayTitle: "語言與顯示",
    displayDesc: "選擇介面的顯示語言和配色(淺色・深色)。",
    apiKeysTitle: "API金鑰",
    apiKeysDesc: "簽發和撤銷供IC卡讀卡器、Slack bot、MCP伺服器等外部用戶端打卡使用的API金鑰。",
    slackTitle: "Slack整合",
    slackDesc: "設定透過Slack斜線命令(/punch)進行打卡的功能。",
    ssoTitle: "SSO(OIDC)",
    ssoDesc: "透過 OIDC 與 Google Workspace、Entra ID 等身分提供者串接,讓已受邀成員可以使用 SSO 登入。",
    slackLinkTitle: "輸入Slack關聯權杖",
    slackLinkDesc: "輸入在Slack中執行 `/punch link` 後獲得的權杖,關聯你的Slack帳號。",
    auditLogsTitle: "稽核日誌",
    auditLogsDesc: "檢視打卡、修正、簽核、結算、權限變更等不可竄改的操作紀錄(僅供檢視)。",
    slackLinkNavTitle: "Slack關聯(本人)",
  },

  /** 月度結算與CSV匯出(/monthly 頁面)。 */
  closing: {
    closedBadge: "已確定",
    amendedBadge: "結算後有修改",
    snapshotBadge: "確定值",

    closeAction: "結算本月",
    reopenAction: "解除確定狀態",

    confirmCloseTitle: "確定要結算本月嗎",
    confirmCloseMessage:
      "將確定本月的考勤資料。此後的打卡與修正均需要申請並經過簽核。此操作將被記錄到稽核日誌中。",
    confirmCloseLabel: "結算",

    confirmReopenTitle: "確定要解除確定狀態嗎",
    confirmReopenMessage: "解除確定狀態後,本月將重新變為可自由編輯的狀態。已確定的數字(用於 CSV 匯出或薪資計算的數值)在修改後可能會有所變動。",
    confirmReopenExtraNote: "解除結算是影響較大的操作,此操作將被記錄到稽核日誌中。",
    confirmReopenLabel: "解除",

    noteLabel: "備註(選填)",
    notePlaceholder: "結算/解除的理由等(選填)",

    diffTitle: "與初始值的差異",
    diffColumnCategory: "分類",
    diffColumnOriginal: "初始值",
    diffColumnCurrent: "目前值",
    diffColumnDelta: "差異",
    diffFlexFrame: "彈性工作時間總額度",
    diffFlexActual: "彈性工作時間實際值",
    diffFlexDiff: "彈性工作時間收支",

    historyTitle: "結算曆史",
    historyEmpty: "暫無結算/解除歷史",
    historyActorSelf: "本人",
    historyEventLabel: {
      close: "結算",
      reopen: "解除",
      amend: "修改反映",
    } satisfies Record<"close" | "reopen" | "amend", string>,
    historyCorrectionLink: "檢視相關修正申請",

    csvFormatLabel: "格式",
    csvFormatOptions: {
      generic: "通用CSV",
      freee: "freee人事勞務(測試版)",
      mf: "Money Forward雲薪資(測試版)",
    },
    csvFormatBetaNote:
      "測試版:這是按各服務的考勤匯入格式產生的相容CSV。匯入前請務必確認列名、單位和員工標識與貴公司的設定一致。天數(出勤天數、缺勤天數、帶薪年假使用天數等)因KIZAMI不進行計算而留空。",
    csvDownload: "下載CSV",
    csvDownloading: "產生中…",
    csvCompareOriginalLabel: "包含與初始值的差異",
    csvDownloadFailed: "CSV下載失敗,請重試",

    errors: {
      already_closed: "本月已經結算",
      not_closed: "本月尚未結算",
      invalid_period: "請確認目標月份",
      invalid_note: "備註請控制在500字以內",
      invalid_body: "請確認輸入內容",
      default: "處理失敗,請重試",
    },
  },

  /** 租用戶設定檔(/settings/tenant-profile)。這些屬性是工作時間統計與36協定提醒的前提條件。 */
  settingsTenantProfile: {
    title: "租用戶設定檔",
    tagline: "設定作為工作時間統計和36協定提醒基礎的租用戶全域屬性。",
    noPermission: "沒有權限更改此設定",
    loadFailed: "設定取得失敗,請重試",

    smeLabel: "是否為中小企業",
    smeHint: "用於判定因企業規模而施行日期不同的項目(月度超過60小時的加班費率、36協定上限規定)。",

    specialProvisionLabel: "是否為特例措施適用單位",
    specialProvisionHint:
      "商業、影劇業、保健衛生業、娛樂服務業中常時僱用不滿10人的單位,其每週法定工作時間為44小時(《勞動基準法》第40條)。",

    specialClauseLabel: "已簽訂特別條款",
    specialClauseHint:
      "啟用與36協定特別條款相關的提醒(月度不足100小時、連續多月平均80小時、年度720小時、月度超過45小時每年最多6次)。",

    save: "儲存",
    saving: "儲存中…",
    saveSuccess: "設定已儲存。",

    confirmTitle: "確定要更改此設定嗎",
    confirmMessage: "此設定將直接影響工作時間的統計。",
    confirmExtraNote: "更改將被記錄到稽核日誌中。",
    confirmLabel: "更改",

    currentRulesTitle: "目前生效的主要數值",
    currentRulesWeekly: "每週法定工作時間",
    currentRulesAgreementMonthly: "36協定·月度上限",
    currentRulesAgreementAnnual: "36協定·年度上限",
    currentRulesHourlyLeave: "按小時計年假的上限天數",
    currentRulesHourlyLeaveUnit: "天/年",
    currentRulesSpecialClauseTitle: "特別條款下的上限(已簽訂時)",
    currentRulesSpecialMonthlyCap: "單月",
    currentRulesSpecialMonthlyCapNote: "以內",
    currentRulesSpecialMultiMonth: "連續多月平均",
    currentRulesSpecialAnnual: "年度",
    currentRulesSpecialExceedCount: "允許超過月45小時的次數",
    currentRulesSpecialExceedCountUnit: "次/年",

    upcomingTitle: "即將生效的法規修訂",
    upcomingEmpty: "目前沒有即將生效的法規修訂",
    upcomingEffectiveFrom: "施行日期",
    upcomingBasis: "依據",
    upcomingChangesPrefix: "變更內容: ",
    upcomingRuleLabel: {
      weeklyStatutoryMinutes: "每週法定工作時間",
      lateNight: "深夜時段",
      overtime60h: "月度超過60小時的分類",
      agreement36: "36協定上限",
      annualLeave: "帶薪年假",
    } satisfies Record<"weeklyStatutoryMinutes" | "lateNight" | "overtime60h" | "agreement36" | "annualLeave", string>,

    errors: {
      invalid_is_small_or_medium_enterprise: "請確認輸入內容",
      invalid_is_special_provision_workplace: "請確認輸入內容",
      invalid_special_clause_enabled: "請確認輸入內容",
      invalid_body: "請確認輸入內容",
      tenant_not_found: "找不到租用戶資訊",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 考勤規則的版本管理(/settings/attendance)。
   * 遵循 effective-dated 原則: 編輯僅透過新增版本進行,已有版本不會被修改
   * (過去的計算結果不會改變)。
   */
  settingsAttendance: {
    title: "考勤規則",
    tagline: "以新增版本的方式變更日界、法定休息日、休息規則、GPS 及工時制度。",
    noPermission: "沒有權限更改此設定",
    loadFailed: "設定取得失敗,請重試",

    currentTitle: "目前生效的設定",
    currentEffectiveFrom: "此版本生效的日期",
    dayBoundaryLabel: "日界(一天的起算時間)",
    /**
     * 每週起算星期。用於判定每週40小時(固定工作時間制下的每週加班)的一週分界,
     * 與法定休息日的星期指定(legalHolidayWeekday)是不同的概念,不要混淆。
     */
    weekStartWeekdayLabel: "每週起算星期",
    weekStartWeekdayHint: "用於判定每週40小時的一週分界。若工作規則中未規定,原則上從週日起算(1988年〔昭和63年〕基發第1號)。",
    /**
     * 變形期間起始日(docs/design/shift-work.md 決定事項3)。
     * 即使租用戶不使用 monthly_variable,每次 POST 也需必填此項(與 apps/api 的約定一致)。
     */
    variablePeriodStartDayLabel: "變形期間起始日",
    variablePeriodStartDayHint:
      "請指定1〜28之間的日期(29〜31日因並非每月都存在而無法選擇)。排班表(排班管理頁面)的期間將以此日為起點按月劃分。即使不使用排班制度也需要填寫。",
    legalHolidayLabel: "法定休息日",
    legalHolidayWeekday: "按星期指定",
    legalHolidayDates: "按具體日期指定",
    breakRuleLabel: "休息規則",
    breakRulePunch: "打卡方式",
    /** 休息的自動扣除。 */
    breakRuleModeAuto: "自動扣除",
    breakRuleModeBoth: "兩者並用",
    breakRuleRulesTitle: "扣除規則",
    breakRuleOverSuffix: "超過",
    breakRuleDeductSuffix: "分鐘則扣除",
    breakRuleAddRule: "新增一行",
    breakRuleRemoveRule: "刪除",
    breakRuleRuleOverLabel: "基準工作時間",
    breakRuleRuleDeductLabel: "扣除的分鐘數",
    breakRuleMaxRulesHint: "最多可設定3行。",
    gpsLabel: "GPS打卡",
    gpsEnabledYes: "啟用",
    gpsEnabledNo: "停用",
    gpsRetentionLabel: "GPS座標保留期限",
    gpsRetentionSameAsAttendance: "與考勤資料相同",
    gpsRetentionDaysUnit: "天",
    flexSettlementMonthly: "按月結算",
    flexStandardDayMinutesLabel: "標準工作時間(每天,分鐘)",
    /**
     * 核心時間(勞基法32條之3,2026-08-24 新增)。彈性工時制的**可選**設定,
     * 不設定即為超級彈性工時。不影響彙總,僅顯示遲到・早退・缺勤警告。
     */
    coreTimeLabel: "核心時間",
    coreTimeNone: "無核心時間(超級彈性工時)",
    coreTimeSummary: (start: string, end: string, weekdays: string) => `${start}〜${end}(${weekdays})`,
    noVersionYet: "尚未設定",

    weekdayLabel: {
      0: "週日",
      1: "週一",
      2: "週二",
      3: "週三",
      4: "週四",
      5: "週五",
      6: "週六",
    } satisfies Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>,

    formTitle: "新增版本",
    effectiveFromLabel: "生效日期",
    effectiveFromHint: "此變更僅影響指定日期之後的統計,過去的統計結果不會改變。",
    dayBoundaryHint: "0點=從00:00起算。存在深夜工作的崗位,例如設為05:00(300分鐘),可將跨天的工作合併計入同一天。",
    legalHolidayKindLabel: "指定方式",
    legalHolidayWeekdayValueLabel: "作為休息日的星期",
    legalHolidayDatesValueLabel: "作為休息日的日期(逗號分隔,YYYY-MM-DD)",
    legalHolidayDatesPlaceholder: "例如: 2026-05-05,2026-05-06",
    gpsEnabledCheckbox: "啟用GPS打卡",
    gpsWarning: "需要明確告知員工將採集此資訊,請檢視隱私權聲明範本。",
    gpsWarningLink: "檢視個人資料設定 →",
    gpsRetentionInputLabel: "保留期限(留空則與考勤資料相同)",
    flexStandardDayMinutesHint: "在帶薪年假當天,該分鐘數將計入工作時間額度。",
    coreTimeEnabledCheckbox: "設定核心時間",
    coreTimeStartLabel: "核心時間開始",
    coreTimeEndLabel: "核心時間結束",
    coreTimeWeekdaysLabel: "設有核心時間的星期",
    coreTimeHint:
      "核心時間內的缺勤會在月度清單中以「核心時間遲到・早退・缺勤」警告顯示。不影響彙總(結算期額度)——是否扣減薪資請由薪資方判斷。結束時刻必須晚於開始時刻(不支援跨日的核心時間)。",

    submit: "新增此版本",
    submitting: "新增中…",
    submitSuccess: "已新增新版本。",

    historyTitle: "版本歷史",
    historyEmpty: "暫無歷史紀錄",
    historyColumnEffectiveFrom: "生效日期",
    historyColumnSummary: "內容",

    errors: {
      invalid_body: "請確認輸入內容",
      invalid_effective_from: "請確認生效日期",
      invalid_day_boundary_minutes: "日界請輸入0〜1439範圍內的數值(分鐘)",
      invalid_week_start_weekday: "請確認每週起算星期",
      invalid_variable_period_start_day: "請輸入1〜28範圍內的變形期間起始日",
      invalid_legal_holiday_rule: "請確認法定休息日的指定",
      invalid_break_rule: "請確認休息規則",
      invalid_gps_enabled: "請確認輸入內容",
      invalid_gps_retention_days: "GPS座標保留期限請輸入1以上的整數",
      invalid_settlement_period: "目前版本的結算週期僅支援「按月結算」",
      invalid_standard_day_minutes: "標準工作時間請輸入1〜1440(分鐘)(固定工作時間制的所定工作時間為1〜480分鐘)",
      invalid_core_time: "核心時間的結束時刻請設定為晚於開始時刻(不支援跨日設定)",
      invalid_core_time_weekdays: "請至少選擇一個設有核心時間的星期",
      effective_from_in_past: "生效日期只能指定為今天或以後(否則會改變過去的統計結果)",
      version_already_exists: "該生效日期已存在版本,請指定其他日期",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 工時制度(/settings/attendance 的「工時制度」區塊,2026-10-05 新增)。
   * 依所定工作時間建立具名制度,並把制度分配給成員(縮短工時對應的第1階段)。
   * 新增版本與 settingsAttendance 相同,採用 effective-dated 方式(過去的統計不變)。
   */
  settingsWorkPolicies: {
    sectionTitle: "工時制度",
    sectionLead: "依所定工作時間分別建立制度並命名管理(例:「固定(8小時)」「固定・縮短工時(6小時)」)。在成員詳情中為成員分配制度。",
    loadFailed: "取得工時制度失敗,請再試一次",
    empty: "尚無制度",
    defaultBadge: "預設",
    archivedBadge: "已歸檔",
    defaultHint: "預設制度會自動分配給受邀成員(邀請時也可以選擇其他制度)。",
    kindLabel: "類型",
    standardDayLabel: {
      flex: "標準工作時間(每天)",
      fixed: "所定工作時間(每天)",
      monthly_variable: "基準所定時間(特休換算用,每天)",
    } satisfies Record<"flex" | "fixed" | "monthly_variable", string>,
    standardDayValue: (hm: string, minutes: number) => `${hm}(${minutes}分鐘)`,
    /** 変形労働時間制で基準所定が未設定(0)のとき。所定は日ごとのシフトで決まる。 */
    standardDayByShift: "所定時間由排班決定",
    totalHoursBasisLabel: "總工作時間的決定方式",
    totalHoursBasisValue: {
      statutory_frame: "法定總額度(每週法定工作時間 × 曆日數 ÷ 7)",
      scheduled_days: "所定天數 × 標準時間",
    } satisfies Record<"statutory_frame" | "scheduled_days", string>,
    totalHoursBasisHint: {
      statutory_frame: "沿用以往的方式。差額與延長工時都和法定總額度比較。",
      scheduled_days:
        "以依所定休息日行事曆計算的所定工作日數乘以標準工作時間,作為總工作時間(適用於縮短工時)。超出部分在法定總額度以內為法定內超出,超過法定總額度為法定外。",
    } satisfies Record<"statutory_frame" | "scheduled_days", string>,
    carryOverShortfallLabel: "不足結轉",
    carryOverShortfallCheckbox: "將不足結轉至下月",
    carryOverShortfallHint:
      "追加到下月的總工作時間。追加僅限不超過下月法定總額度的範圍,超出部分確定為當月的不足。超出的工作時間不結轉(工資須全額給付)。僅在「所定天數 × 標準時間」時可選。",
    carryOverShortfallValue: { on: "結轉", off: "不結轉" },
    assigneeCountLabel: "已分配人數(截至今天)",
    assigneeCountValue: (count: number) => `${count}人`,
    currentEffectiveFrom: "此版本的生效日期",
    notEffectiveYet: "尚無生效中的版本(僅登記了生效日期在未來的版本)",
    historyTitle: "版本歷史",
    historyColumnEffectiveFrom: "生效日期",
    historyColumnSummary: "內容",
    addVersionButton: "新增版本",
    addVersionTitle: "新增版本",
    renameButton: "變更名稱",
    archiveButton: "歸檔",
    unarchiveButton: "取消歸檔",
    archiveHint: "已歸檔的制度不會出現在新分配的選項中。已分配成員的計算不會改變。",
    cancel: "取消",
    nameLabel: "制度名稱",
    namePlaceholder: "例:固定・縮短工時(6小時)",
    renameSubmit: "使用此名稱",
    kindSelectLabel: "工時制類型",
    standardDayMinutesLabel: "每天的所定時間(分鐘)",
    fixedStandardDayHint: "請輸入1〜480分鐘(固定工作時間制不能設定超過8小時的所定時間)。超過所定時間但在8小時以內的部分為法定內加班,超過8小時的部分為延長工時(法定外加班)。1天特休也依此時間換算。",
    flexStandardDayHint: "請特休的日子,此分鐘數會作為工作時間計入結算期間的總額度。",
    variableStandardDayHint: "每天的所定時間由排班決定。此值僅用於在沒有排班的日子請1天特休時的換算。",
    initialEffectiveFromLabel: "生效日期",
    initialEffectiveFromHint: "此制度尚未分配給任何人,因此也可以指定過去的日期。以此制度邀請到職日在過去的成員時,請指定到職日當天或之前的日期。",
    addPolicyButton: "新增制度",
    addPolicyTitle: "新增制度",
    createSubmit: "以此內容新增制度",
    submitting: "儲存中…",
    createSuccess: "已新增制度。",
    renameSuccess: "已變更名稱。",
    versionSuccess: "已新增版本。",
    archiveSuccess: "已歸檔。",
    unarchiveSuccess: "已取消歸檔。",
    errors: {
      invalid_body: "請確認輸入內容",
      invalid_name: "請輸入1〜100個字元的制度名稱",
      work_policy_name_taken: "已存在同名制度,請使用其他名稱",
      cannot_archive_default_work_policy: "預設制度無法歸檔",
      invalid_effective_from: "請確認生效日期",
      invalid_work_system_kind: "請選擇工時制類型",
      invalid_settlement_period: "此版本的結算期間僅可選擇「按月結算」",
      invalid_standard_day_minutes: "每天的所定時間:固定工作時間制請輸入1〜480分鐘的整數,其他制度請輸入1〜1440分鐘的整數",
      invalid_core_time: "核心時間的結束時間須晚於開始時間(不能跨日設定)",
      invalid_core_time_weekdays: "請至少選擇一個有核心時間的星期",
      invalid_total_hours_basis: "請選擇總工作時間的決定方式",
      invalid_carry_over_shortfall: "請檢查不足結轉的設定",
      carry_over_requires_scheduled_days: "僅當總工作時間的決定方式為「所定天數 × 標準時間」時,才能選擇不足結轉",
      effective_from_in_past: "生效日期只能指定為今天以後(否則會改變過去的計算結果)",
      version_already_exists: "該生效日期已存在版本,請指定其他日期",
      not_found: "找不到該制度",
      forbidden: "您沒有執行此操作的權限",
      default: "處理失敗,請再試一次",
    },
  },

  /** 所定休息日行事曆(/settings/attendance 的區塊,2026-10-05)。 */
  settingsHolidayCalendar: {
    sectionTitle: "所定休息日行事曆",
    sectionLead:
      "設定公司的休息日(所定休息日)。用於依「所定天數 × 標準時間」決定彈性工作總工作時間的制度中計算所定工作日。不影響依法定總額度決定的制度。",
    legalHolidayNote: "法定休息日是所定休息日的一部分。即使不在此處填寫,法定休息日(上方的出勤規則)也一定計為休息日。",
    loadFailed: "取得所定休息日行事曆失敗,請再試一次",
    defaultInUse: "尚未儲存。依預設值(週六、週日及國民節日)計算。",
    weekdaysLabel: "所定休息日的星期",
    weekdaysNone: "無(不依星期休息)",
    nationalHolidaysLabel: "國民節日",
    nationalHolidaysValue: { on: "設為所定休息日", off: "不設為所定休息日" },
    nationalHolidaysCheckbox: "將日本的國民節日(含補假、國民休息日)設為所定休息日",
    extraHolidaysLabel: "個別設為休息日的日期",
    extraHolidaysHint: "年末年初、暑假等。以逗號或換行分隔輸入 YYYY-MM-DD。",
    extraWorkdaysLabel: "自休息日排除並設為出勤日的日期",
    extraWorkdaysHint: "例如節日照常營業的日子。法定休息日不可排除。以逗號或換行分隔輸入 YYYY-MM-DD。",
    datesPlaceholder: "例: 2026-12-29, 2026-12-30",
    none: "無",
    previewTitle: "所定工作日數參考",
    previewDays: (days: number) => `${days}天`,
    previewHint: "法定休息日依今天的出勤規則判定。",
    holidayDataRange: (first: number, last: number) => `國民節日資料: ${first}–${last}年(每年更新)`,
    holidayDataUnavailable: "該年度尚無節日資料,節日被計為所定工作日",
    formTitle: "新增版本",
    submit: "以此內容新增版本",
    submitting: "新增中…",
    submitSuccess: "已新增版本。",
    historyTitle: "版本歷史",
    historyColumnEffectiveFrom: "生效日期",
    historyColumnSummary: "內容",
    errors: {
      invalid_body: "請檢查輸入內容",
      invalid_effective_from: "請檢查生效日期",
      invalid_weekdays: "請檢查所定休息日的星期(不能選擇全部7天)",
      invalid_national_holidays: "請檢查國民節日的設定",
      invalid_extra_holidays: "請以 YYYY-MM-DD 輸入個別設為休息日的日期(最多366個)",
      invalid_extra_workdays: "請以 YYYY-MM-DD 輸入設為出勤日的日期(最多366個)",
      calendar_date_conflict: "同一天不能同時設為「休息日」與「出勤日」",
      effective_from_in_past: "生效日期只能指定為今天以後(否則過去的計算結果會改變)",
      version_already_exists: "該生效日期已有版本,請指定其他日期",
      forbidden: "您沒有執行此操作的權限",
      default: "處理失敗,請再試一次",
    },
  },

  /**
   * 津貼對象時間設定(/settings/allowances, docs/design/allowances.md, 2026-08-23 新增)。
   * 不計算金額 —— KIZAMI 只計算「符合該津貼條件的工作時間有多少分鐘」。與 settingsAttendance
   * 相同的 effective-dated 版本管理 UI(以 SettingsAttendanceView 為範本),但定義可以在同一租用戶下
   * 並行存在多個,因此每個定義都單獨持有目前值、新增版本表單與歷史紀錄。
   */
  settingsAllowances: {
    title: "津貼對象時間",
    tagline: "將符合特定日期、星期、時間段條件的實際工作時間,計算為津貼發放對象時間。不計算津貼單價與發放金額。",
    noPermission: "沒有變更此設定的權限",
    loadFailed: "取得設定失敗,請重試",

    listTitle: "津貼定義清單",
    empty: "尚無津貼定義",
    currentConditionsLabel: "目前條件",
    currentEffectiveFrom: "此版本生效日",
    noVersionYet: "目前尚無生效中的版本(僅存在生效日期為未來的版本)",

    nameLabel: "津貼名稱",
    namePlaceholder: "例: 早班津貼",
    effectiveFromLabel: "生效日期",
    effectiveFromHint: "此變更僅影響指定日期以後的計算,過去的統計不會改變。",

    conditionsSectionHint: "請至少指定一個條件。所指定的條件之間均為 AND(僅重疊部分為對象)。",
    datesFieldLabel: "特定日期",
    datesFieldHint: "以特定日期為對象。勾選「每年」後將忽略年份,僅按月/日符合(如年末年初津貼)。勾選「每年」時,日期欄中顯示的年份沒有實際意義。",
    addDateRow: "新增日期",
    removeDateRow: "刪除",
    dateYearlyCheckbox: "每年(忽略年份,僅按月/日符合)",
    dateRowAriaLabel: "對象日期",
    weekdaysFieldLabel: "星期",
    weekdaysFieldHint: "僅指定的星期為對象。",
    timeBandFieldLabel: "時間段",
    timeBandEnabledCheckbox: "指定時間段",
    timeBandStartLabel: "開始時間",
    timeBandEndLabel: "結束時間",
    timeBandHint: "若結束時間早於或等於開始時間,將視為跨日的時間段(例: 22:00〜次日5:00)。",

    createDefinitionTitle: "建立新的津貼定義",
    createDefinitionButton: "以此內容建立",
    creating: "建立中…",
    createSuccess: "已建立津貼定義。",

    addVersionTitle: "新增新版本",
    addVersionSubmit: "以此內容新增版本",
    addingVersion: "新增中…",
    submitSuccess: "已新增新版本。",

    historyTitle: "版本歷史",
    historyEmpty: "尚無歷史紀錄",
    historyColumnEffectiveFrom: "生效日期",
    historyColumnName: "津貼名稱",
    historyColumnConditions: "條件",

    /** summarizeAllowanceConditions(lib/allowances.ts)使用的摘要格式標記。 */
    summaryYearlyPrefix: "每年 ",
    summaryDateRangeSeparator: "〜",
    summaryListSeparator: "、",
    summaryPartsSeparator: " ",
    summaryNextDayPrefix: "次日",

    errors: {
      invalid_body: "請確認輸入內容",
      invalid_effective_from: "請確認生效日期",
      invalid_name: "請輸入津貼名稱",
      invalid_conditions: "請確認條件的輸入內容(特定日期需要填寫日期,時間段的開始與結束時間需不同)",
      conditions_required: "請至少指定一個條件(特定日期、星期或時間段)",
      effective_from_in_past: "生效日期只能指定為今天或以後(否則會改變過去的統計結果)",
      version_already_exists: "該生效日期已存在版本,請指定其他日期",
      not_found: "找不到對應的津貼定義",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 排班範本管理(/settings/shift-patterns)。
   * docs/design/shift-work.md 決定事項2「範本分配+個別編輯」中範本一側的 CRUD。
   * 與 apps/api/src/routes/settings/shift-patterns.ts 一致(僅 GET/POST/:id/archive,無編輯 API)。
   */
  shiftPatterns: {
    title: "排班範本",
    tagline: "定義早班、晚班、休息等範本。建立排班表時將此範本逐日分配。",
    noPermission: "沒有使用此頁面的權限",
    loadFailed: "取得範本清單失敗,請重試",
    empty: "尚無範本,請從「新增範本」建立。",

    addNew: "新增範本",
    columnName: "名稱",
    columnDayType: "型別",
    columnTime: "時間",
    columnActions: "操作",
    archive: "歸檔",
    archivedBadge: "已歸檔",
    showArchived: "同時顯示已歸檔",

    confirmArchiveTitle: "要歸檔此範本嗎",
    confirmArchiveMessage: "歸檔後將不再出現在新排班表的分配候選取。已分配的排班不受影響。",
    confirmArchiveLabel: "歸檔",

    formTitle: "新增新範本",
    nameLabel: "名稱",
    namePlaceholder: "例: 早班",
    dayTypeLabel: "型別",
    startLabel: "開始時間",
    endLabel: "結束時間",
    endHint: "若結束時間早於開始時間,將視為跨日工作(夜班)處理。",
    breakLabel: "休息(分鐘)",
    submit: "以此內容建立",
    submitting: "建立中…",
    submitSuccess: "已建立範本。",
    cancel: "取消",

    errors: {
      invalid_body: "請確認輸入內容",
      invalid_name: "請輸入名稱",
      invalid_day_type: "請確認型別",
      invalid_minutes: "請確認開始・結束時間",
      invalid_break_minutes: "休息(分鐘)請輸入0以上的整數",
      not_found: "找不到對應的範本",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 排班表建立・確定(/shifts,擁有 shift.manage 權限的使用者)。
   * 與 apps/api/src/routes/shifts.ts 一致。period_start_mismatch(變形期間起始日不一致)
   * 因攜帶數字(正確的起始日),故與 errors(僅字串)分開,單獨設定 periodStartMismatchMessage。
   */
  shifts: {
    title: "排班表",
    tagline: "按成員為每個變形期間建立排班表並確定。確定後的變更將保留在歷史紀錄中。",
    noPermission: "沒有使用此頁面的權限",
    loadFailed: "取得排班表失敗,請重試",

    memberLabel: "目標成員",
    prevPeriod: "← 上一期間",
    nextPeriod: "下一期間 →",
    periodRangeLabel: (start: string, end: string) => `${start} 〜 ${end}`,

    noPlanYet: "此期間尚無排班表。",
    createPlan: "建立此期間的排班表",
    creatingPlan: "建立中…",

    publishedBadge: "已確定",
    unpublishedBadge: "未確定",
    publishAction: "確定",
    publishing: "確定中…",
    confirmPublishTitle: "要確定此排班表嗎",
    confirmPublishMessage:
      "確定後的變更將作為歷史紀錄儲存,無法刪除。事先明確各日、各週的工作時間是變形工作時間制的法律要求。",
    confirmPublishLabel: "確定",

    historyToggleOpen: "檢視變更歷史",
    historyToggleClose: "收起變更歷史",
    historyEmpty: "尚無變更歷史",
    historyColumnDate: "日期",
    historyColumnDayType: "型別",
    historyColumnTime: "時間",
    historyColumnCreatedBy: "變更人",
    historyColumnCreatedAt: "日期時間",

    /** 每週網格(行=週,列=星期。docs/design/shift-work.md 決定事項2)。 */
    cellEmpty: "未設定",
    cellDialogTitle: (date: string) => `${date} 的排班`,
    cellDialogPatternLabel: "從範本中選擇",
    cellDialogPatternNone: "不使用範本,單獨設定",
    cellDialogDayTypeLabel: "型別",
    cellDialogStartLabel: "開始時間",
    cellDialogEndLabel: "結束時間",
    cellDialogBreakLabel: "休息(分鐘)",
    cellDialogSave: "儲存",
    cellDialogSaving: "儲存中…",
    cellDialogCancel: "取消",

    /** 批次分配(按星期指定範本,一次性應用到整個期間。決定事項2「降低錄入成本的關鍵」)。 */
    bulkAssignTitle: "批次分配",
    bulkAssignHint: "按星期指定範本,一次性應用到此整個期間。",
    bulkAssignNoneOption: "不變更",
    bulkAssignApply: "應用此內容",
    bulkAssignApplying: "應用中…",
    bulkAssignSuccess: "已應用。",

    /** 確定前的統計(要求: 確定前需能看到不足之處)。 */
    aggregationTitle: "此期間的統計(參考值)",
    aggregationScheduledLabel: "應工作時間合計",
    aggregationStatutoryFrameLabel: "法定總額度(40小時 × 歷日數 ÷ 7)",
    aggregationOverLabel: "已超過總額度",
    aggregationLegalHolidayLabel: "法定休息日天數",
    aggregationLegalHolidayOk: "滿足每週1天或每4週4天的要求",
    aggregationLegalHolidayShortage: "不滿足每週1天或每4週4天的要求,無法確定",
    aggregationUnassignedDaysLabel: "未設定天數",

    /** 變形期間起始日不一致(400 period_start_mismatch)。當網頁猜測的日期有誤時顯示,並據此修正期間。 */
    periodStartMismatchMessage: (day: number) => `變形期間起始日為${day}日。已修正顯示的期間,請重試`,

    errors: {
      invalid_body: "請確認輸入內容",
      invalid_user_id: "請確認目標成員",
      invalid_period_start: "請確認期間起始日",
      tenant_settings_not_found: "找不到此期間的考勤設定,請聯絡管理員",
      plan_already_exists: "此期間的排班表已存在",
      not_found: "找不到對應的排班表",
      invalid_days: "請確認排班內容",
      invalid_date: "請確認日期",
      date_out_of_period: "該日期不在此期間範圍內",
      invalid_pattern_id: "找不到所選範本",
      archived_pattern: "所選範本已歸檔,請選擇其他範本",
      invalid_day_type: "請確認型別",
      invalid_minutes: "請確認開始・結束時間",
      invalid_break_minutes: "休息(分鐘)請輸入0以上的整數",
      duplicate_date: "存在重複的日期",
      already_published: "此排班表已確定",
      legal_holiday_shortage: "法定休息日不足,請設定為滿足每週1天或每4週4天",
      invalid_range: "請確認指定的期間",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /** 檢視本人排班(/shifts/me,全員可用)。 */
  shiftsMe: {
    title: "我的排班",
    tagline: "以月曆形式檢視已確定的排班表(計劃)。",
    loadFailed: "取得排班失敗,請重試",
    prevMonth: "上月",
    nextMonth: "下月",
    empty: "本月尚未登記排班。",
    manageLink: "管理排班表 →",
    todayLabel: "今天",
  },

  departments: {
    title: "部門管理",
    tagline: "建立部門樹、修改名稱、調整隸屬關係及刪除部門。",
    noPermission: "沒有權限使用此頁面",
    loadFailed: "部門清單取得失敗,請重試",
    empty: "目前還沒有部門,請點擊「新增部門」進行建立。",
    topLevel: "頂級",
    addRoot: "新增部門",
    addChild: "新增下屬部門",
    rename: "修改名稱/上級部門",
    delete: "刪除",

    formTitleCreate: "新增部門",
    formTitleEdit: "編輯部門",
    nameLabel: "部門名稱",
    namePlaceholder: "例如: 銷售部",
    parentLabel: "上級部門",
    parentNone: "無(頂級)",
    save: "儲存",
    saving: "儲存中…",
    cancel: "取消",

    confirmDeleteTitle: "確定要刪除此部門嗎",
    confirmDeleteMessage: "刪除後無法恢復。若存在下屬部門或成員,則無法刪除。",
    confirmDeleteLabel: "刪除",

    errors: {
      invalid_name: "部門名稱請輸入1〜200個字元",
      invalid_parent_id: "找不到指定的上級部門",
      invalid_body: "請確認輸入內容",
      circular_reference: "不能將自身或下屬部門設為上級部門",
      not_found: "找不到目標部門",
      department_not_empty: "仍存在下屬部門或成員",
      default: "處理失敗,請重試",
    },
  },

  members: {
    title: "成員管理",
    tagline: "變更所屬部門、分配權限預設、檢視實際生效的權限(可執行的操作)。",
    noPermission: "沒有權限使用此頁面",
    loadFailed: "成員清單取得失敗,請重試",
    empty: "暫無成員",

    columnName: "姓名",
    columnEmail: "電子郵件地址",
    columnDepartment: "所屬部門",
    columnPresets: "已分配預設",
    columnHireDate: "入職日期",
    columnInviteStatus: "邀請狀態",
    /** 離職處理(停用,2026-08-23 Tier 0 第4部分新增)的狀態徽章列。 */
    columnStatus: "狀態",
    /** 成員個人勞動時間制度(2026-08-23 Tier 0 第4部分新增)的小型展示列。 */
    columnWorkSystem: "勞動時間制度",
    columnActions: "操作",
    noDepartment: "未分配",
    noPresets: "未分配",
    /** workSystemKind 為 null 時(從未分配過)。與 monthly.workSystemValue 保持一致,並新增「未設定」。 */
    workSystemUnset: "未設定",

    detailToggleOpen: "展開詳情",
    detailShortOpen: "詳細",
    detailShortClose: "關閉",
    moreActions: "更多操作",
    basicsTitle: "所屬部門與到職日",
    detailToggleClose: "收起詳情",

    /** 已離職處理(停用)成員的狀態徽章(2026-08-23 Tier 0 第4部分新增)。 */
    inactiveBadge: "已停用",
    /**
     * 清單篩選(預設僅顯示在職成員)。由於此前沒有既有的篩選慣例,採用了最簡單的
     * 單個核取方塊開關。
     */
    showInactiveToggle: "同時顯示已停用的成員",

    /**
     * 邀請制註冊。建立成員的同時會一併發放邀請(POST /members)。
     */
    inviteButton: "邀請成員",
    inviteFormTitle: "邀請成員",
    inviteFormHint: "輸入姓名和電子郵件地址後將產生邀請連結。所屬部門、入職日期、權限預設可以稍後再設定。",
    inviteEmailLabel: "電子郵件地址",
    inviteEmailPlaceholder: "例如: yamada@example.com",
    inviteNameLabel: "姓名",
    inviteNamePlaceholder: "例如: 山田太郎",
    inviteDepartmentLabel: "所屬部門(選填)",
    inviteHireDateLabel: "入職日期(選填)",
    invitePresetsLabel: "權限預設(選填)",
    inviteWorkPolicyLabel: "工時制度(選填)",
    inviteWorkPolicyDefaultOption: (name: string) => `預設制度(${name})`,
    inviteWorkPolicyHint: "自到職日(未填寫則為今天)起依此制度計算。縮短工時的成員請在此選擇縮短工時的制度。",
    inviteCancel: "取消",
    inviteSubmit: "產生邀請連結",
    inviteSubmitting: "產生中…",

    inviteLinkTitle: "邀請連結已產生",
    inviteLinkTargetPrefix: "邀請對象: ",
    inviteLinkWarning: "此連結僅在目前顯示一次,關閉後將無法再次檢視(可以重新產生)。",
    inviteLinkLabel: "邀請連結",
    inviteLinkCopy: "複製連結",
    inviteLinkCopied: "已複製",
    inviteLinkCopyFailed: "複製失敗,請手動選擇並複製",
    inviteLinkExpiresLabel: "有效期限",
    inviteLinkDone: "關閉",

    inviteStatusBadge: {
      invited: "邀請中",
      invite_expired: "已過期",
    } as Record<string, string>,

    reissueButton: "重新產生",
    reissueConfirmTitle: "確定要重新產生邀請嗎",
    reissueConfirmMessage: "將產生新的邀請連結,之前的連結將失效。",

    revokeInviteButton: "撤銷",
    revokeInviteConfirmTitle: "確定要撤銷邀請嗎",
    revokeInviteConfirmMessage: "此邀請連結將失效。如有需要可以稍後重新產生。",

    /**
     * 管理員發放密碼重設(2026-08-23 Tier 0 第4部分新增)。與邀請共用同樣的一次性連結展示
     * (InviteLinkDialog 透過 variant="reset" 複用)。僅面向已接受邀請的成員。
     */
    passwordResetButton: "重設密碼",
    passwordResetBadge: "重設發放中",
    passwordResetRevokeButton: "撤銷",
    passwordResetRevokeConfirmTitle: "確定要撤銷密碼重設嗎",
    passwordResetRevokeConfirmMessage: "此重設連結將失效。如有需要可以稍後重新發放。",

    resetLinkTitle: "密碼重設連結已產生",
    resetLinkTargetPrefix: "對象: ",
    resetLinkWarning: "此連結僅在目前顯示一次,關閉後將無法再次檢視(可以重新發放)。",
    resetLinkLabel: "重設連結",
    resetLinkCopy: "複製連結",
    resetLinkCopied: "已複製",
    resetLinkCopyFailed: "複製失敗,請手動選擇並複製",
    resetLinkExpiresLabel: "有效期限",
    resetLinkDone: "關閉",

    /**
     * 離職處理(停用·重新啟用,2026-08-23 Tier 0 第4部分新增)。停用的影響較大,因此沿用
     * 現有危險操作的處理方式(與核准/駁回相同的 ConfirmDialog,平靜的語氣),在確認文案中
     * 明確影響(無法登入、目前工作階段全部失效、待處理的邀請/重設連結失效)。重新啟用屬於
     * 恢復性操作(不會新造成破壞),因此不設確認步驟。
     */
    deactivateButton: "停用",
    deactivateConfirmTitle: "確定要停用此成員嗎",
    deactivateConfirmMessage: "停用後將會發生以下情況。",
    deactivateConfirmImpactLogin: "將無法登入",
    deactivateConfirmImpactSession: "目前所有登入工作階段都將失效",
    deactivateConfirmImpactInviteReset: "待處理的邀請、密碼重設連結將失效",
    deactivateConfirmImpactRetention: "系統會記錄離職日期,保留期限屆滿後即可清除其個人資料",
    reactivateButton: "重新啟用",
    reactivating: "重新啟用中…",

    /**
     * 離職者個人資料的清除(2026-08-27 新增,docs/design/data-retention.md)。
     *
     * 文案方針: 不寫「刪除」。實際執行的是**匿名化**,考勤紀錄的行本身會因《勞動基準法》第109條
     * 的儲存義務而保留。若顯示「已刪除」而紀錄仍然存在,負責應對資訊公開請求的人員就會做出與
     * 事實不符的說明。
     */
    erasedBadge: "已清除",
    retentionTitle: "離職者個人資料的保留狀態",
    retentionRetiredOn: "離職日期",
    retentionErasable: "可以清除個人資料",
    retentionRemaining: (days: number, from: string) => `距離可清除還有${days}天(自${from}起)`,
    eraseButton: "清除個人資料",
    eraseConfirmTitle: "確定要清除該離職者的個人資料嗎",
    eraseConfirmMessage: "保留期限已屆滿,可以清除。執行後將會發生以下情況。",
    eraseConfirmImpactIdentity: "姓名將替換為「已刪除使用者」,電子郵件地址將替換為無法使用的地址",
    eraseConfirmImpactCredentials: "密碼、兩步驟驗證、通知設定、API金鑰、關聯資訊將被刪除",
    eraseConfirmImpactAttendance: "考勤紀錄(打卡、統計、封帳)因法定儲存義務而保留,僅刪除IP地址、裝置資訊、位置資訊",
    eraseConfirmImpactAudit: "稽核日誌的紀錄本身不會被改動(僅顯示的姓名會被匿名化)",
    eraseConfirmImpactIrreversible: "此操作無法撤銷,之後也無法重新啟用該成員",
    eraseConfirmLegalNote:
      "由於《勞動基準法》第109條規定的儲存義務,考勤紀錄本身不會被刪除。清除的是能夠識別「紀錄屬於誰」的資訊。",
    eraseConfirmPhraseLabel: (name: string) => `為確認操作,請輸入該成員的姓名「${name}」`,
    eraseConfirmPhraseMismatch: "姓名不一致",

    twoFactorBadge: "2FA",
    twoFactorResetButton: "重設2FA",
    twoFactorResetConfirmTitle: "確定要重設兩步驟驗證嗎",
    twoFactorResetConfirmMessage: "這是為同時丟失驗證器應用程式和復原碼的成員提供的補救操作。重設後將會發生以下情況。",
    twoFactorResetConfirmImpactLogin: "該成員下次起可僅憑密碼登入",
    twoFactorResetConfirmImpactNotify: "系統會通知該成員本人",
    twoFactorResetConfirmImpactAudit: "此操作會記錄在稽核日誌中",
    twoFactorResetConfirmImpactReenroll: "兩步驟驗證需由本人重新設定",

    /**
     * 成員個人勞動時間制度分配(2026-08-23 Tier 0 第4部分新增)。GET/POST
     * /members/:id/work-policy(tenant_settings.flex.manage,僅限租用戶全域範圍)。沒有此權限時
     * GET 本身也會返回 403,因此整個區塊都不顯示(參見 MembersView 的判斷)。
     */
    workPolicyTitle: "勞動時間制度",
    workPolicyHint: "用於分配依哪個工時制度(所定工作時間)計算月度統計和特休。變更以新增分配的形式進行,過去的統計不會改變。",
    workPolicyCurrentLabel: "目前勞動時間制度",
    workPolicyCurrentEffectiveFrom: "此分配的生效日期",
    workPolicyNoneYet: "尚未分配",
    workPolicyHistoryTitle: "分配歷史",
    workPolicyHistoryEmpty: "暫無歷史紀錄",
    workPolicyHistoryColumnEffectiveFrom: "生效日期",
    workPolicyHistoryColumnPolicy: "制度",
    workPolicyHistoryColumnKind: "類型・所定",
    workPolicyFormTitle: "變更制度",
    workPolicyPolicyLabel: "工時制度",
    workPolicyOption: (name: string, summary: string) => `${name}(${summary})`,
    /** 制度の種類と1日の所定の要約(選択欄の下の補足・現在値・履歴)。 */
    workPolicySummary: (kind: string, standard: string) => `${kind}・${standard}`,
    workPolicyStandardPerDay: (hm: string) => `每天${hm}`,
    workPolicyNoAssignable: "沒有可分配的制度。請在出勤規則中新增制度。",
    workPolicyManageLink: "新增・編輯工時制度 →",
    workPolicyEffectiveFromLabel: "生效日期",
    workPolicyEffectiveFromHint: "此變更僅影響指定日期以後的計算,過去的統計不會改變。",
    workPolicySubmit: "以此內容變更",
    workPolicySubmitting: "變更中…",
    workPolicySubmitSuccess: "勞動時間制度已變更。",
    workPolicyNoPermission: "沒有權限變更此設定",

    departmentChangeLabel: "變更所屬部門",
    departmentChangeSaved: "所屬部門已變更",

    hireDateLabel: "設定入職日期",
    hireDateSave: "儲存",
    hireDateSaving: "儲存中…",
    hireDateSaved: "入職日期已儲存",
    hireDateUnset: "未設定",
    hireDateWarning: "由於未設定入職日期,無法計算帶薪年假的法定授予天數",

    leaveGrantClassTitle: "年假授予區分",
    leaveGrantClassHint:
      "僅當每週約定工作時間不足30小時且每週約定工作日數在4日以下時,才選擇比例授予(每週4日以下)(日本勞基法39條3項)。",
    leaveGrantClassLabel: "選擇年假授予區分",
    leaveGrantClassOption: {
      full: "普通(每週5日以上)",
      days4: "每週4日",
      days3: "每週3日",
      days2: "每週2日",
      days1: "每週1日",
    },
    leaveGrantClassSave: "儲存區分",
    leaveGrantClassSaving: "儲存中…",
    leaveGrantClassSaved: "已儲存年假授予區分",
    leaveGrantClassNote: "變更將從之後的自動授予·授予預告開始生效(已授予的天數不會改變)。",

    presetAssignTitle: "要分配的預設",
    presetAssignHint: "更改勾選後,下方「可執行的操作」會立即反映變化。儲存之前實際分配不會改變。",
    presetAssignSave: "儲存分配",
    presetAssignSaving: "儲存中…",
    presetAssignSaved: "權限預設的分配已儲存",
    presetAssignUnsaved: "存在未儲存的更改",
    noPresetsAvailable: "沒有可用的權限預設",

    effectiveTitle: "此成員可執行的操作",
    effectiveHint: "所有人始終可以進行本人的打卡、發起申請、檢視自己的紀錄(全員共通,不可更改)。",
    effectiveEmpty: "除上述基本操作外,未分配其他權限。",
    effectiveScopeLabel: "適用範圍",
    effectiveSourceLabel: "來源",
    effectiveViaImplication: "。這是其他權限自動包含的檢視權限",
    /** 被拒絕(deny)項目的標籤與註解(2026-08-24 新增)。 */
    effectiveDeniedChip: "拒絕",
    effectiveDeniedBy: (names: string) => `由於「${names}」的拒絕設定,此權限無法行使`,

    errors: {
      invalid_body: "請確認輸入內容",
      invalid_email: "請確認電子郵件地址格式",
      invalid_name: "姓名請輸入1〜200個字元",
      invalid_department_id: "找不到指定的部門",
      invalid_hire_date: "入職日期請使用YYYY-MM-DD格式輸入",
      invalid_leave_grant_class: "年假授予區分的指定不正確",
      email_already_exists: "該電子郵件地址已被註冊",
      not_found: "找不到目標成員",
      invalid_preset_id: "找不到指定的權限預設",
      self_escalation: "不能為自己新增新的權限",
      self_demotion: "不能取消自己的權限管理權限",
      last_admin: "不能取消最後一位擁有權限管理權限的成員的該權限",
      /** 邀請的重新發放與撤銷。 */
      already_active: "該成員已完成正式註冊(無需重新發放邀請)",
      already_accepted: "此邀請已被接受",
      already_revoked: "此邀請已被撤銷",
      /** 對已離職處理成員重新發放邀請、發放密碼重設(2026-08-23 Tier 0 第4部分新增)。 */
      member_inactive: "該成員已辦理離職處理。請先重新啟用後再進行此操作",
      /** 管理員發放密碼重設(2026-08-23 Tier 0 第4部分新增)。無法對尚未接受邀請的成員發放。 */
      not_active: "該成員尚未接受邀請,請改用重新發放邀請",
      /** 撤銷密碼重設(2026-08-23 Tier 0 第4部分新增)。 */
      password_reset_already_used: "此重設已被使用",
      password_reset_already_revoked: "此重設已被撤銷",
      /** 離職處理(停用·重新啟用,2026-08-23 Tier 0 第4部分新增)。 */
      cannot_deactivate_self: "無法停用自己的帳戶",
      already_inactive: "該成員已被停用",
      /** 重新啟用(2026-08-23 Tier 0 第4部分新增)。與邀請的 already_active 文案區分開。 */
      member_already_active: "該成員已處於啟用狀態",
      /** 成員個人勞動時間制度分配(2026-08-23 Tier 0 第4部分新增)。 */
      invalid_work_system_kind: "請選擇制度",
      invalid_effective_from: "請確認生效日期",
      effective_from_in_past: "生效日期只能指定為今天或以後(否則會改變過去的統計結果)",
      assignment_already_exists: "該生效日期已存在分配,請指定其他日期",
      invalid_work_policy_id: "找不到指定的制度",
      work_policy_archived: "已歸檔的制度無法分配",
      work_policy_not_effective_yet: "該日期尚無此制度的版本,請指定制度生效日期當天或之後的日期",
      /** 每日基準應出勤時間(用於年假折算,v0.7 第4階段,2026-08-24 新增)。 */
      invalid_standard_day_minutes: "每日基準應出勤時間請輸入1〜1440之間的整數分鐘",
      version_already_exists: "該生效日期已存在相同設定的版本,請指定其他日期",
      not_enabled: "該成員未開啟兩步驟驗證",
      /** 離職者個人資料的清除(2026-08-27 新增,POST /members/:id/erase)。 */
      not_deactivated: "無法清除在職成員的個人資料,請先進行離職處理",
      retention_period_active: "保留期限尚未屆滿,無法清除(《勞動基準法》第109條的儲存義務)",
      already_erased: "該成員的個人資料已清除",
      deactivated_at_unknown: "未紀錄離職日期,無法清除。請先重新啟用該成員,然後重新進行離職處理",
      cannot_erase_self: "無法清除自己的個人資料",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  presets: {
    title: "權限預設管理",
    tagline: "建立和編輯組合了權限開關與適用範圍的預設。為一人分配多個預設時將合併生效。",
    noPermission: "沒有權限使用此頁面",
    loadFailed: "權限預設取得失敗,請重試",
    empty: "暫無權限預設",

    columnName: "名稱",
    columnDescription: "說明",
    columnType: "型別",
    columnAssignedCount: "已分配人數",
    columnActions: "操作",
    systemBadge: "標準",
    customBadge: "自定義",
    noDescription: "(無說明)",
    assignedCountUnit: "人",

    addNew: "新建預設",
    edit: "編輯",
    duplicate: "複製後編輯",
    delete: "刪除",

    formTitleCreate: "新建權限預設",
    formTitleEdit: "編輯權限預設",
    formReadonlyNote: "標準預設無法編輯。如需更改內容,請使用「複製後編輯」建立新的預設。",
    /** 「複製後編輯」時的初始名稱(附加在原名稱之後)。 */
    duplicateNameSuffix: (name: string) => `${name}副本`,
    nameLabel: "名稱",
    namePlaceholder: "例如: 財務經理",
    descriptionLabel: "說明(選填)",
    descriptionPlaceholder: "寫明此預設的用途,便於選擇時不會混淆",
    permissionsLabel: "權限",
    scopeLabel: "適用範圍",
    dangerousBadge: "重要",
    dangerousNote: "此權限影響較大,請謹慎確認授予對象。",
    impliesViewPrefix: "此權限包含以下檢視權限: ",
    /** 拒絕(deny)區塊(2026-08-24 新增)。參見 docs/design/permission-catalog.md。 */
    deniesSectionTitle: "拒絕(deny)設定",
    deniesCount: (n: number) => `已拒絕 ${n} 項`,
    deniesWarning: "拒絕優先於所有授予。即使其他預設已授予該權限也會失效",
    deniesHint:
      "這是用於表示「絕對不讓此人執行」的設定。通常只要不授予即可。本人的打卡、本人的申請、本人紀錄的檢視無法被拒絕。",
    save: "儲存",
    saving: "儲存中…",
    cancel: "取消",
    close: "關閉",

    confirmDeleteTitle: "確定要刪除此權限預設嗎",
    confirmDeleteMessage: "刪除後無法恢復。若已分配給成員,則無法刪除。",
    confirmDeleteLabel: "刪除",

    errors: {
      invalid_name: "名稱請輸入1〜100個字元",
      invalid_description: "說明請控制在500字以內",
      invalid_grants: "請確認所選權限的內容",
      invalid_denies: "請確認選為拒絕的權限內容",
      last_admin: "儲存此更改後,租用戶內將沒有人能夠管理權限預設",
      invalid_body: "請確認輸入內容",
      not_found: "找不到目標權限預設",
      system_preset: "標準預設無法編輯或刪除",
      preset_in_use: "此預設目前已分配給成員,無法刪除",
      default: "處理失敗,請重試",
    },
  },

  /** 帶薪年假首頁(/leave)。 */
  leave: {
    title: "帶薪年假",
    tagline: "檢視餘額、申請休假、簽核申請。",
    loadFailed: "帶薪年假資訊取得失敗,請重試",

    balanceTitle: "餘額",
    annualLabel: "年次帶薪年假",
    stockedLabel: "結轉休假",
    remainingLabel: "剩餘",
    grantedTotalLabel: "授予合計",
    usedTotalLabel: "已使用",
    noGrants: "沒有已授予的帶薪年假",
    grantBreakdownToggle: "按授予明細檢視",
    grantColumnGrantedOn: "授予日期",
    grantColumnDays: "天數",
    grantColumnExpiresOn: "期限",
    grantColumnRemaining: "剩餘",
    grantExpired: "已過時效",
    expiringSoonTitle: "即將失效",
    expiringSoonNote: "有在60天內到期的授予額度,建議儘早使用。",

    mandatoryTitle: "年5天強制使用義務的完成情況",
    mandatoryNone: "沒有符合條件的授予(年10天以上)",
    mandatoryTakenLabel: "已使用",
    mandatoryRequiredLabel: "要求",
    mandatoryDeadlineLabel: "期限",
    mandatoryShortagePrefix: "還差",
    mandatoryShortageSuffix: "天",
    mandatorySatisfied: "已達標",
    mandatoryExpiredSummary: (n: number) => `未達標(已逾期)${n} 項`,
    mandatoryExpiredLabel: "已逾期",
    mandatoryUpcomingLabel: "下一期間",

    requestFormTitle: "申請休假",
    dateLabel: "目標日期",
    unitLabel: "單位",
    unitFullDay: "全天",
    unitHalfDayAm: "上午半天",
    unitHalfDayPm: "下午半天",
    unitHourly: "按小時",
    minutesLabel: "時長(分鐘)",
    minutesPlaceholder: "例如: 120",
    leaveTypeLabel: "使用的額度",
    leaveTypeAnnual: "年次帶薪年假",
    leaveTypeStocked: "結轉休假",
    reasonLabel: "理由",
    reasonPlaceholder: "請輸入休假理由",
    hourlyQuotaPrefix: "按小時計的帶薪年假每年最多使用5天(目前 ",
    hourlyQuotaSeparator: " / 上限 ",
    hourlyQuotaSuffix: ")",
    submit: "送出申請",
    submitting: "送出中…",
    submitted: "申請已送出。簽核通過後將反映到考勤紀錄中。",
    targetMonthClosedNote: "本月已確定結算。需要解除結算權限才能核准。",

    requestsTitle: "申請清單",
    requestsEmpty: "暫無申請紀錄",

    queueSectionTitle: "待簽核的休假申請",
    queueSectionTagline: "在您的簽核權限範圍內,待簽核的休假申請。",
    queueEmpty: "暫無待簽核的申請",
    columnDate: "目標日期",
    columnUnit: "單位",
    columnLeaveType: "額度",
    columnReason: "理由",
    columnDecision: "簽核",

    statusLabel: {
      pending: "簽核中",
      /** 僅在兩級簽核時出現的中間狀態,此時尚未反映到考勤紀錄。 */
      approved_step1: "已一級核准(待二級)",
      approved: "已核准",
      rejected: "已駁回",
      withdrawn: "已撤回",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    unitLabelShort: {
      full_day: "全天",
      half_day_am: "上午半天",
      half_day_pm: "下午半天",
      hourly: "按小時",
    } satisfies Record<"full_day" | "half_day_am" | "half_day_pm" | "hourly", string>,

    /** 時間單位申請清單中,附加在 unitLabelShort.hourly 之後的補充,如「(120分鐘)」。 */
    hourlyMinutesSuffix: (minutes: number) => `(${minutes}分鐘)`,

    leaveTypeLabelShort: {
      annual: "年次帶薪年假",
      stocked: "結轉休假",
    } satisfies Record<"annual" | "stocked", string>,

    approve: "核准",
    reject: "駁回",
    withdraw: "撤回",
    decidedBySelf: "本人",
    decisionNoteLabel: "簽核備註",
    decisionNotePlaceholder: "備註(選填)",

    confirmApproveTitle: "確定要核准此申請嗎",
    confirmApproveMessage: "核准後將反映到考勤紀錄,月度統計也會隨之變化。此操作將被記錄到稽核日誌中。",
    confirmApproveSelfNote: "將被記錄為自行核准。",
    confirmRejectTitle: "確定要駁回此申請嗎",
    confirmRejectMessage: "駁回後申請將被記錄為已駁回狀態,不會反映到考勤紀錄中。",
    confirmWithdrawTitle: "確定要撤回此申請嗎",
    confirmWithdrawMessage: "撤回後將解除簽核中狀態。如有需要可重新送出申請。",

    close: "關閉",
    cancel: "取消",

    errors: {
      invalid_leave_date: "請確認目標日期",
      invalid_reason: "請輸入1〜500字的理由",
      invalid_unit: "請確認單位",
      invalid_leave_type: "請確認使用的額度",
      invalid_minutes: "請正確輸入時長(分鐘)",
      invalid_body: "請確認輸入內容",
      hourly_leave_disabled: "此租用戶尚未啟用按小時計休假",
      half_day_leave_disabled: "此租用戶尚未啟用半天休假",
      duplicate_request: "同一天、同一單位的申請已存在",
      exceeds_daily_hours: "超過每日的規定工作時間",
      insufficient_balance: "剩餘天數不足",
      hourly_limit_exceeded: "超過按小時計休假的年度上限",
      not_pending: "此申請已被處理",
      not_found: "找不到目標申請",
      forbidden: "沒有執行此操作的權限",
      /** 409。兩級簽核中,完成一級簽核的本人試圖進行二級簽核。 */
      same_approver_as_step1: "完成一級簽核的本人無法進行二級簽核,請交由其他簽核人處理",
      month_closed_requires_unlock: "本月已確定結算。需要解除結算權限才能核准",
      default: "處理失敗,請重試",
    },
  },

  /** 帶薪年假的制度設定(/settings/leave)。 */
  settingsLeave: {
    title: "帶薪年假設定",
    tagline: "設定授予方式、按小時計年假、結轉休假等租用戶全域設定。",
    noPermission: "沒有權限更改此設定",
    loadFailed: "設定取得失敗,請重試",

    grantMethodSectionTitle: "授予方式",
    grantMethodStatutory: "法定(按入職日期)",
    grantMethodFixedDate: "基準日方式(全公司統一)",
    fixedDateLabel: "基準日(月-日)",
    fixedDatePlaceholder: "例如: 04-01",

    hourlySectionTitle: "按小時計年假",
    hourlyEnabledLabel: "啟用按小時計年假",
    hourlyMaxDaysLabel: "年度上限天數(1〜5)",

    halfDaySectionTitle: "半天休假",
    halfDayEnabledLabel: "啟用半天休假",

    stockSectionTitle: "失效額度的結轉",
    stockEnabledLabel: "啟用失效額度結轉",
    stockHelp: "將因時效而失效的年次帶薪年假結轉到單獨額度的制度。這不是法定製度,而是公司自行設立的制度。",
    stockMaxDaysLabel: "結轉上限天數",
    stockExpiresMonthsLabel: "結轉額度的有效期(月數,留空則無期限)",

    save: "儲存",
    saving: "儲存中…",
    saveSuccess: "設定已儲存。",
    saveNote: "此設定適用於整個租用戶,更改將被記錄到稽核日誌中。",

    adminSectionTitle: "授予與結轉管理",
    adminSectionTagline: "選擇目標成員後執行,此操作將被記錄到稽核日誌中。",
    targetUserLabel: "目標成員",
    targetUserPlaceholder: "請選擇成員",

    autoGrantTitle: "執行法定授予",
    autoGrantDesc: "根據入職日期計算並建立尚未授予的部分,已授予的部分不會重複建立。",
    autoGrantRun: "執行法定授予",
    autoGrantRunning: "執行中…",
    autoGrantResultCreatedPrefix: "",
    autoGrantResultCreatedSuffix: "件已授予",
    autoGrantResultSkippedPrefix: "(因已授予等原因跳過 ",
    autoGrantResultSkippedSuffix: "件)",
    autoGrantEmpty: "沒有新的可授予額度",

    manualGrantTitle: "手動授予",
    manualGrantDesc: "以任意天數、期限授予帶薪年假。",
    grantedOnLabel: "授予日期",
    daysLabel: "天數",
    expiresOnLabel: "期限(留空則使用預設值: 年次帶薪年假為授予日+2年,結轉休假為無期限)",
    leaveTypeLabel: "型別",
    leaveTypeAnnual: "年次帶薪年假",
    leaveTypeStocked: "結轉休假",
    noteLabel: "備註(選填)",
    manualGrantSubmit: "授予",
    manualGrantSubmitting: "處理中…",
    manualGrantSuccess: "已授予。",

    convertTitle: "失效額度結轉",
    convertDesc: "將因時效失效的年次帶薪年假未使用部分結轉為結轉休假。",
    convertRun: "執行結轉",
    convertRunning: "執行中…",
    convertResultTitle: "結轉結果",
    convertResultConvertedPrefix: "結轉天數: ",
    convertResultConvertedSuffix: "天",
    convertResultTruncatedPrefix: "(超過上限已截斷: ",
    convertResultTruncatedSuffix: "天)",
    convertResultEmpty: "沒有可結轉的對象",

    errors: {
      invalid_grant_method: "請確認授予方式",
      invalid_fixed_date_mm_dd: "基準日請使用MM-DD格式輸入",
      invalid_hourly_leave_enabled: "請確認輸入內容",
      invalid_half_day_leave_enabled: "請確認輸入內容",
      invalid_stock_conversion_enabled: "請確認輸入內容",
      invalid_hourly_leave_max_days: "年度上限天數請輸入1〜5範圍內的數值",
      invalid_stock_max_days: "請正確輸入結轉上限天數",
      invalid_stock_expires_months: "請正確輸入結轉額度的有效期(月數)",
      invalid_body: "請確認輸入內容",
      invalid_user_id: "請選擇目標成員",
      invalid_granted_on: "請確認授予日期",
      invalid_days: "請正確輸入天數",
      invalid_expires_on: "請確認期限",
      invalid_leave_type: "請確認型別",
      invalid_note: "請確認備註",
      not_found: "找不到目標對象",
      hire_date_not_set: "目標成員尚未設定入職日期",
      leave_settings_not_configured: "請先儲存帶薪年假的制度設定",
      stock_conversion_disabled: "結轉設定尚未啟用",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 年假授予預告(/settings/leave 的「授予預告」區塊,v0.7 第4階段,2026-08-24 新增)。
   * docs/requirements.md §11「預告 → 管理員簽核 → 通知本人」。系統不會自行確定授予,
   * 出勤率(《勞動基準法》第39條第1款的八成要求)僅作為參考值呈現。
   */
  leaveGrantProposals: {
    sectionTitle: "授予預告",
    sectionDesc:
      "這是每日自動計算產生的授予「預告」。僅停留在預告狀態不會實際授予,需要負責人確認內容並簽核後才會生效。出勤率僅供參考,八成要求的最終判斷請由人來做出。",
    loadFailed: "取得授予預告失敗,請重試",
    empty: "目前沒有授予預告",

    columnMember: "成員",
    columnLeaveType: "休假型別",
    columnGrantedOn: "基準日",
    columnDays: "天數",
    columnAttendanceRate: "出勤率(參考值)",
    columnActions: "操作",

    leaveTypeAnnual: "帶薪年假",
    leaveTypeStocked: "結轉休假",

    basisShift: "按排班計算",
    basisCalendarEstimate: "按日曆推算",
    /** 應出勤日為0、無法計算出勤率時顯示。表示「未知」,而非0%。 */
    rateUnknown: "—",
    rateBelowThreshold: "可能不足八成 — 請確認",
    proportionalChip: (weekDaysLabel: string) => `比例授予(${weekDaysLabel})`,

    approve: "核准",
    reject: "駁回",
    confirmApproveTitle: "要核准該預告嗎",
    confirmApproveMessage: "核准後將按此內容授予帶薪年假。授予日期仍為預告中的基準日。",
    confirmRejectTitle: "要駁回該預告嗎",
    confirmRejectMessage: "駁回後不會進行授予。填寫理由有助於日後追溯經過。",
    noteLabel: "駁回理由(可選)",
    notePlaceholder: "例:出勤率不足八成",
    approveSuccess: "已核准並完成授予。",
    rejectSuccess: "已駁回。",

    historyTitle: "已簽核的預告",
    historyEmpty: "沒有已簽核的預告",
    columnStatus: "狀態",
    columnDecidedAt: "簽核時間",
    columnDecisionNote: "駁回理由",
    statusLabel: {
      proposed: "未簽核",
      approved: "已核准",
      rejected: "已駁回",
      superseded: "已重建",
    },

    errors: {
      not_found: "找不到目標預告",
      not_proposed: "該預告已被簽核,請重新整理頁面確認最新狀態",
      grant_already_exists: "相同基準日的授予已存在,請確認是否與手動授予重複",
      invalid_status: "請確認篩選條件",
      invalid_body: "請確認輸入內容",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /**
   * 公司內部規定的編輯頁面(/settings/help)。將3項撰寫原則直接展示在頁面上。
   */
  settingsHelp: {
    title: "公司內部規定",
    tagline: "可以在內建說明(法規、KIZAMI規格)的基礎上追加自有公司的規定。",
    noPermission: "沒有權限更改此設定",
    loadFailed: "資訊取得失敗,請重試",

    guidelinesTitle: "撰寫指南",
    guideline1:
      "不要照抄法規內容 — 法規部分會自動顯示。若重複填寫,當法規修訂時只有KIZAMI一側會更新,此處會殘留過時內容,造成矛盾",
    guideline2: "只寫公司自行決定的內容 — 例如期限、負責視窗、例外情況的處理方式",
    guideline3: "建議以引用工作規則相應條款的形式撰寫(例如:「詳情請見工作規則第○條」)",

    workRulesSectionTitle: "工作規則連結",
    workRulesDesc: "設定工作規則(PDF等)的URL後,說明頁面將顯示「檢視工作規則」連結。",
    workRulesUrlLabel: "URL",
    workRulesUrlPlaceholder: "https://example.com/work-rules.pdf",
    workRulesSave: "儲存",
    workRulesSaving: "儲存中…",
    workRulesSaveSuccess: "工作規則連結已儲存。",

    listTitle: "說明條目",
    listEmployeeGroup: "面向員工",
    listAdminGroup: "面向勞務負責人",
    originLaw: "法規",
    originProduct: "KIZAMI 規格",
    hasOverrideBadge: "已追加",
    selectPrompt: "請從左側清單中選擇說明條目。",

    referenceTitle: "內建說明",
    editorTitle: "公司規定",
    editorPlaceholderNote: "淺色文字為填寫示例,如需直接使用請複製。",
    bodyLabel: "正文(Markdown)",
    save: "儲存",
    saving: "儲存中…",
    saveSuccess: "公司內部規定已儲存。",
    deleteConfirmTitle: "刪除公司內部規定",
    deleteConfirmMessage: "將刪除此條目的公司規定內容,恢復為僅顯示內建說明的狀態。",
    delete: "刪除",
    deleting: "刪除中…",
    deleteSuccess: "公司內部規定已刪除。",
    empty: "正文為空,儲存後將視為刪除。",

    errors: {
      invalid_help_key: "不存在的說明條目",
      invalid_body_md: "請確認正文內容",
      invalid_url: "URL請使用http(s)格式輸入",
      invalid_body: "請確認輸入內容",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
    searchLabel: "搜尋條目",
    searchPlaceholder: "搜尋條目",
    searchNoResults: "沒有符合的條目",
  },

  /**
   * 個人資料相關的範本頁面(/settings/privacy)。按要求,頁面上需始終顯示
   * 這只是範本、並非法律意見的說明。
   */
  settingsPrivacy: {
    title: "個人資料",
    tagline: "根據目前設定產生面向員工的隱私權聲明與公司內部使用條款範本。",
    noPermission: "沒有權限檢視此設定",
    loadFailed: "資訊取得失敗,請重試",

    disclaimer:
      "此文字為KIZAMI提供的範本。請務必根據公司實際情況進行審閱,並在必要時諮詢專業人士(社會保險勞務士、律師等)。這不構成法律意見。",

    generatedFromTitle: "產生此範本所依據的設定",
    generatedFromGpsOn: "GPS: 啟用",
    generatedFromGpsOff: "GPS: 停用",
    generatedFromRetention: (days: number) => `位置資訊保留期限: ${days}天`,
    generatedFromRetentionSame: "位置資訊保留期限: 與打卡紀錄相同",
    generatedFromNote: "GPS的啟用/停用及保留期限會根據「設定 > 租用戶設定檔」等租用戶設定的變更,在下次顯示時更新。",

    /**
     * 離職者資料的保留期限(2026-08-27 新增,docs/design/data-retention.md)。
     * 放在此頁面的理由: 年數會原樣出現在範本的「離職後的處理」一節中,因此邊看文案邊決定更合適。
     * 實際的清除操作由成員管理頁面以另外的權限執行。
     */
    retentionTitle: "離職者個人資料的保留期限",
    retentionHint: "自離職日期起,在此期限屆滿前無法清除離職者的個人資料。期限屆滿後,即可從成員管理頁面清除。",
    retentionLabel: "保留期限",
    retentionOption: (years: number) => (years === 5 ? "5年(《勞動基準法》第109條的原則)" : `${years}年(修正法的過渡措施)`),
    retentionLegalNote:
      "《勞動基準法》第109條原則上規定紀錄儲存5年,但根據2020年(令和2年)修正的過渡措施,目前3年即可。過渡措施終將結束,因此預設設為5年。",
    retentionExecutionNote: "實際的清除操作由持有專用權限(可清除離職者的個人資料)的負責人在「設定 > 成員」中執行。",
    retentionSaved: "已儲存保留期限。",
    retentionSaveFailed: "保留期限儲存失敗,請重試",

    noticeSectionTitle: "面向員工的隱私權聲明",
    noticeSectionDesc: "彙總採集項目、使用目的、儲存期限、資訊公開等請求管道的範本,可用於向員工進行公示。",
    termsSectionTitle: "公司內部使用條款(打卡相關規定)",
    termsSectionDesc: "彙總準確打卡義務、禁止代打卡、修正申請流程等內容的範本。",

    copy: "複製",
    copied: "已複製",
    copyFailed: "複製失敗,請手動選擇並複製",
    download: "下載Markdown",
    registerAsCompanyRule: "登記為公司內部規定",
    registering: "登記中…",
    registerSuccess: "已登記為公司內部規定。可在「設定 > 公司內部規定」中編輯。",
    registerFailed: "登記失敗,請重試",
    viewPreview: "預覽",
    viewSource: "Markdown(原文)",
  },

  /**
   * API金鑰(公開打卡介面)的管理頁面(/settings/api-keys)。
   * 無需權限(自己的金鑰任何人都可以簽發、撤銷)。
   */
  settingsSecurity: {
    /** ログイン中の本人によるパスワード変更(POST /auth/password/change、2026-10-04 追加)。 */
    passwordChange: {
      title: "修改密碼",
      description: "確認目前密碼後設定新密碼。修改後,除目前裝置外的所有裝置都會登出。",
      currentLabel: "目前密碼",
      newLabel: "新密碼(至少12個字元)",
      confirmLabel: "新密碼(確認)",
      submit: "修改密碼",
      submitting: "正在修改…",
      mismatch: "兩次輸入的新密碼不一致",
      tooShort: "新密碼至少需要12個字元",
      success: "密碼已修改。其他裝置已登出。",
      errors: {
        invalid_body: "請檢查輸入內容",
        invalid_current_password: "目前密碼不正確",
        invalid_new_password: "新密碼至少需要12個字元",
        same_password: "新密碼不能與目前密碼相同,請輸入其他密碼",
        no_password_credential: "此帳號未設定密碼(透過 SSO 登入的帳號)",
        rate_limited: "嘗試次數過多,請稍後再試",
        default: "無法修改密碼,請重試",
      },
    },

    title: "登入與安全",
    tagline: "修改密碼,並透過兩步驟驗證(驗證器應用程式中顯示的6位驗證碼)保護你的登入。",
    loadFailed: "取得資訊失敗,請重試",

    unavailableTitle: "目前環境無法使用兩步驟驗證",
    unavailableDescription:
      "由於維運人員未設定加密金鑰(KIZAMI_ENCRYPTION_KEY),兩步驟驗證無法使用。因為無法以加密方式儲存身分驗證器的金鑰。如需使用,請與系統維運負責人聯絡。",

    statusTitle: "兩步驟驗證狀態",
    statusEnabled: "已開啟",
    statusDisabled: "未開啟",
    enabledAtLabel: "開啟時間",
    recoveryRemainingLabel: "剩餘復原碼",
    recoveryRemainingValue: (count: number) => `${count} 個`,
    recoveryRemainingWarning: "復原碼所剩不多,請重新產生並儲存在安全的地方。",

    enableTitle: "開啟兩步驟驗證",
    enableDescription: "開啟後,下次登入起除密碼外還需要輸入驗證器應用程式的6位驗證碼。",
    enableStart: "開啟兩步驟驗證",
    enableStarting: "正在準備…",

    setupTitle: "在驗證器應用程式中註冊",
    setupManualHint:
      "KIZAMI 不顯示QR 碼。請在驗證器應用程式(Google Authenticator、1Password、Authy 等)中選擇「手動輸入」或「輸入設定金鑰」,貼上下面的金鑰完成註冊。",
    setupSecretLabel: "設定金鑰(用於手動輸入)",
    setupUriLabel: "otpauth URI(支援的驗證器應用程式也可直接使用此字串註冊)",
    setupCodeLabel: "驗證器應用程式中顯示的6位驗證碼",
    setupCodePlaceholder: "123456",
    setupSubmit: "開啟",
    setupSubmitting: "正在開啟…",
    setupCancel: "取消",

    recoveryTitle: "復原碼",
    recoveryWarning: "關閉此介面後將不再顯示。請列印,或儲存到密碼管理工具等安全的地方。",
    recoveryDescription: "當無法使用驗證器應用程式時,可代替驗證碼輸入並登入的一次性程式碼(每個只能使用一次)。",
    recoveryCopyAll: "全部複製",
    recoveryDone: "已儲存,關閉",

    copy: "複製",
    copied: "已複製",
    copyFailed: "複製失敗,請手動選擇後複製",

    verifyTitle: "身分確認",
    verifyDescription: "為防止工作階段被劫持後被人操作,需要同時輸入目前密碼和驗證器應用程式的6位驗證碼。",
    passwordLabel: "目前密碼",
    codeLabel: "驗證器應用程式的6位驗證碼",

    regenerateTitle: "重新產生復原碼",
    regenerateDescription: "將新簽發10個。目前持有的復原碼將全部失效。",
    regenerateSubmit: "重新產生復原碼",
    regenerateSubmitting: "正在重新產生…",

    disableTitle: "關閉兩步驟驗證",
    disableDescription: "關閉後,登入將僅需密碼。",
    disableSubmit: "關閉兩步驟驗證",
    disableSubmitting: "正在關閉…",
    disableConfirmTitle: "確定要關閉兩步驟驗證嗎",
    disableConfirmMessage: "關閉後將會發生以下情況。",
    disableConfirmImpactPassword: "登入將僅需密碼",
    disableConfirmImpactRecovery: "目前持有的復原碼將全部失效",
    disableConfirmImpactReenable: "若要再次開啟,需要從在驗證器應用程式中註冊開始重新設定",
    disabledNotice: "已關閉兩步驟驗證。",

    errors: {
      invalid_body: "請檢查輸入內容",
      invalid_code: "驗證碼不正確。請確認驗證器應用程式的顯示後重試",
      invalid_password: "密碼不正確",
      setup_required: "註冊尚未完成,請從「開啟兩步驟驗證」重新開始",
      already_enabled: "兩步驟驗證已經開啟",
      not_enabled: "兩步驟驗證尚未開啟",
      rate_limited: "嘗試次數過多,請稍後再試",
      encryption_unavailable: "目前無法執行此操作,請聯絡管理員",
      default: "處理失敗,請重試",
    },
  },

  /** 言語と表示の設定(/settings/display、2026-10-05 追加。ヘッダーにあった言語・テーマの切り替えの移設先)。 */
  settingsDisplay: {
    title: "語言與顯示",
    tagline: "選擇介面的語言和配色。選擇後立即生效。",
    languageTitle: "語言",
    languageDesc: "介面的顯示語言。登入前的頁面也會以此處選擇的語言顯示。",
    themeTitle: "配色",
    themeDesc: "固定為淺色或深色,或跟隨裝置的設定。",
    storageNote: "此設定儲存在目前的瀏覽器中。在其他裝置或瀏覽器上,請分別重新選擇。",
  },

  settingsApiKeys: {
    title: "API金鑰",
    tagline: "用於IC卡讀卡器、Slack bot、MCP伺服器等無法持有工作階段Cookie的外部用戶端進行打卡的金鑰。",
    loadFailed: "資訊取得失敗,請重試",

    listTitle: "已簽發的金鑰",
    empty: "暫無已簽發的API金鑰。",
    columnName: "名稱",
    columnScopes: "授權範圍",
    columnCreated: "建立日期",
    columnLastUsed: "最後使用",
    columnExpires: "有效期限",
    columnStatus: "狀態",
    columnActions: "操作",
    neverUsed: "未使用",
    noExpiry: "無期限",
    statusActive: "有效",
    statusRevoked: "已撤銷",
    statusExpired: "已過期",
    revoke: "撤銷",
    revoking: "撤銷中…",

    revokeConfirmTitle: "撤銷API金鑰",
    revokeConfirmMessage: "使用此金鑰的整合(IC卡讀卡器、Slack bot、MCP伺服器等)將無法繼續工作。此操作無法撤銷。",

    scopePunch: "打卡(punch) — 建立和檢視自己的打卡紀錄",
    scopeRead: "檢視(read) — 僅檢視自己的考勤紀錄",

    createTitle: "簽發新金鑰",
    nameLabel: "名稱(便於識別用途)",
    namePlaceholder: "例如: 2樓入口IC卡讀卡器",
    scopesLabel: "授權範圍(可多選)",
    expiresLabel: "有效期限(選填)",
    expiresHint: "留空則表示無期限。",
    issue: "簽發",
    issuing: "簽發中…",

    createdTitle: "金鑰已簽發",
    createdWarning: "此值不會再次顯示,請妥善保管。",
    createdTokenLabel: "API金鑰",
    copy: "複製",
    copied: "已複製",
    copyFailed: "複製失敗,請手動選擇並複製",
    createdDone: "關閉",

    usageExampleTitle: "使用示例",
    usageExampleDesc: "請將簽發的金鑰作為Bearer權杖新增到Authorization請求頭中發起請求。",
    usageExampleCurlComment: "# 上班打卡",

    errors: {
      invalid_name: "名稱請輸入1〜100個字元",
      invalid_scopes: "請至少選擇一個授權範圍",
      invalid_expires_at: "請確認有效期限的格式",
      not_found: "找不到目標金鑰",
      already_revoked: "此金鑰已被撤銷",
      forbidden: "沒有執行此操作的權限",
      default: "處理失敗,請重試",
    },
  },

  /** 稽核日誌的唯讀檢視頁面(/settings/audit-logs)。 */
  settingsAuditLogs: {
    title: "稽核日誌",
    tagline: "打卡、修正、簽核、結算、權限變更等操作的紀錄。",
    immutableNote: "稽核日誌為僅追加紀錄,事後不會被修改或刪除(僅供檢視)。",
    loadFailed: "資訊取得失敗,請重試",
    forbidden: "沒有執行此操作的權限",

    filterActionLabel: "操作型別",
    filterActionAll: "全部",
    filterActorLabel: "操作者(使用者ID)",
    filterActorPlaceholder: "留空則顯示全員",
    filterFromLabel: "期間(開始日期)",
    filterToLabel: "期間(結束日期)",
    filterApply: "篩選",
    filterClear: "清除條件",
    filterInvalidRange: "結束日期須晚於或等於開始日期",

    columnOccurredAt: "日期時間",
    columnActor: "操作者",
    columnAction: "操作型別",
    columnTarget: "對象",
    columnDetail: "詳情",
    detailToggle: "顯示詳情",
    detailUnavailable: "暫無詳細資訊",

    empty: "沒有符合條件的稽核日誌。",
    loadMore: "載入更多",
    loadingMore: "載入中…",
    loadMoreFailed: "載入更多失敗,請重試",
  },
} satisfies Messages;
