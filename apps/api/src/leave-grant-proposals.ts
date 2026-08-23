/**
 * 有給付与の「予告」を作る日次スキャン(docs/requirements.md §11、
 * docs/design/shift-work.md 実装フェーズ4)。
 *
 * 3段フローの1段目。付与基準日の `PROPOSAL_LEAD_TIME_DAYS` 日前になったユーザーについて、
 * 「◯月◯日に◯日付与される予定」という予告行(leave_grant_proposals)を積み、
 * `leave.grant.manage` を持つ管理者へ通知する。2段目(承認)・3段目(本人通知)は
 * apps/api/src/routes/leave.ts の POST /leave/grant-proposals/:id/approve が担う。
 *
 * **機械は付与を確定させない**(§11 の決定)。このスキャンが作るのはあくまで予告であり、
 * leave_grants の行は管理者が承認したときにだけ生まれる。労基法39条1項の「全労働日の
 * 8割以上出勤」の判定は、休職・育休期間の取扱い・争議行為の日・全労働日の定義といった、
 * データだけでは決められない要素を含むため、最終判断は人が行う — スキャンはその**検算材料**
 * として出勤率の参考値を添えるところまでを担当する。
 *
 * 付与日数は users.leave_grant_class(比例付与の区分、労基法39条3項)に従って計算する
 * (2026-08-24 追加、docs/design/leave-proportional-grant.md)。予告と実際の付与で日数が
 * 食い違わないよう、POST /leave/grants/auto と同じ区分・同じ関数を使う。
 *
 * 通知(shift-variance-alerts.ts と同じ形):
 * - 宛先は本人ではなく、その人をスコープに含む形で `leave.grant.manage` を持つ管理者
 *   (apps/api/src/lib/approvers.ts の resolveApproversForUser を再利用)
 * - 同じ管理者・同じ基準日に複数メンバーの予告が出たら1件にまとめる
 *   (notifications の UNIQUE(tenant_id, user_id, type, subject_date) がそのまま器になる)
 * - 加えてテナント共有 Webhook へ「何件の予告があるか」だけを1件通知する
 *   (個人の勤怠詳細は共有チャネルへ流さない — lib/notification-channels.ts の原則)
 * - 通知種別は "leave_grant_proposed"。既存の "leave_" プレフィックス一致で
 *   カテゴリ leave_alert に分類される(lib/notification-preferences.ts)
 *
 * BullMQ/Valkey には一切依存しない(reminders.ts / shift-variance-alerts.ts と同じ)。
 */

import { eq } from "drizzle-orm";
import {
  createNotificationIfAbsent,
  findActiveLeaveGrantProposal,
  getEffectiveSettingsVersion,
  getTenantLeaveSettings,
  insertLeaveGrantProposal,
  listApprovedLeaveRequestsInRange,
  listGrantedOnDates,
  listValidPunches,
  listValidShiftDaysInRange,
  users,
  type Database,
  type LeaveGrantProposal,
  type Notification,
} from "@kizami/db";
import type { LegalHolidayRule } from "@kizami/engine";
import {
  addDays,
  calculateAttendanceRate,
  calculateStatutoryGrants,
  estimateCalendarWorkingDates,
  isLeaveGrantClass,
  resolveAttendanceRatePeriod,
  type AttendanceRateReference,
  type GrantMethod,
  type LeaveGrantClass,
} from "@kizami/leave";
import { dispatch } from "@kizami/notify";
import { resolveApproversForUser } from "./lib/approvers.js";
import { buildTenantChannels, type BuildNotificationChannelsOptions } from "./lib/notification-channels.js";
import { buildSettingsTimeline, resolveWorkSystemForDate, TZ_OFFSET_MINUTES_JST } from "./lib/settings.js";
import { dateFromEpochDay, epochDayFromDate, localMidnightUtcMinutes, todayLocalDate } from "./lib/time.js";

/**
 * 予告を出すリードタイム(日)。基準日の何日前から予告を作るか。
 *
 * 判断点: 30日固定(設定UIは持たない)。「翌月分の勤怠・シフトを組む前に管理者が把握できる」
 * のに十分な長さで、かつ出勤率の参考値が古くなりすぎない範囲として選んだ。テナントごとに
 * 変えたい要望が出た時点で tenant_leave_settings に列を足す(それまで設定項目を増やさない)。
 */
