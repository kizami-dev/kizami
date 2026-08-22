/**
 * apps/api を HTTP 経由で叩いて、スクリーンショット用のデモデータを投入する。
 *
 * 追加ユーザー・部署・アプリ内通知(HTTPで作れないもの)は先に apps/api/src/dev-screenshot-seed.ts
 * が直接 DB へ入れている前提で、その結果(ユーザーID・部署ID)を受け取って組み立てる。
 */
import { ApiClient } from "./api-client.js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./config.js";
import {
  addDays,
  addMonths,
  fmtDate,
  fmtMonth,
  jstMinutes,
  jstToday,
  weekdaysBeforeTodayInCurrentMonth,
  weekdaysInMonth,
  type CivilDate,
} from "./time.js";

export interface ExtraUser {
  key: string;
  id: string;
  email: string;
}

export interface SeedHttpParams {
  apiBaseUrl: string;
  extraUsers: ExtraUser[];
  departments: { hq: string; sales: string; dev: string };
}

export interface SeedHttpResult {
  sessionCookie: string;
  adminId: string;
}

/** 1日ぶんの勤務(既定 9:00-18:00, 休憩12:00-13:00)を打刻として積む。休憩は勤務時間内に収める。 */
async function punchNormalDay(
  client: ApiClient,
  date: CivilDate,
  opts?: { start?: number; end?: number; breakStart?: number; breakEnd?: number },
): Promise<void> {
  const start = opts?.start ?? 9;
  const end = opts?.end ?? 18;
  const breakStart = opts?.breakStart ?? 12;
  const breakEnd = opts?.breakEnd ?? 13;
  await client.punch("clock_in", jstMinutes(date, start, 0));
  await client.punch("break_start", jstMinutes(date, breakStart, 0));
  await client.punch("break_end", jstMinutes(date, breakEnd, 0));
  await client.punch("clock_out", jstMinutes(date, end, 0));
}

