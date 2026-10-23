/**
 * 保存済みの秘密情報の再暗号化(src/reencrypt-secrets.ts の中身。CLI は引数の解釈と出力だけ)。
 *
 * 用途は 2 つ:
 * - **鍵のローテーション後の仕上げ**: 旧鍵(KIZAMI_ENCRYPTION_KEYS_PREVIOUS)でしか読めない値を、
 *   現行鍵の v2 で保存し直す。全部 `rewrite=0` になれば旧鍵を外せる。
 * - **v1 → v2 の一括移行 / 平文の暗号化**(ローテーションしなくてもよい)。
 *
 * 対象は暗号化して保存する全カラム(`encrypt(` の呼び出し元 = routes/settings/*・
 * notification-preferences.ts・auth-totp.ts に対応)。各行の文脈(secretContext.*)はその行自身の
 * tenantId / userId から組み立てる — 行を取り違えた値は読めない(AAD)ので、読めた値だけを直す。
 *
 * 安全側の振る舞い:
 * - どの鍵でも読めない値(`unreadable`)は**触らない**(鍵を戻せば読めるかもしれないため)。
 * - UPDATE は旧値との比較つき(compare-and-set)。CLI の実行中に管理画面から保存し直された行は
 *   上書きせず `conflict` に数える。
 * - 書き込む前に、新しい値を現行鍵で読み戻して平文と一致することを確かめる。
 * - 平文・暗号文・ID は戻り値にもログにも出さない(件数だけ)。
 */

import { and, eq } from "drizzle-orm";
import {
  tenantNotificationSettings,
  tenantOidcSettings,
  tenantSlackSettings,
  userNotificationSettings,
  userTotp,
  type Database,
} from "@kizami/db";
import { secretContext, type EncryptionContext, type InspectableEncryptor } from "./encryption.js";

/** 1 カラム分の集計。 */
export interface ColumnReport {
  /** 非 NULL(かつ空でない)の値の数 */
  total: number;
  /** すでに現行鍵の v2 で、何もしなくてよい */
  ok: number;
  /** 書き直しが要る(平文 / v1 / 旧鍵の v2)。dry-run ではここまで */
  rewrite: number;
  /** どの鍵でも読めない。触らない */
  unreadable: number;
  /** --apply で実際に書き換えた数 */
  rewritten: number;
  /** --apply 中に値が変わっていて(compare-and-set に負けて)書き換えなかった数 */
  conflict: number;
}

export type ReencryptReport = Record<string, ColumnReport>;

interface SecretRow {
  stored: string;
  ctx: EncryptionContext;
  /** 旧値が `expected` のままのときだけ新値を書く。書けたら true */
  write(expected: string, next: string): Promise<boolean>;
}

interface ColumnSpec {
  /** `<table>.<column>` */
  name: string;
  load(db: Database): Promise<SecretRow[]>;
}

/** CAS 付き UPDATE の結果(`.returning()` の行が 1 つあれば書けた)を真偽にする。 */
const wrote = (rows: unknown[]): boolean => rows.length > 0;

