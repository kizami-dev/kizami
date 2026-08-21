/**
 * 36協定アラート(基本版, v0.2)の定期スキャン本体。
 *
 * 参照: docs/requirements.md §5「36協定アラート(早期導入)」
 * - v0.2 は「月45時間の時間外」のみを扱う(年360h・特別条項時の各種上限は v0.3 で完全版として追加)
 * - 実績判定は engine の `calculate()` が返す `totals.overtime`(当月の時間外、分)をそのまま使い、
 *   見込み判定は `flexBalance`(実労働と総枠)から算出する(下記)
 *   (v0.3 で複数月平均・年間累計を扱うようになっても、この「月次実績を取り出す」土台は
 *   apps/api/src/reminders.ts と共有する — calculateMonthlyForUser を再利用)
 *
 * 設計方針(依頼時点の決定事項):
 * - 通知は2種類。どちらも同じ notifications テーブル・同じ UNIQUE(tenant_id, user_id, type,
 *   subject_date) による重複防止に乗せる。subject_date には「対象月の1日」("YYYY-MM-01")を
 *   入れることで、同じ月に同じ種類の通知は1通だけに絞る(打刻ごとの日付ではなく月単位の粒度)
 *   - `overtime_45h_reached`: 当月の時間外(totals.overtime)が既に45時間(2700分)以上
 *   - `overtime_45h_projected`: まだ45時間未満だが、実労働のペースからの見込みが45時間を超える
 * - 見込み計算は保守的に: 実労働を月末まで日割りで伸ばし、総枠との差を見込み時間外とする
 *   (`projected = max(0, actual * (月の暦日数 / 経過日数) - 総枠)`)。経過日数は
 *   「当月1日から今日まで(今日を含む)」。月の経過が7日未満のときはサンプルが少なすぎて
 *   誤検知(月初の数日だけ残業しただけで「今月は45h超えそう」と鳴る)になるため見込み通知を出さない
 * - reached が既に出ている月には projected を出さない(既に超えているので見込みは無意味。
 *   createNotificationIfAbsent の UNIQUE 違反捕捉だけでは「別 type の通知の有無」は分からないため、
 *   projected を作る前に findNotificationByTypeAndDate で reached の存在を明示的に確認する)
 * - ユーザー単位の失敗は握りつぶして他のユーザーの処理を止めない(reminders.ts と同じ方針)
 * - 外部チャネル送信は「新規に作成できた通知」だけに行う(reminders.ts と同じ、重複防止の判定を
 *   外部送信のガードにも流用する)
 *
 * BullMQ/Valkey には一切依存しない(node:* も使わない)。reminders.ts と同じく、呼び出し元
 * (src/worker.ts、将来の Cloudflare Cron エントリ)がキュー層・スケジューラ層を差し替えられる
 * よう「DB を受け取ってスキャンする」ピュアな関数として独立させている。
 */

import { createNotificationIfAbsent, findNotificationByTypeAndDate, type Database, type Notification } from "@kizami/db";
import { dispatch, type DispatchResult, type NotificationChannel } from "@kizami/notify";
import { calculateMonthlyForUser, listActiveUsers } from "./reminders.js";
import { TZ_OFFSET_MINUTES_JST } from "./lib/settings.js";
import { dateFromEpochDay, daysInMonth, formatDate } from "./lib/time.js";

const MINUTES_PER_DAY = 1440;

const NOTIFICATION_TYPE_OVERTIME_45H_REACHED = "overtime_45h_reached";
const NOTIFICATION_TYPE_OVERTIME_45H_PROJECTED = "overtime_45h_projected";

/** 36協定アラート(基本版)が対象にする月45時間の閾値(分)。45h × 60 */
const OVERTIME_45H_MINUTES = 45 * 60;

/** この日数未満しか当月が経過していない場合、見込み通知(projected)は出さない。 */
const MIN_ELAPSED_DAYS_FOR_PROJECTION = 7;

