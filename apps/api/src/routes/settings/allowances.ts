import type { Hono } from "hono";
import {
  createAllowanceDefinition,
  insertAllowanceDefinitionVersion,
  insertAuditLog,
  listAllowanceDefinitions,
  listAllowanceDefinitionVersions,
  type AllowanceDefinitionVersion,
  type Database,
} from "@kizami/db";
import type { AllowanceDefinition as AllowanceDefinitionConditions } from "@kizami/engine";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { TZ_OFFSET_MINUTES_JST } from "../../lib/settings.js";
import { nowMinutes, todayLocalDate } from "../../lib/time.js";
import { ALLOWANCE_SETTINGS_PERMISSION } from "./permissions.js";
import { isValidLocalDate, parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

/**
 * dates 条件1件("2027-01-01" 固定日付、または "--12-31" 毎年の月日)のランタイム検証
 * (docs/design/allowances.md「手当定義」)。暦としての正当性チェックはしない
 * (isValidLegalHolidayRule と同じ既存の流儀)。
 */
const YEARLY_DATE_RE = /^--\d{2}-\d{2}$/;
function isValidAllowanceDateEntry(value: unknown): value is string {
  return typeof value === "string" && (isValidLocalDate(value) || YEARLY_DATE_RE.test(value));
}

function isValidWeekday(value: unknown): value is 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isValidTimeBandMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;
}

/**
 * AllowanceDefinition["conditions"](engine 側の型)のランタイム検証。3つの条件
 * (dates/weekdays/timeBand)はすべて省略可・AND 条件(docs/design/allowances.md)。
 * 「全部省略(=常に全時間が対象)」は意味を持たない設定ミスであり、呼び出し側
 * (POST /settings/allowances・POST /settings/allowances/:id/versions)が別途 400 で弾く
 * (この関数はあくまで「形が正しいか」だけを見る — 全省略かどうかの判断はビジネスルールであり
 * 形式検証とは別の関心事として呼び出し側に置く)。
 */
function isValidAllowanceConditions(value: unknown): value is AllowanceDefinitionConditions["conditions"] {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v.dates !== undefined) {
    if (!Array.isArray(v.dates) || v.dates.length === 0 || !v.dates.every((d) => isValidAllowanceDateEntry(d))) return false;
  }
  if (v.weekdays !== undefined) {
    if (!Array.isArray(v.weekdays) || v.weekdays.length === 0 || !v.weekdays.every((w) => isValidWeekday(w))) return false;
  }
  if (v.timeBand !== undefined) {
    if (typeof v.timeBand !== "object" || v.timeBand === null) return false;
    const band = v.timeBand as Record<string, unknown>;
    if (!isValidTimeBandMinutes(band.startMinutes) || !isValidTimeBandMinutes(band.endMinutes)) return false;
    // startMinutes === endMinutes は長さ0の帯(常に対象時間0分)になり設定として無意味
    // (packages/engine/src/date.ts の timeBandOverlapMinutes が常に0を返す仕様と揃える)。
    if (band.startMinutes === band.endMinutes) return false;
  }
  return true;
}

/** 手当定義の conditions が実質的に「全条件省略」(=常に全時間が対象)かどうか。 */
function isEmptyAllowanceConditions(conditions: AllowanceDefinitionConditions["conditions"]): boolean {
  return conditions.dates === undefined && conditions.weekdays === undefined && conditions.timeBand === undefined;
}

/** GET /settings/allowances のレスポンス要素(1版分)。DB の JSON 文字列をパースして返す。 */
function serializeAllowanceDefinitionVersion(v: AllowanceDefinitionVersion) {
  return {
    effectiveFrom: v.effectiveFrom,
    name: v.name,
    conditions: JSON.parse(v.conditions) as AllowanceDefinitionConditions["conditions"],
    createdAt: v.createdAt,
  };
}

