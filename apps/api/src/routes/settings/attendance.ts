import type { Hono } from "hono";
import {
  getEffectiveSettingsVersion,
  insertAuditLog,
  insertTenantSettingVersion,
  listTenantSettingVersions,
  type Database,
  type TenantSettingVersion,
} from "@kizami/db";
import type { AutoBreakRule, BreakRule, LegalHolidayRule } from "@kizami/engine";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { TZ_OFFSET_MINUTES_JST } from "../../lib/settings.js";
import { nowMinutes, todayLocalDate } from "../../lib/time.js";
import { ATTENDANCE_CALENDAR_PERMISSION, ATTENDANCE_GPS_PERMISSION } from "./permissions.js";
import { isValidLocalDate, parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

/**
 * LegalHolidayRule(packages/engine の型)のランタイム検証。
 * kind: "weekday"(0〜6) または kind: "dates"(1件以上、要素は LOCAL_DATE_RE 形式)。
 */
function isValidLegalHolidayRule(value: unknown): value is LegalHolidayRule {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "weekday") {
    return typeof v.weekday === "number" && Number.isInteger(v.weekday) && v.weekday >= 0 && v.weekday <= 6;
  }
  if (v.kind === "dates") {
    return Array.isArray(v.dates) && v.dates.length > 0 && v.dates.every((d) => isValidLocalDate(d));
  }
  return false;
}

/**
 * 自動控除ルール(auto/both の rules 配列)1テナントあたりの上限件数。
 *
 * 判断点(完了報告に明記): 要件・カタログに上限の明記は無い。労基法34条が要求する休憩は
 * 「6時間超45分」「8時間超60分」の実質2段階のみで、rules はこの階層構造を表現するための
 * ものだから、3件を超える設定は運用上ほぼ誤入力(あるいは過度に複雑な内規)である可能性が
 * 高い。無制限に許すと編集UIの一覧が扱いにくくなるだけでなく、auto-break.ts の selectRule
 * (全ルールを毎回線形走査する設計)にも実利の無い負荷を強いる。3件は「45分・60分の法定2段階
 * ＋任意の社内上乗せ1段階」を想定した余裕であり、テナント側の運用実態から見て十分な数と判断した。
 */
const MAX_AUTO_BREAK_RULES = 3;

function isValidAutoBreakRule(value: unknown): value is AutoBreakRule {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.overMinutes === "number" &&
    Number.isInteger(v.overMinutes) &&
    v.overMinutes >= 0 &&
    typeof v.deductMinutes === "number" &&
    Number.isInteger(v.deductMinutes) &&
    v.deductMinutes >= 1
  );
}

/**
 * breakRule のランタイム検証(2026-08-23: engine が "auto"/"both" に対応したため、
 * "punch" だけを許可していた暫定実装〔2026-08-22〕から拡張する)。
 *
 * - "punch": rules を持たない
 * - "auto" / "both": rules は必須。空でない配列・要素数は高々 MAX_AUTO_BREAK_RULES 件
 *   (上のコメント参照)。各要素は overMinutes(0以上の整数)・deductMinutes(1以上の整数)を持つ。
 *   overMinutes は昇順・重複なしでなければならない — auto-break.ts の selectRule は
 *   「適用可能なルールのうち overMinutes が最大のものを採る」前提で書かれており、
 *   重複・逆順のルール集合は入力として無意味(どのルールを指しているか一意に決まらない)な
 *   設定ミスであるため、保存時点で弾く。
 */
function isValidBreakRule(value: unknown): value is BreakRule {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v.mode === "punch") return true;
  if (v.mode !== "auto" && v.mode !== "both") return false;

  if (!Array.isArray(v.rules) || v.rules.length === 0 || v.rules.length > MAX_AUTO_BREAK_RULES) return false;

  let prevOverMinutes = -1;
  for (const rule of v.rules) {
    if (!isValidAutoBreakRule(rule)) return false;
    if (rule.overMinutes <= prevOverMinutes) return false; // 昇順・重複なし
    prevOverMinutes = rule.overMinutes;
  }
  return true;
}

