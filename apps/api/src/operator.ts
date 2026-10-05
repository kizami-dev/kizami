/**
 * 運用者 CLI(`pnpm operator`)。KIZAMI Cloud の運用者作業の入口(docs/design/saas.md)。
 *
 * ```sh
 * pnpm --filter @kizami/api operator invite-code create [--max-uses N] [--expires-days D] [--note TEXT]
 * pnpm --filter @kizami/api operator invite-code list
 * pnpm --filter @kizami/api operator invite-code revoke <id>
 * pnpm --filter @kizami/api operator tenant list
 * pnpm --filter @kizami/api operator tenant purge <tenant-id> [--confirm <tenant-id>] [--after-restore]
 * pnpm --filter @kizami/api operator tenant purges
 * pnpm --filter @kizami/api operator tenant sync-presets
 * ```
 *
 * - DATABASE_URL (既定 "file:./kizami.db")
 * - `invite-code create` は平文のコードを**この1回だけ**表示する(DB にはハッシュしか残らず、
 *   後から取り出せない)。`list` に平文は出ない
 * - suspend・プラン上書きは Phase 2(課金)で作る。ここには無い
 * - `tenant purge` は**退会を申請したテナント**を、削除予定の時刻(申請から30日)を待たずに今すぐ
 *   物理削除する(docs/design/tenant-withdrawal.md)。申請していないテナントは消せない。確認として
 *   テナント id の再入力を求める(対話。`--confirm <tenant-id>` で対話を省ける)。システムメールの
 *   環境変数があれば、管理者へ削除の完了のメールも送る(定期ジョブと同じ)
 * - `tenant purge --after-restore` はバックアップから復元した後、復元の前に削除済みだったテナントを
 *   削除し直す(申請していない状態に戻っていても削除できる。メールは送らない。deploy/k8s-cloud/README.md)
 * - `tenant purges` は削除の記録(テナント id・申請日時・削除日時・行数。個人情報は含まない)の一覧
 * - `tenant sync-presets` は全テナントの同梱プリセットへ、権限カタログに増えた権限を追記する
 *   (既存テナントの「管理者」に tenant.withdraw を届ける等)
 *
 * 処理の本体は lib/operator-commands.ts(テスト可能にするため切り出してある)。ここは
 * 引数の解釈と出力だけ。create-tenant.ts と同じく DB はマイグレーション適用済みで開く。
 */

import { createInterface } from "node:readline/promises";
import { migrateDb } from "@kizami/db/node";
import {
  createInviteCode,
  describePurgeCandidate,
  formatMinutesUtc,
  intArg,
  argValue,
  listInviteCodes,
  listPurgeRecords,
  listTenants,
  purgeTenantNow,
  revokeInviteCode,
  syncPresetsForAllTenants,
} from "./lib/operator-commands.js";
import { createSystemMailSender } from "./lib/system-mail.js";
import { parseSystemMailEnv } from "./lib/system-mail-config.js";
import { formatJstDateTime } from "./lib/tenant-withdrawal.js";
import { nowMinutes } from "./lib/time.js";

