/**
 * 표시 문구(한국어). lib/i18n/ja.ts 의 구조를 그대로 한국어로 번역한 것.
 * 타입은 ja 로부터 도출되는 Messages 를 `satisfies` 로 충족시켜, 키의 과부족을 컴파일 에러로 검출한다.
 */
import type { Messages } from "./index";

export const ko = {
  appName: "KIZAMI",
  tagline: "1분 단위로 시간을 새기는 근태관리.",

  nav: {
    dashboard: "홈",
    punch: "출퇴근",
    monthly: "월간",
    corrections: "신청",
    leave: "연차",
    /** 시프트(/shifts, /shifts/me). shift.manage 보유자는 /shifts로, 그 외에는 /shifts/me로 이동합니다(2026-08-24 추가). */
    shifts: "시프트",
    settings: "설정",
    logout: "로그아웃",
  },

  /** 모바일 하단 탭바·「더 보기」시트(2026-08-22 내비게이션 개편 시 추가). */
  mobileNav: {
    more: "더 보기",
    moreAriaLabel: "더 보기 메뉴 열기",
    sheetTitle: "메뉴",
    close: "닫기",
    openNotifications: "알림 보기",
    /** 알림 목록 화면(/notifications, 2026-08-22 추가)으로의 링크. openNotifications(벨 아이콘 열기)와는 다름. */
    allNotifications: "모든 알림 보기",
    stampScreenLink: "스탬프 연출이 있는 출퇴근 화면 열기 →",
  },

  /** 전체 화면 공통 헤더의 테넌트명 표시(2026-08-23 추가). 로고만으로는
   * 「어느 회사의 인스턴스인지」알 수 없다는 요청에 대응. */
  header: {
    tenantAriaLabel: "소속 조직",
  },

  /** 홈(대시보드, 2026-08-22 신설). docs/design/ui-direction.md 「향후 UI 작업 > 4」. */
  dashboard: {
    title: "홈",
    punchSectionTitle: "출퇴근",
    todayTitle: "오늘·이번 달",
    todayWorkedLabel: "오늘의 실근로",
    monthFlexLabel: "이번 달 플렉스 수지",
    monthFlexMoreLink: "월간 보기 →",

    /** 오늘·내일의 시프트(2026-08-24 추가, v0.7 3단계). 시프트가 하나도 없으면 카드 자체를 표시하지 않습니다. */
    shiftCardTitle: "오늘·내일의 시프트",
    shiftCardTodayLabel: "오늘",
    shiftCardTomorrowLabel: "내일",

    todoTitle: "처리 필요",
    todoEmpty: "처리가 필요한 항목이 없습니다.",
    todoLoadFailed: "일부 정보를 가져오지 못했습니다.",

    todoNotificationsTitle: "읽지 않은 알림",
    todoNotificationsCountSuffix: "건",
    todoNotificationsMore: "그 밖에도 읽지 않은 알림이 있습니다",

    todoApprovalsTitle: "승인 대기 중인 신청",
    todoApprovalsCorrections: "출퇴근 수정 신청",
    todoApprovalsLeave: "휴가 신청",
    /** 연차 부여 예고(v0.7 4단계, 2026-08-24 추가). leave.grant.manage 보유자에게만 표시된다. */
    todoApprovalsProposals: "연차 부여 예고",
    todoApprovalsCountSuffix: "건",
    todoApprovalsGoCorrections: "수정 신청 보기 →",
    todoApprovalsGoLeave: "연차유급휴가 보기 →",
    todoApprovalsGoProposals: "부여 예고 보기 →",

    todoWarningsTitle: "경고가 있는 출퇴근 기록일",
    todoWarningsMore: (n: number) => `그 밖에 ${n}일`,
    todoWarningsFix: "수정하기",

    todoDeadlinesTitle: "마감이 임박한 의무",
    todoDeadlinesMandatoryPrefix: "연 5일 취득 의무까지 남은",
    todoDeadlinesMandatorySuffix: "일이 부족합니다(기한: ",
    todoDeadlinesMandatorySuffix2: ")",
    todoDeadlinesExpiring: "곧 소멸되는 연차유급휴가가 있습니다",
    todoDeadlinesGoLeave: "연차유급휴가 보기 →",

    quickLinksTitle: "자주 쓰는 화면",
    quickLinkMonthlyTitle: "월간",
    quickLinkMonthlyDesc: "실근로·플렉스 수지·경고가 있는 날을 확인합니다.",
    quickLinkCorrectionsTitle: "신청",
    quickLinkCorrectionsDesc: "출퇴근 기록의 추가·정정·취소를 신청합니다.",
    quickLinkLeaveTitle: "연차유급휴가",
    quickLinkLeaveDesc: "잔여일수 확인, 휴가 신청을 합니다.",
  },

  /**
   * 대시보드의 「시작하기」섹션(2026-08-22 추가). docs/design/ui-direction.md
   * 「향후 UI 작업 > 5. 온보딩」. 완료되지 않은 항목만 조용히 나열한다
   * (모달로 조작을 강제하지 않는다).
   */
  onboarding: {
    title: "시작하기",
    dismiss: "다시 표시하지 않음",

    punchTitle: "먼저 출퇴근을 기록해 보세요",
    punchReason: "출퇴근을 기록하면 그날부터 실근로시간 집계가 시작됩니다.",
    punchAction: "출퇴근 화면 열기 →",

    notifPrefsTitle: "알림 수신 방법을 설정할 수 있습니다",
    notifPrefsReason: "기본값은 앱 내 알림만입니다. 이메일이나 Webhook으로도 받을 수 있습니다.",
    notifPrefsAction: "알림 설정 열기 →",

    attendanceTitle: "근태 설정이 아직 초기값 그대로입니다",
    attendanceReason: "일계·법정휴일·GPS·플렉스타임 등의 설정을 실제 상황에 맞게 확인해 주세요.",
    attendanceAction: "근태 설정 열기 →",

    channelsTitle: "알림 채널이 설정되어 있지 않습니다",
    channelsReason: "이메일이나 Webhook을 설정하면 출퇴근 누락 등의 알림을 직원에게 전달할 수 있습니다.",
    channelsAction: "알림 설정(회사 전체) 열기 →",

    soloTitle: "아직 멤버가 본인뿐입니다",
    soloReason: "멤버를 초대하면 다른 직원의 출퇴근·신청을 관리할 수 있게 됩니다.",
    soloAction: "멤버 초대하기 →",

    hireDateTitle: (count: number) => `입사일이 설정되지 않은 멤버가 ${count}명 있습니다`,
    hireDateReason: "입사일이 설정되지 않으면 연차유급휴가의 법정 부여일수를 자동으로 계산할 수 없습니다.",
    hireDateAction: "멤버 설정 열기 →",
  },

  /** 테마 전환(헤더의 사용자 메뉴 내, 2026-08-22 다크 모드 대응으로 추가). */
  theme: {
    label: "테마",
    system: "시스템 설정을 따름",
    light: "라이트",
    dark: "다크",
  },

  /**
   * 언어 전환(헤더의 사용자 메뉴 내, 2026-08-23 4개 언어 지원으로 추가).
   * ThemeToggle 과 동일한 위치·동일한 방식(k-header__theme 에 준하는 모양)으로 배치한다.
   * 선택지 라벨 자체(日本語 / English / 한국어 / 简体中文)는 각 언어의 자칭이므로
   * 로케일과 무관하게 고정 — messages 가 아니라 lib/i18n/index.ts 의 LOCALE_NATIVE_NAMES 에서 관리한다.
   */
  language: {
    label: "언어",
  },

  /** 범용의 자잘한 조각(구분 기호 등, 여러 화면에서 재사용하는 것). */
  common: {
    /** 두 개의 짧은 보충 문구를 느슨하게 구분하는 기호(예: 「설정됨(…)」·「변경하지 않으려면 빈칸으로」). */
    hintSeparator: " · ",
  },

  /**
   * HelpTip(법령/KIZAMI 사양/자사 규정 배지가 붙은 도움말, docs/design/ui-direction.md
   * 「가이드·도움말 방침」)관련 UI 문구. 도움말 본문 자체(@kizami/help-content)는
   * 일본어만 지원하며 이번 범위 밖(.en.md 등의 확장은 추후 대응).
   */
  helpTip: {
    originLaw: "법령",
    originProduct: "KIZAMI 사양",
    originCompany: "자사 규정",
    ariaLabelPrefix: "도움말",
    detailLink: "자세히 보기 →",
    workRulesLink: "취업규칙 보기 →",
  },

  /**
   * 날짜/시간 표시의 공통 포맷(lib/time.ts 에서 참조, 2026-08-23 4개 언어 지원으로 추가).
   * 시간대는 JST 고정 그대로(time.ts 상단 주석 참조). 요일·월일의 「표시 방식」만
   * 로케일별로 전환한다.
   */
  time: {
    /** getUTCDay() 의 순서(0=일요일)에 대응하는 요일 약칭. */
    weekdayShort: ["일", "월", "화", "수", "목", "금", "토"] as readonly [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ],
    /** "YYYY년 M월"(월간 화면 제목 등). */
    monthLabel: (year: number, month: number) => `${year}년 ${month}월`,
    /** "M/D(요일)". */
    dateLabel: (month: number, day: number, weekday: string) => `${month}/${day}(${weekday})`,
    /** formatDaysHoursMinutes(연차 잔여일수 표시)의 단위·구분자. */
    unitDay: "일",
    unitHour: "시간",
    unitMinute: "분",
    durationJoin: " ",
  },

  /** 출퇴근 화면의 대형 시계(PunchHome). */
  punchClock: {
    currentTimeAriaLabel: (hm: string, ss: string) => `현재 시각 ${hm}:${ss}`,
  },

  /** 스코프의 한국어 명칭(요건 §4). 좁음→넓음: self < department < department_and_descendants < tenant. */
  scopeLabel: {
    self: "본인만",
    department: "소속 부서",
    department_and_descendants: "소속 부서+하위 부서",
    tenant: "테넌트 전체",
  } satisfies Record<"self" | "department" | "department_and_descendants" | "tenant", string>,

  permissions: {
    categoryLabel: {
      attendance: "출퇴근·신청과 승인",
      leave: "휴가",
      closing: "마감과 내보내기",
      org: "멤버와 조직",
      settings: "설정과 권한",
      other: "기타",
    } as Record<string, string>,
    internalViewLabel: {
      "department.view": "부서 트리 열람",
      "tenant_settings.view": "테넌트 설정 열람",
      "permission_preset.view": "권한 프리셋 목록 열람",
      "permission_assignment.effective_view": "멤버의 실효 권한(할 수 있는 일) 열람",
      "api_key.view": "API 키 목록 열람",
    } as Record<string, string>,
  },

  login: {
    title: "KIZAMI",
    tagline: "1분 단위로 시간을 새기는 근태관리",
    emailLabel: "이메일 주소",
    passwordLabel: "비밀번호",
    submit: "로그인",
    submitting: "로그인 중…",
    errors: {
      invalid_credentials: "이메일 주소 또는 비밀번호가 올바르지 않습니다",
      rate_limited: "시도 횟수가 너무 많습니다. 잠시 기다린 후 다시 시도해 주세요",
    /** SSO(OIDC) 로그인 실패 사유(2026-08-24 추가). 코드는 apps/api/src/lib/oidc.ts 의
     * OidcErrorCode 와 1:1 로 대응한다(콜백은 /login?error=<code> 로 302 리다이렉트). */
      sso_not_enabled: "이 회사에서는 SSO 로그인이 활성화되어 있지 않습니다",
      sso_config_incomplete: "SSO 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요",
      sso_discovery_failed: "IdP(SSO 인증 기반)에 연결하지 못했습니다. 관리자에게 문의해 주세요",
      sso_token_failed: "SSO 인증에 실패했습니다. 다시 시도해 주세요",
      sso_invalid_token: "SSO 인증 정보를 검증하지 못했습니다. 다시 시도해 주세요",
      sso_state_mismatch: "SSO 로그인 절차가 중단되었습니다. 다시 시도해 주세요",
      sso_email_missing: "IdP에서 이메일 주소를 가져오지 못했습니다. 관리자에게 문의해 주세요",
      sso_email_unverified: "IdP에서 이메일 주소가 확인됨으로 표시되어 있지 않습니다. 관리자에게 문의해 주세요",
      sso_user_not_found: "이 이메일 주소의 사용자를 찾을 수 없습니다. 관리자에게 초대를 요청해 주세요",
      sso_failed: "SSO 로그인에 실패했습니다. 다시 시도해 주세요",
      encryption_unavailable: "현재 SSO 로그인을 이용할 수 없습니다. 관리자에게 문의해 주세요",
      default: "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요",
    },

    /** 동일한 이메일+비밀번호가 여러 테넌트에 일치할 경우의 테넌트 선택(2026-08-23 추가).
     * Slack 의 워크스페이스 선택과 유사한 경험을 의도했으며, 비밀번호 재입력은 요구하지 않는다
     * (직전의 검증 결과를 그대로 사용해, 선택한 테넌트로 재전송할 뿐). */
    tenantSelectTitle: "로그인할 회사를 선택해 주세요",
    tenantSelectDescription: "같은 이메일 주소로 여러 회사에 계정이 있습니다.",
    tenantUnnamed: "(이름 미설정)",
    backToEmail: "다른 계정으로 로그인",

    /** SSO(OIDC) 로그인(2026-08-24 추가). 이메일 주소를 입력하면 그 사람이 소속된 회사 중
     * SSO 가 활성화된 곳을 GET /auth/oidc/available 로 조회하여, 해당하면 버튼을 표시한다.
     * 비밀번호 로그인은 계속 사용할 수 있다. */
    ssoDivider: "또는",
    ssoButton: "SSO로 로그인",
    ssoButtonForTenant: (tenantName: string) => `${tenantName}에 SSO로 로그인`,
    ssoStarting: "SSO로 이동 중…",
  },

  /**
   * 초대 수락 화면(/invite/[token], 인증 가드 없음·공개, 2026-08-23 추가).
   * docs/requirements.md §7 「등록은 초대 방식만 허용」. 로그인 화면과 동일한 「흰 배경+중앙 카드」구성.
   * 직원이 처음 접하는 KIZAMI 화면이므로 문구는 특히 신중하게 작성한다(불안감을 주지 않고 헷갈리지 않도록).
   */
  inviteAccept: {
    invitedBySuffix: " 님이 회원님을 초대했습니다",
    invitedByUnnamed: "회사",
    nameLabel: "이름",
    emailLabel: "이메일 주소",
    passwordLabel: "비밀번호(12자 이상)",
    passwordConfirmLabel: "비밀번호(확인)",
    passwordMismatch: "비밀번호가 일치하지 않습니다",
    passwordTooShort: "비밀번호는 12자 이상 입력해 주세요",
    submit: "등록하고 시작하기",
    submitting: "등록 중…",
    loading: "초대 내용을 확인하는 중…",

    invalidTitle: "이 초대 링크는 유효하지 않습니다",
    invalidMessage: "이 초대 링크는 유효하지 않습니다. 관리자에게 문의해 주세요.",
    expiredTitle: "이 초대는 기한이 만료되었습니다",
    expiredMessage: "이 초대는 기한이 만료되었습니다. 관리자에게 재발급을 요청해 주세요.",
    acceptedRedirecting: "등록이 완료되었습니다. 이동하는 중…",

    sessionIssuanceFailedTitle: "계정이 생성되었습니다",
    sessionIssuanceFailedMessage: "계정은 생성되었습니다. 로그인 페이지에서 로그인해 주세요.",
    goToLogin: "로그인 페이지로 이동",

    errors: {
      invalid_password: "비밀번호는 12자 이상 입력해 주세요",
      rate_limited: "시도 횟수가 너무 많습니다. 잠시 기다린 후 다시 시도해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 비밀번호 재설정 수락 화면(/reset/[token], 2026-08-23 Tier 0 4번째 추가, 인증 가드 없음·공개).
   * inviteAccept와 동일한 구조(구성·상태 머신·문구 톤 재사용). 관리자가 발급한 재설정 링크로
   * 새 비밀번호를 설정하면 그대로 로그인 상태가 됩니다(routes/password-resets.ts).
   */
  passwordResetAccept: {
    tenantUnnamed: "회사",
    introSuffix: " 계정의 비밀번호를 재설정합니다",
    nameLabel: "이름",
    emailLabel: "이메일 주소",
    newPasswordLabel: "새 비밀번호(12자 이상)",
    newPasswordConfirmLabel: "새 비밀번호(확인)",
    passwordMismatch: "비밀번호가 일치하지 않습니다",
    passwordTooShort: "비밀번호는 12자 이상 입력해 주세요",
    submit: "비밀번호 재설정",
    submitting: "재설정하는 중…",
    loading: "재설정 내용을 확인하는 중…",

    invalidTitle: "이 재설정 링크는 유효하지 않습니다",
    invalidMessage: "이 재설정 링크는 유효하지 않습니다. 관리자에게 문의해 주세요.",
    expiredTitle: "이 재설정 링크는 기한이 만료되었습니다",
    expiredMessage: "이 재설정 링크는 기한이 만료되었습니다. 관리자에게 재발급을 요청해 주세요.",
    acceptedRedirecting: "비밀번호를 재설정했습니다. 이동하는 중…",

    sessionIssuanceFailedTitle: "비밀번호를 변경했습니다",
    sessionIssuanceFailedMessage: "비밀번호는 이미 변경되었습니다. 번거로우시겠지만 로그인 페이지에서 다시 로그인해 주세요.",
    goToLogin: "로그인 페이지로 이동",

    errors: {
      invalid_password: "비밀번호는 12자 이상 입력해 주세요",
      rate_limited: "시도 횟수가 너무 많습니다. 잠시 기다린 후 다시 시도해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  attendanceState: {
    out: "퇴근 상태",
    working: "근무 중",
    onBreak: "휴게 중",
  } satisfies Record<"out" | "working" | "onBreak", string>,

  punchButtons: {
    clockIn: "출근",
    breakStart: "휴게 시작",
    breakEnd: "휴게 종료",
    clockOut: "퇴근",
  },

  punchHints: {
    clockInDisabled: "근무 외 상태에서만 조작할 수 있습니다",
    breakDisabled: "근무 중에만 조작할 수 있습니다",
    clockOutDisabled: "근무 중에만 조작할 수 있습니다",
  },

  punchKindLabel: {
    clock_in: "출근",
    break_start: "휴게 시작",
    break_end: "휴게 종료",
    clock_out: "퇴근",
  } satisfies Record<"clock_in" | "break_start" | "break_end" | "clock_out", string>,

  today: {
    title: "오늘의 출퇴근 기록",
    empty: "아직 출퇴근 기록이 없습니다",
  },

  /**
   * GPS를 포함한 출퇴근 기록(v0.4, docs/requirements.md §3).
   * 「활성화 시 직원에게 위치 정보를 수집 중임을 명시한다」를 충족하기 위해, GPS가 활성화된 테넌트에서는
   * 출퇴근 버튼 근처에 항상 noticeAlways를 표시한다(토글이나 툴팁 뒤에 숨기지 않는다).
   */
  punchGps: {
    noticeAlways: "이 기록에는 위치 정보가 함께 저장됩니다",
    detailToggle: "자세히",
    reason: "직행직귀 등의 출퇴근 위치를 확인할 수 있도록, 회사 설정에서 GPS 기록이 활성화되어 있습니다.",
    retentionPrefix: "보관 기간: ",
    retentionSameAsAttendance: "근태 데이터와 동일",
    retentionDaysSuffix: "일",
    locating: "위치 정보를 가져오는 중…",
    unavailableNote: "위치 정보를 가져오지 못해 위치 정보 없이 기록했습니다",
  },

  /**
   * 오프라인 시 출퇴근 기록(v0.4). 요청대로 v0.4에서는 오프라인 상태에서의 출퇴근 기록 큐잉을
   * 구현하지 않는다(실제 출퇴근 시각과 기록 시각이 어긋나기 때문). 화면(앱 셸)은
   * Service Worker 캐시로 열 수 있지만, 출퇴근 기록에는 네트워크 연결이 필요함을 명시한다.
   */
  offline: {
    banner: "오프라인 상태입니다. 화면은 표시할 수 있지만, 정확한 시각을 기록하기 위해 출퇴근 기록에는 연결이 필요합니다.",
    punchDisabledHint: "오프라인 상태이므로 출퇴근을 기록할 수 없습니다",
  },

  errors: {
    punchFailed: "출퇴근 기록에 실패했습니다. 다시 시도해 주세요",
    loadFailed: "데이터를 가져오지 못했습니다. 다시 시도해 주세요",
    network: "서버에 연결할 수 없습니다",
  },

  loading: "불러오는 중…",

  monthly: {
    title: "월간",
    prevMonth: "이전 달",
    nextMonth: "다음 달",
    columnDate: "날짜",
    /** 출퇴근 시각(출근→퇴근) 열(2026-08-23 추가). */
    columnStretches: "근무",
    /**
     * 넓은 뷰포트에서는 「근무」 1개 열을 출근·퇴근 2개 열로 나눈다(2026-08-23 추가).
     * 의미는 columnStretches 의 단일 셀 표기(formatStretchRange 등)와 동일하며, 표시 형태만 다르다.
     */
    columnClockIn: "출근",
    columnClockOut: "퇴근",
    columnWorked: "실근로",
    /** insufficient_break 경고 문구에 덧붙이는 부족량(필요·실제). */
    breakShortfallSuffix: (required: string, actual: string) => `(필요 ${required}·실제 ${actual})`,
    columnBreak: "휴게",
    /** 휴게 자동 공제의 병기 라벨(2026-08-23 추가, docs/design/breaks.md 「UI 상의 처리」). */
    autoBreakLabel: "자동",
    columnLateNight: "야간",
    /** 고정시간제일 때만 표시하는 연장근로 열(2026-08-23 추가). */
    columnOvertime: "연장근로",
    columnWarning: "경고",
    columnActions: "작업",
    correctionAction: "수정",
    empty: "이번 달의 출퇴근 데이터가 없습니다",

    /** 아직 퇴근하지 않은 근무 구간(clockOutAt: null). */
    stretchOpenEnded: "—",
    /** 퇴근이 다음 날 역일로 넘어갈 때의 접두사. */
    stretchNextDayPrefix: "익일",
    /**
     * 일계를 넘는 근무의 「수신 측」날짜의 근무 열 맨 앞에 표시하는 접두사(2026-08-23 추가).
     * 「익일」표기(구간 시작일 쪽)와 대칭: 전날부터라면 stretchPrevDayLabel,
     * 이틀 이상 전부터라면 stretchFromDateLabel(M/D)을 사용한다.
     */
    stretchPrevDayLabel: "(전날부터)",
    stretchFromDateLabel: (monthDay: string) => `(${monthDay}부터)`,
    /** 법정 내 연장근로(extraWithinStatutoryMinutes)의 병기 라벨. */
    overtimeExtraLabel: "법정 내",

    /** 현재 표시 중인 근로시간제의 명시(2026-08-23 추가, ui-direction.md 「월간」절). */
    workSystemLabel: "표시 중인 근로시간제",
    workSystemValue: {
      flex: "플렉스타임제",
      fixed: "고정시간제",
      monthly_variable: "1개월 단위 변형근로시간제",
    } satisfies Record<"flex" | "fixed" | "monthly_variable", string>,

    flexBalanceLabel: "플렉스 수지",
    flexBalanceUnit: "분",
    /** 고정시간제에서의 「플렉스 수지 바」대체(2026-08-23 추가). 36협정의 월 45시간 상한에 대한 연장근로 위치. */
    overtimeBarLabel: "연장근로(36협정 월 45시간 상한 대비)",
    overtimeBarUnit: "분",
    /** 상한 대비 남은 시간(미달일 때). */
    overtimeBarRemainingLabel: "남음",
    /** 상한을 초과했을 때(막대만이 아니라 문구로도 알 수 있도록). */
    overtimeBarOverLabel: "상한 초과",

    /**
     * monthly_variable에서의 「플렉스 수지 바」대체(2026-08-24 추가, v0.7 3단계).
     * 기간의 법정 총 한도(figures.variablePeriod.statutoryFrameMinutes) 대비 실근로 위치.
     */
    variablePeriodBarLabel: "기간의 법정 총 한도 대비 실근로",
    variablePeriodBarUnit: "분",
    variablePeriodBarRemainingLabel: "남음",
    variablePeriodBarOverLabel: "총 한도 초과",
    variablePeriodScheduledLabel: "소정 합계",
    variablePeriodRangeLabel: (start: string, end: string) => `변형기간 ${start} 〜 ${end}`,
    /** attributedToThisMonth가 false일 때(결정사항3, 기간 단위의 연장근로가 아직 이번 달에 반영되지 않음). */
    variablePeriodNotAttributedNote: "기간 단위의 연장근로는 기간이 끝나는 달의 마감에 한꺼번에 반영됩니다. 이번 달에는 아직 반영되지 않았습니다",
    /** 마감된 달(figures.source === "snapshot")은 variablePeriod 자체가 null로 반환됩니다. */
    variablePeriodUnavailableNote: "이번 달은 이미 마감되어 변형기간 내역이 표시되지 않습니다(연장근로는 구분별 합계에 포함되어 있습니다)",

    /** monthly_variable의 일별 「소정」열(2026-08-24 추가, DailyBreakdown.scheduledMinutes). */
    columnScheduled: "소정",

    /** 시프트 예실 괴리 경고에 덧붙이는 분수(insufficient_break의 breakShortfallSuffix와 동일한 형태). */
    shiftDeltaSuffix: (delta: string) => `(괴리 ${delta})`,
    shiftActualOnlySuffix: (actual: string) => `(실근로 ${actual})`,
    /** 코어타임 괴리(노동기준법 32조의3, 2026-08-24 추가). 코어타임에 부재한 분수를 병기합니다. */
    coreTimeDeltaSuffix: (delta: string) => `(코어타임 부재 ${delta})`,

    totalsLabel: "구분별 합계",
    /** 수당 대상 시간의 월합계 제목(docs/design/allowances.md「UI」절, 2026-08-23 추가). */
    allowanceTotalsLabel: "수당 대상 시간",
    /** 마감 후 수정 차이 표에서 수당 행임을 알 수 있도록 이름 앞에 붙인다. */
    allowanceDiffPrefix: "수당: ",

    fixedBreakdownLabel: "소정 내·법정 내 연장근로(월 합계)",
    fixedBreakdownWithinScheduledLabel: "소정 내 근로시간",
    fixedBreakdownExtraLabel: "법정 내 연장근로",

    memberSwitcherLabel: "열람 대상",
    memberSwitcherSelfOption: (name: string) => `${name}(본인)`,
    memberSwitcherOthersGroup: "멤버",
    memberSwitcherNoDepartment: "부서 없음",
    memberSwitcherUnknownDepartment: "알 수 없는 부서",
    viewingOthersLabel: (name: string) => `${name}님의 월간 근태(열람 전용)`,
  },

  totalsCategoryLabel: {
    statutory: "소정 내",
    overtime: "연장근로",
    overtime60h: "연장근로(60시간 초과)",
    lateNight: "야간",
    statutoryHoliday: "법정휴일",
  } satisfies Record<"statutory" | "overtime" | "overtime60h" | "lateNight" | "statutoryHoliday", string>,

  /** 시프트 일 구분 라벨(shift_patterns.dayType·shift_days.dayType 공용, 2026-08-24 추가). */
  shiftDayTypeLabel: {
    work: "근무",
    legal_holiday: "법정휴일",
    non_working: "비근무",
  } satisfies Record<"work" | "legal_holiday" | "non_working", string>,

  warningLabel: {
    missing_clock_out: "퇴근 기록이 없어 해당 근무 구간은 집계에서 제외되었습니다",
    duplicate_clock_in: "근무 중 중복된 출근 기록을 무효 처리했습니다",
    clock_out_without_in: "출근하지 않은 상태에서의 퇴근 기록을 무효 처리했습니다",
    break_outside_work: "근무 외 시간의 휴게 기록을 무효 처리했습니다",
    duplicate_break_start: "휴게 중 중복된 휴게 시작 기록을 무효 처리했습니다",
    unmatched_break_end: "대응하는 휴게 시작 기록이 없는 휴게 종료 기록을 무효 처리했습니다",
    clock_out_during_break: "휴게 중 퇴근 기록이 있어, 휴게를 마치고 퇴근한 것으로 처리했습니다",
    mixed_work_system:
      "이 기간 도중에 근로시간제가 변경되었습니다. 기간 시작일 시점의 제도로 이번 달 전체를 집계하고 있습니다. 집계 대상 기간을 나누어 확인하고 싶다면 관리자에게 문의해 주세요",
    insufficient_break: "이 근무의 휴게시간이 법으로 정한 시간에 부족합니다. 휴게 기록 누락이 없는지 확인해 주세요",
    /** 시프트 예실 괴리(docs/design/shift-work.md 「예실 대조」, 2026-08-24 추가). 괴리 분수는 monthly.shiftDeltaSuffix 등으로 병기합니다. */
    missing_shift: "시프트가 등록되지 않은 날에 실근로가 있습니다. 시프트표를 확인해 주세요",
    shift_late_arrival: "시프트 시작 시각보다 늦게 출근했습니다",
    shift_early_leave: "시프트 종료 시각보다 일찍 퇴근했습니다",
    shift_unplanned_work: "시프트에서 휴무로 정한 날에 실근로가 있습니다",
    shift_absence: "시프트에서 근무로 정한 날에 실근로가 없습니다",
    /** 코어타임 괴리(노동기준법 32조의3, 2026-08-24 추가). 부재 분수는 monthly.coreTimeDeltaSuffix로 병기합니다. */
    core_time_late_arrival: "코어타임 지각 — 코어타임 시작보다 늦게 출근했습니다",
    core_time_early_leave: "코어타임 조퇴 — 코어타임 종료보다 일찍 퇴근했습니다",
    core_time_absence: "코어타임 부재 — 코어타임이 있는 날에 실근로가 없습니다",
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
   * 다단계(2단계) 승인의 공통 표시 문구(2026-08-24 추가, docs/design/approval-flows.md).
   *
   * 판단 포인트: 출퇴근 수정 신청·휴가 신청·휴게 자동 공제 취소 신청 3종의 문구가 완전히 같으므로,
   * 종류별 section(corrections / autoBreakWaiver / leave)에 3번 쓰지 않고 한곳에 모은다
   * (3종 × 4개 언어 = 12곳의 중복과 거기서 생기는 문구 어긋남을 구조적으로 막는다).
   * 상태 라벨 자체(approved_step1)만 기존 statusLabel 옆에 둔다.
   */
  approvalSteps: {
    /** requiredSteps >= 2 인 신청 카드에 표시. 「승인됐는데 아직 반영되지 않는」 이유를 알려준다. */
    twoStepNote: "이 신청은 2단계 승인입니다. 1차 승인 후, 테넌트 전체 승인 권한을 가진 사람의 2차 승인으로 반영됩니다.",
    /** 승인 대기열의 각 행에 표시하는 「지금 어느 단계를 기다리는가」. */
    awaitingStep1: "1차 승인 대기",
    awaitingStep2: "2차 승인 대기",
    /** 1차 승인은 했지만 2차 승인 권한(테넌트 전체 스코프)이 없는 사람에게 표시. */
    step2NotYours: "2차 승인은 테넌트 전체 승인 권한을 가진 사람이 수행합니다.",
    /** 1차 승인의 실행자·일시에 붙이는 제목. */
    step1DecidedLabel: "1차 승인",
    /** 각 종류의 decidedBySelf와 맞춘다. */
    step1DecidedBySelf: "본인",
  },

  corrections: {
    title: "출퇴근 수정 신청",
    tagline: "출퇴근 기록의 추가·정정·취소를 신청합니다. 승인되면 근태 기록에 반영됩니다.",

    formTitle: " 수정 신청",
    formHint: "신청이 승인되면 출퇴근 기록에 반영되고, 월간 집계에도 반영됩니다.",
    close: "닫기",
    cancel: "취소",
    submit: "신청하기",
    submitting: "전송 중…",
    submitted: "신청을 전송했습니다. 승인되면 출퇴근 기록에 반영됩니다.",

    currentPunchesTitle: "이날의 출퇴근 기록",
    currentPunchesEmpty: "이날의 출퇴근 기록이 아직 없습니다",

    /** 추가/정정/취소(/휴게 취소) 모드를 선택하는 radiogroup 의 aria-label. */
    modeGroupAriaLabel: "작업 유형",
    modeAdd: "기록 추가",
    modeCorrect: "기존 기록 정정",
    modeCancel: "기존 기록 취소",

    kindLabel: "종류",
    timeLabel: "시각",
    targetLabel: "대상 기록",
    targetPlaceholder: "대상을 선택해 주세요",
    targetEmpty: "대상으로 지정할 수 있는 기록이 없습니다",
    reasonLabel: "사유",
    reasonPlaceholder: "수정이 필요한 사유를 입력해 주세요",

    typeAdd: "추가",
    typeCorrect: "정정",
    typeCancel: "취소",
    targetUnavailable: "대상 기록 정보를 가져오지 못했습니다(이미 반영됨 등)",

    statusLabel: {
      pending: "신청 중",
      /** 2단계 승인일 때만 나타나는 중간 상태. 아직 출퇴근 기록에는 반영되지 않았다. */
      approved_step1: "1차 승인됨(2차 대기)",
      approved: "승인됨",
      rejected: "반려",
      withdrawn: "철회",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    columnTarget: "대상 일시",
    columnContent: "내용",
    columnReason: "사유",
    columnDecision: "결재",

    approve: "승인",
    reject: "반려",
    withdraw: "철회",

    decidedByLabel: "결재자",
    decidedAtLabel: "결재 일시",
    decisionNoteLabel: "결재 메모",
    decisionNotePlaceholder: "메모(선택)",
    decidedBySelf: "본인",

    confirmApproveTitle: "이 신청을 승인하시겠습니까",
    confirmApproveMessage:
      "승인하면 근태 기록에 반영되어 월간 집계가 변경됩니다. 이 작업은 감사 로그에 기록됩니다.",
    confirmApproveSelfNote: "자기 승인으로 기록됩니다.",
    confirmRejectTitle: "이 신청을 반려하시겠습니까",
    confirmRejectMessage: "반려하면 신청이 반려 완료 상태로 기록되며, 출퇴근 기록에는 반영되지 않습니다.",
    confirmWithdrawTitle: "이 신청을 철회하시겠습니까",
    confirmWithdrawMessage: "철회하면 신청 중 상태가 해제됩니다. 필요하다면 다시 신청할 수 있습니다.",
    confirmProceed: "실행",

    empty: "신청이 아직 없습니다",

    queueSectionTitle: "승인 대기 중인 정정 신청",
    queueSectionTagline: "승인 권한이 있는 범위 내에서 승인 대기 중인 정정 신청입니다.",
    queueEmpty: "승인 대기 중인 신청이 없습니다",

    errors: {
      already_superseded: "대상 기록은 이미 다른 신청으로 수정되었습니다",
      not_pending: "이 신청은 이미 처리되었습니다",
      not_found: "대상 신청을 찾을 수 없습니다",
      invalid_reason: "사유를 1~500자로 입력해 주세요",
      invalid_target_event: "대상 기록을 찾을 수 없습니다. 다시 선택해 주세요",
      invalid_proposed_kind: "기록 종류를 확인해 주세요",
      invalid_proposed_occurred_at: "시각 형식을 확인해 주세요",
      proposed_occurred_at_in_future: "미래 시각은 지정할 수 없습니다",
      invalid_request_shape: "입력 내용을 확인해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_status: "표시할 수 없는 상태가 지정되었습니다",
      /** 409. 2단계 승인에서 1차 승인을 한 본인이 2차 승인을 하려고 한 경우. */
      /** 403. 테넌트 전체 스코프가 없는 승인자가 2차 승인을 시도한 경우 등. */
      forbidden: "이 작업을 수행할 권한이 없습니다",
      same_approver_as_step1: "1차 승인을 한 본인은 2차 승인을 할 수 없습니다. 다른 승인자에게 요청해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 휴게 자동 공제 취소 신청(2026-08-23 추가). docs/design/breaks.md 「채택한 설계」의
   * UI 측면. correction_requests(출퇴근 수정 신청)와는 별도의 테이블·플로우이지만,
   * 승인 화면은 같은 위치(/corrections)·같은 방식(ConfirmDialog·k-modal)을 따른다.
   */
  autoBreakWaiver: {
    /** CorrectionForm(월간의 수정 모달) 내의 새 모드 탭. */
    modeWaiver: "휴게를 취하지 못했다",
    /** 자동 공제가 있는 날에 모달 상단에 표시하는 안내. */
    deductedNotice: (amount: string) => `이날은 자동으로 ${amount}가 휴게시간으로 공제되었습니다.`,
    formHint: "실제로는 휴게를 취하지 못한 경우의 신청입니다. 승인되면 이날의 자동 공제가 사라지며, 휴게가 부족하면 경고가 표시됩니다.",
    reasonLabel: "사유",
    reasonPlaceholder: "휴게를 취하지 못한 사유를 입력해 주세요",
    submit: "신청하기",
    submitting: "전송 중…",

    typeLabel: "휴게 자동 공제 취소",
    columnDate: "대상일",
    columnReason: "사유",
    columnDecision: "결재",

    ownSectionTitle: "휴게 자동 공제 취소 신청",
    ownSectionTagline: "본인이 신청한 휴게 자동 공제 취소 신청 목록입니다.",
    queueSectionTitle: "승인 대기 중인 취소 신청",
    queueSectionTagline: "승인 권한이 있는 범위 내에서, 승인 대기 중인 취소 신청입니다.",
    empty: "신청이 아직 없습니다",
    queueEmpty: "승인 대기 중인 신청이 없습니다",

    statusLabel: {
      pending: "신청 중",
      /** 2단계 승인일 때만 나타나는 중간 상태. 아직 출퇴근 기록에는 반영되지 않았다. */
      approved_step1: "1차 승인됨(2차 대기)",
      approved: "승인됨",
      rejected: "반려",
      withdrawn: "철회",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    approve: "승인",
    reject: "반려",
    withdraw: "철회",
    decisionNoteLabel: "결재 메모",
    decisionNotePlaceholder: "메모(선택)",
    decidedBySelf: "본인",

    confirmApproveTitle: "이 신청을 승인하시겠습니까",
    confirmApproveMessage:
      "승인하면 이날의 자동 공제가 사라지고 월간 집계가 변경됩니다. 휴게가 부족하면 경고가 표시됩니다. 이 작업은 감사 로그에 기록됩니다.",
    confirmApproveSelfNote: "자기 승인으로 기록됩니다.",
    confirmRejectTitle: "이 신청을 반려하시겠습니까",
    confirmRejectMessage: "반려하면 신청이 반려 완료 상태로 기록되며, 자동 공제는 그대로 유지됩니다.",
    confirmWithdrawTitle: "이 신청을 철회하시겠습니까",
    confirmWithdrawMessage: "철회하면 신청 중 상태가 해제됩니다. 필요하다면 다시 신청할 수 있습니다.",

    errors: {
      invalid_waive_date: "대상일을 확인해 주세요",
      invalid_reason: "사유를 1~500자로 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_status: "표시할 수 없는 상태가 지정되었습니다",
      not_pending: "이 신청은 이미 처리되었습니다",
      already_approved: "이날의 취소는 이미 승인되었습니다",
      not_found: "대상 신청을 찾을 수 없습니다",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      /** 409. 2단계 승인에서 1차 승인을 한 본인이 2차 승인을 하려고 한 경우. */
      same_approver_as_step1: "1차 승인을 한 본인은 2차 승인을 할 수 없습니다. 다른 승인자에게 요청해 주세요",
      month_closed_requires_unlock: "이번 달은 마감이 완료되었습니다. 승인하려면 마감 해제 권한이 필요합니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  notifications: {
    bellLabel: "알림",
    title: "알림",
    empty: "알림이 없습니다",
    unread: "읽지 않음",
    markRead: "읽음으로 표시",
    markReadFailed: "읽음으로 표시하지 못했습니다. 다시 시도해 주세요",
    subjectDateLabel: "대상일",
    receivedAtLabel: "수신",
    openCorrection: "이날의 수정 신청 열기",
    /** leave_* 종류에서의 링크(2026-08-22 추가, 알림 목록 화면). */
    openLeave: "연차유급휴가 화면 열기",
    openLeaveSettings: "연차 설정 화면 열기",
    /** overtime_* 종류에서의 링크(2026-08-22 추가, 알림 목록 화면). */
    openMonthly: "월간 화면 열기",
    loadFailed: "알림을 가져오지 못했습니다. 다시 시도해 주세요",
    /** 벨 아이콘 드롭다운 하단의 링크(2026-08-22 추가). */
    viewAll: "모든 알림 보기 →",
  },

  /** 알림 목록 화면(/notifications, 2026-08-22 추가). 벨 아이콘 드롭다운과는 별도로 과거 알림을 거슬러 볼 수 있다. */
  notificationsPage: {
    title: "알림",
    tagline: "과거 알림을 확인할 수 있습니다.",
    filterStatusGroupLabel: "읽음 상태로 필터링",
    filterStatusAll: "전체",
    filterStatusUnread: "읽지 않음만",
    filterTypeGroupLabel: "종류로 필터링",
    filterTypeAll: "모든 종류",
    filterTypeMissingClockOut: "출퇴근 누락",
    filterTypeOvertime: "36협정",
    filterTypeLeave: "연차",
    markAllRead: "표시 중인 항목 모두 읽음 처리",
    markAllReadPending: "처리 중…",
    empty: "알림이 없습니다",
    emptyFiltered: "이 조건에 일치하는 알림이 없습니다",
    /** API가 최대 100건까지만 반환하기 때문(사양상의 제약, API는 변경하지 않음). */
    truncatedNotice: "최근 100건만 표시하고 있습니다. 그 이전의 알림은 표시되지 않습니다.",
  },

  settingsNotifications: {
    title: "알림 설정(회사 전체)",
    tagline: "테넌트 전체의 알림 채널(Webhook·이메일)을 설정합니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    /** docs/requirements.md §7: 개인 설정(/settings/notifications/me)과의 차이를 화면에서 명시한다. */
    distinctionBanner:
      "이곳은 회사 전체 채널(SMTP 서버·공유 Webhook 등)의 설정입니다. 본인이 알림을 어떻게 받을지(이메일·개인 Webhook 활성화 여부)는 「개인 알림 설정」에서 설정해 주세요.",
    linkToPersonalSettings: "개인 알림 설정 열기 →",

    webhookSectionTitle: "Webhook",
    webhookEnabledLabel: "Webhook 알림 활성화",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "설정됨",
    webhookUrlNotConfigured: "미설정",
    keepIfBlankHint: "변경하지 않으려면 빈칸으로 두세요",

    smtpSectionTitle: "이메일(SMTP)",
    smtpEnabledLabel: "이메일 알림 활성화",
    smtpHostLabel: "SMTP 호스트",
    smtpPortLabel: "포트",
    smtpUserLabel: "사용자 이름",
    smtpFromLabel: "발신자 이메일 주소",
    smtpPasswordLabel: "비밀번호",
    smtpPasswordConfigured: "설정됨",
    smtpPasswordNotConfigured: "미설정",

    save: "저장",
    saving: "저장 중…",
    saveNote: "이 설정은 테넌트 전체에 적용됩니다. 변경 사항은 감사 로그에 기록됩니다.",
    saveSuccess: "설정을 저장했습니다.",

    testSend: "테스트 발송",
    testSendConfirmTitle: "테스트 알림을 발송하시겠습니까",
    testSendConfirmMessage: "저장된 설정으로 실제로 1건을 발송합니다.",
    testSendConfirmLabel: "발송",
    testSendResultTitle: "테스트 발송 결과",
    testSendOk: "성공",
    testSendFailed: "실패",
    testSendChannelLabel: {
      webhook: "Webhook",
      smtp: "이메일(SMTP)",
    } as Record<string, string>,

    loading: "불러오는 중…",
    loadFailed: "설정을 가져오지 못했습니다. 다시 시도해 주세요",

    errors: {
      invalid_webhook_enabled: "입력 내용을 확인해 주세요",
      invalid_smtp_enabled: "입력 내용을 확인해 주세요",
      invalid_webhook_url: "Webhook URL 형식을 확인해 주세요(http/https로 시작하는 유효한 URL을 입력해 주세요)",
      invalid_smtp_host: "SMTP 호스트를 확인해 주세요",
      invalid_smtp_user: "사용자 이름을 확인해 주세요",
      invalid_smtp_from: "발신자 이메일 주소를 확인해 주세요",
      invalid_smtp_password: "비밀번호를 확인해 주세요",
      invalid_smtp_port: "포트 번호는 1~65535 범위로 입력해 주세요",
      invalid_smtp_config: "이메일 알림을 활성화하려면 호스트·포트·발신자를 모두 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      not_configured: "활성화된 채널이 설정되어 있지 않습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 개인 알림 설정(/settings/notifications/me, 2026-08-22 추가).
   * docs/requirements.md §7 「알림 설정의 2계층 구조」— 테넌트 설정(settingsNotifications, 위)과는
   * 별개. 문구에서도 명확히 구분한다(요청: 「기존 /settings/notifications 와의 차이를 화면에서 명시」).
   */
  settingsPersonalNotifications: {
    title: "개인 알림 설정",
    tagline: "본인이 알림을 어떻게 받을지에 대한 설정입니다. 누구나 자신의 설정만 변경할 수 있습니다.",

    distinctionBanner:
      "이곳은 본인의 수신 방식 설정입니다. 회사 전체 채널(SMTP 서버·공유 Webhook 등)을 설정하려면 「알림 설정(회사 전체)」을 열어 주세요.",
    distinctionBannerNoAccess: "이곳은 본인의 수신 방식 설정입니다. 회사 전체 채널 설정은 관리자에게 문의해 주세요.",
    linkToTenantSettings: "알림 설정(회사 전체) 열기 →",

    categoriesSectionTitle: "알림 종류별 수신 방식",
    categoryColumnInapp: "앱 내",
    categoryColumnEmail: "이메일",
    categoryColumnWebhook: "개인 Webhook",
    /** 2026-08-24 추가. VAPID 키가 설정된 배포(pushAvailable=true)에서만 열을 표시한다. */
    categoryColumnPush: "푸시 알림",
    inappAlwaysOnHint: "앱 내 알림은 항상 켜져 있습니다(변경할 수 없습니다).",
    categories: {
      missing_clock_out: "출퇴근 누락",
      overtime_alert: "36협정·연장근로 알림",
      leave_alert: "연차 소멸 임박·연 5일 취득 의무 알림",
      /** 2026-08-23 추가. 수정 계열 신청(휴게 자동 공제 취소 등)의 승인·반려 알림. */
      correction_alert: "신청 승인·반려(휴게 자동 공제 취소 등)",
      /** 2026-08-23 Tier 0 4번째 추가. 승인 권한을 가진 사람을 위한 — 관할 범위 내 멤버로부터 신청이 도착했을 때의 알림. */
      approval_request: "승인 요청(관할 범위 내 멤버로부터 신청이 도착했을 때. 승인 권한이 있는 분 대상)",
      /** 2026-08-24 追加。前日の自分の勤務がシフトとずれたときの本人向け通知。 */
      shift_variance: "시프트와의 차이(자신의 근무가 시프트와 어긋났을 때. 지각·조퇴·결근 가능성 등)",
    } as Record<string, string>,

    emailSectionTitle: "알림 수신 이메일 주소",
    emailAddressLabel: "이메일 주소",
    emailAddressPlaceholder: "입력하지 않으면 계정 이메일 주소를 사용합니다",
    emailAddressEffectiveHint: (email: string) => `현재 수신 주소: ${email}`,

    webhookSectionTitle: "개인 Webhook",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "설정됨",
    webhookUrlNotConfigured: "미설정",
    keepIfBlankHint: "변경하지 않으려면 빈칸으로 두세요",


    /**
     * 브라우저 푸시 알림(2026-08-24 추가, docs/design/web-push.md).
     * 구독은 **브라우저마다** 필요하다(PC와 스마트폰은 각각 허용해야 한다).
     */
    pushSectionTitle: "브라우저 푸시 알림",
    pushHint: "구독은 브라우저마다 필요합니다. 다른 기기나 브라우저에서도 받으려면 그쪽에서도 같은 조작을 해 주세요.",
    pushEnable: "이 브라우저에서 푸시 알림 받기",
    pushEnabling: "설정 중…",
    pushDisable: "이 브라우저에서 받지 않기",
    pushDisabling: "해제 중…",
    pushSubscribed: "이 브라우저는 구독되어 있습니다.",
    pushNotSubscribed: "이 브라우저는 아직 구독하지 않았습니다.",
    pushUnsupported: "이 브라우저는 푸시 알림을 지원하지 않습니다.",
    pushPermissionDenied:
      "알림이 차단되어 있습니다. 브라우저 주소 표시줄의 자물쇠(또는 사이트 정보) 아이콘에서 사이트 설정을 열고 「알림」을 「허용」으로 변경한 뒤 다시 시도해 주세요.",
    pushPermissionDismissed: "알림 권한을 얻지 못했습니다. 다시 시도해 주세요.",
    pushUnavailable: "이 KIZAMI에서는 푸시 알림이 활성화되어 있지 않습니다. 관리자에게 문의해 주세요.",
    pushFailed: "푸시 알림 설정에 실패했습니다. 다시 시도해 주세요.",

    save: "저장",
    saving: "저장 중…",
    saveSuccess: "설정을 저장했습니다.",

    testSend: "테스트 발송",
    testSendConfirmTitle: "테스트 알림을 발송하시겠습니까",
    testSendConfirmMessage: "저장된 개인 Webhook으로 실제로 1건을 발송합니다.",
    testSendConfirmLabel: "발송",
    testSendResultTitle: "테스트 발송 결과",
    testSendOk: "성공",
    testSendFailed: "실패",

    loading: "불러오는 중…",
    loadFailed: "설정을 가져오지 못했습니다. 다시 시도해 주세요",

    errors: {
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_categories: "알림 종류 지정을 확인해 주세요",
      invalid_email_address: "이메일 주소 형식을 확인해 주세요",
      invalid_webhook_url: "Webhook URL 형식을 확인해 주세요(http/https로 시작하는 유효한 URL을 입력해 주세요)",
      encryption_unavailable: "현재 이 항목을 저장할 수 없습니다. 관리자에게 문의해 주세요",
      not_configured: "개인 Webhook이 설정되어 있지 않습니다",
      decryption_failed: "저장된 값을 읽어올 수 없습니다. 다시 설정해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * Slack 슬래시 커맨드 출퇴근 연동 설정(/settings/slack, 2026-08-22 추가, 회사 전체).
   * docs/external-api/slack.md 가 사양의 기준.
   */
  settingsSlack: {
    title: "Slack 연동",
    tagline: "Slack 슬래시 커맨드(/punch)로 출퇴근을 기록할 수 있도록 하는 설정입니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    setupGuideHint: "도입 절차(Slack 앱 생성·Signing Secret 확인 방법)는 docs/external-api/slack.md 를 참조해 주세요.",

    teamIdLabel: "Slack 워크스페이스 ID(Team ID)",
    teamIdPlaceholder: "T0123456",
    teamIdHint: "Slack의 「Basic Information」 페이지 등에서 확인할 수 있습니다. 테넌트 하나당 워크스페이스 하나만 설정할 수 있습니다.",

    signingSecretLabel: "Signing Secret",
    signingSecretConfigured: "설정됨",
    signingSecretNotConfigured: "미설정",
    keepIfBlankHint: "변경하지 않으려면 빈칸으로 두세요",

    enabledLabel: "Slack 출퇴근 기록 활성화",
    enabledHint: "활성화하려면 워크스페이스 ID와 Signing Secret이 모두 설정되어 있어야 합니다.",

    save: "저장",
    saving: "저장 중…",
    saveSuccess: "설정을 저장했습니다.",
    saveNote: "이 설정은 테넌트 전체에 적용됩니다. 변경 사항은 감사 로그에 기록됩니다.",

    loading: "불러오는 중…",
    loadFailed: "설정을 가져오지 못했습니다. 다시 시도해 주세요",

    linkNavHint: "직원 본인의 Slack 계정 연동은 「",
    linkNavLinkLabel: "Slack 연동용 토큰 입력",
    linkNavHintSuffix: "」에서 진행할 수 있습니다(권한 불필요).",

    errors: {
      invalid_enabled: "입력 내용을 확인해 주세요",
      invalid_team_id: "워크스페이스 ID를 확인해 주세요",
      invalid_signing_secret: "Signing Secret을 확인해 주세요",
      invalid_slack_config: "활성화하려면 워크스페이스 ID와 Signing Secret을 모두 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      encryption_unavailable: "현재 이 항목을 저장할 수 없습니다. 관리자에게 문의해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /** SSO(OIDC) 설정 화면(/settings/sso, 2026-08-24 추가). docs/design/sso-oidc.md 가 사양의 정본. */
  settingsSso: {
    title: "SSO(OIDC)",
    tagline: "Google Workspace·Entra ID 등의 IdP 와 OIDC 로 연동하여 SSO 로그인을 사용할 수 있게 합니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    setupGuideHint: "IdP 측 앱 등록 절차와 이 화면 각 항목의 의미는 docs/design/sso-oidc.md 를 참조해 주세요.",

    noAutoProvisioningNote: "SSO 는 기존 멤버의 로그인 수단입니다. IdP 에 계정이 있어도 KIZAMI 에 초대되지 않은 사람은 로그인할 수 없습니다(멤버가 자동으로 생성되지 않습니다).",

    redirectUriLabel: "IdP 에 등록할 리디렉션 URI",
    redirectUriHint: "IdP 측 앱 설정에서 이 URL 을 「승인된 리디렉션 URI」로 등록해 주세요.",

    issuerLabel: "issuer(발급자 URL)",
    issuerPlaceholder: "https://accounts.google.com",
    issuerHint: "https 로 시작하는 URL 만 지정할 수 있습니다. 설정 정보는 {issuer}/.well-known/openid-configuration 에서 자동으로 가져옵니다.",

    clientIdLabel: "클라이언트 ID",
    clientIdHint: "IdP 에서 앱을 등록하면 발급됩니다. 비밀 정보가 아니므로 이 화면에 그대로 표시됩니다.",

    clientSecretLabel: "클라이언트 시크릿",
    clientSecretConfigured: "설정됨",
    clientSecretNotConfigured: "미설정",
    keepIfBlankHint: "변경하지 않으려면 빈칸으로 두세요",

    allowUnverifiedLabel: "이메일 주소가 미확인이어도 로그인 허용",
    allowUnverifiedHint: "기본값은 비활성화입니다. 활성화하면 IdP 가 email_verified 를 반환하지 않는 구성에서도 로그인할 수 있지만, 임의의 이메일 주소를 주장할 수 있는 IdP 에서는 사칭이 성립할 수 있으므로 자체 IdP 등 특별한 사정이 있을 때만 활성화해 주세요.",

    enabledLabel: "SSO 로그인 활성화",
    enabledHint: "활성화하려면 issuer·클라이언트 ID·클라이언트 시크릿 3가지가 모두 설정되어 있어야 합니다.",

    save: "저장",
    saving: "저장 중…",
    saveSuccess: "설정을 저장했습니다.",
    saveNote: "이 설정은 테넌트 전체에 적용됩니다. 변경 사항은 감사 로그에 기록됩니다.",

    loading: "불러오는 중…",
    loadFailed: "설정을 가져오지 못했습니다. 다시 시도해 주세요",

    errors: {
      invalid_enabled: "입력 내용을 확인해 주세요",
      invalid_issuer: "issuer 는 https 로 시작하는 URL 이어야 합니다(쿼리·프래그먼트는 붙일 수 없습니다)",
      invalid_client_id: "클라이언트 ID 를 확인해 주세요",
      invalid_client_secret: "클라이언트 시크릿을 확인해 주세요",
      invalid_allow_unverified_email: "입력 내용을 확인해 주세요",
      invalid_sso_config: "활성화하려면 issuer·클라이언트 ID·클라이언트 시크릿을 모두 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      encryption_unavailable: "현재 이 항목을 저장할 수 없습니다. 관리자에게 문의해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 다단계 승인 설정(/settings/approval-flow, 2026-08-24 추가). docs/design/approval-flows.md가 사양의 기준.
   * 종류별로 「1단계」「2단계(1차+2차 승인)」를 고르는 화면이지만 승인 체계 자체를 바꾸는 설정이므로,
   * 오해하기 쉬운 점(이미 올라간 신청에는 적용되지 않음·2차 승인자는 테넌트 전체 스코프)을
   * 화면에 반드시 표시한다.
   */
  settingsApprovalFlow: {
    title: "다단계 승인",
    tagline: "신청 종류별로 승인을 1단계로 할지, 2단계(1차 승인+2차 승인)로 할지 정합니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    loadFailed: "설정을 불러오지 못했습니다. 다시 시도해 주세요",

    defaultSingleHint: "기본값은 모두 1단계입니다. 그대로 두면 지금까지처럼 승인 1회로 신청이 반영됩니다.",
    twoStepHint: "2단계로 하면 1차 승인은 지금까지처럼 해당 종류의 승인 권한을 가진 사람이 하고, 2차 승인은 같은 권한을 「테넌트 전체」 스코프로 가진 사람(인사·본부 등)이 합니다. 2차 승인이 끝나기 전에는 신청이 반영되지 않습니다.",
    sameApproverHint: "1차 승인과 2차 승인을 같은 사람이 할 수는 없습니다.",
    frozenAtCreationHint: "이 설정을 바꿔도 이미 올라간 신청의 단계 수는 바뀌지 않습니다. 신청은 작성 시점의 단계 수 그대로 끝까지 진행됩니다.",
    tenantApproverRequiredHint: "2단계로 바꾸기 전에, 해당 승인 권한을 「테넌트 전체」 스코프로 가진 사람이 최소 1명 있는지 확인해 주세요. 없으면 신청이 2차 승인 대기 상태로 쌓입니다.",

    correctionLabel: "출퇴근 수정 신청",
    correctionHint: "출퇴근 기록의 추가·수정·취소 신청. 승인 권한은 「출퇴근 수정 승인」입니다.",
    leaveLabel: "휴가 신청",
    leaveHint: "연차 등의 사용 신청. 승인 권한은 「휴가 신청 승인」입니다.",
    autoBreakWaiverLabel: "휴게 자동 공제 취소 신청",
    autoBreakWaiverHint: "실제로는 휴게를 쓰지 못한 날의 자동 공제를 취소하는 신청. 승인 권한은 출퇴근 수정 신청과 같습니다.",

    optionOneStep: "1단계(단일)",
    optionTwoSteps: "2단계(1차+2차 승인)",

    save: "저장",
    saving: "저장 중…",
    saveSuccess: "설정을 저장했습니다.",
    saveNote: "이 설정은 테넌트 전체에 적용되며, 앞으로 올라오는 신청에만 적용됩니다. 변경은 감사 로그에 기록됩니다.",

    errors: {
      invalid_correction_steps: "출퇴근 수정 신청의 단계 수는 1단계 또는 2단계로 선택해 주세요",
      invalid_leave_steps: "휴가 신청의 단계 수는 1단계 또는 2단계로 선택해 주세요",
      invalid_auto_break_waiver_steps: "휴게 자동 공제 취소 신청의 단계 수는 1단계 또는 2단계로 선택해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * Slack 연동용 토큰 입력(/settings/slack-link, 2026-08-22 추가, 권한 불필요·전 직원 대상).
   * Slack에서 `/punch link` 를 실행하면 발급되는, 15분간 유효한 일회용 토큰을 여기서 입력한다.
   */
  settingsSlackLink: {
    title: "Slack 연동용 토큰 입력",
    tagline: "Slack에서 `/punch link` 를 실행하면 표시되는 토큰을 입력하면, 본인의 Slack 계정과 연동할 수 있습니다.",
    howToTitle: "절차",
    howTo1: "Slack에서 `/punch link` 를 실행합니다",
    howTo2: "표시된 토큰(15분간 유효)을 복사합니다",
    howTo3: "아래 입력란에 붙여넣고 「연동하기」를 누릅니다",

    tokenLabel: "토큰",
    tokenPlaceholder: "kzsl_...",
    submit: "연동하기",
    submitting: "연동 중…",

    successTitle: "연동되었습니다",
    successMessage: (slackUserId: string) => `Slack 계정(${slackUserId})과 연동되었습니다. 이후 \`/punch in\` 등을 사용할 수 있습니다.`,

    errors: {
      invalid_token: "토큰을 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_or_expired_token: "토큰이 유효하지 않거나 기한(15분)이 만료되었습니다. Slack에서 `/punch link` 를 다시 실행해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /** 설정 서브 내비게이션(/settings/* 간 이동. 접근 가능한 항목만 표시). */
  settingsNav: {
    label: "설정 메뉴",
    /** 자체 검토를 통한 개선: 단순히 「설정」이라고만 하면 다른 탭과 동급 항목처럼 보이므로,
     * 「목록으로 돌아가기」 동작임을 알 수 있는 문구로 변경(비엔지니어가 헤매지 않도록 하는 요건). */
    hubLink: "설정 메뉴 목록",
    myNotifications: "개인 알림 설정",
    notifications: "알림 설정(회사 전체)",
    departments: "부서",
    members: "멤버",
    presets: "권한 프리셋",
    approvalFlow: "다단계 승인",
    tenantProfile: "테넌트 프로필",
    leave: "연차유급휴가",
    help: "사내 규정",
    privacy: "개인정보",
    attendance: "근태 규칙",
    allowances: "수당 대상 시간",
    shiftPatterns: "시프트 패턴",
    apiKeys: "API 키",
    slack: "Slack 연동",
    sso: "SSO(OIDC)",
    auditLogs: "감사 로그",
  },

  settingsHub: {
    title: "설정",
    tagline: "테넌트 설정·조직·권한을 관리합니다. 접근 가능한 항목만 표시됩니다.",
    empty: "이용 가능한 설정 항목이 없습니다. 관리자에게 문의해 주세요.",
    /** 개인 설정(전원)과 회사 설정(관리자용)을 카드 그룹으로 명확히 구분하는 제목. */
    personalGroupTitle: "내 설정",
    tenantGroupTitle: "회사 설정",
    myNotificationsTitle: "개인 알림 설정",
    myNotificationsDesc: "알림 종류별로 앱 내·이메일·개인 Webhook 수신 방식을 설정합니다.",
    notificationsTitle: "알림 설정(회사 전체)",
    notificationsDesc: "Webhook·이메일(SMTP) 알림 채널을 설정합니다.",
    departmentsTitle: "부서",
    departmentsDesc: "부서 트리 생성·이름 변경·이동·삭제를 수행합니다.",
    membersTitle: "멤버",
    membersDesc: "멤버의 소속 변경, 권한 프리셋 할당, 실효 권한 확인을 수행합니다.",
    presetsTitle: "권한 프리셋",
    presetsDesc: "권한 ON/OFF와 스코프를 조합한 프리셋을 생성·편집합니다.",
    approvalFlowTitle: "다단계 승인",
    approvalFlowDesc: "출퇴근 수정·휴가·휴게 자동 공제 취소 신청을 1단계 승인으로 할지 2단계(1차+2차 승인)로 할지 설정합니다.",
    attendanceTitle: "근태 규칙",
    attendanceDesc: "일계·법정휴일·휴게 규칙·GPS·플렉스타임 설정을, 새 버전을 추가하는 방식으로 변경합니다.",
    allowancesTitle: "수당 대상 시간",
    allowancesDesc: "특정일·요일·시간대 조건에 일치하는 실근무 시간을 수당 지급 대상 시간으로 정의합니다.",
    shiftPatternsTitle: "시프트 패턴",
    shiftPatternsDesc: "조근·야근·휴무 등 시프트 패턴을 정의합니다. 시프트표 작성 시 날짜별로 할당합니다.",
    tenantProfileTitle: "테넌트 프로필",
    tenantProfileDesc: "기업 규모·특례조치 대상 사업장·특별조항 등, 집계에 영향을 주는 속성과 적용 예정인 법개정을 확인합니다.",
    leaveTitle: "연차유급휴가",
    leaveDesc: "부여 방식·시간 단위 연차·적립 휴가의 테넌트 전체 설정을 수행합니다.",
    helpTitle: "사내 규정",
    helpDesc: "도움말에 표시할 자사 규칙과 취업규칙 링크를 설정합니다.",
    privacyTitle: "개인정보",
    privacyDesc: "직원 대상 개인정보 안내·사내 이용약관 템플릿을 현재 설정 기준으로 확인합니다.",
    apiKeysTitle: "API 키",
    apiKeysDesc: "IC카드 리더·Slack bot·MCP 서버 등 외부 클라이언트에서 출퇴근을 기록하기 위한 API 키를 발급·폐기합니다.",
    slackTitle: "Slack 연동",
    slackDesc: "Slack 슬래시 커맨드(/punch)로 출퇴근을 기록할 수 있도록 설정합니다.",
    ssoTitle: "SSO(OIDC)",
    ssoDesc: "Google Workspace·Entra ID 등의 IdP 와 OIDC 로 연동하여, 초대된 멤버가 SSO 로 로그인할 수 있게 합니다.",
    slackLinkTitle: "Slack 연동용 토큰 입력",
    slackLinkDesc: "Slack에서 `/punch link` 를 실행해 발급받은 토큰을 입력해, 본인의 Slack 계정과 연동합니다.",
    auditLogsTitle: "감사 로그",
    auditLogsDesc:
      "출퇴근·수정·승인·마감·권한 변경 등 조작 기록을 불변 로그로 열람합니다(읽기 전용).",
  },

  /** 월간 마감·CSV 내보내기(/monthly 화면, v0.3). 요건 §6(마감과 출구)·§10(컨텍스트 도움말). */
  closing: {
    closedBadge: "마감 완료",
    amendedBadge: "마감 후 수정 있음",
    snapshotBadge: "확정값",

    closeAction: "이번 달 마감",
    reopenAction: "마감 해제",

    confirmCloseTitle: "이번 달을 마감하시겠습니까",
    confirmCloseMessage:
      "이번 달의 근태를 확정합니다. 이후 출퇴근 기록·수정에는 신청과 승인이 필요합니다. 이 작업은 감사 로그에 기록됩니다.",
    confirmCloseLabel: "마감",

    confirmReopenTitle: "마감을 해제하시겠습니까",
    confirmReopenMessage: "마감을 해제하면 이번 달은 다시 자유롭게 편집할 수 있는 상태가 됩니다.",
    confirmReopenExtraNote: "마감 해제는 영향이 큰 작업입니다. 이 작업은 감사 로그에 기록됩니다.",
    confirmReopenLabel: "해제",

    noteLabel: "메모(선택)",
    notePlaceholder: "마감·해제 사유 등(선택)",

    diffTitle: "최초 값과의 차이",
    diffColumnCategory: "구분",
    diffColumnOriginal: "최초",
    diffColumnCurrent: "현재",
    diffColumnDelta: "차이",
    diffFlexFrame: "플렉스 총 한도",
    diffFlexActual: "플렉스 실적",
    diffFlexDiff: "플렉스 수지",

    historyTitle: "마감 이력",
    historyEmpty: "아직 마감·해제 이력이 없습니다",
    historyActorSelf: "본인",
    historyEventLabel: {
      close: "마감",
      reopen: "해제",
      amend: "수정 반영",
    } satisfies Record<"close" | "reopen" | "amend", string>,
    historyCorrectionLink: "관련 수정 신청 확인",

    csvFormatLabel: "형식",
    csvFormatOptions: {
      generic: "범용 CSV",
      freee: "freee 인사노무(베타)",
      mf: "머니포워드 클라우드 급여(베타)",
    },
    csvFormatBetaNote:
      "베타: 각 서비스의 근태 가져오기에 맞춘 호환 CSV입니다. 가져오기 전에 열 이름·단위·직원 식별자가 귀사의 설정과 일치하는지 반드시 확인하세요. 일수(출근 일수·결근 일수·연차 사용 일수 등)는 KIZAMI가 산출하지 않으므로 비어 있습니다.",
    csvDownload: "CSV 다운로드",
    csvDownloading: "생성 중…",
    csvCompareOriginalLabel: "최초 값과의 차이 포함",
    csvDownloadFailed: "CSV 다운로드에 실패했습니다. 다시 시도해 주세요",

    errors: {
      already_closed: "이번 달은 이미 마감되었습니다",
      not_closed: "이번 달은 아직 마감되지 않았습니다",
      invalid_period: "대상 월 지정을 확인해 주세요",
      invalid_note: "메모는 500자 이내로 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /** 테넌트 프로필 설정(/settings/tenant-profile, v0.3). 요건 §10(법제도에서 유래한 표시에는 도움말을 첨부). */
  settingsTenantProfile: {
    title: "테넌트 프로필",
    tagline: "근로시간 집계·36협정 알림의 전제가 되는 테넌트 전체의 속성을 설정합니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    loadFailed: "설정을 가져오지 못했습니다. 다시 시도해 주세요",

    smeLabel: "중소기업 여부",
    smeHint: "법개정 시행일이 기업 규모에 따라 다른 항목(월 60시간 초과 할증, 36협정 상한 규제)의 판정에 사용됩니다.",

    specialProvisionLabel: "특례조치 대상 사업장 여부",
    specialProvisionHint:
      "상업·영화연극업·보건위생업·접객오락업으로서 상시 10인 미만 사업장은 주당 법정근로시간이 44시간이 됩니다(일본 노동기준법 제40조).",

    specialClauseLabel: "특별조항 체결 여부",
    specialClauseHint:
      "36협정의 특별조항 관련 알림(월 100시간 미만·복수월 평균 80시간·연 720시간·월 45시간 초과는 연 6회까지)을 활성화합니다.",

    save: "저장",
    saving: "저장 중…",
    saveSuccess: "설정을 저장했습니다.",

    confirmTitle: "이 설정을 변경하시겠습니까",
    confirmMessage: "이 설정은 근로시간 집계에 직접 영향을 미칩니다.",
    confirmExtraNote: "변경 사항은 감사 로그에 기록됩니다.",
    confirmLabel: "변경",

    currentRulesTitle: "현재 적용 중인 주요 값",
    currentRulesWeekly: "주당 법정근로시간",
    currentRulesAgreementMonthly: "36협정·월 상한",
    currentRulesAgreementAnnual: "36협정·연 상한",
    currentRulesHourlyLeave: "시간 단위 연차 상한 일수",
    currentRulesHourlyLeaveUnit: "일/년",
    currentRulesSpecialClauseTitle: "특별조항 시 상한(체결한 경우)",
    currentRulesSpecialMonthlyCap: "단월",
    currentRulesSpecialMonthlyCapNote: "미만",
    currentRulesSpecialMultiMonth: "복수월 평균",
    currentRulesSpecialAnnual: "연간",
    currentRulesSpecialExceedCount: "월 45시간 초과가 허용되는 횟수",
    currentRulesSpecialExceedCountUnit: "회/년",

    upcomingTitle: "적용 예정인 법개정",
    upcomingEmpty: "현재 적용 예정인 법개정이 없습니다",
    upcomingEffectiveFrom: "시행일",
    upcomingBasis: "근거",
    upcomingChangesPrefix: "변경 사항: ",
    upcomingRuleLabel: {
      weeklyStatutoryMinutes: "주당 법정근로시간",
      lateNight: "야간 시간대",
      overtime60h: "월 60시간 초과 구분",
      agreement36: "36협정 상한",
      annualLeave: "연차유급휴가",
    } satisfies Record<"weeklyStatutoryMinutes" | "lateNight" | "overtime60h" | "agreement36" | "annualLeave", string>,

    errors: {
      invalid_is_small_or_medium_enterprise: "입력 내용을 확인해 주세요",
      invalid_is_special_provision_workplace: "입력 내용을 확인해 주세요",
      invalid_special_clause_enabled: "입력 내용을 확인해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      tenant_not_found: "테넌트 정보를 찾을 수 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 근태 규칙의 버전 관리(/settings/attendance, 2026-08-22 추가).
   * docs/design/v01-data-model.md 원칙 6(effective-dated): 편집은 새 버전 추가로만 이루어진다.
   * 기존 버전은 변경되지 않는다(과거 계산 결과는 바뀌지 않는다).
   */
  settingsAttendance: {
    title: "근태 규칙",
    tagline: "일계·법정휴일·휴게 규칙·GPS·플렉스타임 설정을, 새 버전을 추가하는 방식으로 변경합니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    loadFailed: "설정을 가져오지 못했습니다. 다시 시도해 주세요",

    currentTitle: "현재 유효한 설정",
    currentEffectiveFrom: "이 버전이 유효해진 날",
    dayBoundaryLabel: "일계(하루의 기산 시각)",
    /**
     * 주의 기산 요일(2026-08-23 추가). 주 40시간 판정(고정시간제의 주간 연장근로)의 주 구분.
     * 법정휴일 요일 지정(legalHolidayWeekday)과는 다른 개념 — 혼동하지 않도록 주의.
     */
    weekStartWeekdayLabel: "주의 기산 요일",
    weekStartWeekdayHint: "주 40시간 판정에 사용하는 주의 구분 기준입니다. 취업규칙에 정함이 없다면 일요일 기산이 원칙입니다(1988년(쇼와63년) 기발 제1호).",
    /**
     * 변형기간 시작일(2026-08-24 추가, v0.7 3단계, docs/design/shift-work.md 결정사항3).
     * monthly_variable을 사용하지 않는 테넌트도 POST 때마다 필수로 전송합니다(apps/api의 방식).
     */
    variablePeriodStartDayLabel: "변형기간 시작일",
    variablePeriodStartDayHint:
      "1〜28일로 지정합니다(29〜31일은 달에 따라 존재하지 않아 선택할 수 없습니다). 시프트표(시프트 관리 화면)의 기간은 이 날을 기점으로 1개월씩 구분됩니다. 시프트제를 사용하지 않아도 입력이 필요합니다.",
    legalHolidayLabel: "법정휴일",
    legalHolidayWeekday: "요일 지정",
    legalHolidayDates: "역일 지정",
    breakRuleLabel: "휴게 규칙",
    breakRulePunch: "기록 방식",
    /** 휴게 자동 공제(2026-08-23 추가, docs/design/breaks.md 「채택한 설계」). */
    breakRuleModeAuto: "자동 공제",
    breakRuleModeBoth: "병용",
    breakRuleRulesTitle: "공제 규칙",
    breakRuleOverSuffix: "초과 시",
    breakRuleDeductSuffix: "분 공제",
    breakRuleAddRule: "행 추가",
    breakRuleRemoveRule: "삭제",
    breakRuleRuleOverLabel: "기준 근로시간",
    breakRuleRuleDeductLabel: "공제할 분수",
    breakRuleMaxRulesHint: "최대 3행까지 설정할 수 있습니다.",
    gpsLabel: "GPS 출퇴근 기록",
    gpsEnabledYes: "활성화",
    gpsEnabledNo: "비활성화",
    gpsRetentionLabel: "GPS 좌표 보관 기간",
    gpsRetentionSameAsAttendance: "근태 데이터와 동일",
    gpsRetentionDaysUnit: "일",
    flexLabel: "플렉스타임 설정",
    flexSettlementMonthly: "월간 정산",
    flexStandardDayMinutesLabel: "표준근로시간(1일, 분)",
    /**
     * 코어타임(노동기준법 32조의3, 2026-08-24 추가). 플렉스의 **임의** 설정이며,
     * 설정하지 않으면 슈퍼플렉스입니다. 집계에는 영향을 주지 않고 지각·조퇴·부재 경고만 표시됩니다.
     */
    coreTimeLabel: "코어타임",
    coreTimeNone: "코어타임 없음(슈퍼플렉스)",
    coreTimeSummary: (start: string, end: string, weekdays: string) => `${start}~${end}(${weekdays})`,
    noVersionYet: "아직 설정이 없습니다",

    weekdayLabel: {
      0: "일요일",
      1: "월요일",
      2: "화요일",
      3: "수요일",
      4: "목요일",
      5: "금요일",
      6: "토요일",
    } satisfies Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>,

    formTitle: "새 버전 추가",
    effectiveFromLabel: "적용 시작일",
    effectiveFromHint: "이 변경은 지정일 이후의 계산에만 영향을 주며, 과거 집계는 변경되지 않습니다.",
    dayBoundaryHint: "0시=00:00 기산. 야간근로가 있는 사업장은 예를 들어 05:00(300분)으로 설정하면 날짜를 넘는 근무를 하루로 묶을 수 있습니다.",
    legalHolidayKindLabel: "지정 방법",
    legalHolidayWeekdayValueLabel: "휴일로 지정할 요일",
    legalHolidayDatesValueLabel: "휴일로 지정할 날짜(쉼표로 구분, YYYY-MM-DD)",
    legalHolidayDatesPlaceholder: "예: 2026-05-05,2026-05-06",
    gpsEnabledCheckbox: "GPS 출퇴근 기록 활성화",
    gpsWarning: "직원에게 위치 정보 수집 사실을 명시해야 합니다. 개인정보 안내 템플릿을 확인해 주세요.",
    gpsWarningLink: "개인정보 설정 보기 →",
    gpsRetentionInputLabel: "보관 기간(공백이면 근태 데이터와 동일)",
    flexStandardDayMinutesHint: "연차 사용일에 이 분수가 근로시간으로 한도에 산입됩니다.",
    coreTimeEnabledCheckbox: "코어타임을 설정한다",
    coreTimeStartLabel: "코어타임 시작",
    coreTimeEndLabel: "코어타임 종료",
    coreTimeWeekdaysLabel: "코어타임이 있는 요일",
    coreTimeHint:
      "코어타임 중 부재는 월별 목록에 「코어타임 지각·조퇴·부재」 경고로 표시됩니다. 집계(정산기간 한도)에는 영향을 주지 않습니다 — 임금 공제 여부는 급여 측에서 판단해 주세요. 종료 시각은 시작 시각보다 뒤여야 합니다(날짜를 넘는 코어타임은 설정할 수 없습니다).",

    submit: "이 내용으로 버전 추가",
    submitting: "추가 중…",
    submitSuccess: "새 버전을 추가했습니다.",

    workPolicyFormTitle: "플렉스타임 설정의 새 버전 추가",
    workPolicyNoPermission: "플렉스타임 설정을 변경할 권한이 없습니다",

    historyTitle: "버전 이력",
    workPolicyHistoryTitle: "플렉스타임 설정의 버전 이력",
    historyEmpty: "아직 이력이 없습니다",
    historyColumnEffectiveFrom: "적용 시작일",
    historyColumnSummary: "내용",

    errors: {
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_effective_from: "적용 시작일을 확인해 주세요",
      invalid_day_boundary_minutes: "일계는 0~1439 범위(분)로 입력해 주세요",
      invalid_week_start_weekday: "주의 기산 요일을 확인해 주세요",
      invalid_variable_period_start_day: "변형기간 시작일은 1〜28 범위로 입력해 주세요",
      invalid_legal_holiday_rule: "법정휴일 지정을 확인해 주세요",
      invalid_break_rule: "휴게 규칙을 확인해 주세요",
      invalid_gps_enabled: "입력 내용을 확인해 주세요",
      invalid_gps_retention_days: "GPS 좌표 보관 기간은 1 이상의 정수로 입력해 주세요",
      invalid_settlement_period: "정산기간은 이 버전에서는 「월간 정산」만 선택할 수 있습니다",
      invalid_standard_day_minutes: "표준근로시간은 1~1440 범위(분)로 입력해 주세요",
      invalid_core_time: "코어타임은 시작보다 뒤의 종료 시각으로 지정해 주세요(날짜를 넘는 설정은 불가합니다)",
      invalid_core_time_weekdays: "코어타임이 있는 요일을 1개 이상 선택해 주세요",
      effective_from_in_past: "적용 시작일은 오늘 이후로만 지정할 수 있습니다(과거 집계 결과가 바뀌기 때문입니다)",
      version_already_exists: "해당 적용 시작일에는 이미 버전이 있습니다. 다른 날짜를 지정해 주세요",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 수당 대상 시간 설정(/settings/allowances, docs/design/allowances.md, 2026-08-23 추가).
   * 금액은 계산하지 않습니다 — KIZAMI가 산출하는 것은 「이 수당의 대상이 되는 근무가 몇 분
   * 있었는가」까지입니다. settingsAttendance와 같은 effective-dated 버전 관리 UI
   * (SettingsAttendanceView를 참고)이지만, 정의는 테넌트당 몇 건이든 병행해 존재할 수 있으므로
   * 정의마다 현재값·버전 추가·이력을 각각 가집니다.
   */
  settingsAllowances: {
    title: "수당 대상 시간",
    tagline: "특정일·요일·시간대 조건에 일치하는 실근무 시간을 수당 지급 대상 시간으로 산출합니다. 수당 단가·지급액 계산은 하지 않습니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    loadFailed: "설정을 불러오지 못했습니다. 다시 시도해 주세요",

    listTitle: "수당 정의 목록",
    empty: "아직 수당 정의가 없습니다",
    currentConditionsLabel: "현재 조건",
    currentEffectiveFrom: "이 버전이 적용된 날",
    noVersionYet: "아직 적용 중인 버전이 없습니다(적용 시작일이 미래인 버전만 등록되어 있습니다)",

    nameLabel: "수당명",
    namePlaceholder: "예: 조기출근 수당",
    effectiveFromLabel: "적용 시작일",
    effectiveFromHint: "이 변경은 지정일 이후의 계산에만 영향을 주며, 과거 집계는 바뀌지 않습니다.",

    conditionsSectionHint: "최소 1개 이상의 조건을 지정해 주세요. 지정한 조건은 모두 AND(겹칠 때만 대상)입니다.",
    datesFieldLabel: "특정일",
    datesFieldHint:
      "특정 날짜를 대상으로 합니다. 「매년」을 지정하면 연도를 무시하고 월일만으로 일치시킵니다(연말연시 수당 등). 「매년」 지정 시 날짜란에 표시되는 연도는 의미가 없습니다.",
    addDateRow: "날짜 추가",
    removeDateRow: "삭제",
    dateYearlyCheckbox: "매년(연도를 무시하고 월일만 일치)",
    dateRowAriaLabel: "대상일",
    weekdaysFieldLabel: "요일",
    weekdaysFieldHint: "지정한 요일만 대상으로 합니다.",
    timeBandFieldLabel: "시간대",
    timeBandEnabledCheckbox: "시간대를 지정한다",
    timeBandStartLabel: "시작 시각",
    timeBandEndLabel: "종료 시각",
    timeBandHint: "종료 시각이 시작 시각 이전이면 날짜를 넘어가는 시간대로 처리됩니다(예: 22:00~다음날 5:00).",

    createDefinitionTitle: "새 수당 정의 만들기",
    createDefinitionButton: "이 내용으로 만들기",
    creating: "만드는 중…",
    createSuccess: "수당 정의를 만들었습니다.",

    addVersionTitle: "새 버전 추가",
    addVersionSubmit: "이 내용으로 버전 추가",
    addingVersion: "추가하는 중…",
    submitSuccess: "새 버전을 추가했습니다.",

    historyTitle: "버전 이력",
    historyEmpty: "아직 이력이 없습니다",
    historyColumnEffectiveFrom: "적용 시작일",
    historyColumnName: "수당명",
    historyColumnConditions: "조건",

    /** summarizeAllowanceConditions(lib/allowances.ts)가 사용하는 요약 서식 토큰. */
    summaryYearlyPrefix: "매년 ",
    summaryDateRangeSeparator: "~",
    summaryListSeparator: ", ",
    summaryPartsSeparator: " ",
    summaryNextDayPrefix: "다음날 ",

    errors: {
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_effective_from: "적용 시작일을 확인해 주세요",
      invalid_name: "수당명을 입력해 주세요",
      invalid_conditions: "조건 입력 내용을 확인해 주세요(특정일은 날짜를, 시간대는 시작·종료에 서로 다른 시각을 지정해 주세요)",
      conditions_required: "최소 1개 이상의 조건(특정일·요일·시간대)을 지정해 주세요",
      effective_from_in_past: "적용 시작일은 오늘 이후로만 지정할 수 있습니다(과거 집계 결과가 바뀌기 때문입니다)",
      version_already_exists: "해당 적용 시작일에는 이미 버전이 있습니다. 다른 날짜를 지정해 주세요",
      not_found: "대상 수당 정의를 찾을 수 없습니다",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 시프트 패턴 관리(/settings/shift-patterns, v0.7 3단계, 2026-08-24 추가).
   * docs/design/shift-work.md 결정사항2 「패턴 할당 + 개별 편집」의 패턴 쪽 CRUD.
   * apps/api/src/routes/settings/shift-patterns.ts 와 일치(GET/POST/:id/archive만, 수정 API는 없음).
   */
  shiftPatterns: {
    title: "시프트 패턴",
    tagline: "조근·야근·휴무 등의 패턴을 정의합니다. 시프트표 작성 시 이 패턴을 날짜별로 할당합니다.",
    noPermission: "이 화면을 이용할 권한이 없습니다",
    loadFailed: "패턴 목록을 가져오지 못했습니다. 다시 시도해 주세요",
    empty: "아직 패턴이 없습니다. 「패턴 추가」에서 만들어 주세요.",

    addNew: "패턴 추가",
    columnName: "이름",
    columnDayType: "구분",
    columnTime: "시간",
    columnActions: "작업",
    archive: "아카이브",
    archivedBadge: "아카이브됨",
    showArchived: "아카이브된 항목도 표시",

    confirmArchiveTitle: "이 패턴을 아카이브하시겠습니까",
    confirmArchiveMessage: "아카이브하면 새 시프트표의 할당 후보에서 제외됩니다. 이미 할당된 시프트에는 영향이 없습니다.",
    confirmArchiveLabel: "아카이브",

    formTitle: "새 패턴 추가",
    nameLabel: "이름",
    namePlaceholder: "예: 조근",
    dayTypeLabel: "구분",
    startLabel: "시작 시각",
    endLabel: "종료 시각",
    endHint: "시작 시각보다 앞선 시각을 지정하면 날짜를 넘는 근무(야간 근무)로 처리됩니다.",
    breakLabel: "휴게(분)",
    submit: "이 내용으로 만들기",
    submitting: "만드는 중…",
    submitSuccess: "패턴을 만들었습니다.",
    cancel: "취소",

    errors: {
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_name: "이름을 입력해 주세요",
      invalid_day_type: "구분을 확인해 주세요",
      invalid_minutes: "시작·종료 시각을 확인해 주세요",
      invalid_break_minutes: "휴게(분)는 0 이상의 정수로 입력해 주세요",
      not_found: "대상 패턴을 찾을 수 없습니다",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 시프트표 작성·확정(/shifts, shift.manage 보유자, v0.7 3단계, 2026-08-24 추가).
   * apps/api/src/routes/shifts.ts 와 일치. period_start_mismatch(변형기간 시작일 불일치)만
   * 숫자(올바른 시작일)를 포함하므로 errors(문자열만)와 별도로 periodStartMismatchMessage를 둔다.
   */
  shifts: {
    title: "시프트표",
    tagline: "멤버별로 변형기간 시프트표를 작성하고 확정합니다. 확정 후 변경은 이력으로 남습니다.",
    noPermission: "이 화면을 이용할 권한이 없습니다",
    loadFailed: "시프트표를 가져오지 못했습니다. 다시 시도해 주세요",

    memberLabel: "대상 멤버",
    prevPeriod: "← 이전 기간",
    nextPeriod: "다음 기간 →",
    periodRangeLabel: (start: string, end: string) => `${start} 〜 ${end}`,

    noPlanYet: "이 기간의 시프트표는 아직 없습니다.",
    createPlan: "이 기간의 시프트표 만들기",
    creatingPlan: "만드는 중…",

    publishedBadge: "확정됨",
    unpublishedBadge: "미확정",
    publishAction: "확정하기",
    publishing: "확정하는 중…",
    confirmPublishTitle: "이 시프트표를 확정하시겠습니까",
    confirmPublishMessage:
      "확정 후 변경은 이력으로 기록되며 삭제할 수 없습니다. 변형근로시간제는 각 날짜·각 주의 근로시간을 사전에 특정하는 것이 법률상 요건입니다.",
    confirmPublishLabel: "확정하기",

    historyToggleOpen: "변경 이력 보기",
    historyToggleClose: "변경 이력 닫기",
    historyEmpty: "아직 변경 이력이 없습니다",
    historyColumnDate: "날짜",
    historyColumnDayType: "구분",
    historyColumnTime: "시간",
    historyColumnCreatedBy: "변경자",
    historyColumnCreatedAt: "일시",

    /** 주 단위 그리드(행=주, 열=요일. docs/design/shift-work.md 결정사항2). */
    cellEmpty: "미설정",
    cellDialogTitle: (date: string) => `${date}의 시프트`,
    cellDialogPatternLabel: "패턴에서 선택",
    cellDialogPatternNone: "패턴을 사용하지 않고 개별 설정",
    cellDialogDayTypeLabel: "구분",
    cellDialogStartLabel: "시작 시각",
    cellDialogEndLabel: "종료 시각",
    cellDialogBreakLabel: "휴게(분)",
    cellDialogSave: "저장",
    cellDialogSaving: "저장하는 중…",
    cellDialogCancel: "취소",

    /** 일괄 할당(요일별로 패턴을 지정해 기간 전체에 한 번에 적용. 결정사항2 「입력 비용 절감의 핵심」). */
    bulkAssignTitle: "일괄 할당",
    bulkAssignHint: "요일별로 패턴을 지정하고 이 기간 전체에 한 번에 적용합니다.",
    bulkAssignNoneOption: "변경 안 함",
    bulkAssignApply: "이 내용 적용",
    bulkAssignApplying: "적용하는 중…",
    bulkAssignSuccess: "적용했습니다.",

    /** 확정 전 집계(요건: 확정 전에 부족분이 보여야 함). */
    aggregationTitle: "이 기간의 집계(참고치)",
    aggregationScheduledLabel: "소정 합계",
    aggregationStatutoryFrameLabel: "법정 총 한도(40시간 × 역일수 ÷ 7)",
    aggregationOverLabel: "총 한도를 초과했습니다",
    aggregationLegalHolidayLabel: "법정휴일 일수",
    aggregationLegalHolidayOk: "주 1일 또는 4주 4일 요건을 충족합니다",
    aggregationLegalHolidayShortage: "주 1일 또는 4주 4일 요건을 충족하지 않습니다. 확정할 수 없습니다",
    aggregationUnassignedDaysLabel: "미설정 일수",

    /** 변형기간 시작일 불일치(400 period_start_mismatch). 웹이 추측한 날짜가 틀렸을 때 표시하며 시작일을 보정한다. */
    periodStartMismatchMessage: (day: number) => `변형기간 시작일은 ${day}일입니다. 표시할 기간을 보정했습니다. 다시 시도해 주세요`,

    errors: {
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_user_id: "대상 멤버를 확인해 주세요",
      invalid_period_start: "기간 시작일을 확인해 주세요",
      tenant_settings_not_found: "이 기간의 근태 설정을 찾을 수 없습니다. 관리자에게 문의해 주세요",
      plan_already_exists: "이 기간의 시프트표는 이미 만들어져 있습니다",
      not_found: "대상 시프트표를 찾을 수 없습니다",
      invalid_days: "시프트 내용을 확인해 주세요",
      invalid_date: "날짜를 확인해 주세요",
      date_out_of_period: "이 기간 범위 밖의 날짜입니다",
      invalid_pattern_id: "선택한 패턴을 찾을 수 없습니다",
      archived_pattern: "선택한 패턴은 아카이브되었습니다. 다른 패턴을 선택해 주세요",
      invalid_day_type: "구분을 확인해 주세요",
      invalid_minutes: "시작·종료 시각을 확인해 주세요",
      invalid_break_minutes: "휴게(분)는 0 이상의 정수로 입력해 주세요",
      duplicate_date: "같은 날짜가 중복되었습니다",
      already_published: "이 시프트표는 이미 확정되었습니다",
      legal_holiday_shortage: "법정휴일이 부족합니다. 주 1일 또는 4주 4일을 충족하도록 설정해 주세요",
      invalid_range: "지정한 기간을 확인해 주세요",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /** 본인의 시프트 열람(/shifts/me, 전원, v0.7 3단계, 2026-08-24 추가). */
  shiftsMe: {
    title: "내 시프트",
    tagline: "확정된 시프트표(예정)를 월 캘린더로 확인합니다.",
    loadFailed: "시프트를 가져오지 못했습니다. 다시 시도해 주세요",
    prevMonth: "이전 달",
    nextMonth: "다음 달",
    empty: "이번 달의 시프트는 아직 등록되지 않았습니다.",
    manageLink: "시프트표 관리하기 →",
  },

  departments: {
    title: "부서 관리",
    tagline: "부서 트리 생성·이름 변경·이동·삭제를 수행합니다.",
    noPermission: "이 화면을 이용할 권한이 없습니다",
    loadFailed: "부서 목록을 가져오지 못했습니다. 다시 시도해 주세요",
    empty: "아직 부서가 없습니다. 「부서 추가」에서 생성해 주세요.",
    topLevel: "최상위",
    addRoot: "부서 추가",
    addChild: "하위에 추가",
    rename: "이름·상위 부서 변경",
    delete: "삭제",

    formTitleCreate: "부서 추가",
    formTitleEdit: "부서 편집",
    nameLabel: "부서명",
    namePlaceholder: "예: 영업부",
    parentLabel: "상위 부서",
    parentNone: "없음(최상위)",
    save: "저장",
    saving: "저장 중…",
    cancel: "취소",

    confirmDeleteTitle: "이 부서를 삭제하시겠습니까",
    confirmDeleteMessage: "삭제하면 되돌릴 수 없습니다. 하위 부서나 멤버가 남아 있으면 삭제할 수 없습니다.",
    confirmDeleteLabel: "삭제",

    errors: {
      invalid_name: "부서명을 1~200자로 입력해 주세요",
      invalid_parent_id: "지정한 상위 부서를 찾을 수 없습니다",
      invalid_body: "입력 내용을 확인해 주세요",
      circular_reference: "자기 자신이나 하위 부서는 상위 부서로 지정할 수 없습니다",
      not_found: "대상 부서를 찾을 수 없습니다",
      department_not_empty: "하위 부서 또는 멤버가 남아 있습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  members: {
    title: "멤버 관리",
    tagline: "소속 부서 변경, 권한 프리셋 할당, 실효 권한(가능한 작업) 확인을 수행합니다.",
    noPermission: "이 화면을 이용할 권한이 없습니다",
    loadFailed: "멤버 목록을 가져오지 못했습니다. 다시 시도해 주세요",
    empty: "멤버가 없습니다",

    columnName: "이름",
    columnEmail: "이메일 주소",
    columnDepartment: "소속 부서",
    columnPresets: "할당된 프리셋",
    columnHireDate: "입사일",
    columnInviteStatus: "초대 상태",
    /** 퇴직 처리(비활성화, 2026-08-23 Tier 0 4번째 추가)의 상태 배지용 열. */
    columnStatus: "상태",
    /** 멤버별 근로시간제(2026-08-23 Tier 0 4번째 추가)의 작은 표시용 열. */
    columnWorkSystem: "근로시간제",
    columnActions: "작업",
    noDepartment: "미소속",
    noPresets: "할당 없음",
    /** workSystemKind가 null일 때(할당이 한 번도 없음). monthly.workSystemValue와 맞추면서 "미설정"을 추가. */
    workSystemUnset: "미설정",

    detailToggleOpen: "상세 열기",
    detailToggleClose: "상세 닫기",

    /** 퇴직 처리(비활성화)된 멤버의 상태 배지(2026-08-23 Tier 0 4번째 추가). */
    inactiveBadge: "비활성",
    /**
     * 목록 필터(기본값은 활성 멤버만 표시). 기존 필터 관례가 없었으므로 체크박스 1개의
     * 단순한 토글로 구현했습니다.
     */
    showInactiveToggle: "비활성 멤버도 표시",

    /**
     * 초대 방식 등록(2026-08-23 추가, docs/requirements.md §7 「등록은 초대 방식만 허용」).
     * 멤버 생성은 초대 발급을 동시에 겸한다(POST /members).
     */
    inviteButton: "멤버 초대",
    inviteFormTitle: "멤버 초대",
    inviteFormHint: "이름과 이메일 주소를 입력하면 초대 링크가 발급됩니다. 소속 부서·입사일·권한 프리셋은 나중에 설정할 수 있습니다.",
    inviteEmailLabel: "이메일 주소",
    inviteEmailPlaceholder: "예: yamada@example.com",
    inviteNameLabel: "이름",
    inviteNamePlaceholder: "예: 홍길동",
    inviteDepartmentLabel: "소속 부서(선택)",
    inviteHireDateLabel: "입사일(선택)",
    invitePresetsLabel: "권한 프리셋(선택)",
    inviteCancel: "취소",
    inviteSubmit: "초대 링크 발급",
    inviteSubmitting: "발급 중…",

    inviteLinkTitle: "초대 링크를 발급했습니다",
    inviteLinkTargetPrefix: "초대 대상: ",
    inviteLinkWarning: "이 링크는 지금만 표시됩니다. 닫으면 다시 표시할 수 없습니다(재발급은 가능합니다).",
    inviteLinkLabel: "초대 링크",
    inviteLinkCopy: "링크 복사",
    inviteLinkCopied: "복사했습니다",
    inviteLinkCopyFailed: "복사에 실패했습니다. 직접 선택해서 복사해 주세요",
    inviteLinkExpiresLabel: "유효 기간",
    inviteLinkDone: "닫기",

    inviteStatusBadge: {
      invited: "초대 중",
      invite_expired: "기한 만료",
    } as Record<string, string>,

    reissueButton: "재발급",
    reissueConfirmTitle: "초대를 재발급하시겠습니까",
    reissueConfirmMessage: "새 초대 링크를 발급합니다. 이전 링크는 사용할 수 없게 됩니다.",

    revokeInviteButton: "취소",
    revokeInviteConfirmTitle: "초대를 취소하시겠습니까",
    revokeInviteConfirmMessage: "이 초대 링크는 사용할 수 없게 됩니다. 필요하다면 나중에 다시 발급할 수 있습니다.",

    /**
     * 관리자 발급 비밀번호 재설정(2026-08-23 Tier 0 4번째 추가). 초대와 동일한 형태의 1회성
     * 링크 제시(InviteLinkDialog를 variant="reset"으로 공용). 대상은 이미 초대를 수락한 멤버만.
     */
    passwordResetButton: "비밀번호 재설정",
    passwordResetBadge: "재설정 발급 중",
    passwordResetRevokeButton: "취소",
    passwordResetRevokeConfirmTitle: "비밀번호 재설정을 취소하시겠습니까",
    passwordResetRevokeConfirmMessage: "이 재설정 링크는 사용할 수 없게 됩니다. 필요하다면 나중에 다시 발급할 수 있습니다.",

    resetLinkTitle: "비밀번호 재설정 링크를 발급했습니다",
    resetLinkTargetPrefix: "대상: ",
    resetLinkWarning: "이 링크는 지금만 표시됩니다. 닫으면 다시 표시할 수 없습니다(다시 발급하는 것은 가능합니다).",
    resetLinkLabel: "재설정 링크",
    resetLinkCopy: "링크 복사",
    resetLinkCopied: "복사했습니다",
    resetLinkCopyFailed: "복사에 실패했습니다. 직접 선택해서 복사해 주세요",
    resetLinkExpiresLabel: "유효 기간",
    resetLinkDone: "닫기",

    /**
     * 퇴직 처리(비활성화·재활성화, 2026-08-23 Tier 0 4번째 추가). 비활성화는 영향이 크므로
     * 기존 위험 조작의 방식(승인·반려와 동일한 ConfirmDialog, 차분한 톤)에 맞춰 영향
     * (로그인 불가·세션 실효·초대/재설정 실효)을 확인 문구에 명시합니다. 재활성화는 되돌리는
     * 조작(새로 무언가를 파괴하지 않음)이므로 확인 절차를 두지 않습니다.
     */
    deactivateButton: "비활성화",
    deactivateConfirmTitle: "이 멤버를 비활성화하시겠습니까",
    deactivateConfirmMessage: "비활성화하면 다음과 같이 됩니다.",
    deactivateConfirmImpactLogin: "로그인할 수 없게 됩니다",
    deactivateConfirmImpactSession: "현재 로그인 중인 세션이 모두 실효됩니다",
    deactivateConfirmImpactInviteReset: "처리되지 않은 초대·비밀번호 재설정 링크가 실효됩니다",
    reactivateButton: "재활성화",
    reactivating: "재활성화하는 중…",

    /**
     * 멤버별 근로시간제 할당(2026-08-23 Tier 0 4번째 추가). GET/POST /members/:id/work-policy
     * (tenant_settings.flex.manage, 테넌트 전체 스코프만). 이 권한이 없으면 GET도 403이 되므로
     * 섹션 자체를 표시하지 않습니다(MembersView 참고).
     */
    workPolicyTitle: "근로시간제",
    workPolicyHint: "월별 집계를 플렉스타임제/고정시간제 중 무엇으로 할지에 대한 할당입니다. 변경은 새 할당을 추가하는 형태로 이루어지며, 과거 집계는 바뀌지 않습니다.",
    workPolicyCurrentLabel: "현재 근로시간제",
    workPolicyCurrentEffectiveFrom: "이 할당이 적용된 날",
    workPolicyNoneYet: "아직 할당이 없습니다",
    workPolicyHistoryTitle: "할당 이력",
    workPolicyHistoryEmpty: "아직 이력이 없습니다",
    workPolicyHistoryColumnEffectiveFrom: "적용 시작일",
    workPolicyHistoryColumnKind: "제도",
    workPolicyFormTitle: "제도 변경",
    workPolicyKindLabel: "근로시간제",
    workPolicyEffectiveFromLabel: "적용 시작일",
    workPolicyEffectiveFromHint: "이 변경은 지정일 이후의 계산에만 영향을 주며, 과거 집계는 바뀌지 않습니다.",
    /**
     * 탄력적 근로시간제(monthly_variable)일 때만 표시하는 입력(v0.7 4단계, 2026-08-24 추가).
     * 이 제도에서는 소정근로시간이 날마다 시프트로 정해지므로, standard_day_minutes 는
     * 「연차 1일을 몇 분으로 볼 것인가」의 의미만 갖는다.
     */
    workPolicyStandardDayMinutesLabel: "1일당 기준 소정근로시간(연차 환산용)",
    workPolicyStandardDayMinutesHint:
      "시프트가 없는 날에 연차를 1일 사용했을 때 몇 분의 근로로 볼지에 대한 기준입니다(분, 1~1440). 기본값은 480분(8시간)입니다.",
    workPolicySubmit: "이 내용으로 변경",
    workPolicySubmitting: "변경 중…",
    workPolicySubmitSuccess: "근로시간제를 변경했습니다.",
    workPolicyNoPermission: "이 설정을 변경할 권한이 없습니다",

    departmentChangeLabel: "소속 부서 변경",
    departmentChangeSaved: "소속 부서를 변경했습니다",

    hireDateLabel: "입사일 설정",
    hireDateSave: "저장",
    hireDateSaving: "저장 중…",
    hireDateSaved: "입사일을 저장했습니다",
    hireDateUnset: "미설정",
    hireDateWarning: "입사일이 설정되지 않아 법정 부여(연차유급휴가)를 계산할 수 없습니다",

    leaveGrantClassTitle: "연차 부여 구분",
    leaveGrantClassHint:
      "주 소정근로시간 30시간 미만이면서 주 소정근로일수가 4일 이하인 경우에만 비례부여(주 4일 이하)를 선택합니다(일본 노동기준법 39조 3항).",
    leaveGrantClassLabel: "연차 부여 구분 선택",
    leaveGrantClassOption: {
      full: "일반(주 5일 이상)",
      days4: "주 4일",
      days3: "주 3일",
      days2: "주 2일",
      days1: "주 1일",
    },
    leaveGrantClassSave: "구분 저장",
    leaveGrantClassSaving: "저장 중…",
    leaveGrantClassSaved: "연차 부여 구분을 저장했습니다",
    leaveGrantClassNote: "변경은 이후의 자동 부여·부여 예고부터 반영됩니다(이미 부여된 일수는 변하지 않습니다).",

    presetAssignTitle: "할당할 프리셋",
    presetAssignHint: "체크를 변경하면 아래 「가능한 작업」에 바로 반영됩니다. 저장하기 전까지는 실제 할당이 바뀌지 않습니다.",
    presetAssignSave: "할당 저장",
    presetAssignSaving: "저장 중…",
    presetAssignSaved: "권한 프리셋 할당을 저장했습니다",
    presetAssignUnsaved: "저장되지 않은 변경 사항이 있습니다",
    noPresetsAvailable: "이용 가능한 권한 프리셋이 없습니다",

    effectiveTitle: "이 멤버가 할 수 있는 작업",
    effectiveHint: "항상 본인의 출퇴근 기록·신청 작성·자신의 기록 열람이 가능합니다(전원 공통, 설정 변경 불가).",
    effectiveEmpty: "위의 기본 작업 외에 할당된 권한이 없습니다.",
    effectiveScopeLabel: "적용 범위",
    effectiveSourceLabel: "출처",
    /** 자체 검토를 통한 개선: 프리셋명에 바로 괄호를 붙였더니 밀도가 높아 읽기 어려웠음.
     * 앞에 구두점을 추가해 문장으로 구분하고, 알기 쉬운 표현으로 바꿈. */
    effectiveViaImplication: ". 다른 권한에 자동으로 포함되는 열람 권한입니다",
    /** 거부(deny)된 항목의 칩과 주석(2026-08-24 추가). */
    effectiveDeniedChip: "거부",
    effectiveDeniedBy: (names: string) => `「${names}」의 거부 설정으로 인해 이 권한은 행사할 수 없습니다`,

    errors: {
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_email: "이메일 주소 형식을 확인해 주세요",
      invalid_name: "이름을 1~200자로 입력해 주세요",
      invalid_department_id: "지정한 부서를 찾을 수 없습니다",
      invalid_hire_date: "입사일은 YYYY-MM-DD 형식으로 입력해 주세요",
      invalid_leave_grant_class: "연차 부여 구분 지정이 올바르지 않습니다",
      email_already_exists: "이 이메일 주소는 이미 등록되어 있습니다",
      not_found: "대상 멤버를 찾을 수 없습니다",
      invalid_preset_id: "지정한 권한 프리셋을 찾을 수 없습니다",
      self_escalation: "자기 자신에게 새 권한을 부여할 수 없습니다",
      self_demotion: "자신에게서 권한 관리 권한을 제거할 수 없습니다",
      last_admin: "권한 관리가 가능한 마지막 멤버에게서 이 권한을 제거할 수 없습니다",
      /** 초대 재발급·취소(2026-08-23 추가). */
      already_active: "이 멤버는 이미 본등록이 완료되었습니다(초대 재발급이 필요하지 않습니다)",
      already_accepted: "이 초대는 이미 수락되었습니다",
      already_revoked: "이 초대는 이미 취소되었습니다",
      /** 퇴직 처리된 멤버에 대한 초대 재발급·비밀번호 재설정 발급(2026-08-23 Tier 0 4번째 추가). */
      member_inactive: "퇴직 처리된 멤버입니다. 조작하려면 먼저 재활성화해 주세요",
      /** 관리자 발급 비밀번호 재설정(2026-08-23 Tier 0 4번째 추가). 미수락 멤버에게는 발급할 수 없습니다. */
      not_active: "이 멤버는 아직 초대를 수락하지 않았습니다. 초대 재발급을 이용해 주세요",
      /** 비밀번호 재설정 취소(2026-08-23 Tier 0 4번째 추가). */
      password_reset_already_used: "이 재설정은 이미 사용되었습니다",
      password_reset_already_revoked: "이 재설정은 이미 취소되었습니다",
      /** 퇴직 처리(비활성화·재활성화, 2026-08-23 Tier 0 4번째 추가). */
      cannot_deactivate_self: "자기 자신을 비활성화할 수 없습니다",
      already_inactive: "이 멤버는 이미 비활성화되어 있습니다",
      /** 재활성화(2026-08-23 Tier 0 4번째 추가). 초대의 already_active와 문구를 구분함. */
      member_already_active: "이 멤버는 이미 활성 상태입니다",
      /** 멤버별 근로시간제 할당(2026-08-23 Tier 0 4번째 추가). */
      invalid_work_system_kind: "제도를 선택해 주세요",
      invalid_effective_from: "적용 시작일을 확인해 주세요",
      effective_from_in_past: "적용 시작일은 오늘 이후로만 지정할 수 있습니다(과거 집계 결과가 바뀌기 때문입니다)",
      assignment_already_exists: "해당 적용 시작일에는 이미 할당이 있습니다. 다른 날짜를 지정해 주세요",
      /** 1일당 기준 소정근로시간(연차 환산용, v0.7 4단계, 2026-08-24 추가). */
      invalid_standard_day_minutes: "1일당 기준 소정근로시간은 1~1440분의 정수로 입력해 주세요",
      version_already_exists: "해당 적용 시작일에는 이미 같은 설정의 버전이 있습니다. 다른 날짜를 지정해 주세요",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  presets: {
    title: "권한 프리셋 관리",
    tagline: "권한 ON/OFF와 스코프를 조합한 프리셋을 생성·편집합니다. 한 명에게 여러 개를 할당하면 합산됩니다.",
    noPermission: "이 화면을 이용할 권한이 없습니다",
    loadFailed: "권한 프리셋을 가져오지 못했습니다. 다시 시도해 주세요",
    empty: "권한 프리셋이 없습니다",

    columnName: "이름",
    columnDescription: "설명",
    columnType: "종류",
    columnAssignedCount: "할당 인원",
    columnActions: "작업",
    systemBadge: "표준",
    customBadge: "커스텀",
    noDescription: "(설명 없음)",
    assignedCountUnit: "명",

    addNew: "프리셋 신규 생성",
    edit: "편집",
    duplicate: "복제하여 편집",
    delete: "삭제",

    formTitleCreate: "권한 프리셋 신규 생성",
    formTitleEdit: "권한 프리셋 편집",
    formReadonlyNote: "표준 프리셋은 편집할 수 없습니다. 내용을 변경하려면 「복제하여 편집」에서 새 프리셋을 생성해 주세요.",
    /** 「복제하여 편집」시의 초기 이름(원래 이름 뒤에 붙인다). */
    duplicateNameSuffix: (name: string) => `${name} 사본`,
    nameLabel: "이름",
    namePlaceholder: "예: 경리 매니저",
    descriptionLabel: "설명(선택)",
    descriptionPlaceholder: "이 프리셋의 용도를 적어두면 고민 없이 선택할 수 있습니다",
    permissionsLabel: "권한",
    scopeLabel: "적용 범위",
    dangerousBadge: "중요",
    dangerousNote: "이 권한은 영향이 큰 작업입니다. 부여 대상을 잘 확인해 주세요.",
    impliesViewPrefix: "이 권한에는 다음 열람 권한이 포함됩니다: ",
    /** 거부(deny) 섹션(2026-08-24 추가). docs/design/permission-catalog.md 참조. */
    deniesSectionTitle: "거부(deny) 설정",
    deniesCount: (n: number) => `${n}건 거부 중`,
    deniesWarning: "거부는 모든 부여보다 우선합니다. 다른 프리셋에서 부여했더라도 무효가 됩니다",
    deniesHint:
      "「이 사람에게만은 절대 시키지 않는다」를 나타내기 위한 설정입니다. 보통은 부여하지 않는 것만으로 충분합니다. 본인의 출퇴근 기록·본인의 신청·본인의 기록 열람은 거부할 수 없습니다.",
    save: "저장",
    saving: "저장 중…",
    cancel: "취소",
    close: "닫기",

    confirmDeleteTitle: "이 권한 프리셋을 삭제하시겠습니까",
    confirmDeleteMessage: "삭제하면 되돌릴 수 없습니다. 멤버에게 할당되어 있는 경우 삭제할 수 없습니다.",
    confirmDeleteLabel: "삭제",

    errors: {
      invalid_name: "이름을 1~100자로 입력해 주세요",
      invalid_description: "설명은 500자 이내로 입력해 주세요",
      invalid_grants: "선택한 권한 내용을 확인해 주세요",
      invalid_denies: "거부로 선택한 권한 내용을 확인해 주세요",
      last_admin: "이 변경을 저장하면 테넌트에 권한 프리셋을 관리할 수 있는 사람이 없어집니다",
      invalid_body: "입력 내용을 확인해 주세요",
      not_found: "대상 권한 프리셋을 찾을 수 없습니다",
      system_preset: "표준 프리셋은 편집·삭제할 수 없습니다",
      preset_in_use: "이 프리셋은 현재 멤버에게 할당되어 있어 삭제할 수 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /** 연차유급휴가 홈(/leave, v0.3). docs/requirements.md §5·docs/design/ui-direction.md. */
  leave: {
    title: "연차유급휴가",
    tagline: "잔여일수 확인, 휴가 신청, 신청 승인을 수행합니다.",
    loadFailed: "연차유급휴가 정보를 가져오지 못했습니다. 다시 시도해 주세요",

    balanceTitle: "잔여일수",
    annualLabel: "연차유급",
    stockedLabel: "적립 휴가",
    remainingLabel: "잔여",
    grantedTotalLabel: "부여 합계",
    usedTotalLabel: "사용 완료",
    noGrants: "부여된 연차가 없습니다",
    grantBreakdownToggle: "부여별 내역",
    grantColumnGrantedOn: "부여일",
    grantColumnDays: "일수",
    grantColumnExpiresOn: "기한",
    grantColumnRemaining: "잔여",
    grantExpired: "시효 소멸",
    expiringSoonTitle: "곧 소멸됩니다",
    expiringSoonNote: "60일 이내에 기한이 도래하는 부여분이 있습니다. 빠른 사용을 권장합니다.",

    mandatoryTitle: "연 5일 취득 의무 현황",
    mandatoryNone: "대상이 되는 부여(연 10일 이상)가 없습니다",
    mandatoryTakenLabel: "취득",
    mandatoryRequiredLabel: "필요",
    mandatoryDeadlineLabel: "기한",
    mandatoryShortagePrefix: "앞으로",
    mandatoryShortageSuffix: "일",
    mandatorySatisfied: "달성",

    requestFormTitle: "휴가 신청",
    dateLabel: "대상일",
    unitLabel: "단위",
    unitFullDay: "종일 휴가",
    unitHalfDayAm: "오전 반차",
    unitHalfDayPm: "오후 반차",
    unitHourly: "시간 단위",
    minutesLabel: "시간(분)",
    minutesPlaceholder: "예: 120",
    leaveTypeLabel: "사용할 항목",
    leaveTypeAnnual: "연차유급",
    leaveTypeStocked: "적립 휴가",
    reasonLabel: "사유",
    reasonPlaceholder: "휴가 사유를 입력해 주세요",
    hourlyQuotaPrefix: "시간 단위로 사용할 수 있는 것은 연 5일분까지입니다(현재 ",
    hourlyQuotaSeparator: " / 상한 ",
    hourlyQuotaSuffix: ")",
    submit: "신청하기",
    submitting: "전송 중…",
    submitted: "신청을 전송했습니다. 승인되면 근태 기록에 반영됩니다.",
    targetMonthClosedNote: "이번 달은 마감이 완료되었습니다. 승인하려면 마감 해제 권한이 필요합니다.",

    requestsTitle: "신청 목록",
    requestsEmpty: "신청이 아직 없습니다",

    queueSectionTitle: "승인 대기 중인 휴가 신청",
    queueSectionTagline: "승인 권한이 있는 범위 내에서 승인 대기 중인 휴가 신청입니다.",
    queueEmpty: "승인 대기 중인 신청이 없습니다",
    columnDate: "대상일",
    columnUnit: "단위",
    columnLeaveType: "항목",
    columnReason: "사유",
    columnDecision: "결재",

    statusLabel: {
      pending: "신청 중",
      /** 2단계 승인일 때만 나타나는 중간 상태. 아직 출퇴근 기록에는 반영되지 않았다. */
      approved_step1: "1차 승인됨(2차 대기)",
      approved: "승인됨",
      rejected: "반려",
      withdrawn: "철회",
    } satisfies Record<"pending" | "approved_step1" | "approved" | "rejected" | "withdrawn", string>,

    unitLabelShort: {
      full_day: "종일",
      half_day_am: "오전 반차",
      half_day_pm: "오후 반차",
      hourly: "시간 단위",
    } satisfies Record<"full_day" | "half_day_am" | "half_day_pm" | "hourly", string>,

    /** 시간 단위 신청 목록에서 unitLabelShort.hourly 뒤에 붙이는 「(120분)」과 같은 보충 표기. */
    hourlyMinutesSuffix: (minutes: number) => ` (${minutes}분)`,

    leaveTypeLabelShort: {
      annual: "연차유급",
      stocked: "적립 휴가",
    } satisfies Record<"annual" | "stocked", string>,

    approve: "승인",
    reject: "반려",
    withdraw: "철회",
    decidedBySelf: "본인",
    decisionNoteLabel: "결재 메모",
    decisionNotePlaceholder: "메모(선택)",

    confirmApproveTitle: "이 신청을 승인하시겠습니까",
    confirmApproveMessage: "승인하면 근태 기록에 반영되어 월간 집계가 변경됩니다. 이 작업은 감사 로그에 기록됩니다.",
    confirmApproveSelfNote: "자기 승인으로 기록됩니다.",
    confirmRejectTitle: "이 신청을 반려하시겠습니까",
    confirmRejectMessage: "반려하면 신청이 반려 완료 상태로 기록되며, 근태 기록에는 반영되지 않습니다.",
    confirmWithdrawTitle: "이 신청을 철회하시겠습니까",
    confirmWithdrawMessage: "철회하면 신청 중 상태가 해제됩니다. 필요하다면 다시 신청할 수 있습니다.",

    close: "닫기",
    cancel: "취소",

    errors: {
      invalid_leave_date: "대상일을 확인해 주세요",
      invalid_reason: "사유를 1~500자로 입력해 주세요",
      invalid_unit: "단위를 확인해 주세요",
      invalid_leave_type: "사용할 항목을 확인해 주세요",
      invalid_minutes: "시간(분)을 올바르게 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      hourly_leave_disabled: "시간 단위 사용은 이 테넌트에서 활성화되어 있지 않습니다",
      half_day_leave_disabled: "반차 사용은 이 테넌트에서 활성화되어 있지 않습니다",
      duplicate_request: "같은 날·같은 단위의 신청이 이미 있습니다",
      exceeds_daily_hours: "하루 소정근로시간을 초과했습니다",
      insufficient_balance: "잔여일수가 부족합니다",
      hourly_limit_exceeded: "시간 단위로 사용할 수 있는 연간 상한을 초과합니다",
      not_pending: "이 신청은 이미 처리되었습니다",
      not_found: "대상 신청을 찾을 수 없습니다",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      /** 409. 2단계 승인에서 1차 승인을 한 본인이 2차 승인을 하려고 한 경우. */
      same_approver_as_step1: "1차 승인을 한 본인은 2차 승인을 할 수 없습니다. 다른 승인자에게 요청해 주세요",
      month_closed_requires_unlock: "이번 달은 마감이 완료되었습니다. 승인하려면 마감 해제 권한이 필요합니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /** 연차유급휴가 제도 설정(/settings/leave, v0.3). GET/PUT /settings/leave 와 부여 관리 엔드포인트의 문구를 정리. */
  settingsLeave: {
    title: "연차유급휴가 설정",
    tagline: "부여 방식·시간 단위 연차·적립 휴가의 테넌트 전체 설정을 수행합니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    loadFailed: "설정을 가져오지 못했습니다. 다시 시도해 주세요",

    grantMethodSectionTitle: "부여 방식",
    grantMethodStatutory: "법정(입사일 기준)",
    grantMethodFixedDate: "기준일 방식(전사 일괄)",
    fixedDateLabel: "기준일(월-일)",
    fixedDatePlaceholder: "예: 04-01",

    hourlySectionTitle: "시간 단위 연차",
    hourlyEnabledLabel: "시간 단위 연차 활성화",
    hourlyMaxDaysLabel: "연간 상한 일수(1~5)",

    halfDaySectionTitle: "반차",
    halfDayEnabledLabel: "반차 활성화",

    stockSectionTitle: "소멸분 적립",
    stockEnabledLabel: "소멸분 적립 활성화",
    stockHelp: "시효로 소멸되는 연차유급휴가를 별도 항목에 적립하는 제도입니다. 법정 제도가 아니라 회사가 임의로 마련하는 제도입니다.",
    stockMaxDaysLabel: "적립 상한 일수",
    stockExpiresMonthsLabel: "적립분 유효기간(개월 수, 공백이면 무기한)",

    save: "저장",
    saving: "저장 중…",
    saveSuccess: "설정을 저장했습니다.",
    saveNote: "이 설정은 테넌트 전체에 적용됩니다. 변경 사항은 감사 로그에 기록됩니다.",

    adminSectionTitle: "부여·적립 관리",
    adminSectionTagline: "대상 멤버를 선택해 실행합니다. 이 작업은 감사 로그에 기록됩니다.",
    targetUserLabel: "대상 멤버",
    targetUserPlaceholder: "멤버를 선택해 주세요",

    autoGrantTitle: "법정 부여 실행",
    autoGrantDesc: "입사일로부터 계산해 미부여분을 생성합니다. 이미 부여된 분은 생성되지 않습니다.",
    autoGrantRun: "법정 부여 실행",
    autoGrantRunning: "실행 중…",
    autoGrantResultCreatedPrefix: "",
    autoGrantResultCreatedSuffix: "건 부여했습니다",
    autoGrantResultSkippedPrefix: "(부여 완료 등으로 건너뜀 ",
    autoGrantResultSkippedSuffix: "건)",
    autoGrantEmpty: "새로 부여할 수 있는 항목이 없었습니다",

    manualGrantTitle: "수동 부여",
    manualGrantDesc: "임의의 일수·기한으로 연차를 부여합니다.",
    grantedOnLabel: "부여일",
    daysLabel: "일수",
    expiresOnLabel: "기한(공백이면 기본값: 연차유급은 부여일+2년, 적립은 무기한)",
    leaveTypeLabel: "종류",
    leaveTypeAnnual: "연차유급",
    leaveTypeStocked: "적립 휴가",
    noteLabel: "메모(선택)",
    manualGrantSubmit: "부여하기",
    manualGrantSubmitting: "처리 중…",
    manualGrantSuccess: "부여했습니다.",

    convertTitle: "소멸분 적립 전환",
    convertDesc: "시효로 소멸된 연차유급휴가의 미사용분을 적립 휴가로 전환합니다.",
    convertRun: "적립 전환 실행",
    convertRunning: "실행 중…",
    convertResultTitle: "전환 결과",
    convertResultConvertedPrefix: "전환 일수: ",
    convertResultConvertedSuffix: "일",
    convertResultTruncatedPrefix: "(상한 초과로 절사: ",
    convertResultTruncatedSuffix: "일)",
    convertResultEmpty: "전환 대상이 없었습니다",

    errors: {
      invalid_grant_method: "부여 방식을 확인해 주세요",
      invalid_fixed_date_mm_dd: "기준일은 MM-DD 형식으로 입력해 주세요",
      invalid_hourly_leave_enabled: "입력 내용을 확인해 주세요",
      invalid_half_day_leave_enabled: "입력 내용을 확인해 주세요",
      invalid_stock_conversion_enabled: "입력 내용을 확인해 주세요",
      invalid_hourly_leave_max_days: "연간 상한 일수는 1~5 범위로 입력해 주세요",
      invalid_stock_max_days: "적립 상한 일수를 올바르게 입력해 주세요",
      invalid_stock_expires_months: "적립분 유효기간(개월 수)을 올바르게 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      invalid_user_id: "대상 멤버를 선택해 주세요",
      invalid_granted_on: "부여일을 확인해 주세요",
      invalid_days: "일수를 올바르게 입력해 주세요",
      invalid_expires_on: "기한을 확인해 주세요",
      invalid_leave_type: "종류를 확인해 주세요",
      invalid_note: "메모를 확인해 주세요",
      not_found: "대상을 찾을 수 없습니다",
      hire_date_not_set: "대상 멤버의 입사일이 설정되어 있지 않습니다",
      leave_settings_not_configured: "먼저 연차 제도 설정을 저장해 주세요",
      stock_conversion_disabled: "적립 설정이 활성화되어 있지 않습니다",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 연차 부여 예고(/settings/leave 의 「부여 예고」 섹션, v0.7 4단계, 2026-08-24 추가).
   * docs/requirements.md §11 「예고 → 관리자 승인 → 본인 통지」. 기계는 부여를 확정하지 않으며,
   * 출근율(노동기준법 제39조 1항의 8할 요건)은 어디까지나 참고값으로만 제시한다.
   */
  leaveGrantProposals: {
    sectionTitle: "부여 예고",
    sectionDesc:
      "일일 자동 계산이 만든 부여 「예고」입니다. 예고 상태로는 부여되지 않으며, 내용을 확인하고 담당자가 승인해야 비로소 확정됩니다. 출근율은 참고값이며 8할 요건의 최종 판단은 사람이 해 주세요.",
    loadFailed: "부여 예고를 가져오지 못했습니다. 다시 시도해 주세요",
    empty: "현재 부여 예고가 없습니다",

    columnMember: "멤버",
    columnLeaveType: "휴가 종류",
    columnGrantedOn: "기준일",
    columnDays: "일수",
    columnAttendanceRate: "출근율(참고값)",
    columnActions: "작업",

    leaveTypeAnnual: "연차유급휴가",
    leaveTypeStocked: "적립 휴가",

    basisShift: "시프트 기준",
    basisCalendarEstimate: "달력 기준 추정",
    /** 전체 소정근로일이 0이라 출근율을 낼 수 없을 때. 0%가 아니라 「알 수 없음」을 뜻한다. */
    rateUnknown: "—",
    rateBelowThreshold: "8할 미만일 가능성 — 확인해 주세요",
    proportionalChip: (weekDaysLabel: string) => `비례부여(${weekDaysLabel})`,

    approve: "승인",
    reject: "반려",
    confirmApproveTitle: "이 예고를 승인하시겠습니까",
    confirmApproveMessage: "승인하면 이 내용대로 연차유급휴가가 부여됩니다. 부여일은 예고의 기준일 그대로입니다.",
    confirmRejectTitle: "이 예고를 반려하시겠습니까",
    confirmRejectMessage: "반려하면 부여되지 않습니다. 사유를 남겨 두면 나중에 경위를 확인할 수 있습니다.",
    noteLabel: "반려 사유(선택)",
    notePlaceholder: "예: 출근율이 8할에 미치지 못하기 때문",
    approveSuccess: "승인하여 부여했습니다.",
    rejectSuccess: "반려했습니다.",

    historyTitle: "결재 완료된 예고",
    historyEmpty: "결재 완료된 예고가 없습니다",
    columnStatus: "상태",
    columnDecidedAt: "결재 일시",
    columnDecisionNote: "반려 사유",
    statusLabel: {
      proposed: "미결재",
      approved: "승인",
      rejected: "반려",
      superseded: "재작성",
    },

    errors: {
      not_found: "대상 예고를 찾을 수 없습니다",
      not_proposed: "이 예고는 이미 결재되었습니다. 화면을 새로고침하여 최신 상태를 확인해 주세요",
      grant_already_exists: "같은 기준일의 부여가 이미 있습니다. 수동 부여와 중복되지 않았는지 확인해 주세요",
      invalid_status: "표시 조건을 확인해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 사내 규정 편집 화면(/settings/help, 2026-08-22 추가).
   * docs/design/ui-direction.md 「가이드·도움말 방침 > 사내 규정 작성 예시」의 3원칙을 화면에 그대로 명시한다.
   */
  settingsHelp: {
    title: "사내 규정",
    tagline: "기본 제공 도움말(법령·KIZAMI 사양)에 자사 규칙을 추가할 수 있습니다.",
    noPermission: "이 설정을 변경할 권한이 없습니다",
    loadFailed: "정보를 가져오지 못했습니다. 다시 시도해 주세요",

    guidelinesTitle: "작성 가이드라인",
    guideline1: "법령 내용은 옮겨 적지 않습니다 — 법령 부분은 자동으로 표시됩니다. 중복해서 적으면 법개정 시 KIZAMI 쪽만 갱신되어 이 항목에 오래된 내용이 남아 모순이 생깁니다",
    guideline2: "자사에서 정한 내용만 적습니다 — 기한·담당 창구·예외 처리 등",
    guideline3: "취업규칙의 해당 조문을 참조하는 형태가 바람직합니다(예: 「자세한 내용은 취업규칙 제○조」)",

    workRulesSectionTitle: "취업규칙 링크",
    workRulesDesc: "취업규칙(PDF 등)의 URL을 설정하면, 도움말 화면에 「취업규칙 보기」 링크가 표시됩니다.",
    workRulesUrlLabel: "URL",
    workRulesUrlPlaceholder: "https://example.com/work-rules.pdf",
    workRulesSave: "저장",
    workRulesSaving: "저장 중…",
    workRulesSaveSuccess: "취업규칙 링크를 저장했습니다.",

    listTitle: "도움말 항목",
    listEmployeeGroup: "직원용",
    listAdminGroup: "노무 담당자용",
    originLaw: "법령",
    originProduct: "KIZAMI 사양",
    hasOverrideBadge: "추가 내용 있음",
    selectPrompt: "왼쪽 목록에서 도움말 항목을 선택해 주세요.",

    referenceTitle: "기본 제공 설명",
    editorTitle: "자사 규정",
    editorPlaceholderNote: "옅은 글씨는 작성 예시입니다. 그대로 사용하려면 복사해 주세요.",
    bodyLabel: "본문(Markdown)",
    save: "저장",
    saving: "저장 중…",
    saveSuccess: "사내 규정을 저장했습니다.",
    deleteConfirmTitle: "사내 규정 삭제",
    deleteConfirmMessage: "이 항목의 자사 규정을 삭제합니다. 기본 제공 설명만 표시되는 상태로 돌아갑니다.",
    delete: "삭제",
    deleting: "삭제 중…",
    deleteSuccess: "사내 규정을 삭제했습니다.",
    empty: "본문이 비어 있어 저장하면 삭제로 처리됩니다.",

    errors: {
      invalid_help_key: "존재하지 않는 도움말 항목입니다",
      invalid_body_md: "본문을 확인해 주세요",
      invalid_url: "URL은 http(s) 형식으로 입력해 주세요",
      invalid_body: "입력 내용을 확인해 주세요",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  /**
   * 개인정보 관련 템플릿 화면(/settings/privacy, 2026-08-22 추가).
   * docs/design/ui-direction.md 「개인정보 관련 템플릿」의 요건대로, 어디까지나 템플릿이며
   * 법적 조언이 아님을 화면에 항상 표시한다.
   */
  settingsPrivacy: {
    title: "개인정보",
    tagline: "직원 대상 개인정보 안내·사내 이용약관 템플릿을 현재 설정을 기준으로 생성합니다.",
    noPermission: "이 설정을 볼 권한이 없습니다",
    loadFailed: "정보를 가져오지 못했습니다. 다시 시도해 주세요",

    disclaimer:
      "이 문구는 KIZAMI가 제공하는 템플릿입니다. 반드시 자사 실정에 맞게 검토하고, 필요하다면 전문가(사회보험노무사·변호사 등)에게 확인해 주세요. 법적 조언이 아닙니다.",

    generatedFromTitle: "이 템플릿의 기반이 된 설정",
    generatedFromGpsOn: "GPS: 활성화",
    generatedFromGpsOff: "GPS: 비활성화",
    generatedFromRetention: (days: number) => `위치 정보 보관 기간: ${days}일`,
    generatedFromRetentionSame: "위치 정보 보관 기간: 출퇴근 기록과 동일",
    generatedFromNote: "GPS 활성화/비활성화나 보관 기간은 「설정 > 테넌트 프로필」 등 테넌트 설정 변경에 따라 다음 표시 시 갱신됩니다.",

    noticeSectionTitle: "직원 대상 개인정보 안내",
    noticeSectionDesc: "수집 항목·이용 목적·보관 기간·열람 등 청구처를 정리한 템플릿입니다. 직원 안내에 활용해 주세요.",
    termsSectionTitle: "사내 이용약관(출퇴근 기록 관련 규칙)",
    termsSectionDesc: "정확한 출퇴근 기록 의무·대리 기록 금지·수정 신청 절차 등을 정리한 템플릿입니다.",

    copy: "복사",
    copied: "복사했습니다",
    copyFailed: "복사에 실패했습니다. 직접 선택해서 복사해 주세요",
    download: "Markdown 다운로드",
    registerAsCompanyRule: "사내 규정으로 등록",
    registering: "등록 중…",
    registerSuccess: "사내 규정으로 등록했습니다. 「설정 > 사내 규정」에서 편집할 수 있습니다.",
    registerFailed: "등록에 실패했습니다. 다시 시도해 주세요",
  },

  /**
   * API 키(공개 출퇴근 API, v0.4) 관리 화면(/settings/api-keys).
   * 권한이 필요하지 않음(자신의 키는 누구나 발급·폐기할 수 있음, 요청 「본인용이므로 권한 불필요」).
   */
  settingsApiKeys: {
    title: "API 키",
    tagline: "IC카드 리더·Slack bot·MCP 서버 등 세션 쿠키를 가질 수 없는 외부 클라이언트에서 출퇴근을 기록하기 위한 키입니다.",
    loadFailed: "정보를 가져오지 못했습니다. 다시 시도해 주세요",

    listTitle: "발급된 키",
    empty: "발급된 API 키가 없습니다.",
    columnName: "이름",
    columnScopes: "스코프",
    columnCreated: "생성일",
    columnLastUsed: "마지막 사용",
    columnExpires: "유효 기간",
    columnStatus: "상태",
    columnActions: "작업",
    neverUsed: "미사용",
    noExpiry: "무기한",
    statusActive: "활성",
    statusRevoked: "폐기됨",
    statusExpired: "기한 만료",
    revoke: "폐기",
    revoking: "폐기하는 중…",

    revokeConfirmTitle: "API 키를 폐기합니다",
    revokeConfirmMessage: "이 키를 사용하는 연동(IC카드 리더·Slack bot·MCP 서버 등)이 동작하지 않게 됩니다. 이 작업은 되돌릴 수 없습니다.",

    scopePunch: "출퇴근(punch) — 자신의 출퇴근 기록 생성·조회",
    scopeRead: "조회(read) — 자신의 근태 조회만",

    createTitle: "새 키 발급",
    nameLabel: "이름(용도를 알 수 있는 것)",
    namePlaceholder: "예: 2층 입구 IC카드 리더",
    scopesLabel: "스코프(복수 선택 가능)",
    expiresLabel: "유효 기간(선택)",
    expiresHint: "공백으로 두면 무기한이 됩니다.",
    issue: "발급하기",
    issuing: "발급하는 중…",

    createdTitle: "키를 발급했습니다",
    createdWarning: "이 값은 다시 표시되지 않습니다. 안전한 곳에 보관해 주세요.",
    createdTokenLabel: "API 키",
    copy: "복사",
    copied: "복사했습니다",
    copyFailed: "복사에 실패했습니다. 직접 선택해서 복사해 주세요",
    createdDone: "닫기",

    usageExampleTitle: "사용 예시",
    usageExampleDesc: "발급한 키를 Authorization 헤더에 Bearer 토큰으로 담아 요청해 주세요.",
    usageExampleCurlComment: "# 출근 기록",

    errors: {
      invalid_name: "이름을 1~100자로 입력해 주세요",
      invalid_scopes: "스코프를 1개 이상 선택해 주세요",
      invalid_expires_at: "유효 기간 형식을 확인해 주세요",
      not_found: "대상 키를 찾을 수 없습니다",
      already_revoked: "이 키는 이미 폐기되었습니다",
      forbidden: "이 작업을 수행할 권한이 없습니다",
      default: "처리에 실패했습니다. 다시 시도해 주세요",
    },
  },

  settingsAuditLogs: {
    title: "감사 로그",
    tagline: "출퇴근·수정·승인·마감·권한 변경 등 조작 기록입니다.",
    immutableNote: "감사 로그는 추가 전용 기록으로, 이후에 변경·삭제되지 않습니다(읽기 전용).",
    loadFailed: "정보를 가져오지 못했습니다. 다시 시도해 주세요",
    forbidden: "이 작업을 수행할 권한이 없습니다",

    filterActionLabel: "액션",
    filterActionAll: "전체",
    filterActorLabel: "조작자(사용자 ID)",
    filterActorPlaceholder: "비워두면 전원 대상",
    filterFromLabel: "기간(시작일)",
    filterToLabel: "기간(종료일)",
    filterApply: "필터 적용",
    filterClear: "조건 초기화",
    filterInvalidRange: "종료일은 시작일 이후로 설정해 주세요",

    columnOccurredAt: "일시",
    columnActor: "조작자",
    columnAction: "액션",
    columnTarget: "대상",
    columnDetail: "상세",
    detailToggle: "상세 보기",
    detailUnavailable: "상세 정보가 없습니다",

    empty: "조건에 일치하는 감사 로그가 없습니다.",
    loadMore: "더 불러오기",
    loadingMore: "불러오는 중…",
    loadMoreFailed: "추가 데이터를 가져오지 못했습니다. 다시 시도해 주세요",
  },
} satisfies Messages;
