/**
 * 退職者の個人データの消去(匿名化)。apps/api/src/routes/members.ts の
 * POST /members/:id/erase が使う。設計の全体像と法的整理は docs/design/data-retention.md。
 *
 * ## 「消去 = 匿名化」であって行削除ではない(この実装の中心的な判断)
 *
 * 個人情報保護法22条は利用目的の達成後に個人データを**遅滞なく消去する**よう努めることを
 * 求める。一方で労働基準法109条は賃金台帳・出勤簿等の記録を(原則5年、附則143条2項の
 * 経過措置により当分の間3年)**保存する義務**を課す。両者は退職者について正面から衝突する。
 *
 * KIZAMI はこの衝突を「保存義務のある勤怠記録の**行は残し**、その行から**誰であるかを
 * 特定できる情報を取り除く**」という形で解く。具体的には:
 *
 * - users 行は残す(punch_events 等が FK で参照しているため。消すと勤怠記録ごと壊れる)。
 *   氏名を定型句に、メールを tombstone(`user_deleted_<id>@invalid`)に置き換える。
 *   RFC 2606 が予約する `.invalid` TLD を使うので、この宛先へ実際にメールが飛ぶことはない。
 * - 認証・連絡先・端末に紐づくデータ(パスワード・TOTP・セッション・プッシュ購読・
 *   個人通知設定・APIキー・招待/リセットトークン・Slack連携)は**行ごと物理削除**する。
 *   これらは労基法109条の保存義務の対象では一切なく、残す理由が無い。
 * - punch_events の IP・UA・GPS 座標は**列を null 化**する(行は残す)。打刻の「時刻」は
 *   賃金台帳の基礎資料だが、「どのIPから打刻したか」はそうではない。追記専用テーブルへの
 *   UPDATE になるが、これは schema/punches.ts が GPS 保持期間について既に明示している
 *   例外(「保持期間経過後は null 化(行は消さない)」)と同じ性質の操作である。
 * - audit_logs には**一切触れない**(不可変原則)。actor 名は listAuditLogs が users を
 *   JOIN して解決するため、users 行の匿名化が自動的に監査ログの表示名にも及ぶ。
 *   行数・action・target・occurredAt は変わらないので「誰が何をしたか」の連鎖は保たれる。
 * - leave_grants / closing_snapshots / corrections 等の派生・集計データは触れない。
 *   これらは userId(不透明なUUID)でしか個人を指しておらず、users 行の匿名化により
 *   人物の特定可能性は同時に失われる。
 *
 * ## 冪等性
 *
 * すべての操作は「対象が無ければ0件更新/削除」で完結する(条件付き UPDATE / DELETE のみ)。
 * ただし呼び出し側(routes/members.ts)は `erased_at` で二重実行を 409 で弾く。
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import {
  apiKeys,
  authCredentials,
  invitations,
  notifications,
  passwordResetTokens,
  punchEvents,
  pushSubscriptions,
  sessions,
  slackLinkTokens,
  slackUserLinks,
  userNotificationSettings,
  userTotp,
  userTotpRecoveryCodes,
  users,
} from "../schema/index.js";

/**
 * 匿名化後に users.name へ入れる定型句。
 *
 * 判断点: 空文字にはしない。一覧・監査ログの表示名がすべて空欄になると「データが壊れている」
 * ようにしか見えず、「意図して消した」ことが読み取れない。ロケール別の訳語も持たせない —
 * これは表示文言ではなく**DBに保存される事実**であり、後から言語を切り替えても
 * 過去に消去した行の値が変わってはならない(監査上の一貫性)。
 */
export const ERASED_USER_NAME = "削除済みユーザー";

/** 匿名化後の tombstone メールアドレス。RFC 2606 の予約 TLD `.invalid` を使う。 */
export function tombstoneEmail(userId: string): string {
  return `user_deleted_${userId}@invalid`;
}

export interface EraseUserParams {
  tenantId: string;
  userId: string;
  /** 消去を実行した時刻(UTC エポック分)。users.erased_at に入る */
  erasedAt: number;
}

/** 消去で実際に何件消えたかの内訳(監査ログの detail と完了報告に使う)。 */
export interface EraseUserResult {
  /** 置き換え後のメール(tombstone) */
  email: string;
  /** 置き換え後の氏名 */
  name: string;
  /** 物理削除・null 化した対象の件数(0 でもキーは必ず現れる) */
  removed: {
    authCredentials: number;
    sessions: number;
    totp: number;
    totpRecoveryCodes: number;
    pushSubscriptions: number;
    userNotificationSettings: number;
    apiKeys: number;
    invitations: number;
    passwordResetTokens: number;
    slackUserLinks: number;
    slackLinkTokens: number;
    notifications: number;
    punchEventMeta: number;
  };
}

/**
 * 対象ユーザーの個人データを消去(匿名化)する。呼び出し側がトランザクションを張ること。
 *
 * 保持期間の判定・権限・二重実行の防止は**行わない**(routes/members.ts の責務)。
 * ここは「消す」という操作そのものだけを担う。
 */
