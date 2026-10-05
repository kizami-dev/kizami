/**
 * 退会手続き中のテナントのリクエストを絞る(2026-10-05、docs/design/tenant-withdrawal.md)。
 *
 * 認証ミドルウェア(auth/middleware.ts)と API キーのスコープ検証(api-key-scope-guard.ts)の
 * **後ろ**に置く — 誰のリクエストか・どの権限を持つかが確定してから判定するため。
 * 通常の状態のテナントには、テナント行を主キーで1回読む以外の影響は無い。
 *
 * 退会手続き中のテナントでは:
 *
 * | リクエスト | 応答 |
 * | --- | --- |
 * | API キー(打刻クライアント・MCP) | 403 `tenant_withdrawing` |
 * | `tenant.withdraw` を持たない人のセッション | 401 `tenant_withdrawing`(Web はログイン画面へ戻して理由を出す) |
 * | `tenant.withdraw` を持つ人の閲覧(GET / HEAD) | 通す(全データのエクスポートも GET) |
 * | 同じ人の書き込みのうち、退会の取り消し | 通す |
 * | 同じ人のそれ以外の書き込み | 409 `tenant_withdrawing` |
 *
 * セッション・API キーを消さずに断る理由は lib/tenant-withdrawal.ts の冒頭を参照。
 */

import type { MiddlewareHandler } from "hono";
import type { Database } from "@kizami/db";
import { canOperateWithdrawingTenant, isTenantWithdrawing, TENANT_WITHDRAWING_ERROR } from "../lib/tenant-withdrawal.js";
import type { AppEnv } from "./middleware.js";

/** 退会手続き中でも通す書き込み(メソッドとパスの完全一致)。 */
const WRITES_ALLOWED_WHILE_WITHDRAWING: readonly { method: string; path: string }[] = [
  { method: "POST", path: "/tenant/withdrawal/cancel" },
];

/** node.ts が `/api` プレフィクス付きでも同じアプリを提供するため、比較の前に取り除く(api-key-scope-guard.ts と同じ)。 */
function normalizePath(path: string): string {
  return path.startsWith("/api/") ? path.slice(4) : path;
}

export function tenantWithdrawalGuardMiddleware(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!(await isTenantWithdrawing(db, user.tenantId))) {
      await next();
      return;
    }

    if (c.get("apiKeyScopes") !== undefined) {
      return c.json({ error: TENANT_WITHDRAWING_ERROR }, 403);
    }
    if (!canOperateWithdrawingTenant(c.get("permissions"))) {
      return c.json({ error: TENANT_WITHDRAWING_ERROR }, 401);
    }
    const method = c.req.method;
    if (method === "GET" || method === "HEAD") {
      await next();
      return;
    }
    const path = normalizePath(c.req.path);
    if (WRITES_ALLOWED_WHILE_WITHDRAWING.some((rule) => rule.method === method && rule.path === path)) {
      await next();
      return;
    }
    return c.json({ error: TENANT_WITHDRAWING_ERROR }, 409);
  };
}
