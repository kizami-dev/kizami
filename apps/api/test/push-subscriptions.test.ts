/**
 * ブラウザプッシュ通知(Web Push)の購読 API と、個人チャネルへのファンアウト。
 * 対象: apps/api/src/routes/push.ts, apps/api/src/lib/notification-channels.ts,
 *       apps/api/src/lib/web-push.ts(設計は docs/design/web-push.md)。
 *
 * 実送信は一切行わない(fetch を偽実装に差し替える)。確認するのは:
 * - 購読の CRUD(upsert・一覧・削除)と**他人の購読を操作できないこと**(テナント/ユーザー分離)
 * - VAPID 鍵が未設定なら購読 API が 404、GET /settings/notifications/me が pushAvailable: false、
 *   さらに個人設定で push=true でも送信チャネルが1つも組み立てられないこと
 * - push=true のとき購読している**全ブラウザ**へファンアウトすること
 * - プッシュサービスの 410 で failed_at が立ち、以後そのブラウザへは送らないこと
 * - スキャン経路(打刻忘れリマインド)からもプッシュが届くこと
 */

import { describe, expect, it } from "vitest";
import {
  insertPunchEvent,
  listActivePushSubscriptions,
  upsertPushSubscription,
  upsertUserNotificationSettings,
  type Database,
} from "@kizami/db";
import { dispatch, type VapidKeys } from "@kizami/notify";
import { createApp } from "../src/app.js";
import { buildPersonalChannels } from "../src/lib/notification-channels.js";
import { buildVapidFromEnv } from "../src/lib/web-push.js";
import { runReminderScan } from "../src/reminders.js";
import { jstMinutes, loginAndGetCookie, setupExtraUser, setupSecondUser, setupTestDb } from "./support/setup.js";

/**
 * テスト用の VAPID 鍵(固定値ではなく都度生成する)。scripts/generate-vapid.mjs と同じ手順。
 * 送信先の fetch は必ず差し替えるため、この鍵で外部へ何かが飛ぶことはない。
 */
async function generateVapid(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  const publicKey = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: jwk.d as string, subject: "mailto:ops@example.com" };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * ブラウザの PushSubscription.toJSON() 相当。p256dh は**本物の P-256 公開鍵**でなければ
 * 送信時の ECDH インポートに失敗するため、実際に鍵を生成して使う(長さだけ合わせた
 * ダミーだと「保存はできるが送れない」テストになってしまい、意味が無い)。
 * 全購読で同じ鍵を使い回して構わない(このテストが見るのは宛先の振り分けであり、
 * 暗号化そのものの正しさは packages/notify/test/web-push.test.ts が検証する)。
 */
let sharedBrowserKeys: { p256dh: string; auth: string } | null = null;
async function browserKeys(): Promise<{ p256dh: string; auth: string }> {
  if (sharedBrowserKeys) return sharedBrowserKeys;
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  sharedBrowserKeys = {
    p256dh: base64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    auth: base64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  return sharedBrowserKeys;
}

async function browserSubscription(endpoint: string) {
  return { endpoint, keys: await browserKeys() };
}

/** push_subscriptions へ直接1行入れる(API を経由せずに購読済みの状態を作る)。 */
async function seedSubscription(db: Database, params: { tenantId: string; userId: string; endpoint: string }): Promise<void> {
  const keys = await browserKeys();
  await upsertPushSubscription(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    endpoint: params.endpoint,
    keysP256dh: keys.p256dh,
    keysAuth: keys.auth,
    userAgent: null,
    createdAt: 0,
  });
}

/** そのカテゴリだけ push を ON にした個人設定を1行入れる(upsert は部分更新ではない)。 */
async function setPushPrefs(db: Database, params: { tenantId: string; userId: string; push: boolean }): Promise<void> {
  await upsertUserNotificationSettings(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    missingClockOutEmail: false,
    missingClockOutWebhook: false,
    missingClockOutPush: params.push,
    overtimeAlertEmail: false,
    overtimeAlertWebhook: false,
    overtimeAlertPush: false,
    leaveAlertEmail: false,
    leaveAlertWebhook: false,
    leaveAlertPush: false,
    correctionAlertEmail: false,
    correctionAlertWebhook: false,
    correctionAlertPush: false,
    approvalRequestEmail: false,
    approvalRequestWebhook: false,
    approvalRequestPush: false,
    shiftVarianceEmail: false,
    shiftVarianceWebhook: false,
    shiftVariancePush: false,
    emailAddress: null,
    webhookUrl: null,
    updatedAt: 0,
  });
}

