import type { Hono } from "hono";
import {
  getEffectiveSettingsVersion,
  getTenantById,
  insertAuditLog,
  updateTenantPrivacyContact,
  updateTenantWorkRulesUrl,
  type Database,
} from "@kizami/db";
import { buildInternalTerms, buildPrivacyNotice, type PrivacyTemplateInput } from "@kizami/privacy-template";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { isValidHttpUrl, resolveStringField } from "../../lib/field-validation.js";
import { TZ_OFFSET_MINUTES_JST } from "../../lib/settings.js";
import { nowMinutes, todayLocalDate } from "../../lib/time.js";
import { PRIVACY_TEMPLATES_PERMISSION, WORK_RULES_URL_PERMISSION } from "./permissions.js";
import { parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

/**
 * 打刻記録本体(出勤・退勤・休憩時刻等)の保存期間の説明文。
 *
 * 判断点(独自判断、完了報告に明記): tenant_setting_versions には GPS 座標専用の
 * `gpsRetentionDays` はあるが、打刻記録本体そのものの保存期間を表すテナント設定は
 * 存在しない(勤怠データは「賃金台帳・労働者名簿」の基礎資料として労働基準法109条が
 * 定める保存義務にそのまま従う運用のため、テナントごとに変わる値ではない)。
 * そのため、この説明文は入力ではなく固定文言としてここで組み立て、
 * PrivacyTemplateInput.recordRetentionDescription に渡す。
 *
 * 法令上の根拠(2026-08-22 時点でウェブ検索により確認済み、詳細は完了報告参照):
 * 労働基準法109条は記録の保存期間を「5年間」と定めるが、令和2年改正の経過措置(同法附則143条2項)
 * により当分の間は3年間で足りる。
 */
const RECORD_RETENTION_DESCRIPTION =
  "打刻記録(出勤・退勤・休憩時刻等)は、労働基準法第109条が定める記録の保存義務にもとづき、最後の記載日から5年間(令和2年改正の経過措置により当分の間は3年間)保存します。";

export function registerPrivacyRoutes(app: Hono<AppEnv>, db: Database, _deps: SettingsRoutesDeps) {
  // ---- PUT /settings/work-rules-url(就業規則リンク。2026-08-22 追加) ----
  // 読み取りは GET /help/overrides(routes/help.ts、認証のみ)が返す。ここは書き込みのみ。
  app.put("/work-rules-url", async (c) => {
    requirePermission(c, WORK_RULES_URL_PERMISSION, "tenant");
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
    const b = body as Record<string, unknown>;

    // 空文字・null = リンクの削除。それ以外は http/https の URL のみ受け付ける。
    let workRulesUrl: string | null;
    if (b.url === null || b.url === "") {
      workRulesUrl = null;
    } else if (typeof b.url === "string" && isValidHttpUrl(b.url)) {
      workRulesUrl = b.url;
    } else {
      return c.json({ error: "invalid_url" }, 400);
    }

    const before = await getTenantById(db, user.tenantId);
    if (!before) {
      return c.json({ error: "tenant_not_found" }, 404);
    }

    const updated = await updateTenantWorkRulesUrl(db, { tenantId: user.tenantId, workRulesUrl });

    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "work_rules_url.update",
      targetType: "tenant",
      targetId: user.tenantId,
      detail: JSON.stringify({ before: before.workRulesUrl, after: updated.workRulesUrl }),
      occurredAt: now,
    });

    return c.json({ workRulesUrl: updated.workRulesUrl });
  });

  // ---- GET /settings/privacy-templates(個人情報まわりの雛形。2026-08-22 追加) ----
  // docs/design/ui-direction.md「個人情報まわりの雛形」: 現在のテナント設定(GPSの有効/無効・
  // 保持期間・就業規則リンク)から生成した雛形2種を返す。generatedFrom は「どの設定値をもとに
  // 生成したか」を担当者が確認できるように、実際に使った入力をそのまま返す。
  app.get("/privacy-templates", async (c) => {
    requirePermission(c, PRIVACY_TEMPLATES_PERMISSION, "tenant");
    const user = c.get("user");

    const tenant = await getTenantById(db, user.tenantId);
    if (!tenant) {
      return c.json({ error: "tenant_not_found" }, 404);
    }

    // GPS の有効/無効・保持期間は effective-dated な tenant_setting_versions が持つため、
    // 「今日」時点で有効な版を解決する(buildSettingsTimeline と同じ TZ 前提)。
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const settingsVersion = await getEffectiveSettingsVersion(db, { tenantId: user.tenantId, onDate: today });

    // 保存期間の説明文・開示請求窓口は GET/PUT /settings/privacy-contact(下記)で
    // テナントごとに設定できる(2026-08-22 追加)。未設定(null)の場合は今まで通り
    // 固定文言/プレースホルダにフォールバックする。
    const generatedFrom: PrivacyTemplateInput = {
      tenantName: tenant.name,
      gpsEnabled: settingsVersion?.gpsEnabled ?? false,
      gpsRetentionDays: settingsVersion?.gpsRetentionDays ?? null,
      recordRetentionDescription: tenant.recordRetentionDescription ?? RECORD_RETENTION_DESCRIPTION,
      workRulesUrl: tenant.workRulesUrl,
      contactPoint: tenant.privacyContactPoint,
    };

    return c.json({
      privacyNotice: buildPrivacyNotice(generatedFrom),
      internalTerms: buildInternalTerms(generatedFrom),
      generatedFrom,
    });
  });

  // ---- GET/PUT /settings/privacy-contact(保存期間の説明文・開示請求窓口。2026-08-22 追加) ----
  // GET /settings/privacy-templates(上記)がこの2値を読む(未設定なら固定文言/プレースホルダ)。
  app.get("/privacy-contact", async (c) => {
    requirePermission(c, PRIVACY_TEMPLATES_PERMISSION, "tenant");
    const user = c.get("user");

    const tenant = await getTenantById(db, user.tenantId);
    if (!tenant) return c.json({ error: "tenant_not_found" }, 404);

    return c.json({
      recordRetentionDescription: tenant.recordRetentionDescription,
      privacyContactPoint: tenant.privacyContactPoint,
    });
  });

  app.put("/privacy-contact", async (c) => {
    requirePermission(c, PRIVACY_TEMPLATES_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const before = await getTenantById(db, user.tenantId);
    if (!before) return c.json({ error: "tenant_not_found" }, 404);

    // undefined=維持 / null・""=クリア / string=置換(PUT /settings/notifications と同じ3値ルール)。
    const descResult = resolveStringField(body.recordRetentionDescription, before.recordRetentionDescription);
    if (!descResult.ok) return c.json({ error: "invalid_record_retention_description" }, 400);
    const contactResult = resolveStringField(body.privacyContactPoint, before.privacyContactPoint);
    if (!contactResult.ok) return c.json({ error: "invalid_privacy_contact_point" }, 400);

    const updated = await updateTenantPrivacyContact(db, {
      tenantId: user.tenantId,
      recordRetentionDescription: descResult.value,
      privacyContactPoint: contactResult.value,
    });

    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "privacy_contact.update",
      targetType: "tenant",
      targetId: user.tenantId,
      detail: JSON.stringify({
        before: { recordRetentionDescription: before.recordRetentionDescription, privacyContactPoint: before.privacyContactPoint },
        after: { recordRetentionDescription: updated.recordRetentionDescription, privacyContactPoint: updated.privacyContactPoint },
      }),
      occurredAt: now,
    });

    return c.json({ recordRetentionDescription: updated.recordRetentionDescription, privacyContactPoint: updated.privacyContactPoint });
  });
}
