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
 *
 * ## 1単位で書く(atomic plan、2026-10-08 D1 対応。docs/design/d1-atomic-writes.md #26)
 *
 * API は `eraseUserPersonalDataAtomically`(atomic plan。D1 でも動く)を使う。判断点:
 *
 * - users の匿名化を claim にする: `erased_at IS NULL` を WHERE に足し、直後にガード
 *   `erasure.user`。同時の二重消去は片方だけが通り、負けた側は何も書かない(監査ログも重ならない)
 * - **件数は計画の前に数える**。監査ログの detail に「何件消えたか」を入れるが、計画の中では前の文の
 *   結果を読めない(read-your-writes 不可)。対象は退職処理済み(ログイン不可)のユーザーで、消去は
 *   管理者の明示操作なので、数えてから消すまでの間に行が増減することは事実上無い。増えても削除は
 *   ユーザー単位の条件で効くので**消し漏れは起きない**(ずれうるのは件数の報告だけ)
 * - Slack 連携トークンは「連携の削除結果の slack_user_id」で消していた(read-your-writes)。計画では
 *   連携の削除より**前**に、`slack_user_id IN (SELECT ... FROM slack_user_links ...)` のサブクエリで消す
 */

import { and, count, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { AtomicPlan, runAtomic } from "../atomic.js";
import type { Database, Transaction } from "../types.js";
import { auditLogInsertQuery, type NewAuditLogInput } from "./audit.js";
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
 * 対象ユーザーの個人データを消去(匿名化)する。呼び出し側がトランザクションを張ること
 * (D1 では張れないので、API は `eraseUserPersonalDataAtomically` を使う)。
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

export interface EraseUserAtomicallyParams extends EraseUserParams {
  /**
   * 消去と同じ単位で書く監査ログ(`member.erase`)を、計画の前に数えた件数から作る。
   * 監査ログに**消した値そのもの**を入れないのは呼び出し側の責務(routes/members.ts)。
   */
  audit: (removed: EraseUserResult["removed"]) => NewAuditLogInput;
}

/** 消去の対象になる、ユーザー単位の条件(テーブルごと)。件数の見積もりと削除で同じ条件を使う。 */
function erasureTargets(tenantId: string, userId: string) {
  const slackUserIdsOfUser = (db: Database | Transaction) =>
    db
      .select({ slackUserId: slackUserLinks.slackUserId })
      .from(slackUserLinks)
      .where(and(eq(slackUserLinks.tenantId, tenantId), eq(slackUserLinks.userId, userId)));
  const targets: Record<keyof EraseUserResult["removed"], { table: SQLiteTable; where: (db: Database | Transaction) => SQL | undefined }> = {
    authCredentials: { table: authCredentials, where: () => and(eq(authCredentials.tenantId, tenantId), eq(authCredentials.userId, userId)) },
    sessions: { table: sessions, where: () => and(eq(sessions.tenantId, tenantId), eq(sessions.userId, userId)) },
    totp: { table: userTotp, where: () => and(eq(userTotp.tenantId, tenantId), eq(userTotp.userId, userId)) },
    totpRecoveryCodes: {
      table: userTotpRecoveryCodes,
      where: () => and(eq(userTotpRecoveryCodes.tenantId, tenantId), eq(userTotpRecoveryCodes.userId, userId)),
    },
    pushSubscriptions: { table: pushSubscriptions, where: () => and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId)) },
    userNotificationSettings: {
      table: userNotificationSettings,
      where: () => and(eq(userNotificationSettings.tenantId, tenantId), eq(userNotificationSettings.userId, userId)),
    },
    apiKeys: { table: apiKeys, where: () => and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.userId, userId)) },
    invitations: { table: invitations, where: () => and(eq(invitations.tenantId, tenantId), eq(invitations.userId, userId)) },
    passwordResetTokens: {
      table: passwordResetTokens,
      where: () => and(eq(passwordResetTokens.tenantId, tenantId), eq(passwordResetTokens.userId, userId)),
    },
    slackUserLinks: { table: slackUserLinks, where: () => and(eq(slackUserLinks.tenantId, tenantId), eq(slackUserLinks.userId, userId)) },
    // userId ではなく slackUserId で紐づく。連携の行から辿る(連携の削除より前に評価すること)
    slackLinkTokens: {
      table: slackLinkTokens,
      where: (db) => and(eq(slackLinkTokens.tenantId, tenantId), inArray(slackLinkTokens.slackUserId, slackUserIdsOfUser(db))),
    },
    notifications: { table: notifications, where: () => and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)) },
    punchEventMeta: { table: punchEvents, where: () => and(eq(punchEvents.tenantId, tenantId), eq(punchEvents.userId, userId)) },
  };
  return targets;
}

