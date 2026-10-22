import type { Hono } from "hono";
import {
  findValidSlackLinkTokenByHash,
  getTenantSlackSettings,
  insertAuditLog,
  linkSlackUser,
  markSlackLinkTokenUsed,
  upsertTenantSlackSettings,
  type Database,
} from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { sha256Hex } from "../../auth/api-key.js";
import { requirePermission } from "../../authz.js";
import type { Encryptor } from "../../lib/encryption.js";
import { resolveStringField } from "../../lib/field-validation.js";
import { nowMinutes } from "../../lib/time.js";
import { SLACK_SETTINGS_PERMISSION } from "./permissions.js";
import { parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

export function registerSlackRoutes(app: Hono<AppEnv>, db: Database, deps: SettingsRoutesDeps) {
  // ---- GET/PUT /settings/slack(Slackスラッシュコマンド打刻の連携設定。docs/external-api/slack.md) ----
  // Signing Secret はマスクして返す(webhookUrl/smtpPassword と同じ流儀。プレビューではなく
  // 「設定済みかどうか」の boolean のみ — Signing Secret は URL のようにオリジンだけ見せる
  // 意味のある部分文字列が無いため、smtpPasswordSet と同じ形にする)。
  app.get("/slack", async (c) => {
    requirePermission(c, SLACK_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");
    const settings = await getTenantSlackSettings(db, user.tenantId);
    return c.json({
      teamId: settings?.teamId ?? null,
      enabled: settings?.enabled ?? false,
      signingSecretSet: settings?.signingSecret !== null && settings?.signingSecret !== undefined,
      updatedAt: settings?.updatedAt ?? null,
      updatedBy: settings?.updatedBy ?? null,
    });
  });

  app.put("/slack", async (c) => {
    requirePermission(c, SLACK_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (typeof body.enabled !== "boolean") return c.json({ error: "invalid_enabled" }, 400);

    const existing = await getTenantSlackSettings(db, user.tenantId);

    // team_id: undefined=維持 / null・""=クリア / string=置換(PUT /settings/notifications と同じ3値ルール)。
    const teamIdResult = resolveStringField(body.teamId, existing?.teamId ?? null);
    if (!teamIdResult.ok) return c.json({ error: "invalid_team_id" }, 400);
    const teamId = teamIdResult.value;

    const signingSecretResult = resolveStringField(body.signingSecret, existing?.signingSecret ?? null);
    if (!signingSecretResult.ok) return c.json({ error: "invalid_signing_secret" }, 400);
    // 「この PUT で新たに(空でない)Signing Secret が指定されたか」(既存値の維持・クリアとは区別する)。
    const signingSecretProvided = body.signingSecret !== undefined;
    const signingSecretNeedsEncryption = signingSecretProvided && signingSecretResult.value !== null;
    if (signingSecretNeedsEncryption && !deps.encryptor) {
      return c.json({ error: "encryption_unavailable" }, 503);
    }

    // 有効化するには teamId・signingSecret の両方が(既存値の維持を含め)設定されている必要がある
    // (依頼: 署名検証がSlack連携の認証そのものであり、どちらか欠けたまま有効化すると
    // POST /slack/commands が常に401を返す壊れた状態になるため)。
    if (body.enabled && (teamId === null || signingSecretResult.value === null)) {
      return c.json({ error: "invalid_slack_config" }, 400);
    }

    const signingSecretToStore = signingSecretNeedsEncryption
      ? await (deps.encryptor as Encryptor).encrypt(signingSecretResult.value as string)
      : signingSecretResult.value;

    const now = nowMinutes();
    const updated = await upsertTenantSlackSettings(db, {
      tenantId: user.tenantId,
      teamId,
      signingSecret: signingSecretToStore,
      enabled: body.enabled,
      updatedAt: now,
      updatedBy: user.id,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "slack_settings.update",
      targetType: "tenant_slack_settings",
      targetId: user.tenantId,
      // 秘密情報そのものは残さない(webhookUrl/smtpPassword と同じ方針。「変更されたか」だけ記録する)。
      detail: JSON.stringify({ teamId: updated.teamId, enabled: updated.enabled, signingSecretChanged: signingSecretProvided }),
      occurredAt: now,
    });

    return c.json({
      teamId: updated.teamId,
      enabled: updated.enabled,
      signingSecretSet: updated.signingSecret !== null,
      updatedAt: updated.updatedAt,
      updatedBy: updated.updatedBy,
    });
  });

  // ---- POST /settings/slack-link(Slack連携用ワンタイムトークンの確定。docs/external-api/slack.md) ----
  // 権限チェック無し(認証済みなら誰でも「自分のSlackアカウント」を連携できる — apiKeys や
  // /settings/notifications/me と同じ「自分用なので権限不要」の考え方。全従業員が使うため)。
  // Slack側で `/punch link` を実行した本人だけがこのトークンを知っているという前提のもと、
  // トークンを知っている=そのSlackアカウントの持ち主だとみなして連携する。
  app.post("/slack-link", async (c) => {
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (typeof body.token !== "string" || body.token.length === 0) {
      return c.json({ error: "invalid_token" }, 400);
    }

    const now = nowMinutes();
    const tokenHash = await sha256Hex(body.token);
    const found = await findValidSlackLinkTokenByHash(db, tokenHash, now);
    // トークンが他テナント発行のものであっても素朴に「無効」として扱う(存在有無を漏らさない)。
    if (!found || found.tenantId !== user.tenantId) {
      return c.json({ error: "invalid_or_expired_token" }, 400);
    }

    await markSlackLinkTokenUsed(db, { id: found.id, usedAt: now });
    await linkSlackUser(db, { tenantId: user.tenantId, slackUserId: found.slackUserId, userId: user.id, linkedAt: now });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "slack_link.create",
      targetType: "slack_user_links",
      targetId: user.id,
      detail: JSON.stringify({ slackUserId: found.slackUserId }),
      occurredAt: now,
    });

    return c.json({ linked: true, slackUserId: found.slackUserId });
  });
}
