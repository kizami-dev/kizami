/**
 * GET /api-keys, POST /api-keys, DELETE /api-keys/:id
 *
 * 公開打刻APIキー(APIキー認証、auth/api-key.ts)のセルフサービス管理API。
 *
 * - 自分のキーは本人が一覧・発行・失効できる(権限不要)
 * - 他人のキーの一覧・失効・代理発行には `api_key.manage`(tenant スコープのみ、
 *   docs/design/permission-catalog.md §1.14)が要る
 * - 平文トークンは POST のレスポンスにのみ含まれ、以後(GET 含め)一切返らない
 * - このルーター自体は APIキー認証では一切アクセスできない(auth/api-key-scope-guard.ts の
 *   許可表に載っていないため常に 403 になる)。漏洩したAPIキー1本でAPIキーを増発・失効
 *   できてしまうことを避けるための意図的な制限(依頼「安全側に倒す判断」)
 */

import { Hono } from "hono";
import {
  getApiKeyById,
  insertApiKey,
  insertAuditLog,
  listApiKeys,
  revokeApiKey,
  type ApiKeySummary,
  type Database,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { generateApiKey } from "../auth/api-key.js";
import { API_KEY_SCOPES, isApiKeyScope, type ApiKeyScope } from "../auth/api-key-scopes.js";
import { requirePermission } from "../authz.js";
import { nowMinutes } from "../lib/time.js";

const MANAGE_PERMISSION = "api_key.manage";
const NAME_MAX_LENGTH = 100;

function serialize(row: ApiKeySummary) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    scopes: JSON.parse(row.scopes) as ApiKeyScope[],
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function createApiKeysRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  /** 自分のキー一覧(既定)。?userId=<他人> は api_key.manage(tenant)が要る。 */
  app.get("/", async (c) => {
    const user = c.get("user");
    const queryUserId = c.req.query("userId");

    let targetUserId: string | undefined = user.id;
    if (queryUserId !== undefined && queryUserId !== user.id) {
      requirePermission(c, MANAGE_PERMISSION, "tenant");
      targetUserId = queryUserId;
    }

    const rows = await listApiKeys(db, { tenantId: user.tenantId, userId: targetUserId });
    return c.json({ apiKeys: rows.map(serialize) });
  });

  /** 発行。既定は自分用。body.userId で他人用に発行するには api_key.manage(tenant)が要る。 */
  app.post("/", async (c) => {
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { name, scopes, expiresAt, userId } = body as {
      name?: unknown;
      scopes?: unknown;
      expiresAt?: unknown;
      userId?: unknown;
    };

    if (typeof name !== "string" || name.trim() === "" || name.length > NAME_MAX_LENGTH) {
      return c.json({ error: "invalid_name" }, 400);
    }
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every(isApiKeyScope)) {
      return c.json({ error: "invalid_scopes", validScopes: API_KEY_SCOPES }, 400);
    }

    let expiresAtMinutes: number | null = null;
    if (expiresAt !== undefined && expiresAt !== null) {
      if (typeof expiresAt !== "number" || !Number.isInteger(expiresAt)) {
        return c.json({ error: "invalid_expires_at" }, 400);
      }
      expiresAtMinutes = expiresAt;
    }

    let targetUserId = user.id;
    if (typeof userId === "string" && userId !== "" && userId !== user.id) {
      requirePermission(c, MANAGE_PERMISSION, "tenant");
      targetUserId = userId;
    }

    const { token, hash } = await generateApiKey();
    const now = nowMinutes();
    const uniqueScopes = [...new Set(scopes as ApiKeyScope[])];

    const row = await insertApiKey(db, {
      tenantId: user.tenantId,
      userId: targetUserId,
      name: name.trim(),
      keyHash: hash,
      scopes: uniqueScopes,
      expiresAt: expiresAtMinutes,
      createdBy: user.id,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "api_key.create",
      targetType: "api_key",
      targetId: row.id,
      detail: JSON.stringify({ name: row.name, scopes: uniqueScopes, userId: targetUserId, expiresAt: expiresAtMinutes }),
      occurredAt: now,
    });

    // 平文トークンはこのレスポンスにのみ含まれる(以後は二度と取得できない)。
    return c.json({ apiKey: { ...serialize(row), token } }, 201);
  });

  /** 失効。自分のキーは本人が失効できる。他人のキーは api_key.manage(tenant)が要る。 */
  app.delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const existing = await getApiKeyById(db, { tenantId: user.tenantId, id });
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }
    if (existing.userId !== user.id) {
      requirePermission(c, MANAGE_PERMISSION, "tenant");
    }
    if (existing.revokedAt !== null) {
      return c.json({ error: "already_revoked" }, 409);
    }

    const now = nowMinutes();
    const revoked = await revokeApiKey(db, { tenantId: user.tenantId, id, revokedAt: now });
    if (!revoked) {
      // 直前の getApiKeyById 以降に別リクエストが先に失効させた(競合)場合。
      return c.json({ error: "already_revoked" }, 409);
    }

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "api_key.revoke",
      targetType: "api_key",
      targetId: id,
      detail: JSON.stringify({ userId: existing.userId, name: existing.name }),
      occurredAt: now,
    });

    return c.json({ apiKey: serialize(revoked) });
  });

  return app;
}