export interface RunOvertimeAlertScanOptions {
  /** 現在時刻(UTC エポック分)。テストで固定できるよう明示的に渡す */
  nowMinutes: number;
  /**
   * テナントIDを受け取り、そのテナントの外部チャネル(新規作成できた通知だけに送る)を
   * 返す。省略時はアプリ内通知のみ(既定挙動、どの通知も外部送信しない)。reminders.ts の
   * runReminderScan と同じ契約(呼び出し側でテナントIDをキーにメモ化してよい)。
   */
  resolveChannels?: (tenantId: string) => Promise<NotificationChannel[]>;
}

export interface CreatedOvertimeAlert {
  notification: Notification;
  dispatchResults: DispatchResult[];
}

export interface RunOvertimeAlertScanResult {
  /** スキャン対象にした(is_active な)ユーザー数 */
  scannedUserCount: number;
  /** 新規作成された通知(重複でスキップされたもの・reached 優先で抑止された projected は含まない) */
  created: CreatedOvertimeAlert[];
}

interface LocalToday {
  year: number;
  month: number;
  /** 当月内の日(1始まり)。「当月1日から今日まで(今日を含む)」の経過日数と同じ値 */
  day: number;
}

/**
 * 現在時刻(UTC エポック分)から、固定 JST オフセットでの「今日」を求める。
 * reminders.ts の resolveTargetMonths と同じ考え方(テナント別 TZ は v1.0 以降)。
 */
function resolveLocalToday(nowMinutes: number): LocalToday {
  const localMinutes = nowMinutes + TZ_OFFSET_MINUTES_JST;
  const todayEpochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const today = dateFromEpochDay(todayEpochDay);
  const parts = today.split("-").map(Number);
  return { year: parts[0] ?? 1970, month: parts[1] ?? 1, day: parts[2] ?? 1 };
}

