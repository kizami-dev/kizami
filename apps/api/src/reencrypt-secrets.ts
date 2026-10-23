/**
 * 秘密情報の再暗号化 CLI(`pnpm reencrypt-secrets`)。暗号化鍵のローテーションの仕上げ、
 * または v1 → v2・平文 → 暗号化の一括移行に使う。手順は deploy/k8s/README.md「鍵のローテーション」。
 *
 * ```sh
 * pnpm --filter @kizami/api reencrypt-secrets            # dry-run(既定。何も書かない)
 * pnpm --filter @kizami/api reencrypt-secrets --apply    # 実際に書き換える
 * ```
 *
 * - DATABASE_URL (既定 "file:./kizami.db")。`postgres://` なら PostgreSQL、それ以外は SQLite(libSQL)
 * - KIZAMI_ENCRYPTION_KEY(現行鍵・必須)と、ローテーション中は KIZAMI_ENCRYPTION_KEYS_PREVIOUS
 *   (旧鍵)を、アプリと同じ値で環境に置いて実行する(Pod 内で動かせばそのまま揃っている)
 * - 平文・v1・旧鍵で読めた値を、現行鍵の v2(行ごとの文脈つき)へ書き直す。すでに現行鍵の v2 の値、
 *   どの鍵でも読めない値(`unreadable`)には触らない。読めない値があっても exit 0(警告だけ出す)。
 *   終了コードが 0 以外になるのは鍵の未設定・DB エラーなどの異常のときだけ
 * - 出力はカラムごとの件数(ok / rewrite / unreadable / rewritten / conflict)だけ。値や ID は出さない
 * - **Cloudflare D1(Workers)の配備は対象外**。この CLI は DATABASE_URL で繋ぐ Node 用で、D1 には
 *   接続しない(operator.ts も同じ)。Workers 配備の鍵ローテーションは docs/design/workers-d1.md を参照
 */

import { migrateDb } from "@kizami/db/node";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { reencryptSecrets } from "./lib/reencrypt-secrets.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.some((a) => a !== "--apply" && a !== "--dry-run")) {
    console.error("usage: reencrypt-secrets [--apply]   (default: dry-run; nothing is written)");
    process.exitCode = 1;
    return;
  }
  const apply = argv.includes("--apply");

  const encryptor = buildEncryptorFromEnv();
  if (!encryptor) {
    console.error("KIZAMI_ENCRYPTION_KEY is not set or invalid; cannot re-encrypt");
    process.exitCode = 1;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";
  const { db, client } = await migrateDb({ url: databaseUrl });
  try {
    const report = await reencryptSecrets(db, encryptor, { apply });

    console.log(apply ? "mode: apply" : "mode: dry-run (nothing written; pass --apply to rewrite)");
    let unreadable = 0;
    let conflict = 0;
    for (const [column, c] of Object.entries(report)) {
      console.log(
        `${column}: ok=${c.ok} rewrite=${c.rewrite} unreadable=${c.unreadable}${apply ? ` rewritten=${c.rewritten} conflict=${c.conflict}` : ""}`,
      );
      unreadable += c.unreadable;
      conflict += c.conflict;
    }
    if (unreadable > 0) {
      console.warn(
        `WARNING: ${unreadable} value(s) cannot be decrypted with any configured key and were left untouched. ` +
          "Check that KIZAMI_ENCRYPTION_KEYS_PREVIOUS holds the old key(s); do not remove the previous key while unreadable > 0 " +
          "unless those values are meant to be re-entered.",
      );
    }
    if (conflict > 0) {
      console.warn(`WARNING: ${conflict} value(s) changed while running and were skipped. Run again to pick them up.`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("reencrypt-secrets failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
