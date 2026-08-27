import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { extractCookie, grantPermission, loginAndGetCookie, setupTestDb } from "./support/setup.js";

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

describe("member deactivation / reactivation", () => {
  it("deactivate: revokes the member's sessions immediately (login becomes 401)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);

    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });
    const memberCookie = await loginAndGetCookie(app, "member@example.com", "member horse battery staple");

    // 無効化前はセッションが有効。
    const before = await app.request("/me", { headers: { cookie: memberCookie } });
    expect(before.status).toBe(200);

    const deactivateRes = await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });
    expect(deactivateRes.status).toBe(200);
    // deactivatedAt(退職日 = 個人データ保持期間の起算日、2026-08-27)も返る。
    const deactivateBody = (await deactivateRes.json()) as { member: { id: string; isActive: boolean; deactivatedAt: number } };
    expect(deactivateBody.member.id).toBe(memberId);
    expect(deactivateBody.member.isActive).toBe(false);
    expect(deactivateBody.member.deactivatedAt).toBeGreaterThan(0);

    const after = await app.request("/me", { headers: { cookie: memberCookie } });
    expect(after.status).toBe(401);
  });

  it("deactivate: login is refused (401) for the deactivated member", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);

    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });
    await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });

    const loginRes = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.com", password: "member horse battery staple" }),
    });
    expect(loginRes.status).toBe(401);
  });

  // authMiddleware(apps/api/src/auth/middleware.ts)自体が isActive を見ていることの担保。
  // セッション revoke に漏れがあっても isActive=false 単独で 401 になることを、revoke を経由しない
  // 直接の DB 更新で確認する(依頼「revoke 漏れがあっても401」を明示的にテストする)。
  it("authMiddleware rejects an active (non-revoked) session for an isActive=false user", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    // 意図的に sessions.revoked_at には触れず、users.is_active だけを直接落とす。
    const { users } = await import("@kizami/db");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));

    const res = await app.request("/me", { headers: { cookie } });
    expect(res.status).toBe(401);
  });

  it("deactivate: revokes a pending invitation and an unused password reset token", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);

    // pending 招待(未受諾)のケース。
    const invited = await app.request("/members", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ email: "pending@example.com", name: "Pending" }),
    });
    const invitedBody = (await invited.json()) as { member: { id: string }; invitation: { token: string } };

    await app.request(`/members/${invitedBody.member.id}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });

    const invitationCheck = await app.request(`/invitations/${invitedBody.invitation.token}`);
    expect(invitationCheck.status).toBe(404);

    // 未使用リセットトークンのケース。
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member2@example.com", name: "Member2", password: "member2 horse battery staple" });
    const issued = await app.request(`/members/${memberId}/password-resets`, { method: "POST", headers: { cookie: adminCookie } });
    const issuedBody = (await issued.json()) as { passwordReset: { token: string } };

    await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });

    const resetCheck = await app.request(`/password-resets/${issuedBody.passwordReset.token}`);
    expect(resetCheck.status).toBe(404);
  });

  it("deactivate: the last holder of permission.preset.manage cannot be deactivated (409 last_admin)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "permission.preset.manage", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);

    // 別の管理者(permission.preset.manage 保持)を作って、そちらを無効化しようとする。
    const otherAdminId = await inviteAndAcceptMember(app, adminCookie, { email: "other-admin@example.com", name: "Other Admin", password: "other admin horse battery" });
    await grantPermission(db, { tenantId, userId: otherAdminId, permission: "permission.preset.manage", scope: "tenant" });
    await grantPermission(db, { tenantId, userId: otherAdminId, permission: "member.deactivate", scope: "tenant" });
    await grantPermission(db, { tenantId, userId: otherAdminId, permission: "member.invite", scope: "tenant" });
    const otherAdminCookie = await loginAndGetCookie(app, "other-admin@example.com", "other admin horse battery");

    // まず元の管理者(userId)を無効化しようとすると、otherAdmin がいるので成功するはず。
    const firstDeactivate = await app.request(`/members/${userId}/deactivate`, { method: "POST", headers: { cookie: otherAdminCookie } });
    expect(firstDeactivate.status).toBe(200);

    // 残る permission.preset.manage 保持者は otherAdmin 一人。otherAdmin 自身の無効化は
    // 「自分自身」ガードで 409 になるため、代わりに第三者(otherAdmin)から見て最後の1人になった
    // ことを、別の権限管理者を作らずに検証するのは自己無効化ガードと衝突する。
    // ここでは「最後の1人」判定そのものを、otherAdmin 以外に権限管理者がいない状態を作った上で
    // 三人目のアクターから otherAdmin を無効化しようとして確認する。
    const thirdActorId = await inviteAndAcceptMember(app, otherAdminCookie, { email: "third@example.com", name: "Third", password: "third actor horse battery" });
    await grantPermission(db, { tenantId, userId: thirdActorId, permission: "member.deactivate", scope: "tenant" });
    const thirdActorCookie = await loginAndGetCookie(app, "third@example.com", "third actor horse battery");

    const lastAdminAttempt = await app.request(`/members/${otherAdminId}/deactivate`, { method: "POST", headers: { cookie: thirdActorCookie } });
    expect(lastAdminAttempt.status).toBe(409);
    expect(await lastAdminAttempt.json()).toEqual({ error: "last_admin" });
  });

  it("deactivate: cannot deactivate oneself (409)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request(`/members/${userId}/deactivate`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_deactivate_self" });
  });

  it("deactivate: a nonexistent member returns 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/members/nonexistent-user-id/deactivate", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("deactivate: an already-inactive member returns 409 already_inactive", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });
    const second = await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "already_inactive" });
  });

  it("reactivate: the member can log in again after reactivation", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });
    const loginWhileInactive = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.com", password: "member horse battery staple" }),
    });
    expect(loginWhileInactive.status).toBe(401);

    const reactivateRes = await app.request(`/members/${memberId}/reactivate`, { method: "POST", headers: { cookie: adminCookie } });
    expect(reactivateRes.status).toBe(200);
    expect(await reactivateRes.json()).toEqual({ member: { id: memberId, isActive: true } });

    const loginAfter = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@example.com", password: "member horse battery staple" }),
    });
    expect(loginAfter.status).toBe(200);
    extractCookie(loginAfter);
  });

  it("reactivate: an already-active member returns 409 already_active", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    const res = await app.request(`/members/${memberId}/reactivate`, { method: "POST", headers: { cookie: adminCookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_active" });
  });

  it("invitation reissue / password reset issuance for a deactivated member both return 409 member_inactive", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const adminCookie = await loginAndGetCookie(app, email, password);
    const memberId = await inviteAndAcceptMember(app, adminCookie, { email: "member@example.com", name: "Member", password: "member horse battery staple" });

    await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie: adminCookie } });

    const reissue = await app.request(`/members/${memberId}/invitations`, { method: "POST", headers: { cookie: adminCookie } });
    expect(reissue.status).toBe(409);
    expect(await reissue.json()).toEqual({ error: "member_inactive" });

    const resetIssue = await app.request(`/members/${memberId}/password-resets`, { method: "POST", headers: { cookie: adminCookie } });
    expect(resetIssue.status).toBe(409);
    expect(await resetIssue.json()).toEqual({ error: "member_inactive" });
  });
});
