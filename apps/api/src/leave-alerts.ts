/**
 * 有給休暇の「失効間近」「年5日取得義務の期限接近」を本人に通知する定期スキャン。
 *
 * 目的(docs/requirements.md 外、依頼時点の決定事項): 従業員が制度を知らないことで
 * 損をするのを防ぐ。残高・年5日不足の計算は再実装しない — @kizami/leave の
 * calculateBalance / checkMandatoryFiveDays と、apps/api/src/routes/leave.ts の
 * loadBalanceContext(GET /leave/balance と同一の組み立て)をそのまま再利用する。
 *
 * 通知は本人のみ(上長通知は権限・スコープの設計が別途必要なためスコープ外)。
 *
 * 通知種別(4種、すべて notifications テーブル・UNIQUE(tenant_id, user_id, type, subject_date)
 * による重複防止に乗せる。段階を type に含めることで同じ付与/期間でも段階ごとに別の通知になる):
 * - `leave_expiring_60d` / `_30d` / `_7d`: 有給(annual)・積立(stocked)休暇の失効間近。
 *   残っている(remainingMinutes > 0 かつ未失効)付与のみ対象。subject_date は付与の失効日
 *   (leave_grants.expires_on)。annual 付与かつテナントの積立振替が有効な場合、本文に
 *   「失効分は積立休暇に振り替えられます」を添える(stocked 付与自体は失効しても
 *   さらに積立へは振り替わらないため、この案内は annual 付与のときだけ付ける)。
 * - `leave_mandatory5_90d` / `_30d`: 年5日取得義務の期限接近。不足(shortage > 0)がある
 *   対象のみ。subject_date は対象期間の期限日(checkMandatoryFiveDays の deadline = periodEnd)。
 *   本文に法的な注意(半休は0.5日算入可・時間単位年休は算入不可)を必ず入れる。
 *
 * 段階判定(判断点、要件に明記が無い箇所への実装決定):
 * - 要件「通知が出るのはその段階を初めて過ぎたとき」「過ぎた段階を遡って出さない」を、
 *   打刻忘れリマインド・36協定アラートと同じ「DB の定期スキャンのみに依存し、前回スキャン時点の
 *   状態を持たない自己修復設計」の中で実現する必要がある。日単位でカウントダウンする値
 *   (失効日までの残日数)は1日ごとに1ずつ減るため、「初めて閾値を過ぎた日」は
 *   「残日数がちょうどその閾値と一致する日」と等価になる。よって:
 *   - 各段階のうち最も緩い(数字が大きい)ものたちは**残日数がちょうど閾値と一致する日**だけ
 *     発火する(60d/30d/90dなど)。スキャンがその1日を逃す(ワーカー停止・初回スキャンが
 *     それより後 等)と、その段階の通知は二度と出ない(遡って出さない、要件通り)。
 *   - 各段階のうち最も厳しい(数字が最小、失効/期限に最も近い)ものだけは**残日数が閾値
 *     「以下」**で発火するキャッチオールにする(7d, 30d)。これより後ろに段階が無いため、
 *     ちょうどの日を逃しても最後の警告だけは確実に届ける(要件の「7日前を過ぎてから初回
 *     スキャン」の例と一致させるための設計)。
 * - 積立(stocked)付与も失効間近の対象に含める(要件は「残がある付与のみ」とだけ述べ、
 *   leaveType を限定していない。stocked 付与はテナント設定で無期限[9999-12-31]になり得るが、
 *   stockExpiresMonths が設定されていれば実際に失効しうるため、対象から除外する理由がない)。
 * - ユーザー単位の失敗は握りつぶして他のユーザーの処理を止めない(reminders.ts と同じ方針)
 * - 外部チャネル送信は「新規に作成できた通知」だけに行う(reminders.ts と同じ)
 *
 * BullMQ/Valkey には一切依存しない(node:* も使わない)。
 */

import { createNotificationIfAbsent, type Database, type Notification } from "@kizami/db";
import { calculateBalance, checkMandatoryFiveDays, type GrantAllocationState } from "@kizami/leave";
import { dispatch, type DispatchResult, type NotificationChannel } from "@kizami/notify";
import { loadBalanceContext } from "./routes/leave.js";
import { listActiveUsers } from "./reminders.js";
import { epochDayFromDate } from "./lib/time.js";

/** 失効間近: 緩い→厳しいの順(降順)。末尾(7)だけキャッチオール(以下判定)。 */
const EXPIRING_STAGE_DAYS = [60, 30, 7] as const;
/** 年5日取得義務: 緩い→厳しいの順(降順)。末尾(30)だけキャッチオール(以下判定)。 */
const MANDATORY_FIVE_STAGE_DAYS = [90, 30] as const;

