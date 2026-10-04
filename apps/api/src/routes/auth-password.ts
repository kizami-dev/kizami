/**
 * ログイン中の本人によるパスワード変更: POST /auth/password/change(2026-10-04 追加)。
 *
 * 二要素認証のセルフサービス(routes/auth-totp.ts)と同じ置き場・同じ作法 — 認証済み本人のみ・
 * 権限チェック無し(対象は常にセッションの本人)。APIキー認証では触れない
 * (auth/api-key-scope-guard.ts の許可表に載せていない = 403)。
 *
 * 入力は `{ currentPassword, newPassword }`。
 *
 * ## 判断点
 *
 * - **現在のパスワードの再確認**: 2FA の無効化(auth-totp.ts)と同じ理由で、盗まれたセッションだけで
 *   パスワードを書き換えられないようにする(パスワードを変えられると本人が締め出される)。不一致は
 *   400 `invalid_current_password`(auth-totp.ts の verifyCurrentPassword と同じ 400)。
 * - **新しいパスワード**は既存のポリシー関数(auth/password-policy.ts)で検証する。現在のパスワードと
 *   同じなら 400 `same_password`(変更の意味が無く、「変えたつもり」で全セッションが落ちるだけになる)。
 * - **今のセッションだけ残し、本人のほかのセッションをすべて失効**させる。変更の動機は「ほかの端末・
 *   誰かに知られたかもしれない」ことが多く、旧パスワードで張られた他端末のセッションを残すと意味が
 *   ない。今のセッションまで落とすと「変えた直後にもう一度ログイン」になり無駄(リセットの使用が
 *   そのままログイン状態にするのと同じ判断)。
 * - **APIキーは失効させない**: 公開打刻 API のキー(routes/api-keys.ts)は人のログインとは別系統の
 *   資格情報で、IC カードリーダー等の機器が使っている。パスワード変更で機器の打刻が止まるのは
 *   意図しない副作用になる(漏れたキーの失効は設定画面から個別に行う)。
 * - 再設定トークンの扱い: 変更した時点で、そのユーザーの未決着の再設定トークンも発行経路を問わず
 *   全部失効する(queries/password-self-service.ts の changeOwnPassword)。
 * - **パスワード資格情報が無い**ユーザー(SSO のみ等)は 409 `no_password_credential`
 *   (auth-totp.ts の `not_enabled` / members.ts の `not_active` と同じ「状態が合わない」の 409)。
 * - **レート制限**: `ip|userId` で 15分10回(RATE_LIMITS.passwordChangePerIpUser)。現在のパスワードの
 *   照合を伴うので総当たりの的になる。入力形式の不正(400)は数えず、照合に進む試行から数える。
 * - 監査ログ `auth.password_change`(actor = 本人、target = 本人)。
 * - 2FA は変更しない(パスワード変更は TOTP の有効/無効に影響しない)。
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { authCredentials, changeOwnPassword, type Database } from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { isAcceptablePassword, MIN_PASSWORD_LENGTH } from "../auth/password-policy.js";
import { getSessionTokenFromCookie, sessionIdFromToken } from "../auth/session.js";
import { getClientIp } from "../lib/client-ip.js";
import { rateLimitedResponse, type RateLimiter } from "../lib/rate-limit.js";
import { nowMinutes } from "../lib/time.js";

export interface PasswordChangeRoutesOptions {
  /** `ip|userId` ごとの制限。省略時は制限なし(ルータを単体で組み立てるテスト用。実アプリの配線は app.ts) */
  rateLimit?: { perIpUser: RateLimiter; trustProxy: boolean };
}

export function createPasswordChangeRoutes(db: Database, options: PasswordChangeRoutesOptions) {
  const app = new Hono<AppEnv>();

  app.post("/change", async (c) => {
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
    const { currentPassword, newPassword } = body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof currentPassword !== "string" || currentPassword === "") {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!isAcceptablePassword(newPassword)) {
      return c.json({ error: "invalid_new_password", minLength: MIN_PASSWORD_LENGTH }, 400);
    }

    if (options.rateLimit) {
      const ip = getClientIp(c, options.rateLimit.trustProxy);
      const result = options.rateLimit.perIpUser.check(`${ip}|${user.id}`);
      if (!result.allowed) return rateLimitedResponse(c, result.retryAfterSeconds);
    }

    // 残すセッション = 今のリクエストのもの(認証ミドルウェアを通っているので Cookie はある)。
    const token = getSessionTokenFromCookie(c);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const currentSessionId = await sessionIdFromToken(token);

    const rows = await db
      .select()
      .from(authCredentials)
      .where(and(eq(authCredentials.tenantId, user.tenantId), eq(authCredentials.userId, user.id)))
      .limit(1);
    const cred = rows[0];
    if (!cred) return c.json({ error: "no_password_credential" }, 409);

    if (!(await verifyPassword(currentPassword, cred.passwordHash))) {
      return c.json({ error: "invalid_current_password" }, 400);
    }
    if (newPassword === currentPassword) {
      return c.json({ error: "same_password" }, 400);
    }

    // PBKDF2(重い)はトランザクションの外で済ませる(routes/signup.ts と同じ)。
    const passwordHash = await hashPassword(newPassword);
    const changed = await changeOwnPassword(db, {
      tenantId: user.tenantId,
      userId: user.id,
      passwordHash,
      currentSessionId,
      nowMinutes: nowMinutes(),
    });
    // 照合から更新までの間に資格情報が消えた(想定外の競合)。状態が合わないとして 409 にする。
    if (!changed) return c.json({ error: "no_password_credential" }, 409);

    return c.json({ changed: true, otherSessionsRevoked: true });
  });

  return app;
}
