/**
 * GET /settings/notifications, PUT /settings/notifications, POST /settings/notifications/test,
 * GET /settings/leave, PUT /settings/leave, GET /settings/tenant-profile, PUT /settings/tenant-profile
 *
 * テナント単位の通知チャネル設定(tenant_notification_settings)。権限
 * `notification.settings.manage`(scope tenant のみ — docs/design/permission-catalog.md §1.11)
 * を要求する、v0.2 で新規追加する設定APIのみ requirePermission でガードする対象
 * (既存エンドポイントは v0.1 と同じ requireSelf のまま変更しない)。
 *
 * 秘密情報のマスキング方針(GET のレスポンス):
 * - webhookUrl: 全文は返さない。`{ configured: boolean, preview: string | null }`
 *   (preview はオリジンのみ、例 "https://hooks.slack.com/...")
 * - smtpPassword: 返さない。設定済みかどうかの `smtpPasswordSet: boolean` のみ返す
 *
 * PUT の入力の扱い(各フィールド共通、smtpPort以外は文字列):
 * - フィールド省略(undefined) = 既存値を維持
 * - null または空文字 "" = クリア(null にする)
 * - それ以外の文字列 = その値に置き換える
 * smtpPassword も同じ3値ルールに従う(依頼の「未指定は保持・空文字はクリア」を満たす)。
 *
 * 保存時暗号化(webhookUrl・smtpPassword、詳細は apps/api/src/lib/encryption.ts):
 * - この PUT で新たに(空でない)値が「指定」された場合のみ暗号化して保存する。
 *   フィールド省略時(=既存値を維持)は、DBに入っている値(平文/暗号文どちらもありうる)を
 *   そのまま引き継ぐだけで再暗号化はしない(encryptor が無くても既存値の維持はできる)。
 *   → 既存の平文値は、その値を含む PUT が来るたびに暗号化される(後方互換からの移行経路)。
 * - encryptor が無い状態でこの PUT が新しい秘密情報(webhookUrl・smtpPassword)を含む場合は
 *   503 { error: "encryption_unavailable" } を返し、保存自体を拒否する(平文フォールバックはしない)。
 *   秘密情報を含まない更新(有効/無効の切り替え・ホスト名変更など)は encryptor が無くても通す。
 * - GET の webhookUrl.preview は復号できて初めて表示できる。復号できない(鍵未設定・鍵不一致・
 *   破損)場合は configured: true のまま preview だけ null にする。
 */

