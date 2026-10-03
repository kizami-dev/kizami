/**
 * 運用者 CLI(`pnpm operator`)。KIZAMI Cloud の運用者作業の入口(docs/design/saas.md)。
 *
 * ```sh
 * pnpm --filter @kizami/api operator invite-code create [--max-uses N] [--expires-days D] [--note TEXT]
 * pnpm --filter @kizami/api operator invite-code list
 * pnpm --filter @kizami/api operator invite-code revoke <id>
 * pnpm --filter @kizami/api operator tenant list
 * ```
 *
 * - DATABASE_URL (既定 "file:./kizami.db")
 * - `invite-code create` は平文のコードを**この1回だけ**表示する(DB にはハッシュしか残らず、
 *   後から取り出せない)。`list` に平文は出ない
 * - suspend・プラン上書きは Phase 2(課金)で作る。ここには無い
 *
 * 処理の本体は lib/operator-commands.ts(テスト可能にするため切り出してある)。ここは
 * 引数の解釈と出力だけ。create-tenant.ts と同じく DB はマイグレーション適用済みで開く。
 */

import { migrateDb } from "@kizami/db/node";
import {
  createInviteCode,
  formatMinutesUtc,
  intArg,
  argValue,
  listInviteCodes,
  listTenants,
  revokeInviteCode,
} from "./lib/operator-commands.js";
import { nowMinutes } from "./lib/time.js";

const USAGE = `usage:
  operator invite-code create [--max-uses N] [--expires-days D] [--note TEXT]
  operator invite-code list
  operator invite-code revoke <id>
  operator tenant list`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [group, action, ...rest] = argv;
  const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

  const known = (group === "invite-code" && ["create", "list", "revoke"].includes(action ?? "")) || (group === "tenant" && action === "list");
  if (!known) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const { db } = await migrateDb({ url: databaseUrl });
  const now = nowMinutes();

  if (group === "invite-code" && action === "create") {
    const maxUses = intArg(rest, "max-uses");
    const expiresInDays = intArg(rest, "expires-days");
    const note = argValue(rest, "note");
    const { plainCode, row } = await createInviteCode(db, {
      nowMinutes: now,
      ...(maxUses !== undefined ? { maxUses } : {}),
      ...(expiresInDays !== undefined ? { expiresInDays } : {}),
      ...(note !== undefined ? { note } : {}),
    });
    console.log(`invite code: ${plainCode}`);
    console.log(`  id:       ${row.id}`);
    console.log(`  max uses: ${row.maxUses}`);
    console.log(`  expires:  ${row.expiresAt === null ? "never" : `${formatMinutesUtc(row.expiresAt)} UTC`}`);
    console.log("This code is shown only once. It cannot be recovered later (only its hash is stored).");
    return;
  }

  if (group === "invite-code" && action === "list") {
    const rows = await listInviteCodes(db, { nowMinutes: now });
    console.log(["id", "status", "used/max", "expires(UTC)", "note"].join("\t"));
    for (const r of rows) {
      console.log(
        [r.id, r.status, `${r.usedCount}/${r.maxUses}`, r.expiresAt === null ? "-" : formatMinutesUtc(r.expiresAt), r.note ?? ""].join("\t"),
      );
    }
    return;
  }

  if (group === "invite-code" && action === "revoke") {
    const id = rest[0];
    if (!id) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    const revoked = await revokeInviteCode(db, { id, nowMinutes: now });
    if (!revoked) {
      console.error(`no active invite code with id ${id} (not found, or already revoked)`);
      process.exitCode = 1;
      return;
    }
    console.log(`revoked invite code ${id}`);
    return;
  }

  // tenant list
  const tenants = await listTenants(db);
  console.log(["id", "name", "created(UTC)", "active users"].join("\t"));
  for (const t of tenants) {
    console.log([t.id, t.name, formatMinutesUtc(t.createdAt), String(t.activeUserCount)].join("\t"));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