/** エンドポイントごとに応答ステータスを決められる fetch。呼ばれた URL を記録する。 */
function pushServiceFetch(hits: string[], statusByEndpoint: Record<string, number> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    hits.push(url);
    return new Response(null, { status: statusByEndpoint[url] ?? 201 });
  }) as typeof fetch;
}

const ENDPOINT_A = "https://push.example.com/send/browser-a";
const ENDPOINT_B = "https://push.example.com/send/browser-b";

describe("buildVapidFromEnv", () => {
  it("3つとも未設定なら null(プッシュ通知を使わない配備の既定)", () => {
    expect(buildVapidFromEnv({})).toBeNull();
  });

  it("1つでも欠けていたら null(中途半端な設定で起動しない)", async () => {
    const vapid = await generateVapid();
    expect(buildVapidFromEnv({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey })).toBeNull();
  });

  it("subject が mailto:/https: でなければ null", async () => {
    const vapid = await generateVapid();
    expect(
      buildVapidFromEnv({
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: "ops@example.com",
      }),
    ).toBeNull();
  });

  it("鍵の長さが不正なら null(起動は止めない)", async () => {
    const vapid = await generateVapid();
    expect(
      buildVapidFromEnv({
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: "c2hvcnQ",
        VAPID_SUBJECT: "mailto:ops@example.com",
      }),
    ).toBeNull();
  });

  it("3つ揃っていて形式も正しければそのまま返す", async () => {
    const vapid = await generateVapid();
    expect(
      buildVapidFromEnv({
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: "mailto:ops@example.com",
      }),
    ).toEqual(vapid);
  });
});

