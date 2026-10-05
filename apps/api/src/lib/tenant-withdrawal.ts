/**
 * テナントの退会(申請 → 30日の猶予 → 物理削除)の共通部品。設計は docs/design/tenant-withdrawal.md。
 *
 * - 猶予期間・再通知の時期・権限キーの定数
 * - 「退会手続き中か」「この人は手続き中でも使えるか」の判定(認証の各経路・ミドルウェアが使う)
 * - システムメールの文面(申請・削除の7日前・削除の完了)
 *
 * ## 退会手続き中に誰が何をできるか(判断点)
 *
 * 猶予期間に許すのは「全データのエクスポート」と「申請の取り消し」だけ。そのため:
 *
 * - **`tenant.withdraw` を持つ人(管理者)だけがログインできる**。それ以外の人はパスワード・2FA・SSO・
 *   パスワード再設定・招待の受諾のどの経路でもセッションを得られない(`tenant_withdrawing`)
 * - 管理者は**閲覧(GET)はできる**が、書き込みは取り消し(POST /tenant/withdrawal/cancel)以外すべて
 *   409 `tenant_withdrawing`(auth/tenant-withdrawal-guard.ts)。閲覧を許すのは、エクスポートの前に
 *   中身を確かめられるようにするためと、既存の CSV エクスポート(GET)もそのまま使えるようにするため
 * - **既存のセッションは消さない**。管理者以外のセッションでのリクエストは 401 `tenant_withdrawing` で
 *   断る(Web はログイン画面へ戻して理由を出す)。消さない理由: 取り消せば元どおり使える状態に戻すのが
 *   「取り消し」の意味であり、取り消しのたびに全員を締め出し直すのは副作用が大きい。手続き中の
 *   セッションでは何もできないので、残しておく危険も無い。テナントを削除すれば行ごと消える
 * - **API キー(打刻クライアント・MCP)も消さずに 403 `tenant_withdrawing` で断る**。理由は同じで、
 *   取り消せば IC カードリーダー等の設定をやり直さずに済む。キーで打刻できてしまうと「退会手続き中に
 *   勤怠記録が増え続ける」ことになり、エクスポートの内容と削除される内容がずれる
 * - Slack からの打刻も断る(routes/slack.ts)。定期ジョブ(リマインド・36協定・有給の予告・シフトの
 *   乖離)は手続き中のテナントを対象から外す(reminders.ts の listActiveUsers ほか)
 */

import { getTenantById, getUserById, type Database, type Tenant } from "@kizami/db";
import { hasPermission as evaluatePermission, type PermissionKey, type Scope } from "@kizami/authz";
import { loadEffectivePermissions } from "../authz.js";
import { resolveTenantScopeApprovers } from "./approvers.js";
import { TZ_OFFSET_MINUTES_JST } from "./settings.js";

/** 退会の権限キー(packages/authz/src/catalog.ts)。全データのエクスポートも同じキー。 */
export const TENANT_WITHDRAW_PERMISSION: PermissionKey = "tenant.withdraw";

const DAY_MINUTES = 24 * 60;

/** 猶予期間(申請から物理削除を始めてよくなるまで)。30日。 */
export const WITHDRAWAL_GRACE_DAYS = 30;
export const WITHDRAWAL_GRACE_MINUTES = WITHDRAWAL_GRACE_DAYS * DAY_MINUTES;

/** 削除の再通知を送る時期(削除予定の何日前か)。7日。 */
export const WITHDRAWAL_REMINDER_LEAD_DAYS = 7;
export const WITHDRAWAL_REMINDER_LEAD_MINUTES = WITHDRAWAL_REMINDER_LEAD_DAYS * DAY_MINUTES;

/** 退会手続き中を表すエラーコード(API の応答・Web の文言のキー)。 */
export const TENANT_WITHDRAWING_ERROR = "tenant_withdrawing";

/** 退会の状態(API の応答・/me にそのまま載せる形)。 */
export type TenantWithdrawalState =
  | { status: "active" }
  | {
      status: "withdrawing";
      /** 申請の時刻(UTC エポック分) */
      requestedAt: number;
      /** 削除を始めてよくなる時刻(UTC エポック分) */
      scheduledPurgeAt: number;
    };

export function withdrawalStateOf(tenant: Pick<Tenant, "withdrawalRequestedAt" | "withdrawalScheduledPurgeAt"> | null): TenantWithdrawalState {
  if (!tenant || tenant.withdrawalRequestedAt === null || tenant.withdrawalScheduledPurgeAt === null) return { status: "active" };
  return { status: "withdrawing", requestedAt: tenant.withdrawalRequestedAt, scheduledPurgeAt: tenant.withdrawalScheduledPurgeAt };
}

/** 退会手続き中なら true(テナント行を1回読む)。 */
export async function isTenantWithdrawing(db: Database, tenantId: string): Promise<boolean> {
  return withdrawalStateOf(await getTenantById(db, tenantId)).status === "withdrawing";
}

/** 実効権限が「退会手続き中でも使える」(= tenant.withdraw をテナント全体で持つ)か。 */
export function canOperateWithdrawingTenant(permissions: Map<PermissionKey, Scope>): boolean {
  return evaluatePermission(permissions, TENANT_WITHDRAW_PERMISSION, "tenant");
}

/**
 * このユーザーのログイン(セッションの発行)を退会手続きのために止めるべきか。
 * 手続き中のテナントで、`tenant.withdraw` を持たない人なら true。
 * ログインの各経路(routes/auth.ts・auth-oidc.ts・password-resets.ts)がセッションを作る直前に呼ぶ。
 */
