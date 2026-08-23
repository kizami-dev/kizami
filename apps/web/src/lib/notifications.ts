/**
 * 通知の種別から「対応する画面への導線」を決める共通ロジック。
 *
 * NotificationBell(ヘッダーのドロップダウン)・NotificationsListView(通知一覧画面)・
 * DashboardView(ダッシュボードの「要対応」)の3箇所で同じルールを使うため、ここに1本化する
 * (以前は NotificationBell と DashboardView がそれぞれ missing_clock_out だけを個別に
 * ハードコードしていた)。
 *
 * 種別プレフィックスは apps/api 側の定義に合わせる(apps/api は変更禁止のため、ここでは
 * 文字列としてのみ参照する):
 * - "missing_clock_out": apps/api/src/reminders.ts
 * - "leave_expiring_*d" / "leave_mandatory5_*d": apps/api/src/leave-alerts.ts
 * - "overtime_*"(overtime_45h_reached 等、8種): apps/api/src/overtime-alerts.ts
 * - "leave_grant_proposed": apps/api/src/leave-grant-proposals.ts(**管理者宛**の付与予告)
 * - "leave_grant_approved": apps/api/src/routes/leave.ts(付与されたことを本人へ)
 */
import type { Unstable_RouteHref as RouteHref } from "waku/router/client";
import type { NotificationDto } from "./api";
import { messages } from "./messages";

export type NotificationCategory = "missing_clock_out" | "leave" | "overtime" | "other";

export function categorizeNotificationType(type: string): NotificationCategory {
  if (type === "missing_clock_out") return "missing_clock_out";
  if (type.startsWith("leave_")) return "leave";
  if (type.startsWith("overtime_")) return "overtime";
  return "other";
}

export interface NotificationLink {
  /**
   * waku の型付きルーティング(pages.gen.ts から生成される既知パスのユニオン)に合わせた型。
   * `?`以降のクエリ文字列は任意の文字列を許容するため、テンプレートリテラルで組み立てた
   * href をそのままここに代入できる(動的な文字列変数を経由すると幅が string に広がって
   * 通らなくなるため、この関数の戻り値の型注釈として直接付与している)。
   */
  href: RouteHref;
  label: string;
}

/**
 * 通知から対応する画面への導線。
 * - missing_clock_out: その日の月次画面(修正フォーム自動オープン、?date= 付き)
 * - leave_grant_proposed: 有給の設定画面(管理者向けの「付与の予告」セクション)
 * - その他の leave_*: 有給画面(対象日の情報は無くても画面全体で状況が分かるため日付は付けない)
 * - overtime_*: 対象月の月次画面
 * 対応する遷移先が無い種別(other)や subjectDate が無い場合は null。
 */
export function notificationLinkFor(n: Pick<NotificationDto, "type" | "subjectDate">): NotificationLink | null {
  const category = categorizeNotificationType(n.type);
  // 付与予告("leave_grant_proposed")だけは受け手が**管理者**で、行き先も従業員向けの
  // /leave ではなく承認 UI がある /settings/leave(「付与の予告」セクション)になる。
  // カテゴリ判定より前に置く(プレフィックスは "leave_" なので下の分岐に吸われてしまう)。
  if (n.type === "leave_grant_proposed") {
    return { href: "/settings/leave", label: messages.notifications.openLeaveSettings };
  }
  if (category === "missing_clock_out" && n.subjectDate) {
    const month = n.subjectDate.slice(0, 7);
    return { href: `/monthly?month=${month}&date=${n.subjectDate}`, label: messages.notifications.openCorrection };
  }
  if (category === "leave") {
    return { href: "/leave", label: messages.notifications.openLeave };
  }
  if (category === "overtime" && n.subjectDate) {
    const month = n.subjectDate.slice(0, 7);
    return { href: `/monthly?month=${month}`, label: messages.notifications.openMonthly };
  }
  return null;
}
