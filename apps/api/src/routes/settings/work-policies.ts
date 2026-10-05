/**
 * GET /settings/work-policies, POST /settings/work-policies,
 * PATCH /settings/work-policies/:id, POST /settings/work-policies/:id/versions
 *
 * 名前付きの労働時間制の制度(2026-10-05、時短勤務対応の第1段階)。
 *
 * 背景: 以前は「制度の種類(kind = flex / fixed / monthly_variable)ごとにテナント1本」という
 * 運用で、メンバーへの割当は kind を選ぶことで表していた(packages/db/src/queries/work-policies.ts の
 * `getOrCreateTenantWorkPolicyByKind`)。そのため「一般は所定8時間、育児の短時間勤務の人だけ
 * 所定6時間」が表現できなかった(docs/design/saas.md「公開前に塞ぐべき既知のギャップ」の2)。
 * DB(user_policy_assignments は work_policy_id を参照)とエンジン(固定時間制の
 * standardDayMinutes は入力)はもともと複数の制度を扱える作りで、足りなかったのは API と画面。
 *
 * - 制度は名前を持ち、テナント内で名前の重複は不可(409 work_policy_name_taken)。
 *   DB の一意制約にはしない — 既存のテナントに同名の行が残っていてもマイグレーションを
 *   失敗させないため(packages/db/src/schema/settings.ts の workPolicies のコメント参照)
 * - 制度は**削除しない**。版と割当の履歴が参照しており、消すと過去の月次が再計算できなくなる。
 *   代わりにアーカイブ(PATCH の archived)で「新しい割当の選択肢に出さない」ことだけができる。
 *   既に割り当てられているメンバーの計算には影響しない
 * - 既定の制度(テナントで最も古い制度、`getTenantWorkPolicy`)は招待で作られたメンバーへ
 *   自動で割り当てられる。既定の制度はアーカイブできない(409 cannot_archive_default_work_policy)
 * - 版の追加は従来の POST /settings/work-policy と同じ作法(追記専用・過去日は不可・同日の重複は
 *   不可)。過去の集計は変わらない。検証は ./work-policy-version-input.ts に集約している
 *
 * 権限: 勤怠ルールの労働時間制の設定と同じ `WORK_POLICY_PERMISSION`(tenant_settings.flex.manage、
 * テナント全体のみ)。制度の所定労働時間は賃金に直結するため、メンバー管理系(member.*)の権限では
 * 保護しない(POST /members/:id/work-policy と同じ判断)。
 *
 * D1 との互換: 制度の作成は「work_policies の行 → 初版」の2回の insert で、トランザクションは
 * 張らない(D1 は明示トランザクションを拒否する。packages/db/src/d1.ts)。途中で失敗して版の無い
 * 制度が残っても、割当の入口(POST /members/:id/work-policy)が「その日に有効な版があるか」を
 * 検査するため、計算が壊れる状態にはならない。
 */

import type { Hono } from "hono";
import {
  createWorkPolicy,
  getTenantWorkPolicy,
  getWorkPolicyById,
  insertAuditLog,
  insertWorkPolicyVersion,
  listCurrentWorkPolicyAssignmentsForTenant,
  listTenantUsers,
  listTenantWorkPolicies,
  listWorkPolicyVersions,
  listWorkPolicyVersionsForTenant,
  renameWorkPolicy,
  setWorkPolicyArchivedAt,
  type Database,
  type WorkPolicy,
  type WorkPolicyVersion,
} from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { TZ_OFFSET_MINUTES_JST } from "../../lib/settings.js";
import { nowMinutes, todayLocalDate } from "../../lib/time.js";
import { WORK_POLICY_PERMISSION } from "./permissions.js";
import { isValidLocalDate, parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";
import { parseWorkPolicyVersionFields, serializeWorkPolicyVersion, versionEffectiveOn } from "./work-policy-version-input.js";

/** 制度の名前の最大長(権限プリセット名と同じ 100 文字。画面のカード見出しに収まる長さ) */
const MAX_WORK_POLICY_NAME_LENGTH = 100;

/** 名前を検証して前後の空白を除いた値を返す。不正なら null */
function parseWorkPolicyName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name === "" || name.length > MAX_WORK_POLICY_NAME_LENGTH) return null;
  return name;
}

/**
 * 同じテナントに同名の制度があるか(アーカイブ済みも含む — アーカイブした制度も履歴の表示で
 * 名前が出るため、同名を許すと過去の割当がどちらの制度だったか区別できなくなる)。
 * 比較は前後の空白を除いた完全一致(大文字・小文字や全角・半角は区別する)。
 */
function isNameTaken(policies: readonly WorkPolicy[], name: string, exceptId?: string): boolean {
  return policies.some((p) => p.id !== exceptId && p.name.trim() === name);
}