/** GET /settings/attendance のレスポンス要素(1版分)。DB の JSON 文字列をパースして返す。 */
function serializeTenantSettingVersion(v: TenantSettingVersion) {
  return {
    effectiveFrom: v.effectiveFrom,
    dayBoundaryMinutes: v.dayBoundaryMinutes,
    weekStartWeekday: v.weekStartWeekday,
    variablePeriodStartDay: v.variablePeriodStartDay,
    legalHolidayRule: JSON.parse(v.legalHolidayRule) as LegalHolidayRule,
    breakRule: JSON.parse(v.breakRule) as BreakRule,
    gpsEnabled: v.gpsEnabled,
    gpsRetentionDays: v.gpsRetentionDays,
    createdAt: v.createdAt,
  };
}

export function registerAttendanceRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  // ---- GET /settings/attendance/capabilities(GPS付き打刻。2026-08-22 追加、PWA+GPS打刻) ----
  // GET /settings/attendance 自体は ATTENDANCE_CALENDAR_PERMISSION(tenant_settings.calendar.manage)
  // を要求し、一般の従業員は読めない。しかし打刻画面は「テナントでGPSが有効かどうか」を
  // 全従業員が知る必要がある(有効なら取得中であることを明示し、位置情報を添えて送るため)。
  // GET /leave/capabilities(routes/leave.ts、認証のみで自分が休暇申請するために必要な情報を返す)
  // と同じ考え方で、認証のみ・権限不要の薄いエンドポイントを新設する(依頼の指示どおり)。
  // 返す値は「GPSを有効にしているか」「座標の保持期間」のみで、日界・法定休日など他の
  // テナント設定は含まない(それらは打刻に必要な情報ではなく、権限が無い従業員に見せる理由がない)。
  app.get("/attendance/capabilities", async (c) => {
    const user = c.get("user");
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const effective = await getEffectiveSettingsVersion(db, { tenantId: user.tenantId, onDate: today });
    return c.json({
      gpsEnabled: effective?.gpsEnabled ?? false,
      gpsRetentionDays: effective?.gpsRetentionDays ?? null,
    });
  });

  // ---- GET/POST /settings/attendance(日界・法定休日・休憩ルール・GPS の版管理。2026-08-22 追加) ----
  // 原則6(docs/design/v01-data-model.md): 編集UIは新しい版を追加しかできない。既存の版は
  // 一切 UPDATE しない(過去の計算結果を変えないため)。

  app.get("/attendance", async (c) => {
    requirePermission(c, ATTENDANCE_CALENDAR_PERMISSION, "tenant");
    const user = c.get("user");

    const history = await listTenantSettingVersions(db, user.tenantId);
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const effective = await getEffectiveSettingsVersion(db, { tenantId: user.tenantId, onDate: today });

    return c.json({
      effective: effective ? serializeTenantSettingVersion(effective) : null,
      history: history.map(serializeTenantSettingVersion),
    });
  });

  app.post("/attendance", async (c) => {
    // 日界・法定休日・休憩ルールは常に calendar.manage で編集できる(GPS 判断は下記参照)。
    requirePermission(c, ATTENDANCE_CALENDAR_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (!isValidLocalDate(body.effectiveFrom)) return c.json({ error: "invalid_effective_from" }, 400);
    const effectiveFrom = body.effectiveFrom;

    if (
      typeof body.dayBoundaryMinutes !== "number" ||
      !Number.isInteger(body.dayBoundaryMinutes) ||
      body.dayBoundaryMinutes < 0 ||
      body.dayBoundaryMinutes > 1439
    ) {
      return c.json({ error: "invalid_day_boundary_minutes" }, 400);
    }
    const dayBoundaryMinutes = body.dayBoundaryMinutes;

    if (!isValidLegalHolidayRule(body.legalHolidayRule)) return c.json({ error: "invalid_legal_holiday_rule" }, 400);
    const legalHolidayRule = body.legalHolidayRule;

    if (!isValidBreakRule(body.breakRule)) return c.json({ error: "invalid_break_rule" }, 400);
    const breakRule = body.breakRule;

    // このルートの他フィールド(dayBoundaryMinutes・legalHolidayRule・breakRule・gpsEnabled)は
    // いずれも「省略時は前版から引き継ぐ」PUT ではなく、POST のたびに新しい版の全項目を
    // 必須で受け取る流儀(このエンドポイントは追記専用の版作成であり、PUT /settings/notifications
    // のような3値ルールの対象ではない)。weekStartWeekday もこれに揃え、省略・範囲外(0〜6以外)は
    // 400 とし、暗黙に前版や既定値0を引き継がない(週の起算曜日を取り違えたまま新しい版を
    // 作ってしまう事故を防ぐ)。
    if (typeof body.weekStartWeekday !== "number" || !Number.isInteger(body.weekStartWeekday) || body.weekStartWeekday < 0 || body.weekStartWeekday > 6) {
      return c.json({ error: "invalid_week_start_weekday" }, 400);
    }
    const weekStartWeekday = body.weekStartWeekday;

    // monthly_variable(シフト制)の変形期間の起点日(docs/design/shift-work.md 決定事項3)。
    // 他のフィールドと同じ「POSTのたびに新しい版の全項目を必須で受け取る」流儀に揃え、
    // monthly_variable を使わないテナントでも明示的に指定させる(省略時に暗黙の1を引き継ぐと、
    // 将来 monthly_variable へ切り替えたときに気づかれにくい既定値が使われてしまうため)。
    if (
      typeof body.variablePeriodStartDay !== "number" ||
      !Number.isInteger(body.variablePeriodStartDay) ||
      body.variablePeriodStartDay < 1 ||
      body.variablePeriodStartDay > 28
    ) {
      return c.json({ error: "invalid_variable_period_start_day" }, 400);
    }
    const variablePeriodStartDay = body.variablePeriodStartDay;

    if (typeof body.gpsEnabled !== "boolean") return c.json({ error: "invalid_gps_enabled" }, 400);
    const gpsEnabled = body.gpsEnabled;

    let gpsRetentionDays: number | null = null;
    if (body.gpsRetentionDays !== null && body.gpsRetentionDays !== undefined) {
      if (typeof body.gpsRetentionDays !== "number" || !Number.isInteger(body.gpsRetentionDays) || body.gpsRetentionDays <= 0) {
        return c.json({ error: "invalid_gps_retention_days" }, 400);
      }
      gpsRetentionDays = body.gpsRetentionDays;
    }

    // 過去日の版追加は禁止(当日以降のみ許可) — 過去の計算結果を変えてしまうため。
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) {
      return c.json({ error: "effective_from_in_past" }, 409);
    }

    const history = await listTenantSettingVersions(db, user.tenantId);
    if (history.some((v) => v.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "version_already_exists" }, 409);
    }

    // GPS の値(gpsEnabled/gpsRetentionDays)が現在の最新版から変わる場合のみ、追加で
    // gps.manage を要求する(定数 ATTENDANCE_GPS_PERMISSION のコメント参照)。
    const latest = history.length > 0 ? (history[history.length - 1] as TenantSettingVersion) : null;
    const gpsChanged = latest === null || latest.gpsEnabled !== gpsEnabled || latest.gpsRetentionDays !== gpsRetentionDays;
    if (gpsChanged) {
      requirePermission(c, ATTENDANCE_GPS_PERMISSION, "tenant");
    }

    const now = nowMinutes();
    const inserted = await insertTenantSettingVersion(db, {
      tenantId: user.tenantId,
      effectiveFrom,
      dayBoundaryMinutes,
      legalHolidayRule: JSON.stringify(legalHolidayRule),
      breakRule: JSON.stringify(breakRule),
      gpsEnabled,
      gpsRetentionDays,
      weekStartWeekday,
      variablePeriodStartDay,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "tenant_setting_version.create",
      targetType: "tenant_setting_versions",
      targetId: inserted.id,
      detail: JSON.stringify({
        before: latest ? serializeTenantSettingVersion(latest) : null,
        after: serializeTenantSettingVersion(inserted),
      }),
      occurredAt: now,
    });

    return c.json({ version: serializeTenantSettingVersion(inserted) }, 201);
  });
}