const PROPOSAL_LEAD_TIME_DAYS = 30;

const NOTIFICATION_TYPE = "leave_grant_proposed";

/** 付与予告に使う権限(2段目の承認 API と同じキー)。 */
const GRANT_MANAGE_PERMISSION = "leave.grant.manage";

/**
 * 出勤率参考値を暦日から推定するときに除外する曜日(0=日曜、6=土曜)。
 *
 * 判断点: tenant_setting_versions は「法定休日の曜日」は持つが「週の非労働日(所定休日)」を
 * 持たない(packages/db/src/schema/settings.ts)。よって固定時間制・フレックスの分母は
 * 「土日を除く平日 − 法定休日の曜日」を既定の推定とする(週休2日制が現実の多数派であり、
 * 週6日勤務のテナントでは分母が過小=出勤率が過大に出る方向の誤差になる。basis に
 * "calendar_estimate" を立てることで「これは推定である」ことを UI と保存値の両方で明示する)。
 * 所定休日をテナント設定に持たせたら、ここを設定由来に置き換える。
 */
const DEFAULT_NON_WORKING_WEEKDAYS: readonly number[] = [0, 6];

export interface RunLeaveGrantProposalScanOptions {
  /** 現在時刻(UTC エポック分)。テストで固定できるよう明示的に渡す */
  nowMinutes: number;
  /** テナント共有 Webhook + テナント SMTP の構築に使う依存(shift-variance-alerts.ts と同じ契約) */
  notifyDeps?: BuildNotificationChannelsOptions;
}

export interface CreatedLeaveGrantProposal {
  proposal: LeaveGrantProposal;
  userName: string;
}

export interface RunLeaveGrantProposalScanResult {
  /** スキャン対象にした(is_active かつ入社日が設定されている)ユーザー数 */
  scannedUserCount: number;
  /** 新規作成された予告(既存の付与・既存の予告でスキップしたものは含まない) */
  created: CreatedLeaveGrantProposal[];
  /** 管理者向けに新規作成された通知(重複でスキップされたものは含まない) */
  notifications: Notification[];
}

interface ActiveUserWithHireDate {
  id: string;
  tenantId: string;
  name: string;
  hireDate: string | null;
  /** 有給付与の区分(比例付与、労基法39条3項)。想定外の値は "full" に倒して読む */
  leaveGrantClass: string;
}

/** is_active なユーザーを入社日・付与区分つきで返す(reminders.ts の listActiveUsers に足したもの)。 */
async function listActiveUsersWithHireDate(db: Database): Promise<ActiveUserWithHireDate[]> {
  return db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      name: users.name,
      hireDate: users.hireDate,
      leaveGrantClass: users.leaveGrantClass,
    })
    .from(users)
    .where(eq(users.isActive, true));
}

/**
 * users.leave_grant_class を LeaveGrantClass へ解決する。想定外の値は "full" に倒す
 * (少なく付与する方向へ倒さない — packages/leave/src/statutory.ts の判断点。
 * routes/leave.ts の同名ヘルパと同じ扱い)。
 */
function resolveLeaveGrantClass(value: string | null | undefined): LeaveGrantClass {
  return isLeaveGrantClass(value) ? value : "full";
}

/**
 * 出勤率の参考値を組み立てる(分母・分子の日付ファクトを DB から集め、計算自体は
 * @kizami/leave の純関数へ渡す)。
 *
 * 近似(参考値であることを踏まえた割り切り、完了報告に明記):
 * - 出勤日は「clock_in の打刻がある勤怠日」で数える。1年分の月次集計(calculate)を
 *   ユーザーごとに12回回すのは日次ジョブとして高価すぎるため、打刻を1回引いて
 *   勤怠日ごとにまとめる方式を採る(依頼の「punches grouped per 勤怠日 is fine」)。
 * - 勤怠日の解決に使う日界(dayBoundaryMinutes)は算定期間末日時点の版で固定する
 *   (期間中に日界設定が変わった場合、境界付近の打刻の帰属が1日ずれうる。参考値の
 *   精度としては許容)。
 */