/** 消去で消える(null 化される)件数を数える。`eraseUserPersonalData` の `removed` と同じ数え方。 */
export async function countUserPersonalData(db: Database, params: { tenantId: string; userId: string }): Promise<EraseUserResult["removed"]> {
  const targets = erasureTargets(params.tenantId, params.userId);
  const entries = await Promise.all(
    (Object.keys(targets) as (keyof EraseUserResult["removed"])[]).map(async (key) => {
      const target = targets[key];
      const [row] = await db.select({ n: count() }).from(target.table).where(target.where(db));
      return [key, Number(row?.n ?? 0)] as const;
    }),
  );
  return Object.fromEntries(entries) as EraseUserResult["removed"];
}

/**
 * 対象ユーザーの個人データの消去(匿名化)と監査ログを1単位で書く(src/atomic.ts の atomic plan。
 * D1 でも動く)。消すもの・残すものは `eraseUserPersonalData` と同じ(このファイル冒頭)。
 *
 * 既に消去済み(または存在しない)なら何も書かずに null — 呼び出し側は 409 already_erased を返す
 * (事前判定をすり抜けた同時の二重消去もここで止まる)。件数は計画の前に数える(ファイル冒頭の判断点)。
 */
export async function eraseUserPersonalDataAtomically(db: Database, params: EraseUserAtomicallyParams): Promise<EraseUserResult | null> {
  const { tenantId, userId, erasedAt } = params;
  const email = tombstoneEmail(userId);
  const removed = await countUserPersonalData(db, { tenantId, userId });
  const targets = erasureTargets(tenantId, userId);

  const plan = new AtomicPlan();
  // ---- 1. users 行の匿名化(claim。erased_at IS NULL を条件に、二重消去を排他) ----
  plan.add((q) =>
    q
      .update(users)
      .set({ name: ERASED_USER_NAME, email, isActive: false, erasedAt })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId), isNull(users.erasedAt)))
      .returning({ id: users.id }),
  );
  plan.guard("erasure.user");

  // ---- 2. 物理削除(理由は eraseUserPersonalData の各コメント)----
  // Slack の連携トークンは連携の行から辿るので、連携の削除より前に消す
  const deleteOrder: (keyof EraseUserResult["removed"])[] = [
    "authCredentials",
    "sessions",
    "totp",
    "totpRecoveryCodes",
    "pushSubscriptions",
    "userNotificationSettings",
    "apiKeys",
    "invitations",
    "passwordResetTokens",
    "slackLinkTokens",
    "slackUserLinks",
    "notifications",
  ];
  for (const key of deleteOrder) {
    const target = targets[key];
    plan.add((q) => q.delete(target.table).where(target.where(q)));
  }

  // ---- 3. punch_events のメタ情報の null 化(行は残す) ----
  plan.add((q) =>
    q
      .update(punchEvents)
      .set({ metaIp: null, metaUa: null, metaGpsLat: null, metaGpsLng: null })
      .where(targets.punchEventMeta.where(q)),
  );

  plan.add((q) => auditLogInsertQuery(q, params.audit(removed)));

  const result = await runAtomic(db, plan);
  if (!result.ok) return null;
  return { email, name: ERASED_USER_NAME, removed };
}
