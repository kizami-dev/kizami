/**
 * シフト予実乖離の日次通知スキャン本体(docs/design/shift-work.md 決定事項4)。
 *
 * 打刻忘れリマインド(reminders.ts)と同じ「DB の定期スキャンで検知し、engine の警告を
 * 再利用する」設計を踏襲する。対象は monthly_variable ユーザーの `EngineOutput.warnings` に
 * 含まれるシフト予実乖離の5種(missing_shift・shift_late_arrival・shift_early_leave・
 * shift_unplanned_work・shift_absence、packages/engine/src/shift-variance.ts)のうち、
 * その勤怠日が既に終了している(日界を過ぎている)ものだけ。
 *
 * 通知の宛先・チャネル(決定事項4「今回はアプリ内通知+テナント共有 Webhook のみ」— 個人
 * チャネル配信は次フェーズ):
 * - 乖離のあった本人**ではなく**、その人をスコープに含む形で SHIFT_MANAGE_PERMISSION
 *   (routes/settings/permissions.ts、シフト管理に流用している既存の
 *   attendance.correction.approve)を保持する承認権限者へ通知する
 *   (apps/api/src/lib/approvers.ts の resolveApproversForUser を再利用)。
 * - 同じ承認者が同じ日に複数メンバーの乖離を検知した場合、承認者・日付ごとに1件へ
 *   まとめる(notifications テーブルの UNIQUE(tenant_id, user_id, type, subject_date) が
 *   そのまま「承認者×日付で1件」の器になる — user_id はここでは「承認者」を指す)。
 * - 個人チャネル(user_notification_settings)へは配信しない。アプリ内通知(常時ON)に加えて、
 *   テナント共有 Webhook(buildTenantChannels)へも、新規作成できた通知が1件以上あった
 *   テナント・日付についてまとめて1件通知する。テナント共有チャネルへ流す文面は「乖離が
 *   何件あるか」までに留め、誰の・どんな乖離かという個人の勤怠詳細は書かない
 *   (apps/api/src/lib/notification-channels.ts の設計原則を踏襲)。
 *
 * BullMQ/Valkey には一切依存しない(reminders.ts と同じ)。
 */

import { createNotificationIfAbsent, type Database, type Notification } from "@kizami/db";
import type { WarningKind } from "@kizami/engine";
import { dispatch } from "@kizami/notify";
import { resolveApproversForUser } from "./lib/approvers.js";
import { getOrBuildTenantMonthlyContext, type TenantMonthlyContextCache } from "./lib/closing-amend.js";
import { buildTenantChannels, type BuildNotificationChannelsOptions } from "./lib/notification-channels.js";
import { SHIFT_MANAGE_PERMISSION } from "./routes/settings/permissions.js";
import {
  attendanceDayEndUtcMinutes,
  calculateMonthlyForUser,
  listActiveUsers,
  resolveTargetMonths,
  settingsForDate,
  type ActiveUserRow,
} from "./reminders.js";

const NOTIFICATION_TYPE = "shift_variance_alert";

/** EngineOutput.warnings のうち、シフト予実乖離を表す種別(packages/engine/src/shift-variance.ts)。 */
const SHIFT_VARIANCE_WARNING_KINDS: ReadonlySet<WarningKind> = new Set([
  "missing_shift",
  "shift_late_arrival",
  "shift_early_leave",
  "shift_unplanned_work",
  "shift_absence",
]);

const WARNING_KIND_LABEL_JA: Readonly<Record<string, string>> = {
  missing_shift: "シフト未登録なのに勤務あり",
  shift_late_arrival: "遅刻",
  shift_early_leave: "早退",
  shift_unplanned_work: "予定外勤務",
  shift_absence: "欠勤の可能性",
};

export interface RunShiftVarianceAlertScanOptions {
  /** 現在時刻(UTC エポック分)。テストで固定できるよう明示的に渡す */
  nowMinutes: number;
  /**
   * テナント共有 Webhook + テナント SMTP の構築に使う依存(apps/api/src/lib/
   * notification-channels.ts の buildTenantChannels にそのまま渡す)。省略時はテナント設定に
   * webhook/smtp が無い限りチャネルが組み立たず、実質アプリ内通知のみになる。
   */
  notifyDeps?: BuildNotificationChannelsOptions;
}

export interface CreatedShiftVarianceAlert {
  notification: Notification;
}

export interface RunShiftVarianceAlertScanResult {
  /** スキャン対象にした(is_active な)ユーザー数 */
  scannedUserCount: number;
  /** 新規作成された通知(承認者×日付単位、重複でスキップされたものは含まない) */
  created: CreatedShiftVarianceAlert[];
}

interface VarianceItem {
  subjectUserId: string;
  subjectUserName: string;
  kind: WarningKind;
}

interface ApproverDateBucket {
  tenantId: string;
  approverId: string;
  date: string;
  items: VarianceItem[];
}

function bucketKey(tenantId: string, approverId: string, date: string): string {
  return `${tenantId}:${approverId}:${date}`;
}

/** 承認者向けアプリ内通知の本文(誰の・どんな乖離かを列挙する — 承認者は元々スコープ内の管理対象者)。 */
function buildApproverNotificationContent(items: VarianceItem[], date: string): { title: string; body: string } {
  const lines = items.map((item) => `- ${item.subjectUserName}: ${WARNING_KIND_LABEL_JA[item.kind] ?? item.kind}`);
  return {
    title: `${date} のシフト予実に乖離があります`,
    body: `${date} に以下のシフト予実の乖離が検知されました。内容を確認してください。\n${lines.join("\n")}`,
  };
}

/**
 * テナント共有 Webhook 向けの本文。個人の勤怠詳細(誰が・どんな乖離か)は書かない
 * (ファイル冒頭コメントの設計原則)。
 */
