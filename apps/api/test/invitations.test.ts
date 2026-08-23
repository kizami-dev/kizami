import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { extractCookie, grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

// JST 正午(日界・月境界から十分離れた安全な時刻)に固定して、テストを実行時刻から独立させる。
const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

interface InviteMemberResponse {
  member: { id: string; name: string; email: string; hireDate: string | null; department: unknown };
  invitation: { id: string; token: string; expiresAt: number };
}

async function inviteMember(
  app: ReturnType<typeof createApp>,
  cookie: string,
  body: { email: string; name: string; departmentId?: string; hireDate?: string; presetIds?: string[] },
): Promise<{ status: number; json: InviteMemberResponse }> {
  const res = await app.request("/members", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("invitation acceptance (public routes)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /invitations/:token returns display info for a valid token", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    expect(invited.status).toBe(201);
    const token = invited.json.invitation.token;

    const res = await app.request(`/invitations/${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantName: "Test Tenant", userName: "New Member", email: "new@example.com" });
  });

  it("GET /invitations/:token for a nonexistent token returns 404", async () => {
    const { db } = await setupTestDb();
    const app = createApp({ db });

    const res = await app.request("/invitations/nonexistent-token");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("GET /invitations/:token for an expired token returns 410", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const token = invited.json.invitation.token;

    // 招待の有効期限は7日。8日進めて期限切れにする。
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 8 * DAY_MS));

    const res = await app.request(`/invitations/${token}`);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expired" });
  });

  it("POST /invitations/:token/accept sets auth_credentials, logs the user in via cookie, and GET /members shows active", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const token = invited.json.invitation.token;
    const newUserId = invited.json.member.id;

    // 受諾前はログイン不可(credential が無い)。
    const loginBefore = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "correct horse battery staple 2" }),
    });
    expect(loginBefore.status).toBe(401);

    const acceptRes = await app.request(`/invitations/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple 2" }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptedBody = (await acceptRes.json()) as { user: { id: string; email: string; displayName: string } };
    expect(acceptedBody.user).toEqual({ id: newUserId, email: "new@example.com", displayName: "New Member" });

    // 受諾レスポンスがそのままログイン状態(セッションCookie)になっている。
    const newCookie = extractCookie(acceptRes);
    const meRes = await app.request("/me", { headers: { cookie: newCookie } });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { user: { id: string } };
    expect(meBody.user.id).toBe(newUserId);

    // 受諾後は設定したパスワードで通常ログインもできる。
    const loginAfter = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "correct horse battery staple 2" }),
    });
    expect(loginAfter.status).toBe(200);

    // メンバー一覧では active(受諾済み)になる。
    const membersRes = await app.request("/members", { headers: { cookie } });
    const membersBody = (await membersRes.json()) as { members: { id: string; inviteStatus: string }[] };
    expect(membersBody.members.find((m) => m.id === newUserId)?.inviteStatus).toBe("active");
  });

  it("POST /invitations/:token/accept rejects a password shorter than 12 characters with 400", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const token = invited.json.invitation.token;

    const res = await app.request(`/invitations/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "short" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_password", minLength: 12 });
  });

  it("POST /invitations/:token/accept for an expired token returns 410", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const token = invited.json.invitation.token;

    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 8 * DAY_MS));

    const res = await app.request(`/invitations/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple 2" }),
    });
    expect(res.status).toBe(410);
  });

  it("POST /invitations/:token/accept twice: the second attempt returns 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const token = invited.json.invitation.token;

    const acceptBody = JSON.stringify({ password: "correct horse battery staple 2" });
    const first = await app.request(`/invitations/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: acceptBody,
    });
    expect(first.status).toBe(200);

    const second = await app.request(`/invitations/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: acceptBody,
    });
    expect(second.status).toBe(404);
  });

  it("a revoked invitation cannot be accepted (404)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const token = invited.json.invitation.token;
    const newUserId = invited.json.member.id;

    const revokeRes = await app.request(`/members/${newUserId}/invitations`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(revokeRes.status).toBe(200);

    const res = await app.request(`/invitations/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple 2" }),
    });
    expect(res.status).toBe(404);
  });

  it("reissuing an invitation invalidates the previous token", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const invited = await inviteMember(app, cookie, { email: "new@example.com", name: "New Member" });
    const oldToken = invited.json.invitation.token;
    const newUserId = invited.json.member.id;

    const reissueRes = await app.request(`/members/${newUserId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
    });
    expect(reissueRes.status).toBe(201);
    const reissueBody = (await reissueRes.json()) as { invitation: { token: string } };
    const newToken = reissueBody.invitation.token;
    expect(newToken).not.toBe(oldToken);

    // 旧トークンは無効(404)。
    const oldRes = await app.request(`/invitations/${oldToken}`);
    expect(oldRes.status).toBe(404);

    // 新トークンは有効。
    const newRes = await app.request(`/invitations/${newToken}`);
    expect(newRes.status).toBe(200);
  });
});
