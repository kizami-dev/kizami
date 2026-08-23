/**
 * GET/PUT /settings/notifications/me, POST /settings/notifications/me/test
 *
 * 個人の通知受け取り設定(user_notification_settings)。docs/requirements.md §7「通知設定の
 * 2層構造」における「個人の受け取り設定」層 — **権限チェックは行わない**。認証済みユーザーが
 * 自分自身(c.get("user").tenantId / .id)の設定だけを読み書きする(他人の tenant_id/user_id を
 * 指定する経路自体が存在しない設計)。テナント単位の通知チャネル設定(SMTP・共有 Webhook)は
 * routes/settings.ts の GET/PUT /settings/notifications(`notification.settings.manage` 権限必須)
 * のままで、こちらとは完全に別物。
 *
 * カテゴリ(missing_clock_out / overtime_alert / leave_alert / correction_alert /
 * approval_request)・既定値(アプリ内=常時ON・メール=OFF・Webhook=未設定)の定義は
 * lib/notification-preferences.ts に一元化してあり、このファイルはそれを読み書きするだけ
 * (独自のデフォルト値を持たない)。approval_request は他と異なり「申請者本人」ではなく
 * 「承認権限を持つ人」が受け手のカテゴリ(apps/api/src/lib/approvers.ts 参照)だが、
 * 個人の受け取り設定という枠組み自体は同じなのでこの GET/PUT /settings/notifications/me で
 * 一緒くたに扱う。
 *
 * 秘密情報のマスキング方針(GET のレスポンス。routes/settings.ts の webhookUrl と同じ考え方):
 * - webhookUrl: 全文は返さない。`{ configured: boolean, preview: string | null }`
 * 保存時暗号化(webhookUrl、詳細は apps/api/src/lib/encryption.ts):
 * - 新たに(空でない)値が指定された場合のみ暗号化して保存する。省略時は既存値を維持。
 * - encryptor が無い状態で新しい webhookUrl を含む PUT が来た場合は 503
 *   { error: "encryption_unavailable" } を返し、保存自体を拒否する(平文フォールバックはしない)。
 *   webhookUrl を含まない更新(カテゴリ ON/OFF・メールアドレス変更など)は encryptor が無くても通す。
 */

import { Hono } from "hono";
import {
  getUserNotificationSettings,
  upsertUserNotificationSettings,
  type Database,
  type UserNotificationSettings,
} from "@kizami/db";
import { dispatch, webhookChannel, type SmtpSendFn } from "@kizami/notify";
import type { AppEnv } from "../auth/middleware.js";
import { decryptSecret, type Encryptor } from "../lib/encryption.js";
import { isValidHttpUrl, resolveStringField, webhookPreview } from "../lib/field-validation.js";
import {
  NOTIFICATION_CATEGORIES,
  resolveEmailAddress,
  resolveUserNotificationPrefs,
  type CategoryChannelPrefs,
  type NotificationCategory,
} from "../lib/notification-preferences.js";
import { nowMinutes } from "../lib/time.js";

const TEST_WEBHOOK_TITLE = "KIZAMI 個人Webhook通知テスト";
const TEST_WEBHOOK_BODY = "これは KIZAMI の個人 Webhook 設定を確認するためのテスト通知です。この通知が届いていれば設定は正常に機能しています。";

export interface NotificationPreferencesRoutesDeps {
  /** webhookChannel の fetch 差し替え(テスト用)。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
  /** 未使用(将来 SMTP テスト送信を追加する場合のための予約)。現状は POST .../test は個人Webhookのみを対象にする */
  smtpSendFn?: SmtpSendFn;
  /** webhookUrl の暗号化・復号に使う。null/未設定の場合、PUT は webhookUrl を含む更新を 503 で拒否する */
  encryptor?: Encryptor | null;
}

function serializeCategories(prefs: Record<NotificationCategory, CategoryChannelPrefs>) {
  const result: Record<NotificationCategory, { inapp: true; email: boolean; webhook: boolean }> = {} as never;
  for (const category of NOTIFICATION_CATEGORIES) {
    result[category] = { inapp: true, email: prefs[category].email, webhook: prefs[category].webhook };
  }
  return result;
}

async function serialize(
  row: UserNotificationSettings | null,
  accountEmail: string,
  encryptor: Encryptor | null | undefined,
) {
  const prefs = resolveUserNotificationPrefs(row);

  let webhookPreviewValue: string | null = null;
  if (row?.webhookUrl) {
    const decrypted = await decryptSecret(encryptor, row.webhookUrl);
    webhookPreviewValue = decrypted ? webhookPreview(decrypted) : null;
  }

  return {
    categories: serializeCategories(prefs),
    emailAddress: {
      // null = テナントアカウントの email をそのまま使う(UI 側で「未入力ならアカウントのメールを使う」旨を表示する)。
      value: row?.emailAddress ?? null,
      effective: resolveEmailAddress(row, accountEmail),
    },
    webhookUrl: row?.webhookUrl
      ? { configured: true, preview: webhookPreviewValue }
      : { configured: false, preview: null as string | null },
    updatedAt: row?.updatedAt ?? null,
  };
}

interface PutCategoryBody {
  email?: unknown;
  webhook?: unknown;
}

