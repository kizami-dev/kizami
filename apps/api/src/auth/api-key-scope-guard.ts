/**
 * APIキー認証で通ったリクエストのスコープ検証(依頼「エンドポイントの許可表」)。
 *
 * セッションCookie認証のリクエスト(`c.get("apiKeyScopes")` が undefined)には一切影響しない
 * ("既存のセッション認証の挙動は一切変えないこと" を満たすため、判定はAPIキー認証のときのみ行う)。
 *
 * 許可表に無いエンドポイント(設定変更・承認・締め・メンバー管理…)は、APIキーがどんなスコープを
 * 持っていても一律403にする(依頼「それ以外のエンドポイントはAPIキーでは一切アクセスできない」
 * ―安全側に倒す判断)。新しくAPIキー経由のエンドポイントを開放したい場合は、ここに1行足す。
 */

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./middleware.js";
import type { ApiKeyScope } from "./api-key-scopes.js";

interface ScopeRule {
  method: string;
  /** c.req.path との完全一致(パスパラメータを持つエンドポイントは現状対象外)。 */
  path: string;
  /** このいずれか1つでもキーが持っていれば許可。 */
  anyOf: readonly ApiKeyScope[];
}

/**
 * APIキーでアクセスできるエンドポイントの一覧(依頼の表そのもの)。
 * - punch スコープ: POST /punches, GET /punches, GET /attendance/status
 * - read スコープ: GET /attendance/monthly, GET /punches, GET /attendance/status, GET /leave/balance
 */
const ALLOWLIST: readonly ScopeRule[] = [
  { method: "POST", path: "/punches", anyOf: ["punch"] },
  { method: "GET", path: "/punches", anyOf: ["punch", "read"] },
  { method: "GET", path: "/attendance/status", anyOf: ["punch", "read"] },
  { method: "GET", path: "/attendance/monthly", anyOf: ["read"] },
  { method: "GET", path: "/leave/balance", anyOf: ["read"] },
];

/**
 * node.ts はリバースプロキシ配下(`kizami.example.com/api/*`)向けに、同じアプリを
 * `/api` プレフィクス付きでも(パス書き換えなしで)提供する(node.ts 冒頭コメント参照)。
 * その場合 `c.req.path` は `/api/punches` のようにプレフィクスを含んだまま渡ってくるため、
 * 許可表と比較する前に先頭の `/api` を取り除いて正規化する。
 */
function normalizePath(path: string): string {
  return path.startsWith("/api/") ? path.slice(4) : path;
}

export function apiKeyScopeGuardMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const scopes = c.get("apiKeyScopes");
    if (scopes === undefined) {
      // セッションCookie認証(またはこのミドルウェアより前で401になっている)。制限しない
      await next();
      return;
    }

    const path = normalizePath(c.req.path);
    const rule = ALLOWLIST.find((r) => r.method === c.req.method && r.path === path);
    if (!rule || !rule.anyOf.some((s) => scopes.has(s))) {
      return c.json({ error: "insufficient_api_key_scope" }, 403);
    }
    await next();
  };
}