async function buildAttendanceRateReference(
  db: Database,
  params: { tenantId: string; userId: string; hireDate: string; grantedOn: string },
): Promise<AttendanceRateReference> {
  const { tenantId, userId, hireDate, grantedOn } = params;
  const { periodFrom, periodTo } = resolveAttendanceRatePeriod(grantedOn, hireDate);

  if (periodFrom > periodTo) {
    // 入社日が基準日以降(通常は起きない)。分母が無いので rate=null の参考値を返す。
    return { periodFrom, periodTo, workingDays: 0, attendedDays: 0, rate: null, basis: "calendar_estimate" };
  }

  const settingsVersion = await getEffectiveSettingsVersion(db, { tenantId, onDate: periodTo });
  const dayBoundaryMinutes = settingsVersion?.dayBoundaryMinutes ?? 0;
  const legalHoliday = settingsVersion ? (JSON.parse(settingsVersion.legalHolidayRule) as LegalHolidayRule) : null;

  // 制度の判定。設定・制度割当が揃っていない期間では例外になりうるので、その場合は
  // 暦日推定へ倒す(参考値を出さないより、推定であることを明示して出す方が有用)。
  let isShiftBased = false;
  try {
    const timeline = await buildSettingsTimeline(db, { tenantId, userId, fromDate: periodFrom, toDate: periodTo });
    isShiftBased = resolveWorkSystemForDate(timeline, periodTo).kind === "monthly_variable";
  } catch {
    isShiftBased = false;
  }

  let basis: AttendanceRateReference["basis"] = "calendar_estimate";
  let workingDates: string[] = [];
  if (isShiftBased) {
    const shiftRows = await listValidShiftDaysInRange(db, { tenantId, userId, fromDate: periodFrom, toDate: periodTo });
    if (shiftRows.length > 0) {
      basis = "shift";
      workingDates = shiftRows.filter((row) => row.dayType === "work").map((row) => row.date);
    }
    // シフトが1件も無い期間(制度を切り替えた直後など)は暦日推定へフォールバックする
    // (basis はそのまま "calendar_estimate" — 依頼の「if no shifts at all → fall back and say so」)。
  }
  if (basis === "calendar_estimate") {
    const nonWorkingWeekdays = new Set<number>(DEFAULT_NON_WORKING_WEEKDAYS);
    if (legalHoliday && legalHoliday.kind === "weekday") nonWorkingWeekdays.add(legalHoliday.weekday);
    workingDates = estimateCalendarWorkingDates(periodFrom, periodTo, [...nonWorkingWeekdays]);
  }

  // 出勤日(打刻ベース)。日跨ぎ・日界の関係で前後1日ぶん余裕をとって引く(既存の
  // 月次集計と同じ流儀)。
  const fromMinutes = localMidnightUtcMinutes(epochDayFromDate(periodFrom) - 1, TZ_OFFSET_MINUTES_JST);
  const toMinutes = localMidnightUtcMinutes(epochDayFromDate(periodTo) + 2, TZ_OFFSET_MINUTES_JST) - 1;
  const punchRows = await listValidPunches(db, { tenantId, userId, fromMinutes, toMinutes });
  const attendedDates = new Set<string>();
  for (const punch of punchRows) {
    if (punch.kind !== "clock_in") continue;
    const localMinutes = punch.occurredAt + TZ_OFFSET_MINUTES_JST;
    const roughEpochDay = Math.floor(localMinutes / 1440);
    const minuteOfDay = localMinutes - roughEpochDay * 1440;
    const attendanceEpochDay = minuteOfDay >= dayBoundaryMinutes ? roughEpochDay : roughEpochDay - 1;
    attendedDates.add(dateFromEpochDay(attendanceEpochDay));
  }

  // 承認済みの休暇取得日は出勤扱い(年休取得日を出勤したものとみなす通達)。
  const approvedLeave = await listApprovedLeaveRequestsInRange(db, { tenantId, userId, fromDate: periodFrom, toDate: periodTo });

  return calculateAttendanceRate({
    periodFrom,
    periodTo,
    basis,
    workingDates,
    attendedDates: [...attendedDates],
    paidLeaveDates: approvedLeave.map((r) => r.leaveDate),
  });
}