import { Hono } from "hono";
import {
  getEffectiveSettingsVersion,
  getNotificationSettings,
  getOrCreateTenantWorkPolicy,
  getTenantById,
  getTenantLeaveSettings,
  getTenantWorkPolicy,
  insertAuditLog,
  insertTenantSettingVersion,
  insertWorkPolicyVersion,
  listTenantSettingVersions,
  listWorkPolicyVersions,
  updateTenantLawProfile,
  updateTenantPrivacyContact,
  updateTenantWorkRulesUrl,
  upsertNotificationSettings,
  upsertTenantLeaveSettings,
  type Database,
  type TenantNotificationSettings,
  type TenantSettingVersion,
  type WorkPolicyVersion,
} from "@kizami/db";
import { dispatch, type NotificationMessage, type SmtpSendFn } from "@kizami/notify";
import { HOURLY_LEAVE_MAX_DAYS_MAX, HOURLY_LEAVE_MAX_DAYS_MIN } from "@kizami/leave";
import type { LegalHolidayRule } from "@kizami/engine";
import { buildInternalTerms, buildPrivacyNotice, type PrivacyTemplateInput } from "@kizami/privacy-template";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { decryptSecret, type Encryptor } from "../lib/encryption.js";
import { isValidHttpUrl, resolveStringField, webhookPreview } from "../lib/field-validation.js";
import { buildTenantChannels, isNotificationConfigUsable } from "../lib/notification-channels.js";
import { TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";
import { nowMinutes, todayLocalDate } from "../lib/time.js";
import { HELP_OVERRIDES_PERMISSION } from "./help.js";

const NOTIFICATION_SETTINGS_PERMISSION = "notification.settings.manage";
const TEST_NOTIFICATION_TITLE = "KIZAMI 通知テスト";
const TEST_NOTIFICATION_BODY = "これは KIZAMI の通知設定を確認するためのテスト通知です。この通知が届いていれば設定は正常に機能しています。";

/**
 * GET/PUT /settings/leave が要求する権限(2026-08-22 追加)。
 *
 * 判断点: docs/design/permission-catalog.md の `tenant_settings.*` グループには
 * 有給休暇の付与方式・時間単位年休・積立休暇を表す target が定義されていない
 * (テナント設定リソースの target は calendar/flex/gps/auto_deduction/notification の5種)。
 * 一方でカタログ§1.4には `leave.grant.manage`(有給休暇の付与・残日数を管理できる。
 * scope 自部署+配下部署/テナント全体、危険フラグあり)が既に存在し、有給運用の
 * 管理者権限として意味的に最も近い。ここでは新規キーを追加せず、`leave.grant.manage` を
 * scope "tenant" で要求することでテナント全体設定相当の権限チェックとする
 * (依頼「tenant_settings.calendar.manage 相当。適切な権限キーをカタログから選ぶこと」への回答)。
 */
const LEAVE_SETTINGS_PERMISSION = "leave.grant.manage";

/**
 * GET/PUT /settings/tenant-profile(2026-08-22 追加: 法令パッケージ結線・36協定完全版)が
 * 要求する権限。
 *
 * 判断点: 依頼は「`tenant_settings.calendar.manage` 相当の適切なものをカタログから選ぶ」と
 * 指示している。`tenant_settings.*` 系(calendar/flex/gps/auto_deduction)はどれも
 * 「集計の入力になるテナント設定」という点では近いが、このエンドポイントが扱う3値
 * (企業規模・特例措置対象事業場・特別条項締結)は具体的には「36協定アラートの各閾値の
 * 決定に直結する」ものであり、`alert.labor_limit.configure`(36協定アラートの閾値・通知先を
 * 設定できる。テナント全体のみ・危険フラグあり)の対象範囲(「法定上限に対するアラート閾値」の
 * 設定)に最も具体的に一致する。フレックス総枠にも影響する(特例措置対象事業場)ため
 * `tenant_settings.flex.manage` も候補になりうるが、この依頼の主眼が36協定アラート完全版で
 * あることを踏まえ `alert.labor_limit.configure` を採用した(独自判断、完了報告に明記)。
 */
const TENANT_PROFILE_PERMISSION = "alert.labor_limit.configure";

/**
 * PUT /settings/work-rules-url(就業規則リンク。2026-08-22、社内規定追記機能で追加)が
 * 要求する権限。routes/help.ts の HELP_OVERRIDES_PERMISSION と同一(notification.settings.manage
 * の転用理由は help.ts 冒頭コメント参照) — 就業規則リンクも社内規定と同じ「全社員向けヘルプの
 * 補足情報」なので、書き込み権限も help_overrides と揃える。
 */
const WORK_RULES_URL_PERMISSION = HELP_OVERRIDES_PERMISSION;

/**
 * GET /settings/privacy-templates(個人情報まわりの雛形。2026-08-22 追加)が要求する権限。
 *
 * 依頼どおり「権限は社内規定の編集と同じもの」— HELP_OVERRIDES_PERMISSION
 * (notification.settings.manage の転用。理由は help.ts 冒頭コメント参照)をそのまま使う。
 */
const PRIVACY_TEMPLATES_PERMISSION = HELP_OVERRIDES_PERMISSION;

/**
 * GET/POST /settings/attendance(日界・法定休日・休憩ルール・GPS の版管理。2026-08-22 追加)が
 * 要求する権限。
 *
 * 判断点(完了報告に明記): この1エンドポイントは1行(tenant_setting_versions の1版)に
 * 日界・法定休日・休憩ルール・GPS の4項目をまとめて持つため、カタログ上は別々の権限キー
 * (`tenant_settings.calendar.manage` と `tenant_settings.gps.manage`)に分かれる項目が
 * 同じ POST 1回に載る。依頼の「項目ごとに正しく振り分けること」を満たすため、
 * ①GET/POST とも常に `tenant_settings.calendar.manage` を要求し(日界・法定休日・休憩ルールは
 * 常にこの権限で編集できる)、②POST で GPS の値(gpsEnabled/gpsRetentionDays)が現在の
 * 実効値から変わる場合のみ、追加で `tenant_settings.gps.manage` も要求する(値を変えず
 * そのまま送っただけなら calendar.manage だけで通る)。これにより「カレンダー担当者は
 * GPSを勝手に有効化できない」が両立する。
 */
const ATTENDANCE_CALENDAR_PERMISSION = "tenant_settings.calendar.manage";
const ATTENDANCE_GPS_PERMISSION = "tenant_settings.gps.manage";

/** GET/POST /settings/work-policy(フレックス設定の版管理。2026-08-22 追加)が要求する権限。 */
const WORK_POLICY_PERMISSION = "tenant_settings.flex.manage";

/**
 * GET/PUT /settings/privacy-contact(保存期間の説明文・開示請求窓口。2026-08-22 追加)が
 * 要求する権限。判断点: この2項目は GET /settings/privacy-templates の入力そのものなので、
 * 同エンドポイントと同じ PRIVACY_TEMPLATES_PERMISSION(上で定義済み。HELP_OVERRIDES_PERMISSION の
 * 転用)をそのまま使う(新規の権限キーは増やさない)。
 */

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

export interface SettingsRoutesDeps {
  /** webhookChannel の fetch 差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /** smtp 送信関数。省略時 smtp チャネルは常に「未設定」扱いになる(テスト送信も 400) */
  smtpSendFn?: SmtpSendFn;
  /**
   * webhookUrl・smtpPassword の暗号化・復号に使う。null/未設定の場合、PUT は秘密情報を
   * 含む更新を 503 encryption_unavailable で拒否する(平文フォールバックはしない)。
   */
  encryptor?: Encryptor | null;
}

async function serialize(settings: TenantNotificationSettings | null, encryptor: Encryptor | null | undefined) {
  if (!settings) {
    return {
      webhookEnabled: false,
      webhookUrl: { configured: false, preview: null as string | null },
      smtpEnabled: false,
      smtpHost: null as string | null,
      smtpPort: null as number | null,
      smtpUser: null as string | null,
      smtpFrom: null as string | null,
      smtpPasswordSet: false,
      updatedAt: null as number | null,
      updatedBy: null as string | null,
    };
  }

  // configured は「値が保存されているか」で決まる(復号できるかどうかとは独立)。
  // preview は復号できて初めて出せるので、復号できない(鍵未設定・鍵不一致・破損)場合は
  // configured: true のまま null にする。
  let webhookPreviewValue: string | null = null;
  if (settings.webhookUrl) {
    const decrypted = await decryptSecret(encryptor, settings.webhookUrl);
    webhookPreviewValue = decrypted ? webhookPreview(decrypted) : null;
  }

  return {
    webhookEnabled: settings.webhookEnabled,
    webhookUrl: settings.webhookUrl
      ? { configured: true, preview: webhookPreviewValue }
      : { configured: false, preview: null as string | null },
    smtpEnabled: settings.smtpEnabled,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpFrom: settings.smtpFrom,
    smtpPasswordSet: settings.smtpPassword !== null,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

/** "YYYY-MM-DD" の書式チェックのみ(暦としての正当性チェックはしない、既存 routes/leave.ts の DATE_RE と同じ流儀)。 */
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidLocalDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE_RE.test(value);
}

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
 * breakRule のランタイム検証。判断点(完了報告に明記): DB スキーマのコメント
 * (packages/db/src/schema/settings.ts)は将来値として "auto"/"both" を挙げているが、
 * engine の CalcSettings["breakRule"] は v0.1 時点で `{ mode: "punch" }` しか受け付けない
 * (packages/engine/src/types.ts)。未実装のモードを保存できてしまうと集計側が誤ったキャストで
 * 静かに壊れるため、ここでは "punch" のみを許可する(engine 側が対応したら緩める)。
 */
function isValidBreakRule(value: unknown): value is { mode: "punch" } {
  if (typeof value !== "object" || value === null) return false;
  return (value as Record<string, unknown>).mode === "punch";
}

interface PutBody {
  webhookEnabled?: unknown;
  webhookUrl?: unknown;
  smtpEnabled?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  smtpUser?: unknown;
  smtpFrom?: unknown;
  smtpPassword?: unknown;
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<PutBody | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  return body as PutBody;
}

/** GET /settings/attendance のレスポンス要素(1版分)。DB の JSON 文字列をパースして返す。 */
function serializeTenantSettingVersion(v: TenantSettingVersion) {
  return {
    effectiveFrom: v.effectiveFrom,
    dayBoundaryMinutes: v.dayBoundaryMinutes,
    legalHolidayRule: JSON.parse(v.legalHolidayRule) as LegalHolidayRule,
    breakRule: JSON.parse(v.breakRule) as { mode: "punch" },
    gpsEnabled: v.gpsEnabled,
    gpsRetentionDays: v.gpsRetentionDays,
    createdAt: v.createdAt,
  };
}

/** GET /settings/work-policy のレスポンス要素(1版分)。 */
function serializeWorkPolicyVersion(v: WorkPolicyVersion) {
  return {
    effectiveFrom: v.effectiveFrom,
    settlementPeriod: v.settlementPeriod,
    standardDayMinutes: v.standardDayMinutes,
    createdAt: v.createdAt,
  };
}

async function parseJsonRecord(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

export function createSettingsRoutes(db: Database, deps: SettingsRoutesDeps = {}) {
  const app = new Hono<AppEnv>();

  app.get("/notifications", async (c) => {
    requirePermission(c, NOTIFICATION_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");
    const settings = await getNotificationSettings(db, user.tenantId);
    return c.json(await serialize(settings, deps.encryptor));
  });

  app.put("/notifications", async (c) => {
    requirePermission(c, NOTIFICATION_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (typeof body.webhookEnabled !== "boolean") return c.json({ error: "invalid_webhook_enabled" }, 400);
    if (typeof body.smtpEnabled !== "boolean") return c.json({ error: "invalid_smtp_enabled" }, 400);

    const existing = await getNotificationSettings(db, user.tenantId);

    const webhookUrlResult = resolveStringField(body.webhookUrl, existing?.webhookUrl ?? null);
    if (!webhookUrlResult.ok) return c.json({ error: "invalid_webhook_url" }, 400);
    const webhookUrl = webhookUrlResult.value;
    // 「この PUT で新しい webhookUrl が指定されたか」(既存値の維持・クリアとは区別する)。
    // 指定された場合のみ暗号化の対象になる(下記 encryption_unavailable チェック参照)。
    const webhookUrlProvided = body.webhookUrl !== undefined;
    if (webhookUrl !== null && !isValidHttpUrl(webhookUrl)) return c.json({ error: "invalid_webhook_url" }, 400);
    if (body.webhookEnabled && webhookUrl === null) return c.json({ error: "invalid_webhook_url" }, 400);

    const smtpHostResult = resolveStringField(body.smtpHost, existing?.smtpHost ?? null);
    if (!smtpHostResult.ok) return c.json({ error: "invalid_smtp_host" }, 400);
    const smtpUserResult = resolveStringField(body.smtpUser, existing?.smtpUser ?? null);
    if (!smtpUserResult.ok) return c.json({ error: "invalid_smtp_user" }, 400);
    const smtpFromResult = resolveStringField(body.smtpFrom, existing?.smtpFrom ?? null);
    if (!smtpFromResult.ok) return c.json({ error: "invalid_smtp_from" }, 400);
    // 未指定のパスワードは既存値を保持、空文字が来たらクリアする(3値ルールを再利用)
    const smtpPasswordResult = resolveStringField(body.smtpPassword, existing?.smtpPassword ?? null);
    if (!smtpPasswordResult.ok) return c.json({ error: "invalid_smtp_password" }, 400);
    const smtpPasswordChanged = body.smtpPassword !== undefined;

    let smtpPort: number | null;
    if (body.smtpPort === undefined) {
      smtpPort = existing?.smtpPort ?? null;
    } else if (body.smtpPort === null) {
      smtpPort = null;
    } else if (
      typeof body.smtpPort === "number" &&
      Number.isInteger(body.smtpPort) &&
      body.smtpPort >= 1 &&
      body.smtpPort <= 65535
    ) {
      smtpPort = body.smtpPort;
    } else {
      return c.json({ error: "invalid_smtp_port" }, 400);
    }

    const smtpHost = smtpHostResult.value;
    const smtpFrom = smtpFromResult.value;
    if (body.smtpEnabled && (smtpHost === null || smtpPort === null || smtpFrom === null)) {
      return c.json({ error: "invalid_smtp_config" }, 400);
    }

    // 暗号化の対象は「この PUT で新たに(空でない)値が指定された」秘密情報のみ。
    // フィールド省略時(=既存値の維持)は再暗号化せず DB の値をそのまま引き継ぐため、
    // encryptor が無くても既存値の維持・他フィールドの更新は行える。
    const webhookUrlNeedsEncryption = webhookUrlProvided && webhookUrl !== null;
    const smtpPasswordNeedsEncryption = smtpPasswordChanged && smtpPasswordResult.value !== null;
    if ((webhookUrlNeedsEncryption || smtpPasswordNeedsEncryption) && !deps.encryptor) {
      return c.json({ error: "encryption_unavailable" }, 503);
    }

    const webhookUrlToStore = webhookUrlNeedsEncryption
      ? await (deps.encryptor as Encryptor).encrypt(webhookUrl as string)
      : webhookUrl;
    const smtpPasswordToStore = smtpPasswordNeedsEncryption
      ? await (deps.encryptor as Encryptor).encrypt(smtpPasswordResult.value as string)
      : smtpPasswordResult.value;

    const now = nowMinutes();
    const updated = await upsertNotificationSettings(db, {
      tenantId: user.tenantId,
      webhookEnabled: body.webhookEnabled,
      webhookUrl: webhookUrlToStore,
      smtpEnabled: body.smtpEnabled,
      smtpHost,
      smtpPort,
      smtpUser: smtpUserResult.value,
      smtpFrom,
      smtpPassword: smtpPasswordToStore,
      updatedAt: now,
      updatedBy: user.id,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "notification_settings.update",
      targetType: "tenant_notification_settings",
      targetId: user.tenantId,
      detail: JSON.stringify({
        webhookEnabled: updated.webhookEnabled,
        // 暗号化により保存値そのものでの比較はできない(平文 vs 暗号文になりうる)ため、
        // 「この PUT で webhookUrl フィールドが指定されたか」を changed の代理指標として使う。
        webhookUrlChanged: webhookUrlProvided,
        smtpEnabled: updated.smtpEnabled,
        smtpHost: updated.smtpHost,
        smtpPort: updated.smtpPort,
        smtpUser: updated.smtpUser,
        smtpFrom: updated.smtpFrom,
        smtpPasswordChanged,
      }),
      occurredAt: now,
    });

    return c.json(await serialize(updated, deps.encryptor));
  });

  app.post("/notifications/test", async (c) => {
    requirePermission(c, NOTIFICATION_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    const settings = await getNotificationSettings(db, user.tenantId);
    if (!isNotificationConfigUsable(settings)) {
      return c.json({ error: "not_configured" }, 400);
    }

    const channels = await buildTenantChannels(db, user.tenantId, {
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.smtpSendFn ? { smtpSendFn: deps.smtpSendFn } : {}),
      encryptor: deps.encryptor ?? null,
    });

    const message: NotificationMessage = {
      to: { email: user.email },
      title: TEST_NOTIFICATION_TITLE,
      body: TEST_NOTIFICATION_BODY,
    };
    const dispatchResults = await dispatch(channels, message);
    const results = dispatchResults.map((r) => ({
      channel: r.channel,
      ok: r.ok,
      ...(r.ok ? {} : { error: r.error instanceof Error ? r.error.message : String(r.error) }),
    }));

    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "notification_settings.test",
      targetType: "tenant_notification_settings",
      targetId: user.tenantId,
      detail: JSON.stringify({ results }),
      occurredAt: now,
    });

    return c.json({ results });
  });

  // ---- GET/PUT /settings/leave(§5 有給休暇: 付与方式・時間単位年休・積立休暇) ----
  app.get("/leave", async (c) => {
    requirePermission(c, LEAVE_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");
    const settings = await getTenantLeaveSettings(db, user.tenantId);
    if (!settings) {
      return c.json({
        grantMethod: "statutory",
        fixedDateMmDd: null,
        hourlyLeaveEnabled: false,
        hourlyLeaveMaxDays: 5,
        halfDayLeaveEnabled: true,
        stockConversionEnabled: false,
        stockMaxDays: 40,
        stockExpiresMonths: null,
        updatedAt: null,
        updatedBy: null,
      });
    }
    return c.json(settings);
  });

  app.put("/leave", async (c) => {
    requirePermission(c, LEAVE_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
    const b = body as Record<string, unknown>;

    if (b.grantMethod !== "statutory" && b.grantMethod !== "fixed_date") {
      return c.json({ error: "invalid_grant_method" }, 400);
    }
    const grantMethod = b.grantMethod;

    let fixedDateMmDd: string | null = null;
    if (grantMethod === "fixed_date") {
      if (typeof b.fixedDateMmDd !== "string" || !/^\d{2}-\d{2}$/.test(b.fixedDateMmDd)) {
        return c.json({ error: "invalid_fixed_date_mm_dd" }, 400);
      }
      fixedDateMmDd = b.fixedDateMmDd;
    }

    if (typeof b.hourlyLeaveEnabled !== "boolean") return c.json({ error: "invalid_hourly_leave_enabled" }, 400);
    if (typeof b.halfDayLeaveEnabled !== "boolean") return c.json({ error: "invalid_half_day_leave_enabled" }, 400);
    if (typeof b.stockConversionEnabled !== "boolean") return c.json({ error: "invalid_stock_conversion_enabled" }, 400);

    // 労使協定で5日より少なく定めることは可能だが、5日超は法令上不可(労基法39条4項)
    if (
      typeof b.hourlyLeaveMaxDays !== "number" ||
      !Number.isInteger(b.hourlyLeaveMaxDays) ||
      b.hourlyLeaveMaxDays < HOURLY_LEAVE_MAX_DAYS_MIN ||
      b.hourlyLeaveMaxDays > HOURLY_LEAVE_MAX_DAYS_MAX
    ) {
      return c.json({ error: "invalid_hourly_leave_max_days" }, 400);
    }

    if (typeof b.stockMaxDays !== "number" || !Number.isInteger(b.stockMaxDays) || b.stockMaxDays <= 0) {
      return c.json({ error: "invalid_stock_max_days" }, 400);
    }

    let stockExpiresMonths: number | null = null;
    if (b.stockExpiresMonths !== null && b.stockExpiresMonths !== undefined) {
      if (typeof b.stockExpiresMonths !== "number" || !Number.isInteger(b.stockExpiresMonths) || b.stockExpiresMonths <= 0) {
        return c.json({ error: "invalid_stock_expires_months" }, 400);
      }
      stockExpiresMonths = b.stockExpiresMonths;
    }

    const now = nowMinutes();
    const updated = await upsertTenantLeaveSettings(db, {
      tenantId: user.tenantId,
      grantMethod,
      fixedDateMmDd,
      hourlyLeaveEnabled: b.hourlyLeaveEnabled,
      hourlyLeaveMaxDays: b.hourlyLeaveMaxDays,
      halfDayLeaveEnabled: b.halfDayLeaveEnabled,
      stockConversionEnabled: b.stockConversionEnabled,
      stockMaxDays: b.stockMaxDays,
      stockExpiresMonths,
      updatedAt: now,
      updatedBy: user.id,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "leave_settings.update",
      targetType: "tenant_leave_settings",
      targetId: user.tenantId,
      detail: JSON.stringify(updated),
      occurredAt: now,
    });

    return c.json(updated);
  });

  // ---- GET/PUT /settings/tenant-profile(法令プロファイル・特別条項。2026-08-22 追加) ----
  app.get("/tenant-profile", async (c) => {
    requirePermission(c, TENANT_PROFILE_PERMISSION, "tenant");
    const user = c.get("user");
    const tenant = await getTenantById(db, user.tenantId);
    if (!tenant) {
      return c.json({ error: "tenant_not_found" }, 404);
    }
    return c.json({
      isSmallOrMediumEnterprise: tenant.isSmallOrMediumEnterprise,
      isSpecialProvisionWorkplace: tenant.isSpecialProvisionWorkplace,
      specialClauseEnabled: tenant.specialClauseEnabled,
    });
  });

  app.put("/tenant-profile", async (c) => {
    requirePermission(c, TENANT_PROFILE_PERMISSION, "tenant");
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
    const b = body as Record<string, unknown>;

    if (typeof b.isSmallOrMediumEnterprise !== "boolean") {
      return c.json({ error: "invalid_is_small_or_medium_enterprise" }, 400);
    }
    if (typeof b.isSpecialProvisionWorkplace !== "boolean") {
      return c.json({ error: "invalid_is_special_provision_workplace" }, 400);
    }
    if (typeof b.specialClauseEnabled !== "boolean") {
      return c.json({ error: "invalid_special_clause_enabled" }, 400);
    }

    const before = await getTenantById(db, user.tenantId);
    if (!before) {
      return c.json({ error: "tenant_not_found" }, 404);
    }

    const updated = await updateTenantLawProfile(db, {
      tenantId: user.tenantId,
      isSmallOrMediumEnterprise: b.isSmallOrMediumEnterprise,
      isSpecialProvisionWorkplace: b.isSpecialProvisionWorkplace,
      specialClauseEnabled: b.specialClauseEnabled,
    });

    // この3値は集計(週法定労働時間・60時間超区分・36協定の各閾値)に直接影響するため、
    // 依頼どおり変更時は必ず監査ログに残す(before/after 両方を残し、何から何に変えたか追える形にする)。
    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "tenant_profile.update",
      targetType: "tenant",
      targetId: user.tenantId,
      detail: JSON.stringify({
        before: {
          isSmallOrMediumEnterprise: before.isSmallOrMediumEnterprise,
          isSpecialProvisionWorkplace: before.isSpecialProvisionWorkplace,
          specialClauseEnabled: before.specialClauseEnabled,
        },
        after: {
          isSmallOrMediumEnterprise: updated.isSmallOrMediumEnterprise,
          isSpecialProvisionWorkplace: updated.isSpecialProvisionWorkplace,
          specialClauseEnabled: updated.specialClauseEnabled,
        },
      }),
      occurredAt: now,
    });

    return c.json({
      isSmallOrMediumEnterprise: updated.isSmallOrMediumEnterprise,
      isSpecialProvisionWorkplace: updated.isSpecialProvisionWorkplace,
      specialClauseEnabled: updated.specialClauseEnabled,
    });
  });

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

  // ---- GET/POST /settings/work-policy(フレックス設定の版管理。2026-08-22 追加) ----
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

    // v0.1 はフレックスの清算期間 "monthly" のみ対応(packages/engine の FlexSettings.settlement)。
    if (body.settlementPeriod !== "monthly") {
      return c.json({ error: "invalid_settlement_period" }, 400);
    }
    const settlementPeriod = body.settlementPeriod;

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
    const policy = await getOrCreateTenantWorkPolicy(db, { tenantId: user.tenantId, name: "標準フレックス", createdAt: now });
    const history = await listWorkPolicyVersions(db, { tenantId: user.tenantId, workPolicyId: policy.id });
    if (history.some((v) => v.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "version_already_exists" }, 409);
    }

    const inserted = await insertWorkPolicyVersion(db, {
      tenantId: user.tenantId,
      workPolicyId: policy.id,
      effectiveFrom,
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

  return app;
}