export async function seedHttp(params: SeedHttpParams): Promise<SeedHttpResult> {
  const client = new ApiClient(params.apiBaseUrl);
  const login = await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminId = login.user.id;

  const byKey = new Map(params.extraUsers.map((u) => [u.key, u.id] as const));
  const managerId = byKey.get("manager");
  const member1Id = byKey.get("member1");
  const member2Id = byKey.get("member2");
  if (!managerId || !member1Id || !member2Id) throw new Error("extra demo users were not created (dev-screenshot-seed.ts)");

  // --- 部署・メンバー・権限プリセット -------------------------------------------------
  const presetsRes = await client.listPresets();
  const managerPreset = presetsRes.presets.find((p) => p.name === "マネージャー");
  const memberPreset = presetsRes.presets.find((p) => p.name === "メンバー");
  if (!managerPreset || !memberPreset) throw new Error("system presets (from `pnpm seed`) not found");

  const accountingPreset = await client.createPreset({
    name: "経理担当",
    description: "自部署の勤怠を確認し、CSVを出力できるカスタムプリセット(デモ用)",
    grants: [
      { key: "attendance.record.view", scope: "department" },
      { key: "export.attendance.run", scope: "department" },
    ],
  });

  await client.updateMember(managerId, { departmentId: params.departments.sales });
  await client.updateMember(member1Id, { departmentId: params.departments.sales });
  await client.updateMember(member2Id, { departmentId: params.departments.dev });

  await client.assignMemberPresets(managerId, [managerPreset.id]);
  await client.assignMemberPresets(member1Id, [memberPreset.id, accountingPreset.preset.id]);
  await client.assignMemberPresets(member2Id, [memberPreset.id]);

  // 入社日を設定(法定付与の自動計算に必要)。管理者は約7年前入社にして複数回ぶんの
  // 付与履歴(6ヶ月・1.5年・2.5年…)が一度に生成されるようにする(有給休暇画面を賑やかにする独自判断)。
  await client.updateMember(adminId, { hireDate: "2019-04-01" });

  // --- 有給休暇: テナント設定 → 法定付与(自動)→ 失効分の積立振替 -------------------------
  await client.updateLeaveSettings({
    grantMethod: "statutory",
    hourlyLeaveEnabled: true,
    hourlyLeaveMaxDays: 5,
    halfDayLeaveEnabled: true,
    stockConversionEnabled: true,
    stockMaxDays: 40,
    stockExpiresMonths: null,
  });
  await client.autoGrantLeave(adminId);
  await client.convertExpiredLeave(adminId);

  const today = jstToday();

  // 全休(承認済み)
  const fullDayDate = fmtDate(addDays(today, -16));
  const fullDayReq = await client.createLeaveRequest({
    leaveDate: fullDayDate,
    leaveType: "annual",
    reason: "私用のため",
  });
  await client.approveLeaveRequest(fullDayReq.request.id);

  // 半休(申請中のまま — 承認待ちの見た目を残す)
  const halfDayDate = fmtDate(addDays(today, 4));
  await client.createLeaveRequest({
    leaveDate: halfDayDate,
    unit: "half_day_am",
    leaveType: "annual",
    reason: "通院のため",
  });

  // 時間単位(承認済み)
  const hourlyDate = fmtDate(addDays(today, -9));
  const hourlyReq = await client.createLeaveRequest({
    leaveDate: hourlyDate,
    unit: "hourly",
    minutes: 120,
    leaveType: "annual",
    reason: "家族の用事のため(2時間)",
  });
  await client.approveLeaveRequest(hourlyReq.request.id);

  // --- 打刻: 先月ぶん(締める用)→ 今月ぶん(通常・深夜・打刻忘れ・本日勤務中) -------------
  // 先月は暦月まるごと過去なので、月末に近い平日を最大10日ぶん使う(締め後の月次表示を賑やかにする)。
  const prevMonth = addMonths(today, -1);
  const prevMonthAllWeekdays = weekdaysInMonth(prevMonth.y, prevMonth.m);
  const prevMonthWeekdays = prevMonthAllWeekdays.slice(-10);
  for (const date of prevMonthWeekdays) {
    await punchNormalDay(client, date);
  }
  const prevMonthPeriod = fmtMonth(prevMonth);
  await client.closeMonth(prevMonthPeriod, "先月分を確認のうえ締めます");

  // 今月・今日より前の平日プール(昇順)。末尾から役割を割り当てる — 締め済みの先月へは
  // 絶対に越境しない(月初に撮影した場合はプールが短くなり、一部の役割が欠けるだけ)。
  const pool = weekdaysBeforeTodayInCurrentMonth();
  const recentDay = pool.pop(); // 直近の勤務日(修正申請の対象にする)
  const missingClockOutDate = pool.pop() ?? recentDay; // 打刻忘れの日(無ければ直近日と兼用)
  const lateNightDay = pool.pop();
  const normalDay2 = pool.pop();
  const normalDay1 = pool.pop();

  if (normalDay1) await punchNormalDay(client, normalDay1);
  if (normalDay2) await punchNormalDay(client, normalDay2);
  // 22:00-23:00 が深夜労働になる。休憩は 17-18 時(9-23時の勤務時間内)に収める
  // (休憩が勤務時間の外にあると "break_outside_work" 警告になってしまうため)。
  if (lateNightDay) await punchNormalDay(client, lateNightDay, { start: 13, end: 23, breakStart: 17, breakEnd: 18 });

  // 打刻忘れの日: clock_out を打たないまま放置すると、エンジンは「まだ勤務中」の状態が
  // 後続の日の clock_in まで続くとみなし(duplicate_clock_in)、以降の日の実労働まで
  // おかしくなる(実装時に手元で確認した挙動)。そのため、この日の追加申請は
  // その場で承認まで行い、セッションを閉じてから後続日の打刻に進む。
  // 通知(dev-screenshot-seed.ts が直接投入)には「打刻忘れがあった」事実がそのまま残るため、
  // 「気づいて直した」という一貫したストーリーになる。
  if (missingClockOutDate) {
    await client.punch("clock_in", jstMinutes(missingClockOutDate, 9, 0));
    await client.punch("break_start", jstMinutes(missingClockOutDate, 12, 0));
    await client.punch("break_end", jstMinutes(missingClockOutDate, 13, 0));
    // clock_out はあえて打たない(打刻忘れ)→ この直後に追加申請で復旧する

    const missingCorrection = await client.createCorrection({
      proposedKind: "clock_out",
      proposedOccurredAt: jstMinutes(missingClockOutDate, 19, 0),
      reason: "退勤打刻を忘れていました。実際は19:00に退勤しています。",
    });
    await client.approveCorrection(missingCorrection.request.id, "確認しました。承認します。");
  }

  // pool が1件しか無かった場合、missingClockOutDate は recentDay と同じ日を指す(上の ?? フォールバック)。
  // その場合は同じ日に2重で打刻しない。
  if (recentDay && (!missingClockOutDate || fmtDate(recentDay) !== fmtDate(missingClockOutDate))) {
    await punchNormalDay(client, recentDay);
    // こちらは完結した1日に対する時刻の微修正で、セッションを分断しない。承認せず
    // 「申請中」のまま残し、修正申請一覧で pending/approved の両方を見せる。
    const recentDayPunches = await client.listPunches(jstMinutes(recentDay, 0, 0), jstMinutes(recentDay, 23, 59));
    const recentClockIn = recentDayPunches.punches.find((p) => p.kind === "clock_in");
    if (recentClockIn) {
      await client.createCorrection({
        targetEventId: recentClockIn.id,
        proposedKind: "clock_in",
        proposedOccurredAt: jstMinutes(recentDay, 9, 15),
        reason: "打刻漏れがあったため、実際の出勤時刻(9:15)に補正します。",
      });
    }
  }

  // 本日: 出勤のみ(打刻画面が「勤務中」スタンプで撮れるようにする)。
  // 撮影する時刻帯によって朝9時が未来になり得るため、固定時刻ではなく「実行時刻の少し前」を使う
  // (occurredAt は現在時刻より未来にできない、apps/api/src/routes/punches.ts)。
  const nowMinutes = Math.floor(Date.now() / 60_000);
  await client.punch("clock_in", nowMinutes - 30);

  // --- テナント設定・個人設定・連携設定 --------------------------------------------------
  await client.updateTenantProfile({
    isSmallOrMediumEnterprise: true,
    isSpecialProvisionWorkplace: false,
    specialClauseEnabled: false,
  });

  await client.updateNotificationSettings({
    webhookEnabled: true,
    webhookUrl: "https://hooks.example.com/kizami-demo",
    smtpEnabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpUser: "kizami@example.com",
    smtpFrom: "kizami@example.com",
    smtpPassword: "demo-smtp-password",
  });

  await client.updatePersonalNotificationSettings({
    categories: {
      missing_clock_out: { email: true, webhook: false },
      overtime_alert: { email: true, webhook: true },
      leave_alert: { email: false, webhook: true },
    },
    emailAddress: "admin-personal@example.com",
    webhookUrl: "https://hooks.example.com/personal-demo",
  });

  await client.updateSlackSettings({
    enabled: true,
    teamId: "T0123DEMO",
    signingSecret: "demo-signing-secret-0123456789",
  });

  await client.updatePrivacyContact({
    recordRetentionDescription: "打刻記録・IPアドレス・GPS座標は退職後5年間保存します。",
    privacyContactPoint: "人事労務部(privacy@example.com)",
  });
  await client.updateWorkRulesUrl("https://example.com/work-rules");

  // dayBoundaryMinutes は 0(変更なし)に固定する: ここを動かすと、撮影時刻が早朝(境界の前)
  // だった場合に「本日の出勤」打刻が前日扱いに再計算されてしまい、打刻画面の「勤務中」表示が
  // 崩れる(実装時に手元で確認した挙動 — 属する勤怠日は挿入時ではなく参照時に都度再計算される)。
  // GPS・法定休日ルールなど他のフィールドだけで「新しい版が追加された」ことを示す。
  await client.createAttendanceSettingVersion({
    effectiveFrom: fmtDate(today),
    dayBoundaryMinutes: 0,
    legalHolidayRule: { kind: "weekday", weekday: 0 },
    breakRule: { mode: "punch" },
    gpsEnabled: true,
    gpsRetentionDays: 90,
    // 週の起算曜日。固定時間制の「週40時間超」の判定に使う(就業規則に定めが無ければ
    // 日曜起算が原則 — 昭和63年基発第1号)。デモは既定のまま日曜にする。
    weekStartWeekday: 0,
  });
  await client.createWorkPolicyVersion({
    effectiveFrom: fmtDate(today),
    kind: "flex",
    settlementPeriod: "monthly",
    standardDayMinutes: 480,
  });

  await client.createApiKey({ name: "勤怠システム連携(読み取り専用)", scopes: ["read"], expiresAt: null });
  await client.createApiKey({
    name: "打刻端末A",
    scopes: ["punch"],
    expiresAt: jstMinutes(addDays(today, 180), 0, 0),
  });

  return { sessionCookie: client.getSessionCookie(), adminId };
}