const USAGE = `usage:
  operator invite-code create [--max-uses N] [--expires-days D] [--note TEXT]
  operator invite-code list
  operator invite-code revoke <id>
  operator tenant list
  operator tenant purge <tenant-id> [--confirm <tenant-id>] [--after-restore]
  operator tenant purges
  operator tenant sync-presets`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [group, action, ...rest] = argv;
  const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

  const known =
    (group === "invite-code" && ["create", "list", "revoke"].includes(action ?? "")) ||
    (group === "tenant" && ["list", "purge", "purges", "sync-presets"].includes(action ?? ""));
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

  if (group === "tenant" && action === "purge") {
    // tenant id は最初の位置引数(`--confirm <id>` と同じ値になるので、値で探すと取り違える)
    const tenantId = rest[0] !== undefined && !rest[0].startsWith("--") ? rest[0] : undefined;
    if (!tenantId) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    const candidate = await describePurgeCandidate(db, tenantId);
    if (!candidate) {
      console.error(`no tenant with id ${tenantId} (already purged? see: operator tenant purges)`);
      process.exitCode = 1;
      return;
    }
    const afterRestore = rest.includes("--after-restore");
    if (!candidate.withdrawing && !afterRestore) {
      console.error(`tenant ${tenantId} has not requested withdrawal. Only tenants in withdrawal can be purged.`);
      process.exitCode = 1;
      return;
    }
    console.log(`tenant:            ${candidate.id}  ${candidate.name}`);
    console.log(`requested at:      ${candidate.requestedAt === null ? "-" : formatJstDateTime(candidate.requestedAt)} JST`);
    console.log(`scheduled purge:   ${candidate.scheduledPurgeAt === null ? "-" : formatJstDateTime(candidate.scheduledPurgeAt)} JST`);
    console.log("This permanently deletes ALL rows of this tenant now. It cannot be undone.");
    let confirmation = argValue(rest, "confirm");
    if (confirmation === undefined) {
      if (!process.stdin.isTTY) {
        console.error("refusing to purge without confirmation (pass --confirm <tenant-id> when not running interactively)");
        process.exitCode = 1;
        return;
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      confirmation = await rl.question("Type the tenant id again to confirm: ");
      rl.close();
    }
    const systemMail = parseSystemMailEnv(process.env).config;
    const result = await purgeTenantNow(db, {
      tenantId,
      confirmTenantId: confirmation,
      nowMinutes: now,
      afterRestore,
      mailer:
        systemMail !== null
          ? { appBaseUrl: systemMail.appBaseUrl, sendMail: createSystemMailSender({ smtpUrl: systemMail.systemSmtpUrl, from: systemMail.systemMailFrom }) }
          : null,
    });
    if (result.status === "confirmation_mismatch") {
      console.error("confirmation did not match. Nothing was deleted.");
      process.exitCode = 1;
      return;
    }
    if (result.status === "purged" || result.status === "already_purged") {
      console.log(`${result.status === "purged" ? "purged" : "already purged"} tenant ${tenantId} (rows: ${result.record.deletedCounts})`);
      if (result.status === "purged") console.log(`completion mails sent: ${result.mailsSent}`);
      return;
    }
    console.error(`could not purge tenant ${tenantId}: ${result.status}`);
    process.exitCode = 1;
    return;
  }

  if (group === "tenant" && action === "purges") {
    const records = await listPurgeRecords(db);
    console.log(["tenant id", "requested(UTC)", "purge started(UTC)", "purged(UTC)", "rows"].join("\t"));
    for (const r of records) {
      console.log(
        [r.tenantId, formatMinutesUtc(r.withdrawalRequestedAt), formatMinutesUtc(r.purgeStartedAt), r.purgedAt === null ? "INCOMPLETE" : formatMinutesUtc(r.purgedAt), String(r.totalRows)].join("\t"),
      );
    }
    return;
  }

  if (group === "tenant" && action === "sync-presets") {
    const synced = await syncPresetsForAllTenants(db);
    for (const { tenantId, added } of synced) {
      for (const [presetName, keys] of added) console.log(`${tenantId} preset ${presetName}: added ${keys.join(", ")}`);
    }
    console.log(`synced system presets (${synced.length} tenant(s) changed)`);
    return;
  }

  // tenant list
  const tenants = await listTenants(db);
  console.log(["id", "name", "created(UTC)", "active users", "withdrawal"].join("\t"));
  for (const t of tenants) {
    const withdrawal = t.withdrawalScheduledPurgeAt === null ? "-" : `purge after ${formatMinutesUtc(t.withdrawalScheduledPurgeAt)} UTC`;
    console.log([t.id, t.name, formatMinutesUtc(t.createdAt), String(t.activeUserCount), withdrawal].join("\t"));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
