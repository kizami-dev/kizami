import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { extractCookie, grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

// JST 正午に固定して、テストを実行時刻から独立させる(invitations.test.ts と同じ流儀)。
const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

interface IssuePasswordResetResponse {
  passwordReset: { id: string; token: string; expiresAt: number };
}

async function issuePasswordReset(
  app: ReturnType<typeof createApp>,
  cookie: string,
  targetUserId: string,
): Promise<{ status: number; json: IssuePasswordResetResponse }> {
  const res = await app.request(`/members/${targetUserId}/password-resets`, {
    method: "POST",
    headers: { cookie },
  });
  return { status: res.status, json: await res.json() };
}

/**
 * setupTestDb() の管理者アカウントとは別に「受諾済み(auth_credentials あり)」の一般メンバーを
 * 用意する(パスワードリセットは招待とは違い、受諾済みユーザーのみを対象とするため)。
 */
async function inviteAndAcceptMember(
  app: ReturnType<typeof createApp>,
  cookie: string,
  params: { email: string; name: string; password: string },
): Promise<string> {
  const invited = await app.request("/members", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ email: params.email, name: params.name }),
  });
  const invitedBody = (await invited.json()) as { member: { id: string }; invitation: { token: string } };
  const token = invitedBody.invitation.token;

  const acceptRes = await app.request(`/invitations/${token}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: params.password }),
  });
  expect(acceptRes.status).toBe(200);

  return invitedBody.member.id;
}

describe("password resets (admin-issued, public use route)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("issue -> use -> can login with the new password, and the old session is invalidated", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);

    const memberId = await inviteAndAcceptMember(app, adminCookie, {
      email: "member@example.com",
      name: "Member",
      password: "original horse battery staple",
    });
    const memberCookie = await loginAndGetCookie(app, "member@example.com", "original horse battery staple");

    const issued = await issuePasswordReset(app, adminCookie, memberId);
    expect(issued.status).toBe(201);
    const token = issued.json.passwordReset.token;

    const useRes = await app.request(`/password-resets/${token}/use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "brand new horse battery staple" }),
    });
    expect(useRes.status).toBe(200);
    const useBody = (await useRes.json()) as { user: { id: string; email: string } };
    expect(useBody.user.id).toBe(memberId);

    // 使用の応答自体がそのままログイン状態(セッションCookie)になっている。
    const newCookie = extractCookie(useRes);
    const meRes = await app.request("/me", { headers: { cookie: newCookie } });
    expect(meRes.status).toBe(200);

    // 新しいパスワードでログインできる。
    const loginAfter = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.com", password: "brand new horse battery staple" }),
    });
    expect(loginAfter.status).toBe(200);

    // 旧パスワードではログインできない。
    const loginOld = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.com", password: "original horse battery staple" }),
    });
    expect(loginOld.status).toBe(401);

    // 使用前に張っていたセッションは失効している。
    const oldSessionRes = await app.request("/me", { headers: { cookie: memberCookie } });
    expect(oldSessionRes.status).toBe(401);
  });

  it("GET /password-resets/:token for a nonexistent token returns 404", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/password-resets/nonexistent-token");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("GET /password-resets/:token for an expired token returns 410", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    const issued = await issuePasswordReset(app, adminCookie, memberId);
    const token = issued.json.passwordReset.token;

    // 有効期限は24時間。25時間進めて期限切れにする。
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 25 * HOUR_MS));

    const res = await app.request(`/password-resets/${token}`);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expired" });
  });

  it("POST /password-resets/:token/use twice: the second attempt returns 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    const issued = await issuePasswordReset(app, adminCookie, memberId);
    const token = issued.json.passwordReset.token;

    const useBody = JSON.stringify({ password: "second attempt horse battery staple" });
    const first = await app.request(`/password-resets/${token}/use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: useBody,
    });
    expect(first.status).toBe(200);

    const second = await app.request(`/password-resets/${token}/use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: useBody,
    });
    expect(second.status).toBe(404);
  });

  it("POST /password-resets/:token/use rejects a password shorter than 12 characters with 400", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    const issued = await issuePasswordReset(app, adminCookie, memberId);
    const token = issued.json.passwordReset.token;

    const res = await app.request(`/password-resets/${token}/use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "short" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_password", minLength: 12 });
  });

  it("a bogus token is 404, both for display and for use", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const displayRes = await app.request("/password-resets/totally-bogus-token");
    expect(displayRes.status).toBe(404);

    const useRes = await app.request("/password-resets/totally-bogus-token/use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "irrelevant horse battery staple" }),
    });
    expect(useRes.status).toBe(404);
  });

  it("issuing a password reset for a member without credentials (not yet accepted the invitation) returns 409 not_active", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);

    const invited = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ email: "not-yet@example.com", name: "Not Yet" }),
    });
    const invitedBody = (await invited.json()) as { member: { id: string } };

    const res = await issuePasswordReset(app, adminCookie, invitedBody.member.id);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "not_active" });
  });

  it("issuing a password reset for a nonexistent member returns 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);

    const res = await issuePasswordReset(app, adminCookie, "nonexistent-user-id");
    expect(res.status).toBe(404);
  });

  it("reissuing a password reset invalidates the previous token, and revoking it makes it 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    const first = await issuePasswordReset(app, adminCookie, memberId);
    const oldToken = first.json.passwordReset.token;

    const second = await issuePasswordReset(app, adminCookie, memberId);
    expect(second.status).toBe(201);
    const newToken = second.json.passwordReset.token;
    expect(newToken).not.toBe(oldToken);

    const oldRes = await app.request(`/password-resets/${oldToken}`);
    expect(oldRes.status).toBe(404);

    // 現行トークンの取り消し(DELETE)。
    const revokeRes = await app.request(`/members/${memberId}/password-resets`, { method: "DELETE", headers: { cookie: adminCookie } });
    expect(revokeRes.status).toBe(200);

    const revokedRes = await app.request(`/password-resets/${newToken}`);
    expect(revokedRes.status).toBe(404);

    // 取り消し済みへの再度の取り消しは409(直近のトークンは存在するが既に決着済み)。
    const secondRevoke = await app.request(`/members/${memberId}/password-resets`, { method: "DELETE", headers: { cookie: adminCookie } });
    expect(secondRevoke.status).toBe(409);
    expect(await secondRevoke.json()).toEqual({ error: "already_revoked" });
  });

  it("GET /members shows hasPendingPasswordReset after issuing, and false after use", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    const before = await app.request("/members", { headers: { cookie: adminCookie } });
    const beforeBody = (await before.json()) as { members: { id: string; hasPendingPasswordReset: boolean }[] };
    expect(beforeBody.members.find((m) => m.id === memberId)?.hasPendingPasswordReset).toBe(false);

    const issued = await issuePasswordReset(app, adminCookie, memberId);
    const after = await app.request("/members", { headers: { cookie: adminCookie } });
    const afterBody = (await after.json()) as { members: { id: string; hasPendingPasswordReset: boolean }[] };
    expect(afterBody.members.find((m) => m.id === memberId)?.hasPendingPasswordReset).toBe(true);

    await app.request(`/password-resets/${issued.json.passwordReset.token}/use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "used up horse battery staple" }),
    });

    const afterUse = await app.request("/members", { headers: { cookie: adminCookie } });
    const afterUseBody = (await afterUse.json()) as { members: { id: string; hasPendingPasswordReset: boolean }[] };
    expect(afterUseBody.members.find((m) => m.id === memberId)?.hasPendingPasswordReset).toBe(false);
  });

  // 補足(invitations.test.ts のレビュー指摘3と同種の懸念): usePasswordResetToken は
  // パスワード更新と全セッション revoke を同一トランザクションで行うため、invitations の
  // acceptInvitation(セッションを一切触らないトランザクション)と異なり、sessions テーブルの
  // 障害を「使用自体は成功済みで、後段のセッション発行だけが失敗する」ケースとして単体では
  // 再現できない(sessions テーブルを壊すと usePasswordResetToken 自体が失敗し 500 になる)。
  // ルート側のフォールバック分岐(routes/password-resets.ts の catch { … session_issuance_failed … })
  // 自体は routes/invitations.ts の POST /:token/accept と全く同じ形で実装してあり、
  // createSession が独立してスローするケース(DB接続断など)をそちらでカバーする。
});