describe("/push/* — 購読の CRUD", () => {
  it("GET /push/vapid-public-key は公開鍵を返す(秘密鍵は返さない)", async () => {
    const { db, email, password } = await setupTestDb();
    const vapid = await generateVapid();
    const app = createApp({ db, vapid });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/push/vapid-public-key", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ publicKey: vapid.publicKey });
  });

  it("POST /push/subscriptions は同じ endpoint を何度送っても1行のまま(upsert)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db, vapid: await generateVapid() });
    const cookie = await loginAndGetCookie(app, email, password);

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ subscription: await browserSubscription(ENDPOINT_A) }),
      });
      expect(res.status).toBe(200);
    }

    const rows = await listActivePushSubscriptions(db, { tenantId, userId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(ENDPOINT_A);
  });

  it("壊れた購読(鍵の長さが違う・endpoint が URL でない)は 400 で弾く", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db, vapid: await generateVapid() });
    const cookie = await loginAndGetCookie(app, email, password);

    const badKeys = await app.request("/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ subscription: { endpoint: ENDPOINT_A, keys: { p256dh: "AAAA", auth: "BBBB" } } }),
    });
    expect(badKeys.status).toBe(400);

    const badEndpoint = await app.request("/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ subscription: { ...(await browserSubscription(ENDPOINT_A)), endpoint: "not-a-url" } }),
    });
    expect(badEndpoint.status).toBe(400);
  });

  it("GET /push/subscriptions は自分の購読だけを返し、鍵は返さない", async () => {
    const { db, tenantId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId);
    const app = createApp({ db, vapid: await generateVapid() });

    const cookieA = await loginAndGetCookie(app, email, password);
    await app.request("/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ subscription: await browserSubscription(ENDPOINT_A) }),
    });

    const cookieB = await loginAndGetCookie(app, second.email, second.password);
    const res = await app.request("/push/subscriptions", { headers: { cookie: cookieB } });
    const body = (await res.json()) as { subscriptions: Record<string, unknown>[] };
    expect(body.subscriptions).toEqual([]);

    const resA = await app.request("/push/subscriptions", { headers: { cookie: cookieA } });
    const bodyA = (await resA.json()) as { subscriptions: Record<string, unknown>[] };
    expect(bodyA.subscriptions).toHaveLength(1);
    expect(bodyA.subscriptions[0]).toMatchObject({ endpoint: ENDPOINT_A, lastUsedAt: null });
    // 鍵は返さない(UI は endpoint の一致判定しか必要としない)。
    expect(bodyA.subscriptions[0]).not.toHaveProperty("keysP256dh");
    expect(bodyA.subscriptions[0]).not.toHaveProperty("keys");
  });

  it("DELETE は自分の購読だけを消せる — 同じテナントの別ユーザーからは 404", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const second = await setupSecondUser(db, tenantId);
    const app = createApp({ db, vapid: await generateVapid() });

    const cookieA = await loginAndGetCookie(app, email, password);
    await app.request("/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ subscription: await browserSubscription(ENDPOINT_A) }),
    });

    // B が A の endpoint を知っていても消せない(tenant_id + user_id で必ず絞るため)。
    const cookieB = await loginAndGetCookie(app, second.email, second.password);
    const denied = await app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: cookieB },
      body: JSON.stringify({ endpoint: ENDPOINT_A }),
    });
    expect(denied.status).toBe(404);
    expect(await listActivePushSubscriptions(db, { tenantId, userId })).toHaveLength(1);

    const own = await app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ endpoint: ENDPOINT_A }),
    });
    expect(own.status).toBe(200);
    expect(await listActivePushSubscriptions(db, { tenantId, userId })).toHaveLength(0);
  });

  it("別テナントのユーザーは他テナントの購読を消せない(テナント分離)", async () => {
    const { db, tenantId, userId, email, password } = await setupTestDb();
    const app = createApp({ db, vapid: await generateVapid() });

    // 2社目を作る前に A のセッションを取る(setupTestDb は同じメールアドレスで
    // ユーザーを作るため、後からだと POST /auth/login が 409 multiple_tenants になる)。
    const cookieA = await loginAndGetCookie(app, email, password);
    await app.request("/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ subscription: await browserSubscription(ENDPOINT_A) }),
    });

    // 同じ DB に2社目を作り、そのテナントのユーザーでログインする。
    const otherTenant = await setupTestDb(db);
    const outsider = await setupExtraUser(db, {
      tenantId: otherTenant.tenantId,
      email: "outsider@other.example.com",
      name: "Outsider",
    });

    const cookieOutsider = await loginAndGetCookie(app, outsider.email, outsider.password);
    const denied = await app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: cookieOutsider },
      body: JSON.stringify({ endpoint: ENDPOINT_A }),
    });
    expect(denied.status).toBe(404);
    expect(await listActivePushSubscriptions(db, { tenantId, userId })).toHaveLength(1);
  });
});

describe("VAPID 鍵が未設定の配備", () => {
  it("GET /settings/notifications/me は pushAvailable: false を返す(UI からプッシュが消える)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", { headers: { cookie } });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pushAvailable).toBe(false);
  });

  it("鍵があれば pushAvailable: true", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db, vapid: await generateVapid() });
    const cookie = await loginAndGetCookie(app, email, password);

    const res = await app.request("/settings/notifications/me", { headers: { cookie } });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pushAvailable).toBe(true);
  });

  it("/push/* は 404 push_unavailable(購読を貯めても送れないため受け付けない)", async () => {
    const { db, email, password } = await setupTestDb();
    const app = createApp({ db });
    const cookie = await loginAndGetCookie(app, email, password);

    const keyRes = await app.request("/push/vapid-public-key", { headers: { cookie } });
    expect(keyRes.status).toBe(404);
    expect(await keyRes.json()).toEqual({ error: "push_unavailable" });

    const postRes = await app.request("/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ subscription: await browserSubscription(ENDPOINT_A) }),
    });
    expect(postRes.status).toBe(404);
  });

  it("push=true・購読ありでも、鍵が無ければチャネルは組み立てられない(静かに送らない)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setPushPrefs(db, { tenantId, userId, push: true });
    await seedSubscription(db, { tenantId, userId, endpoint: ENDPOINT_A });

    const hits: string[] = [];
    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { fetchImpl: pushServiceFetch(hits) },
    );
    expect(channels).toHaveLength(0);
    expect(hits).toEqual([]);
  });
});