export async function eraseUserPersonalData(db: Database | Transaction, params: EraseUserParams): Promise<EraseUserResult> {
  const { tenantId, userId, erasedAt } = params;
  const email = tombstoneEmail(userId);

  // ---- 1. users 行の匿名化(行は残す。punch_events 等の FK 参照先) ----
  const [updated] = await db
    .update(users)
    .set({ name: ERASED_USER_NAME, email, isActive: false, erasedAt })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
    .returning();
  if (!updated) {
    throw new Error(`eraseUserPersonalData: user not found: ${userId}`);
  }

  // ---- 2. 認証・端末・連絡先に紐づくデータの物理削除 ----
  // 労基法109条の保存義務の対象ではなく、残す理由が一切ない種類のデータ。
  const credentials = await db
    .delete(authCredentials)
    .where(and(eq(authCredentials.tenantId, tenantId), eq(authCredentials.userId, userId)))
    .returning({ id: authCredentials.id });

  const revokedSessions = await db
    .delete(sessions)
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });

  const totp = await db
    .delete(userTotp)
    .where(and(eq(userTotp.tenantId, tenantId), eq(userTotp.userId, userId)))
    .returning({ userId: userTotp.userId });

  const totpCodes = await db
    .delete(userTotpRecoveryCodes)
    .where(and(eq(userTotpRecoveryCodes.tenantId, tenantId), eq(userTotpRecoveryCodes.userId, userId)))
    .returning({ id: userTotpRecoveryCodes.id });

  // プッシュ購読は endpoint(ブラウザが発行する端末固有URL)と User-Agent を持つ。
  const push = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });

  // 個人の通知設定は本人のメールアドレス・Webhook URL(私物の連絡先になりうる)を持つ。
  const notifSettings = await db
    .delete(userNotificationSettings)
    .where(and(eq(userNotificationSettings.tenantId, tenantId), eq(userNotificationSettings.userId, userId)))
    .returning({ userId: userNotificationSettings.userId });

  // APIキーは「そのユーザーとして打刻できる資格情報」。本人のキーだけを消す
  // (created_by がその人で user_id が他人のキーは、他人の資格情報なので残す)。
  const keys = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  const invites = await db
    .delete(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.userId, userId)))
    .returning({ id: invitations.id });

  const resets = await db
    .delete(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tenantId, tenantId), eq(passwordResetTokens.userId, userId)))
    .returning({ id: passwordResetTokens.id });

  // Slack 連携は Slack 側のユーザーID(外部サービス上の識別子)を保持している。
  // 未使用の連携トークンは userId ではなく slackUserId で紐づくため、リンク行から辿って消す。
  const slackLinks = await db
    .delete(slackUserLinks)
    .where(and(eq(slackUserLinks.tenantId, tenantId), eq(slackUserLinks.userId, userId)))
    .returning({ slackUserId: slackUserLinks.slackUserId });
  const slackUserIds = slackLinks.map((r) => r.slackUserId);
  const slackTokens =
    slackUserIds.length === 0
      ? []
      : await db
          .delete(slackLinkTokens)
          .where(and(eq(slackLinkTokens.tenantId, tenantId), inArray(slackLinkTokens.slackUserId, slackUserIds)))
          .returning({ id: slackLinkTokens.id });

  // 本人宛の通知は本文に氏名・申請内容が入る(例「〇〇さんの休暇申請が承認されました」)。
  // 本人はもう読めない(ログイン不可)ので、残す理由が無い。
  // 判断点: 消すのは**本人宛**だけ。承認者など他人の受信箱にある通知は、本文に対象者の氏名が
  // 埋め込まれていても触らない — 他人の受信箱を書き換えるのは、その人にとって不可解な変化で
  // あり、消去の副作用として行うべきではない(docs/design/data-retention.md §3.5)。
  const notifs = await db
    .delete(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });

  // ---- 3. punch_events のメタ情報の null 化(行は残す) ----
  // 打刻の「時刻」は賃金台帳の基礎資料なので残す。「どのIP・どの端末・どの座標から打刻したか」は
  // 保存義務の対象ではないため取り除く(schema/punches.ts の GPS 保持期間の扱いと同じ考え方)。
  const punchMeta = await db
    .update(punchEvents)
    .set({ metaIp: null, metaUa: null, metaGpsLat: null, metaGpsLng: null })
    .where(and(eq(punchEvents.tenantId, tenantId), eq(punchEvents.userId, userId)))
    .returning({ id: punchEvents.id });

  return {
    email,
    name: ERASED_USER_NAME,
    removed: {
      authCredentials: credentials.length,
      sessions: revokedSessions.length,
      totp: totp.length,
      totpRecoveryCodes: totpCodes.length,
      pushSubscriptions: push.length,
      userNotificationSettings: notifSettings.length,
      apiKeys: keys.length,
      invitations: invites.length,
      passwordResetTokens: resets.length,
      slackUserLinks: slackLinks.length,
      slackLinkTokens: slackTokens.length,
      notifications: notifs.length,
      punchEventMeta: punchMeta.length,
    },
  };
}
