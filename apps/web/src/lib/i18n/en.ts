/**
 * 表示文言(英語)。lib/i18n/ja.ts の構造をそのまま英訳したもの。
 * 型は ja から導出される Messages を `satisfies` で満たし、キーの過不足をコンパイルエラーにする。
 */
import type { Messages } from "./index";

const EN_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const en = {
  appName: "KIZAMI",
  tagline: "Attendance management, tracked to the minute.",

  nav: {
    dashboard: "Home",
    punch: "Punch",
    monthly: "Monthly",
    corrections: "Requests",
    leave: "Leave",
    /** Shifts (/shifts, /shifts/me). Holders of shift.manage go to /shifts; everyone else goes to /shifts/me (added 2026-08-24). */
    shifts: "Shifts",
    settings: "Settings",
    logout: "Log out",
  },

  /** Mobile bottom tab bar and "More" sheet (added 2026-08-22 nav rework). */
  mobileNav: {
    more: "More",
    moreAriaLabel: "Open the more menu",
    sheetTitle: "Menu",
    close: "Close",
    openNotifications: "View notifications",
    /** Link to the notifications list screen (/notifications, added 2026-08-22). Distinct from openNotifications (opens the bell dropdown). */
    allNotifications: "View all notifications",
    stampScreenLink: "Open the punch screen with stamp animation →",
  },

  /** Tenant name shown in the shared header (added 2026-08-23). Addresses the need to
   * tell which company's instance you're in — the logo alone wasn't enough. */
  header: {
    tenantAriaLabel: "Organization",
  },

  /** Home (dashboard, added 2026-08-22). See docs/design/ui-direction.md "Upcoming UI work > 4". */
  dashboard: {
    title: "Home",
    punchSectionTitle: "Punch",
    todayTitle: "Today & this month",
    todayWorkedLabel: "Worked today",
    monthFlexLabel: "This month's flex balance",
    monthFlexMoreLink: "View monthly →",

    /** Today's and tomorrow's shift (added 2026-08-24, v0.7 phase 3). The card itself is hidden when there is no shift at all. */
    shiftCardTitle: "Today's and tomorrow's shifts",
    shiftCardTodayLabel: "Today",
    shiftCardTomorrowLabel: "Tomorrow",

    todoTitle: "Needs attention",
    todoEmpty: "Nothing needs your attention right now.",
    todoLoadFailed: "Some information could not be loaded.",

    todoNotificationsTitle: "Unread notifications",
    todoNotificationsCountSuffix: "",
    todoNotificationsMore: "There are more unread notifications",

    todoApprovalsTitle: "Requests awaiting approval",
    todoApprovalsCorrections: "Punch correction requests",
    todoApprovalsLeave: "Leave requests",
    /** Leave grant proposals (v0.7 phase 4, added 2026-08-24). Only shown to holders of leave.grant.manage. */
    todoApprovalsProposals: "Leave grant proposals",
    todoApprovalsCountSuffix: "",
    todoApprovalsGoCorrections: "View correction requests →",
    todoApprovalsGoLeave: "View annual paid leave →",
    todoApprovalsGoProposals: "View grant proposals →",

    todoWarningsTitle: "Days with punch warnings",
    todoWarningsMore: (n: number) => `${n} more day${n === 1 ? "" : "s"}`,
    todoWarningsFix: "Fix",

    todoDeadlinesTitle: "Obligations with an approaching deadline",
    todoDeadlinesMandatoryPrefix: "Short of the mandatory 5-day minimum by ",
    todoDeadlinesMandatorySuffix: " day(s) (deadline: ",
    todoDeadlinesMandatorySuffix2: ")",
    todoDeadlinesExpiring: "Some annual paid leave is about to expire",
    todoDeadlinesGoLeave: "View annual paid leave →",

    quickLinksTitle: "Frequently used pages",
    quickLinkMonthlyTitle: "Monthly",
    quickLinkMonthlyDesc: "Check worked hours, flex balance, and days with warnings.",
    quickLinkCorrectionsTitle: "Requests",
    quickLinkCorrectionsDesc: "Request additions, corrections, or cancellations of punches.",
    quickLinkLeaveTitle: "Annual paid leave",
    quickLinkLeaveDesc: "Check your balance and request leave.",
  },

  /**
   * "Getting started" section on the dashboard (added 2026-08-22). See docs/design/ui-direction.md
   * "Upcoming UI work > 5. Onboarding". Quietly lists only incomplete items
   * (no modal forcing an action).
   */
  onboarding: {
    title: "Getting started",
    dismiss: "Don't show this again",

    punchTitle: "Try punching in",
    punchReason: "Once you punch in, tracking of your actual working hours starts for the day.",
    punchAction: "Open the punch screen →",

    notifPrefsTitle: "You can set how you receive notifications",
    notifPrefsReason: "By default, only in-app notifications are enabled. You can also receive them by email or webhook.",
    notifPrefsAction: "Open notification settings →",

    attendanceTitle: "Attendance settings are still at their defaults",
    attendanceReason: "Please review the day boundary, statutory holiday, GPS, and flextime settings to match your actual policy.",
    attendanceAction: "Open attendance settings →",

    channelsTitle: "No notification channels are configured",
    channelsReason: "Setting up email or webhook lets you deliver alerts, such as missed punches, to employees.",
    channelsAction: "Open notification settings (company-wide) →",

    soloTitle: "You're still the only member",
    soloReason: "Inviting members lets you manage other employees' punches and requests.",
    soloAction: "Invite a member →",

    hireDateTitle: (count: number) => `${count} member${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} no hire date set`,
    hireDateReason: "Without a hire date, the statutory grant of annual paid leave can't be calculated automatically.",
    hireDateAction: "Open member settings →",
  },

  /** Theme toggle (in the header's user menu, added 2026-08-22 for dark mode support). */
  theme: {
    label: "Theme",
    system: "Follow system setting",
    light: "Light",
    dark: "Dark",
  },

  /**
   * Language switcher (in the header's user menu, added 2026-08-23 for 4-language support).
   * Placed alongside ThemeToggle in the same spot with the same styling (k-header__theme look).
   * The option labels themselves (日本語 / English / 한국어 / 简体中文) are each language's own
   * name for itself, so they stay fixed regardless of locale — held in LOCALE_NATIVE_NAMES in
   * lib/i18n/index.ts, not in messages.
   */
  language: {
    label: "Language",
  },

  /** Small shared fragments (separators, etc.) reused across multiple screens. */
  common: {
    /** Loosely separates two short supplementary phrases (e.g. "Configured (…)" / "Leave blank to keep unchanged"). */
    hintSeparator: " · ",
  },

  /**
   * Surrounding UI text for HelpTip (help with law/KIZAMI-behavior/company-policy badges,
   * see docs/design/ui-direction.md "Guide & help policy"). The help content itself
   * (@kizami/help-content) is Japanese-only and out of scope here (.en.md etc. is future work).
   */
  helpTip: {
    originLaw: "Law",
    originProduct: "KIZAMI behavior",
    originCompany: "Company policy",
    ariaLabelPrefix: "Help",
    detailLink: "See details →",
    workRulesLink: "View work rules →",
  },

  /**
   * Shared date/time formatting (referenced from lib/time.ts, added 2026-08-23 for 4-language support).
   * The timezone stays fixed at JST (see the comment at the top of time.ts). Only how weekdays
   * and dates are displayed switches per locale.
   */
  time: {
    /** Short weekday labels matching the order of getUTCDay() (0 = Sunday). */
    weekdayShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as readonly [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ],
    /** "Month YYYY" (used e.g. in the monthly screen heading). */
    monthLabel: (year: number, month: number) => `${EN_MONTH_NAMES[month - 1]} ${year}`,
    /** "M/D (Weekday)". */
    dateLabel: (month: number, day: number, weekday: string) => `${month}/${day} (${weekday})`,
    /** Units/separator for formatDaysHoursMinutes (used in leave balance display). */
    unitDay: "d",
    unitHour: "h",
    unitMinute: "m",
    durationJoin: " ",
  },

  /** Large clock on the punch screen (PunchHome). */
  punchClock: {
    currentTimeAriaLabel: (hm: string, ss: string) => `Current time ${hm}:${ss}`,
  },

  /** Scope names (requirement §4). Narrow to broad: self < department < department_and_descendants < tenant. */
  scopeLabel: {
    self: "Self only",
    department: "Own department",
    department_and_descendants: "Own department + sub-departments",
    tenant: "Entire tenant",
  } satisfies Record<"self" | "department" | "department_and_descendants" | "tenant", string>,

  permissions: {
    categoryLabel: {
      attendance: "Punches, requests & approvals",
      leave: "Leave",
      closing: "Closing & exports",
      org: "Members & organization",
      settings: "Settings & permissions",
      other: "Other",
    } as Record<string, string>,
    internalViewLabel: {
      "department.view": "View department tree",
      "tenant_settings.view": "View tenant settings",
      "permission_preset.view": "View permission preset list",
      "permission_assignment.effective_view": "View a member's effective permissions (what they can do)",
      "api_key.view": "View API key list",
    } as Record<string, string>,
  },

  login: {
    title: "KIZAMI",
    tagline: "Attendance management, tracked to the minute",
    emailLabel: "Email address",
    passwordLabel: "Password",
    submit: "Log in",
    submitting: "Logging in…",
    invalidCredentials: "Incorrect email address or password",
    genericError: "Login failed. Please wait a moment and try again",

    /** Tenant picker for when the same email + password matches multiple tenants (added 2026-08-23).
     * Modeled on Slack's workspace picker; does not ask for the password again
     * (reuses the prior verification result and simply resends to the chosen tenant). */
    tenantSelectTitle: "Choose which company to log in to",
    tenantSelectDescription: "This email address has accounts at more than one company.",
    tenantUnnamed: "(Unnamed)",
    backToEmail: "Log in with a different account",
  },

  /**
   * Invitation acceptance screen (/invite/[token], no auth guard, public, added 2026-08-23).
   * See docs/requirements.md §7 "Sign-up is invitation-only". Uses the same "white paper +
   * centered card" layout as the login screen. Since this is often an employee's first
   * KIZAMI screen, the wording is kept especially gentle and unambiguous.
   */
  inviteAccept: {
    invitedBySuffix: " has invited you",
    invitedByUnnamed: "Your company",
    nameLabel: "Full name",
    emailLabel: "Email address",
    passwordLabel: "Password (12+ characters)",
    passwordConfirmLabel: "Password (confirm)",
    passwordMismatch: "Passwords do not match",
    passwordTooShort: "Password must be at least 12 characters",
    submit: "Sign up and get started",
    submitting: "Signing up…",
    loading: "Checking your invitation…",

    invalidTitle: "This invitation link is invalid",
    invalidMessage: "This invitation link is invalid. Please check with your administrator.",
    expiredTitle: "This invitation has expired",
    expiredMessage: "This invitation has expired. Please ask your administrator to reissue it.",
    acceptedRedirecting: "Sign-up complete. Redirecting…",

    sessionIssuanceFailedTitle: "Your account has been created",
    sessionIssuanceFailedMessage: "Your account has been created. Please sign in from the login page.",
    goToLogin: "Go to login",

    errors: {
      invalid_password: "Password must be at least 12 characters",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Password reset acceptance screen (/reset/[token], added 2026-08-23 Tier 0 part 4, no auth guard,
   * public). Mirrors inviteAccept (structure, state machine, tone). Setting a new password from an
   * admin-issued reset link signs you in immediately (routes/password-resets.ts).
   */
  passwordResetAccept: {
    tenantUnnamed: "Your company",
    introSuffix: " — reset your account password",
    nameLabel: "Full name",
    emailLabel: "Email address",
    newPasswordLabel: "New password (12+ characters)",
    newPasswordConfirmLabel: "New password (confirm)",
    passwordMismatch: "Passwords do not match",
    passwordTooShort: "Password must be at least 12 characters",
    submit: "Reset password",
    submitting: "Resetting…",
    loading: "Checking your reset link…",

    invalidTitle: "This reset link is invalid",
    invalidMessage: "This reset link is invalid. Please check with your administrator.",
    expiredTitle: "This reset link has expired",
    expiredMessage: "This reset link has expired. Please ask your administrator to issue a new one.",
    acceptedRedirecting: "Your password has been reset. Redirecting…",

    sessionIssuanceFailedTitle: "Your password has been updated",
    sessionIssuanceFailedMessage: "Your password has been updated. Please sign in again from the login page.",
    goToLogin: "Go to login",

    errors: {
      invalid_password: "Password must be at least 12 characters",
      default: "Something went wrong. Please try again",
    },
  },

  attendanceState: {
    out: "Off duty",
    working: "Working",
    onBreak: "On break",
  } satisfies Record<"out" | "working" | "onBreak", string>,

  punchButtons: {
    clockIn: "Clock in",
    breakStart: "Start break",
    breakEnd: "End break",
    clockOut: "Clock out",
  },

  punchHints: {
    clockInDisabled: "Only available while off duty",
    breakDisabled: "Only available while working",
    clockOutDisabled: "Only available while working",
  },

  punchKindLabel: {
    clock_in: "Clock in",
    break_start: "Break start",
    break_end: "Break end",
    clock_out: "Clock out",
  } satisfies Record<"clock_in" | "break_start" | "break_end" | "clock_out", string>,

  today: {
    title: "Today's punches",
    empty: "No punches yet today",
  },

  /**
   * GPS-tagged punches (v0.4, docs/requirements.md §3). To satisfy the requirement that
   * "employees must be clearly told location is being recorded while enabled", tenants with
   * GPS enabled always show noticeAlways near the punch buttons (never hidden behind a
   * toggle or tooltip).
   */
  punchGps: {
    noticeAlways: "Your location will be recorded with this punch",
    detailToggle: "Details",
    reason: "GPS recording is enabled in your company's settings so punch locations (e.g. for direct-to-site work) can be verified.",
    retentionPrefix: "Retention period: ",
    retentionSameAsAttendance: "Same as attendance data",
    retentionDaysSuffix: " day(s)",
    locating: "Getting your location…",
    unavailableNote: "Location could not be obtained, so this punch was recorded without location data",
  },

  /**
   * Offline punching (v0.4). As requested, v0.4 does not implement offline punch queuing
   * (it would create a mismatch between the actual punch time and the recorded time).
   * The app shell can still be opened via the Service Worker cache, but punches clearly
   * require a network connection.
   */
  offline: {
    banner: "You're offline. The screen is available, but punching requires a connection so the time can be recorded accurately.",
    punchDisabledHint: "You can't punch while offline",
  },

  errors: {
    punchFailed: "The punch failed. Please try again",
    loadFailed: "Failed to load data. Please try again",
    network: "Could not connect to the server",
  },

  loading: "Loading…",

  monthly: {
    title: "Monthly",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    columnDate: "Date",
    /** Column for punch times (clock in → clock out), added 2026-08-23. */
    columnStretches: "Shift",
    /**
     * On wider viewports, the single "Shift" column splits into separate clock-in and
     * clock-out columns (added 2026-08-23). Same meaning as the single-cell columnStretches
     * representation (formatStretchRange etc.) — display form only differs.
     */
    columnClockIn: "In",
    columnClockOut: "Out",
    columnWorked: "Worked",
    /** Shortfall (required vs. actual) appended to the insufficient_break warning text. */
    breakShortfallSuffix: (required: string, actual: string) => `(required ${required}, actual ${actual})`,
    columnBreak: "Break",
    /** Label marking an automatic break deduction (added 2026-08-23, see docs/design/breaks.md "UI treatment"). */
    autoBreakLabel: "Auto",
    columnLateNight: "Late-night",
    /** Overtime column, shown only under the fixed working-hours system (added 2026-08-23). */
    columnOvertime: "Overtime",
    columnWarning: "Warning",
    columnActions: "Actions",
    correctionAction: "Correct",
    empty: "No punch data for this month",

    /** Open-ended work stretch (clockOutAt: null). */
    stretchOpenEnded: "—",
    /** Prefix for a clock-out that spills over into the next calendar day. */
    stretchNextDayPrefix: "Next day ",
    /**
     * Prefix shown at the start of the "receiving" day's shift column for work that
     * spans a day boundary (added 2026-08-23). Symmetric to the "next day" label
     * (shown on the start-day side): use stretchPrevDayLabel for the previous day,
     * or stretchFromDateLabel (M/D) for two or more days earlier.
     */
    stretchPrevDayLabel: "(from the previous day)",
    stretchFromDateLabel: (monthDay: string) => `(from ${monthDay})`,
    /** Label for overtime within statutory limits (extraWithinStatutoryMinutes). */
    overtimeExtraLabel: "Within statutory limits",

    /** Explicitly shows which working-hours system is displayed (added 2026-08-23, see ui-direction.md "Monthly" section). */
    workSystemLabel: "Working-hours system shown",
    workSystemValue: {
      flex: "Flextime system",
      fixed: "Fixed working hours",
      monthly_variable: "Monthly variable working hours",
    } satisfies Record<"flex" | "fixed" | "monthly_variable", string>,

    flexBalanceLabel: "Flex balance",
    flexBalanceUnit: "min",
    /** Replaces the "flex balance bar" under the fixed working-hours system (added 2026-08-23). Position of overtime against the Article 36 agreement's 45-hour monthly cap. */
    overtimeBarLabel: "Overtime (against the Article 36 agreement's 45-hour monthly cap)",
    overtimeBarUnit: "min",
    /** Remaining margin below the cap. */
    overtimeBarRemainingLabel: "Remaining",
    /** Shown when the cap is exceeded (so it's clear from the text, not just the capped bar). */
    overtimeBarOverLabel: "Cap exceeded",

    /**
     * Replaces the "flex balance bar" under monthly_variable (added 2026-08-24, v0.7 phase 3).
     * Position of worked time against the period's statutory frame (figures.variablePeriod.statutoryFrameMinutes).
     */
    variablePeriodBarLabel: "Worked time against the period's statutory frame",
    variablePeriodBarUnit: "min",
    variablePeriodBarRemainingLabel: "Remaining",
    variablePeriodBarOverLabel: "Frame exceeded",
    variablePeriodScheduledLabel: "Total scheduled",
    variablePeriodRangeLabel: (start: string, end: string) => `Variable period ${start} – ${end}`,
    /** Shown when attributedToThisMonth is false (decision 3: period-level overtime is not yet counted in this month). */
    variablePeriodNotAttributedNote:
      "Period-level overtime is counted in the month the period ends. It is not yet included in this month.",
    /** Closed months (figures.source === "snapshot") always return variablePeriod as null. */
    variablePeriodUnavailableNote:
      "This month is already closed, so the variable-period breakdown is not shown (overtime is included in the category totals).",

    /** Daily "scheduled" column under monthly_variable (added 2026-08-24, DailyBreakdown.scheduledMinutes). */
    columnScheduled: "Scheduled",

    /** Delta minutes appended to shift-variance warnings (same shape as insufficient_break's breakShortfallSuffix). */
    shiftDeltaSuffix: (delta: string) => `(delta ${delta})`,
    shiftActualOnlySuffix: (actual: string) => `(worked ${actual})`,

    totalsLabel: "Totals by category",
    /** Heading for the monthly allowance totals (see docs/design/allowances.md "UI", added 2026-08-23). */
    allowanceTotalsLabel: "Allowance-eligible time",
    /** Prefixed to allowance rows in the post-close amendment diff table so they read as allowances. */
    allowanceDiffPrefix: "Allowance: ",

    /** Monthly total breakdown for fixed-hour work system (within-schedule hours, in-statute overtime). Shown below the category chips, in the same chip style as the allowance totals block (GET /attendance/monthly figures.fixedBreakdown, added 2026-08-23). */
    fixedBreakdownLabel: "Within-schedule / in-statute overtime (monthly total)",
    fixedBreakdownWithinScheduledLabel: "Within-schedule hours",
    fixedBreakdownExtraLabel: "In-statute overtime",

    /** Viewing another member's attendance (added 2026-08-23, Tier 1). */
    memberSwitcherLabel: "Viewing",
    memberSwitcherSelfOption: (name: string) => `${name} (you)`,
    memberSwitcherOthersGroup: "Members",
    memberSwitcherNoDepartment: "No department",
    memberSwitcherUnknownDepartment: "Unknown department",
    viewingOthersLabel: (name: string) => `${name}'s monthly attendance (view only)`,
  },

  totalsCategoryLabel: {
    statutory: "Prescribed hours",
    overtime: "Overtime",
    overtime60h: "Overtime (over 60h)",
    lateNight: "Late-night",
    statutoryHoliday: "Statutory holiday",
  } satisfies Record<"statutory" | "overtime" | "overtime60h" | "lateNight" | "statutoryHoliday", string>,

  /** Shift day-type labels (shared by shift_patterns.dayType and shift_days.dayType, added 2026-08-24). */
  shiftDayTypeLabel: {
    work: "Work",
    legal_holiday: "Statutory holiday",
    non_working: "Non-working",
  } satisfies Record<"work" | "legal_holiday" | "non_working", string>,

  warningLabel: {
    missing_clock_out: "No clock-out was recorded, so this work stretch was excluded from the totals",
    duplicate_clock_in: "A duplicate clock-in while already working was invalidated",
    clock_out_without_in: "A clock-out recorded without a matching clock-in was invalidated",
    break_outside_work: "A break punch recorded outside working hours was invalidated",
    duplicate_break_start: "A duplicate break-start while already on break was invalidated",
    unmatched_break_end: "A break-end with no matching break-start was invalidated",
    clock_out_during_break: "A clock-out occurred during a break; it was treated as ending the break and then clocking out",
    mixed_work_system:
      "The working-hours system changed partway through this period. The whole month is totaled under the system in effect at the start of the period. Contact your administrator if you need this period split for review",
    insufficient_break: "The break taken during this shift is shorter than legally required. Please check for missing break punches",
    /** Shift-vs-actual variance (see docs/design/shift-work.md "Reconciling planned vs. actual"), added 2026-08-24. Delta minutes are appended via monthly.shiftDeltaSuffix etc. */
    missing_shift: "There is worked time on a day with no shift registered. Please check the shift schedule",
    shift_late_arrival: "Clocked in later than the shift's start time",
    shift_early_leave: "Clocked out earlier than the shift's end time",
    shift_unplanned_work: "There is worked time on a day the shift marked as off",
    shift_absence: "There is no worked time on a day the shift marked as work",
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
    | "shift_absence",
    string
  >,

  corrections: {
    title: "Punch correction requests",
    tagline: "Request additions, corrections, or cancellations of punches. Approved requests are reflected in the attendance record.",

    formTitle: " correction request",
    formHint: "Once approved, this request updates the punches and is reflected in the monthly totals.",
    close: "Close",
    cancel: "Cancel",
    submit: "Submit",
    submitting: "Submitting…",
    submitted: "Request submitted. It will be reflected once approved.",

    currentPunchesTitle: "Punches on this day",
    currentPunchesEmpty: "No punches yet on this day",

    /** aria-label for the radiogroup that chooses add/correct/cancel (or break waiver) mode. */
    modeGroupAriaLabel: "Operation type",
    modeAdd: "Add a punch",
    modeCorrect: "Correct an existing punch",
    modeCancel: "Cancel an existing punch",

    kindLabel: "Type",
    timeLabel: "Time",
    targetLabel: "Target punch",
    targetPlaceholder: "Select a target",
    targetEmpty: "No punches available to target",
    reasonLabel: "Reason",
    reasonPlaceholder: "Enter the reason this correction is needed",

    typeAdd: "Add",
    typeCorrect: "Correct",
    typeCancel: "Cancel",
    targetUnavailable: "Could not load the target punch (it may already have been applied)",

    statusLabel: {
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
    } satisfies Record<"pending" | "approved" | "rejected" | "withdrawn", string>,

    columnTarget: "Target date/time",
    columnContent: "Details",
    columnReason: "Reason",
    columnDecision: "Decision",

    approve: "Approve",
    reject: "Reject",
    withdraw: "Withdraw",

    decidedByLabel: "Decided by",
    decidedAtLabel: "Decided at",
    decisionNoteLabel: "Decision note",
    decisionNotePlaceholder: "Note (optional)",
    decidedBySelf: "You",

    confirmApproveTitle: "Approve this request?",
    confirmApproveMessage:
      "Approving will update the attendance record and change the monthly totals. This action is recorded in the audit log.",
    confirmApproveSelfNote: "This will be recorded as a self-approval.",
    confirmRejectTitle: "Reject this request?",
    confirmRejectMessage: "Rejecting records the request as rejected; it will not be reflected in the punches.",
    confirmWithdrawTitle: "Withdraw this request?",
    confirmWithdrawMessage: "Withdrawing clears the pending status. You can submit it again if needed.",
    confirmProceed: "Proceed",

    empty: "No requests yet",

    queueSectionTitle: "Correction requests awaiting approval",
    queueSectionTagline: "Requests awaiting approval within your approval scope.",
    queueEmpty: "No requests awaiting approval",

    errors: {
      already_superseded: "This punch has already been corrected by another request",
      not_pending: "This request has already been processed",
      not_found: "The request could not be found",
      invalid_reason: "Please enter a reason between 1 and 500 characters",
      invalid_target_event: "The target punch could not be found. Please choose again",
      invalid_proposed_kind: "Please check the punch type",
      invalid_proposed_occurred_at: "Please check the time format",
      proposed_occurred_at_in_future: "You can't specify a time in the future",
      invalid_request_shape: "Please check the entered content",
      invalid_body: "Please check the entered content",
      invalid_status: "An unsupported status was specified",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Requests to waive an automatic break deduction (added 2026-08-23). The UI side of the
   * design in docs/design/breaks.md "Chosen design". A separate table and flow from
   * correction_requests (punch correction requests), but the approval screen shares the
   * same location (/corrections) and conventions (ConfirmDialog, k-modal).
   */
  autoBreakWaiver: {
    /** New mode tab within CorrectionForm (the monthly view's correction modal). */
    modeWaiver: "Couldn't take a break",
    /** Note shown at the top of the modal on days with an automatic deduction. */
    deductedNotice: (amount: string) => `An automatic break deduction of ${amount} has been applied to this day.`,
    formHint: "Use this request if you were actually unable to take a break. Once approved, the automatic deduction for this day is removed, and a warning is shown if the break falls short of the requirement.",
    reasonLabel: "Reason",
    reasonPlaceholder: "Enter why you were unable to take a break",
    submit: "Submit",
    submitting: "Submitting…",

    typeLabel: "Break auto-deduction waiver",
    columnDate: "Target date",
    columnReason: "Reason",
    columnDecision: "Decision",

    ownSectionTitle: "Break auto-deduction waiver requests",
    ownSectionTagline: "A list of break auto-deduction waiver requests you've submitted.",
    queueSectionTitle: "Waiver requests awaiting approval",
    queueSectionTagline: "Waiver requests awaiting approval within your approval authority.",
    empty: "No requests yet",
    queueEmpty: "No requests are awaiting approval",

    statusLabel: {
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
    } satisfies Record<"pending" | "approved" | "rejected" | "withdrawn", string>,

    approve: "Approve",
    reject: "Reject",
    withdraw: "Withdraw",
    decisionNoteLabel: "Decision note",
    decisionNotePlaceholder: "Note (optional)",
    decidedBySelf: "You",

    confirmApproveTitle: "Approve this request?",
    confirmApproveMessage:
      "Approving removes the automatic deduction for this day and changes the monthly totals. A warning will be shown if the break falls short of the requirement. This action is recorded in the audit log.",
    confirmApproveSelfNote: "This will be recorded as a self-approval.",
    confirmRejectTitle: "Reject this request?",
    confirmRejectMessage: "Rejecting records the request as rejected; the automatic deduction remains in place.",
    confirmWithdrawTitle: "Withdraw this request?",
    confirmWithdrawMessage: "Withdrawing clears the pending status. You can submit it again if needed.",

    errors: {
      invalid_waive_date: "Please check the target date",
      invalid_reason: "Please enter a reason between 1 and 500 characters",
      invalid_body: "Please check the entered content",
      invalid_status: "An unsupported status was specified",
      not_pending: "This request has already been processed",
      already_approved: "The waiver for this day has already been approved",
      not_found: "The request could not be found",
      forbidden: "You don't have permission to perform this action",
      month_closed_requires_unlock: "This month is already closed. Approving requires permission to reopen it",
      default: "Something went wrong. Please try again",
    },
  },

  notifications: {
    bellLabel: "Notifications",
    title: "Notifications",
    empty: "No notifications",
    unread: "Unread",
    markRead: "Mark as read",
    markReadFailed: "Could not mark as read. Please try again",
    subjectDateLabel: "Target date",
    receivedAtLabel: "Received",
    openCorrection: "Open the correction request for this day",
    /** Link for leave_* types (added 2026-08-22, notifications list screen). */
    openLeave: "Open the annual paid leave screen",
    openLeaveSettings: "Open the paid leave settings screen",
    /** Link for overtime_* types (added 2026-08-22, notifications list screen). */
    openMonthly: "Open the monthly screen",
    loadFailed: "Failed to load notifications. Please try again",
    /** Link at the bottom of the bell dropdown (added 2026-08-22). */
    viewAll: "View all notifications →",
  },

  /** Notifications list screen (/notifications, added 2026-08-22). Lets you browse past notifications beyond what the bell dropdown shows. */
  notificationsPage: {
    title: "Notifications",
    tagline: "Browse past notifications.",
    filterStatusGroupLabel: "Filter by read status",
    filterStatusAll: "All",
    filterStatusUnread: "Unread only",
    filterTypeGroupLabel: "Filter by type",
    filterTypeAll: "All types",
    filterTypeMissingClockOut: "Missed punch",
    filterTypeOvertime: "Article 36 agreement",
    filterTypeLeave: "Leave",
    markAllRead: "Mark all shown as read",
    markAllReadPending: "Processing…",
    empty: "No notifications",
    emptyFiltered: "No notifications match this filter",
    /** The API returns at most 100 items (a fixed API constraint, not something the API will change). */
    truncatedNotice: "Showing only the most recent 100 notifications. Older notifications are not shown.",
  },

  settingsNotifications: {
    title: "Notification settings (company-wide)",
    tagline: "Configure tenant-wide notification channels (webhook, email).",
    noPermission: "You don't have permission to change this setting",
    /** docs/requirements.md §7: make the distinction from personal settings (/settings/notifications/me) explicit on screen. */
    distinctionBanner:
      "This page configures company-wide channels (SMTP server, shared webhook, etc.). To choose how you personally receive notifications (email/personal webhook on or off), use \"Personal notification settings\".",
    linkToPersonalSettings: "Open personal notification settings →",

    webhookSectionTitle: "Webhook",
    webhookEnabledLabel: "Enable webhook notifications",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "Configured",
    webhookUrlNotConfigured: "Not configured",
    keepIfBlankHint: "Leave blank to keep it unchanged",

    smtpSectionTitle: "Email (SMTP)",
    smtpEnabledLabel: "Enable email notifications",
    smtpHostLabel: "SMTP host",
    smtpPortLabel: "Port",
    smtpUserLabel: "Username",
    smtpFromLabel: "From address",
    smtpPasswordLabel: "Password",
    smtpPasswordConfigured: "Configured",
    smtpPasswordNotConfigured: "Not configured",

    save: "Save",
    saving: "Saving…",
    saveNote: "This setting applies to the entire tenant. Changes are recorded in the audit log.",
    saveSuccess: "Settings saved.",

    testSend: "Send test",
    testSendConfirmTitle: "Send a test notification?",
    testSendConfirmMessage: "This will actually send one message using the saved settings.",
    testSendConfirmLabel: "Send",
    testSendResultTitle: "Test send result",
    testSendOk: "Success",
    testSendFailed: "Failed",
    testSendChannelLabel: {
      webhook: "Webhook",
      smtp: "Email (SMTP)",
    } as Record<string, string>,

    loading: "Loading…",
    loadFailed: "Failed to load settings. Please try again",

    errors: {
      invalid_webhook_enabled: "Please check the entered content",
      invalid_smtp_enabled: "Please check the entered content",
      invalid_webhook_url: "Please check the webhook URL format (enter a valid http/https URL)",
      invalid_smtp_host: "Please check the SMTP host",
      invalid_smtp_user: "Please check the username",
      invalid_smtp_from: "Please check the from address",
      invalid_smtp_password: "Please check the password",
      invalid_smtp_port: "Please enter a port number between 1 and 65535",
      invalid_smtp_config: "To enable email notifications, please fill in the host, port, and from address",
      invalid_body: "Please check the entered content",
      not_configured: "No enabled channel is configured",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Personal notification settings (/settings/notifications/me, added 2026-08-22).
   * See docs/requirements.md §7 "Two-tier notification settings" — distinct from the
   * tenant-wide settings (settingsNotifications, above). Kept clearly worded as
   * different, per the request "make the distinction from the existing
   * /settings/notifications screen explicit".
   */
  settingsPersonalNotifications: {
    title: "Personal notification settings",
    tagline: "Choose how you personally receive notifications. Anyone can change their own settings.",

    distinctionBanner:
      "This page sets how you personally receive notifications. To configure company-wide channels (SMTP server, shared webhook, etc.), open \"Notification settings (company-wide)\".",
    distinctionBannerNoAccess: "This page sets how you personally receive notifications. Ask your administrator about company-wide channel settings.",
    linkToTenantSettings: "Open notification settings (company-wide) →",

    categoriesSectionTitle: "Delivery preferences by notification type",
    categoryColumnInapp: "In-app",
    categoryColumnEmail: "Email",
    categoryColumnWebhook: "Personal webhook",
    inappAlwaysOnHint: "In-app notifications are always on (cannot be changed).",
    categories: {
      missing_clock_out: "Missed punch",
      overtime_alert: "Article 36 agreement / overtime alert",
      leave_alert: "Leave expiring soon / mandatory 5-day minimum alert",
      /** Added 2026-08-23. Approval/rejection notifications for correction-type requests (e.g. break auto-deduction waivers). */
      correction_alert: "Request approved/rejected (e.g. break auto-deduction waiver)",
      /** Added 2026-08-23 Tier 0 part 4. For people with approval permission — a request has arrived from a member within their scope. */
      approval_request: "Approval requests (when a member in your scope submits a request — for approvers)",
      /** 2026-08-24 追加。前日の自分の勤務がシフトとずれたときの本人向け通知。 */
      shift_variance: "Shift variance (when your work differs from your shift — late arrival, early leave, possible absence, and so on)",
    } as Record<string, string>,

    emailSectionTitle: "Notification email address",
    emailAddressLabel: "Email address",
    emailAddressPlaceholder: "Leave blank to use your account's email address",
    emailAddressEffectiveHint: (email: string) => `Currently sending to: ${email}`,

    webhookSectionTitle: "Personal webhook",
    webhookUrlLabel: "Webhook URL",
    webhookUrlPlaceholder: "https://hooks.example.com/...",
    webhookUrlConfigured: "Configured",
    webhookUrlNotConfigured: "Not configured",
    keepIfBlankHint: "Leave blank to keep it unchanged",

    save: "Save",
    saving: "Saving…",
    saveSuccess: "Settings saved.",

    testSend: "Send test",
    testSendConfirmTitle: "Send a test notification?",
    testSendConfirmMessage: "This will actually send one message to your saved personal webhook.",
    testSendConfirmLabel: "Send",
    testSendResultTitle: "Test send result",
    testSendOk: "Success",
    testSendFailed: "Failed",

    loading: "Loading…",
    loadFailed: "Failed to load settings. Please try again",

    errors: {
      invalid_body: "Please check the entered content",
      invalid_categories: "Please check the selected notification types",
      invalid_email_address: "Please check the email address format",
      invalid_webhook_url: "Please check the webhook URL format (enter a valid http/https URL)",
      encryption_unavailable: "This item can't be saved right now. Please contact your administrator",
      not_configured: "No personal webhook is configured",
      decryption_failed: "The saved value could not be read. Please set it again",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Slack slash-command punch integration settings (/settings/slack, added 2026-08-22, company-wide).
   * docs/external-api/slack.md is the source of truth for behavior.
   */
  settingsSlack: {
    title: "Slack integration",
    tagline: "Configure punching in from Slack via the slash command (/punch).",
    noPermission: "You don't have permission to change this setting",
    setupGuideHint: "For setup steps (creating a Slack app, where to find the signing secret), see docs/external-api/slack.md.",

    teamIdLabel: "Slack workspace ID (Team ID)",
    teamIdPlaceholder: "T0123456",
    teamIdHint: "Found on Slack's \"Basic Information\" page, among others. Only one workspace can be configured per tenant.",

    signingSecretLabel: "Signing secret",
    signingSecretConfigured: "Configured",
    signingSecretNotConfigured: "Not configured",
    keepIfBlankHint: "Leave blank to keep it unchanged",

    enabledLabel: "Enable Slack punching",
    enabledHint: "Both the workspace ID and signing secret must be configured to enable this.",

    save: "Save",
    saving: "Saving…",
    saveSuccess: "Settings saved.",
    saveNote: "This setting applies to the entire tenant. Changes are recorded in the audit log.",

    loading: "Loading…",
    loadFailed: "Failed to load settings. Please try again",

    linkNavHint: "Employees can link their own Slack account from \"",
    linkNavLinkLabel: "Enter Slack linking token",
    linkNavHintSuffix: "\" (no permission required).",

    errors: {
      invalid_enabled: "Please check the entered content",
      invalid_team_id: "Please check the workspace ID",
      invalid_signing_secret: "Please check the signing secret",
      invalid_slack_config: "To enable this, please enter both the workspace ID and signing secret",
      invalid_body: "Please check the entered content",
      encryption_unavailable: "This item can't be saved right now. Please contact your administrator",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Slack linking token entry (/settings/slack-link, added 2026-08-22, no permission required, all employees).
   * Enter the one-time token (valid for 15 minutes) issued by running `/punch link` in Slack.
   */
  settingsSlackLink: {
    title: "Enter Slack linking token",
    tagline: "Enter the token shown after running `/punch link` in Slack to link your Slack account.",
    howToTitle: "Steps",
    howTo1: "Run `/punch link` in Slack",
    howTo2: "Copy the displayed token (valid for 15 minutes)",
    howTo3: "Paste it below and click \"Link\"",

    tokenLabel: "Token",
    tokenPlaceholder: "kzsl_...",
    submit: "Link",
    submitting: "Linking…",

    successTitle: "Linked",
    successMessage: (slackUserId: string) => `Linked to Slack account (${slackUserId}). You can now use \`/punch in\` and similar commands.`,

    errors: {
      invalid_token: "Please enter a token",
      invalid_body: "Please check the entered content",
      invalid_or_expired_token: "The token is invalid or has expired (15 minutes). Please run `/punch link` in Slack again",
      default: "Something went wrong. Please try again",
    },
  },

  /** Settings sub-navigation (moves between /settings/* pages; shows only accessible items). */
  settingsNav: {
    label: "Settings menu",
    /** Improvement from self-review: plain "Settings" made this look like just another peer tab, so
     * the wording now makes clear it's a "back to the list" action (kept plain for non-engineers). */
    hubLink: "All settings",
    myNotifications: "Personal notification settings",
    notifications: "Notification settings (company-wide)",
    departments: "Departments",
    members: "Members",
    presets: "Permission presets",
    tenantProfile: "Tenant profile",
    leave: "Annual paid leave",
    help: "Company policy",
    privacy: "Personal data",
    attendance: "Attendance rules",
    allowances: "Allowance-eligible time",
    shiftPatterns: "Shift patterns",
    apiKeys: "API keys",
    slack: "Slack integration",
    auditLogs: "Audit log",
  },

  settingsHub: {
    title: "Settings",
    tagline: "Manage the tenant's settings, organization, and permissions. Only accessible items are shown.",
    empty: "There are no settings available to you. Please contact your administrator.",
    /** Heading that clearly separates personal settings (everyone) from company settings (admins) as card groups. */
    personalGroupTitle: "Your settings",
    tenantGroupTitle: "Company settings",
    myNotificationsTitle: "Personal notification settings",
    myNotificationsDesc: "Choose in-app, email, and personal webhook delivery for each notification type.",
    notificationsTitle: "Notification settings (company-wide)",
    notificationsDesc: "Configure the webhook and email (SMTP) notification channels.",
    departmentsTitle: "Departments",
    departmentsDesc: "Create, rename, move, and delete departments in the department tree.",
    membersTitle: "Members",
    membersDesc: "Change members' department, assign permission presets, and review effective permissions.",
    presetsTitle: "Permission presets",
    presetsDesc: "Create and edit presets combining permission toggles and scopes.",
    attendanceTitle: "Attendance rules",
    attendanceDesc: "Change the day boundary, statutory holiday, break rules, GPS, and flextime settings by adding a new version.",
    allowancesTitle: "Allowance-eligible time",
    allowancesDesc: "Define which worked time counts toward company allowances, based on specific dates, weekdays, and time bands.",
    shiftPatternsTitle: "Shift patterns",
    shiftPatternsDesc: "Define shift patterns (early, late, off, etc.) to assign per day when building shift schedules.",
    tenantProfileTitle: "Tenant profile",
    tenantProfileDesc: "Review attributes that affect the totals — company size, special-provision workplace status, special clause — and upcoming legal changes.",
    leaveTitle: "Annual paid leave",
    leaveDesc: "Configure the tenant-wide grant method, hourly leave, and stocked leave settings.",
    helpTitle: "Company policy",
    helpDesc: "Set your company's own rules shown in help, and a link to your work rules.",
    privacyTitle: "Personal data",
    privacyDesc: "Review draft employee privacy notices and internal usage terms generated from your current settings.",
    apiKeysTitle: "API keys",
    apiKeysDesc: "Issue and revoke API keys for punching in from external clients such as IC card readers, Slack bots, and MCP servers.",
    slackTitle: "Slack integration",
    slackDesc: "Configure punching in from Slack via the slash command (/punch).",
    slackLinkTitle: "Enter Slack linking token",
    slackLinkDesc: "Enter the token issued by running `/punch link` in Slack to link your Slack account.",
    auditLogsTitle: "Audit log",
    auditLogsDesc: "View the immutable record of operations such as punches, corrections, approvals, closing, and permission changes (read-only).",
  },

  /** Monthly close & CSV export (/monthly screen, v0.3). Requirement §6 (closing & data export) & §10 (contextual help). */
  closing: {
    closedBadge: "Closed",
    amendedBadge: "Amended after closing",
    /** Shown small, near the "closed" badge, when figures.source === "snapshot" (added 2026-08-23). */
    snapshotBadge: "Finalized",

    closeAction: "Close this month",
    reopenAction: "Reopen",

    confirmCloseTitle: "Close this month?",
    confirmCloseMessage:
      "This finalizes attendance for the month. Afterward, punches and corrections require a request and approval. This action is recorded in the audit log.",
    confirmCloseLabel: "Close",

    confirmReopenTitle: "Reopen this month?",
    confirmReopenMessage: "Reopening makes this month freely editable again.",
    confirmReopenExtraNote: "Reopening a closed month is a high-impact action. It is recorded in the audit log.",
    confirmReopenLabel: "Reopen",

    noteLabel: "Note (optional)",
    notePlaceholder: "Reason for closing/reopening, etc. (optional)",

    diffTitle: "Difference from the original values",
    diffColumnCategory: "Category",
    diffColumnOriginal: "Original",
    diffColumnCurrent: "Current",
    diffColumnDelta: "Difference",
    diffFlexFrame: "Flex total budget",
    diffFlexActual: "Flex actual",
    diffFlexDiff: "Flex balance",

    historyTitle: "Closing history",
    historyEmpty: "No closing/reopening history yet",
    historyActorSelf: "You",
    historyEventLabel: {
      close: "Closed",
      reopen: "Reopened",
      amend: "Amended",
    } satisfies Record<"close" | "reopen" | "amend", string>,
    historyCorrectionLink: "View the originating correction request",

    csvDownload: "Download CSV",
    csvDownloading: "Preparing…",
    csvCompareOriginalLabel: "Include difference from original values",
    csvDownloadFailed: "The CSV download failed. Please try again",

    errors: {
      already_closed: "This month is already closed",
      not_closed: "This month is not yet closed",
      invalid_period: "Please check the target month",
      invalid_note: "Note must be 500 characters or fewer",
      invalid_body: "Please check the entered content",
      default: "Something went wrong. Please try again",
    },
  },

  /** Tenant profile settings (/settings/tenant-profile, v0.3). Requirement §10 (attach help to law-derived display items). */
  settingsTenantProfile: {
    title: "Tenant profile",
    tagline: "Configure the tenant-wide attributes that underlie working-hours totals and Article 36 agreement alerts.",
    noPermission: "You don't have permission to change this setting",
    loadFailed: "Failed to load settings. Please try again",

    smeLabel: "Small or medium-sized enterprise",
    smeHint: "Used to determine items whose effective date depends on company size (premium pay for over 60 hours/month, Article 36 agreement caps).",

    specialProvisionLabel: "Special-provision workplace",
    specialProvisionHint:
      "Workplaces in commerce, film/theater, health services, or entertainment with fewer than 10 regular employees have a statutory weekly working-hours limit of 44 hours (Labor Standards Act Article 40).",

    specialClauseLabel: "Article 36 agreement's special clause is in effect",
    specialClauseHint:
      "Enables alerts related to the Article 36 agreement's special clause (under 100 hours/month, average of 80 hours/month over multiple months, 720 hours/year, and at most 6 months per year exceeding 45 hours/month).",

    save: "Save",
    saving: "Saving…",
    saveSuccess: "Settings saved.",

    confirmTitle: "Change this setting?",
    confirmMessage: "This setting directly affects the working-hours totals.",
    confirmExtraNote: "This change is recorded in the audit log.",
    confirmLabel: "Change",

    currentRulesTitle: "Key values currently in effect",
    currentRulesWeekly: "Statutory weekly working hours",
    currentRulesAgreementMonthly: "Article 36 agreement — monthly cap",
    currentRulesAgreementAnnual: "Article 36 agreement — annual cap",
    currentRulesHourlyLeave: "Hourly annual leave cap (days)",
    currentRulesHourlyLeaveUnit: "days/year",
    currentRulesSpecialClauseTitle: "Caps under the special clause (if in effect)",
    currentRulesSpecialMonthlyCap: "Single month",
    currentRulesSpecialMonthlyCapNote: "under",
    currentRulesSpecialMultiMonth: "Multi-month average",
    currentRulesSpecialAnnual: "Annual",
    currentRulesSpecialExceedCount: "Times per year exceeding 45 hours/month is allowed",
    currentRulesSpecialExceedCountUnit: "times/year",

    upcomingTitle: "Upcoming legal changes",
    upcomingEmpty: "There are currently no upcoming legal changes",
    upcomingEffectiveFrom: "Effective date",
    upcomingBasis: "Legal basis",
    upcomingChangesPrefix: "Changes: ",
    upcomingRuleLabel: {
      weeklyStatutoryMinutes: "Statutory weekly working hours",
      lateNight: "Late-night hours",
      overtime60h: "Over-60-hours/month category",
      agreement36: "Article 36 agreement cap",
      annualLeave: "Annual paid leave",
    } satisfies Record<"weeklyStatutoryMinutes" | "lateNight" | "overtime60h" | "agreement36" | "annualLeave", string>,

    errors: {
      invalid_is_small_or_medium_enterprise: "Please check the entered content",
      invalid_is_special_provision_workplace: "Please check the entered content",
      invalid_special_clause_enabled: "Please check the entered content",
      invalid_body: "Please check the entered content",
      tenant_not_found: "Tenant information could not be found",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Versioned attendance rules (/settings/attendance, added 2026-08-22).
   * See docs/design/v01-data-model.md principle 6 (effective-dated): edits only ever add a
   * new version. Existing versions are never changed (past calculation results never change).
   */
  settingsAttendance: {
    title: "Attendance rules",
    tagline: "Change the day boundary, statutory holiday, break rules, GPS, and flextime settings by adding a new version.",
    noPermission: "You don't have permission to change this setting",
    loadFailed: "Failed to load settings. Please try again",

    currentTitle: "Currently in effect",
    currentEffectiveFrom: "Effective since",
    dayBoundaryLabel: "Day boundary (start of day)",
    /**
     * Week start weekday (added 2026-08-23). Defines the week boundary used for the 40-hour
     * weekly threshold (weekly overtime under the fixed working-hours system). A distinct
     * concept from the statutory holiday's weekday setting (legalHolidayWeekday) — do not
     * conflate the two.
     */
    weekStartWeekdayLabel: "Week start weekday",
    weekStartWeekdayHint: "The week boundary used for the 40-hour weekly threshold. Sunday is the default start unless your work rules specify otherwise (1988 Directive No. 1).",
    /**
     * Variable period start day (added 2026-08-24, v0.7 phase 3, docs/design/shift-work.md decision 3).
     * Required on every POST even for tenants that don't use monthly_variable (matches the apps/api convention).
     */
    variablePeriodStartDayLabel: "Variable period start day",
    variablePeriodStartDayHint:
      "Enter a day from 1 to 28 (29–31 can't be chosen because not every month has them). Shift schedules (Shifts screen) are split into one-month periods starting on this day. Required even if you don't use the shift work system.",
    legalHolidayLabel: "Statutory holiday",
    legalHolidayWeekday: "By weekday",
    legalHolidayDates: "By calendar date",
    breakRuleLabel: "Break rules",
    breakRulePunch: "Punch-based",
    /** Automatic break deduction (added 2026-08-23, see docs/design/breaks.md "Chosen design"). */
    breakRuleModeAuto: "Automatic deduction",
    breakRuleModeBoth: "Combined",
    breakRuleRulesTitle: "Deduction rules",
    breakRuleOverSuffix: "hours worked, deduct",
    breakRuleDeductSuffix: " minutes",
    breakRuleAddRule: "Add a row",
    breakRuleRemoveRule: "Remove",
    breakRuleRuleOverLabel: "Working-hours threshold",
    breakRuleRuleDeductLabel: "Minutes to deduct",
    breakRuleMaxRulesHint: "You can set up to 3 rows.",
    gpsLabel: "GPS punching",
    gpsEnabledYes: "Enabled",
    gpsEnabledNo: "Disabled",
    gpsRetentionLabel: "GPS coordinate retention period",
    gpsRetentionSameAsAttendance: "Same as attendance data",
    gpsRetentionDaysUnit: " days",
    flexLabel: "Flextime settings",
    flexSettlementMonthly: "Monthly settlement",
    flexStandardDayMinutesLabel: "Standard working hours (per day, minutes)",
    noVersionYet: "No settings yet",

    weekdayLabel: {
      0: "Sunday",
      1: "Monday",
      2: "Tuesday",
      3: "Wednesday",
      4: "Thursday",
      5: "Friday",
      6: "Saturday",
    } satisfies Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>,

    formTitle: "Add a new version",
    effectiveFromLabel: "Effective date",
    effectiveFromHint: "This change only affects calculations from the specified date onward; past totals are unaffected.",
    dayBoundaryHint: "0:00 = starts at 00:00. Workplaces with late-night work may prefer, e.g., 05:00 (300 minutes) so shifts crossing midnight stay on one day.",
    legalHolidayKindLabel: "How to specify",
    legalHolidayWeekdayValueLabel: "Weekday to treat as a holiday",
    legalHolidayDatesValueLabel: "Dates to treat as holidays (comma-separated, YYYY-MM-DD)",
    legalHolidayDatesPlaceholder: "e.g. 2026-05-05,2026-05-06",
    gpsEnabledCheckbox: "Enable GPS punching",
    gpsWarning: "You must clearly disclose this to employees. Please review the privacy notice template.",
    gpsWarningLink: "View personal data settings →",
    gpsRetentionInputLabel: "Retention period (leave blank to match attendance data)",
    flexStandardDayMinutesHint: "On days annual paid leave is taken, this many minutes count toward the working-hours budget.",

    submit: "Add this version",
    submitting: "Adding…",
    submitSuccess: "New version added.",

    workPolicyFormTitle: "Add a new flextime settings version",
    workPolicyNoPermission: "You don't have permission to change flextime settings",

    historyTitle: "Version history",
    workPolicyHistoryTitle: "Flextime settings version history",
    historyEmpty: "No history yet",
    historyColumnEffectiveFrom: "Effective date",
    historyColumnSummary: "Details",

    errors: {
      invalid_body: "Please check the entered content",
      invalid_effective_from: "Please check the effective date",
      invalid_day_boundary_minutes: "Day boundary must be between 0 and 1439 (minutes)",
      invalid_week_start_weekday: "Please check the week start weekday",
      invalid_variable_period_start_day: "Please enter a variable period start day between 1 and 28",
      invalid_legal_holiday_rule: "Please check the statutory holiday setting",
      invalid_break_rule: "Please check the break rules",
      invalid_gps_enabled: "Please check the entered content",
      invalid_gps_retention_days: "GPS coordinate retention period must be a whole number of at least 1",
      invalid_settlement_period: "This version only supports \"Monthly settlement\" for the settlement period",
      invalid_standard_day_minutes: "Standard working hours must be between 1 and 1440 (minutes)",
      effective_from_in_past: "The effective date can only be today or later (past calculation results must not change)",
      version_already_exists: "A version already exists for that effective date. Please choose a different date",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Allowance-eligible time settings (/settings/allowances, docs/design/allowances.md, added
   * 2026-08-23). No amounts are calculated — KIZAMI only computes how many minutes of work
   * qualify for this allowance. Same effective-dated version-management UI as
   * settingsAttendance (modeled on SettingsAttendanceView), but any number of definitions can
   * exist in parallel per tenant, so each definition keeps its own current value, new-version
   * form, and history.
   */
  settingsAllowances: {
    title: "Allowance-eligible time",
    tagline:
      "Compute worked time that matches conditions on specific dates, weekdays, and time bands as time eligible for company allowances. No allowance rate or payout amount is calculated.",
    noPermission: "You don't have permission to change this setting",
    loadFailed: "Failed to load settings. Please try again",

    listTitle: "Allowance definitions",
    empty: "No allowance definitions yet",
    currentConditionsLabel: "Current conditions",
    currentEffectiveFrom: "Effective since",
    noVersionYet: "No version is currently in effect yet (only versions with a future effective date exist)",

    nameLabel: "Allowance name",
    namePlaceholder: "e.g. Early-morning allowance",
    effectiveFromLabel: "Effective date",
    effectiveFromHint: "This change only affects calculations from the specified date onward; past totals will not change.",

    conditionsSectionHint: "Specify at least one condition. All specified conditions are combined with AND (only overlaps are eligible).",
    datesFieldLabel: "Specific dates",
    datesFieldHint:
      "Only the specified dates are eligible. Checking \"Every year\" ignores the year and matches by month/day only (e.g. a year-end and New Year allowance). The year shown in the date field has no meaning when \"Every year\" is checked.",
    addDateRow: "Add a date",
    removeDateRow: "Remove",
    dateYearlyCheckbox: "Every year (ignore the year, match by month/day only)",
    dateRowAriaLabel: "Target date",
    weekdaysFieldLabel: "Weekdays",
    weekdaysFieldHint: "Only the specified weekdays are eligible.",
    timeBandFieldLabel: "Time band",
    timeBandEnabledCheckbox: "Specify a time band",
    timeBandStartLabel: "Start time",
    timeBandEndLabel: "End time",
    timeBandHint: "If the end time is at or before the start time, the band is treated as spanning into the next day (e.g. 22:00–5:00 the next day).",

    createDefinitionTitle: "Create a new allowance definition",
    createDefinitionButton: "Create with these settings",
    creating: "Creating…",
    createSuccess: "Allowance definition created.",

    addVersionTitle: "Add a new version",
    addVersionSubmit: "Add a version with these settings",
    addingVersion: "Adding…",
    submitSuccess: "New version added.",

    historyTitle: "Version history",
    historyEmpty: "No history yet",
    historyColumnEffectiveFrom: "Effective date",
    historyColumnName: "Allowance name",
    historyColumnConditions: "Conditions",

    /** Format tokens used by summarizeAllowanceConditions (lib/allowances.ts). */
    summaryYearlyPrefix: "Annually ",
    summaryDateRangeSeparator: "–",
    summaryListSeparator: ", ",
    summaryPartsSeparator: " ",
    summaryNextDayPrefix: "next day ",

    errors: {
      invalid_body: "Please check the entered content",
      invalid_effective_from: "Please check the effective date",
      invalid_name: "Please enter an allowance name",
      invalid_conditions: "Please check the condition inputs (specific dates need a date, and a time band needs distinct start and end times)",
      conditions_required: "Please specify at least one condition (specific dates, weekdays, or a time band)",
      effective_from_in_past: "The effective date can only be today or later (past calculation results must not change)",
      version_already_exists: "A version already exists for that effective date. Please choose a different date",
      not_found: "The allowance definition could not be found",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Shift pattern management (/settings/shift-patterns, v0.7 phase 3, added 2026-08-24).
   * The pattern side of docs/design/shift-work.md decision 2 ("pattern assignment + per-cell edits").
   * Matches apps/api/src/routes/settings/shift-patterns.ts (GET/POST/:id/archive only — no edit API).
   */
  shiftPatterns: {
    title: "Shift patterns",
    tagline: "Define patterns such as early shift, late shift, and off day. You assign these to days when building a shift schedule.",
    noPermission: "You don't have permission to use this screen",
    loadFailed: "Could not load the pattern list. Please try again",
    empty: "No patterns yet. Create one from \"Add pattern\".",

    addNew: "Add pattern",
    columnName: "Name",
    columnDayType: "Type",
    columnTime: "Time",
    columnActions: "Actions",
    archive: "Archive",
    archivedBadge: "Archived",
    showArchived: "Show archived",

    confirmArchiveTitle: "Archive this pattern?",
    confirmArchiveMessage: "Archiving removes it from the assignment options for new shift schedules. Shifts already assigned this pattern are unaffected.",
    confirmArchiveLabel: "Archive",

    formTitle: "Add a new pattern",
    nameLabel: "Name",
    namePlaceholder: "e.g. Early shift",
    dayTypeLabel: "Type",
    startLabel: "Start time",
    endLabel: "End time",
    endHint: "If you set the end time earlier than the start time, it's treated as work spanning midnight (a night shift).",
    breakLabel: "Break (minutes)",
    submit: "Create with these details",
    submitting: "Creating…",
    submitSuccess: "Pattern created.",
    cancel: "Cancel",

    errors: {
      invalid_body: "Please check your input",
      invalid_name: "Please enter a name",
      invalid_day_type: "Please check the type",
      invalid_minutes: "Please check the start and end times",
      invalid_break_minutes: "Break (minutes) must be an integer of 0 or more",
      not_found: "The pattern could not be found",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Shift schedule creation and publishing (/shifts, for shift.manage holders, v0.7 phase 3,
   * added 2026-08-24). Matches apps/api/src/routes/shifts.ts. period_start_mismatch carries a
   * number (the correct start day), so it's kept as periodStartMismatchMessage rather than
   * inside errors (which is string-only).
   */
  shifts: {
    title: "Shift schedules",
    tagline: "Build a shift schedule per member for each variable period and publish it. Changes after publishing are kept in history.",
    noPermission: "You don't have permission to use this screen",
    loadFailed: "Could not load the shift schedule. Please try again",

    memberLabel: "Member",
    prevPeriod: "← Previous period",
    nextPeriod: "Next period →",
    periodRangeLabel: (start: string, end: string) => `${start} – ${end}`,

    noPlanYet: "There is no shift schedule for this period yet.",
    createPlan: "Create a shift schedule for this period",
    creatingPlan: "Creating…",

    publishedBadge: "Published",
    unpublishedBadge: "Not published",
    publishAction: "Publish",
    publishing: "Publishing…",
    confirmPublishTitle: "Publish this shift schedule?",
    confirmPublishMessage:
      "Changes after publishing are recorded as history and cannot be deleted. Specifying each day's and each week's working hours in advance is a legal requirement of the monthly variable working-hours system.",
    confirmPublishLabel: "Publish",

    historyToggleOpen: "View change history",
    historyToggleClose: "Hide change history",
    historyEmpty: "No change history yet",
    historyColumnDate: "Date",
    historyColumnDayType: "Type",
    historyColumnTime: "Time",
    historyColumnCreatedBy: "Changed by",
    historyColumnCreatedAt: "Date/time",

    /** Weekly grid (rows = weeks, columns = weekdays; docs/design/shift-work.md decision 2). */
    cellEmpty: "Not set",
    cellDialogTitle: (date: string) => `Shift for ${date}`,
    cellDialogPatternLabel: "Choose from a pattern",
    cellDialogPatternNone: "Set individually without a pattern",
    cellDialogDayTypeLabel: "Type",
    cellDialogStartLabel: "Start time",
    cellDialogEndLabel: "End time",
    cellDialogBreakLabel: "Break (minutes)",
    cellDialogSave: "Save",
    cellDialogSaving: "Saving…",
    cellDialogCancel: "Cancel",

    /** Bulk assign (pick a pattern per weekday and apply it across the whole period — decision 2's "key to reducing input cost"). */
    bulkAssignTitle: "Bulk assign",
    bulkAssignHint: "Choose a pattern for each weekday and apply it across this whole period at once.",
    bulkAssignNoneOption: "No change",
    bulkAssignApply: "Apply these settings",
    bulkAssignApplying: "Applying…",
    bulkAssignSuccess: "Applied.",

    /** Pre-publish totals (requirement: shortages must be visible before publishing). */
    aggregationTitle: "Totals for this period (estimate)",
    aggregationScheduledLabel: "Total scheduled",
    aggregationStatutoryFrameLabel: "Statutory frame (40h × calendar days ÷ 7)",
    aggregationOverLabel: "The statutory frame is exceeded",
    aggregationLegalHolidayLabel: "Statutory holiday days",
    aggregationLegalHolidayOk: "Meets the requirement of 1 day per week, or 4 days per 4 weeks",
    aggregationLegalHolidayShortage: "Does not meet the requirement of 1 day per week, or 4 days per 4 weeks. Cannot be published",
    aggregationUnassignedDaysLabel: "Unassigned days",

    /** Variable period start day mismatch (400 period_start_mismatch). Shown when the web app's guessed day was wrong; the correct start day is used to fix the period. */
    periodStartMismatchMessage: (day: number) => `The variable period starts on day ${day}. The period shown has been corrected — please try again`,

    errors: {
      invalid_body: "Please check your input",
      invalid_user_id: "Please check the target member",
      invalid_period_start: "Please check the period start date",
      tenant_settings_not_found: "No attendance settings were found for this period. Please contact your administrator",
      plan_already_exists: "A shift schedule for this period already exists",
      not_found: "The shift schedule could not be found",
      invalid_days: "Please check the shift details",
      invalid_date: "Please check the date",
      date_out_of_period: "This date is outside the period",
      invalid_pattern_id: "The selected pattern could not be found",
      archived_pattern: "The selected pattern has been archived. Please choose a different pattern",
      invalid_day_type: "Please check the type",
      invalid_minutes: "Please check the start and end times",
      invalid_break_minutes: "Break (minutes) must be an integer of 0 or more",
      duplicate_date: "The same date appears more than once",
      already_published: "This shift schedule has already been published",
      legal_holiday_shortage: "Statutory holidays are insufficient. Set them to meet 1 day per week, or 4 days per 4 weeks",
      invalid_range: "Please check the specified range",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /** Viewing your own shifts (/shifts/me, everyone, v0.7 phase 3, added 2026-08-24). */
  shiftsMe: {
    title: "My shifts",
    tagline: "View your published shift schedule (the plan) as a monthly calendar.",
    loadFailed: "Could not load your shifts. Please try again",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    empty: "No shifts are registered for this month yet.",
    manageLink: "Manage shift schedules →",
  },

  departments: {
    title: "Department management",
    tagline: "Create, rename, move, and delete departments in the department tree.",
    noPermission: "You don't have permission to use this page",
    loadFailed: "Failed to load the department list. Please try again",
    empty: "There are no departments yet. Create one with \"Add department\".",
    topLevel: "Top level",
    addRoot: "Add department",
    addChild: "Add sub-department",
    rename: "Rename / change parent",
    delete: "Delete",

    formTitleCreate: "Add department",
    formTitleEdit: "Edit department",
    nameLabel: "Department name",
    namePlaceholder: "e.g. Sales",
    parentLabel: "Parent department",
    parentNone: "None (top level)",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",

    confirmDeleteTitle: "Delete this department?",
    confirmDeleteMessage: "This can't be undone. Departments with sub-departments or members remaining can't be deleted.",
    confirmDeleteLabel: "Delete",

    errors: {
      invalid_name: "Please enter a department name between 1 and 200 characters",
      invalid_parent_id: "The specified parent department could not be found",
      invalid_body: "Please check the entered content",
      circular_reference: "A department can't be its own parent, or the parent of one of its ancestors",
      not_found: "The department could not be found",
      department_not_empty: "This department still has sub-departments or members",
      default: "Something went wrong. Please try again",
    },
  },

  members: {
    title: "Member management",
    tagline: "Change members' department, assign permission presets, and review effective permissions (what they can do).",
    noPermission: "You don't have permission to use this page",
    loadFailed: "Failed to load the member list. Please try again",
    empty: "No members",

    columnName: "Name",
    columnEmail: "Email address",
    columnDepartment: "Department",
    columnPresets: "Assigned presets",
    columnHireDate: "Hire date",
    columnInviteStatus: "Invitation status",
    /** Status badge column for deactivation (added 2026-08-23 Tier 0 part 4). */
    columnStatus: "Status",
    /** Small display column for per-member work system (added 2026-08-23 Tier 0 part 4). */
    columnWorkSystem: "Work system",
    columnActions: "Actions",
    noDepartment: "No department",
    noPresets: "None assigned",
    /** workSystemKind is null (never assigned). Kept aligned with monthly.workSystemValue, plus "not set". */
    workSystemUnset: "Not set",

    detailToggleOpen: "Show details",
    detailToggleClose: "Hide details",

    /** Status badge for deactivated members (added 2026-08-23 Tier 0 part 4). */
    inactiveBadge: "Inactive",
    /**
     * List filter (default shows active only). Added a simple checkbox toggle since there was no
     * existing filter convention to follow.
     */
    showInactiveToggle: "Show inactive members too",

    /**
     * Invitation-based sign-up (added 2026-08-23, docs/requirements.md §7 "Sign-up is
     * invitation-only"). Creating a member also issues an invitation (POST /members).
     */
    inviteButton: "Invite a member",
    inviteFormTitle: "Invite a member",
    inviteFormHint: "Enter a name and email address to issue an invitation link. Department, hire date, and permission presets can be set later.",
    inviteEmailLabel: "Email address",
    inviteEmailPlaceholder: "e.g. yamada@example.com",
    inviteNameLabel: "Full name",
    inviteNamePlaceholder: "e.g. Taro Yamada",
    inviteDepartmentLabel: "Department (optional)",
    inviteHireDateLabel: "Hire date (optional)",
    invitePresetsLabel: "Permission presets (optional)",
    inviteCancel: "Cancel",
    inviteSubmit: "Issue invitation link",
    inviteSubmitting: "Issuing…",

    inviteLinkTitle: "Invitation link issued",
    inviteLinkTargetPrefix: "Invited: ",
    inviteLinkWarning: "This link is only shown once. It cannot be shown again after you close this (though it can be reissued).",
    inviteLinkLabel: "Invitation link",
    inviteLinkCopy: "Copy link",
    inviteLinkCopied: "Copied",
    inviteLinkCopyFailed: "Copy failed. Please select and copy it manually",
    inviteLinkExpiresLabel: "Expires",
    inviteLinkDone: "Close",

    inviteStatusBadge: {
      invited: "Invited",
      invite_expired: "Expired",
    } as Record<string, string>,

    reissueButton: "Reissue",
    reissueConfirmTitle: "Reissue this invitation?",
    reissueConfirmMessage: "This issues a new invitation link. The previous link will stop working.",

    revokeInviteButton: "Revoke",
    revokeInviteConfirmTitle: "Revoke this invitation?",
    revokeInviteConfirmMessage: "This invitation link will stop working. You can reissue it later if needed.",

    /**
     * Admin-issued password reset (added 2026-08-23 Tier 0 part 4). Shares the same one-time
     * link presentation as invitations (InviteLinkDialog with variant="reset"). Only for
     * members who have already accepted their invitation.
     */
    passwordResetButton: "Reset password",
    passwordResetBadge: "Reset pending",
    passwordResetRevokeButton: "Revoke",
    passwordResetRevokeConfirmTitle: "Revoke this password reset?",
    passwordResetRevokeConfirmMessage: "This reset link will stop working. You can issue a new one later if needed.",

    resetLinkTitle: "Password reset link issued",
    resetLinkTargetPrefix: "For: ",
    resetLinkWarning: "This link is only shown once. It cannot be shown again after you close this (though you can issue a new one).",
    resetLinkLabel: "Reset link",
    resetLinkCopy: "Copy link",
    resetLinkCopied: "Copied",
    resetLinkCopyFailed: "Copy failed. Please select and copy it manually",
    resetLinkExpiresLabel: "Expires",
    resetLinkDone: "Close",

    /**
     * Deactivation / reactivation (added 2026-08-23 Tier 0 part 4). Deactivation has a large
     * impact, so it follows the same dangerous-action convention as approve/reject (ConfirmDialog,
     * calm tone), spelling out the impact (can't log in, sessions revoked, invitations/resets
     * revoked). Reactivation doesn't break anything new, so no confirmation is required.
     */
    deactivateButton: "Deactivate",
    deactivateConfirmTitle: "Deactivate this member?",
    deactivateConfirmMessage: "Deactivating this member will do the following:",
    deactivateConfirmImpactLogin: "They will no longer be able to log in",
    deactivateConfirmImpactSession: "All of their current login sessions will be revoked",
    deactivateConfirmImpactInviteReset: "Any pending invitation or password reset link will be revoked",
    reactivateButton: "Reactivate",
    reactivating: "Reactivating…",

    /**
     * Per-member work system assignment (added 2026-08-23 Tier 0 part 4). GET/POST
     * /members/:id/work-policy (tenant_settings.flex.manage, tenant scope only). Without this
     * permission, even GET returns 403, so the whole section is hidden (see MembersView).
     */
    workPolicyTitle: "Work system",
    workPolicyHint: "Assigns whether monthly totals are calculated under flextime or a fixed schedule. Changes are made by adding a new assignment; past totals are unaffected.",
    workPolicyCurrentLabel: "Current work system",
    workPolicyCurrentEffectiveFrom: "This assignment took effect on",
    workPolicyNoneYet: "No assignment yet",
    workPolicyHistoryTitle: "Assignment history",
    workPolicyHistoryEmpty: "No history yet",
    workPolicyHistoryColumnEffectiveFrom: "Effective from",
    workPolicyHistoryColumnKind: "System",
    workPolicyFormTitle: "Change work system",
    workPolicyKindLabel: "Work system",
    workPolicyEffectiveFromLabel: "Effective from",
    workPolicyEffectiveFromHint: "This change only affects calculations from the specified date onward; past totals are unaffected.",
    /**
     * Only shown for the monthly variable system (added 2026-08-24, v0.7 phase 4).
     * Under that system daily scheduled hours come from the shift plan, so standard_day_minutes
     * only means "how many minutes one day of paid leave counts for".
     */
    workPolicyStandardDayMinutesLabel: "Standard scheduled minutes per day (for paid leave conversion)",
    workPolicyStandardDayMinutesHint:
      "How many minutes one day of paid leave counts as on days with no shift (minutes, 1-1440). The default is 480 (8 hours).",
    workPolicySubmit: "Apply this change",
    workPolicySubmitting: "Applying…",
    workPolicySubmitSuccess: "Work system changed.",
    workPolicyNoPermission: "You don't have permission to change this setting",

    departmentChangeLabel: "Change department",
    departmentChangeSaved: "Department changed",

    hireDateLabel: "Set hire date",
    hireDateSave: "Save",
    hireDateSaving: "Saving…",
    hireDateSaved: "Hire date saved",
    hireDateUnset: "Not set",
    hireDateWarning: "The statutory grant of annual paid leave can't be calculated because the hire date isn't set",

    leaveGrantClassTitle: "Annual leave grant class",
    leaveGrantClassHint:
      "Choose a proportional class (4 days a week or fewer) only when the contracted hours are under 30 per week AND the contracted days are 4 or fewer per week (Labor Standards Act art. 39(3)).",
    leaveGrantClassLabel: "Select the annual leave grant class",
    leaveGrantClassOption: {
      full: "Standard (5+ days/week)",
      days4: "4 days/week",
      days3: "3 days/week",
      days2: "2 days/week",
      days1: "1 day/week",
    },
    leaveGrantClassSave: "Save class",
    leaveGrantClassSaving: "Saving…",
    leaveGrantClassSaved: "Annual leave grant class saved",
    leaveGrantClassNote: "The change applies to future automatic grants and grant proposals (days already granted stay as they are).",

    presetAssignTitle: "Presets to assign",
    presetAssignHint: "Changing a checkbox immediately updates the \"can do\" list below. Nothing is actually changed until you save.",
    presetAssignSave: "Save assignments",
    presetAssignSaving: "Saving…",
    presetAssignSaved: "Permission preset assignments saved",
    presetAssignUnsaved: "You have unsaved changes",
    noPresetsAvailable: "No permission presets are available",

    effectiveTitle: "What this member can do",
    effectiveHint: "Everyone can always punch for themselves, submit requests, and view their own records (common to all, not configurable).",
    effectiveEmpty: "No permissions beyond the basic actions above are assigned.",
    effectiveScopeLabel: "Scope",
    effectiveSourceLabel: "Source",
    /** Improvement from self-review: appending this directly after the preset name in parentheses was dense and hard to read.
     * Added a leading period to break it into its own sentence, in plainer wording. */
    effectiveViaImplication: ". A view automatically included with another permission",

    errors: {
      invalid_body: "Please check the entered content",
      invalid_email: "Please check the email address format",
      invalid_name: "Please enter a name between 1 and 200 characters",
      invalid_department_id: "The specified department could not be found",
      invalid_hire_date: "Please enter the hire date in YYYY-MM-DD format",
      invalid_leave_grant_class: "The annual leave grant class is invalid",
      email_already_exists: "This email address is already registered",
      not_found: "The member could not be found",
      invalid_preset_id: "The specified permission preset could not be found",
      self_escalation: "You can't grant yourself new permissions",
      self_demotion: "You can't remove your own permission-management permission",
      last_admin: "You can't remove this permission from the last member who can manage permissions",
      /** Invitation reissue/revoke (added 2026-08-23). */
      already_active: "This member has already completed sign-up (no need to reissue the invitation)",
      already_accepted: "This invitation has already been accepted",
      already_revoked: "This invitation has already been revoked",
      /** Reissuing an invitation / issuing a password reset for a deactivated member (added 2026-08-23 Tier 0 part 4). */
      member_inactive: "This member has been deactivated. Please reactivate them before performing this action",
      /** Admin-issued password reset (added 2026-08-23 Tier 0 part 4). Can't be issued to a member who hasn't accepted yet. */
      not_active: "This member hasn't accepted their invitation yet. Please reissue the invitation instead",
      /** Revoking a password reset (added 2026-08-23 Tier 0 part 4). */
      password_reset_already_used: "This password reset has already been used",
      password_reset_already_revoked: "This password reset has already been revoked",
      /** Deactivation / reactivation (added 2026-08-23 Tier 0 part 4). */
      cannot_deactivate_self: "You can't deactivate yourself",
      already_inactive: "This member is already deactivated",
      /** Reactivation (added 2026-08-23 Tier 0 part 4). Kept separate from invitation's already_active wording. */
      member_already_active: "This member is already active",
      /** Per-member work system assignment (added 2026-08-23 Tier 0 part 4). */
      invalid_work_system_kind: "Please select a work system",
      invalid_effective_from: "Please check the effective date",
      effective_from_in_past: "The effective date can only be today or later (past calculation results must not change)",
      assignment_already_exists: "An assignment already exists for that effective date. Please choose a different date",
      /** Standard scheduled minutes per day for paid leave conversion (v0.7 phase 4, added 2026-08-24). */
      invalid_standard_day_minutes: "Standard scheduled minutes per day must be a whole number between 1 and 1440",
      version_already_exists: "A version with the same settings already exists for that effective date. Please choose a different date",
      default: "Something went wrong. Please try again",
    },
  },

  presets: {
    title: "Permission preset management",
    tagline: "Create and edit presets combining permission toggles and scopes. Assigning multiple presets to one person combines them.",
    noPermission: "You don't have permission to use this page",
    loadFailed: "Failed to load permission presets. Please try again",
    empty: "No permission presets",

    columnName: "Name",
    columnDescription: "Description",
    columnType: "Type",
    columnAssignedCount: "Assigned to",
    columnActions: "Actions",
    systemBadge: "Built-in",
    customBadge: "Custom",
    noDescription: "(No description)",
    assignedCountUnit: "",

    addNew: "Create new preset",
    edit: "Edit",
    duplicate: "Duplicate and edit",
    delete: "Delete",

    formTitleCreate: "Create new permission preset",
    formTitleEdit: "Edit permission preset",
    formReadonlyNote: "Built-in presets can't be edited. To change the contents, create a new preset using \"Duplicate and edit\".",
    /** Default name when duplicating (appended after the original name). */
    duplicateNameSuffix: (name: string) => `Copy of ${name}`,
    nameLabel: "Name",
    namePlaceholder: "e.g. Accounting manager",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Describing what this preset is for makes it easier to choose",
    permissionsLabel: "Permissions",
    scopeLabel: "Scope",
    dangerousBadge: "Sensitive",
    dangerousNote: "This permission has significant impact. Please carefully confirm who you're granting it to.",
    impliesViewPrefix: "This permission includes the following views: ",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    close: "Close",

    confirmDeleteTitle: "Delete this permission preset?",
    confirmDeleteMessage: "This can't be undone. Presets currently assigned to members can't be deleted.",
    confirmDeleteLabel: "Delete",

    errors: {
      invalid_name: "Please enter a name between 1 and 100 characters",
      invalid_description: "Description must be 500 characters or fewer",
      invalid_grants: "Please check the selected permissions",
      invalid_body: "Please check the entered content",
      not_found: "The permission preset could not be found",
      system_preset: "Built-in presets can't be edited or deleted",
      preset_in_use: "This preset is currently assigned to members and can't be deleted",
      default: "Something went wrong. Please try again",
    },
  },

  /** Annual paid leave home (/leave, v0.3). docs/requirements.md §5 & docs/design/ui-direction.md. */
  leave: {
    title: "Annual paid leave",
    tagline: "Check your balance, request leave, and approve requests.",
    loadFailed: "Failed to load annual paid leave information. Please try again",

    balanceTitle: "Balance",
    annualLabel: "Annual paid leave",
    stockedLabel: "Stocked leave",
    remainingLabel: "Remaining",
    grantedTotalLabel: "Total granted",
    usedTotalLabel: "Used",
    noGrants: "No leave has been granted",
    grantBreakdownToggle: "Breakdown by grant",
    grantColumnGrantedOn: "Granted on",
    grantColumnDays: "Days",
    grantColumnExpiresOn: "Expires",
    grantColumnRemaining: "Remaining",
    grantExpired: "Expired",
    expiringSoonTitle: "Expiring soon",
    expiringSoonNote: "Some of your granted leave expires within 60 days. We recommend taking it soon.",

    mandatoryTitle: "Mandatory 5-day minimum status",
    mandatoryNone: "No eligible grant (10+ days) applies",
    mandatoryTakenLabel: "Taken",
    mandatoryRequiredLabel: "Required",
    mandatoryDeadlineLabel: "Deadline",
    mandatoryShortagePrefix: "",
    mandatoryShortageSuffix: " day(s) short",
    mandatorySatisfied: "Met",

    requestFormTitle: "Request leave",
    dateLabel: "Target date",
    unitLabel: "Unit",
    unitFullDay: "Full day",
    unitHalfDayAm: "Half day (AM)",
    unitHalfDayPm: "Half day (PM)",
    unitHourly: "Hourly",
    minutesLabel: "Time (minutes)",
    minutesPlaceholder: "e.g. 120",
    leaveTypeLabel: "Leave type",
    leaveTypeAnnual: "Annual paid leave",
    leaveTypeStocked: "Stocked leave",
    reasonLabel: "Reason",
    reasonPlaceholder: "Enter the reason for this leave",
    hourlyQuotaPrefix: "Hourly leave is capped at 5 days per year (currently ",
    hourlyQuotaSeparator: " / cap ",
    hourlyQuotaSuffix: ")",
    submit: "Submit",
    submitting: "Submitting…",
    submitted: "Request submitted. It will be reflected in the attendance record once approved.",
    targetMonthClosedNote: "This month is already closed. Approving requires permission to reopen it.",

    requestsTitle: "Requests",
    requestsEmpty: "No requests yet",

    queueSectionTitle: "Leave requests awaiting approval",
    queueSectionTagline: "Requests awaiting approval within your approval scope.",
    queueEmpty: "No requests awaiting approval",

    columnDate: "Target date",
    columnUnit: "Unit",
    columnLeaveType: "Type",
    columnReason: "Reason",
    columnDecision: "Decision",

    statusLabel: {
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
    } satisfies Record<"pending" | "approved" | "rejected" | "withdrawn", string>,

    unitLabelShort: {
      full_day: "Full day",
      half_day_am: "Half day (AM)",
      half_day_pm: "Half day (PM)",
      hourly: "Hourly",
    } satisfies Record<"full_day" | "half_day_am" | "half_day_pm" | "hourly", string>,

    /** Appended after unitLabelShort.hourly in the request list, e.g. "(120 min)". */
    hourlyMinutesSuffix: (minutes: number) => ` (${minutes} min)`,

    leaveTypeLabelShort: {
      annual: "Annual paid leave",
      stocked: "Stocked leave",
    } satisfies Record<"annual" | "stocked", string>,

    approve: "Approve",
    reject: "Reject",
    withdraw: "Withdraw",
    decidedBySelf: "You",
    decisionNoteLabel: "Decision note",
    decisionNotePlaceholder: "Note (optional)",

    confirmApproveTitle: "Approve this request?",
    confirmApproveMessage: "Approving will update the attendance record and change the monthly totals. This action is recorded in the audit log.",
    confirmApproveSelfNote: "This will be recorded as a self-approval.",
    confirmRejectTitle: "Reject this request?",
    confirmRejectMessage: "Rejecting records the request as rejected; it will not be reflected in the attendance record.",
    confirmWithdrawTitle: "Withdraw this request?",
    confirmWithdrawMessage: "Withdrawing clears the pending status. You can submit it again if needed.",

    close: "Close",
    cancel: "Cancel",

    errors: {
      invalid_leave_date: "Please check the target date",
      invalid_reason: "Please enter a reason between 1 and 500 characters",
      invalid_unit: "Please check the unit",
      invalid_leave_type: "Please check the leave type",
      invalid_minutes: "Please enter a valid time (minutes)",
      invalid_body: "Please check the entered content",
      hourly_leave_disabled: "Hourly leave is not enabled for this tenant",
      half_day_leave_disabled: "Half-day leave is not enabled for this tenant",
      duplicate_request: "A request already exists for this date and unit",
      exceeds_daily_hours: "This exceeds the daily prescribed working hours",
      insufficient_balance: "Insufficient remaining balance",
      hourly_limit_exceeded: "This exceeds the annual cap for hourly leave",
      not_pending: "This request has already been processed",
      not_found: "The request could not be found",
      forbidden: "You don't have permission to perform this action",
      month_closed_requires_unlock: "This month is already closed. Approving requires permission to reopen it",
      default: "Something went wrong. Please try again",
    },
  },

  /** Annual paid leave policy settings (/settings/leave, v0.3). Covers GET/PUT /settings/leave and grant-management endpoints. */
  settingsLeave: {
    title: "Annual paid leave settings",
    tagline: "Configure the tenant-wide grant method, hourly leave, and stocked leave settings.",
    noPermission: "You don't have permission to change this setting",
    loadFailed: "Failed to load settings. Please try again",

    grantMethodSectionTitle: "Grant method",
    grantMethodStatutory: "Statutory (based on hire date)",
    grantMethodFixedDate: "Fixed date (company-wide)",
    fixedDateLabel: "Fixed date (month-day)",
    fixedDatePlaceholder: "e.g. 04-01",

    hourlySectionTitle: "Hourly annual leave",
    hourlyEnabledLabel: "Enable hourly annual leave",
    hourlyMaxDaysLabel: "Annual cap (days, 1-5)",

    halfDaySectionTitle: "Half-day leave",
    halfDayEnabledLabel: "Enable half-day leave",

    stockSectionTitle: "Stocking of expired leave",
    stockEnabledLabel: "Enable stocking of expired leave",
    stockHelp: "A scheme for setting aside annual paid leave that would otherwise expire, into a separate pool. This is not a statutory scheme — it is set up at the company's discretion.",
    stockMaxDaysLabel: "Maximum stocked days",
    stockExpiresMonthsLabel: "Expiration of stocked leave (months; leave blank for no expiration)",

    save: "Save",
    saving: "Saving…",
    saveSuccess: "Settings saved.",
    saveNote: "This setting applies to the entire tenant. Changes are recorded in the audit log.",

    adminSectionTitle: "Grant & stock management",
    adminSectionTagline: "Choose a target member and run an action. This action is recorded in the audit log.",
    targetUserLabel: "Target member",
    targetUserPlaceholder: "Select a member",

    autoGrantTitle: "Run statutory grant",
    autoGrantDesc: "Creates any ungranted leave calculated from the hire date. Leave that has already been granted is not duplicated.",
    autoGrantRun: "Run statutory grant",
    autoGrantRunning: "Running…",
    autoGrantResultCreatedPrefix: "Granted ",
    autoGrantResultCreatedSuffix: " item(s)",
    autoGrantResultSkippedPrefix: "(skipped, e.g. already granted: ",
    autoGrantResultSkippedSuffix: ")",
    autoGrantEmpty: "There was nothing new to grant",

    manualGrantTitle: "Manual grant",
    manualGrantDesc: "Grant leave with an arbitrary number of days and expiration.",
    grantedOnLabel: "Granted on",
    daysLabel: "Days",
    expiresOnLabel: "Expires on (leave blank for the default: granted date + 2 years for annual leave, no expiration for stocked leave)",
    leaveTypeLabel: "Type",
    leaveTypeAnnual: "Annual paid leave",
    leaveTypeStocked: "Stocked leave",
    noteLabel: "Note (optional)",
    manualGrantSubmit: "Grant",
    manualGrantSubmitting: "Processing…",
    manualGrantSuccess: "Granted.",

    convertTitle: "Convert expired leave to stock",
    convertDesc: "Converts unused annual paid leave that has expired into stocked leave.",
    convertRun: "Run conversion",
    convertRunning: "Running…",
    convertResultTitle: "Conversion result",
    convertResultConvertedPrefix: "Days converted: ",
    convertResultConvertedSuffix: "",
    convertResultTruncatedPrefix: "(truncated over the cap: ",
    convertResultTruncatedSuffix: " day(s))",
    convertResultEmpty: "Nothing was eligible for conversion",

    errors: {
      invalid_grant_method: "Please check the grant method",
      invalid_fixed_date_mm_dd: "Please enter the fixed date in MM-DD format",
      invalid_hourly_leave_enabled: "Please check the entered content",
      invalid_half_day_leave_enabled: "Please check the entered content",
      invalid_stock_conversion_enabled: "Please check the entered content",
      invalid_hourly_leave_max_days: "Annual cap must be between 1 and 5",
      invalid_stock_max_days: "Please enter a valid maximum for stocked days",
      invalid_stock_expires_months: "Please enter a valid expiration period for stocked leave (months)",
      invalid_body: "Please check the entered content",
      invalid_user_id: "Please select a target member",
      invalid_granted_on: "Please check the grant date",
      invalid_days: "Please enter a valid number of days",
      invalid_expires_on: "Please check the expiration date",
      invalid_leave_type: "Please check the type",
      invalid_note: "Please check the note",
      not_found: "The target could not be found",
      hire_date_not_set: "The target member's hire date is not set",
      leave_settings_not_configured: "Please save the annual paid leave policy settings first",
      stock_conversion_disabled: "The stocking setting is not enabled",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Leave grant proposals (the "Grant proposals" section of /settings/leave, v0.7 phase 4,
   * added 2026-08-24). docs/requirements.md §11 "proposal -> approval by an administrator ->
   * notification to the member". The machine never finalizes a grant, and the attendance rate
   * (the 80% requirement of Article 39-1 of the Labor Standards Act) is shown only as a reference.
   */
  leaveGrantProposals: {
    sectionTitle: "Grant proposals",
    sectionDesc:
      "Proposals created by the daily automatic calculation. A proposal alone grants nothing — it takes effect only once someone reviews and approves it. The attendance rate is a reference figure; the final call on the 80% requirement is yours.",
    loadFailed: "Could not load the grant proposals. Please try again",
    empty: "There are no grant proposals right now",

    columnMember: "Member",
    columnLeaveType: "Leave type",
    columnGrantedOn: "Grant date",
    columnDays: "Days",
    columnAttendanceRate: "Attendance rate (reference)",
    columnActions: "Actions",

    leaveTypeAnnual: "Annual paid leave",
    leaveTypeStocked: "Stocked leave",

    basisShift: "Based on shifts",
    basisCalendarEstimate: "Estimated from the calendar",
    /** Shown when there are no working days, so no rate can be computed. This means "unknown", not 0%. */
    rateUnknown: "—",
    rateBelowThreshold: "May be below 80% — please check",
    proportionalChip: (weekDaysLabel: string) => `Proportional (${weekDaysLabel})`,

    approve: "Approve",
    reject: "Reject",
    confirmApproveTitle: "Approve this proposal?",
    confirmApproveMessage: "Approving grants the annual paid leave exactly as proposed. The grant date stays the proposed one.",
    confirmRejectTitle: "Reject this proposal?",
    confirmRejectMessage: "Rejecting grants nothing. Leaving a reason makes it easier to follow the history later.",
    noteLabel: "Reason for rejection (optional)",
    notePlaceholder: "e.g. attendance rate is below 80%",
    approveSuccess: "Approved and granted.",
    rejectSuccess: "Rejected.",

    historyTitle: "Decided proposals",
    historyEmpty: "There are no decided proposals",
    columnStatus: "Status",
    columnDecidedAt: "Decided at",
    columnDecisionNote: "Reason for rejection",
    statusLabel: {
      proposed: "Undecided",
      approved: "Approved",
      rejected: "Rejected",
      superseded: "Recreated",
    },

    errors: {
      not_found: "The proposal could not be found",
      not_proposed: "This proposal has already been decided. Please reload to see the latest state",
      grant_already_exists: "A grant already exists for the same grant date. Please check for a duplicate manual grant",
      invalid_status: "Please check the filter",
      invalid_body: "Please check the entered content",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Company policy editor (/settings/help, added 2026-08-22).
   * Displays the 3 principles from docs/design/ui-direction.md "Guide & help policy > Company
   * policy examples" directly on screen.
   */
  settingsHelp: {
    title: "Company policy",
    tagline: "Add your company's own rules on top of the built-in help (law and KIZAMI behavior).",
    noPermission: "You don't have permission to change this setting",
    loadFailed: "Failed to load information. Please try again",

    guidelinesTitle: "Writing guidelines",
    guideline1: "Don't copy the text of the law — the law section is shown automatically. Duplicating it means only KIZAMI's copy gets updated when the law changes, leaving outdated text here that contradicts it",
    guideline2: "Write only what your company has decided — deadlines, contacts, how exceptions are handled, etc.",
    guideline3: "It's best to reference the relevant work rules article (e.g. \"See Work Rules Article X for details\")",

    workRulesSectionTitle: "Link to work rules",
    workRulesDesc: "Set a URL for your work rules (PDF, etc.) to show a \"View work rules\" link on the help screen.",
    workRulesUrlLabel: "URL",
    workRulesUrlPlaceholder: "https://example.com/work-rules.pdf",
    workRulesSave: "Save",
    workRulesSaving: "Saving…",
    workRulesSaveSuccess: "Work rules link saved.",

    listTitle: "Help topics",
    listEmployeeGroup: "For employees",
    listAdminGroup: "For HR/labor staff",
    originLaw: "Law",
    originProduct: "KIZAMI behavior",
    hasOverrideBadge: "Has company notes",
    selectPrompt: "Select a help topic from the list on the left.",

    referenceTitle: "Built-in explanation",
    editorTitle: "Company policy",
    editorPlaceholderNote: "Faint text is an example. Copy it if you want to use it as-is.",
    bodyLabel: "Body (Markdown)",
    save: "Save",
    saving: "Saving…",
    saveSuccess: "Company policy saved.",
    deleteConfirmTitle: "Delete company policy",
    deleteConfirmMessage: "This deletes your company's notes for this topic. Only the built-in explanation will be shown afterward.",
    delete: "Delete",
    deleting: "Deleting…",
    deleteSuccess: "Company policy deleted.",
    empty: "The body is empty, so saving will delete this entry.",

    errors: {
      invalid_help_key: "This help topic doesn't exist",
      invalid_body_md: "Please check the body text",
      invalid_url: "Please enter the URL in http(s) format",
      invalid_body: "Please check the entered content",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Personal data document templates (/settings/privacy, added 2026-08-22).
   * As required in docs/design/ui-direction.md "Personal data templates", the screen always
   * makes clear these are templates, not legal advice.
   */
  settingsPrivacy: {
    title: "Personal data",
    tagline: "Generate draft employee privacy notices and internal usage terms from your current settings.",
    noPermission: "You don't have permission to view this setting",
    loadFailed: "Failed to load information. Please try again",

    disclaimer:
      "This text is a template provided by KIZAMI. Please review it against your company's actual practices and, if needed, consult a specialist (e.g. a labor and social security attorney or lawyer). This is not legal advice.",

    generatedFromTitle: "Settings this template is based on",
    generatedFromGpsOn: "GPS: Enabled",
    generatedFromGpsOff: "GPS: Disabled",
    generatedFromRetention: (days: number) => `Location data retention period: ${days} days`,
    generatedFromRetentionSame: "Location data retention period: same as punch records",
    generatedFromNote: "GPS on/off and the retention period update the next time this page is shown, based on changes to tenant settings (e.g. \"Settings > Tenant profile\").",

    noticeSectionTitle: "Employee privacy notice",
    noticeSectionDesc: "A template summarizing what's collected, why, how long it's kept, and where to make requests. Use it to inform employees.",
    termsSectionTitle: "Internal usage terms (punch-related rules)",
    termsSectionDesc: "A template summarizing the duty to punch accurately, the prohibition on punching for someone else, and the correction request process.",

    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed. Please select and copy it manually",
    download: "Download as Markdown",
    registerAsCompanyRule: "Register as company policy",
    registering: "Registering…",
    registerSuccess: "Registered as company policy. You can edit it from \"Settings > Company policy\".",
    registerFailed: "Registration failed. Please try again",
  },

  /**
   * API key (public punch API, v0.4) management screen (/settings/api-keys).
   * No permission required (anyone can issue/revoke their own keys, per the request "no
   * permission needed since it's for personal use").
   */
  settingsApiKeys: {
    title: "API keys",
    tagline: "Keys for punching from external clients that can't hold a session cookie, such as IC card readers, Slack bots, and MCP servers.",
    loadFailed: "Failed to load information. Please try again",

    listTitle: "Issued keys",
    empty: "No API keys have been issued.",
    columnName: "Name",
    columnScopes: "Scopes",
    columnCreated: "Created",
    columnLastUsed: "Last used",
    columnExpires: "Expires",
    columnStatus: "Status",
    columnActions: "Actions",
    neverUsed: "Never used",
    noExpiry: "No expiration",
    statusActive: "Active",
    statusRevoked: "Revoked",
    statusExpired: "Expired",
    revoke: "Revoke",
    revoking: "Revoking…",

    revokeConfirmTitle: "Revoke this API key",
    revokeConfirmMessage: "Integrations using this key (IC card reader, Slack bot, MCP server, etc.) will stop working. This action can't be undone.",

    scopePunch: "Punch — create and view your own punches",
    scopeRead: "Read — view your own attendance only",

    createTitle: "Issue a new key",
    nameLabel: "Name (something that identifies its purpose)",
    namePlaceholder: "e.g. 2F entrance IC card reader",
    scopesLabel: "Scopes (multiple allowed)",
    expiresLabel: "Expiration (optional)",
    expiresHint: "Leave blank for no expiration.",
    issue: "Issue",
    issuing: "Issuing…",

    createdTitle: "Key issued",
    createdWarning: "This value will never be shown again. Please store it somewhere safe.",
    createdTokenLabel: "API key",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed. Please select and copy it manually",
    createdDone: "Close",

    usageExampleTitle: "Usage example",
    usageExampleDesc: "Send requests with the issued key as a Bearer token in the Authorization header.",
    usageExampleCurlComment: "# Clock in",

    errors: {
      invalid_name: "Please enter a name between 1 and 100 characters",
      invalid_scopes: "Please select at least one scope",
      invalid_expires_at: "Please check the expiration format",
      not_found: "The key could not be found",
      already_revoked: "This key has already been revoked",
      forbidden: "You don't have permission to perform this action",
      default: "Something went wrong. Please try again",
    },
  },

  /**
   * Audit log (/settings/audit-logs, added 2026-08-23). Read-only, append-only record of
   * operations such as punches, corrections, approvals, closing, and permission changes.
   */
  settingsAuditLogs: {
    title: "Audit log",
    tagline: "A record of operations such as punches, corrections, approvals, closing, and permission changes.",
    immutableNote: "The audit log is append-only: entries can never be modified or deleted after the fact (read-only).",
    loadFailed: "Failed to load information. Please try again",
    forbidden: "You don't have permission to perform this action",

    filterActionLabel: "Action",
    filterActionAll: "All",
    filterActorLabel: "Actor (user ID)",
    filterActorPlaceholder: "Leave blank for everyone",
    filterFromLabel: "Period (from)",
    filterToLabel: "Period (to)",
    filterApply: "Apply filters",
    filterClear: "Clear filters",
    filterInvalidRange: "The end date must be on or after the start date",

    columnOccurredAt: "Date/time",
    columnActor: "Actor",
    columnAction: "Action",
    columnTarget: "Target",
    columnDetail: "Details",
    detailToggle: "Show details",
    detailUnavailable: "No details available",

    empty: "No audit log entries match the current filters.",
    loadMore: "Load more",
    loadingMore: "Loading…",
    loadMoreFailed: "Failed to load more. Please try again",
  },
} satisfies Messages;
