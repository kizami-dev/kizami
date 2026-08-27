/**
 * 退職者の個人データ消去(POST /members/:id/erase、2026-08-27)。
 * 設計と法的整理は docs/design/data-retention.md。
 *
 * このテストが守っているのは大きく4つ:
 *
 * 1. **匿名化の網羅** — erase 後、GET 系のどこからも氏名・メールが出てこない
 * 2. **保存義務の側が壊れない** — 勤怠集計・締めスナップショット・監査ログは1ビットも動かない
 * 3. **保持期間のガード** — 期間未経過は 409 retention_period_active(残り日数つき)
 * 4. **終端状態であること** — tombstone でログインできず、再有効化もできない
 */

import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  closingSnapshots,
  insertPunchEvent,
  punchEvents,
  pushSubscriptions,
  userNotificationSettings,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupTestDb } from "./support/setup.js";

const MEMBER_EMAIL = "retiree@example.com";
const MEMBER_NAME = "退職 太郎";
const MEMBER_PASSWORD = "retiree horse battery staple";

/** 1分 = 1、1日 = 1440。テストで「N年前」を作るのに使う(暦の厳密さは data-retention.test.ts が見る)。 */
const MINUTES_PER_DAY = 1440;

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
  expect(invited.status).toBe(201);
  const invitedBody = (await invited.json()) as { member: { id: string }; invitation: { token: string } };

  const accepted = await app.request(`/invitations/${invitedBody.invitation.token}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: params.password }),
  });
  expect(accepted.status).toBe(200);
  return invitedBody.member.id;
}

/**
 * 招待で作ったメンバーには労働時間制の割当が無く、そのままでは月次集計が 500 になる。
 * setupTestDb() が作る既定の work_policy(標準フレックス)を割り当てる
 * (test/attendance-others.test.ts の assignExistingWorkPolicy と同じ)。
 */
async function assignExistingWorkPolicy(db: Database, tenantId: string, userId: string): Promise<void> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId)).limit(1);
  const workPolicyId = rows[0]?.id;
  if (!workPolicyId) throw new Error("assignExistingWorkPolicy: no work_policies row for tenant");
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId,
    userId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    createdAt: 0,
  });
}

/** 退職日を「N日前」に書き換える(保持期間の経過をテストから作るための唯一の近道)。 */
async function backdateDeactivation(db: Database, userId: string, daysAgo: number): Promise<void> {
  const at = Math.floor(Date.now() / 60_000) - daysAgo * MINUTES_PER_DAY;
  await db.update(users).set({ deactivatedAt: at }).where(eq(users.id, userId));
}

/** 管理者 + 退職済みメンバー(保持期間経過済み)を用意する。 */
async function setupErasableMember(options: { retentionYears?: number; daysAgo?: number } = {}) {
  const seeded = await setupTestDb();
  const { db, tenantId, userId, email, password } = seeded;
  await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
  await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
  await grantPermission(db, { tenantId, userId, permission: "member.erase", scope: "tenant" });
  await grantPermission(db, { tenantId, userId, permission: "member.view", scope: "tenant" });

  const app = createApp({ db });
  const adminCookie = await loginAndGetCookie(app, email, password);

  const memberId = await inviteAndAcceptMember(app, adminCookie, {
    email: MEMBER_EMAIL,
    name: MEMBER_NAME,
    password: MEMBER_PASSWORD,
  });

  return { ...seeded, app, adminCookie, memberId, options };
}

async function deactivate(app: ReturnType<typeof createApp>, cookie: string, memberId: string) {
  const res = await app.request(`/members/${memberId}/deactivate`, { method: "POST", headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as { member: { id: string; isActive: boolean; deactivatedAt: number } };
}

async function erase(app: ReturnType<typeof createApp>, cookie: string, memberId: string) {
  const res = await app.request(`/members/${memberId}/erase`, { method: "POST", headers: { cookie } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function listMembers(app: ReturnType<typeof createApp>, cookie: string) {
  const res = await app.request("/members", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    members: Array<{ id: string; name: string; email: string; isActive: boolean; erasedAt: number | null; retention: unknown }>;
  };
  return body.members;
}

describe("POST /members/:id/erase — 退職日と保持期間のガード", () => {
  it("退職処理されていない在籍者は消せない(409 not_deactivated)", async () => {
    const { app, adminCookie, memberId } = await setupErasableMember();

    const res = await erase(app, adminCookie, memberId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_deactivated");
  });

  it("退職直後は保持期間内なので 409 retention_period_active(残り日数と消去可能日つき)", async () => {
    const { app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);

    const res = await erase(app, adminCookie, memberId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("retention_period_active");

    const retention = res.body.retention as {
      erasable: boolean;
      remainingDays: number;
      erasableFrom: string;
      deactivatedDate: string;
      retentionYears: number;
    };
    expect(retention.erasable).toBe(false);
    // 既定は5年。残りはおよそ5年分の日数(閏日の有無で 1826/1827 に振れる)。
    expect(retention.retentionYears).toBe(5);
    expect(retention.remainingDays).toBeGreaterThan(1800);
    expect(retention.erasableFrom > retention.deactivatedDate).toBe(true);
  });

  it("保持期間(既定5年)が経過していれば消せる", async () => {
    const { db, app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);

    const res = await erase(app, adminCookie, memberId);
    expect(res.status).toBe(200);
    expect((res.body.member as { erasedAt: number }).erasedAt).toBeGreaterThan(0);
  });

  it("保持年数を3年へ下げると、5年では足りなかった退職者が消せるようになる", async () => {
    const { db, tenantId, userId, app, adminCookie, memberId } = await setupErasableMember();
    // 保持年数の変更は個人情報まわりの設定権限(notification.settings.manage の転用)。
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });
    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 4 * 366);

    // 5年設定のままでは未経過。
    expect((await erase(app, adminCookie, memberId)).status).toBe(409);

    const put = await app.request("/settings/data-retention", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ personalDataRetentionYears: 3 }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).personalDataRetentionYears).toBe(3);

    expect((await erase(app, adminCookie, memberId)).status).toBe(200);
  });

  it("保持年数は 3 / 5 以外を受け付けない(1年で消せる設定を作らせない)", async () => {
    const { db, tenantId, userId, app, adminCookie } = await setupErasableMember();
    await grantPermission(db, { tenantId, userId, permission: "notification.settings.manage", scope: "tenant" });

    for (const years of [1, 0, 10, -5, "5"]) {
      const res = await app.request("/settings/data-retention", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ personalDataRetentionYears: years }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_retention_years");
    }
  });

  it("退職日が記録されていない古い行は消せない(409 deactivated_at_unknown)", async () => {
    const { db, app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);
    // この機能より前に無効化された行を再現する。
    await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, memberId));

    const res = await erase(app, adminCookie, memberId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("deactivated_at_unknown");
  });

  it("二重実行は 409 already_erased(冪等に 200 を返さない)", async () => {
    const { db, app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);

    expect((await erase(app, adminCookie, memberId)).status).toBe(200);
    const second = await erase(app, adminCookie, memberId);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_erased");
  });

  it("自分自身は消せない(409 cannot_erase_self)", async () => {
    const { userId, app, adminCookie } = await setupErasableMember();
    const res = await erase(app, adminCookie, userId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_erase_self");
  });
});

describe("POST /members/:id/erase — 権限", () => {
  it("member.deactivate だけでは 403(消去は退職処理と同格ではない)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    await grantPermission(db, { tenantId, userId, permission: "member.invite", scope: "tenant" });
    await grantPermission(db, { tenantId, userId, permission: "member.deactivate", scope: "tenant" });
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const memberId = await inviteAndAcceptMember(app, cookie, {
      email: MEMBER_EMAIL,
      name: MEMBER_NAME,
      password: MEMBER_PASSWORD,
    });
    await deactivate(app, cookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);

    const res = await erase(app, cookie, memberId);
    expect(res.status).toBe(403);
  });

  it("他テナントのユーザーは 404(存在も漏らさない)", async () => {
    const a = await setupErasableMember();
    const b = await setupTestDb();

    const res = await erase(a.app, a.adminCookie, b.userId);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");

    // 相手テナントの行は一切変わっていない。
    const [untouched] = await b.db.select().from(users).where(eq(users.id, b.userId));
    expect(untouched?.erasedAt).toBeNull();
    expect(untouched?.name).not.toBe("削除済みユーザー");
  });
});

describe("POST /members/:id/erase — 匿名化の網羅", () => {
  it("GET /members から氏名・メールが消え、tombstone に置き換わる", async () => {
    const { db, app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);

    const before = (await listMembers(app, adminCookie)).find((m) => m.id === memberId);
    expect(before?.name).toBe(MEMBER_NAME);
    expect(before?.email).toBe(MEMBER_EMAIL);

    expect((await erase(app, adminCookie, memberId)).status).toBe(200);

    const after = (await listMembers(app, adminCookie)).find((m) => m.id === memberId);
    expect(after?.name).toBe("削除済みユーザー");
    expect(after?.email).toBe(`user_deleted_${memberId}@invalid`);
    expect(after?.erasedAt).not.toBeNull();

    // 一覧の JSON 全体を見ても、元の氏名・メールはどこにも残っていない。
    const raw = JSON.stringify(await listMembers(app, adminCookie));
    expect(raw).not.toContain(MEMBER_NAME);
    expect(raw).not.toContain(MEMBER_EMAIL);
  });

  it("認証・端末・連絡先に紐づく行は物理削除される(パスワード・購読・個人通知設定)", async () => {
    const { db, tenantId, app, adminCookie, memberId } = await setupErasableMember();

    // プッシュ購読と個人通知設定を「本人が設定した」状態にする。
    await db.insert(pushSubscriptions).values({
      id: uuidv7(),
      tenantId,
      userId: memberId,
      endpoint: "https://push.example.com/endpoint/abc",
      keysP256dh: "p256dh",
      keysAuth: "auth",
      userAgent: "Mozilla/5.0 (test)",
      createdAt: 0,
    });
    await db.insert(userNotificationSettings).values({
      tenantId,
      userId: memberId,
      emailAddress: "private@example.com",
      updatedAt: 0,
    });

    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    const res = await erase(app, adminCookie, memberId);
    expect(res.status).toBe(200);

    const removed = res.body.removed as Record<string, number>;
    expect(removed.authCredentials).toBe(1);
    expect(removed.pushSubscriptions).toBe(1);
    expect(removed.userNotificationSettings).toBe(1);

    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, memberId))).toHaveLength(0);
    expect(await db.select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, memberId))).toHaveLength(0);
  });

  it("punch_events の行は残り、IP・UA・GPS 列だけが null になる", async () => {
    const { db, tenantId, app, adminCookie, memberId } = await setupErasableMember();

    const at = jstMinutes(2020, 4, 1, 9, 0);
    await insertPunchEvent(db, {
      tenantId,
      userId: memberId,
      kind: "clock_in",
      occurredAt: at,
      recordedAt: at,
      source: "web",
      actorId: memberId,
      metaIp: "203.0.113.9",
      metaUa: "Mozilla/5.0 (test)",
      metaGpsLat: 35.6812,
      metaGpsLng: 139.7671,
    });

    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    expect((await erase(app, adminCookie, memberId)).status).toBe(200);

    const rows = await db.select().from(punchEvents).where(eq(punchEvents.userId, memberId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurredAt).toBe(at);
    expect(rows[0]?.metaIp).toBeNull();
    expect(rows[0]?.metaUa).toBeNull();
    expect(rows[0]?.metaGpsLat).toBeNull();
    expect(rows[0]?.metaGpsLng).toBeNull();
  });
});

describe("POST /members/:id/erase — 保存義務の側が壊れないこと", () => {
  it("勤怠の月次集計は erase の前後で1ビットも変わらない", async () => {
    const { db, tenantId, userId, app, adminCookie, memberId } = await setupErasableMember();
    await grantPermission(db, { tenantId, userId, permission: "attendance.record.view", scope: "tenant" });
    await assignExistingWorkPolicy(db, tenantId, memberId);

    for (const day of [1, 2, 3]) {
      const inAt = jstMinutes(2020, 4, day, 9, 0);
      const outAt = jstMinutes(2020, 4, day, 18, 0);
      await insertPunchEvent(db, { tenantId, userId: memberId, kind: "clock_in", occurredAt: inAt, recordedAt: inAt, source: "web", actorId: memberId });
      await insertPunchEvent(db, { tenantId, userId: memberId, kind: "clock_out", occurredAt: outAt, recordedAt: outAt, source: "web", actorId: memberId });
    }

    const monthlyOf = async () => {
      const res = await app.request(`/attendance/monthly?month=2020-04&userId=${memberId}`, { headers: { cookie: adminCookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // 表示用の氏名は当然変わる。集計値だけを比較する。
      delete body.user;
      delete body.member;
      return body;
    };

    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    const before = await monthlyOf();

    expect((await erase(app, adminCookie, memberId)).status).toBe(200);

    expect(await monthlyOf()).toEqual(before);
  });

  it("締めスナップショットは1行も変わらない(締めた月の数字は動かない)", async () => {
    const { db, tenantId, userId, app, adminCookie, memberId } = await setupErasableMember();
    await grantPermission(db, { tenantId, userId, permission: "closing.execute", scope: "tenant" });
    await assignExistingWorkPolicy(db, tenantId, memberId);

    const inAt = jstMinutes(2020, 4, 1, 9, 0);
    const outAt = jstMinutes(2020, 4, 1, 18, 0);
    await insertPunchEvent(db, { tenantId, userId: memberId, kind: "clock_in", occurredAt: inAt, recordedAt: inAt, source: "web", actorId: memberId });
    await insertPunchEvent(db, { tenantId, userId: memberId, kind: "clock_out", occurredAt: outAt, recordedAt: outAt, source: "web", actorId: memberId });

    const closed = await app.request("/closings/2020-04/close", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({}),
    });
    expect(closed.status).toBe(200);

    const snapshotsOf = async () =>
      (await db.select().from(closingSnapshots).where(and(eq(closingSnapshots.tenantId, tenantId), eq(closingSnapshots.userId, memberId))))
        .map((r) => ({ category: r.category, minutes: r.minutes }))
        .sort((a, b) => a.category.localeCompare(b.category));

    const before = await snapshotsOf();
    expect(before.length).toBeGreaterThan(0);

    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    expect((await erase(app, adminCookie, memberId)).status).toBe(200);

    expect(await snapshotsOf()).toEqual(before);
  });

  it("監査ログは改変されない(行は残り、actor 名だけが users 経由で匿名化される)", async () => {
    const { db, tenantId, userId, app, adminCookie, memberId } = await setupErasableMember();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });

    // 対象者自身が actor になる監査ログを1件作る(打刻ではなく本人の設定操作)。
    const memberCookie = await loginAndGetCookie(app, MEMBER_EMAIL, MEMBER_PASSWORD);
    const memberSelf = await app.request("/me", { headers: { cookie: memberCookie } });
    expect(memberSelf.status).toBe(200);

    const logsOf = async () => {
      const res = await app.request("/audit-logs?limit=100", { headers: { cookie: adminCookie } });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        logs: Array<{ id: string; action: string; targetType: string; targetId: string; actorName: string; occurredAt: number }>;
      };
    };

    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    const before = await logsOf();

    expect((await erase(app, adminCookie, memberId)).status).toBe(200);
    const after = await logsOf();

    // 消去そのものの1件が増えるだけで、既存の行は id/action/target/occurredAt が完全に一致する。
    const erasedEntry = after.logs.find((l) => l.action === "member.erase");
    expect(erasedEntry).toBeDefined();
    expect(erasedEntry?.targetType).toBe("user");
    expect(erasedEntry?.targetId).toBe(memberId);

    const key = (l: { id: string; action: string; targetType: string; targetId: string; occurredAt: number }) =>
      `${l.id}|${l.action}|${l.targetType}:${l.targetId}|${l.occurredAt}`;
    const beforeKeys = before.logs.map(key).sort();
    const afterKeys = after.logs.filter((l) => l.action !== "member.erase").map(key).sort();
    expect(afterKeys).toEqual(beforeKeys);
  });

  it("監査ログの detail に消した値そのもの(氏名・メール)を書かない", async () => {
    const { db, tenantId, userId, app, adminCookie, memberId } = await setupErasableMember();
    await grantPermission(db, { tenantId, userId, permission: "audit_log.view", scope: "tenant" });

    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    expect((await erase(app, adminCookie, memberId)).status).toBe(200);

    const res = await app.request("/audit-logs?action=member.erase", { headers: { cookie: adminCookie } });
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(MEMBER_NAME);
    expect(raw).not.toContain(MEMBER_EMAIL);
    expect(raw).toContain(memberId);
  });
});

describe("POST /members/:id/erase — 終端状態", () => {
  it("tombstone メールではログインできない", async () => {
    const { db, app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    expect((await erase(app, adminCookie, memberId)).status).toBe(200);

    for (const email of [MEMBER_EMAIL, `user_deleted_${memberId}@invalid`]) {
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: MEMBER_PASSWORD }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("消去済みは再有効化できない(409 already_erased — 無効化とは別の終端状態)", async () => {
    const { db, app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);
    expect((await erase(app, adminCookie, memberId)).status).toBe(200);

    const res = await app.request(`/members/${memberId}/reactivate`, { method: "POST", headers: { cookie: adminCookie } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_erased");
  });

  it("再有効化すると退職日が消える(復職した人は「消去可能な退職者」に現れない)", async () => {
    const { db, app, adminCookie, memberId } = await setupErasableMember();
    await deactivate(app, adminCookie, memberId);
    await backdateDeactivation(db, memberId, 5 * 366);

    const reactivated = await app.request(`/members/${memberId}/reactivate`, { method: "POST", headers: { cookie: adminCookie } });
    expect(reactivated.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, memberId));
    expect(row?.deactivatedAt).toBeNull();

    const member = (await listMembers(app, adminCookie)).find((m) => m.id === memberId);
    expect((member?.retention as { erasable: boolean }).erasable).toBe(false);
  });
});