/**
 * 制度の表示上の kind: 今日時点で有効な版の kind。まだ有効な版が無い(初版が将来日)なら
 * 最初の版の kind。版が1つも無い(作成途中で失敗した稀な状態)なら null。
 */
function displayKind(history: readonly WorkPolicyVersion[], effective: WorkPolicyVersion | null): string | null {
  return effective?.kind ?? history[0]?.kind ?? null;
}

export function registerWorkPoliciesRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  /**
   * 制度の一覧。各制度の今日時点で有効な版・版の履歴・割当人数を含む。
   *
   * 割当人数は「今日時点でこの制度が割り当てられている在籍中のメンバー」の数(退職処理済み・
   * 消去済みは数えない)。将来日からの割当はまだ数えない — 「今この制度で計算されている人数」を
   * 示すのが目的のため。
   */
  app.get("/work-policies", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);

    const [policies, versions, currentAssignments, tenantUsers] = await Promise.all([
      listTenantWorkPolicies(db, user.tenantId),
      listWorkPolicyVersionsForTenant(db, user.tenantId),
      listCurrentWorkPolicyAssignmentsForTenant(db, { tenantId: user.tenantId, asOfDate: today }),
      listTenantUsers(db, user.tenantId),
    ]);

    const activeUserIds = new Set(tenantUsers.filter((u) => u.isActive).map((u) => u.id));
    const assigneeCountByPolicy = new Map<string, number>();
    for (const [userId, a] of currentAssignments) {
      if (!activeUserIds.has(userId)) continue;
      assigneeCountByPolicy.set(a.workPolicyId, (assigneeCountByPolicy.get(a.workPolicyId) ?? 0) + 1);
    }

    const versionsByPolicy = new Map<string, WorkPolicyVersion[]>();
    for (const v of versions) {
      const list = versionsByPolicy.get(v.workPolicyId) ?? [];
      list.push(v);
      versionsByPolicy.set(v.workPolicyId, list);
    }

    // listTenantWorkPolicies は作成順(createdAt → id)。先頭が既定の制度(getTenantWorkPolicy と同じ規則)。
    const defaultWorkPolicyId = policies[0]?.id ?? null;

    return c.json({
      defaultWorkPolicyId,
      policies: policies.map((p) => {
        const history = versionsByPolicy.get(p.id) ?? [];
        const effective = versionEffectiveOn(history, today);
        return {
          id: p.id,
          name: p.name,
          kind: displayKind(history, effective),
          isDefault: p.id === defaultWorkPolicyId,
          archivedAt: p.archivedAt,
          createdAt: p.createdAt,
          assigneeCount: assigneeCountByPolicy.get(p.id) ?? 0,
          effective: effective ? serializeWorkPolicyVersion(effective) : null,
          history: history.map(serializeWorkPolicyVersion),
        };
      }),
    });
  });

  /**
   * 制度を作る(名前・初版)。
   *
   * 初版の effectiveFrom は過去日も受け付ける(判断点): 作ったばかりの制度には誰も割り当てられて
   * いないため、過去の日付から有効にしても既存の集計は1つも変わらない。むしろ過去日から有効に
   * しておかないと、入社日が過去のメンバーを招待時にこの制度で登録できない(割当の適用開始日
   * 〔入社日〕より前に版が無いと 409 work_policy_not_effective_yet になる)。
   */
  app.post("/work-policies", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const name = parseWorkPolicyName(body.name);
    if (name === null) return c.json({ error: "invalid_name" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    const fields = parseWorkPolicyVersionFields(body);
    if ("error" in fields) return c.json({ error: fields.error }, 400);

    const policies = await listTenantWorkPolicies(db, user.tenantId);
    if (isNameTaken(policies, name)) return c.json({ error: "work_policy_name_taken" }, 409);

    const now = nowMinutes();
    const { policy, version } = await createWorkPolicy(db, {
      tenantId: user.tenantId,
      name,
      createdAt: now,
      initialVersion: { effectiveFrom, ...fields },
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "work_policy.create",
      targetType: "work_policies",
      targetId: policy.id,
      detail: JSON.stringify({ name: policy.name, version: serializeWorkPolicyVersion(version) }),
      occurredAt: now,
    });

    return c.json(
      {
        policy: {
          id: policy.id,
          name: policy.name,
          kind: version.kind,
          // 最初の1件なら既定の制度になる(既定は「最も古い制度」のため)。
          isDefault: policies.length === 0,
          archivedAt: policy.archivedAt,
          createdAt: policy.createdAt,
          assigneeCount: 0,
          effective: version.effectiveFrom <= todayLocalDate(TZ_OFFSET_MINUTES_JST) ? serializeWorkPolicyVersion(version) : null,
          history: [serializeWorkPolicyVersion(version)],
        },
      },
      201,
    );
  });

  /**
   * 制度の名前の変更・アーカイブ。本文は `{ name?, archived? }`(少なくとも一方)。
   * 名前もアーカイブも集計には影響しない(名前は表示専用、アーカイブは新しい割当の選択肢から
   * 外すだけ)ため、版のような effective-dated の扱いはせず、その場で書き換える。
   */
  app.patch("/work-policies/:id", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");
    const id = c.req.param("id");

    const policy = await getWorkPolicyById(db, { tenantId: user.tenantId, id });
    if (!policy) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (body.name === undefined && body.archived === undefined) return c.json({ error: "invalid_body" }, 400);

    let nextName: string | undefined;
    if (body.name !== undefined) {
      const parsed = parseWorkPolicyName(body.name);
      if (parsed === null) return c.json({ error: "invalid_name" }, 400);
      nextName = parsed;
    }
    if (body.archived !== undefined && typeof body.archived !== "boolean") {
      return c.json({ error: "invalid_body" }, 400);
    }
    const nextArchived = body.archived as boolean | undefined;

    if (nextName !== undefined && nextName !== policy.name) {
      const policies = await listTenantWorkPolicies(db, user.tenantId);
      if (isNameTaken(policies, nextName, policy.id)) return c.json({ error: "work_policy_name_taken" }, 409);
    }
    if (nextArchived === true && policy.archivedAt === null) {
      const defaultPolicy = await getTenantWorkPolicy(db, user.tenantId);
      if (defaultPolicy?.id === policy.id) {
        // 既定の制度は招待時の自動割当先。アーカイブを許すと「選択肢に出ない制度へ自動で割り当てる」
        // という矛盾した状態になるため止める。
        return c.json({ error: "cannot_archive_default_work_policy" }, 409);
      }
    }

    const now = nowMinutes();

    if (nextName !== undefined && nextName !== policy.name) {
      await renameWorkPolicy(db, { tenantId: user.tenantId, id: policy.id, name: nextName });
      await insertAuditLog(db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "work_policy.rename",
        targetType: "work_policies",
        targetId: policy.id,
        detail: JSON.stringify({ before: policy.name, after: nextName }),
        occurredAt: now,
      });
    }

    let archivedAt = policy.archivedAt;
    if (nextArchived !== undefined && nextArchived !== (policy.archivedAt !== null)) {
      archivedAt = nextArchived ? now : null;
      await setWorkPolicyArchivedAt(db, { tenantId: user.tenantId, id: policy.id, archivedAt });
      await insertAuditLog(db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: nextArchived ? "work_policy.archive" : "work_policy.unarchive",
        targetType: "work_policies",
        targetId: policy.id,
        detail: JSON.stringify({ name: nextName ?? policy.name }),
        occurredAt: now,
      });
    }

    return c.json({ policy: { id: policy.id, name: nextName ?? policy.name, archivedAt } });
  });

  /**
   * 制度に新しい版を追加する(追記専用。POST /settings/work-policy と同じ作法:
   * 過去日は 409 effective_from_in_past、同じ日の版が既にあれば 409 version_already_exists)。
   * 過去の集計は変わらない。この制度が割り当てられている全員に、適用開始日から効く。
   *
   * アーカイブ済みの制度にも版は足せる(既に割り当てられているメンバーの所定を直す必要は
   * アーカイブ後もありうるため)。
   */
  app.post("/work-policies/:id/versions", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");
    const id = c.req.param("id");

    const policy = await getWorkPolicyById(db, { tenantId: user.tenantId, id });
    if (!policy) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    const fields = parseWorkPolicyVersionFields(body);
    if ("error" in fields) return c.json({ error: fields.error }, 400);

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) {
      return c.json({ error: "effective_from_in_past" }, 409);
    }

    const history = await listWorkPolicyVersions(db, { tenantId: user.tenantId, workPolicyId: policy.id });
    if (history.some((v) => v.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "version_already_exists" }, 409);
    }

    const now = nowMinutes();
    const inserted = await insertWorkPolicyVersion(db, {
      tenantId: user.tenantId,
      workPolicyId: policy.id,
      effectiveFrom,
      ...fields,
      createdAt: now,
    });

    // 監査ログのアクションは従来の POST /settings/work-policy と同じ work_policy_version.create。
    // どの制度の版かを追えるよう、detail に制度の id と名前を足す。
    const latest = history.length > 0 ? (history[history.length - 1] as WorkPolicyVersion) : null;
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "work_policy_version.create",
      targetType: "work_policy_versions",
      targetId: inserted.id,
      detail: JSON.stringify({
        workPolicyId: policy.id,
        workPolicyName: policy.name,
        before: latest ? serializeWorkPolicyVersion(latest) : null,
        after: serializeWorkPolicyVersion(inserted),
      }),
      occurredAt: now,
    });

    return c.json({ version: serializeWorkPolicyVersion(inserted) }, 201);
  });
}
