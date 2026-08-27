/**
 * テナントの初期構築(bootstrap)を1か所にまとめたモジュール。
 *
 * 元は apps/api/src/seed.ts が「開発用シード」として抱えていた処理だが、v1.0 の
 * マルチテナント有効化(運用者が2社目以降のテナントを作れること)に伴い、
 * seed(`pnpm seed`)と create-tenant(`pnpm create-tenant`)の両方から使う共通処理として
 * 切り出した。同梱プリセットの権限表をコピーせずに済ませることが主目的
 * (カタログに権限が増えたとき、追従漏れが起きる箇所を1つにする)。
 *
 * 提供するもの:
 * - ADMIN_GRANTS / MANAGER_GRANTS / MEMBER_GRANTS(同梱プリセット3種の権限割当表)
 * - bootstrapTenant(): テナント + 既定設定版 + 既定 work policy + 同梱プリセット + 管理者ユーザー
 * - syncSystemPresetGrants(): 既存テナントの同梱プリセットへカタログ追加分の権限を追記
 * - findTenantsByName() / findUserByEmailInTenant(): CLI の冪等判定用
 */

import { and, eq } from "drizzle-orm";
import {
  authCredentials,
  permissionPresets,
  presetAssignments,
  tenantSettingVersions,
  tenants,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  workPolicyVersions,
  type Database,
  type MemberUser,
  type Tenant,
} from "@kizami/db";
import { hashPassword } from "../auth/password.js";

export interface Grant {
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
export const ADMIN_GRANTS: Grant[] = (
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
    // 退職者の個人データ消去(2026-08-27 追加、docs/design/data-retention.md)。
    // 同梱プリセットでは管理者のみ — マネージャーには渡さない(カタログ上 TENANT_ONLY であり、
    // マネージャーの grants は department_and_descendants で組み立てているため技術的にも載らない)。
    "member.erase",
    "department.manage",
    "tenant_settings.calendar.manage",
    "tenant_settings.flex.manage",
    "tenant_settings.gps.manage",
    "tenant_settings.auto_deduction.manage",
    "tenant_settings.auth.manage",
    "notification.settings.manage",
    "permission.preset.manage",
    "permission.assignment.manage",
    "audit_log.view",
    "api_key.manage",
    // 承認フロー(多段承認)の設定。2026-08-24 追加(docs/design/approval-flows.md)。
    // 管理者のみ — マネージャーには渡さない(自部署の承認を自分で1段に緩められないようにする)。
    "approval_flow.manage",
  ] as const
).map((key) => ({ key, scope: "tenant" }));

export const MANAGER_GRANTS: Grant[] = (
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
export const MEMBER_GRANTS: Grant[] = [];

export interface BootstrapTenantParams {
  /** テナント(会社)名 */
  tenantName: string;
  /** 管理者のメールアドレス */
  adminEmail: string;
  /** 管理者の初期パスワード(平文。ここでハッシュ化する) */
  adminPassword: string;
  /** 管理者の表示名(既定 "管理者") */
  adminName?: string;
  /** 作成時刻(UTC エポック分)。省略時は現在時刻。テストが固定値を渡せるようにしてある */
  now?: number;
}

export interface BootstrapTenantResult {
  tenantId: string;
  userId: string;
  /** 「管理者」プリセットの id(呼び出し側が追加の割当を行いたい場合のため) */
  adminPresetId: string;
  workPolicyId: string;
}

/**
 * テナントを1件、業務が回る最小構成で作る。
 *
 * 作るもの: tenants / tenant_setting_versions(既定) / work_policies + work_policy_versions
 * (標準フレックス・月清算・1日480分) / 管理者ユーザー + auth_credentials + 制度割当 /
 * 同梱プリセット3種 + 管理者への割当。
 *
 * 既存ユーザーの有無は**確認しない**(呼び出し側の責務)。同じメールで2回呼べば
 * (tenant_id, email) が異なるため両方作られてしまうので、CLI 側で必ず冪等判定を行うこと。
 */
export async function bootstrapTenant(db: Database, params: BootstrapTenantParams): Promise<BootstrapTenantResult> {
  const now = params.now ?? Math.floor(Date.now() / 60_000);

  const tenantId = uuidv7();
  await db.insert(tenants).values({ id: tenantId, name: params.tenantName, createdAt: now });

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
    email: params.adminEmail,
    name: params.adminName ?? "管理者",
    isActive: true,
    createdAt: now,
  });

  const passwordHash = await hashPassword(params.adminPassword);
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

  return { tenantId, userId, adminPresetId, workPolicyId };
}

/**
 * システムプリセット(isSystem=true、名前で識別)の grants に、コード側の定義
 * (ADMIN_GRANTS / MANAGER_GRANTS / MEMBER_GRANTS)に存在して DB 側に無いものを追加する。
 * 既存の grant は一切変更・削除しない(scope の変更もしない)。
 *
 * 権限カタログに項目が増えたとき(例: 2026-08-23 の shift.manage)、既存テナントの
 * 「管理者」「マネージャー」プリセットに新権限を付ける経路がこれしか無い —
 * システムプリセットは UI から編集できない(固定原則)ため。追加のみで削除はしない
 * (運用側が意図的に外した権限を勝手に戻さない。同梱プリセットは編集不可なので実際には
 * 差分は常に「カタログ追加分」)。
 *
 * @returns プリセット名ごとに追加した権限キー(何も追加しなかったプリセットは含まない)
 */
export async function syncSystemPresetGrants(db: Database, tenantId: string): Promise<Map<string, string[]>> {
  const expected: Record<string, Grant[]> = {
    管理者: ADMIN_GRANTS,
    マネージャー: MANAGER_GRANTS,
    メンバー: MEMBER_GRANTS,
  };
  const added = new Map<string, string[]>();
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
    added.set(
      row.name,
      missing.map((g) => g.key),
    );
  }
  return added;
}

/** 名前が完全一致するテナントを列挙する(テナント名にユニーク制約は無いため複数あり得る)。 */
export async function findTenantsByName(db: Database, name: string): Promise<Tenant[]> {
  return db.select().from(tenants).where(eq(tenants.name, name));
}

/** テナント内の同一メールのユーザー(ユニーク制約 tenant_id+email により最大1件)。 */
export async function findUserByEmailInTenant(db: Database, tenantId: string, email: string): Promise<MemberUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
    .limit(1);
  return rows[0] ?? null;
}

/** メールアドレスで(テナント横断で)ユーザーを探す。seed の「既に存在する」判定用。 */
export async function findUsersByEmail(db: Database, email: string): Promise<MemberUser[]> {
  return db.select().from(users).where(eq(users.email, email));
}
