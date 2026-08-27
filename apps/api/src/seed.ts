/**
 * 開発用シード投入 CLI(`pnpm seed`)。
 *
 * 環境変数:
 * - SEED_EMAIL / SEED_PASSWORD (必須)
 * - SEED_TENANT_NAME (既定 "dev")
 * - DATABASE_URL (既定 "file:./kizami.db")
 *
 * SEED_EMAIL のユーザーが既に存在する場合は新規作成をスキップし、同梱(システム)プリセットの
 * 権限だけを同期する(冪等)。
 *
 * 2社目以降のテナントを作る用途にはこれではなく create-tenant.ts(`pnpm create-tenant`)を
 * 使うこと。実処理はどちらも src/lib/tenant-bootstrap.ts に集約してある。
 */

import { migrateDb } from "@kizami/db/node";
import { bootstrapTenant, findUsersByEmail, syncSystemPresetGrants } from "./lib/tenant-bootstrap.js";

async function main(): Promise<void> {
  const seedEmail = process.env.SEED_EMAIL;
  const seedPassword = process.env.SEED_PASSWORD;
  const seedTenantName = process.env.SEED_TENANT_NAME ?? "dev";
  const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

  if (!seedEmail || !seedPassword) {
    console.error("SEED_EMAIL and SEED_PASSWORD environment variables are required");
    process.exitCode = 1;
    return;
  }

  const { db } = await migrateDb({ url: databaseUrl });

  const existing = await findUsersByEmail(db, seedEmail);
  const first = existing[0];
  if (first) {
    // 既存環境: 初回シードはスキップするが、同梱プリセットの権限だけは同期する
    // (理由は syncSystemPresetGrants の docstring を参照)。
    const added = await syncSystemPresetGrants(db, first.tenantId);
    for (const [presetName, keys] of added) {
      console.log(`preset ${presetName}: added ${keys.join(", ")}`);
    }
    console.log(`user ${seedEmail} already exists, skipped seed (system preset grants synced)`);
    return;
  }

  const { tenantId } = await bootstrapTenant(db, {
    tenantName: seedTenantName,
    adminEmail: seedEmail,
    adminPassword: seedPassword,
  });

  console.log(`seeded tenant "${seedTenantName}" (${tenantId}) with admin user ${seedEmail}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