/** 分を「◯時間◯分」形式にする(表示用。四捨五入して整数分にしてから変換する)。 */
function formatHoursAndMinutes(rawMinutes: number): string {
  const minutes = Math.round(rawMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}時間${remainder}分`;
}

function reachedNotificationContent(params: { year: number; month: number; overtimeMinutes: number }): {
  title: string;
  body: string;
} {
  const { year, month, overtimeMinutes } = params;
  return {
    title: "月45時間の時間外労働に達しました",
    body: `${year}年${month}月の時間外労働の実績が${formatHoursAndMinutes(overtimeMinutes)}となり、36協定の月45時間ラインに達しました。`,
  };
}

function projectedNotificationContent(params: {
  year: number;
  month: number;
  day: number;
  overtimeMinutes: number;
  projectedMinutes: number;
}): { title: string; body: string } {
  const { year, month, day, overtimeMinutes, projectedMinutes } = params;
  return {
    title: "月45時間の時間外労働を超える見込みです",
    body: `${year}年${month}月${day}日時点の時間外労働の実績は${formatHoursAndMinutes(overtimeMinutes)}です。このままのペースだと月末までに${formatHoursAndMinutes(projectedMinutes)}に達し、36協定の月45時間ラインを超える見込みです。`,
  };
}

/**
 * 36協定アラート(基本版)の定期スキャンを1回実行する。
 *
 * - 全テナントの is_active なユーザーについて、当月の calculate() を回し totals.overtime を見る
 * - 45時間(2700分)以上なら overtime_45h_reached
 * - 45時間未満でも、当月の経過日数が7日以上あり、実労働ペースからの見込み超過が45時間を超えるなら
 *   overtime_45h_projected(ただし同じ月に reached が既にあれば作らない)
 * - createNotificationIfAbsent で通知を作成する(重複は UNIQUE 制約で自動的にスキップされる、冪等)
 * - 新規作成できた通知だけを channels へ dispatch する(重複時は外部へも再送しない)
 *
 * BullMQ/Valkey などスケジューラの実体には一切依存しない。
 */
export async function runOvertimeAlertScan(
  db: Database,
  options: RunOvertimeAlertScanOptions,
): Promise<RunOvertimeAlertScanResult> {
  const { nowMinutes, resolveChannels } = options;
  const { year, month, day } = resolveLocalToday(nowMinutes);
  const activeUsers = await listActiveUsers(db);

  const created: CreatedOvertimeAlert[] = [];

  for (const user of activeUsers) {
    try {
      const channels = resolveChannels ? await resolveChannels(user.tenantId) : [];

      let overtimeMinutes: number;
      let actualMinutes: number;
      let frameMinutes: number;
      try {
        const { output } = await calculateMonthlyForUser(db, { tenantId: user.tenantId, userId: user.id, year, month });
        overtimeMinutes = output.totals.overtime;
        actualMinutes = output.flexBalance.actualMinutes;
        frameMinutes = output.flexBalance.frameMinutes;
      } catch {
        // テナント設定・制度割当がまだ揃っていないユーザー/月はスキャン対象外として静かにスキップする
        // (reminders.ts の calculateMonthlyForUser 呼び出しと同じ方針)
        continue;
      }

      const monthStartDate = formatDate(year, month, 1);
      const reached = overtimeMinutes >= OVERTIME_45H_MINUTES;

      if (reached) {
        const { title, body } = reachedNotificationContent({ year, month, overtimeMinutes });
        const notification = await createNotificationIfAbsent(db, {
          tenantId: user.tenantId,
          userId: user.id,
          type: NOTIFICATION_TYPE_OVERTIME_45H_REACHED,
          subjectDate: monthStartDate,
          title,
          body,
          createdAt: nowMinutes,
        });
        if (notification !== null) {
          const dispatchResults =
            channels.length > 0 ? await dispatch(channels, { to: { email: user.email }, title, body }) : [];
          created.push({ notification, dispatchResults });
        }
        continue;
      }

      if (day < MIN_ELAPSED_DAYS_FOR_PROJECTION) {
        // 月初は経過日数が少なすぎて見込みが誤検知になるため、まだ判定しない
        continue;
      }

      // 見込みは「時間外」ではなく「実労働」を月末まで伸ばしてから総枠と比較する。
      // フレックスの時間外は清算期間(月)の総枠との差なので、月中の totals.overtime は
      // ほぼ常に 0 であり、それを日割りで伸ばしても永久に 0 のままになる(2026-08-22 修正)。
      const projectedActualMinutes = actualMinutes * (daysInMonth(year, month) / day);
      const projectedMinutes = Math.max(0, projectedActualMinutes - frameMinutes);
      if (projectedMinutes <= OVERTIME_45H_MINUTES) {
        continue;
      }

      // reached が既にこの月に出ていれば見込み通知は出さない(実績超過の後に見込みを出す意味がない)
      const existingReached = await findNotificationByTypeAndDate(db, {
        tenantId: user.tenantId,
        userId: user.id,
        type: NOTIFICATION_TYPE_OVERTIME_45H_REACHED,
        subjectDate: monthStartDate,
      });
      if (existingReached !== null) {
        continue;
      }

      const { title, body } = projectedNotificationContent({ year, month, day, overtimeMinutes, projectedMinutes });
      const notification = await createNotificationIfAbsent(db, {
        tenantId: user.tenantId,
        userId: user.id,
        type: NOTIFICATION_TYPE_OVERTIME_45H_PROJECTED,
        subjectDate: monthStartDate,
        title,
        body,
        createdAt: nowMinutes,
      });
      if (notification === null) {
        continue;
      }
      const dispatchResults =
        channels.length > 0 ? await dispatch(channels, { to: { email: user.email }, title, body }) : [];
      created.push({ notification, dispatchResults });
    } catch {
      // ユーザー単位の予期しない失敗(DB エラー等)で他のユーザーの処理を止めない
      // (reminders.ts と同じ方針)
      continue;
    }
  }

  return { scannedUserCount: activeUsers.length, created };
}
