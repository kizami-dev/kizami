/**
 * 開発用シード投入 CLI(`pnpm seed`)。
 *
 * 環境変数:
 * - SEED_EMAIL / SEED_PASSWORD (必須)
 * - SEED_TENANT_NAME (既定 "dev")
 * - DATABASE_URL (既定 "file:./kizami.db")
 *
 * SEED_EMAIL のユーザーが既に存在する場合は何もせずスキップする(冪等)。
 */

import { eq } from "drizzle-orm";
import {
  authCredentials,
  migrateDb,
  permissionPresets,
  presetAssignments,
  tenantSettingVersions,
  tenants,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  workPolicyVersions,
} from "@kizami/db";
import { hashPassword } from "./auth/password.js";

interface Grant {
  key: string;
  scope: string;
}

/**
 * docs/design/permission-catalog.md §4「標準プリセット3種の権限割当表」を反映。
 * 表中の「※」(上位権限の ON に伴い自動的に有効になる閲覧権限)はここには含めない
 * (カタログの説明どおり、プリセット上は明示的な追加 ON が不要なため)。
 *
 * scope の文字列表現(tenant / department_and_descendants)はカタログの日本語ラベル
 * (テナント全体 / 自部署+配下部署)をキー化したもので、カタログ自体には定義がない
 * ため実装側で定めた(判断点)。
 */
const ADMIN_GRANTS: Grant[] = (
  [
    "attendance.punch.proxy",
    "attendance.correction.request_for_others",
    "attendance.correction.approve",
    "attendance.record.view",
    "shift.manage",
    "leave.request.approve",
    "leave.grant.manage",
    "leave.mandatory_five_days.view",
    "closing.execute",
    "closing.unlock",
    "export.attendance.run",
    "alert.labor_limit.configure",
    "member.invite",
    "member.profile.edit",
    "member.deactivate",
    "department.manage",
    "tenant_settings.calendar.manage",
    "tenant_settings.flex.manage",
    "tenant_settings.gps.manage",
    "tenant_settings.auto_deduction.manage",
    "notification.settings.manage",
    "permission.preset.manage",
    "permission.assignment.manage",
    "audit_log.view",
    "api_key.manage",
  ] as const
).map((key) => ({ key, scope: "tenant" }));

const MANAGER_GRANTS: Grant[] = (
  [
    "attendance.correction.approve",
    "attendance.record.view",
    "shift.manage",
    "leave.request.approve",
    "leave.balance.view",
    "leave.mandatory_five_days.view",
    "closing.view",
    "export.attendance.run",
    "alert.labor_limit.view",
    "member.profile.edit",
    "member.view",
  ] as const
).map((key) => ({ key, scope: "department_and_descendants" }));

/** メンバーはカタログ上の業務タスク権限を一切持たない(セルフサービス権限のみ、常時付与)。 */
const MEMBER_GRANTS: Grant[] = [];

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

  const existing = await db.select().from(users).where(eq(users.email, seedEmail)).limit(1);
  if (existing[0]) {
    // 既存環境: 初回シードはスキップするが、同梱(システム)プリセットの権限だけは同期する。
    // 権限カタログに項目が増えたとき(例: 2026-08-23 の shift.manage)、本番の「管理者」
    // 「マネージャー」プリセットに新権限を付ける経路がこれしか無い — システムプリセットは
    // UI から編集できない(固定原則)ため。追加のみで削除はしない(運用側が意図的に外した
    // 権限を勝手に戻さない。同梱プリセットは編集不可なので実際には差分は常に「カタログ追加分」)。
    await syncSystemPresetGrants(db, existing[0].tenantId);
    console.log(`user ${seedEmail} already exists, skipped seed (system preset grants synced)`);
    return;
  }

  const now = Math.floor(Date.now() / 60_000);

  const tenantId = uuidv7();
  await db.insert(tenants).values({ id: tenantId, name: seedTenantName, createdAt: now });

  await db.insert(tenantSettingVersions).values({
    id: uuidv7(),
    tenantId,
    effectiveFrom: "1970-01-01",
    dayBoundaryMinutes: 0,
    legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
    breakRule: JSON.stringify({ mode: "punch" }),
    gpsEnabled: false,
    gpsRetentionDays: null,
    createdAt: now,
  });

  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId, name: "標準フレックス", createdAt: now });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    settlementPeriod: "monthly",
    core: null,
    standardDayMinutes: 480,
    createdAt: now,
  });

  const userId = uuidv7();
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: seedEmail,
    name: "管理者",
    isActive: true,
    createdAt: now,
  });

  const passwordHash = await hashPassword(seedPassword);
  await db.insert(authCredentials).values({
    id: uuidv7(),
    tenantId,
    userId,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId,
    userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: now,
  });

  const adminPresetId = uuidv7();
  await db.insert(permissionPresets).values([
    {
      id: adminPresetId,
      tenantId,
      name: "管理者",
      description: "全業務タスク権限をテナント全体スコープで保持する同梱プリセット",
      grants: JSON.stringify(ADMIN_GRANTS),
      isSystem: true,
      createdAt: now,
    },
    {
      id: uuidv7(),
      tenantId,
      name: "マネージャー",
      description: "自部署+配下部署スコープでの承認・閲覧権限を持つ同梱プリセット",
      grants: JSON.stringify(MANAGER_GRANTS),
      isSystem: true,
      createdAt: now,
    },
    {
      id: uuidv7(),
      tenantId,
      name: "メンバー",
      description: "業務タスク権限を持たない同梱プリセット(セルフサービス権限は別途常時付与)",
      grants: JSON.stringify(MEMBER_GRANTS),
      isSystem: true,
      createdAt: now,
    },
  ]);

  await db.insert(presetAssignments).values({
    id: uuidv7(),
    tenantId,
    userId,
    presetId: adminPresetId,
    createdAt: now,
  });

  console.log(`seeded tenant "${seedTenantName}" (${tenantId}) with admin user ${seedEmail}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});


/**
 * システムプリセット(isSystem=true、名前で識別)の grants に、コード側の定義
 * (ADMIN_GRANTS / MANAGER_GRANTS / MEMBER_GRANTS)に存在して DB 側に無いものを追加する。
 * 既存の grant は一切変更・削除しない(scope の変更もしない)。
 */
async function syncSystemPresetGrants(db: Awaited<ReturnType<typeof migrateDb>>["db"], tenantId: string): Promise<void> {
  const expected: Record<string, Grant[]> = {
    管理者: ADMIN_GRANTS,
    マネージャー: MANAGER_GRANTS,
    メンバー: MEMBER_GRANTS,
  };
  const rows = await db.select().from(permissionPresets).where(eq(permissionPresets.tenantId, tenantId));
  for (const row of rows) {
    if (!row.isSystem) continue;
    const target = expected[row.name];
    if (!target) continue;
    const current = JSON.parse(row.grants) as Grant[];
    const have = new Set(current.map((g) => g.key));
    const missing = target.filter((g) => !have.has(g.key));
    if (missing.length === 0) continue;
    await db
      .update(permissionPresets)
      .set({ grants: JSON.stringify([...current, ...missing]) })
      .where(eq(permissionPresets.id, row.id));
    console.log(`preset ${row.name}: added ${missing.map((g) => g.key).join(", ")}`);
  }
}
