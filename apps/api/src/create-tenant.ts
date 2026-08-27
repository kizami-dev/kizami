/**
 * テナント作成 CLI(`pnpm create-tenant`)。
 *
 * v1.0「マルチテナント有効化」で追加(2026-08-24)。1インスタンスに2社目以降のテナントを
 * 運用者が作るための唯一の経路 — セルフサインアップ(自由登録)は提供しない
 * (docs/requirements.md §7)。作成後のメンバー追加は招待フロー(POST /members)で行う。
 *
 * 使い方(環境変数、または同名の引数):
 *
 * ```sh
 * TENANT_NAME='株式会社サンプル' ADMIN_EMAIL='admin@example.com' ADMIN_PASSWORD='...' \
 *   node_modules/.bin/tsx src/create-tenant.ts
 * # 引数でも指定できる(環境変数より優先):
 * node_modules/.bin/tsx src/create-tenant.ts --name '株式会社サンプル' --email admin@example.com --password '...'
 * ```
 *
 * - DATABASE_URL (既定 "file:./kizami.db")
 * - ADMIN_NAME (既定 "管理者") — 管理者ユーザーの表示名
 *
 * 冪等性: TENANT_NAME のテナントに ADMIN_EMAIL のユーザーが既に居れば、何もせずその旨を
 * 表示して終了する(exit 0)。同名テナントが存在するのに ADMIN_EMAIL が居ない場合は、
 * 取り違え(同じ会社に2つ目のテナントを作ってしまう事故)を避けるため既定ではエラーにする。
 * 意図的に同名の別テナントを作りたい場合のみ ALLOW_DUPLICATE_TENANT_NAME=true を付ける。
 */

import { migrateDb } from "@kizami/db/node";
import { bootstrapTenant, findTenantsByName, findUserByEmailInTenant } from "./lib/tenant-bootstrap.js";

/** `--name X` / `--name=X` 形式の引数を読む(環境変数より優先)。 */
function argValue(argv: string[], flag: string): string | undefined {
  const prefixed = argv.find((a) => a.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 3);
  const index = argv.indexOf(`--${flag}`);
  if (index >= 0) return argv[index + 1];
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const tenantName = argValue(argv, "name") ?? process.env.TENANT_NAME;
  const adminEmail = argValue(argv, "email") ?? process.env.ADMIN_EMAIL;
  const adminPassword = argValue(argv, "password") ?? process.env.ADMIN_PASSWORD;
  const adminName = argValue(argv, "admin-name") ?? process.env.ADMIN_NAME;
  const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";
  const allowDuplicateName = process.env.ALLOW_DUPLICATE_TENANT_NAME === "true";

  if (!tenantName || !adminEmail || !adminPassword) {
    console.error("TENANT_NAME, ADMIN_EMAIL and ADMIN_PASSWORD are required (env vars or --name/--email/--password)");
    process.exitCode = 1;
    return;
  }

  const { db } = await migrateDb({ url: databaseUrl });

  const sameName = await findTenantsByName(db, tenantName);
  for (const tenant of sameName) {
    const existingUser = await findUserByEmailInTenant(db, tenant.id, adminEmail);
    if (existingUser) {
      console.log(`tenant "${tenantName}" (${tenant.id}) already has user ${adminEmail} — nothing to do`);
      return;
    }
  }
  if (sameName.length > 0 && !allowDuplicateName) {
    console.error(
      `a tenant named "${tenantName}" already exists (${sameName.map((t) => t.id).join(", ")}) but has no user ${adminEmail}.\n` +
        "Add the administrator to the existing tenant through the invitation flow, use a different TENANT_NAME, " +
        "or set ALLOW_DUPLICATE_TENANT_NAME=true to deliberately create a separate tenant with the same name.",
    );
    process.exitCode = 1;
    return;
  }

  const { tenantId, userId } = await bootstrapTenant(db, {
    tenantName,
    adminEmail,
    adminPassword,
    ...(adminName ? { adminName } : {}),
  });

  console.log(`created tenant "${tenantName}" (${tenantId}) with admin user ${adminEmail} (${userId})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