// ---- GET/POST /settings/allowances(手当定義の版管理。docs/design/allowances.md、2026-08-23 追加) ----
// work_policies と違い「テナントにつき何件でも並行して存在しうる」ため、GET は定義ごとに
// { id, effective, history } をまとめた配列を返す(GET /settings/work-policy の単一版とは形が違う)。
export function registerAllowancesRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  app.get("/allowances", async (c) => {
    requirePermission(c, ALLOWANCE_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    const definitions = await listAllowanceDefinitions(db, user.tenantId);
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);

    const result = await Promise.all(
      definitions.map(async (definition) => {
        const history = await listAllowanceDefinitionVersions(db, { tenantId: user.tenantId, definitionId: definition.id });
        let effective: AllowanceDefinitionVersion | null = null;
        for (const v of history) {
          if (v.effectiveFrom <= today && (effective === null || v.effectiveFrom > effective.effectiveFrom)) {
            effective = v;
          }
        }
        return {
          id: definition.id,
          effective: effective ? serializeAllowanceDefinitionVersion(effective) : null,
          history: history.map(serializeAllowanceDefinitionVersion),
        };
      }),
    );

    return c.json({ definitions: result });
  });

  app.post("/allowances", async (c) => {
    requirePermission(c, ALLOWANCE_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    if (typeof body.name !== "string" || body.name.length === 0) return c.json({ error: "invalid_name" }, 400);
    const name = body.name;

    if (!isValidAllowanceConditions(body.conditions)) return c.json({ error: "invalid_conditions" }, 400);
    const conditions = body.conditions;
    // 条件を1つも指定しない定義は「常に全時間が対象」になり意味を持たない設定ミスなので拒否する
    // (docs/design/allowances.md「手当定義」)。
    if (isEmptyAllowanceConditions(conditions)) return c.json({ error: "conditions_required" }, 400);

    // 過去日の版追加は禁止(当日以降のみ許可) — 他の effective-dated 設定と同じ原則6。
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) {
      return c.json({ error: "effective_from_in_past" }, 409);
    }

    const now = nowMinutes();
    const { definition, version } = await createAllowanceDefinition(db, {
      tenantId: user.tenantId,
      effectiveFrom,
      name,
      conditions: JSON.stringify(conditions),
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "allowance_definition.create",
      targetType: "allowance_definitions",
      targetId: definition.id,
      detail: JSON.stringify({ after: serializeAllowanceDefinitionVersion(version) }),
      occurredAt: now,
    });

    return c.json({ id: definition.id, version: serializeAllowanceDefinitionVersion(version) }, 201);
  });

  app.post("/allowances/:definitionId/versions", async (c) => {
    requirePermission(c, ALLOWANCE_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");
    const definitionId = c.req.param("definitionId");

    // tenantId でスコープした版一覧が空 = このテナントに存在しない定義ID(他テナント所有・
    // 誤ったIDの両方をこの1つの404で扱う。存在有無を漏らさない他の書き込みエンドポイントと
    // 同じ考え方)。
    const history = await listAllowanceDefinitionVersions(db, { tenantId: user.tenantId, definitionId });
    if (history.length === 0) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    if (typeof body.name !== "string" || body.name.length === 0) return c.json({ error: "invalid_name" }, 400);
    const name = body.name;

    if (!isValidAllowanceConditions(body.conditions)) return c.json({ error: "invalid_conditions" }, 400);
    const conditions = body.conditions;
    if (isEmptyAllowanceConditions(conditions)) return c.json({ error: "conditions_required" }, 400);

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) {
      return c.json({ error: "effective_from_in_past" }, 409);
    }
    if (history.some((v) => v.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "version_already_exists" }, 409);
    }

    const now = nowMinutes();
    const inserted = await insertAllowanceDefinitionVersion(db, {
      tenantId: user.tenantId,
      definitionId,
      effectiveFrom,
      name,
      conditions: JSON.stringify(conditions),
      createdAt: now,
    });

    const latest = history[history.length - 1] as AllowanceDefinitionVersion;
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "allowance_definition_version.create",
      targetType: "allowance_definition_versions",
      targetId: inserted.id,
      detail: JSON.stringify({
        before: serializeAllowanceDefinitionVersion(latest),
        after: serializeAllowanceDefinitionVersion(inserted),
      }),
      occurredAt: now,
    });

    return c.json({ version: serializeAllowanceDefinitionVersion(inserted) }, 201);
  });
}
