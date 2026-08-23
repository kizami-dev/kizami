/**
 * GET /password-resets/:token, POST /password-resets/:token/use
 *
 * 管理者発行パスワードリセットの使用フロー(未認証・公開エンドポイント、Tier 0)。
 * POST /members/:id/password-resets(routes/members.ts)が発行したトークンを検証し、
 * 新しいパスワードを設定する。設計・判断点は routes/invitations.ts(招待受諾)と同型:
 *
 * - 404 と 410 の使い分け: トークンが無効な理由(存在しない・失効済み・使用済み・期限切れ)は
 *   原則として区別せず 404 にする(トークン総当たりへの情報最小化)。期限切れだけは 410 で
 *   区別する(有用な「再発行を依頼してください」の導線のため、情報最小化とのトレードオフを
 *   あえて取る)。routes/invitations.ts 冒頭コメントと同じ判断。
 * - 使用成功後はそのままログイン状態にする(セッション発行 + Cookie)。パスワードを
 *   再設定した直後にもう一度ログインを要求するのは無駄という、招待受諾と同じ判断。
 */

import {
  findPasswordResetTokenByHash,
  getTenantById,
  getUserById,
  usePasswordResetToken,
  type Database,
} from "@kizami/db";
import { Hono } from "hono";
import { sha256Hex } from "../auth/api-key.js";
import { hashPassword } from "../auth/password.js";
import { createSession, setSessionCookie } from "../auth/session.js";
import { nowMinutes } from "../lib/time.js";

/** routes/invitations.ts の MIN_PASSWORD_LENGTH と同一の最低ライン(依頼「invitations の検証と同一」)。 */
const MIN_PASSWORD_LENGTH = 12;

/** トークンからリセットトークンを探し、有効性を判定する。無効の理由まで返すのはこのファイル内部の利用のみ。 */
async function resolvePasswordReset(db: Database, token: string) {
  const hash = await sha256Hex(token);
  const resetToken = await findPasswordResetTokenByHash(db, hash);
  const now = nowMinutes();

  if (!resetToken || resetToken.revokedAt !== null || resetToken.usedAt !== null) {
    return { status: "not_found" as const, hash, now };
  }
  if (resetToken.expiresAt <= now) {
    return { status: "expired" as const, hash, now };
  }
  return { status: "valid" as const, hash, now, resetToken };
}

export function createPasswordResetsRoutes(db: Database, options: { secureCookies: boolean }) {
  const app = new Hono();

  /** トークン検証(パスワード再設定画面の表示用)。有効なら対象の表示情報のみ返す。 */
  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    const resolved = await resolvePasswordReset(db, token);

    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);

    const { resetToken } = resolved;
    const [user, tenant] = await Promise.all([
      getUserById(db, { tenantId: resetToken.tenantId, id: resetToken.userId }),
      getTenantById(db, resetToken.tenantId),
    ]);
    // リセットトークンは既存の user/tenant 行に紐づくため理論上は必ず見つかるが、防御的に404にする。
    if (!user || !tenant) return c.json({ error: "not_found" }, 404);

    return c.json({ tenantName: tenant.name, userName: user.name, email: user.email });
  });

  /** 使用: 新しいパスワードを設定し、そのままログイン状態にする。 */
  app.post("/:token/use", async (c) => {
    const token = c.req.param("token");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { password } = body as { password?: unknown };
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return c.json({ error: "invalid_password", minLength: MIN_PASSWORD_LENGTH }, 400);
    }

    const resolved = await resolvePasswordReset(db, token);
    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);

    const passwordHash = await hashPassword(password);
    const result = await usePasswordResetToken(db, { tokenHash: resolved.hash, passwordHash, nowMinutes: resolved.now });
    if (!result) {
      // resolvePasswordReset の判定から usePasswordResetToken の実行までの間に、別リクエストが
      // 先に使用・失効させた(競合)。理由は区別せず404にする(このファイル冒頭の判断点どおり)。
      return c.json({ error: "not_found" }, 404);
    }
    // ここまでで usePasswordResetToken のトランザクションはコミット済み: auth_credentials の
    // 更新・全セッション失効・監査ログはどれも確定している。

    // セッション発行はパスワード更新とは別のトランザクション・別の関心事として意図的に分離する
    // (routes/invitations.ts の POST /:token/accept と同じ理由)。ここが失敗しても
    // 「パスワード再設定自体が失敗した」という誤ったメッセージ(500 internal_error)は返さない。
    let session: Awaited<ReturnType<typeof createSession>>;
    try {
      session = await createSession(db, { tenantId: result.tenantId, userId: result.userId, nowMinutes: resolved.now });
    } catch {
      return c.json(
        {
          passwordUpdated: true,
          error: "session_issuance_failed",
          message: "パスワードは更新済みです。お手数ですが、ログイン画面から改めてログインしてください。",
        },
        200,
      );
    }
    setSessionCookie(c, session.token, { secure: options.secureCookies });

    const user = await getUserById(db, { tenantId: result.tenantId, id: result.userId });
    return c.json({ user: { id: result.userId, email: user?.email ?? null, displayName: user?.name ?? null } }, 200);
  });

  return app;
}