describe("buildPersonalChannels — プッシュ通知のファンアウト", () => {
  it("push=true なら購読している全ブラウザへ1通ずつ送る", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setPushPrefs(db, { tenantId, userId, push: true });
    for (const endpoint of [ENDPOINT_A, ENDPOINT_B]) {
      await seedSubscription(db, { tenantId, userId, endpoint });
    }

    const hits: string[] = [];
    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { fetchImpl: pushServiceFetch(hits), vapid: await generateVapid(), nowMinutes: 100 },
    );
    expect(channels.map((c) => c.name)).toEqual(["web_push", "web_push"]);

    const results = await dispatch(channels, { to: {}, title: "t", body: "b", url: "/notifications" });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(hits.toSorted()).toEqual([ENDPOINT_A, ENDPOINT_B].toSorted());

    // 成功した購読には last_used_at が入る。
    const rows = await listActivePushSubscriptions(db, { tenantId, userId });
    expect(rows.every((row) => row.lastUsedAt === 100)).toBe(true);
  });

  it("push=false(既定)なら購読があってもチャネルを作らない(オプトアウトの尊重)", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setPushPrefs(db, { tenantId, userId, push: false });
    await seedSubscription(db, { tenantId, userId, endpoint: ENDPOINT_A });

    const hits: string[] = [];
    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { fetchImpl: pushServiceFetch(hits), vapid: await generateVapid() },
    );
    expect(channels).toHaveLength(0);
    expect(hits).toEqual([]);
  });

  it("個人設定の行が無い(未設定)なら push は既定 OFF", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await seedSubscription(db, { tenantId, userId, endpoint: ENDPOINT_A });

    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { vapid: await generateVapid() },
    );
    expect(channels).toHaveLength(0);
  });

  it("410 を返した購読は failed_at が立ち、以後の組み立て対象から外れる", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setPushPrefs(db, { tenantId, userId, push: true });
    for (const endpoint of [ENDPOINT_A, ENDPOINT_B]) {
      await seedSubscription(db, { tenantId, userId, endpoint });
    }

    const hits: string[] = [];
    const vapid = await generateVapid();
    const channels = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { fetchImpl: pushServiceFetch(hits, { [ENDPOINT_A]: 410 }), vapid, nowMinutes: 500 },
    );

    // 1台が失効しても、もう1台への送信は成功する(dispatch は allSettled)。
    const results = await dispatch(channels, { to: {}, title: "t", body: "b" });
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const remaining = await listActivePushSubscriptions(db, { tenantId, userId });
    expect(remaining.map((row) => row.endpoint)).toEqual([ENDPOINT_B]);

    // 次回はもう失効した購読へは送らない。
    const hits2: string[] = [];
    const channels2 = await buildPersonalChannels(
      db,
      { tenantId, userId, notificationType: "missing_clock_out" },
      { fetchImpl: pushServiceFetch(hits2), vapid },
    );
    await dispatch(channels2, { to: {}, title: "t", body: "b" });
    expect(hits2).toEqual([ENDPOINT_B]);
  });
});

describe("スキャン経路(打刻忘れリマインド)からのプッシュ配信", () => {
  it("runReminderScan が本人の購読ブラウザへプッシュを送る", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    await setPushPrefs(db, { tenantId, userId, push: true });
    await seedSubscription(db, { tenantId, userId, endpoint: ENDPOINT_A });

    // 出勤だけして退勤していない日を作る(reminders.test.ts と同じ作り方)。
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_in",
      occurredAt: jstMinutes(2026, 4, 14, 9, 0),
      recordedAt: jstMinutes(2026, 4, 14, 9, 0),
      source: "web",
      actorId: userId,
    });

    const hits: string[] = [];
    const vapid = await generateVapid();
    const nowMinutes = jstMinutes(2026, 4, 15, 12, 0);
    const result = await runReminderScan(db, {
      nowMinutes,
      resolveChannels: (t, u, type) =>
        buildPersonalChannels(
          db,
          { tenantId: t, userId: u, notificationType: type },
          { fetchImpl: pushServiceFetch(hits), vapid, nowMinutes },
        ),
    });

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created[0]?.dispatchResults).toEqual([{ channel: "web_push", ok: true }]);
    expect(hits).toEqual([ENDPOINT_A]);
  });
});
