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
import { parseCoreTime, TZ_OFFSET_MINUTES_JST } from "../../lib/settings.js";
import { nowMinutes, todayLocalDate } from "../../lib/time.js";
import { WORK_POLICY_PERMISSION } from "./permissions.js";
import { isValidLocalDate, parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

/**
 * GET /settings/work-policy のレスポンス要素(1版分)。
 *
 * `core`(コアタイム)は DB では JSON 文字列だが、レスポンスでは復元済みのオブジェクト
 * (または null)で返す — クライアントに JSON の二重パースをさせないため、
 * legal_holiday_rule / break_rule を返す GET /settings/attendance と同じ流儀。
 */
function serializeWorkPolicyVersion(v: WorkPolicyVersion) {
  return {
    effectiveFrom: v.effectiveFrom,
    kind: v.kind,
    settlementPeriod: v.settlementPeriod,
    core: parseCoreTime(v.core),
    standardDayMinutes: v.standardDayMinutes,
    createdAt: v.createdAt,
  };
}

/**
 * リクエストの `core`(コアタイム、labor law §32-3)を検証して DB へ入れる JSON 文字列にする。
 *
 * 返り値: `{ core: string | null }` なら採用、`{ error }` なら 400 を返す。
 * 省略・null は「コアタイムなし」(スーパーフレックス)として扱う — コアタイムの設定自体が
 * 労使協定の任意事項であり、送らないことが正常な既定だから(docs/design/work-systems.md)。
 *
 * 検証(engine の `CoreTime` の契約と一致させる。packages/engine/src/types.ts 参照):
 * - startMinutes / endMinutes は 0〜1440 の整数
 * - startMinutes < endMinutes(**日跨ぎを許さない** — コアタイムは日中の帯という制度前提。
 *   ここで弾かないと、エンジン側が「帯なし」として黙って無視するため、設定したつもりの
 *   コアタイムが一切効かないという分かりにくい状態になる)
 * - weekdays(省略可)は 0〜6 の整数の配列。空配列は「全曜日で対象外」を意味してしまい
 *   設定ミスと区別できないため拒否する(指定しないこと = engine 既定の月〜金)
 */
function buildCoreTimeJson(value: unknown): { core: string | null } | { error: string } {
  if (value === undefined || value === null) return { core: null };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "invalid_core_time" };

  const { startMinutes, endMinutes, weekdays } = value as Record<string, unknown>;
  const isMinutesOfDay = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1440;
  if (!isMinutesOfDay(startMinutes) || !isMinutesOfDay(endMinutes) || startMinutes >= endMinutes) {
    return { error: "invalid_core_time" };
  }

  const core: { startMinutes: number; endMinutes: number; weekdays?: number[] } = { startMinutes, endMinutes };
  if (weekdays !== undefined) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) return { error: "invalid_core_time_weekdays" };
    if (!weekdays.every((w) => Number.isInteger(w) && w >= 0 && w <= 6)) return { error: "invalid_core_time_weekdays" };
    core.weekdays = [...new Set(weekdays as number[])].sort((a, b) => a - b);
  }
  return { core: JSON.stringify(core) };
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

  /**
   * monthly_variable(シフト制)で standardDayMinutes が省略されたときの既定値
   * (1日8時間)。
   *
   * 意味の変遷(2026-08-24, v0.7 フェーズ4): 以前この定数は「NOT NULL 列を埋めるためだけの
   * プレースホルダ(値に意味は無い)」だった。フェーズ4で monthly_variable の
   * `standard_day_minutes` に **「1日あたりの基準所定時間(有給換算用)」** という明確な意味が
   * 与えられた(シフトの無い日に有給を取ったとき1日分を何分に換算するか。
   * apps/api/src/lib/leave-minutes.ts・docs/design/shift-work.md フェーズ4 参照)。
   * よってリクエストで指定できるようにし、この定数は「未指定時の既定」に降格する
   * (集計〔engine〕側がこの値を読まないことは従来どおり — 所定は ShiftDay が日ごとに決める)。
   */
  const VARIABLE_DEFAULT_STANDARD_DAY_MINUTES = 480;

  app.post("/work-policy", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    // 2026-08-23 shift-work.md 決定事項5: WorkSystem の3値目 "monthly_variable"(1ヶ月単位の
    // 変形労働時間制)を受け付ける。periodStartDay はこのポリシー版ではなくテナント設定
    // (tenant_setting_versions.variable_period_start_day、POST /settings/attendance)側が持つ。
    if (body.kind !== "flex" && body.kind !== "fixed" && body.kind !== "monthly_variable") {
      return c.json({ error: "invalid_work_system_kind" }, 400);
    }
    const kind = body.kind;

    // settlementPeriod はフレックス専用の列。固定時間制・monthly_variable ではリクエストの値を
    // 見ず(検証もせず)、上記プレースホルダで DB 列を埋める。v0.1 はフレックスの清算期間
    // "monthly" のみ対応(packages/engine の FlexSettings.settlement)。
    let settlementPeriod: string;
    if (kind === "flex") {
      if (body.settlementPeriod !== "monthly") {
        return c.json({ error: "invalid_settlement_period" }, 400);
      }
      settlementPeriod = body.settlementPeriod;
    } else {
      settlementPeriod = FIXED_SETTLEMENT_PERIOD_PLACEHOLDER;
    }

    // コアタイム(labor law §32-3、2026-08-24 追加)は flex 専用。fixed・monthly_variable では
    // settlementPeriod と同じくリクエストの値を見ず null で埋める(列の意味が無いため)。
    let core: string | null = null;
    if (kind === "flex") {
      const result = buildCoreTimeJson(body.core);
      if ("error" in result) return c.json({ error: result.error }, 400);
      core = result.core;
    }

    // standardDayMinutes: flex/fixed は「所定労働時間(有給の枠算入にも使う)」、
    // monthly_variable は「基準所定(有給換算用)」(上記定数のコメント参照)。
    // monthly_variable でのみ省略を許し、その場合は既定値を使う(後方互換 — フェーズ4以前の
    // クライアントはこの制度で standardDayMinutes を送っていなかった)。
    let standardDayMinutes: number;
    if (kind === "monthly_variable" && body.standardDayMinutes === undefined) {
      standardDayMinutes = VARIABLE_DEFAULT_STANDARD_DAY_MINUTES;
    } else {
      if (
        typeof body.standardDayMinutes !== "number" ||
        !Number.isInteger(body.standardDayMinutes) ||
        body.standardDayMinutes <= 0 ||
        body.standardDayMinutes > 1440
      ) {
        return c.json({ error: "invalid_standard_day_minutes" }, 400);
      }
      standardDayMinutes = body.standardDayMinutes;
    }

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
