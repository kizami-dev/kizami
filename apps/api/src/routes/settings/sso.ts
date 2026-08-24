/**
 * GET/PUT /settings/sso — テナント単位の OIDC(SSO)設定。docs/design/sso-oidc.md が仕様の正。
 *
 * 権限は専用キー `tenant_settings.auth.manage`(TENANT_ONLY・危険フラグあり)。
 * 通知チャネル設定の使い回しにしなかった理由は permissions.ts の定数コメントを参照。
 *
 * 秘密情報のマスキング(GET のレスポンス): client_secret は全文もプレビューも返さない。
 * 「設定済みかどうか」の `clientSecretSet: boolean` のみ(tenant_slack_settings の
 * signingSecretSet と同じ形 — シークレットは URL と違い、見せる意味のある部分文字列が無い)。
 *
 * PUT の3値ルール・暗号化の扱いは routes/settings/notifications.ts と同じ:
 * 省略=維持 / null・""=クリア / 文字列=置換。この PUT で新たに(空でない)client_secret が
 * 指定されたときだけ暗号化して保存し、encryptor が無ければ 503 で保存自体を拒否する
 * (平文フォールバックはしない)。
 */

import type { Hono } from "hono";
import { getTenantOidcSettings, insertAuditLog, upsertTenantOidcSettings, type Database } from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import type { Encryptor } from "../../lib/encryption.js";
import { resolveStringField } from "../../lib/field-validation.js";
import { nowMinutes } from "../../lib/time.js";
import { SSO_SETTINGS_PERMISSION } from "./permissions.js";
import { parseJsonRecord, type SettingsRoutesDeps } from "./shared.js";

/**
 * issuer は https の URL のみ受け付ける(http を許すと、社内 LAN でのなりすましや
 * 中間者による ID トークン差し替えが成立しうる)。クエリ・フラグメント付きも拒否する
 * ── ディスカバリ URL は `{issuer}/.well-known/openid-configuration` の単純連結で作るため。
 */
function isValidIssuer(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.search !== "" || parsed.hash !== "") return false;
  return true;
}

function serialize(settings: Awaited<ReturnType<typeof getTenantOidcSettings>>) {
  return {
    issuer: settings?.issuer ?? null,
    clientId: settings?.clientId ?? null,
    enabled: settings?.enabled ?? false,
    allowUnverifiedEmail: settings?.allowUnverifiedEmail ?? false,
    clientSecretSet: settings?.clientSecret !== null && settings?.clientSecret !== undefined,
    updatedAt: settings?.updatedAt ?? null,
    updatedBy: settings?.updatedBy ?? null,
  };
}

export function registerSsoRoutes(app: Hono<AppEnv>, db: Database, deps: SettingsRoutesDeps) {
  app.get("/sso", async (c) => {
    requirePermission(c, SSO_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");
    return c.json(serialize(await getTenantOidcSettings(db, user.tenantId)));
  });

  app.put("/sso", async (c) => {
    requirePermission(c, SSO_SETTINGS_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (typeof body.enabled !== "boolean") return c.json({ error: "invalid_enabled" }, 400);
    if (body.allowUnverifiedEmail !== undefined && typeof body.allowUnverifiedEmail !== "boolean") {
      return c.json({ error: "invalid_allow_unverified_email" }, 400);
    }

    const existing = await getTenantOidcSettings(db, user.tenantId);

    const issuerResult = resolveStringField(body.issuer, existing?.issuer ?? null);
    if (!issuerResult.ok) return c.json({ error: "invalid_issuer" }, 400);
    const issuer = issuerResult.value;
    if (issuer !== null && !isValidIssuer(issuer)) return c.json({ error: "invalid_issuer" }, 400);

    const clientIdResult = resolveStringField(body.clientId, existing?.clientId ?? null);
    if (!clientIdResult.ok) return c.json({ error: "invalid_client_id" }, 400);

    const clientSecretResult = resolveStringField(body.clientSecret, existing?.clientSecret ?? null);
    if (!clientSecretResult.ok) return c.json({ error: "invalid_client_secret" }, 400);
    // 「この PUT で新たに(空でない)client_secret が指定されたか」(維持・クリアとは区別する)
    const clientSecretProvided = body.clientSecret !== undefined;
    const clientSecretNeedsEncryption = clientSecretProvided && clientSecretResult.value !== null;
    if (clientSecretNeedsEncryption && !deps.encryptor) {
      return c.json({ error: "encryption_unavailable" }, 503);
    }

    // 有効化するには issuer・clientId・clientSecret の3点が(既存値の維持を含め)揃っている必要がある
    // (どれか欠けたまま有効化すると、ログイン画面に出た SSO ボタンが必ず失敗する壊れた状態になる)。
    if (body.enabled && (issuer === null || clientIdResult.value === null || clientSecretResult.value === null)) {
      return c.json({ error: "invalid_sso_config" }, 400);
    }

    const clientSecretToStore = clientSecretNeedsEncryption
      ? await (deps.encryptor as Encryptor).encrypt(clientSecretResult.value as string)
      : clientSecretResult.value;

    const allowUnverifiedEmail =
      typeof body.allowUnverifiedEmail === "boolean" ? body.allowUnverifiedEmail : (existing?.allowUnverifiedEmail ?? false);

    const now = nowMinutes();
    const updated = await upsertTenantOidcSettings(db, {
      tenantId: user.tenantId,
      issuer,
      clientId: clientIdResult.value,
      clientSecret: clientSecretToStore,
      enabled: body.enabled,
      allowUnverifiedEmail,
      updatedAt: now,
      updatedBy: user.id,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "oidc_settings.update",
      targetType: "tenant_oidc_settings",
      targetId: user.tenantId,
      // シークレットそのものは残さない(他の秘密情報と同じ方針。「変更されたか」だけ記録する)。
      detail: JSON.stringify({
        issuer: updated.issuer,
        clientId: updated.clientId,
        enabled: updated.enabled,
        allowUnverifiedEmail: updated.allowUnverifiedEmail,
        clientSecretChanged: clientSecretProvided,
      }),
      occurredAt: now,
    });

    return c.json(serialize(updated));
  });
}