const COLUMNS: ColumnSpec[] = [
  {
    name: "user_totp.secret_encrypted",
    async load(db) {
      const t = userTotp;
      const rows = await db.select({ userId: t.userId, tenantId: t.tenantId, v: t.secretEncrypted }).from(t);
      return rows.map((r) => ({
        stored: r.v,
        ctx: secretContext.totpSecret(r.tenantId, r.userId),
        write: async (expected, next) =>
          wrote(await db.update(t).set({ secretEncrypted: next }).where(and(eq(t.userId, r.userId), eq(t.secretEncrypted, expected))).returning({ k: t.userId })),
      }));
    },
  },
  {
    name: "tenant_notification_settings.webhook_url",
    async load(db) {
      const t = tenantNotificationSettings;
      const rows = await db.select({ tenantId: t.tenantId, v: t.webhookUrl }).from(t);
      return rows.flatMap((r) =>
        r.v
          ? [
              {
                stored: r.v,
                ctx: secretContext.tenantWebhookUrl(r.tenantId),
                write: async (expected: string, next: string) =>
                  wrote(await db.update(t).set({ webhookUrl: next }).where(and(eq(t.tenantId, r.tenantId), eq(t.webhookUrl, expected))).returning({ k: t.tenantId })),
              },
            ]
          : [],
      );
    },
  },
  {
    name: "tenant_notification_settings.smtp_password",
    async load(db) {
      const t = tenantNotificationSettings;
      const rows = await db.select({ tenantId: t.tenantId, v: t.smtpPassword }).from(t);
      return rows.flatMap((r) =>
        r.v
          ? [
              {
                stored: r.v,
                ctx: secretContext.tenantSmtpPassword(r.tenantId),
                write: async (expected: string, next: string) =>
                  wrote(await db.update(t).set({ smtpPassword: next }).where(and(eq(t.tenantId, r.tenantId), eq(t.smtpPassword, expected))).returning({ k: t.tenantId })),
              },
            ]
          : [],
      );
    },
  },
  {
    name: "user_notification_settings.webhook_url",
    async load(db) {
      const t = userNotificationSettings;
      const rows = await db.select({ tenantId: t.tenantId, userId: t.userId, v: t.webhookUrl }).from(t);
      return rows.flatMap((r) =>
        r.v
          ? [
              {
                stored: r.v,
                ctx: secretContext.userWebhookUrl(r.tenantId, r.userId),
                write: async (expected: string, next: string) =>
                  wrote(
                    await db
                      .update(t)
                      .set({ webhookUrl: next })
                      .where(and(eq(t.tenantId, r.tenantId), eq(t.userId, r.userId), eq(t.webhookUrl, expected)))
                      .returning({ k: t.userId }),
                  ),
              },
            ]
          : [],
      );
    },
  },
  {
    name: "tenant_slack_settings.signing_secret",
    async load(db) {
      const t = tenantSlackSettings;
      const rows = await db.select({ tenantId: t.tenantId, v: t.signingSecret }).from(t);
      return rows.flatMap((r) =>
        r.v
          ? [
              {
                stored: r.v,
                ctx: secretContext.slackSigningSecret(r.tenantId),
                write: async (expected: string, next: string) =>
                  wrote(await db.update(t).set({ signingSecret: next }).where(and(eq(t.tenantId, r.tenantId), eq(t.signingSecret, expected))).returning({ k: t.tenantId })),
              },
            ]
          : [],
      );
    },
  },
  {
    name: "tenant_oidc_settings.client_secret",
    async load(db) {
      const t = tenantOidcSettings;
      const rows = await db.select({ tenantId: t.tenantId, v: t.clientSecret }).from(t);
      return rows.flatMap((r) =>
        r.v
          ? [
              {
                stored: r.v,
                ctx: secretContext.oidcClientSecret(r.tenantId),
                write: async (expected: string, next: string) =>
                  wrote(await db.update(t).set({ clientSecret: next }).where(and(eq(t.tenantId, r.tenantId), eq(t.clientSecret, expected))).returning({ k: t.tenantId })),
              },
            ]
          : [],
      );
    },
  },
];

/** 再暗号化の対象カラム名(`<table>.<column>`)。出力・テストの見出しに使う。 */
export const REENCRYPT_COLUMNS: readonly string[] = COLUMNS.map((c) => c.name);

/**
 * 全対象カラムを走査して、書き直しが要る値を現行鍵の v2 で保存し直す。
 * `apply: false` なら何も書かず件数だけ返す(dry-run)。
 */
export async function reencryptSecrets(
  db: Database,
  encryptor: InspectableEncryptor,
  options: { apply: boolean },
): Promise<ReencryptReport> {
  const report: ReencryptReport = {};
  for (const column of COLUMNS) {
    const counts: ColumnReport = { total: 0, ok: 0, rewrite: 0, unreadable: 0, rewritten: 0, conflict: 0 };
    report[column.name] = counts;

    for (const row of await column.load(db)) {
      counts.total++;
      const { plain, needsRewrite } = await encryptor.decryptWithInfo(row.stored, row.ctx);
      if (plain === null) {
        counts.unreadable++;
        continue;
      }
      if (!needsRewrite) {
        counts.ok++;
        continue;
      }
      counts.rewrite++;
      if (!options.apply) continue;

      const next = await encryptor.encrypt(plain, row.ctx);
      // 書く前に読み戻して確かめる(暗号化側の不具合で秘密を壊さない)
      if ((await encryptor.decrypt(next, row.ctx)) !== plain) {
        throw new Error(`reencrypt-secrets: round-trip check failed for ${column.name}; aborting without writing`);
      }
      if (await row.write(row.stored, next)) counts.rewritten++;
      else counts.conflict++;
    }
  }
  return report;
}