export interface RunLeaveAlertScanOptions {
  /** 現在時刻(UTC エポック分)。テストで固定できるよう明示的に渡す */
  nowMinutes: number;
  /**
   * テナントIDを受け取り、そのテナントの外部チャネル(新規作成できた通知だけに送る)を
   * 返す。省略時はアプリ内通知のみ。reminders.ts の runReminderScan と同じ契約。
   */
  resolveChannels?: (tenantId: string) => Promise<NotificationChannel[]>;
}

export interface CreatedLeaveAlert {
  notification: Notification;
  dispatchResults: DispatchResult[];
}

export interface RunLeaveAlertScanResult {
  /** スキャン対象にした(is_active な)ユーザー数 */
  scannedUserCount: number;
  /** 新規作成された通知(重複でスキップされたものは含まない) */
  created: CreatedLeaveAlert[];
}

/**
 * 残日数(daysRemaining)から、今回のスキャンで発火すべき段階を判定する。
 *
 * thresholdsLooseToTight は緩い(数字が大きい)順。末尾(最も厳しい段階)だけ
 * 「残日数 <= 閾値」(キャッチオール)で判定し、それ以外は「残日数 == 閾値」
 * (ちょうどその日だけ)で判定する。該当する段階が無ければ null。
 *
 * ファイル冒頭のコメント「段階判定」を参照(要件の「遡って出さない」「直近の段階のみ出す」を
 * 満たすための実装)。
 */
function resolveDueStage(daysRemaining: number, thresholdsLooseToTight: readonly number[]): number | null {
  for (let i = 0; i < thresholdsLooseToTight.length; i++) {
    const threshold = thresholdsLooseToTight[i] as number;
    const isTightest = i === thresholdsLooseToTight.length - 1;
    if (isTightest) {
      if (daysRemaining >= 0 && daysRemaining <= threshold) return threshold;
    } else if (daysRemaining === threshold) {
      return threshold;
    }
  }
  return null;
}

/** 分を「◯日◯時間」形式にする(表示用)。standardDayMinutes で日数に換算し、余りを時間に換算する(端数の分は切り捨てる)。 */
function formatDaysAndHours(minutes: number, standardDayMinutes: number): string {
  const days = Math.floor(minutes / standardDayMinutes);
  const remainderMinutes = minutes - days * standardDayMinutes;
  const hours = Math.floor(remainderMinutes / 60);
  return `${days}日${hours}時間`;
}

function expiringNotificationContent(params: {
  leaveTypeLabel: string;
  remainingMinutes: number;
  standardDayMinutes: number;
  expiresOn: string;
  includeStockConversionNote: boolean;
}): { title: string; body: string } {
  const { leaveTypeLabel, remainingMinutes, standardDayMinutes, expiresOn, includeStockConversionNote } = params;
  const amount = formatDaysAndHours(remainingMinutes, standardDayMinutes);
  const stockNote = includeStockConversionNote ? "失効分は積立休暇に振り替えられます。" : "";
  return {
    title: `${leaveTypeLabel}が失効間近です`,
    body: `${leaveTypeLabel}の${amount}分が${expiresOn}に失効します。${stockNote}`,
  };
}

function mandatoryFiveDaysNotificationContent(params: {
  shortageDays: number;
  takenDays: number;
  requiredDays: number;
  deadline: string;
}): { title: string; body: string } {
  const { shortageDays, takenDays, requiredDays, deadline } = params;
  return {
    title: "年5日の年次有給休暇取得義務の期限が近づいています",
    body: `年5日の年次有給休暇取得義務まであと${shortageDays}日(期限 ${deadline})です。現在の取得日数は${takenDays}日、必要日数は${requiredDays}日です。半休は0.5日として数えられますが、時間単位の取得は含められません。`,
  };
}

