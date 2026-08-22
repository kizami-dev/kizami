/**
 * 打刻忘れ(退勤)リマインドの定期スキャン本体。
 *
 * 設計方針(要件定義 依頼時点の決定事項、変更しないこと):
 * - 検知は DB の定期スキャン。打刻ごとのジョブ予約はしない(キューの永続性に正しさを依存させず、
 *   途中でジョブを取りこぼしても次回スキャンで自己修復する)
 * - 検知は engine の警告を再利用する。各ユーザーについて calculate() を回し、
 *   `missing_clock_out` 警告のうち、その勤怠日が既に終了している(日界を過ぎている)ものだけを
 *   対象にする(当日進行中の勤務は対象外)
 * - 出勤忘れは検知しない(稼働日カレンダー未実装のため誤検知になる)
 * - 通知はアプリ内通知(notifications テーブル)が既定。外部チャネル(メール/Webhook)は
 *   「新規に作成できた通知」だけに送る(= 重複防止と同じ判定を外部送信のガードにも流用する)
 * - 外部チャネルはテナントごとに異なりうる(tenant_notification_settings)。呼び出し元が
 *   `resolveChannels(tenantId)` を渡すことで、ユーザーごとに所属テナントの設定へ差し替える
 *   (このファイル自体は DB の tenant_notification_settings を一切知らない — 組み立ては
 *   apps/api/src/lib/notification-channels.ts + 呼び出し元の責務)
 *
 * BullMQ/Valkey には一切依存しない(node:* も使わない)。呼び出し元(src/worker.ts、将来の
 * Cloudflare Cron エントリ)がキュー層・スケジューラ層を差し替えられるよう、
 * このファイルは「DB を受け取ってスキャンする」ピュアな関数として独立させている。
 */

import { eq } from "drizzle-orm";
import { createNotificationIfAbsent, listValidPunches, users, type Database, type Notification } from "@kizami/db";
import { calculate, type CalcSettings, type EngineInput, type PunchKind, type SettingsSpan, type ValidPunch } from "@kizami/engine";
import { dispatch, type DispatchResult, type NotificationChannel } from "@kizami/notify";
import { buildSettingsTimeline, TZ_OFFSET_MINUTES_JST } from "./lib/settings.js";
import { dateFromEpochDay, daysInMonth, epochDayFromDate, formatDate, localMidnightUtcMinutes } from "./lib/time.js";

const MINUTES_PER_DAY = 1440;
const NOTIFICATION_TYPE_MISSING_CLOCK_OUT = "missing_clock_out";

/**
 * 月初何日以内なら前月もスキャン対象に含めるか。月をまたいだ直後、前月末の打刻忘れが
 * 「もう当月ではない」という理由だけで見逃されないようにするための猶予日数。
 */
const PREVIOUS_MONTH_LOOKBACK_DAYS = 3;

export interface RunReminderScanOptions {
  /** 現在時刻(UTC エポック分)。テストで固定できるよう明示的に渡す */
  nowMinutes: number;
  /**
   * テナントIDを受け取り、そのテナントの外部チャネル(新規作成できた通知だけに送る)を
   * 返す。省略時はアプリ内通知のみ(既定挙動、どの通知も外部送信しない)。
   * スキャン対象ユーザー1人につき1回呼ばれる(同一テナントに複数ユーザーがいれば複数回)。
   * DB 設定の再取得コストが気になる場合は呼び出し側でテナントIDをキーにメモ化すること
   * (apps/api/src/worker.ts の実装を参照)。
   */
  resolveChannels?: (tenantId: string) => Promise<NotificationChannel[]>;
}

export interface CreatedReminder {
  notification: Notification;
  dispatchResults: DispatchResult[];
}

export interface RunReminderScanResult {
  /** スキャン対象にした(is_active な)ユーザー数 */
  scannedUserCount: number;
  /** 新規作成された通知(重複でスキップされたものは含まない) */
  created: CreatedReminder[];
}