interface ProposalItem {
  userId: string;
  userName: string;
  days: number;
}

interface ApproverBucket {
  tenantId: string;
  approverId: string;
  grantedOn: string;
  items: ProposalItem[];
}

function bucketKey(tenantId: string, approverId: string, grantedOn: string): string {
  return `${tenantId}:${approverId}:${grantedOn}`;
}

/** 管理者向けアプリ内通知の本文(対象者は管理者のスコープ内なので氏名を書いてよい)。 */
function buildApproverNotificationContent(items: ProposalItem[], grantedOn: string): { title: string; body: string } {
  const lines = items.map((item) => `- ${item.userName}: ${item.days}日`);
  return {
    title: `${grantedOn} の年次有給休暇付与の予告`,
    body: `${grantedOn} が基準日の年次有給休暇付与の予告があります。出勤率の参考値を確認して承認してください。\n${lines.join("\n")}`,
  };
}

/** テナント共有 Webhook 向けの本文(誰に何日、という個人の詳細は書かない)。 */
function buildTenantWebhookContent(grantedOn: string, memberCount: number): { title: string; body: string } {
  return {
    title: `${grantedOn} の年次有給休暇付与の予告`,
    body: `${grantedOn} が基準日の年次有給休暇付与の予告が ${memberCount} 件あります。管理画面で確認してください。`,
  };
}

/**
 * 有給付与の予告スキャンを1回実行する。
 *
 * 冪等: 既に leave_grants がある基準日、および superseded 以外の予告が既にある基準日は
 * 再提案しない(却下済みも「再提案しない」側 — packages/db/src/queries/leave.ts の
 * findActiveLeaveGrantProposal の判断点コメント参照)。同じ日に2回実行しても増えない。
 */
