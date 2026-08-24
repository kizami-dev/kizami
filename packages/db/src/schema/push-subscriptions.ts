/**
 * push_subscriptions — ブラウザプッシュ通知(Web Push)の購読(1ブラウザ 1行)。
 *
 * 参照: docs/design/web-push.md、docs/requirements.md §7「通知設定の2層構造」。
 *
 * 位置づけ: user_notification_settings が「どのカテゴリをどのチャネルで受け取るか」という
 * **希望**を持つのに対し、こちらは「そのユーザーがどのブラウザで受け取れるか」という
 * **宛先**を持つ(メールでいう email_address、Webhook でいう webhook_url に相当)。
 * 1人が PC・スマホ・別ブラウザと複数の購読を持ちうるため、user_notification_settings に
 * カラムとして持たせず別テーブルにした(判断点 2026-08-24)。
 *
 * 秘密情報の扱い: endpoint / p256dh / auth は**暗号化しない**。webhook_url・smtp_password と
 * 違い、これらはブラウザが公開鍵として発行するもので、漏れても「そのブラウザへ通知を送れる」
 * 以上のことはできない(送信には VAPID 秘密鍵も要る)。一方で送信のたびに復号が必要になる
 * コストは購読数ぶん効いてくるため、平文で持つ判断をした。
 *
 * failed_at: プッシュサービスが 404/410(購読が失効した)を返した時刻(UTC エポック分)。
 * NULL 以外の行は送信対象から外す。**遅延プルーニング**の方針で、行そのものは消さない
 * (同じブラウザが再購読すると endpoint も新しくなるため、古い行は自然に使われなくなる。
 * 掃除のための追加ジョブを増やさないほうが運用が単純という判断)。
 */

import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),

    /** ブラウザの PushSubscription.endpoint(プッシュサービスの URL)。ユーザー内で一意 */
    endpoint: text("endpoint").notNull(),
    /** PushSubscription.keys.p256dh(非圧縮 EC 点 65 バイトの base64url) */
    keysP256dh: text("keys_p256dh").notNull(),
    /** PushSubscription.keys.auth(16 バイトの base64url) */
    keysAuth: text("keys_auth").notNull(),
    /** 購読時の User-Agent(設定画面で「どの端末か」を見分けるためだけに保持。任意) */
    userAgent: text("user_agent"),

    /** UTC エポック分 */
    createdAt: integer("created_at").notNull(),
    /** 最後に送信に成功した時刻(UTC エポック分)。未送信なら null */
    lastUsedAt: integer("last_used_at"),
    /** 404/410 を受けて失効と判断した時刻(UTC エポック分)。null 以外なら送信対象外 */
    failedAt: integer("failed_at"),
  },
  (table) => [
    // 「endpoint はユーザー内で一意」= 同じブラウザから2回購読しても行は増えない(upsert する)。
    // tenant_id を先頭に含めるのはマルチテナントの分離規約(docs/design/multi-tenancy.md)に従うため。
    uniqueIndex("push_subscriptions_user_endpoint_uq").on(table.tenantId, table.userId, table.endpoint),
  ],
);