interface TargetMonth {
  year: number;
  month: number;
}

/**
 * スキャン対象月を決める: 当月 + (月初 PREVIOUS_MONTH_LOOKBACK_DAYS 日以内なら)前月。
 * 「当月」の判定は他の月次集計と同じ固定 JST オフセットで行う(テナント別 TZ は v1.0 以降)。
 */
function resolveTargetMonths(nowMinutes: number): TargetMonth[] {
  const localMinutes = nowMinutes + TZ_OFFSET_MINUTES_JST;
  const todayEpochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const today = dateFromEpochDay(todayEpochDay);
  const parts = today.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;

  const months: TargetMonth[] = [{ year, month }];
  if (day <= PREVIOUS_MONTH_LOOKBACK_DAYS) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    months.push({ year: prevYear, month: prevMonth });
  }
  return months;
}

/**
 * timeline(SettingsSpan[])の中から、指定ローカル日付に有効な最新版を返す。
 *
 * packages/engine にも同等のロジック(src/date.ts の findSettingsForDate)があるが、
 * engine の内部モジュールはパッケージの公開 API(exports の ".")に含まれず import できないため
 * (apps/api/src/routes/attendance.ts の resolveTodayWindow と同じ事情)、ここに最小限で複製する。
 */
function settingsForDate(date: string, timeline: SettingsSpan[]): CalcSettings {
  let chosen: SettingsSpan | undefined;
  for (const span of timeline) {
    if (span.from <= date && (chosen === undefined || span.from > chosen.from)) {
      chosen = span;
    }
  }
  if (!chosen) {
    throw new Error(`no settings resolvable at ${date}`);
  }
  return chosen.settings;
}

/** 勤怠日 `date` の終端(翌日の日界, 排他)を UTC エポック分で返す。 */
function attendanceDayEndUtcMinutes(date: string, settings: CalcSettings): number {
  const epochDay = epochDayFromDate(date);
  return localMidnightUtcMinutes(epochDay + 1, settings.tzOffsetMinutes) + settings.dayBoundaryMinutes;
}

export interface ActiveUserRow {
  id: string;
  tenantId: string;
  email: string;
  name: string;
}

/**
 * is_active なユーザーを全テナント横断で走査する。
 *
 * apps/api/src/overtime-alerts.ts からも再利用する(「全テナントの is_active ユーザーを
 * 走査する」対象集合は打刻忘れリマインドと36協定アラートで完全に同一であるため)。
 */
export async function listActiveUsers(db: Database): Promise<ActiveUserRow[]> {
  const rows = await db
    .select({ id: users.id, tenantId: users.tenantId, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.isActive, true));
  return rows;
}

export interface MonthlyCalcResult {
  output: ReturnType<typeof calculate>;
  settingsTimeline: SettingsSpan[];
}

/**
 * 1人・1ヶ月分の EngineInput を組み立てて calculate() する(GET /attendance/monthly と同じ手順)。
 *
 * apps/api/src/overtime-alerts.ts からも再利用する(36協定アラートも「1人・1ヶ月分の
 * calculate() 結果」を土台にする点は打刻忘れリマインドと同じであるため、月次集計の
 * 組み立てロジックを二重管理しない)。
 */
