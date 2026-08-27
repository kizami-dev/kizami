/**
 * 表示文言(简体中文)。lib/i18n/ja.ts の構造をそのまま中国語(簡体字)訳したもの。
 * 型は ja から導出される Messages を `satisfies` で満たし、キーの過不足をコンパイルエラーにする。
 */
import type { Messages } from "./index";

export const zh = {
  appName: "KIZAMI",
  tagline: "以分钟为单位精准记录的考勤管理系统。",

  nav: {
    dashboard: "首页",
    punch: "打卡",
    monthly: "月度",
    corrections: "申请",
    leave: "年假",
    /** 排班(/shifts, /shifts/me)。拥有 shift.manage 权限的用户前往 /shifts,其他用户前往 /shifts/me。 */
    shifts: "排班",
    settings: "设置",
    logout: "退出登录",
  },

  /** 移动端底部标签栏与「更多」面板。 */
  mobileNav: {
    more: "更多",
    moreAriaLabel: "打开更多菜单",
    sheetTitle: "菜单",
    close: "关闭",
    openNotifications: "查看通知",
    /** 通知一览页面(/notifications)的入口,与 openNotifications(打开铃铛)不同。 */
    allNotifications: "查看全部通知",
    stampScreenLink: "打开带打卡动画的打卡页面 →",
  },

  /** 全局公共页头的租户名称显示。仅有 Logo 时无法看出「属于哪家公司的实例」。 */
  header: {
    tenantAriaLabel: "所属组织",
  },

  /** 首页(仪表盘)。 */
  dashboard: {
    title: "首页",
    punchSectionTitle: "打卡",
    todayTitle: "今日与本月",
    todayWorkedLabel: "今日实际工作时长",
    monthFlexLabel: "本月弹性工作时间收支",
    monthFlexMoreLink: "查看月度 →",

    /** 今天、明天的排班。若完全没有排班,则不显示该卡片。 */
    shiftCardTitle: "今天・明天的排班",
    shiftCardTodayLabel: "今天",
    shiftCardTomorrowLabel: "明天",

    todoTitle: "待处理",
    todoEmpty: "没有需要处理的事项。",
    todoLoadFailed: "部分信息获取失败。",

    todoNotificationsTitle: "未读通知",
    todoNotificationsCountSuffix: "条",
    todoNotificationsMore: "还有其他未读通知",

    todoApprovalsTitle: "待审批的申请",
    todoApprovalsCorrections: "打卡修正申请",
    todoApprovalsLeave: "休假申请",
    /** 年假授予预告(v0.7 第4阶段,2026-08-24 新增)。仅对拥有 leave.grant.manage 权限的用户显示。 */
    todoApprovalsProposals: "年假授予预告",
    todoApprovalsCountSuffix: "条",
    todoApprovalsGoCorrections: "查看修正申请 →",
    todoApprovalsGoLeave: "查看带薪年假 →",
    todoApprovalsGoProposals: "查看授予预告 →",

    todoWarningsTitle: "有警告的打卡日期",
    todoWarningsMore: (n: number) => `还有${n}天`,
    todoWarningsFix: "去修正",

    todoDeadlinesTitle: "临近期限的义务事项",
    todoDeadlinesMandatoryPrefix: "距离年5天带薪年假强制使用义务还差",
    todoDeadlinesMandatorySuffix: "天不足(期限: ",
    todoDeadlinesMandatorySuffix2: ")",
    todoDeadlinesExpiring: "有即将失效的带薪年假",
    todoDeadlinesGoLeave: "查看带薪年假 →",

    quickLinksTitle: "常用页面",
    quickLinkMonthlyTitle: "月度",
    quickLinkMonthlyDesc: "查看实际工作时长、弹性工作时间收支以及有警告的日期。",
    quickLinkCorrectionsTitle: "申请",
    quickLinkCorrectionsDesc: "申请新增、更正或撤销打卡记录。",
    quickLinkLeaveTitle: "带薪年假",
    quickLinkLeaveDesc: "查看余额、申请休假。",
  },

  /**
   * 仪表盘的「使用指南」区块。只静静列出未完成的项目(不使用模态框强制操作)。
   */
  onboarding: {
    title: "使用指南",
    dismiss: "不再显示",

    punchTitle: "先试着打一次卡吧",
    punchReason: "打卡后,系统会从当天起开始统计实际工作时长。",
    punchAction: "打开打卡页面 →",

    notifPrefsTitle: "可以设置通知的接收方式",
    notifPrefsReason: "默认仅接收应用内通知,也可以通过邮件或 Webhook 接收。",
    notifPrefsAction: "打开通知设置 →",

    attendanceTitle: "考勤设置目前仍为初始值",
    attendanceReason: "请根据实际情况检查日界、法定休息日、GPS、弹性工作时间等设置。",
    attendanceAction: "打开考勤设置 →",

    channelsTitle: "尚未设置通知渠道",
    channelsReason: "设置邮件或 Webhook 后,可以向员工推送忘记打卡等提醒。",
    channelsAction: "打开通知设置(公司全局) →",

    soloTitle: "目前只有你一名成员",
    soloReason: "邀请成员后,即可管理其他员工的打卡与申请。",
    soloAction: "邀请成员 →",

    hireDateTitle: (count: number) => `有 ${count} 名成员尚未设置入职日期`,
    hireDateReason: "未设置入职日期将无法自动计算带薪年假的法定授予天数。",
    hireDateAction: "打开成员设置 →",
  },

  /** 使用向导(components/Tour.tsx,2026-08-27 新增)。steps 的键与 lib/tour.ts 的 TourStepId 一一对应。 */
  tour: {
    ariaLabel: "使用向导",
    progress: (current: number, total: number) => `${current} / ${total}`,
    next: "下一步",
    prev: "上一步",
    finish: "结束",
    skip: "跳过",
    restartTitle: "查看使用向导",
    restartDesc: "跟随实际画面,了解从打卡到提交申请的流程。",
    steps: {
      dashboard: {
        title: "这里是入口",
        body: "未读通知、待审批的申请、临近期限的事项都会集中在这一栏。这里为空,就说明今天没有待办。",
      },
      punch: {
        title: "打卡",
        body: "用这些按钮记录上班、休息与下班。可按的按钮取决于当前状态。",
      },
      monthly: {
        title: "查看本月记录",
        body: "按区分统计的合计时长。每日明细排在下方表格中,打卡缺失的日期会带有警告。",
      },
      corrections: {
        title: "修正打卡",
        body: "漏打或打错都从这里提交申请。在月度表格中选择日期也可以提交同样的申请。",
      },
      leave: {
        title: "申请休假",
        body: "一边查看剩余年假,一边选择日期与类型。能否按半天或按小时休取决于公司设置。",
      },
      notifPrefs: {
        title: "接收通知的方式",
        body: "漏打卡提醒与审批结果也可以通过邮件或浏览器通知送达,可按类别分别选择。",
      },
      settingsHub: {
        title: "公司设置",
        body: "考勤规则、成员、通知发送渠道都从这里打开。显示哪些项目取决于你拥有的权限。",
      },
      members: {
        title: "邀请成员",
        body: "发送邀请链接后,对方只需设置密码即可开始使用。填写入职日期后即可计算带薪年假的授予天数。",
      },
      attendance: {
        title: "考勤规则",
        body: "设置日界、法定休息日与弹性工作制的结算期间。变更会记录为版本,过去的统计不会改变。",
      },
      closing: {
        title: "月度结算",
        body: "结算后即可确定该月统计并交给薪资系统。结算后若有修正,该月会保留“已修正”标记。",
      },
    },
  },

  /** 主题切换(页头用户菜单内)。 */
  theme: {
    label: "主题",
    system: "跟随系统设置",
    light: "浅色",
    dark: "深色",
  },

  /**
   * 语言切换(页头用户菜单内)。位置与用法同 ThemeToggle。
   * 选项本身的名称(日本語 / English / 한국어 / 简体中文)是各语言的自称,
   * 因此不随语言变化 — 不在 messages 中维护,而由 lib/i18n/index.ts 的 LOCALE_NATIVE_NAMES 提供。
   */
  language: {
    label: "语言",
  },

  /** 通用的细碎片段(分隔符等,多个页面共用)。 */
  common: {
    /** 用于松散分隔两段简短补充说明的符号(例如「已设置(…)」「不更改时请留空」)。 */
    hintSeparator: " · ",
  },

  /**
   * HelpTip(附带法规/KIZAMI规格/公司规定标签的帮助提示)相关的界面文案。
   * 帮助正文本身(@kizami/help-content)目前仅提供日语版本,不在本次翻译范围内。
   */
  helpTip: {
    originLaw: "法规",
    originProduct: "KIZAMI 规格",
    originCompany: "公司规定",
    ariaLabelPrefix: "帮助",
    detailLink: "查看详情 →",
    workRulesLink: "查看工作规则 →",
  },

  /**
   * 日期时间显示的通用格式(由 lib/time.ts 引用)。时区固定为 JST 不变,
   * 仅按语言切换星期、月日的「呈现方式」。
   */
  time: {
    /** 对应 getUTCDay()(0=周日)顺序的星期缩写。 */
    weekdayShort: ["日", "一", "二", "三", "四", "五", "六"] as readonly [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ],
    /** "YYYY年M月"(月度页面标题等)。 */
    monthLabel: (year: number, month: number) => `${year}年${month}月`,
    /** "M/D(周X)"。 */
    dateLabel: (month: number, day: number, weekday: string) => `${month}/${day}(周${weekday})`,
    /** formatDaysHoursMinutes(带薪年假余额显示)的单位与分隔符。 */
    unitDay: "天",
    unitHour: "小时",
    unitMinute: "分钟",
    durationJoin: "",
  },

  /** 打卡页面的大时钟(PunchHome)。 */
  punchClock: {
    currentTimeAriaLabel: (hm: string, ss: string) => `当前时间 ${hm}:${ss}`,
  },

  /** 权限适用范围。由窄到宽: self < department < department_and_descendants < tenant。 */
  scopeLabel: {
    self: "仅本人",
    department: "本部门",
    department_and_descendants: "本部门+下属部门",
    tenant: "整个租户",
  } satisfies Record<"self" | "department" | "department_and_descendants" | "tenant", string>,

  permissions: {
    categoryLabel: {
      attendance: "打卡、申请与审批",
      leave: "休假",
      closing: "结算与导出",
      org: "成员与组织",
      settings: "设置与权限",
      other: "其他",
    } as Record<string, string>,
    internalViewLabel: {
      "department.view": "查看部门树",
      "tenant_settings.view": "查看租户设置",
      "permission_preset.view": "查看权限预设列表",
      "permission_assignment.effective_view": "查看成员的实际权限(可执行的操作)",
      "api_key.view": "查看API密钥列表",
    } as Record<string, string>,
  },

  login: {
    title: "KIZAMI",
    tagline: "以分钟为单位精准记录的考勤管理",
    emailLabel: "邮箱地址",
    passwordLabel: "密码",
    submit: "登录",
    submitting: "登录中…",
    errors: {
      invalid_credentials: "邮箱地址或密码错误",
      rate_limited: "尝试次数过多,请稍后再试",
    /** SSO(OIDC)登录失败原因(2026-08-24 添加)。这些代码与 apps/api/src/lib/oidc.ts 的
     * OidcErrorCode 一一对应(回调会 302 重定向到 /login?error=<code>)。 */
      sso_not_enabled: "本公司未启用 SSO 登录",
      sso_config_incomplete: "SSO 尚未配置完成,请联系管理员",
      sso_discovery_failed: "无法连接到身份提供方(IdP),请联系管理员",
      sso_token_failed: "SSO 认证失败,请重试",
      sso_invalid_token: "无法验证 SSO 凭据,请重试",
      sso_state_mismatch: "SSO 登录流程已中断,请重试",
      sso_email_missing: "未能从 IdP 获取邮箱地址,请联系管理员",
      sso_email_unverified: "IdP 未将该邮箱地址标记为已验证,请联系管理员",
      sso_user_not_found: "未找到使用该邮箱地址的用户,请向管理员申请邀请",
      sso_failed: "SSO 登录失败,请重试",
      encryption_unavailable: "当前无法使用 SSO 登录,请联系管理员",
      default: "登录失败,请稍后重试",
    },

    /** 同一邮箱+密码匹配多个租户时的租户选择。类似 Slack 的工作区选择,不再要求重新输入密码
     * (沿用刚才的验证结果,仅向所选租户重新发送即可)。 */
    tenantSelectTitle: "请选择要登录的公司",
    tenantSelectDescription: "该邮箱地址在多家公司拥有账号。",
    tenantUnnamed: "(未命名)",
    backToEmail: "使用其他账号登录",

    /** SSO(OIDC)登录(2026-08-24 添加)。输入邮箱地址后,通过 GET /auth/oidc/available
     * 查询该用户所属公司中已启用 SSO 的公司,若有匹配则显示按钮。密码登录仍然可用。 */
    ssoDivider: "或",
    ssoButton: "使用 SSO 登录",
    ssoButtonForTenant: (tenantName: string) => `使用 SSO 登录 ${tenantName}`,
    ssoStarting: "正在跳转到 SSO…",

    totpTitle: "请输入验证码",
    totpDescription: "请输入身份验证器应用中显示的6位验证码。",
    totpCodeLabel: "6位验证码",
    totpSubmit: "验证",
    totpSubmitting: "正在验证…",
    totpUseRecovery: "使用恢复码",
    totpUseCode: "使用身份验证器应用的验证码",
    totpRecoveryLabel: "恢复码",
    totpRecoveryDescription: "如果无法使用身份验证器应用,请输入开启两步验证时保存的其中一个恢复码(每个只能使用一次)。",
    totpBack: "从登录重新开始",
    totpExpiredNotice: "验证已超时,请重新登录",
    totpErrors: {
      invalid_body: "请检查验证码的格式",
      invalid_code: "验证码不正确,请重试",
      totp_expired: "验证已超时,请重新登录",
      rate_limited: "尝试次数过多,请稍后再试",
      encryption_unavailable: "当前无法执行此操作,请联系管理员",
      default: "验证失败,请重试",
    },
  },

  /**
   * 接受邀请页面(/invite/[token],无需登录、公开访问)。
   * 注册仅限邀请制。与登录页保持相同的「纸白+居中卡片」样式。
   * 这是员工首次接触 KIZAMI 的页面,文案需格外亲切(不吓人、不迷惑)。
   */
  inviteAccept: {
    invitedBySuffix: " 邀请你加入",
    invitedByUnnamed: "该公司",
    nameLabel: "姓名",
    emailLabel: "邮箱地址",
    passwordLabel: "密码(至少12位)",
    passwordConfirmLabel: "确认密码",
    passwordMismatch: "两次输入的密码不一致",
    passwordTooShort: "密码至少需要12位",
    submit: "注册并开始使用",
    submitting: "注册中…",
    loading: "正在确认邀请信息…",

    invalidTitle: "此邀请链接无效",
    invalidMessage: "此邀请链接无效,请联系管理员确认。",
    expiredTitle: "此邀请已过期",
    expiredMessage: "此邀请已过期,请联系管理员重新发放。",
    acceptedRedirecting: "注册完成,正在跳转…",

    sessionIssuanceFailedTitle: "账户已创建",
    sessionIssuanceFailedMessage: "账户已创建。请前往登录页面登录。",
    goToLogin: "前往登录页面",

    errors: {
      invalid_password: "密码至少需要12位",
      rate_limited: "尝试次数过多,请稍后再试",
      default: "处理失败,请重试",
    },
  },

  /**
   * 密码重置接受页面(/reset/[token],2026-08-23 Tier 0 第4部分新增,无需认证·公开)。
   * 参照 inviteAccept 的结构(构成、状态机、文案基调都沿用)。使用管理员发放的重置链接
   * 设置新密码后会直接进入登录状态(routes/password-resets.ts)。
   */
  passwordResetAccept: {
    tenantUnnamed: "该公司",
    introSuffix: " 正在重置账户密码",
    nameLabel: "姓名",
    emailLabel: "邮箱地址",
    newPasswordLabel: "新密码(至少12位)",
    newPasswordConfirmLabel: "确认新密码",
    passwordMismatch: "两次输入的密码不一致",
    passwordTooShort: "密码至少需要12位",
    submit: "重置密码",
    submitting: "重置中…",
    loading: "正在确认重置链接…",

    invalidTitle: "此重置链接无效",
    invalidMessage: "此重置链接无效,请联系管理员确认。",
    expiredTitle: "此重置链接已过期",
    expiredMessage: "此重置链接已过期,请联系管理员重新发放。",
    acceptedRedirecting: "密码已重置,正在跳转…",

    sessionIssuanceFailedTitle: "密码已更新",
    sessionIssuanceFailedMessage: "密码已更新完成。抱歉给您带来不便,请前往登录页面重新登录。",
    goToLogin: "前往登录页面",

    errors: {
      invalid_password: "密码至少需要12位",
      rate_limited: "尝试次数过多,请稍后再试",
      default: "处理失败,请重试",
    },
  },

  attendanceState: {
    out: "未上班",
    working: "工作中",
    onBreak: "休息中",
  } satisfies Record<"out" | "working" | "onBreak", string>,

  punchButtons: {
    clockIn: "上班打卡",
    breakStart: "开始休息",
    breakEnd: "结束休息",
    clockOut: "下班打卡",
  },

  punchHints: {
    clockInDisabled: "仅可在未上班状态下操作",
    breakDisabled: "仅可在工作中状态下操作",
    clockOutDisabled: "仅可在工作中状态下操作",
  },

  punchKindLabel: {
    clock_in: "上班打卡",
    break_start: "开始休息",
    break_end: "结束休息",
    clock_out: "下班打卡",
  } satisfies Record<"clock_in" | "break_start" | "break_end" | "clock_out", string>,

  today: {
    title: "今日打卡记录",
    empty: "暂无打卡记录",
  },

  /**
   * 附带GPS的打卡(v0.4)。为满足「启用时需向员工明确告知正在采集」的要求,
   * 在启用GPS的租户中,打卡按钮附近会始终显示 noticeAlways(不藏在开关或提示气泡背后)。
   */
  punchGps: {
    noticeAlways: "此次打卡将记录位置信息",
    detailToggle: "详情",
    reason: "为便于确认外勤等情况下的打卡地点,公司已在设置中启用了GPS记录功能。",
    retentionPrefix: "保留期限: ",
    retentionSameAsAttendance: "与考勤数据相同",
    retentionDaysSuffix: "天",
    locating: "正在获取位置信息…",
    unavailableNote: "未能获取位置信息,已在不含位置信息的情况下记录",
  },

  /**
   * 离线状态下的打卡(v0.4)。按要求,v0.4 暂不实现离线打卡排队功能
   * (会导致实际打卡时间与记录时间不一致)。页面(应用外壳)可通过 Service Worker 缓存打开,
   * 但打卡本身仍需联网,以确保记录准确的时间。
   */
  offline: {
    banner: "当前处于离线状态。页面可以正常显示,但为确保记录准确时间,打卡需要联网。",
    punchDisabledHint: "离线状态下无法打卡",
  },

  errors: {
    punchFailed: "打卡失败,请重试",
    loadFailed: "数据获取失败,请重试",
    network: "无法连接到服务器",
  },

  loading: "加载中…",

  monthly: {
    title: "月度",
    prevMonth: "上月",
    nextMonth: "下月",
    columnDate: "日期",
    /** 打卡时间(上班→下班)列。 */
    columnStretches: "工作时段",
    /**
     * 在较宽的视口下,将「工作时段」1列拆分为上班、下班2列。
     * 含义与 columnStretches 单元格表示(formatStretchRange 等)相同,仅显示形式不同。
     */
    columnClockIn: "上班",
    columnClockOut: "下班",
    columnWorked: "实际工作",
    /** 休息不足警告文案中附加的差额说明(应休·实际)。 */
    breakShortfallSuffix: (required: string, actual: string) => `(应休 ${required}·实际 ${actual})`,
    columnBreak: "休息",
    /** 休息自动扣除的并列标签。 */
    autoBreakLabel: "自动",
    columnLateNight: "深夜",
    /** 仅固定工作时间制下显示的加班列。 */
    columnOvertime: "加班",
    columnWarning: "警告",
    columnActions: "操作",
    correctionAction: "修正",
    empty: "本月没有打卡数据",

    /** 尚未下班的工作时段(clockOutAt: null)。 */
    stretchOpenEnded: "—",
    /** 下班时间跨到次日历日时的前缀。 */
    stretchNextDayPrefix: "次日",
    /**
     * 跨日工作在「接收方」日期的工作列开头显示的前缀。
     * 与「次日」标记(区间开始日一侧)对称: 若从前一天开始则用 stretchPrevDayLabel,
     * 若从2天以上之前开始则用 stretchFromDateLabel(M/D)。
     */
    stretchPrevDayLabel: "(从前一天开始)",
    stretchFromDateLabel: (monthDay: string) => `(从 ${monthDay} 开始)`,
    /** 法定内加班(extraWithinStatutoryMinutes)的并列标签。 */
    overtimeExtraLabel: "法定内",

    /** 明确标注当前显示的工作时间制度。 */
    workSystemLabel: "当前显示的工作时间制度",
    workSystemValue: {
      flex: "弹性工作时间制",
      fixed: "固定工作时间制",
      monthly_variable: "1个月单位变形工作时间制",
    } satisfies Record<"flex" | "fixed" | "monthly_variable", string>,

    flexBalanceLabel: "弹性工作时间收支",
    flexBalanceUnit: "分钟",
    /** 固定工作时间制下替代「弹性工作时间收支条」的展示。相对于36协议月度45小时上限的加班位置。 */
    overtimeBarLabel: "加班(相对于36协议月度45小时上限)",
    overtimeBarUnit: "分钟",
    /** 距上限还剩多少(未超过时)。 */
    overtimeBarRemainingLabel: "剩余",
    /** 超过上限时(不仅靠封顶展示,也用文字明确提示)。 */
    overtimeBarOverLabel: "已超过上限",

    /**
     * monthly_variable 下替代「弹性工作时间收支条」的展示。相对于统计期间法定总额度
     * (figures.variablePeriod.statutoryFrameMinutes)的实际工作位置。
     */
    variablePeriodBarLabel: "相对于期间法定总额度的实际工作时间",
    variablePeriodBarUnit: "分钟",
    variablePeriodBarRemainingLabel: "剩余",
    variablePeriodBarOverLabel: "已超过总额度",
    variablePeriodScheduledLabel: "应工作时间合计",
    variablePeriodRangeLabel: (start: string, end: string) => `变形期间 ${start} 〜 ${end}`,
    /** attributedToThisMonth 为 false 时(决定事项3: 期间层面的加班尚未计入本月)。 */
    variablePeriodNotAttributedNote: "期间层面的加班将在期间结束所在月的结算中一并计入,本月尚未计入",
    /** 已结算的月份(figures.source === "snapshot")variablePeriod 本身会返回 null。 */
    variablePeriodUnavailableNote: "本月已结算,因此不显示变形期间明细(加班已包含在分类合计中)",

    /** monthly_variable 的每日「应工作时间」列(DailyBreakdown.scheduledMinutes)。 */
    columnScheduled: "应工作时间",

    /** 排班预实偏差警告附加的分钟数(与 insufficient_break 的 breakShortfallSuffix 同类型)。 */
    shiftDeltaSuffix: (delta: string) => `(偏差 ${delta})`,
    shiftActualOnlySuffix: (actual: string) => `(实际工作 ${actual})`,
    /** 核心时间偏差(劳基法32条之3,2026-08-24 添加)。并列显示核心时间内缺勤的分钟数。 */
    coreTimeDeltaSuffix: (delta: string) => `(核心时间缺勤 ${delta})`,

    totalsLabel: "分类合计",
    /** 津贴对象时间月合计的标题(docs/design/allowances.md「UI」小节,2026-08-23 新增)。 */
    allowanceTotalsLabel: "津贴对象时间",
    /** 结算后修改的差异表中,加在津贴行名称前以便识别。 */
    allowanceDiffPrefix: "津贴: ",

    fixedBreakdownLabel: "所定内・法定内加班(月合计)",
    fixedBreakdownWithinScheduledLabel: "所定内工作时间",
    fixedBreakdownExtraLabel: "法定内加班",

    memberSwitcherLabel: "查看对象",
    memberSwitcherSelfOption: (name: string) => `${name}(本人)`,
    memberSwitcherOthersGroup: "成员",
    memberSwitcherNoDepartment: "无部门",
    memberSwitcherUnknownDepartment: "未知部门",
    viewingOthersLabel: (name: string) => `${name}的月度考勤(仅查看)`,
  },

  totalsCategoryLabel: {
    statutory: "法定内",
    overtime: "加班",
    overtime60h: "加班(超过60小时)",
    lateNight: "深夜",
    statutoryHoliday: "法定休息日",
  } satisfies Record<"statutory" | "overtime" | "overtime60h" | "lateNight" | "statutoryHoliday", string>,

  /** 排班日类型标签(shift_patterns.dayType・shift_days.dayType 通用)。 */
  shiftDayTypeLabel: {
    work: "工作",
    legal_holiday: "法定休息日",
    non_working: "非工作",
  } satisfies Record<"work" | "legal_holiday" | "non_working", string>,

  warningLabel: {
    missing_clock_out: "缺少下班打卡,该工作时段已从统计中排除",
    duplicate_clock_in: "已作废工作中重复出现的上班打卡",
    clock_out_without_in: "已作废未上班状态下的下班打卡",
    break_outside_work: "已作废非工作时间内的休息打卡",
    duplicate_break_start: "已作废休息中重复出现的开始休息打卡",
    unmatched_break_end: "已作废没有对应开始休息记录的结束休息打卡",
    clock_out_during_break: "休息期间存在下班打卡,已按结束休息后下班处理",
    mixed_work_system:
      "本统计期间内工作时间制度发生了变更。系统按期间开始日当时的制度统计整月数据。如需分段查看统计结果,请联系管理员",
    insufficient_break: "本次工作的休息时间未达到法律要求的时长,请确认是否存在漏打卡的情况",
    /** 排班预实偏差(docs/design/shift-work.md「预实对照」)。偏差分钟数通过 monthly.shiftDeltaSuffix 等并列显示。 */
    missing_shift: "在未登记排班的日期存在实际工作时间,请确认排班表",
    shift_late_arrival: "上班时间晚于排班的开始时间",
    shift_early_leave: "下班时间早于排班的结束时间",
    shift_unplanned_work: "在排班中定为休息的日期存在实际工作时间",
    shift_absence: "在排班中定为工作的日期没有实际工作时间",
    /** 核心时间偏差(劳基法32条之3,2026-08-24 添加)。缺勤分钟数通过 monthly.coreTimeDeltaSuffix 并列显示。 */
    core_time_late_arrival: "核心时间迟到 — 晚于核心时间开始时刻上班",
    core_time_early_leave: "核心时间早退 — 早于核心时间结束时刻下班",
    core_time_absence: "核心时间缺勤 — 设有核心时间的日期没有实际工作",
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
    | "core_time_absence",
    string
  >,

  /**
   * 多级(两级)审批的通用文案(2026-08-24 新增,详见 docs/design/approval-flows.md)。
   *
   * 判断点:打卡修正申请、休假申请、休息自动扣除撤销申请这三类的文案完全相同,
   * 因此不在各自的 section(corrections / autoBreakWaiver / leave)里各写一遍,
   * 而是集中到一处(3 类 × 4 种语言 = 12 处重复,以及由此产生的措辞不一致)。
   * 只有状态标签本身(approved_step1)保留在各自的 statusLabel 旁边。
   */
  approvalSteps: {
    /** 显示在 requiredSteps >= 2 的申请卡片上,说明「已批准却仍未生效」的原因。 */
    twoStepNote: "此申请为两级审批。一级审批之后,还需拥有租户全局审批权限的人完成二级审批才会生效。",
    /** 显示在审批队列每一行上,表示当前在等待哪一级审批。 */
    awaitingStep1: "待一级审批",
    awaitingStep2: "待二级审批",
    /** 显示给已完成一级审批、但没有二级审批权限(租户全局范围)的人。 */
    step2NotYours: "二级审批由拥有租户全局审批权限的人执行。",
    /** 一级审批的执行人与时间的标题。 */
    step1DecidedLabel: "一级审批",
    /** 与各 section 的 decidedBySelf 保持一致。 */
    step1DecidedBySelf: "本人",
  },

  corrections: {
    title: "打卡修正申请",
    tagline: "申请新增、更正或撤销打卡记录。审批通过后将反映到考勤记录中。",

    formTitle: "的修正申请",
    formHint: "申请审批通过后将反映到打卡记录及月度统计中。",
    close: "关闭",
    cancel: "取消",
    submit: "提交申请",
    submitting: "提交中…",
    submitted: "申请已提交。审批通过后将反映到打卡记录中。",

    currentPunchesTitle: "当日打卡记录",
    currentPunchesEmpty: "当日暂无打卡记录",

    /** 用于选择新增/更正/撤销(/休息撤销)模式的单选组的 aria-label。 */
    modeGroupAriaLabel: "操作类型",
    modeAdd: "新增打卡",
    modeCorrect: "更正已有打卡",
    modeCancel: "撤销已有打卡",

    kindLabel: "类型",
    timeLabel: "时间",
    targetLabel: "目标打卡记录",
    targetPlaceholder: "请选择目标记录",
    targetEmpty: "没有可选的目标打卡记录",
    reasonLabel: "理由",
    reasonPlaceholder: "请输入需要修正的理由",

    typeAdd: "新增",
    typeCorrect: "更正",
    typeCancel: "撤销",
    targetUnavailable: "无法获取目标打卡信息(可能已被处理)",

    statusLabel: {
      pending: "审批中",
      /** 仅在两级审批时出现的中间状态,此时尚未反映到考勤记录。 */
      approved_step1: "已一级批准(待二级)",
      approved: "已批准",
      rejected: "已驳回",
      withdrawn: "已撤回",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    columnTarget: "目标日期时间",
    columnContent: "内容",
    columnReason: "理由",
    columnDecision: "审批",

    approve: "批准",
    reject: "驳回",
    withdraw: "撤回",

    decidedByLabel: "审批人",
    decidedAtLabel: "审批时间",
    decisionNoteLabel: "审批备注",
    decisionNotePlaceholder: "备注(选填)",
    decidedBySelf: "本人",

    confirmApproveTitle: "确定要批准此申请吗",
    confirmApproveMessage: "批准后将反映到考勤记录,月度统计也会随之变化。此操作将被记录到审计日志中。",
    confirmApproveSelfNote: "将被记录为自行批准。",
    confirmRejectTitle: "确定要驳回此申请吗",
    confirmRejectMessage: "驳回后申请将被记录为已驳回状态,不会反映到打卡记录中。",
    confirmWithdrawTitle: "确定要撤回此申请吗",
    confirmWithdrawMessage: "撤回后将解除审批中状态。如有需要可重新提交申请。",
    confirmProceed: "执行",

    empty: "暂无申请记录",

    queueSectionTitle: "待审批的修正申请",
    queueSectionTagline: "在您的审批权限范围内,待审批的修正申请。",
    queueEmpty: "暂无待审批的申请",

    errors: {
      already_superseded: "目标打卡记录已被其他申请修正",
      not_pending: "此申请已被处理",
      not_found: "未找到目标申请",
      invalid_reason: "请输入1〜500字的理由",
      invalid_target_event: "未找到目标打卡记录,请重新选择",
      invalid_proposed_kind: "请确认打卡类型",
      invalid_proposed_occurred_at: "请确认时间格式",
      proposed_occurred_at_in_future: "不能指定未来的时间",
      invalid_request_shape: "请确认输入内容",
      invalid_body: "请确认输入内容",
      invalid_status: "指定了无法显示的状态",
      /** 409。两级审批中,完成一级审批的本人试图进行二级审批。 */
      /** 403。例如没有租户全局范围的审批人尝试进行二级审批。 */
      forbidden: "没有执行此操作的权限",
      same_approver_as_step1: "完成一级审批的本人无法进行二级审批,请交由其他审批人处理",
      default: "处理失败,请重试",
    },
  },

  /**
   * 休息自动扣除撤销申请。与打卡修正申请(corrections)是不同的数据表、不同的流程,
   * 但审批页面沿用同一位置(/corrections)与同一交互方式(ConfirmDialog、k-modal)。
   */
  autoBreakWaiver: {
    /** CorrectionForm(月度修正模态框)内的新模式标签。 */
    modeWaiver: "未能休息",
    /** 当天存在自动扣除时,在模态框顶部显示的提示。 */
    deductedNotice: (amount: string) => `当天已自动扣除 ${amount} 作为休息时间。`,
    formHint: "此为实际未能休息时的申请。批准后将取消当天的自动扣除,若休息时间不足将显示警告。",
    reasonLabel: "理由",
    reasonPlaceholder: "请输入未能休息的理由",
    submit: "提交申请",
    submitting: "提交中…",

    typeLabel: "休息自动扣除撤销",
    columnDate: "目标日期",
    columnReason: "理由",
    columnDecision: "审批",

    ownSectionTitle: "休息自动扣除撤销申请",
    ownSectionTagline: "你提交的休息自动扣除撤销申请列表。",
    queueSectionTitle: "待审批的撤销申请",
    queueSectionTagline: "在你的审批权限范围内、待审批的撤销申请。",
    empty: "暂无申请记录",
    queueEmpty: "没有待审批的申请",

    statusLabel: {
      pending: "审批中",
      /** 仅在两级审批时出现的中间状态,此时尚未反映到考勤记录。 */
      approved_step1: "已一级批准(待二级)",
      approved: "已批准",
      rejected: "已驳回",
      withdrawn: "已撤回",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    approve: "批准",
    reject: "驳回",
    withdraw: "撤回",
    decisionNoteLabel: "审批备注",
    decisionNotePlaceholder: "备注(选填)",
    decidedBySelf: "本人",

    confirmApproveTitle: "确定要批准此申请吗",
    confirmApproveMessage:
      "批准后将取消当天的自动扣除,月度统计将随之变化。若休息时间不足将显示警告。此操作将被记录到审计日志中。",
    confirmApproveSelfNote: "将被记录为自行批准。",
    confirmRejectTitle: "确定要驳回此申请吗",
    confirmRejectMessage: "驳回后申请将被记录为已驳回状态,自动扣除将保持不变。",
    confirmWithdrawTitle: "确定要撤回此申请吗",
    confirmWithdrawMessage: "撤回后将解除审批中状态。如有需要可重新提交申请。",

    errors: {
      invalid_waive_date: "请确认目标日期",
      invalid_reason: "请输入1〜500字的理由",
      invalid_body: "请确认输入内容",
      invalid_status: "指定了无法显示的状态",
      not_pending: "此申请已被处理",
      already_approved: "当天的撤销申请已被批准",
      not_found: "未找到目标申请",
      forbidden: "没有执行此操作的权限",
      /** 409。两级审批中,完成一级审批的本人试图进行二级审批。 */
      same_approver_as_step1: "完成一级审批的本人无法进行二级审批,请交由其他审批人处理",
      month_closed_requires_unlock: "本月已确定结算。需要解除结算权限才能批准",
      default: "处理失败,请重试",
    },
  },

  notifications: {
    bellLabel: "通知",
    title: "通知",
    empty: "暂无通知",
    unread: "未读",
    markRead: "标为已读",
    markReadFailed: "标记已读失败,请重试",
    subjectDateLabel: "目标日期",
    receivedAtLabel: "接收时间",
    openCorrection: "打开当日的修正申请",
    /** 来自 leave_* 类型的入口(通知一览页面)。 */
    openLeave: "打开带薪年假页面",
    openLeaveSettings: "打开带薪年假设置页面",
    /** 来自 overtime_* 类型的入口(通知一览页面)。 */
    openMonthly: "打开月度页面",
    loadFailed: "通知获取失败,请重试",
    /** 铃铛下拉列表末尾的入口。 */
    viewAll: "查看全部通知 →",
  },

  /** 通知一览页面(/notifications)。与铃铛下拉列表不同,可回溯查看历史通知。 */
  notificationsPage: {
    title: "通知",
    tagline: "可以查看历史通知。",
    filterStatusGroupLabel: "按已读状态筛选",
    filterStatusAll: "全部",
    filterStatusUnread: "仅未读",
    filterTypeGroupLabel: "按类型筛选",
    filterTypeAll: "全部类型",
    filterTypeMissingClockOut: "忘记打卡",
    filterTypeOvertime: "36协议",
    filterTypeLeave: "带薪年假",
    markAllRead: "将当前显示内容全部标为已读",
    markAllReadPending: "处理中…",
    empty: "暂无通知",
    emptyFiltered: "没有符合条件的通知",
    /** 接口最多只返回100条(规格限制,接口不作调整)。 */
    truncatedNotice: "仅显示最近100条,更早的通知将不再显示。",
  },

  settingsNotifications: {
    title: "通知设置(公司全局)",
    tagline: "设置整个租户的通知渠道(Webhook、邮件)。",
    noPermission: "没有权限更改此设置",
    /** 需在界面上明确区分本设置与个人设置(/settings/notifications/me)。 */
    distinctionBanner:
      "此处为公司全局渠道(SMTP服务器、共享Webhook等)的设置。若要设置个人的通知接收方式(邮件、个人Webhook的启用/禁用),请前往「个人通知设置」。",
    linkToPersonalSettings: "打开个人通知设置 →",

    webhookSectionTitle: "Webhook",
    webhookEnabledLabel: "启用Webhook通知",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "已设置",
    webhookUrlNotConfigured: "未设置",
    keepIfBlankHint: "如不更改,请保留为空",

    smtpSectionTitle: "邮件(SMTP)",
    smtpEnabledLabel: "启用邮件通知",
    smtpHostLabel: "SMTP主机",
    smtpPortLabel: "端口",
    smtpUserLabel: "用户名",
    smtpFromLabel: "发件人邮箱地址",
    smtpPasswordLabel: "密码",
    smtpPasswordConfigured: "已设置",
    smtpPasswordNotConfigured: "未设置",

    save: "保存",
    saving: "保存中…",
    saveNote: "此设置适用于整个租户,更改将被记录到审计日志中。",
    saveSuccess: "设置已保存。",

    testSend: "发送测试",
    testSendConfirmTitle: "要发送测试通知吗",
    testSendConfirmMessage: "将使用已保存的设置实际发送一条通知。",
    testSendConfirmLabel: "发送",
    testSendResultTitle: "测试发送结果",
    testSendOk: "成功",
    testSendFailed: "失败",
    testSendChannelLabel: {
      webhook: "Webhook",
      smtp: "邮件(SMTP)",
    } as Record<string, string>,

    loading: "加载中…",
    loadFailed: "设置获取失败,请重试",

    errors: {
      invalid_webhook_enabled: "请确认输入内容",
      invalid_smtp_enabled: "请确认输入内容",
      invalid_webhook_url: "请确认Webhook URL的格式(请输入有效的http/https URL)",
      invalid_smtp_host: "请确认SMTP主机",
      invalid_smtp_user: "请确认用户名",
      invalid_smtp_from: "请确认发件人邮箱地址",
      invalid_smtp_password: "请确认密码",
      invalid_smtp_port: "端口号请输入1〜65535范围内的数值",
      invalid_smtp_config: "启用邮件通知时,请填写主机、端口和发件人",
      invalid_body: "请确认输入内容",
      not_configured: "没有已设置的有效渠道",
      default: "处理失败,请重试",
    },
  },

  /**
   * 个人通知设置(/settings/notifications/me)。与租户设置(settingsNotifications,上文)
   * 是不同的层级,需在文案上明确区分。
   */
  settingsPersonalNotifications: {
    title: "个人通知设置",
    tagline: "设置你个人的通知接收方式。每个人都只能更改自己的设置。",

    distinctionBanner:
      "此处为你个人的接收方式设置。如需设置公司全局渠道(SMTP服务器、共享Webhook等),请前往「通知设置(公司全局)」。",
    distinctionBannerNoAccess: "此处为你个人的接收方式设置。公司全局渠道设置请咨询管理员。",
    linkToTenantSettings: "打开通知设置(公司全局) →",

    categoriesSectionTitle: "各类通知的接收方式",
    categoryColumnInapp: "应用内",
    categoryColumnEmail: "邮件",
    categoryColumnWebhook: "个人Webhook",
    /** 2026-08-24 新增。仅在已配置 VAPID 密钥的部署(pushAvailable=true)中显示该列。 */
    categoryColumnPush: "推送通知",
    inappAlwaysOnHint: "应用内通知始终开启(无法更改)。",
    categories: {
      missing_clock_out: "忘记打卡",
      overtime_alert: "36协议·加班提醒",
      leave_alert: "带薪年假即将失效·年5天强制使用义务提醒",
      /** 修正类申请(如休息自动扣除撤销等)的批准/驳回通知。 */
      correction_alert: "申请的批准/驳回(如休息自动扣除撤销等)",
      /** 2026-08-23 Tier 0 第4部分新增。面向拥有批准权限的人 — 管辖范围内成员提交申请时的通知。 */
      approval_request: "审批请求(管辖范围内成员提交申请时。面向拥有批准权限的人)",
      /** 2026-08-24 追加。前日の自分の勤務がシフトとずれたときの本人向け通知。 */
      shift_variance: "与排班的偏差(自己的出勤与排班不一致时。迟到、早退、可能缺勤等)",
    } as Record<string, string>,

    emailSectionTitle: "通知邮箱地址",
    emailAddressLabel: "邮箱地址",
    emailAddressPlaceholder: "留空则使用账号邮箱地址",
    emailAddressEffectiveHint: (email: string) => `当前接收地址: ${email}`,

    webhookSectionTitle: "个人 Webhook",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "已设置",
    webhookUrlNotConfigured: "未设置",
    keepIfBlankHint: "如不更改,请保留为空",


    /**
     * 浏览器推送通知(2026-08-24 新增,docs/design/web-push.md)。
     * 订阅需要**按浏览器**分别进行(电脑和手机需各自授权)。
     */
    pushSectionTitle: "浏览器推送通知",
    pushHint: "订阅需要按浏览器分别进行。若想在其他设备或浏览器上也接收,请在那里执行相同的操作。",
    pushEnable: "在此浏览器接收推送通知",
    pushEnabling: "设置中…",
    pushDisable: "停止在此浏览器接收",
    pushDisabling: "解除中…",
    pushSubscribed: "此浏览器已订阅。",
    pushNotSubscribed: "此浏览器尚未订阅。",
    pushUnsupported: "此浏览器不支持推送通知。",
    pushPermissionDenied:
      "通知已被阻止。请从浏览器地址栏的锁形(或网站信息)图标打开网站设置,将「通知」改为「允许」后再试一次。",
    pushPermissionDismissed: "未获得通知权限,请重试。",
    pushUnavailable: "此 KIZAMI 未启用推送通知,请联系管理员。",
    pushFailed: "推送通知设置失败,请重试。",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "设置已保存。",

    testSend: "发送测试",
    testSendConfirmTitle: "要发送测试通知吗",
    testSendConfirmMessage: "将向已保存的个人Webhook实际发送一条通知。",
    testSendConfirmLabel: "发送",
    testSendResultTitle: "测试发送结果",
    testSendOk: "成功",
    testSendFailed: "失败",

    loading: "加载中…",
    loadFailed: "设置获取失败,请重试",

    errors: {
      invalid_body: "请确认输入内容",
      invalid_categories: "请确认通知类型的指定",
      invalid_email_address: "请确认邮箱地址格式",
      invalid_webhook_url: "请确认Webhook URL的格式(请输入有效的http/https URL)",
      encryption_unavailable: "当前无法保存此项,请联系管理员",
      not_configured: "尚未设置个人Webhook",
      decryption_failed: "无法读取已保存的值,请重新设置",
      default: "处理失败,请重试",
    },
  },

  /**
   * Slack斜杠命令打卡的集成设置(/settings/slack,公司全局)。
   * docs/external-api/slack.md 为规格权威来源。
   */
  settingsSlack: {
    title: "Slack集成",
    tagline: "设置通过Slack斜杠命令(/punch)进行打卡的功能。",
    noPermission: "没有权限更改此设置",
    setupGuideHint: "关于配置步骤(创建Slack应用、保存Signing Secret的方法),请参见 docs/external-api/slack.md。",

    teamIdLabel: "Slack 工作区ID(Team ID)",
    teamIdPlaceholder: "T0123456",
    teamIdHint: "可在Slack的「Basic Information」页面等处查看。每个租户只能设置一个工作区。",

    signingSecretLabel: "Signing Secret",
    signingSecretConfigured: "已设置",
    signingSecretNotConfigured: "未设置",
    keepIfBlankHint: "如不更改,请保留为空",

    enabledLabel: "启用Slack打卡",
    enabledHint: "启用前需要同时设置工作区ID和Signing Secret。",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "设置已保存。",
    saveNote: "此设置适用于整个租户,更改将被记录到审计日志中。",

    loading: "加载中…",
    loadFailed: "设置获取失败,请重试",

    linkNavHint: "员工本人的Slack账号关联可通过「",
    linkNavLinkLabel: "输入Slack关联令牌",
    linkNavHintSuffix: "」进行(无需权限)。",

    errors: {
      invalid_enabled: "请确认输入内容",
      invalid_team_id: "请确认工作区ID",
      invalid_signing_secret: "请确认Signing Secret",
      invalid_slack_config: "启用时请同时输入工作区ID和Signing Secret",
      invalid_body: "请确认输入内容",
      encryption_unavailable: "当前无法保存此项,请联系管理员",
      default: "处理失败,请重试",
    },
  },

  /** SSO(OIDC)设置界面(/settings/sso,2026-08-24 添加)。docs/design/sso-oidc.md 为规格正本。 */
  settingsSso: {
    title: "SSO(OIDC)",
    tagline: "通过 OIDC 与 Google Workspace、Entra ID 等身份提供方对接,启用 SSO 登录。",
    noPermission: "没有权限更改此设置",
    setupGuideHint: "身份提供方一侧的应用注册步骤,以及本界面各项的含义,请参见 docs/design/sso-oidc.md。",

    noAutoProvisioningNote: "SSO 是现有成员的登录方式。即使在身份提供方拥有账号,未被邀请加入 KIZAMI 的人也无法登录(不会自动创建成员)。",

    redirectUriLabel: "需在身份提供方登记的重定向 URI",
    redirectUriHint: "请在身份提供方的应用设置中,将此 URL 登记为「已授权的重定向 URI」。",

    issuerLabel: "issuer(颁发者 URL)",
    issuerPlaceholder: "https://accounts.google.com",
    issuerHint: "只能填写以 https 开头的 URL。配置信息会自动从 {issuer}/.well-known/openid-configuration 获取。",

    clientIdLabel: "客户端 ID",
    clientIdHint: "在身份提供方注册应用后签发。它不属于机密信息,因此在此界面原样显示。",

    clientSecretLabel: "客户端密钥",
    clientSecretConfigured: "已设置",
    clientSecretNotConfigured: "未设置",
    keepIfBlankHint: "如不更改,请保留为空",

    allowUnverifiedLabel: "邮箱地址未验证时也允许登录",
    allowUnverifiedHint: "默认关闭。开启后,即使身份提供方不返回 email_verified 也能登录;但在允许用户自称任意邮箱地址的身份提供方下可能被冒充,因此请仅在自建身份提供方等特殊情况下开启。",

    enabledLabel: "启用 SSO 登录",
    enabledHint: "启用前需要同时设置 issuer、客户端 ID 和客户端密钥。",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "设置已保存。",
    saveNote: "此设置适用于整个租户,更改将被记录到审计日志中。",

    loading: "加载中…",
    loadFailed: "设置获取失败,请重试",

    errors: {
      invalid_enabled: "请确认输入内容",
      invalid_issuer: "issuer 必须是以 https 开头的 URL(不能带查询参数或片段)",
      invalid_client_id: "请确认客户端 ID",
      invalid_client_secret: "请确认客户端密钥",
      invalid_allow_unverified_email: "请确认输入内容",
      invalid_sso_config: "启用时请同时输入 issuer、客户端 ID 和客户端密钥",
      invalid_body: "请确认输入内容",
      encryption_unavailable: "当前无法保存此项,请联系管理员",
      default: "处理失败,请重试",
    },
  },

  /**
   * 多级审批设置(/settings/approval-flow,2026-08-24 新增)。以 docs/design/approval-flows.md 为准。
   * 界面只是按类型选择「1 级」或「2 级(一级+二级审批)」,但它改变的是整个审批体制,
   * 因此最容易被误解的两点(不影响已提交的申请、二级审批人需要租户全局范围)必须显示在页面上。
   */
  settingsApprovalFlow: {
    title: "多级审批",
    tagline: "按申请类型决定审批是 1 级,还是 2 级(一级审批+二级审批)。",
    noPermission: "您没有更改此设置的权限",
    loadFailed: "获取设置失败,请重试",

    defaultSingleHint: "默认全部为 1 级。保持不变时,与以往一样一次批准即可生效。",
    twoStepHint: "设为 2 级后,一级审批仍由拥有该类型审批权限的人执行,二级审批则由以「租户全局」范围拥有同一权限的人(人事、总部等)执行。在二级审批完成之前,申请不会生效。",
    sameApproverHint: "一级审批与二级审批不能由同一人执行。",
    frozenAtCreationHint: "更改此设置不会改变已经提交的申请的级数。申请会按创建时的级数一直走到最后。",
    tenantApproverRequiredHint: "改为 2 级之前,请确认至少有 1 人以「租户全局」范围拥有该审批权限。否则申请会一直卡在待二级审批状态。",

    correctionLabel: "打卡修正申请",
    correctionHint: "打卡记录的补录、修正、撤销申请。审批权限为「批准打卡修正」。",
    leaveLabel: "休假申请",
    leaveHint: "带薪年假等的使用申请。审批权限为「批准休假申请」。",
    autoBreakWaiverLabel: "休息自动扣除撤销申请",
    autoBreakWaiverHint: "用于撤销实际未能休息当天的自动扣除。审批权限与打卡修正申请相同。",

    optionOneStep: "1 级(单级)",
    optionTwoSteps: "2 级(一级+二级审批)",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "设置已保存。",
    saveNote: "此设置适用于整个租户,且仅对此后提交的申请生效。更改会记录到审计日志。",

    errors: {
      invalid_correction_steps: "打卡修正申请的级数请选择 1 级或 2 级",
      invalid_leave_steps: "休假申请的级数请选择 1 级或 2 级",
      invalid_auto_break_waiver_steps: "休息自动扣除撤销申请的级数请选择 1 级或 2 级",
      invalid_body: "请确认输入内容",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /**
   * 输入Slack关联令牌(/settings/slack-link,无需权限,全员可用)。
   * 在Slack中执行 `/punch link` 后会生成一个15分钟内有效的一次性令牌,在此输入即可完成关联。
   */
  settingsSlackLink: {
    title: "输入Slack关联令牌",
    tagline: "在Slack中执行 `/punch link` 后会显示一个令牌,输入该令牌即可关联你的Slack账号。",
    howToTitle: "操作步骤",
    howTo1: "在Slack中执行 `/punch link`",
    howTo2: "复制显示的令牌(有效期15分钟)",
    howTo3: "粘贴到下方输入框并点击「关联」",

    tokenLabel: "令牌",
    tokenPlaceholder: "kzsl_...",
    submit: "关联",
    submitting: "关联中…",

    successTitle: "关联成功",
    successMessage: (slackUserId: string) =>
      `已关联Slack账号(${slackUserId})。此后可以使用 \`/punch in\` 等命令。`,

    errors: {
      invalid_token: "请输入令牌",
      invalid_body: "请确认输入内容",
      invalid_or_expired_token: "令牌无效或已过期(15分钟)。请在Slack中重新执行 `/punch link`",
      default: "处理失败,请重试",
    },
  },

  /** 设置子导航(/settings/* 之间的切换,仅显示有权限访问的项目)。 */
  settingsNav: {
    label: "设置菜单",
    /** 若仅显示「设置」,会与其他标签看起来同级,因此改为清楚表明是「返回列表」的操作。 */
    hubLink: "返回设置菜单列表",
    myNotifications: "个人通知设置",
    notifications: "通知设置(公司全局)",
    departments: "部门",
    members: "成员",
    presets: "权限预设",
    approvalFlow: "多级审批",
    tenantProfile: "租户配置",
    leave: "带薪年假",
    help: "公司内部规定",
    privacy: "个人信息",
    attendance: "考勤规则",
    allowances: "津贴对象时间",
    shiftPatterns: "排班模板",
    security: "两步验证",
    apiKeys: "API密钥",
    slack: "Slack集成",
    sso: "SSO(OIDC)",
    auditLogs: "审计日志",
  },

  settingsHub: {
    title: "设置",
    tagline: "管理租户的设置、组织架构和权限。仅显示你有权限访问的项目。",
    empty: "没有可用的设置项目,请联系管理员。",
    /** 明确区分个人设置(全员)与公司设置(面向管理员)的分组标题。 */
    personalGroupTitle: "个人设置",
    tenantGroupTitle: "公司设置",
    myNotificationsTitle: "个人通知设置",
    myNotificationsDesc: "按通知类型分别设置应用内、邮件、个人Webhook的接收方式。",
    notificationsTitle: "通知设置(公司全局)",
    notificationsDesc: "设置Webhook、邮件(SMTP)通知渠道。",
    departmentsTitle: "部门",
    departmentsDesc: "创建部门树、修改名称、调整隶属关系及删除部门。",
    membersTitle: "成员",
    membersDesc: "变更成员所属部门、分配权限预设、查看实际生效的权限。",
    presetsTitle: "权限预设",
    presetsDesc: "创建和编辑组合了权限开关与适用范围的预设。",
    approvalFlowTitle: "多级审批",
    approvalFlowDesc: "设置打卡修正、休假、休息自动扣除撤销申请需要 1 级审批还是 2 级(一级+二级审批)。",
    attendanceTitle: "考勤规则",
    attendanceDesc: "以新增版本的方式变更日界、法定休息日、休息规则、GPS、弹性工作时间等设置。",
    allowancesTitle: "津贴对象时间",
    allowancesDesc: "将符合特定日期、星期、时间段条件的实际工作时间,定义为津贴发放对象时间。",
    shiftPatternsTitle: "排班模板",
    shiftPatternsDesc: "定义早班、晚班、休息等排班模板。创建排班表时按日期分配。",
    tenantProfileTitle: "租户配置",
    tenantProfileDesc: "查看影响统计的企业规模、特例措施适用单位、特别条款等属性,以及即将生效的法规修订。",
    leaveTitle: "带薪年假",
    leaveDesc: "设置授予方式、按小时计年假、结转休假等租户全局配置。",
    helpTitle: "公司内部规定",
    helpDesc: "设置帮助中显示的自有公司规定,以及工作规则的链接。",
    privacyTitle: "个人信息",
    privacyDesc: "根据当前设置查看面向员工的隐私声明与公司内部使用条款的模板。",
    securityTitle: "两步验证",
    securityDesc: "除密码外还要求输入身份验证器应用的6位验证码。恢复码的重新生成与关闭也在此处操作。",
    apiKeysTitle: "API密钥",
    apiKeysDesc: "签发和吊销供IC卡读卡器、Slack bot、MCP服务器等外部客户端打卡使用的API密钥。",
    slackTitle: "Slack集成",
    slackDesc: "设置通过Slack斜杠命令(/punch)进行打卡的功能。",
    ssoTitle: "SSO(OIDC)",
    ssoDesc: "通过 OIDC 与 Google Workspace、Entra ID 等身份提供方对接,让已受邀成员可以使用 SSO 登录。",
    slackLinkTitle: "输入Slack关联令牌",
    slackLinkDesc: "输入在Slack中执行 `/punch link` 后获得的令牌,关联你的Slack账号。",
    auditLogsTitle: "审计日志",
    auditLogsDesc: "查看打卡、修正、审批、结算、权限变更等不可篡改的操作记录(仅供查看)。",
  },

  /** 月度结算与CSV导出(/monthly 页面)。 */
  closing: {
    closedBadge: "已确定",
    amendedBadge: "结算后有修改",
    snapshotBadge: "确定值",

    closeAction: "结算本月",
    reopenAction: "解除确定状态",

    confirmCloseTitle: "确定要结算本月吗",
    confirmCloseMessage:
      "将确定本月的考勤数据。此后的打卡与修正均需要申请并经过审批。此操作将被记录到审计日志中。",
    confirmCloseLabel: "结算",

    confirmReopenTitle: "确定要解除确定状态吗",
    confirmReopenMessage: "解除确定状态后,本月将重新变为可自由编辑的状态。",
    confirmReopenExtraNote: "解除结算是影响较大的操作,此操作将被记录到审计日志中。",
    confirmReopenLabel: "解除",

    noteLabel: "备注(选填)",
    notePlaceholder: "结算/解除的理由等(选填)",

    diffTitle: "与初始值的差异",
    diffColumnCategory: "分类",
    diffColumnOriginal: "初始值",
    diffColumnCurrent: "当前值",
    diffColumnDelta: "差异",
    diffFlexFrame: "弹性工作时间总额度",
    diffFlexActual: "弹性工作时间实际值",
    diffFlexDiff: "弹性工作时间收支",

    historyTitle: "结算历史",
    historyEmpty: "暂无结算/解除历史",
    historyActorSelf: "本人",
    historyEventLabel: {
      close: "结算",
      reopen: "解除",
      amend: "修改反映",
    } satisfies Record<"close" | "reopen" | "amend", string>,
    historyCorrectionLink: "查看相关修正申请",

    csvFormatLabel: "格式",
    csvFormatOptions: {
      generic: "通用CSV",
      freee: "freee人事劳务(测试版)",
      mf: "Money Forward云薪资(测试版)",
    },
    csvFormatBetaNote:
      "测试版:这是按各服务的考勤导入格式生成的兼容CSV。导入前请务必确认列名、单位和员工标识与贵公司的设置一致。天数(出勤天数、缺勤天数、带薪年假使用天数等)因KIZAMI不进行计算而留空。",
    csvDownload: "下载CSV",
    csvDownloading: "生成中…",
    csvCompareOriginalLabel: "包含与初始值的差异",
    csvDownloadFailed: "CSV下载失败,请重试",

    errors: {
      already_closed: "本月已经结算",
      not_closed: "本月尚未结算",
      invalid_period: "请确认目标月份",
      invalid_note: "备注请控制在500字以内",
      invalid_body: "请确认输入内容",
      default: "处理失败,请重试",
    },
  },

  /** 租户配置(/settings/tenant-profile)。这些属性是工作时间统计与36协议提醒的前提条件。 */
  settingsTenantProfile: {
    title: "租户配置",
    tagline: "设置作为工作时间统计和36协议提醒基础的租户全局属性。",
    noPermission: "没有权限更改此设置",
    loadFailed: "设置获取失败,请重试",

    smeLabel: "是否为中小企业",
    smeHint: "用于判定因企业规模而施行日期不同的项目(月度超过60小时的加班费率、36协议上限规定)。",

    specialProvisionLabel: "是否为特例措施适用单位",
    specialProvisionHint:
      "商业、影剧业、保健卫生业、娱乐服务业中常时雇用不满10人的单位,其每周法定工作时间为44小时(《劳动基准法》第40条)。",

    specialClauseLabel: "已签订特别条款",
    specialClauseHint:
      "启用与36协议特别条款相关的提醒(月度不足100小时、连续多月平均80小时、年度720小时、月度超过45小时每年最多6次)。",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "设置已保存。",

    confirmTitle: "确定要更改此设置吗",
    confirmMessage: "此设置将直接影响工作时间的统计。",
    confirmExtraNote: "更改将被记录到审计日志中。",
    confirmLabel: "更改",

    currentRulesTitle: "当前生效的主要数值",
    currentRulesWeekly: "每周法定工作时间",
    currentRulesAgreementMonthly: "36协议·月度上限",
    currentRulesAgreementAnnual: "36协议·年度上限",
    currentRulesHourlyLeave: "按小时计年假的上限天数",
    currentRulesHourlyLeaveUnit: "天/年",
    currentRulesSpecialClauseTitle: "特别条款下的上限(已签订时)",
    currentRulesSpecialMonthlyCap: "单月",
    currentRulesSpecialMonthlyCapNote: "以内",
    currentRulesSpecialMultiMonth: "连续多月平均",
    currentRulesSpecialAnnual: "年度",
    currentRulesSpecialExceedCount: "允许超过月45小时的次数",
    currentRulesSpecialExceedCountUnit: "次/年",

    upcomingTitle: "即将生效的法规修订",
    upcomingEmpty: "目前没有即将生效的法规修订",
    upcomingEffectiveFrom: "施行日期",
    upcomingBasis: "依据",
    upcomingChangesPrefix: "变更内容: ",
    upcomingRuleLabel: {
      weeklyStatutoryMinutes: "每周法定工作时间",
      lateNight: "深夜时段",
      overtime60h: "月度超过60小时的分类",
      agreement36: "36协议上限",
      annualLeave: "带薪年假",
    } satisfies Record<"weeklyStatutoryMinutes" | "lateNight" | "overtime60h" | "agreement36" | "annualLeave", string>,

    errors: {
      invalid_is_small_or_medium_enterprise: "请确认输入内容",
      invalid_is_special_provision_workplace: "请确认输入内容",
      invalid_special_clause_enabled: "请确认输入内容",
      invalid_body: "请确认输入内容",
      tenant_not_found: "未找到租户信息",
      default: "处理失败,请重试",
    },
  },

  /**
   * 考勤规则的版本管理(/settings/attendance)。
   * 遵循 effective-dated 原则: 编辑仅通过新增版本进行,已有版本不会被修改
   * (过去的计算结果不会改变)。
   */
  settingsAttendance: {
    title: "考勤规则",
    tagline: "以新增版本的方式变更日界、法定休息日、休息规则、GPS、弹性工作时间等设置。",
    noPermission: "没有权限更改此设置",
    loadFailed: "设置获取失败,请重试",

    currentTitle: "当前生效的设置",
    currentEffectiveFrom: "此版本生效的日期",
    dayBoundaryLabel: "日界(一天的起算时间)",
    /**
     * 每周起算星期。用于判定每周40小时(固定工作时间制下的每周加班)的一周分界,
     * 与法定休息日的星期指定(legalHolidayWeekday)是不同的概念,不要混淆。
     */
    weekStartWeekdayLabel: "每周起算星期",
    weekStartWeekdayHint: "用于判定每周40小时的一周分界。若工作规则中未规定,原则上从周日起算(1988年〔昭和63年〕基发第1号)。",
    /**
     * 变形期间起始日(docs/design/shift-work.md 决定事项3)。
     * 即使租户不使用 monthly_variable,每次 POST 也需必填此项(与 apps/api 的约定一致)。
     */
    variablePeriodStartDayLabel: "变形期间起始日",
    variablePeriodStartDayHint:
      "请指定1〜28之间的日期(29〜31日因并非每月都存在而无法选择)。排班表(排班管理页面)的期间将以此日为起点按月划分。即使不使用排班制度也需要填写。",
    legalHolidayLabel: "法定休息日",
    legalHolidayWeekday: "按星期指定",
    legalHolidayDates: "按具体日期指定",
    breakRuleLabel: "休息规则",
    breakRulePunch: "打卡方式",
    /** 休息的自动扣除。 */
    breakRuleModeAuto: "自动扣除",
    breakRuleModeBoth: "两者并用",
    breakRuleRulesTitle: "扣除规则",
    breakRuleOverSuffix: "超过",
    breakRuleDeductSuffix: "分钟则扣除",
    breakRuleAddRule: "添加一行",
    breakRuleRemoveRule: "删除",
    breakRuleRuleOverLabel: "基准工作时间",
    breakRuleRuleDeductLabel: "扣除的分钟数",
    breakRuleMaxRulesHint: "最多可设置3行。",
    gpsLabel: "GPS打卡",
    gpsEnabledYes: "启用",
    gpsEnabledNo: "禁用",
    gpsRetentionLabel: "GPS坐标保留期限",
    gpsRetentionSameAsAttendance: "与考勤数据相同",
    gpsRetentionDaysUnit: "天",
    flexLabel: "弹性工作时间设置",
    flexSettlementMonthly: "按月结算",
    flexStandardDayMinutesLabel: "标准工作时间(每天,分钟)",
    /**
     * 核心时间(劳基法32条之3,2026-08-24 添加)。弹性工时制的**可选**设置,
     * 不设置即为超级弹性工时。不影响汇总,仅显示迟到・早退・缺勤警告。
     */
    coreTimeLabel: "核心时间",
    coreTimeNone: "无核心时间(超级弹性工时)",
    coreTimeSummary: (start: string, end: string, weekdays: string) => `${start}〜${end}(${weekdays})`,
    noVersionYet: "尚未设置",

    weekdayLabel: {
      0: "周日",
      1: "周一",
      2: "周二",
      3: "周三",
      4: "周四",
      5: "周五",
      6: "周六",
    } satisfies Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>,

    formTitle: "新增版本",
    effectiveFromLabel: "生效日期",
    effectiveFromHint: "此变更仅影响指定日期之后的统计,过去的统计结果不会改变。",
    dayBoundaryHint: "0点=从00:00起算。存在深夜工作的岗位,例如设为05:00(300分钟),可将跨天的工作合并计入同一天。",
    legalHolidayKindLabel: "指定方式",
    legalHolidayWeekdayValueLabel: "作为休息日的星期",
    legalHolidayDatesValueLabel: "作为休息日的日期(逗号分隔,YYYY-MM-DD)",
    legalHolidayDatesPlaceholder: "例如: 2026-05-05,2026-05-06",
    gpsEnabledCheckbox: "启用GPS打卡",
    gpsWarning: "需要明确告知员工将采集此信息,请查看隐私声明模板。",
    gpsWarningLink: "查看个人信息设置 →",
    gpsRetentionInputLabel: "保留期限(留空则与考勤数据相同)",
    flexStandardDayMinutesHint: "在带薪年假当天,该分钟数将计入工作时间额度。",
    coreTimeEnabledCheckbox: "设置核心时间",
    coreTimeStartLabel: "核心时间开始",
    coreTimeEndLabel: "核心时间结束",
    coreTimeWeekdaysLabel: "设有核心时间的星期",
    coreTimeHint:
      "核心时间内的缺勤会在月度列表中以「核心时间迟到・早退・缺勤」警告显示。不影响汇总(结算期额度)——是否扣减工资请由薪资方判断。结束时刻必须晚于开始时刻(不支持跨日的核心时间)。",

    submit: "添加此版本",
    submitting: "添加中…",
    submitSuccess: "已添加新版本。",

    workPolicyFormTitle: "新增弹性工作时间设置版本",
    workPolicyNoPermission: "没有权限更改弹性工作时间设置",

    historyTitle: "版本历史",
    workPolicyHistoryTitle: "弹性工作时间设置的版本历史",
    historyEmpty: "暂无历史记录",
    historyColumnEffectiveFrom: "生效日期",
    historyColumnSummary: "内容",

    errors: {
      invalid_body: "请确认输入内容",
      invalid_effective_from: "请确认生效日期",
      invalid_day_boundary_minutes: "日界请输入0〜1439范围内的数值(分钟)",
      invalid_week_start_weekday: "请确认每周起算星期",
      invalid_variable_period_start_day: "请输入1〜28范围内的变形期间起始日",
      invalid_legal_holiday_rule: "请确认法定休息日的指定",
      invalid_break_rule: "请确认休息规则",
      invalid_gps_enabled: "请确认输入内容",
      invalid_gps_retention_days: "GPS坐标保留期限请输入1以上的整数",
      invalid_settlement_period: "当前版本的结算周期仅支持「按月结算」",
      invalid_standard_day_minutes: "标准工作时间请输入1〜1440范围内的数值(分钟)",
      invalid_core_time: "核心时间的结束时刻请设置为晚于开始时刻(不支持跨日设置)",
      invalid_core_time_weekdays: "请至少选择一个设有核心时间的星期",
      effective_from_in_past: "生效日期只能指定为今天或以后(否则会改变过去的统计结果)",
      version_already_exists: "该生效日期已存在版本,请指定其他日期",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /**
   * 津贴对象时间设置(/settings/allowances, docs/design/allowances.md, 2026-08-23 新增)。
   * 不计算金额 —— KIZAMI 只计算「符合该津贴条件的工作时间有多少分钟」。与 settingsAttendance
   * 相同的 effective-dated 版本管理 UI(以 SettingsAttendanceView 为范本),但定义可以在同一租户下
   * 并行存在多个,因此每个定义都单独持有当前值、新增版本表单与历史记录。
   */
  settingsAllowances: {
    title: "津贴对象时间",
    tagline: "将符合特定日期、星期、时间段条件的实际工作时间,计算为津贴发放对象时间。不计算津贴单价与发放金额。",
    noPermission: "没有变更此设置的权限",
    loadFailed: "获取设置失败,请重试",

    listTitle: "津贴定义列表",
    empty: "尚无津贴定义",
    currentConditionsLabel: "当前条件",
    currentEffectiveFrom: "此版本生效日",
    noVersionYet: "目前尚无生效中的版本(仅存在生效日期为未来的版本)",

    nameLabel: "津贴名称",
    namePlaceholder: "例: 早班津贴",
    effectiveFromLabel: "生效日期",
    effectiveFromHint: "此变更仅影响指定日期以后的计算,过去的统计不会改变。",

    conditionsSectionHint: "请至少指定一个条件。所指定的条件之间均为 AND(仅重叠部分为对象)。",
    datesFieldLabel: "特定日期",
    datesFieldHint: "以特定日期为对象。勾选「每年」后将忽略年份,仅按月/日匹配(如年末年初津贴)。勾选「每年」时,日期栏中显示的年份没有实际意义。",
    addDateRow: "添加日期",
    removeDateRow: "删除",
    dateYearlyCheckbox: "每年(忽略年份,仅按月/日匹配)",
    dateRowAriaLabel: "对象日期",
    weekdaysFieldLabel: "星期",
    weekdaysFieldHint: "仅指定的星期为对象。",
    timeBandFieldLabel: "时间段",
    timeBandEnabledCheckbox: "指定时间段",
    timeBandStartLabel: "开始时间",
    timeBandEndLabel: "结束时间",
    timeBandHint: "若结束时间早于或等于开始时间,将视为跨日的时间段(例: 22:00〜次日5:00)。",

    createDefinitionTitle: "创建新的津贴定义",
    createDefinitionButton: "以此内容创建",
    creating: "创建中…",
    createSuccess: "已创建津贴定义。",

    addVersionTitle: "添加新版本",
    addVersionSubmit: "以此内容添加版本",
    addingVersion: "添加中…",
    submitSuccess: "已添加新版本。",

    historyTitle: "版本历史",
    historyEmpty: "尚无历史记录",
    historyColumnEffectiveFrom: "生效日期",
    historyColumnName: "津贴名称",
    historyColumnConditions: "条件",

    /** summarizeAllowanceConditions(lib/allowances.ts)使用的摘要格式标记。 */
    summaryYearlyPrefix: "每年 ",
    summaryDateRangeSeparator: "〜",
    summaryListSeparator: "、",
    summaryPartsSeparator: " ",
    summaryNextDayPrefix: "次日",

    errors: {
      invalid_body: "请确认输入内容",
      invalid_effective_from: "请确认生效日期",
      invalid_name: "请输入津贴名称",
      invalid_conditions: "请确认条件的输入内容(特定日期需要填写日期,时间段的开始与结束时间需不同)",
      conditions_required: "请至少指定一个条件(特定日期、星期或时间段)",
      effective_from_in_past: "生效日期只能指定为今天或以后(否则会改变过去的统计结果)",
      version_already_exists: "该生效日期已存在版本,请指定其他日期",
      not_found: "找不到对应的津贴定义",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /**
   * 排班模板管理(/settings/shift-patterns)。
   * docs/design/shift-work.md 决定事项2「模板分配+个别编辑」中模板一侧的 CRUD。
   * 与 apps/api/src/routes/settings/shift-patterns.ts 一致(仅 GET/POST/:id/archive,无编辑 API)。
   */
  shiftPatterns: {
    title: "排班模板",
    tagline: "定义早班、晚班、休息等模板。创建排班表时将此模板逐日分配。",
    noPermission: "没有使用此页面的权限",
    loadFailed: "获取模板列表失败,请重试",
    empty: "尚无模板,请从「添加模板」创建。",

    addNew: "添加模板",
    columnName: "名称",
    columnDayType: "类型",
    columnTime: "时间",
    columnActions: "操作",
    archive: "归档",
    archivedBadge: "已归档",
    showArchived: "同时显示已归档",

    confirmArchiveTitle: "要归档此模板吗",
    confirmArchiveMessage: "归档后将不再出现在新排班表的分配候选中。已分配的排班不受影响。",
    confirmArchiveLabel: "归档",

    formTitle: "添加新模板",
    nameLabel: "名称",
    namePlaceholder: "例: 早班",
    dayTypeLabel: "类型",
    startLabel: "开始时间",
    endLabel: "结束时间",
    endHint: "若结束时间早于开始时间,将视为跨日工作(夜班)处理。",
    breakLabel: "休息(分钟)",
    submit: "以此内容创建",
    submitting: "创建中…",
    submitSuccess: "已创建模板。",
    cancel: "取消",

    errors: {
      invalid_body: "请确认输入内容",
      invalid_name: "请输入名称",
      invalid_day_type: "请确认类型",
      invalid_minutes: "请确认开始・结束时间",
      invalid_break_minutes: "休息(分钟)请输入0以上的整数",
      not_found: "找不到对应的模板",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /**
   * 排班表创建・确定(/shifts,拥有 shift.manage 权限的用户)。
   * 与 apps/api/src/routes/shifts.ts 一致。period_start_mismatch(变形期间起始日不一致)
   * 因携带数字(正确的起始日),故与 errors(仅字符串)分开,单独设置 periodStartMismatchMessage。
   */
  shifts: {
    title: "排班表",
    tagline: "按成员为每个变形期间创建排班表并确定。确定后的变更将保留在历史记录中。",
    noPermission: "没有使用此页面的权限",
    loadFailed: "获取排班表失败,请重试",

    memberLabel: "目标成员",
    prevPeriod: "← 上一期间",
    nextPeriod: "下一期间 →",
    periodRangeLabel: (start: string, end: string) => `${start} 〜 ${end}`,

    noPlanYet: "此期间尚无排班表。",
    createPlan: "创建此期间的排班表",
    creatingPlan: "创建中…",

    publishedBadge: "已确定",
    unpublishedBadge: "未确定",
    publishAction: "确定",
    publishing: "确定中…",
    confirmPublishTitle: "要确定此排班表吗",
    confirmPublishMessage:
      "确定后的变更将作为历史记录保存,无法删除。事先明确各日、各周的工作时间是变形工作时间制的法律要求。",
    confirmPublishLabel: "确定",

    historyToggleOpen: "查看变更历史",
    historyToggleClose: "收起变更历史",
    historyEmpty: "尚无变更历史",
    historyColumnDate: "日期",
    historyColumnDayType: "类型",
    historyColumnTime: "时间",
    historyColumnCreatedBy: "变更人",
    historyColumnCreatedAt: "日期时间",

    /** 每周网格(行=周,列=星期。docs/design/shift-work.md 决定事项2)。 */
    cellEmpty: "未设置",
    cellDialogTitle: (date: string) => `${date} 的排班`,
    cellDialogPatternLabel: "从模板中选择",
    cellDialogPatternNone: "不使用模板,单独设置",
    cellDialogDayTypeLabel: "类型",
    cellDialogStartLabel: "开始时间",
    cellDialogEndLabel: "结束时间",
    cellDialogBreakLabel: "休息(分钟)",
    cellDialogSave: "保存",
    cellDialogSaving: "保存中…",
    cellDialogCancel: "取消",

    /** 批量分配(按星期指定模板,一次性应用到整个期间。决定事项2「降低录入成本的关键」)。 */
    bulkAssignTitle: "批量分配",
    bulkAssignHint: "按星期指定模板,一次性应用到此整个期间。",
    bulkAssignNoneOption: "不变更",
    bulkAssignApply: "应用此内容",
    bulkAssignApplying: "应用中…",
    bulkAssignSuccess: "已应用。",

    /** 确定前的统计(要求: 确定前需能看到不足之处)。 */
    aggregationTitle: "此期间的统计(参考值)",
    aggregationScheduledLabel: "应工作时间合计",
    aggregationStatutoryFrameLabel: "法定总额度(40小时 × 历日数 ÷ 7)",
    aggregationOverLabel: "已超过总额度",
    aggregationLegalHolidayLabel: "法定休息日天数",
    aggregationLegalHolidayOk: "满足每周1天或每4周4天的要求",
    aggregationLegalHolidayShortage: "不满足每周1天或每4周4天的要求,无法确定",
    aggregationUnassignedDaysLabel: "未设置天数",

    /** 变形期间起始日不一致(400 period_start_mismatch)。当网页猜测的日期有误时显示,并据此修正期间。 */
    periodStartMismatchMessage: (day: number) => `变形期间起始日为${day}日。已修正显示的期间,请重试`,

    errors: {
      invalid_body: "请确认输入内容",
      invalid_user_id: "请确认目标成员",
      invalid_period_start: "请确认期间起始日",
      tenant_settings_not_found: "找不到此期间的考勤设置,请联系管理员",
      plan_already_exists: "此期间的排班表已存在",
      not_found: "找不到对应的排班表",
      invalid_days: "请确认排班内容",
      invalid_date: "请确认日期",
      date_out_of_period: "该日期不在此期间范围内",
      invalid_pattern_id: "找不到所选模板",
      archived_pattern: "所选模板已归档,请选择其他模板",
      invalid_day_type: "请确认类型",
      invalid_minutes: "请确认开始・结束时间",
      invalid_break_minutes: "休息(分钟)请输入0以上的整数",
      duplicate_date: "存在重复的日期",
      already_published: "此排班表已确定",
      legal_holiday_shortage: "法定休息日不足,请设置为满足每周1天或每4周4天",
      invalid_range: "请确认指定的期间",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /** 查看本人排班(/shifts/me,全员可用)。 */
  shiftsMe: {
    title: "我的排班",
    tagline: "以月历形式查看已确定的排班表(计划)。",
    loadFailed: "获取排班失败,请重试",
    prevMonth: "上月",
    nextMonth: "下月",
    empty: "本月尚未登记排班。",
    manageLink: "管理排班表 →",
  },

  departments: {
    title: "部门管理",
    tagline: "创建部门树、修改名称、调整隶属关系及删除部门。",
    noPermission: "没有权限使用此页面",
    loadFailed: "部门列表获取失败,请重试",
    empty: "目前还没有部门,请点击「添加部门」进行创建。",
    topLevel: "顶级",
    addRoot: "添加部门",
    addChild: "添加下属部门",
    rename: "修改名称/上级部门",
    delete: "删除",

    formTitleCreate: "添加部门",
    formTitleEdit: "编辑部门",
    nameLabel: "部门名称",
    namePlaceholder: "例如: 销售部",
    parentLabel: "上级部门",
    parentNone: "无(顶级)",
    save: "保存",
    saving: "保存中…",
    cancel: "取消",

    confirmDeleteTitle: "确定要删除此部门吗",
    confirmDeleteMessage: "删除后无法恢复。若存在下属部门或成员,则无法删除。",
    confirmDeleteLabel: "删除",

    errors: {
      invalid_name: "部门名称请输入1〜200个字符",
      invalid_parent_id: "未找到指定的上级部门",
      invalid_body: "请确认输入内容",
      circular_reference: "不能将自身或下属部门设为上级部门",
      not_found: "未找到目标部门",
      department_not_empty: "仍存在下属部门或成员",
      default: "处理失败,请重试",
    },
  },

  members: {
    title: "成员管理",
    tagline: "变更所属部门、分配权限预设、查看实际生效的权限(可执行的操作)。",
    noPermission: "没有权限使用此页面",
    loadFailed: "成员列表获取失败,请重试",
    empty: "暂无成员",

    columnName: "姓名",
    columnEmail: "邮箱地址",
    columnDepartment: "所属部门",
    columnPresets: "已分配预设",
    columnHireDate: "入职日期",
    columnInviteStatus: "邀请状态",
    /** 离职处理(停用,2026-08-23 Tier 0 第4部分新增)的状态徽章列。 */
    columnStatus: "状态",
    /** 成员个人劳动时间制度(2026-08-23 Tier 0 第4部分新增)的小型展示列。 */
    columnWorkSystem: "劳动时间制度",
    columnActions: "操作",
    noDepartment: "未分配",
    noPresets: "未分配",
    /** workSystemKind 为 null 时(从未分配过)。与 monthly.workSystemValue 保持一致,并新增「未设置」。 */
    workSystemUnset: "未设置",

    detailToggleOpen: "展开详情",
    detailToggleClose: "收起详情",

    /** 已离职处理(停用)成员的状态徽章(2026-08-23 Tier 0 第4部分新增)。 */
    inactiveBadge: "已停用",
    /**
     * 列表筛选(默认仅显示在职成员)。由于此前没有既有的筛选惯例,采用了最简单的
     * 单个复选框开关。
     */
    showInactiveToggle: "同时显示已停用的成员",

    /**
     * 邀请制注册。创建成员的同时会一并发放邀请(POST /members)。
     */
    inviteButton: "邀请成员",
    inviteFormTitle: "邀请成员",
    inviteFormHint: "输入姓名和邮箱地址后将生成邀请链接。所属部门、入职日期、权限预设可以稍后再设置。",
    inviteEmailLabel: "邮箱地址",
    inviteEmailPlaceholder: "例如: yamada@example.com",
    inviteNameLabel: "姓名",
    inviteNamePlaceholder: "例如: 山田太郎",
    inviteDepartmentLabel: "所属部门(选填)",
    inviteHireDateLabel: "入职日期(选填)",
    invitePresetsLabel: "权限预设(选填)",
    inviteCancel: "取消",
    inviteSubmit: "生成邀请链接",
    inviteSubmitting: "生成中…",

    inviteLinkTitle: "邀请链接已生成",
    inviteLinkTargetPrefix: "邀请对象: ",
    inviteLinkWarning: "此链接仅在当前显示一次,关闭后将无法再次查看(可以重新生成)。",
    inviteLinkLabel: "邀请链接",
    inviteLinkCopy: "复制链接",
    inviteLinkCopied: "已复制",
    inviteLinkCopyFailed: "复制失败,请手动选择并复制",
    inviteLinkExpiresLabel: "有效期限",
    inviteLinkDone: "关闭",

    inviteStatusBadge: {
      invited: "邀请中",
      invite_expired: "已过期",
    } as Record<string, string>,

    reissueButton: "重新生成",
    reissueConfirmTitle: "确定要重新生成邀请吗",
    reissueConfirmMessage: "将生成新的邀请链接,之前的链接将失效。",

    revokeInviteButton: "撤销",
    revokeInviteConfirmTitle: "确定要撤销邀请吗",
    revokeInviteConfirmMessage: "此邀请链接将失效。如有需要可以稍后重新生成。",

    /**
     * 管理员发放密码重置(2026-08-23 Tier 0 第4部分新增)。与邀请共用同样的一次性链接展示
     * (InviteLinkDialog 通过 variant="reset" 复用)。仅面向已接受邀请的成员。
     */
    passwordResetButton: "重置密码",
    passwordResetBadge: "重置发放中",
    passwordResetRevokeButton: "撤销",
    passwordResetRevokeConfirmTitle: "确定要撤销密码重置吗",
    passwordResetRevokeConfirmMessage: "此重置链接将失效。如有需要可以稍后重新发放。",

    resetLinkTitle: "密码重置链接已生成",
    resetLinkTargetPrefix: "对象: ",
    resetLinkWarning: "此链接仅在当前显示一次,关闭后将无法再次查看(可以重新发放)。",
    resetLinkLabel: "重置链接",
    resetLinkCopy: "复制链接",
    resetLinkCopied: "已复制",
    resetLinkCopyFailed: "复制失败,请手动选择并复制",
    resetLinkExpiresLabel: "有效期限",
    resetLinkDone: "关闭",

    /**
     * 离职处理(停用·重新启用,2026-08-23 Tier 0 第4部分新增)。停用的影响较大,因此沿用
     * 现有危险操作的处理方式(与批准/驳回相同的 ConfirmDialog,平静的语气),在确认文案中
     * 明确影响(无法登录、当前会话全部失效、待处理的邀请/重置链接失效)。重新启用属于
     * 恢复性操作(不会新造成破坏),因此不设确认步骤。
     */
    deactivateButton: "停用",
    deactivateConfirmTitle: "确定要停用此成员吗",
    deactivateConfirmMessage: "停用后将会发生以下情况。",
    deactivateConfirmImpactLogin: "将无法登录",
    deactivateConfirmImpactSession: "当前所有登录会话都将失效",
    deactivateConfirmImpactInviteReset: "待处理的邀请、密码重置链接将失效",
    reactivateButton: "重新启用",
    reactivating: "重新启用中…",

    twoFactorBadge: "2FA",
    twoFactorResetButton: "重置2FA",
    twoFactorResetConfirmTitle: "确定要重置两步验证吗",
    twoFactorResetConfirmMessage: "这是为同时丢失身份验证器应用和恢复码的成员提供的补救操作。重置后将会发生以下情况。",
    twoFactorResetConfirmImpactLogin: "该成员下次起可仅凭密码登录",
    twoFactorResetConfirmImpactNotify: "系统会通知该成员本人",
    twoFactorResetConfirmImpactAudit: "此操作会记录在审计日志中",
    twoFactorResetConfirmImpactReenroll: "两步验证需由本人重新设置",

    /**
     * 成员个人劳动时间制度分配(2026-08-23 Tier 0 第4部分新增)。GET/POST
     * /members/:id/work-policy(tenant_settings.flex.manage,仅限租户全局范围)。没有此权限时
     * GET 本身也会返回 403,因此整个区块都不显示(参见 MembersView 的判断)。
     */
    workPolicyTitle: "劳动时间制度",
    workPolicyHint: "用于分配月度统计按弹性工作制还是固定工时制计算。变更以追加新分配的形式进行,过去的统计不会改变。",
    workPolicyCurrentLabel: "当前劳动时间制度",
    workPolicyCurrentEffectiveFrom: "此分配的生效日期",
    workPolicyNoneYet: "尚未分配",
    workPolicyHistoryTitle: "分配历史",
    workPolicyHistoryEmpty: "暂无历史记录",
    workPolicyHistoryColumnEffectiveFrom: "生效日期",
    workPolicyHistoryColumnKind: "制度",
    workPolicyFormTitle: "变更制度",
    workPolicyKindLabel: "劳动时间制度",
    workPolicyEffectiveFromLabel: "生效日期",
    workPolicyEffectiveFromHint: "此变更仅影响指定日期以后的计算,过去的统计不会改变。",
    /**
     * 仅在综合计算工时制(monthly_variable)时显示的输入项(v0.7 第4阶段,2026-08-24 新增)。
     * 该制度下每日的应出勤时间由排班决定,因此 standard_day_minutes 仅表示
     * 「1天带薪年假折算为多少分钟」。
     */
    workPolicyStandardDayMinutesLabel: "每日基准应出勤时间(用于年假折算)",
    workPolicyStandardDayMinutesHint:
      "在没有排班的日子里休1天带薪年假时,按多少分钟的工作时间计算(分钟,1〜1440)。默认为480分钟(8小时)。",
    workPolicySubmit: "以此内容变更",
    workPolicySubmitting: "变更中…",
    workPolicySubmitSuccess: "劳动时间制度已变更。",
    workPolicyNoPermission: "没有权限变更此设置",

    departmentChangeLabel: "变更所属部门",
    departmentChangeSaved: "所属部门已变更",

    hireDateLabel: "设置入职日期",
    hireDateSave: "保存",
    hireDateSaving: "保存中…",
    hireDateSaved: "入职日期已保存",
    hireDateUnset: "未设置",
    hireDateWarning: "由于未设置入职日期,无法计算带薪年假的法定授予天数",

    leaveGrantClassTitle: "年假授予区分",
    leaveGrantClassHint:
      "仅当每周约定工作时间不足30小时且每周约定工作日数在4日以下时,才选择比例授予(每周4日以下)(日本劳基法39条3项)。",
    leaveGrantClassLabel: "选择年假授予区分",
    leaveGrantClassOption: {
      full: "普通(每周5日以上)",
      days4: "每周4日",
      days3: "每周3日",
      days2: "每周2日",
      days1: "每周1日",
    },
    leaveGrantClassSave: "保存区分",
    leaveGrantClassSaving: "保存中…",
    leaveGrantClassSaved: "已保存年假授予区分",
    leaveGrantClassNote: "变更将从之后的自动授予·授予预告开始生效(已授予的天数不会改变)。",

    presetAssignTitle: "要分配的预设",
    presetAssignHint: "更改勾选后,下方「可执行的操作」会立即反映变化。保存之前实际分配不会改变。",
    presetAssignSave: "保存分配",
    presetAssignSaving: "保存中…",
    presetAssignSaved: "权限预设的分配已保存",
    presetAssignUnsaved: "存在未保存的更改",
    noPresetsAvailable: "没有可用的权限预设",

    effectiveTitle: "此成员可执行的操作",
    effectiveHint: "所有人始终可以进行本人的打卡、发起申请、查看自己的记录(全员共通,不可更改)。",
    effectiveEmpty: "除上述基本操作外,未分配其他权限。",
    effectiveScopeLabel: "适用范围",
    effectiveSourceLabel: "来源",
    effectiveViaImplication: "。这是其他权限自动包含的查看权限",
    /** 被拒绝(deny)项目的标签与注释(2026-08-24 添加)。 */
    effectiveDeniedChip: "拒绝",
    effectiveDeniedBy: (names: string) => `由于「${names}」的拒绝设置,此权限无法行使`,

    errors: {
      invalid_body: "请确认输入内容",
      invalid_email: "请确认邮箱地址格式",
      invalid_name: "姓名请输入1〜200个字符",
      invalid_department_id: "未找到指定的部门",
      invalid_hire_date: "入职日期请使用YYYY-MM-DD格式输入",
      invalid_leave_grant_class: "年假授予区分的指定不正确",
      email_already_exists: "该邮箱地址已被注册",
      not_found: "未找到目标成员",
      invalid_preset_id: "未找到指定的权限预设",
      self_escalation: "不能为自己添加新的权限",
      self_demotion: "不能取消自己的权限管理权限",
      last_admin: "不能取消最后一位拥有权限管理权限的成员的该权限",
      /** 邀请的重新发放与撤销。 */
      already_active: "该成员已完成正式注册(无需重新发放邀请)",
      already_accepted: "此邀请已被接受",
      already_revoked: "此邀请已被撤销",
      /** 对已离职处理成员重新发放邀请、发放密码重置(2026-08-23 Tier 0 第4部分新增)。 */
      member_inactive: "该成员已办理离职处理。请先重新启用后再进行此操作",
      /** 管理员发放密码重置(2026-08-23 Tier 0 第4部分新增)。无法对尚未接受邀请的成员发放。 */
      not_active: "该成员尚未接受邀请,请改用重新发放邀请",
      /** 撤销密码重置(2026-08-23 Tier 0 第4部分新增)。 */
      password_reset_already_used: "此重置已被使用",
      password_reset_already_revoked: "此重置已被撤销",
      /** 离职处理(停用·重新启用,2026-08-23 Tier 0 第4部分新增)。 */
      cannot_deactivate_self: "无法停用自己的账户",
      already_inactive: "该成员已被停用",
      /** 重新启用(2026-08-23 Tier 0 第4部分新增)。与邀请的 already_active 文案区分开。 */
      member_already_active: "该成员已处于启用状态",
      /** 成员个人劳动时间制度分配(2026-08-23 Tier 0 第4部分新增)。 */
      invalid_work_system_kind: "请选择制度",
      invalid_effective_from: "请确认生效日期",
      effective_from_in_past: "生效日期只能指定为今天或以后(否则会改变过去的统计结果)",
      assignment_already_exists: "该生效日期已存在分配,请指定其他日期",
      /** 每日基准应出勤时间(用于年假折算,v0.7 第4阶段,2026-08-24 新增)。 */
      invalid_standard_day_minutes: "每日基准应出勤时间请输入1〜1440之间的整数分钟",
      version_already_exists: "该生效日期已存在相同设置的版本,请指定其他日期",
      not_enabled: "该成员未开启两步验证",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  presets: {
    title: "权限预设管理",
    tagline: "创建和编辑组合了权限开关与适用范围的预设。为一人分配多个预设时将合并生效。",
    noPermission: "没有权限使用此页面",
    loadFailed: "权限预设获取失败,请重试",
    empty: "暂无权限预设",

    columnName: "名称",
    columnDescription: "说明",
    columnType: "类型",
    columnAssignedCount: "已分配人数",
    columnActions: "操作",
    systemBadge: "标准",
    customBadge: "自定义",
    noDescription: "(无说明)",
    assignedCountUnit: "人",

    addNew: "新建预设",
    edit: "编辑",
    duplicate: "复制后编辑",
    delete: "删除",

    formTitleCreate: "新建权限预设",
    formTitleEdit: "编辑权限预设",
    formReadonlyNote: "标准预设无法编辑。如需更改内容,请使用「复制后编辑」创建新的预设。",
    /** 「复制后编辑」时的初始名称(附加在原名称之后)。 */
    duplicateNameSuffix: (name: string) => `${name}副本`,
    nameLabel: "名称",
    namePlaceholder: "例如: 财务经理",
    descriptionLabel: "说明(选填)",
    descriptionPlaceholder: "写明此预设的用途,便于选择时不会混淆",
    permissionsLabel: "权限",
    scopeLabel: "适用范围",
    dangerousBadge: "重要",
    dangerousNote: "此权限影响较大,请谨慎确认授予对象。",
    impliesViewPrefix: "此权限包含以下查看权限: ",
    /** 拒绝(deny)区块(2026-08-24 添加)。参见 docs/design/permission-catalog.md。 */
    deniesSectionTitle: "拒绝(deny)设置",
    deniesCount: (n: number) => `已拒绝 ${n} 项`,
    deniesWarning: "拒绝优先于所有授予。即使其他预设已授予该权限也会失效",
    deniesHint:
      "这是用于表示「绝对不让此人执行」的设置。通常只要不授予即可。本人的打卡、本人的申请、本人记录的查看无法被拒绝。",
    save: "保存",
    saving: "保存中…",
    cancel: "取消",
    close: "关闭",

    confirmDeleteTitle: "确定要删除此权限预设吗",
    confirmDeleteMessage: "删除后无法恢复。若已分配给成员,则无法删除。",
    confirmDeleteLabel: "删除",

    errors: {
      invalid_name: "名称请输入1〜100个字符",
      invalid_description: "说明请控制在500字以内",
      invalid_grants: "请确认所选权限的内容",
      invalid_denies: "请确认选为拒绝的权限内容",
      last_admin: "保存此更改后,租户内将没有人能够管理权限预设",
      invalid_body: "请确认输入内容",
      not_found: "未找到目标权限预设",
      system_preset: "标准预设无法编辑或删除",
      preset_in_use: "此预设当前已分配给成员,无法删除",
      default: "处理失败,请重试",
    },
  },

  /** 带薪年假首页(/leave)。 */
  leave: {
    title: "带薪年假",
    tagline: "查看余额、申请休假、审批申请。",
    loadFailed: "带薪年假信息获取失败,请重试",

    balanceTitle: "余额",
    annualLabel: "年次带薪年假",
    stockedLabel: "结转休假",
    remainingLabel: "剩余",
    grantedTotalLabel: "授予合计",
    usedTotalLabel: "已使用",
    noGrants: "没有已授予的带薪年假",
    grantBreakdownToggle: "按授予明细查看",
    grantColumnGrantedOn: "授予日期",
    grantColumnDays: "天数",
    grantColumnExpiresOn: "期限",
    grantColumnRemaining: "剩余",
    grantExpired: "已过时效",
    expiringSoonTitle: "即将失效",
    expiringSoonNote: "有在60天内到期的授予额度,建议尽早使用。",

    mandatoryTitle: "年5天强制使用义务的完成情况",
    mandatoryNone: "没有符合条件的授予(年10天以上)",
    mandatoryTakenLabel: "已使用",
    mandatoryRequiredLabel: "要求",
    mandatoryDeadlineLabel: "期限",
    mandatoryShortagePrefix: "还差",
    mandatoryShortageSuffix: "天",
    mandatorySatisfied: "已达标",

    requestFormTitle: "申请休假",
    dateLabel: "目标日期",
    unitLabel: "单位",
    unitFullDay: "全天",
    unitHalfDayAm: "上午半天",
    unitHalfDayPm: "下午半天",
    unitHourly: "按小时",
    minutesLabel: "时长(分钟)",
    minutesPlaceholder: "例如: 120",
    leaveTypeLabel: "使用的额度",
    leaveTypeAnnual: "年次带薪年假",
    leaveTypeStocked: "结转休假",
    reasonLabel: "理由",
    reasonPlaceholder: "请输入休假理由",
    hourlyQuotaPrefix: "按小时计的带薪年假每年最多使用5天(当前 ",
    hourlyQuotaSeparator: " / 上限 ",
    hourlyQuotaSuffix: ")",
    submit: "提交申请",
    submitting: "提交中…",
    submitted: "申请已提交。审批通过后将反映到考勤记录中。",
    targetMonthClosedNote: "本月已确定结算。需要解除结算权限才能批准。",

    requestsTitle: "申请列表",
    requestsEmpty: "暂无申请记录",

    queueSectionTitle: "待审批的休假申请",
    queueSectionTagline: "在您的审批权限范围内,待审批的休假申请。",
    queueEmpty: "暂无待审批的申请",
    columnDate: "目标日期",
    columnUnit: "单位",
    columnLeaveType: "额度",
    columnReason: "理由",
    columnDecision: "审批",

    statusLabel: {
      pending: "审批中",
      /** 仅在两级审批时出现的中间状态,此时尚未反映到考勤记录。 */
      approved_step1: "已一级批准(待二级)",
      approved: "已批准",
      rejected: "已驳回",
      withdrawn: "已撤回",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    unitLabelShort: {
      full_day: "全天",
      half_day_am: "上午半天",
      half_day_pm: "下午半天",
      hourly: "按小时",
    } satisfies Record<"full_day" | "half_day_am" | "half_day_pm" | "hourly", string>,

    /** 时间单位申请列表中,附加在 unitLabelShort.hourly 之后的补充,如「(120分钟)」。 */
    hourlyMinutesSuffix: (minutes: number) => `(${minutes}分钟)`,

    leaveTypeLabelShort: {
      annual: "年次带薪年假",
      stocked: "结转休假",
    } satisfies Record<"annual" | "stocked", string>,

    approve: "批准",
    reject: "驳回",
    withdraw: "撤回",
    decidedBySelf: "本人",
    decisionNoteLabel: "审批备注",
    decisionNotePlaceholder: "备注(选填)",

    confirmApproveTitle: "确定要批准此申请吗",
    confirmApproveMessage: "批准后将反映到考勤记录,月度统计也会随之变化。此操作将被记录到审计日志中。",
    confirmApproveSelfNote: "将被记录为自行批准。",
    confirmRejectTitle: "确定要驳回此申请吗",
    confirmRejectMessage: "驳回后申请将被记录为已驳回状态,不会反映到考勤记录中。",
    confirmWithdrawTitle: "确定要撤回此申请吗",
    confirmWithdrawMessage: "撤回后将解除审批中状态。如有需要可重新提交申请。",

    close: "关闭",
    cancel: "取消",

    errors: {
      invalid_leave_date: "请确认目标日期",
      invalid_reason: "请输入1〜500字的理由",
      invalid_unit: "请确认单位",
      invalid_leave_type: "请确认使用的额度",
      invalid_minutes: "请正确输入时长(分钟)",
      invalid_body: "请确认输入内容",
      hourly_leave_disabled: "此租户尚未启用按小时计休假",
      half_day_leave_disabled: "此租户尚未启用半天休假",
      duplicate_request: "同一天、同一单位的申请已存在",
      exceeds_daily_hours: "超过每日的规定工作时间",
      insufficient_balance: "剩余天数不足",
      hourly_limit_exceeded: "超过按小时计休假的年度上限",
      not_pending: "此申请已被处理",
      not_found: "未找到目标申请",
      forbidden: "没有执行此操作的权限",
      /** 409。两级审批中,完成一级审批的本人试图进行二级审批。 */
      same_approver_as_step1: "完成一级审批的本人无法进行二级审批,请交由其他审批人处理",
      month_closed_requires_unlock: "本月已确定结算。需要解除结算权限才能批准",
      default: "处理失败,请重试",
    },
  },

  /** 带薪年假的制度设置(/settings/leave)。 */
  settingsLeave: {
    title: "带薪年假设置",
    tagline: "设置授予方式、按小时计年假、结转休假等租户全局配置。",
    noPermission: "没有权限更改此设置",
    loadFailed: "设置获取失败,请重试",

    grantMethodSectionTitle: "授予方式",
    grantMethodStatutory: "法定(按入职日期)",
    grantMethodFixedDate: "基准日方式(全公司统一)",
    fixedDateLabel: "基准日(月-日)",
    fixedDatePlaceholder: "例如: 04-01",

    hourlySectionTitle: "按小时计年假",
    hourlyEnabledLabel: "启用按小时计年假",
    hourlyMaxDaysLabel: "年度上限天数(1〜5)",

    halfDaySectionTitle: "半天休假",
    halfDayEnabledLabel: "启用半天休假",

    stockSectionTitle: "失效额度的结转",
    stockEnabledLabel: "启用失效额度结转",
    stockHelp: "将因时效而失效的年次带薪年假结转到单独额度的制度。这不是法定制度,而是公司自行设立的制度。",
    stockMaxDaysLabel: "结转上限天数",
    stockExpiresMonthsLabel: "结转额度的有效期(月数,留空则无期限)",

    save: "保存",
    saving: "保存中…",
    saveSuccess: "设置已保存。",
    saveNote: "此设置适用于整个租户,更改将被记录到审计日志中。",

    adminSectionTitle: "授予与结转管理",
    adminSectionTagline: "选择目标成员后执行,此操作将被记录到审计日志中。",
    targetUserLabel: "目标成员",
    targetUserPlaceholder: "请选择成员",

    autoGrantTitle: "执行法定授予",
    autoGrantDesc: "根据入职日期计算并创建尚未授予的部分,已授予的部分不会重复创建。",
    autoGrantRun: "执行法定授予",
    autoGrantRunning: "执行中…",
    autoGrantResultCreatedPrefix: "",
    autoGrantResultCreatedSuffix: "件已授予",
    autoGrantResultSkippedPrefix: "(因已授予等原因跳过 ",
    autoGrantResultSkippedSuffix: "件)",
    autoGrantEmpty: "没有新的可授予额度",

    manualGrantTitle: "手动授予",
    manualGrantDesc: "以任意天数、期限授予带薪年假。",
    grantedOnLabel: "授予日期",
    daysLabel: "天数",
    expiresOnLabel: "期限(留空则使用默认值: 年次带薪年假为授予日+2年,结转休假为无期限)",
    leaveTypeLabel: "类型",
    leaveTypeAnnual: "年次带薪年假",
    leaveTypeStocked: "结转休假",
    noteLabel: "备注(选填)",
    manualGrantSubmit: "授予",
    manualGrantSubmitting: "处理中…",
    manualGrantSuccess: "已授予。",

    convertTitle: "失效额度结转",
    convertDesc: "将因时效失效的年次带薪年假未使用部分结转为结转休假。",
    convertRun: "执行结转",
    convertRunning: "执行中…",
    convertResultTitle: "结转结果",
    convertResultConvertedPrefix: "结转天数: ",
    convertResultConvertedSuffix: "天",
    convertResultTruncatedPrefix: "(超过上限已截断: ",
    convertResultTruncatedSuffix: "天)",
    convertResultEmpty: "没有可结转的对象",

    errors: {
      invalid_grant_method: "请确认授予方式",
      invalid_fixed_date_mm_dd: "基准日请使用MM-DD格式输入",
      invalid_hourly_leave_enabled: "请确认输入内容",
      invalid_half_day_leave_enabled: "请确认输入内容",
      invalid_stock_conversion_enabled: "请确认输入内容",
      invalid_hourly_leave_max_days: "年度上限天数请输入1〜5范围内的数值",
      invalid_stock_max_days: "请正确输入结转上限天数",
      invalid_stock_expires_months: "请正确输入结转额度的有效期(月数)",
      invalid_body: "请确认输入内容",
      invalid_user_id: "请选择目标成员",
      invalid_granted_on: "请确认授予日期",
      invalid_days: "请正确输入天数",
      invalid_expires_on: "请确认期限",
      invalid_leave_type: "请确认类型",
      invalid_note: "请确认备注",
      not_found: "未找到目标对象",
      hire_date_not_set: "目标成员尚未设置入职日期",
      leave_settings_not_configured: "请先保存带薪年假的制度设置",
      stock_conversion_disabled: "结转设置尚未启用",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /**
   * 年假授予预告(/settings/leave 的「授予预告」区块,v0.7 第4阶段,2026-08-24 新增)。
   * docs/requirements.md §11「预告 → 管理员审批 → 通知本人」。系统不会自行确定授予,
   * 出勤率(《劳动基准法》第39条第1款的八成要求)仅作为参考值呈现。
   */
  leaveGrantProposals: {
    sectionTitle: "授予预告",
    sectionDesc:
      "这是每日自动计算生成的授予「预告」。仅停留在预告状态不会实际授予,需要负责人确认内容并审批后才会生效。出勤率仅供参考,八成要求的最终判断请由人来做出。",
    loadFailed: "获取授予预告失败,请重试",
    empty: "目前没有授予预告",

    columnMember: "成员",
    columnLeaveType: "休假类型",
    columnGrantedOn: "基准日",
    columnDays: "天数",
    columnAttendanceRate: "出勤率(参考值)",
    columnActions: "操作",

    leaveTypeAnnual: "带薪年假",
    leaveTypeStocked: "结转休假",

    basisShift: "按排班计算",
    basisCalendarEstimate: "按日历推算",
    /** 应出勤日为0、无法计算出勤率时显示。表示「未知」,而非0%。 */
    rateUnknown: "—",
    rateBelowThreshold: "可能不足八成 — 请确认",
    proportionalChip: (weekDaysLabel: string) => `比例授予(${weekDaysLabel})`,

    approve: "批准",
    reject: "驳回",
    confirmApproveTitle: "要批准该预告吗",
    confirmApproveMessage: "批准后将按此内容授予带薪年假。授予日期仍为预告中的基准日。",
    confirmRejectTitle: "要驳回该预告吗",
    confirmRejectMessage: "驳回后不会进行授予。填写理由有助于日后追溯经过。",
    noteLabel: "驳回理由(可选)",
    notePlaceholder: "例:出勤率不足八成",
    approveSuccess: "已批准并完成授予。",
    rejectSuccess: "已驳回。",

    historyTitle: "已审批的预告",
    historyEmpty: "没有已审批的预告",
    columnStatus: "状态",
    columnDecidedAt: "审批时间",
    columnDecisionNote: "驳回理由",
    statusLabel: {
      proposed: "未审批",
      approved: "已批准",
      rejected: "已驳回",
      superseded: "已重建",
    },

    errors: {
      not_found: "未找到目标预告",
      not_proposed: "该预告已被审批,请刷新页面确认最新状态",
      grant_already_exists: "相同基准日的授予已存在,请确认是否与手动授予重复",
      invalid_status: "请确认筛选条件",
      invalid_body: "请确认输入内容",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /**
   * 公司内部规定的编辑页面(/settings/help)。将3项撰写原则直接展示在页面上。
   */
  settingsHelp: {
    title: "公司内部规定",
    tagline: "可以在内置帮助(法规、KIZAMI规格)的基础上追加自有公司的规定。",
    noPermission: "没有权限更改此设置",
    loadFailed: "信息获取失败,请重试",

    guidelinesTitle: "撰写指南",
    guideline1:
      "不要照抄法规内容 — 法规部分会自动显示。若重复填写,当法规修订时只有KIZAMI一侧会更新,此处会残留过时内容,造成矛盾",
    guideline2: "只写公司自行决定的内容 — 例如期限、负责窗口、例外情况的处理方式",
    guideline3: "建议以引用工作规则相应条款的形式撰写(例如:「详情请见工作规则第○条」)",

    workRulesSectionTitle: "工作规则链接",
    workRulesDesc: "设置工作规则(PDF等)的URL后,帮助页面将显示「查看工作规则」链接。",
    workRulesUrlLabel: "URL",
    workRulesUrlPlaceholder: "https://example.com/work-rules.pdf",
    workRulesSave: "保存",
    workRulesSaving: "保存中…",
    workRulesSaveSuccess: "工作规则链接已保存。",

    listTitle: "帮助条目",
    listEmployeeGroup: "面向员工",
    listAdminGroup: "面向劳务负责人",
    originLaw: "法规",
    originProduct: "KIZAMI 规格",
    hasOverrideBadge: "已追加",
    selectPrompt: "请从左侧列表中选择帮助条目。",

    referenceTitle: "内置说明",
    editorTitle: "公司规定",
    editorPlaceholderNote: "浅色文字为填写示例,如需直接使用请复制。",
    bodyLabel: "正文(Markdown)",
    save: "保存",
    saving: "保存中…",
    saveSuccess: "公司内部规定已保存。",
    deleteConfirmTitle: "删除公司内部规定",
    deleteConfirmMessage: "将删除此条目的公司规定内容,恢复为仅显示内置说明的状态。",
    delete: "删除",
    deleting: "删除中…",
    deleteSuccess: "公司内部规定已删除。",
    empty: "正文为空,保存后将视为删除。",

    errors: {
      invalid_help_key: "不存在的帮助条目",
      invalid_body_md: "请确认正文内容",
      invalid_url: "URL请使用http(s)格式输入",
      invalid_body: "请确认输入内容",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /**
   * 个人信息相关的模板页面(/settings/privacy)。按要求,页面上需始终显示
   * 这只是模板、并非法律意见的说明。
   */
  settingsPrivacy: {
    title: "个人信息",
    tagline: "根据当前设置生成面向员工的隐私声明与公司内部使用条款模板。",
    noPermission: "没有权限查看此设置",
    loadFailed: "信息获取失败,请重试",

    disclaimer:
      "此文本为KIZAMI提供的模板。请务必根据公司实际情况进行审阅,并在必要时咨询专业人士(社会保险劳务士、律师等)。这不构成法律意见。",

    generatedFromTitle: "生成此模板所依据的设置",
    generatedFromGpsOn: "GPS: 启用",
    generatedFromGpsOff: "GPS: 禁用",
    generatedFromRetention: (days: number) => `位置信息保留期限: ${days}天`,
    generatedFromRetentionSame: "位置信息保留期限: 与打卡记录相同",
    generatedFromNote: "GPS的启用/禁用及保留期限会根据「设置 > 租户配置」等租户设置的变更,在下次显示时更新。",

    noticeSectionTitle: "面向员工的隐私声明",
    noticeSectionDesc: "汇总采集项目、使用目的、保存期限、信息公开等请求渠道的模板,可用于向员工进行公示。",
    termsSectionTitle: "公司内部使用条款(打卡相关规定)",
    termsSectionDesc: "汇总准确打卡义务、禁止代打卡、修正申请流程等内容的模板。",

    copy: "复制",
    copied: "已复制",
    copyFailed: "复制失败,请手动选择并复制",
    download: "下载Markdown",
    registerAsCompanyRule: "登记为公司内部规定",
    registering: "登记中…",
    registerSuccess: "已登记为公司内部规定。可在「设置 > 公司内部规定」中编辑。",
    registerFailed: "登记失败,请重试",
  },

  /**
   * API密钥(公开打卡接口)的管理页面(/settings/api-keys)。
   * 无需权限(自己的密钥任何人都可以签发、吊销)。
   */
  settingsSecurity: {
    title: "两步验证",
    tagline: "在密码之外,再用身份验证器应用中的6位验证码保护你的登录。",
    loadFailed: "获取信息失败,请重试",

    unavailableTitle: "当前环境无法使用",
    unavailableDescription:
      "由于运维人员未配置加密密钥(KIZAMI_ENCRYPTION_KEY),两步验证无法使用。因为无法以加密方式保存身份验证器的密钥。如需使用,请与系统运维负责人联系。",

    statusTitle: "当前状态",
    statusEnabled: "已开启",
    statusDisabled: "未开启",
    enabledAtLabel: "开启时间",
    recoveryRemainingLabel: "剩余恢复码",
    recoveryRemainingValue: (count: number) => `${count} 个`,
    recoveryRemainingWarning: "恢复码所剩不多,请重新生成并保存在安全的地方。",

    enableTitle: "开启两步验证",
    enableDescription: "开启后,下次登录起除密码外还需要输入身份验证器应用的6位验证码。",
    enableStart: "开启两步验证",
    enableStarting: "正在准备…",

    setupTitle: "在身份验证器应用中注册",
    setupManualHint:
      "KIZAMI 不显示二维码。请在身份验证器应用(Google Authenticator、1Password、Authy 等)中选择「手动输入」或「输入设置密钥」,粘贴下面的密钥完成注册。",
    setupSecretLabel: "设置密钥(用于手动输入)",
    setupUriLabel: "otpauth URI(支持的身份验证器应用也可直接使用此字符串注册)",
    setupCodeLabel: "身份验证器应用中显示的6位验证码",
    setupCodePlaceholder: "123456",
    setupSubmit: "开启",
    setupSubmitting: "正在开启…",
    setupCancel: "取消",

    recoveryTitle: "恢复码",
    recoveryWarning: "关闭此界面后将不再显示。请打印,或保存到密码管理工具等安全的地方。",
    recoveryDescription: "当无法使用身份验证器应用时,可代替验证码输入并登录的一次性代码(每个只能使用一次)。",
    recoveryCopyAll: "全部复制",
    recoveryDone: "已保存,关闭",

    copy: "复制",
    copied: "已复制",
    copyFailed: "复制失败,请手动选择后复制",

    verifyTitle: "身份确认",
    verifyDescription: "为防止会话被劫持后被人操作,需要同时输入当前密码和身份验证器应用的6位验证码。",
    passwordLabel: "当前密码",
    codeLabel: "身份验证器应用的6位验证码",

    regenerateTitle: "重新生成恢复码",
    regenerateDescription: "将新签发10个。当前持有的恢复码将全部失效。",
    regenerateSubmit: "重新生成恢复码",
    regenerateSubmitting: "正在重新生成…",

    disableTitle: "关闭两步验证",
    disableDescription: "关闭后,登录将仅需密码。",
    disableSubmit: "关闭两步验证",
    disableSubmitting: "正在关闭…",
    disableConfirmTitle: "确定要关闭两步验证吗",
    disableConfirmMessage: "关闭后将会发生以下情况。",
    disableConfirmImpactPassword: "登录将仅需密码",
    disableConfirmImpactRecovery: "当前持有的恢复码将全部失效",
    disableConfirmImpactReenable: "若要再次开启,需要从在身份验证器应用中注册开始重新设置",
    disabledNotice: "已关闭两步验证。",

    errors: {
      invalid_body: "请检查输入内容",
      invalid_code: "验证码不正确。请确认身份验证器应用的显示后重试",
      invalid_password: "密码不正确",
      setup_required: "注册尚未完成,请从「开启两步验证」重新开始",
      already_enabled: "两步验证已经开启",
      not_enabled: "两步验证尚未开启",
      rate_limited: "尝试次数过多,请稍后再试",
      encryption_unavailable: "当前无法执行此操作,请联系管理员",
      default: "处理失败,请重试",
    },
  },

  settingsApiKeys: {
    title: "API密钥",
    tagline: "用于IC卡读卡器、Slack bot、MCP服务器等无法持有会话Cookie的外部客户端进行打卡的密钥。",
    loadFailed: "信息获取失败,请重试",

    listTitle: "已签发的密钥",
    empty: "暂无已签发的API密钥。",
    columnName: "名称",
    columnScopes: "授权范围",
    columnCreated: "创建日期",
    columnLastUsed: "最后使用",
    columnExpires: "有效期限",
    columnStatus: "状态",
    columnActions: "操作",
    neverUsed: "未使用",
    noExpiry: "无期限",
    statusActive: "有效",
    statusRevoked: "已吊销",
    statusExpired: "已过期",
    revoke: "吊销",
    revoking: "吊销中…",

    revokeConfirmTitle: "吊销API密钥",
    revokeConfirmMessage: "使用此密钥的集成(IC卡读卡器、Slack bot、MCP服务器等)将无法继续工作。此操作无法撤销。",

    scopePunch: "打卡(punch) — 创建和查看自己的打卡记录",
    scopeRead: "查看(read) — 仅查看自己的考勤记录",

    createTitle: "签发新密钥",
    nameLabel: "名称(便于识别用途)",
    namePlaceholder: "例如: 2楼入口IC卡读卡器",
    scopesLabel: "授权范围(可多选)",
    expiresLabel: "有效期限(选填)",
    expiresHint: "留空则表示无期限。",
    issue: "签发",
    issuing: "签发中…",

    createdTitle: "密钥已签发",
    createdWarning: "此值不会再次显示,请妥善保管。",
    createdTokenLabel: "API密钥",
    copy: "复制",
    copied: "已复制",
    copyFailed: "复制失败,请手动选择并复制",
    createdDone: "关闭",

    usageExampleTitle: "使用示例",
    usageExampleDesc: "请将签发的密钥作为Bearer令牌添加到Authorization请求头中发起请求。",
    usageExampleCurlComment: "# 上班打卡",

    errors: {
      invalid_name: "名称请输入1〜100个字符",
      invalid_scopes: "请至少选择一个授权范围",
      invalid_expires_at: "请确认有效期限的格式",
      not_found: "未找到目标密钥",
      already_revoked: "此密钥已被吊销",
      forbidden: "没有执行此操作的权限",
      default: "处理失败,请重试",
    },
  },

  /** 审计日志的只读查看页面(/settings/audit-logs)。 */
  settingsAuditLogs: {
    title: "审计日志",
    tagline: "打卡、修正、审批、结算、权限变更等操作的记录。",
    immutableNote: "审计日志为仅追加记录,事后不会被修改或删除(仅供查看)。",
    loadFailed: "信息获取失败,请重试",
    forbidden: "没有执行此操作的权限",

    filterActionLabel: "操作类型",
    filterActionAll: "全部",
    filterActorLabel: "操作者(用户ID)",
    filterActorPlaceholder: "留空则显示全员",
    filterFromLabel: "期间(开始日期)",
    filterToLabel: "期间(结束日期)",
    filterApply: "筛选",
    filterClear: "清除条件",
    filterInvalidRange: "结束日期须晚于或等于开始日期",

    columnOccurredAt: "日期时间",
    columnActor: "操作者",
    columnAction: "操作类型",
    columnTarget: "对象",
    columnDetail: "详情",
    detailToggle: "显示详情",
    detailUnavailable: "暂无详细信息",

    empty: "没有符合条件的审计日志。",
    loadMore: "加载更多",
    loadingMore: "加载中…",
    loadMoreFailed: "加载更多失败,请重试",
  },
} satisfies Messages;