export async function isLoginBlockedByWithdrawal(db: Database, params: { tenantId: string; userId: string }): Promise<boolean> {
  if (!(await isTenantWithdrawing(db, params.tenantId))) return false;
  const permissions = await loadEffectivePermissions(db, { id: params.userId, tenantId: params.tenantId });
  return !canOperateWithdrawingTenant(permissions);
}

/**
 * 退会のメールの宛先: `tenant.withdraw` をテナント全体で持つ、有効な(退職処理も消去もされていない)
 * ユーザーのメールアドレス。申請した本人だけでなく**全員**に送る — 1人の管理者(や乗っ取られた
 * アカウント)が黙って会社のデータを消せないよう、取り消せる人全員に知らせるため。
 */
export async function listWithdrawalNoticeRecipients(db: Database, tenantId: string): Promise<string[]> {
  const userIds = await resolveTenantScopeApprovers(db, { tenantId, permission: TENANT_WITHDRAW_PERMISSION });
  const emails: string[] = [];
  for (const id of userIds) {
    const user = await getUserById(db, { tenantId, id });
    if (user && user.isActive && user.erasedAt === null) emails.push(user.email);
  }
  return [...new Set(emails)].sort();
}

/** UTC エポック分 → 日本時間の "YYYY-MM-DD HH:mm"(メール・CLI の表示用)。 */
export function formatJstDateTime(minutes: number): string {
  return new Date((minutes + TZ_OFFSET_MINUTES_JST) * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

// ---- システムメールの文面 ----------------------------------------------------
//
// **ユーザー入力(テナント名・氏名など)を一切入れない**(signup・本人用のパスワード再設定と同じ方針)。
// テナント名は申込者が自由に決められる文字列で、本文に入れると運用者名義のフィッシングの踏み台になる。
// どのテナントの話かは、リンク先の画面(ログイン後)で確かめてもらう。リンクは固定のパスだけ。

export interface SystemMailContent {
  subject: string;
  text: string;
}

/**
 * 労基法109条の保存義務の案内(全メール共通)。出所の示し方は docs/design/data-retention.md と同じ
 * (条文と、令和2年改正の附則による経過措置)。
 */
const RETENTION_NOTICE_LINES = [
  "■ 削除の前に、必ず全データをエクスポートして保存してください",
  "労働基準法109条により、出勤簿などの労働関係に関する重要な書類は、事業主が5年間(令和2年改正法の附則による経過措置により、当分の間は3年間)保存しなければなりません。",
  "この保存義務は事業主(貴社)の義務であり、KIZAMI からデータが削除されてもなくなりません。",
];

function settingsUrl(appBaseUrl: string): string {
  return `${appBaseUrl}/settings/withdrawal`;
}

/** 申請を受け付けたときのメール。 */
export function buildWithdrawalRequestedMail(params: { appBaseUrl: string; scheduledPurgeAt: number }): SystemMailContent {
  return {
    subject: "【KIZAMI】テナントの退会のお申し込みを受け付けました",
    text: [
      "KIZAMI をご利用いただいているテナント(会社)について、退会のお申し込みを受け付けました。",
      "",
      `削除予定日時: ${formatJstDateTime(params.scheduledPurgeAt)}(日本時間)以降`,
      "この日時を過ぎると、テナントのすべてのデータ(勤怠記録・メンバー・設定・監査ログ)を物理削除します。削除したデータは元に戻せません。",
      "それまでの間、管理者以外の方はログインできず、打刻と通知も止まります。",
      "",
      ...RETENTION_NOTICE_LINES,
      "全データのエクスポートと退会の取り消しは、次の画面から行えます。",
      settingsUrl(params.appBaseUrl),
      "",
      "このお申し込みに心当たりがない場合は、すぐに上の画面から退会を取り消してください。",
      "このメールは、退会を申請・取り消しできる権限を持つ方全員にお送りしています。",
    ].join("\n"),
  };
}

/** 削除の7日前の再通知。 */
export function buildWithdrawalReminderMail(params: { appBaseUrl: string; scheduledPurgeAt: number }): SystemMailContent {
  return {
    subject: "【KIZAMI】テナントのデータの削除が近づいています",
    text: [
      "退会のお申し込みをいただいているテナント(会社)のデータの削除が近づいています。",
      "",
      `削除予定日時: ${formatJstDateTime(params.scheduledPurgeAt)}(日本時間)以降`,
      "この日時を過ぎると、すべてのデータを物理削除します。削除したデータは元に戻せません。",
      "",
      ...RETENTION_NOTICE_LINES,
      "全データのエクスポートと退会の取り消しは、次の画面から行えます。",
      settingsUrl(params.appBaseUrl),
    ].join("\n"),
  };
}

/** 削除が完了したときのメール。宛先は削除の前に集めておく(削除の後はもう分からない)。 */
export function buildWithdrawalCompletedMail(): SystemMailContent {
  return {
    subject: "【KIZAMI】テナントのデータの削除が完了しました",
    text: [
      "退会のお申し込みをいただいていたテナント(会社)のデータの削除が完了しました。",
      "勤怠記録・メンバー・設定・監査ログを含むすべてのデータを削除しました。",
      "",
      "なお、障害に備えたバックアップには、削除したデータが保存期間(最長で約13か月)の間残ります。バックアップは障害からの復旧にだけ使い、復旧したときは削除済みのテナントをあらためて削除します。",
      "",
      "これまで KIZAMI をご利用いただき、ありがとうございました。",
    ].join("\n"),
  };
}