export async function calculateMonthlyForUser(
  db: Database,
  params: { tenantId: string; userId: string; year: number; month: number },
): Promise<MonthlyCalcResult> {
  const { tenantId, userId, year, month } = params;
  const tz = TZ_OFFSET_MINUTES_JST;

  const monthStartEpochDay = epochDayFromDate(formatDate(year, month, 1));
  const monthEndEpochDay = monthStartEpochDay + daysInMonth(year, month) - 1;
  const monthStartDate = dateFromEpochDay(monthStartEpochDay);
  const monthEndDate = dateFromEpochDay(monthEndEpochDay);

  // 月初日界の前後1日のはみ出しを含めて有効打刻を取得する(attendance.ts /monthly と同じ余裕幅)
  const fromMinutes = localMidnightUtcMinutes(monthStartEpochDay - 1, tz);
  const toMinutes = localMidnightUtcMinutes(monthEndEpochDay + 2, tz) - 1;

  const [punchRows, settingsTimeline] = await Promise.all([
    listValidPunches(db, { tenantId, userId, fromMinutes, toMinutes }),
    buildSettingsTimeline(db, { tenantId, userId, fromDate: monthStartDate, toDate: monthEndDate }),
  ]);

  const punches: ValidPunch[] = punchRows.map((p) => ({ kind: p.kind as PunchKind, occurredAt: p.occurredAt }));

  const input: EngineInput = {
    punches,
    settingsTimeline,
    period: { year, month },
    paidLeave: [],
  };

  return { output: calculate(input), settingsTimeline };
}

function missingClockOutNotificationContent(date: string): { title: string; body: string } {
  return {
    title: "退勤打刻の記録がありません",
    body: `${date} の退勤打刻が記録されていません。心当たりがない場合は修正申請から追加してください。`,
  };
}

/**
 * 打刻忘れ(退勤)リマインドの定期スキャンを1回実行する。
 *
 * - 全テナントの is_active なユーザーについて、当月(+ 月初なら前月)の calculate() を回す
 * - `missing_clock_out` 警告のうち、その勤怠日が既に終了している(日界を過ぎている)ものだけを対象にする
 * - createNotificationIfAbsent で通知を作成する(重複は自動的にスキップされる、冪等)
 * - 新規作成できた通知だけを channels へ dispatch する(重複時は外部へも再送しない)
 *
 * BullMQ/Valkey・Cloudflare Queues などスケジューラの実体には一切依存しない。
 */
export async function runReminderScan(db: Database, options: RunReminderScanOptions): Promise<RunReminderScanResult> {
  const { nowMinutes, resolveChannels } = options;
  const targetMonths = resolveTargetMonths(nowMinutes);
  const activeUsers = await listActiveUsers(db);

  const created: CreatedReminder[] = [];

  for (const user of activeUsers) {
    const channels = resolveChannels ? await resolveChannels(user.tenantId) : [];

    for (const { year, month } of targetMonths) {
      let result: MonthlyCalcResult;
      try {
        result = await calculateMonthlyForUser(db, { tenantId: user.tenantId, userId: user.id, year, month });
      } catch {
        // テナント設定・制度割当がまだ揃っていないユーザー/月はスキャン対象外として静かにスキップする
        // (未設定は他のエンドポイントでも起こりうる状態であり、リマインドスキャン全体を落とす理由にはしない)
        continue;
      }
      const { output, settingsTimeline } = result;

      for (const warning of output.warnings) {
        if (warning.kind !== NOTIFICATION_TYPE_MISSING_CLOCK_OUT) continue;

        const settings = settingsForDate(warning.date, settingsTimeline);
        const dayEnd = attendanceDayEndUtcMinutes(warning.date, settings);
        if (dayEnd > nowMinutes) {
          // 当日進行中(まだ日界を過ぎていない)は対象外
          continue;
        }

        const { title, body } = missingClockOutNotificationContent(warning.date);
        const notification = await createNotificationIfAbsent(db, {
          tenantId: user.tenantId,
          userId: user.id,
          type: NOTIFICATION_TYPE_MISSING_CLOCK_OUT,
          subjectDate: warning.date,
          title,
          body,
          createdAt: nowMinutes,
        });

        if (notification === null) {
          // 既に同じ (tenant, user, type, date) の通知がある = 重複、外部チャネルへも再送しない
          continue;
        }

        const dispatchResults =
          channels.length > 0 ? await dispatch(channels, { to: { email: user.email }, title, body }) : [];
        created.push({ notification, dispatchResults });
      }
    }
  }

  return { scannedUserCount: activeUsers.length, created };
}