export async function runLeaveGrantProposalScan(
  db: Database,
  options: RunLeaveGrantProposalScanOptions,
): Promise<RunLeaveGrantProposalScanResult> {
  const { nowMinutes, notifyDeps } = options;
  const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
  const horizon = addDays(today, PROPOSAL_LEAD_TIME_DAYS);

  const activeUsers = (await listActiveUsersWithHireDate(db)).filter(
    (user): user is ActiveUserWithHireDate & { hireDate: string } => user.hireDate !== null,
  );

  // テナント単位の有給設定は全ユーザー共通なので1回だけ読む。
  const leaveSettingsCache = new Map<string, Awaited<ReturnType<typeof getTenantLeaveSettings>>>();
  const getLeaveSettings = async (tenantId: string) => {
    if (!leaveSettingsCache.has(tenantId)) {
      leaveSettingsCache.set(tenantId, await getTenantLeaveSettings(db, tenantId));
    }
    return leaveSettingsCache.get(tenantId) ?? null;
  };

  const created: CreatedLeaveGrantProposal[] = [];

  for (const user of activeUsers) {
    try {
      const settings = await getLeaveSettings(user.tenantId);
      // 有給設定が未構成のテナントは対象外(付与方式が決まっていないため予告できない)。
      if (!settings) continue;

      const calculated = calculateStatutoryGrants(
        user.hireDate,
        horizon,
        settings.grantMethod as GrantMethod,
        settings.fixedDateMmDd ?? undefined,
        resolveLeaveGrantClass(user.leaveGrantClass),
      );
      const upcoming = calculated.filter((g) => g.grantedOn >= today && g.grantedOn <= horizon);
      if (upcoming.length === 0) continue;

      const existingGrantDates = await listGrantedOnDates(db, { tenantId: user.tenantId, userId: user.id });

      for (const grant of upcoming) {
        if (existingGrantDates.has(grant.grantedOn)) continue;
        const existingProposal = await findActiveLeaveGrantProposal(db, {
          tenantId: user.tenantId,
          userId: user.id,
          leaveType: grant.leaveType,
          grantedOn: grant.grantedOn,
        });
        if (existingProposal) continue;

        const attendanceRate = await buildAttendanceRateReference(db, {
          tenantId: user.tenantId,
          userId: user.id,
          hireDate: user.hireDate,
          grantedOn: grant.grantedOn,
        });

        const proposal = await insertLeaveGrantProposal(db, {
          tenantId: user.tenantId,
          userId: user.id,
          leaveType: grant.leaveType,
          grantedOn: grant.grantedOn,
          days: grant.days,
          expiresOn: grant.expiresOn,
          attendanceRate: JSON.stringify(attendanceRate),
          proposedAt: nowMinutes,
        });
        created.push({ proposal, userName: user.name });
      }
    } catch {
      // ユーザー単位の失敗(設定不備・DB エラー等)で他のユーザーの処理を止めない
      // (reminders.ts / leave-alerts.ts と同じ方針)。
      continue;
    }
  }

  // ---- 管理者への通知(承認者×基準日で1件にまとめる) ----
  const approversCache = new Map<string, Promise<string[]>>();
  const getApprovers = (tenantId: string, subjectUserId: string): Promise<string[]> => {
    const key = `${tenantId}:${subjectUserId}`;
    let cached = approversCache.get(key);
    if (!cached) {
      cached = resolveApproversForUser(db, { tenantId, subjectUserId, permission: GRANT_MANAGE_PERMISSION });
      approversCache.set(key, cached);
    }
    return cached;
  };

  const buckets = new Map<string, ApproverBucket>();
  for (const { proposal, userName } of created) {
    const approverIds = await getApprovers(proposal.tenantId, proposal.userId);
    for (const approverId of approverIds) {
      const key = bucketKey(proposal.tenantId, approverId, proposal.grantedOn);
      const bucket = buckets.get(key) ?? {
        tenantId: proposal.tenantId,
        approverId,
        grantedOn: proposal.grantedOn,
        items: [],
      };
      bucket.items.push({ userId: proposal.userId, userName, days: proposal.days });
      buckets.set(key, bucket);
    }
  }

  const notifications: Notification[] = [];
  const newlyNotifiedByTenantDate = new Map<string, Set<string>>();

  for (const bucket of buckets.values()) {
    const { title, body } = buildApproverNotificationContent(bucket.items, bucket.grantedOn);
    const notification = await createNotificationIfAbsent(db, {
      tenantId: bucket.tenantId,
      userId: bucket.approverId,
      type: NOTIFICATION_TYPE,
      subjectDate: bucket.grantedOn,
      title,
      body,
      createdAt: nowMinutes,
    });
    if (notification === null) continue; // 同じ (tenant, approver, type, 基準日) の通知が既にある

    notifications.push(notification);
    const tenantDateKey = `${bucket.tenantId}:${bucket.grantedOn}`;
    const affected = newlyNotifiedByTenantDate.get(tenantDateKey) ?? new Set<string>();
    for (const item of bucket.items) affected.add(item.userId);
    newlyNotifiedByTenantDate.set(tenantDateKey, affected);
  }

  for (const [tenantDateKey, affectedUserIds] of newlyNotifiedByTenantDate) {
    const separatorIndex = tenantDateKey.indexOf(":");
    const tenantId = tenantDateKey.slice(0, separatorIndex);
    const grantedOn = tenantDateKey.slice(separatorIndex + 1);

    const channels = await buildTenantChannels(db, tenantId, notifyDeps ?? {});
    if (channels.length === 0) continue;
    const { title, body } = buildTenantWebhookContent(grantedOn, affectedUserIds.size);
    await dispatch(channels, { to: {}, title, body });
  }

  return { scannedUserCount: activeUsers.length, created, notifications };
}

/** テストや管理画面の文言合わせに使う定数の再公開(値の定義はこのファイル1箇所)。 */
export const LEAVE_GRANT_PROPOSAL_LEAD_TIME_DAYS = PROPOSAL_LEAD_TIME_DAYS;
export const LEAVE_GRANT_PROPOSAL_NOTIFICATION_TYPE = NOTIFICATION_TYPE;