function buildTenantWebhookContent(date: string, affectedUserCount: number): { title: string; body: string } {
  return {
    title: `${date} のシフト予実乖離`,
    body: `${date} に ${affectedUserCount} 名のシフト予実乖離が検知されました。管理画面で確認してください。`,
  };
}

/**
 * シフト予実乖離の日次通知スキャンを1回実行する。
 *
 * - 全テナントの is_active なユーザーについて、当月(+ 月初なら前月)の calculate() を回す
 *   (reminders.ts と同じ対象月の決め方)
 * - workSystem が monthly_variable のユーザーのみ対象(それ以外は shifts/shift-variance の
 *   警告が発生しないため計算後に自然にスキップされる)
 * - シフト予実乖離5種の警告のうち、その勤怠日が既に終了しているものだけを対象にする
 * - 承認者(SHIFT_MANAGE_PERMISSION を保持しスコープに対象者を含む人)ごとに、同日の乖離を
 *   1件のアプリ内通知にまとめる(createNotificationIfAbsent で冪等)
 * - 新規作成できた通知が1件以上あったテナント・日付について、テナント共有 Webhook へも
 *   まとめて1件通知する
 */
export async function runShiftVarianceAlertScan(
  db: Database,
  options: RunShiftVarianceAlertScanOptions,
): Promise<RunShiftVarianceAlertScanResult> {
  const { nowMinutes, notifyDeps } = options;
  const targetMonths = resolveTargetMonths(nowMinutes);
  const activeUsers: ActiveUserRow[] = await listActiveUsers(db);

  const tenantContextCache: TenantMonthlyContextCache = new Map();
  // subjectUser(tenantId:userId)ごとの承認者一覧を使い回す(同一ユーザーが複数日・複数種別の
  // 乖離を持っても resolveApproversForUser を複数回呼ばない)。
  const approversCache = new Map<string, Promise<string[]>>();
  const getApprovers = (tenantId: string, subjectUserId: string): Promise<string[]> => {
    const key = `${tenantId}:${subjectUserId}`;
    let cached = approversCache.get(key);
    if (!cached) {
      cached = resolveApproversForUser(db, { tenantId, subjectUserId, permission: SHIFT_MANAGE_PERMISSION });
      approversCache.set(key, cached);
    }
    return cached;
  };

  const buckets = new Map<string, ApproverDateBucket>();

  for (const user of activeUsers) {
    for (const { year, month } of targetMonths) {
      let result: Awaited<ReturnType<typeof calculateMonthlyForUser>>;
      try {
        const tenantContext = await getOrBuildTenantMonthlyContext(tenantContextCache, db, { tenantId: user.tenantId, year, month });
        result = await calculateMonthlyForUser(db, { tenantId: user.tenantId, userId: user.id, year, month }, tenantContext);
      } catch {
        // テナント設定・制度割当が揃っていないユーザー/月はスキップ(reminders.ts と同じ方針)。
        continue;
      }
      const { output, settingsTimeline } = result;
      if (output.workSystem !== "monthly_variable") continue;

      for (const warning of output.warnings) {
        if (!SHIFT_VARIANCE_WARNING_KINDS.has(warning.kind)) continue;

        const settings = settingsForDate(warning.date, settingsTimeline);
        const dayEnd = attendanceDayEndUtcMinutes(warning.date, settings);
        if (dayEnd > nowMinutes) continue; // 当日進行中(まだ日界を過ぎていない)は対象外

        const approverIds = (await getApprovers(user.tenantId, user.id)).filter((id) => id !== user.id);
        for (const approverId of approverIds) {
          const key = bucketKey(user.tenantId, approverId, warning.date);
          const bucket = buckets.get(key) ?? { tenantId: user.tenantId, approverId, date: warning.date, items: [] };
          bucket.items.push({ subjectUserId: user.id, subjectUserName: user.name, kind: warning.kind });
          buckets.set(key, bucket);
        }
      }
    }
  }

  const created: CreatedShiftVarianceAlert[] = [];
  // 新規作成できた通知があった (tenantId, date) → その日にテナント共有 Webhook へ通知するため、
  // 対象者(重複除く)の人数を集計する。
  const newlyNotifiedByTenantDate = new Map<string, Set<string>>();

  for (const bucket of buckets.values()) {
    const { title, body } = buildApproverNotificationContent(bucket.items, bucket.date);
    const notification = await createNotificationIfAbsent(db, {
      tenantId: bucket.tenantId,
      userId: bucket.approverId,
      type: NOTIFICATION_TYPE,
      subjectDate: bucket.date,
      title,
      body,
      createdAt: nowMinutes,
    });
    if (notification === null) continue; // 既に同じ (tenant, approver, type, date) の通知がある(重複)

    created.push({ notification });
    const tenantDateKey = `${bucket.tenantId}:${bucket.date}`;
    const affected = newlyNotifiedByTenantDate.get(tenantDateKey) ?? new Set<string>();
    for (const item of bucket.items) affected.add(item.subjectUserId);
    newlyNotifiedByTenantDate.set(tenantDateKey, affected);
  }

  for (const [tenantDateKey, affectedUserIds] of newlyNotifiedByTenantDate) {
    const separatorIndex = tenantDateKey.indexOf(":");
    const tenantId = tenantDateKey.slice(0, separatorIndex);
    const date = tenantDateKey.slice(separatorIndex + 1);

    const channels = await buildTenantChannels(db, tenantId, notifyDeps ?? {});
    if (channels.length === 0) continue;
    const { title, body } = buildTenantWebhookContent(date, affectedUserIds.size);
    await dispatch(channels, { to: {}, title, body });
  }

  return { scannedUserCount: activeUsers.length, created };
}