interface PutBody {
  categories?: Partial<Record<NotificationCategory, PutCategoryBody>>;
  emailAddress?: unknown;
  webhookUrl?: unknown;
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

export function createNotificationPreferencesRoutes(db: Database, deps: NotificationPreferencesRoutesDeps = {}) {
  const app = new Hono<AppEnv>();

  app.get("/me", async (c) => {
    const user = c.get("user");
    const row = await getUserNotificationSettings(db, { tenantId: user.tenantId, userId: user.id });
    return c.json(await serialize(row, user.email, deps.encryptor));
  });

  app.put("/me", async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (typeof body.categories !== "object" || body.categories === null) {
      return c.json({ error: "invalid_categories" }, 400);
    }

    const existing = await getUserNotificationSettings(db, { tenantId: user.tenantId, userId: user.id });
    const currentPrefs = resolveUserNotificationPrefs(existing);

    const resolvedPrefs: Record<NotificationCategory, CategoryChannelPrefs> = {
      missing_clock_out: { ...currentPrefs.missing_clock_out },
      overtime_alert: { ...currentPrefs.overtime_alert },
      leave_alert: { ...currentPrefs.leave_alert },
      correction_alert: { ...currentPrefs.correction_alert },
      approval_request: { ...currentPrefs.approval_request },
    };
    for (const category of NOTIFICATION_CATEGORIES) {
      const input = body.categories[category];
      if (input === undefined) continue; // 省略 = 既存値を維持
      if (typeof input !== "object" || input === null) return c.json({ error: "invalid_categories" }, 400);
      if (input.email !== undefined) {
        if (typeof input.email !== "boolean") return c.json({ error: "invalid_categories" }, 400);
        resolvedPrefs[category].email = input.email;
      }
      if (input.webhook !== undefined) {
        if (typeof input.webhook !== "boolean") return c.json({ error: "invalid_categories" }, 400);
        resolvedPrefs[category].webhook = input.webhook;
      }
    }

    const emailAddressResult = resolveStringField(body.emailAddress, existing?.emailAddress ?? null);
    if (!emailAddressResult.ok) return c.json({ error: "invalid_email_address" }, 400);
    // メールアドレスの厳密なRFC検証はしない(routes/auth.ts のユーザー登録と同じ簡易チェックに揃える: "@" を含む文字列)。
    if (emailAddressResult.value !== null && !emailAddressResult.value.includes("@")) {
      return c.json({ error: "invalid_email_address" }, 400);
    }

    const webhookUrlResult = resolveStringField(body.webhookUrl, existing?.webhookUrl ?? null);
    if (!webhookUrlResult.ok) return c.json({ error: "invalid_webhook_url" }, 400);
    const webhookUrlProvided = body.webhookUrl !== undefined;
    const rawWebhookUrl = webhookUrlProvided ? webhookUrlResult.value : null;
    if (webhookUrlProvided && rawWebhookUrl !== null && !isValidHttpUrl(rawWebhookUrl)) {
      return c.json({ error: "invalid_webhook_url" }, 400);
    }

    // 暗号化の対象は「この PUT で新たに(空でない)値が指定された」webhookUrl のみ
    // (routes/settings.ts の PUT /notifications と同じ方針)。
    const webhookUrlNeedsEncryption = webhookUrlProvided && rawWebhookUrl !== null;
    if (webhookUrlNeedsEncryption && !deps.encryptor) {
      return c.json({ error: "encryption_unavailable" }, 503);
    }
    const webhookUrlToStore = webhookUrlNeedsEncryption
      ? await (deps.encryptor as Encryptor).encrypt(rawWebhookUrl as string)
      : webhookUrlResult.value;

    const now = nowMinutes();
    const updated = await upsertUserNotificationSettings(db, {
      tenantId: user.tenantId,
      userId: user.id,
      missingClockOutEmail: resolvedPrefs.missing_clock_out.email,
      missingClockOutWebhook: resolvedPrefs.missing_clock_out.webhook,
      overtimeAlertEmail: resolvedPrefs.overtime_alert.email,
      overtimeAlertWebhook: resolvedPrefs.overtime_alert.webhook,
      leaveAlertEmail: resolvedPrefs.leave_alert.email,
      leaveAlertWebhook: resolvedPrefs.leave_alert.webhook,
      correctionAlertEmail: resolvedPrefs.correction_alert.email,
      correctionAlertWebhook: resolvedPrefs.correction_alert.webhook,
      approvalRequestEmail: resolvedPrefs.approval_request.email,
      approvalRequestWebhook: resolvedPrefs.approval_request.webhook,
      emailAddress: emailAddressResult.value,
      webhookUrl: webhookUrlToStore,
      updatedAt: now,
    });

    return c.json(await serialize(updated, user.email, deps.encryptor));
  });

  // 個人 Webhook のテスト送信(UI の「テスト送信ボタン」用)。判断点(完了報告に明記):
  // メールはテナントの SMTP 接続情報を借用する形になり誤解を招きやすいため、テスト送信の対象は
  // 個人 Webhook のみに絞った(依頼の UI 要件「個人Webhook URL…テスト送信ボタン」に一致する)。
  app.post("/me/test", async (c) => {
    const user = c.get("user");
    const existing = await getUserNotificationSettings(db, { tenantId: user.tenantId, userId: user.id });
    if (!existing?.webhookUrl) {
      return c.json({ error: "not_configured" }, 400);
    }

    const url = await decryptSecret(deps.encryptor, existing.webhookUrl);
    if (!url) {
      return c.json({ error: "decryption_failed" }, 503);
    }

    const channel = webhookChannel(url, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
    const [result] = await dispatch([channel], { to: { email: user.email }, title: TEST_WEBHOOK_TITLE, body: TEST_WEBHOOK_BODY });

    return c.json({
      result: result
        ? { channel: result.channel, ok: result.ok, ...(result.ok ? {} : { error: result.error instanceof Error ? result.error.message : String(result.error) }) }
        : null,
    });
  });

  return app;
}
