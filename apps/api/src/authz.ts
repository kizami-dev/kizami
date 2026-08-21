/**
 * 認可の差し込み点。
 *
 * v0.1 は全エンドポイントが本人スコープのみ(docs/design/permission-catalog.md 前提:
 * セルフサービス権限は固定でプリセット対象外)。将来、部署スコープ・業務タスク権限
 * (permission-catalog.md)による評価に差し替える際、呼び出し側を変えずに済むよう
 * 本人一致チェックを独立関数として切り出している。
 */

import type { Context } from "hono";
import type { AppEnv } from "./auth/middleware.js";

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** 認証済みユーザー自身が対象(targetUserId)でなければ ForbiddenError を投げる。 */
export function requireSelf(c: Context<AppEnv>, targetUserId: string): void {
  const actor = c.get("user");
  if (actor.id !== targetUserId) {
    throw new ForbiddenError("self-scope only in v0.1");
  }
}
