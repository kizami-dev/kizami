import type { Hono } from "hono";
import {
  getOrCreateTenantWorkPolicy,
  getTenantWorkPolicy,
  insertAuditLog,
  insertWorkPolicyVersion,
  listWorkPolicyVersions,
  type Database,
  type WorkPolicyVersion,
} from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { TZ_OFFSET_MINUTES_JST } from "../../lib/settings.js";
import { nowMinutes, todayLocalDate } from "../../lib/time.js";
import { WORK_POLICY_PERMISSION } from "./permissions.js";
import { isValidLocalDate, parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";
import { parseWorkPolicyVersionFields, serializeWorkPolicyVersion } from "./work-policy-version-input.js";

/*
 * 版の入力検証(kind・settlementPeriod・core・standardDayMinutes)とレスポンスへの変換は
 * 2026-10-05 に ./work-policy-version-input.ts へ切り出した(名前付きの制度の API
 * ./work-policies.ts と同じ規則を使うため)。
 *
 * このファイルの GET/POST /settings/work-policy は、名前付きの制度が入る前からある
 * 「テナントの既定の制度(最も古い制度)」用の API。設定画面は GET/POST /settings/work-policies へ
 * 移ったが、既存のクライアント(オンボーディングの判定・スクリーンショットのスクリプト・外部連携)の
 * ために残す(挙動は従来どおり。固定時間制の所定の上限〔480分〕だけは全経路で共通に効く)。
 */

// ---- GET/POST /settings/work-policy(フレックス設定の版管理。2026-08-22 追加) ----
export function registerWorkPolicyRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  app.get("/work-policy", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");

    const policy = await getTenantWorkPolicy(db, user.tenantId);
    if (!policy) {
      // work_policies が未作成のテナント(seed を経ていないテスト DB 等)。POST 時に遅延作成する。
      return c.json({ effective: null, history: [] as ReturnType<typeof serializeWorkPolicyVersion>[] });
    }

    const history = await listWorkPolicyVersions(db, { tenantId: user.tenantId, workPolicyId: policy.id });
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    let effective: WorkPolicyVersion | null = null;
    for (const v of history) {
      if (v.effectiveFrom <= today && (effective === null || v.effectiveFrom > effective.effectiveFrom)) {
        effective = v;
      }
    }

    return c.json({
      effective: effective ? serializeWorkPolicyVersion(effective) : null,
      history: history.map(serializeWorkPolicyVersion),
    });
  });

  app.post("/work-policy", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    const fields = parseWorkPolicyVersionFields(body);
    if ("error" in fields) return c.json({ error: fields.error }, 400);
    const { kind, settlementPeriod, core, standardDayMinutes, flexTotalHoursBasis, flexCarryOverShortfall } = fields;

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) {
      return c.json({ error: "effective_from_in_past" }, 409);
    }

    const now = nowMinutes();
    // "標準"(制度中立の名前): 制度(flex/fixed)は版(work_policy_versions.kind)側が持つため、
    // ポリシー名自体は制度を含意しない名前にする。get-or-create なので既存テナントで既に
    // "標準フレックス" 等の名前が付いている場合はそのまま(名前は変わらない) — ここが効くのは
    // work_policies 行がまだ無い新規テナント(seed 未経由のテスト DB 等)のみ。
    const policy = await getOrCreateTenantWorkPolicy(db, { tenantId: user.tenantId, name: "標準", createdAt: now });
    const history = await listWorkPolicyVersions(db, { tenantId: user.tenantId, workPolicyId: policy.id });
    if (history.some((v) => v.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "version_already_exists" }, 409);
    }

    const inserted = await insertWorkPolicyVersion(db, {
      tenantId: user.tenantId,
      workPolicyId: policy.id,
      effectiveFrom,
      kind,
      settlementPeriod,
      core,
      standardDayMinutes,
      flexTotalHoursBasis,
      flexCarryOverShortfall,
      createdAt: now,
    });

    const latest = history.length > 0 ? (history[history.length - 1] as WorkPolicyVersion) : null;
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "work_policy_version.create",
      targetType: "work_policy_versions",
      targetId: inserted.id,
      detail: JSON.stringify({
        before: latest ? serializeWorkPolicyVersion(latest) : null,
        after: serializeWorkPolicyVersion(inserted),
      }),
      occurredAt: now,
    });

    return c.json({ version: serializeWorkPolicyVersion(inserted) }, 201);
  });
}
