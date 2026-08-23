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

/** GET /settings/work-policy のレスポンス要素(1版分)。 */
function serializeWorkPolicyVersion(v: WorkPolicyVersion) {
  return {
    effectiveFrom: v.effectiveFrom,
    kind: v.kind,
    settlementPeriod: v.settlementPeriod,
    standardDayMinutes: v.standardDayMinutes,
    createdAt: v.createdAt,
  };
}

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

  /**
   * kind = "fixed" のとき、DB 列(settlement_period は NOT NULL)を埋めるためだけに使う
   * プレースホルダ。work_policy_versions.settlementPeriod は flex 専用の列であり
   * (packages/db/src/schema/settings.ts のコメント参照)、固定時間制では意味を持たず
   * リクエストの値も使わない。決め打ちの値をこの1箇所だけに集約し、コード中に
   * "monthly" 文字列リテラルが散らばらないようにする。
   */
  const FIXED_SETTLEMENT_PERIOD_PLACEHOLDER = "monthly";

  app.post("/work-policy", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    if (body.kind !== "flex" && body.kind !== "fixed") {
      return c.json({ error: "invalid_work_system_kind" }, 400);
    }
    const kind = body.kind;

    // settlementPeriod はフレックス専用の列。固定時間制ではリクエストの値を見ず(検証もせず)、
    // 上記プレースホルダで DB 列を埋める。v0.1 はフレックスの清算期間 "monthly" のみ対応
    // (packages/engine の FlexSettings.settlement)。
    let settlementPeriod: string;
    if (kind === "flex") {
      if (body.settlementPeriod !== "monthly") {
        return c.json({ error: "invalid_settlement_period" }, 400);
      }
      settlementPeriod = body.settlementPeriod;
    } else {
      settlementPeriod = FIXED_SETTLEMENT_PERIOD_PLACEHOLDER;
    }

    if (
      typeof body.standardDayMinutes !== "number" ||
      !Number.isInteger(body.standardDayMinutes) ||
      body.standardDayMinutes <= 0 ||
      body.standardDayMinutes > 1440
    ) {
      return c.json({ error: "invalid_standard_day_minutes" }, 400);
    }
    const standardDayMinutes = body.standardDayMinutes;

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
      standardDayMinutes,
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