/** 失効間近アラート: annual/stocked 双方の付与を対象に、残がある(未失効)ものだけを見る。 */
async function scanExpiringGrants(
  db: Database,
  params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    ctx: Awaited<ReturnType<typeof loadBalanceContext>>;
    stockConversionEnabled: boolean;
    nowMinutesValue: number;
    channels: NotificationChannel[];
    created: CreatedLeaveAlert[];
  },
): Promise<void> {
  const { tenantId, userId, userEmail, ctx, stockConversionEnabled, nowMinutesValue, channels, created } = params;

  const balance = calculateBalance(ctx.grants, ctx.approvedUsages, {
    standardDayMinutes: ctx.currentStandardDayMinutes,
    hourlyLeaveMaxDays: ctx.settings.hourlyLeaveMaxDays,
    asOf: ctx.today,
  });

  const allGrantStates: GrantAllocationState[] = [...balance.annual.byGrant, ...balance.stocked.byGrant];
  const todayEpochDay = epochDayFromDate(ctx.today);

  for (const grant of allGrantStates) {
    if (grant.expired || grant.remainingMinutes <= 0) continue;

    const daysRemaining = epochDayFromDate(grant.expiresOn) - todayEpochDay;
    const stage = resolveDueStage(daysRemaining, EXPIRING_STAGE_DAYS);
    if (stage === null) continue;

    const leaveTypeLabel = grant.leaveType === "annual" ? "有給休暇" : "積立休暇";
    const includeStockConversionNote = grant.leaveType === "annual" && stockConversionEnabled;
    const { title, body } = expiringNotificationContent({
      leaveTypeLabel,
      remainingMinutes: grant.remainingMinutes,
      standardDayMinutes: ctx.currentStandardDayMinutes,
      expiresOn: grant.expiresOn,
      includeStockConversionNote,
    });

    const notification = await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: `leave_expiring_${stage}d`,
      subjectDate: grant.expiresOn,
      title,
      body,
      createdAt: nowMinutesValue,
    });
    if (notification === null) continue;

    const dispatchResults =
      channels.length > 0 ? await dispatch(channels, { to: { email: userEmail }, title, body }) : [];
    created.push({ notification, dispatchResults });
  }
}

/** 年5日取得義務アラート: 不足(shortage > 0)がある期間のみを対象にする。 */
async function scanMandatoryFiveDays(
  db: Database,
  params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    ctx: Awaited<ReturnType<typeof loadBalanceContext>>;
    nowMinutesValue: number;
    channels: NotificationChannel[];
    created: CreatedLeaveAlert[];
  },
): Promise<void> {
  const { tenantId, userId, userEmail, ctx, nowMinutesValue, channels, created } = params;

  const statuses = checkMandatoryFiveDays(ctx.grants, ctx.approvedUsages, ctx.today);
  const todayEpochDay = epochDayFromDate(ctx.today);

  for (const status of statuses) {
    if (status.satisfied || status.shortage <= 0) continue;

    const daysRemaining = epochDayFromDate(status.deadline) - todayEpochDay;
    const stage = resolveDueStage(daysRemaining, MANDATORY_FIVE_STAGE_DAYS);
    if (stage === null) continue;

    const { title, body } = mandatoryFiveDaysNotificationContent({
      shortageDays: status.shortage,
      takenDays: status.taken,
      requiredDays: status.required,
      deadline: status.deadline,
    });

    const notification = await createNotificationIfAbsent(db, {
      tenantId,
      userId,
      type: `leave_mandatory5_${stage}d`,
      subjectDate: status.deadline,
      title,
      body,
      createdAt: nowMinutesValue,
    });
    if (notification === null) continue;

    const dispatchResults =
      channels.length > 0 ? await dispatch(channels, { to: { email: userEmail }, title, body }) : [];
    created.push({ notification, dispatchResults });
  }
}

/**
 * 有給の失効間近・年5日取得義務の期限接近を本人に通知する定期スキャンを1回実行する。
 *
 * 全テナントの is_active なユーザーについて、loadBalanceContext(GET /leave/balance と同じ
 * 組み立て)で残高・年5日状況を取得し、失効間近(annual/stocked 双方)・年5日不足の各段階を
 * 判定する。createNotificationIfAbsent で通知を作成する(重複は UNIQUE 制約で自動的に
 * スキップされる、冪等)。ユーザー単位の失敗(有給設定未構成など)は握りつぶして他のユーザーの
 * 処理を止めない。
 *
 * BullMQ/Valkey などスケジューラの実体には一切依存しない。
 */
export async function runLeaveAlertScan(db: Database, options: RunLeaveAlertScanOptions): Promise<RunLeaveAlertScanResult> {
  const { nowMinutes: nowMinutesValue, resolveChannels } = options;
  const activeUsers = await listActiveUsers(db);

  const created: CreatedLeaveAlert[] = [];

  for (const user of activeUsers) {
    try {
      const channels = resolveChannels ? await resolveChannels(user.tenantId) : [];
      const ctx = await loadBalanceContext(db, user.tenantId, user.id);

      await scanExpiringGrants(db, {
        tenantId: user.tenantId,
        userId: user.id,
        userEmail: user.email,
        ctx,
        stockConversionEnabled: ctx.settings.stockConversionEnabled,
        nowMinutesValue,
        channels,
        created,
      });

      await scanMandatoryFiveDays(db, {
        tenantId: user.tenantId,
        userId: user.id,
        userEmail: user.email,
        ctx,
        nowMinutesValue,
        channels,
        created,
      });
    } catch {
      // ユーザー単位の予期しない失敗(有給設定未構成・DB エラー等)で他のユーザーの処理を
      // 止めない(reminders.ts / overtime-alerts.ts と同じ方針)
      continue;
    }
  }

  return { scannedUserCount: activeUsers.length, created };
}
