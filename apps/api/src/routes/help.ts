/**
 * GET /help/overrides, PUT /help/overrides/:key, DELETE /help/overrides/:key
 *
 * テナントが組み込みヘルプ(@kizami/help-content)に追記する「自社の規定」
 * (help_overrides、docs/design/ui-direction.md「ガイド・ヘルプの方針 > 社内規定の併記」)。
 *
 * GET は認証だけで読める(requirePermission を呼ばない) — 従業員も自社の規定
 * (例: 有給の申請期限)を読む必要があるため、権限プリセットの有無に関わらず全員に見せる。
 * 就業規則リンク(work_rules_url)も同じ理由でここに含めて返す(GET /settings/tenant-profile 等
 * 権限が要る他のテナント設定と異なり、こちらは全員向けの参照情報)。
 *
 * PUT/DELETE は権限が必要。
 *
 * 権限の判断点: docs/design/permission-catalog.md の `tenant_settings.*`(calendar/flex/gps/
 * auto_deduction)はいずれも「集計に影響する入力」を対象にしたグループで、ヘルプ文言という
 * 集計に影響しない運用設定にはどれも当てはまらない。依頼が代替として明示した
 * `notification.settings.manage`(通知チャネルという、これも集計に影響しない
 * テナント全体の運用設定)を「テナント全体の一般設定を管理できる」権限として転用する
 * (settings.ts の LEAVE_SETTINGS_PERMISSION / TENANT_PROFILE_PERMISSION と同じ、
 * 新規権限キーを増やさずカタログの近い権限を転用する既存の流儀)。
 *
 * help_key の検証: @kizami/help-content の HELP_KEYS(HelpKey の実行時版)に存在するキーのみ
 * 受け付ける。存在しないキーは 400。空文字の bodyMd は削除として扱う(依頼どおり)。
 */

import { Hono } from "hono";
import { HELP_KEYS } from "@kizami/help-content";
import { deleteHelpOverride, getHelpOverrides, getTenantById, insertAuditLog, upsertHelpOverride, type Database } from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { nowMinutes } from "../lib/time.js";

/** notification.settings.manage を転用する理由はファイル冒頭コメント参照。 */
export const HELP_OVERRIDES_PERMISSION = "notification.settings.manage";

const HELP_KEY_SET: ReadonlySet<string> = new Set(HELP_KEYS);

function isValidHelpKey(value: string): boolean {
  return HELP_KEY_SET.has(value);
}

export function createHelpRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/overrides", async (c) => {
    const user = c.get("user");
    const [overridesByKey, tenant] = await Promise.all([getHelpOverrides(db, user.tenantId), getTenantById(db, user.tenantId)]);

    const overrides: Record<string, { bodyMd: string; updatedAt: number }> = {};
    for (const [key, row] of Object.entries(overridesByKey)) {
      overrides[key] = { bodyMd: row.bodyMd, updatedAt: row.updatedAt };
    }

    return c.json({ overrides, workRulesUrl: tenant?.workRulesUrl ?? null });
  });

  app.put("/overrides/:key", async (c) => {
    requirePermission(c, HELP_OVERRIDES_PERMISSION, "tenant");
    const user = c.get("user");
    const key = c.req.param("key");
    if (!isValidHelpKey(key)) {
      return c.json({ error: "invalid_help_key" }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null || typeof (body as Record<string, unknown>).bodyMd !== "string") {
      return c.json({ error: "invalid_body_md" }, 400);
    }
    const bodyMd = (body as { bodyMd: string }).bodyMd;

    const now = nowMinutes();

    // 空文字は削除扱い(依頼どおり)。
    if (bodyMd === "") {
      await deleteHelpOverride(db, user.tenantId, key);
      await insertAuditLog(db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "help_override.delete",
        targetType: "help_override",
        targetId: key,
        detail: JSON.stringify({ helpKey: key }),
        occurredAt: now,
      });
      return c.json({ deleted: true });
    }

    const updated = await upsertHelpOverride(db, {
      tenantId: user.tenantId,
      helpKey: key,
      bodyMd,
      updatedBy: user.id,
      updatedAt: now,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "help_override.update",
      targetType: "help_override",
      targetId: key,
      detail: JSON.stringify({ helpKey: key, bodyMdLength: bodyMd.length }),
      occurredAt: now,
    });

    return c.json({ helpKey: updated.helpKey, bodyMd: updated.bodyMd, updatedAt: updated.updatedAt });
  });

  app.delete("/overrides/:key", async (c) => {
    requirePermission(c, HELP_OVERRIDES_PERMISSION, "tenant");
    const user = c.get("user");
    const key = c.req.param("key");
    if (!isValidHelpKey(key)) {
      return c.json({ error: "invalid_help_key" }, 400);
    }

    await deleteHelpOverride(db, user.tenantId, key);

    const now = nowMinutes();
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "help_override.delete",
      targetType: "help_override",
      targetId: key,
      detail: JSON.stringify({ helpKey: key }),
      occurredAt: now,
    });

    return c.json({ deleted: true });
  });

  return app;
}
