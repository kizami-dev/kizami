/**
 * GET /settings/notifications, PUT /settings/notifications, POST /settings/notifications/test
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
  getNotificationSettings,
  insertAuditLog,
  upsertNotificationSettings,
  type Database,
  type TenantNotificationSettings,
} from "@kizami/db";
import { dispatch, type NotificationMessage, type SmtpSendFn } from "@kizami/notify";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { decryptSecret, type Encryptor } from "../lib/encryption.js";
import { buildNotificationChannels, isNotificationConfigUsable } from "../lib/notification-channels.js";
import { nowMinutes } from "../lib/time.js";

const NOTIFICATION_SETTINGS_PERMISSION = "notification.settings.manage";
const TEST_NOTIFICATION_TITLE = "KIZAMI 通知テスト";
const TEST_NOTIFICATION_BODY = "これは KIZAMI の通知設定を確認するためのテスト通知です。この通知が届いていれば設定は正常に機能しています。";

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

function webhookPreview(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return null;
  }
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

type StringFieldResult = { ok: true; value: string | null } | { ok: false };

/** undefined=維持 / null・""=クリア / string=置換、の3値ルールで文字列項目を解決する。 */
function resolveStringField(value: unknown, current: string | null): StringFieldResult {
  if (value === undefined) return { ok: true, value: current };
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value === "string") return { ok: true, value };
  return { ok: false };
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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

    const channels = await buildNotificationChannels(db, user.tenantId, {
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

  return app;
}
