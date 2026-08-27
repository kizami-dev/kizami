/**
 * user_totp / user_totp_recovery_codes — パスワードログインの二要素認証(TOTP、2026-08-27)。
 *
 * 勤怠は人事データ(給与・在籍・位置情報に接続する)であり、パスワード1本で守るには重い。
 * 自前認証(email+パスワード)に **本人が任意で有効化できる** 二要素認証を足す。
 * 仕様の正は docs/design/two-factor-auth.md。
 *
 * ## テーブルを分けた理由
 *
 * `auth_credentials`(パスワード)に列を足さず別テーブルにする。理由は2つ:
 * - `auth_credentials` は「パスワードを設定した=招待を受諾した」ことを表す行で、
 *   TOTP は本人が後から任意で足す**別の要素**。同じ行に混ぜると「2FA だけリセットしたい」
 *   (管理者によるロックアウト救済)が UPDATE の部分適用になり、意図が読めなくなる。
 * - 将来パスキー(WebAuthn)を足すときも同じ形(要素ごとに1テーブル)で並べられる。
 *
 * ## user_totp
 *
 * - `user_id` が主キー(1人1つ。複数の認証アプリを登録したい要望は、同じ QR を複数端末で
 *   読ませれば満たせるため、行を複数持つ必要がない)。
 * - `secret_encrypted`: 共有鍵(base32)を **保存時暗号化**する("enc:v1:..."、
 *   packages/crypto の Encryptor)。共有鍵は「それさえあれば誰でも正しいコードを作れる」
 *   値であり、パスワードハッシュのように一方向にはできない(検証に平文が要る)。よって
 *   DB 単体の流出で 2FA が無力化されないよう、鍵(KIZAMI_ENCRYPTION_KEY)を別に要求する。
 *   **鍵が未設定の配備では 2FA を有効化できない**(平文フォールバックはしない)。
 * - `enabled_at`: null = **セットアップ中**(QR は出したが、まだ正しいコードで確認していない)。
 *   確認できるまで有効にしないのは、間違った鍵を登録して自分を締め出す事故を防ぐため。
 *   ログイン時に 2FA を要求するかの判定は「行があること」ではなく `enabled_at IS NOT NULL`。
 * - `last_used_counter`: **リプレイ防止**。TOTP のコードは 30 秒間有効なので、肩越しに
 *   見られた/中間者に取られたコードが同じ窓の内に再送されうる。最後に受理したカウンタを
 *   覚え、それ以下のカウンタは正しいコードでも拒否する(packages/crypto/src/totp.ts の
 *   `verifyTotp({ minCounterExclusive })`)。
 *
 * ## user_totp_recovery_codes
 *
 * 認証アプリを入れた端末を失くすと本人はログインできなくなる。管理者リセット(2FA を消す)は
 * 用意するが、それだけだと「管理者が居ない時間帯は誰も入れない」「管理者本人が失くしたら詰む」。
 * そこで有効化時に **10 個の単回使用コード**を発行し、1度だけ表示する。
 *
 * 保存はパスワードリセットトークン(password_resets.ts)と同じ作法で **SHA-256 のみ**。
 * 平文は DB に残さない。`consumed_at` が入った行は使用済み(**削除しない** — 「いつ使われたか」は
 * 事故調査の材料になるため。追記寄りの扱いにする)。
 * 再生成は既存行を全削除して 10 本入れ直す(古いコードは即座に無効。docs/design/two-factor-auth.md)。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const userTotp = sqliteTable(
  "user_totp",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** 共有鍵(base32)。"enc:v1:..." で暗号化して保存する */
    secretEncrypted: text("secret_encrypted").notNull(),
    /** null = セットアップ中(未確認)。UTC エポック分 */
    enabledAt: integer("enabled_at"),
    /** 最後に受理した TOTP カウンタ(リプレイ防止)。null = まだ1度も受理していない */
    lastUsedCounter: integer("last_used_counter"),
    /** UTC エポック分 */
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("user_totp_tenant_idx").on(table.tenantId)],
);

export const userTotpRecoveryCodes = sqliteTable(
  "user_totp_recovery_codes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** リカバリコードの SHA-256(hex)。平文は保存しない */
    codeHash: text("code_hash").notNull(),
    /** null = 未使用。UTC エポック分 */
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    // 照合は (user_id, code_hash) で行う。全テナント横断の UNIQUE にはしない
    // (別人のコードと衝突したときに「他人の存在」が制約違反として漏れるのを避ける)。
    uniqueIndex("user_totp_recovery_codes_user_hash_idx").on(table.userId, table.codeHash),
    index("user_totp_recovery_codes_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);
