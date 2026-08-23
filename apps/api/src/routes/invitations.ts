/**
 * GET /invitations/:token, POST /invitations/:token/accept
 *
 * 招待受諾フロー(未認証・公開エンドポイント)。POST /members / POST /members/:id/invitations
 * (routes/members.ts)が発行したトークンを検証し、パスワードを設定して auth_credentials を
 * 作る(docs/requirements.md §認証)。受諾直後はそのままログイン状態にする(セッション発行 +
 * Cookie。登録直後にもう一度ログインを要求するのは無駄という依頼どおりの判断)。
 *
 * 判断点(404 と 410 の使い分け): トークンが無効な理由(存在しない・失効済み・受諾済み・
 * 期限切れ)は原則として区別せず 404 にする(トークン総当たりへの情報最小化 — 「失効済み」
 * を区別して返すと、そのトークンが過去に実在したことが漏れる)。ただし「期限切れ」だけは
 * 410 で区別する: 期限切れである以上そのトークンは(誰でもいずれ辿り着ける)有効な形式の
 * トークンであったことがバレても実害が薄く、逆に UI 側に「管理者に再発行を頼んでください」
 * という有用な導線が要るため、情報最小化とのトレードオフでここだけ区別する価値があると判断した。
 */

import {
  acceptInvitation,
  findInvitationByTokenHash,
  getTenantById,
  getUserById,
  insertAuditLog,
  type Database,
} from "@kizami/db";
import { Hono } from "hono";
import { sha256Hex } from "../auth/api-key.js";
import { hashPassword } from "../auth/password.js";
import { createSession, setSessionCookie } from "../auth/session.js";
import { nowMinutes } from "../lib/time.js";

/** docs/requirements.md にパスワードポリシーの明記が無いため、既存の慣行が無い中での最低ライン。 */
const MIN_PASSWORD_LENGTH = 12;

/** トークンから招待を探し、有効性を判定する。無効の理由まで返すのはこのファイル内部の利用のみ。 */
async function resolveInvitation(db: Database, token: string) {
  const hash = await sha256Hex(token);
  const invitation = await findInvitationByTokenHash(db, hash);
  const now = nowMinutes();

  if (!invitation || invitation.revokedAt !== null || invitation.acceptedAt !== null) {
    return { status: "not_found" as const, hash, now };
  }
  if (invitation.expiresAt <= now) {
    return { status: "expired" as const, hash, now };
  }
  return { status: "valid" as const, hash, now, invitation };
}

export function createInvitationsRoutes(db: Database, options: { secureCookies: boolean }) {
  const app = new Hono();

  /** トークン検証(受諾画面の表示用)。有効なら受諾対象の表示情報のみ返す。 */
  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    const resolved = await resolveInvitation(db, token);

    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);

    const { invitation } = resolved;
    const [user, tenant] = await Promise.all([
      getUserById(db, { tenantId: invitation.tenantId, id: invitation.userId }),
      getTenantById(db, invitation.tenantId),
    ]);
    // 招待は既存の user/tenant 行に紐づくため理論上は必ず見つかるが、防御的に404にする。
    if (!user || !tenant) return c.json({ error: "not_found" }, 404);

    return c.json({ tenantName: tenant.name, userName: user.name, email: user.email });
  });

  /** 受諾: パスワードを設定して auth_credentials を作成し、そのままログイン状態にする。 */
  app.post("/:token/accept", async (c) => {
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

    const resolved = await resolveInvitation(db, token);
    if (resolved.status === "not_found") return c.json({ error: "not_found" }, 404);
    if (resolved.status === "expired") return c.json({ error: "expired" }, 410);

    const passwordHash = await hashPassword(password);
    const result = await acceptInvitation(db, { tokenHash: resolved.hash, passwordHash, nowMinutes: resolved.now });
    if (!result) {
      // resolveInvitation の判定から acceptInvitation の実行までの間に、別リクエストが
      // 先に受諾・失効させた(競合)。理由は区別せず404にする(このファイル冒頭の判断点どおり)。
      return c.json({ error: "not_found" }, 404);
    }

    await insertAuditLog(db, {
      tenantId: result.tenantId,
      actorId: result.userId,
      action: "invitation.accept",
      targetType: "user",
      targetId: result.userId,
      detail: JSON.stringify({}),
      occurredAt: resolved.now,
    });

    const session = await createSession(db, { tenantId: result.tenantId, userId: result.userId, nowMinutes: resolved.now });
    setSessionCookie(c, session.token, { secure: options.secureCookies });

    const user = await getUserById(db, { tenantId: result.tenantId, id: result.userId });
    return c.json({ user: { id: result.userId, email: user?.email ?? null, displayName: user?.name ?? null } }, 200);
  });

  return app;
}
