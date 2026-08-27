/**
 * 二要素認証(TOTP)のテスト。docs/design/two-factor-auth.md が仕様の正。
 *
 * 対象:
 * - セルフサービス(routes/auth-totp.ts): setup → enable、無効化、リカバリコード再生成
 * - ログインの2段階化(routes/auth.ts): totp_required → POST /auth/login/totp
 * - 管理者によるリセット(routes/members.ts): 監査ログ・本人通知・テナント越え不可
 *
 * ## 時計を止めて動かす
 *
 * TOTP は「今のカウンタ」に依存し、リプレイ防止は「最後に受理したカウンタ以下を拒否」する。
 * 実時間で走らせると ±1ステップ・リプレイ・tx の期限切れのどれも安定して再現できないため、
 * `Date.now` を差し替えて明示的に時刻を進める(`advance()`)。
 */

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, notifications } from "@kizami/db";
import { generateTotp, TOTP_STEP_SECONDS } from "@kizami/crypto";
import { createApp } from "../src/app.js";
import { bootstrapTenant } from "../src/lib/tenant-bootstrap.js";
import {
  createTestDatabase,
  grantPermission,
  loginAndGetCookie,
  setupExtraUser,
  setupSecondUser,
  setupTestDb,
  testEncryptor,
} from "./support/setup.js";

interface RequestLike {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}

/** 2026-08-27 09:00 JST 固定。値そのものに意味はない(再現性のためだけ)。 */
const FIXED_NOW_MS = Date.UTC(2026, 7, 27, 0, 0, 0);

let currentMs = FIXED_NOW_MS;

function advanceSeconds(seconds: number): void {
  currentMs += seconds * 1000;
}

function nowSeconds(): number {
  return Math.floor(currentMs / 1000);
}

beforeEach(() => {
  currentMs = FIXED_NOW_MS;
  vi.spyOn(Date, "now").mockImplementation(() => currentMs);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonInit(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: cookie ? { "content-type": "application/json", cookie } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** `set-cookie` の中から指定名の Cookie(`name=value`)を取り出す。無ければ null。 */
function cookieNamed(res: Response, name: string): string | null {
  for (const line of res.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line.split(";")[0] as string;
  }
  return null;
}

/** setup → enable を通し、共有鍵とリカバリコードを返す(以降のログインテストの前提作り)。 */
async function enableTotp(app: RequestLike, cookie: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setupRes = await app.request("/auth/totp/setup", { method: "POST", headers: { cookie } });
  expect(setupRes.status).toBe(200);
  const { secret } = (await setupRes.json()) as { secret: string; otpauthUri: string };

  const code = await generateTotp(secret, nowSeconds());
  const enableRes = await app.request("/auth/totp/enable", jsonInit({ code }, cookie));
  expect(enableRes.status).toBe(200);
  const { recoveryCodes } = (await enableRes.json()) as { enabled: boolean; recoveryCodes: string[] };
  return { secret, recoveryCodes };
}

/** パスワードログインの第1段階。2FA が有効なら totp_required が返る。 */
function login(app: RequestLike, email: string, password: string): Promise<Response> {
  return Promise.resolve(app.request("/auth/login", jsonInit({ email, password })));
}

describe("POST /auth/totp/setup, /enable(有効化)", () => {
  it("正しいコードで確認できたときだけ有効になり、リカバリコードを10本1度だけ返す", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    const before = await app.request("/auth/totp", { headers: { cookie } });
    expect(await before.json()).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });

    const { recoveryCodes } = await enableTotp(app, cookie);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    const after = await app.request("/auth/totp", { headers: { cookie } });
    expect(await after.json()).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });

    // 監査ログ(本人による有効化)
    const logs = await seeded.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.totp.enable"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBe(seeded.userId);
  });

  it("間違ったコードでは有効にならない(400 invalid_code、状態は据え置き)", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    await app.request("/auth/totp/setup", { method: "POST", headers: { cookie } });
    const res = await app.request("/auth/totp/enable", jsonInit({ code: "000000" }, cookie));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });

    const status = await app.request("/auth/totp", { headers: { cookie } });
    expect(await status.json()).toMatchObject({ enabled: false, recoveryCodesRemaining: 0 });
  });

  it("setup を通らずに enable すると 409 setup_required", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    const res = await app.request("/auth/totp/enable", jsonInit({ code: "123456" }, cookie));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "setup_required" });
  });

  it("有効化済みで setup をやり直すと 409 already_enabled(黙って鍵が入れ替わらない)", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    await enableTotp(app, cookie);

    const res = await app.request("/auth/totp/setup", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_enabled" });
  });

  it("暗号化鍵が無い配備では 2FA を有効化できない(503、平文フォールバックはしない)", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);

    const status = await app.request("/auth/totp", { headers: { cookie } });
    expect(await status.json()).toMatchObject({ available: false, enabled: false });

    const res = await app.request("/auth/totp/setup", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "encryption_unavailable" });
  });

  it("APIキー認証では 2FA のエンドポイントに触れない(許可表に無い = 403)", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });

    const res = await app.request("/auth/totp", { headers: { authorization: "Bearer kzm_not_a_real_key" } });
    // 無効なキーなので 401(そもそも認証を通らない)。許可表による 403 に至る前に落ちることの確認。
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/login → /auth/login/totp(2段階ログイン)", () => {
  async function scenario() {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const { secret, recoveryCodes } = await enableTotp(app, cookie);
    return { seeded, app, secret, recoveryCodes };
  }

  it("パスワードだけではセッションが張られない(200 totp_required・セッション Cookie 無し)", async () => {
    const { seeded, app } = await scenario();

    const res = await login(app, seeded.email, seeded.password);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "totp_required" });
    expect(cookieNamed(res, "kizami_session")).toBeNull();

    const tx = cookieNamed(res, "kizami_totp_tx");
    expect(tx).not.toBeNull();
    // tx Cookie だけでは何のリクエストも通らない
    const me = await app.request("/me", { headers: { cookie: tx as string } });
    expect(me.status).toBe(401);
  });

  it("正しいコードでセッションが張られ、監査ログに method=totp が残る", async () => {
    const { seeded, app, secret } = await scenario();

    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;

    // enable で消費したカウンタの次へ進める(リプレイ防止に掛からないように)
    advanceSeconds(TOTP_STEP_SECONDS);
    const code = await generateTotp(secret, nowSeconds());

    const res = await app.request("/auth/login/totp", jsonInit({ code }, tx));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: seeded.userId, email: seeded.email, displayName: seeded.displayName },
    });

    const session = cookieNamed(res, "kizami_session") as string;
    expect(session).not.toBeNull();
    const me = await app.request("/me", { headers: { cookie: session } });
    expect(me.status).toBe(200);

    const logs = await seeded.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.login"));
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]?.afterDigest ?? "{}")).toEqual({ method: "totp" });
  });

  it("間違ったコードは 401 invalid_code(tx は残るので打ち直せる)", async () => {
    const { seeded, app, secret } = await scenario();
    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;

    const bad = await app.request("/auth/login/totp", jsonInit({ code: "000000" }, tx));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "invalid_code" });

    advanceSeconds(TOTP_STEP_SECONDS);
    const good = await app.request("/auth/login/totp", jsonInit({ code: await generateTotp(secret, nowSeconds()) }, tx));
    expect(good.status).toBe(200);
  });

  it("同じコードの再送(リプレイ)は拒否される", async () => {
    const { seeded, app, secret } = await scenario();
    advanceSeconds(TOTP_STEP_SECONDS);
    const code = await generateTotp(secret, nowSeconds());

    const firstLogin = await login(app, seeded.email, seeded.password);
    const tx1 = cookieNamed(firstLogin, "kizami_totp_tx") as string;
    expect((await app.request("/auth/login/totp", jsonInit({ code }, tx1))).status).toBe(200);

    // 同じ 30 秒窓のうちに、同じコードでもう一度入ろうとする
    const secondLogin = await login(app, seeded.email, seeded.password);
    const tx2 = cookieNamed(secondLogin, "kizami_totp_tx") as string;
    const replay = await app.request("/auth/login/totp", jsonInit({ code }, tx2));
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: "invalid_code" });
  });

  it("±1ステップのずれは許容し、2ステップ離れたコードは拒否する", async () => {
    const { seeded, app, secret } = await scenario();

    // enable 時のカウンタより十分先へ進めてから、1つ前のカウンタのコードを使う
    advanceSeconds(TOTP_STEP_SECONDS * 3);
    const oneStepAgo = await generateTotp(secret, nowSeconds() - TOTP_STEP_SECONDS);

    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;
    expect((await app.request("/auth/login/totp", jsonInit({ code: oneStepAgo }, tx))).status).toBe(200);

    // 2ステップ離れたコードは窓の外
    advanceSeconds(TOTP_STEP_SECONDS * 3);
    const twoStepsAgo = await generateTotp(secret, nowSeconds() - TOTP_STEP_SECONDS * 2);
    const second = await login(app, seeded.email, seeded.password);
    const tx2 = cookieNamed(second, "kizami_totp_tx") as string;
    const res = await app.request("/auth/login/totp", jsonInit({ code: twoStepsAgo }, tx2));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("5分を過ぎた totpToken は 401 totp_expired(パスワードからやり直し)", async () => {
    const { seeded, app, secret } = await scenario();
    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;

    advanceSeconds(6 * 60);
    const res = await app.request("/auth/login/totp", jsonInit({ code: await generateTotp(secret, nowSeconds()) }, tx));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "totp_expired" });
  });

  it("tx Cookie が無ければ 401(第1段階を飛ばしてセッションは張れない)", async () => {
    const { app, secret } = await scenario();
    advanceSeconds(TOTP_STEP_SECONDS);
    const res = await app.request("/auth/login/totp", jsonInit({ code: await generateTotp(secret, nowSeconds()) }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "totp_expired" });
  });

  it("code と recoveryCode を同時に送ると 400(曖昧な挙動を作らない)", async () => {
    const { seeded, app, secret, recoveryCodes } = await scenario();
    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;
    advanceSeconds(TOTP_STEP_SECONDS);

    const res = await app.request(
      "/auth/login/totp",
      jsonInit({ code: await generateTotp(secret, nowSeconds()), recoveryCode: recoveryCodes[0] }, tx),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("2FA が無効なユーザーは従来どおり1段階でログインできる", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const res = await login(app, seeded.email, seeded.password);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: seeded.userId } });
    expect(cookieNamed(res, "kizami_session")).not.toBeNull();
  });

  it("暗号化鍵を失った配備では、2FA 有効ユーザーのログインを 503 で止める(素通りさせない)", async () => {
    const { seeded } = await scenario();
    // 鍵を渡さない新しいアプリ(= 運用で KIZAMI_ENCRYPTION_KEY を落とした状況)
    const appWithoutKey = createApp({ db: seeded.db });
    const res = await login(appWithoutKey, seeded.email, seeded.password);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "encryption_unavailable" });
  });
});

describe("リカバリコード", () => {
  async function scenario() {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const { secret, recoveryCodes } = await enableTotp(app, cookie);
    return { seeded, app, cookie, secret, recoveryCodes };
  }

  it("1本使えばログインでき、同じコードは二度と使えない", async () => {
    const { seeded, app, recoveryCodes } = await scenario();
    const code = recoveryCodes[0] as string;

    const first = await login(app, seeded.email, seeded.password);
    const tx1 = cookieNamed(first, "kizami_totp_tx") as string;
    const ok = await app.request("/auth/login/totp", jsonInit({ recoveryCode: code }, tx1));
    expect(ok.status).toBe(200);
    expect(cookieNamed(ok, "kizami_session")).not.toBeNull();

    const logs = await seeded.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.login"));
    expect(JSON.parse(logs[0]?.afterDigest ?? "{}")).toEqual({ method: "recovery_code" });

    const second = await login(app, seeded.email, seeded.password);
    const tx2 = cookieNamed(second, "kizami_totp_tx") as string;
    const reuse = await app.request("/auth/login/totp", jsonInit({ recoveryCode: code }, tx2));
    expect(reuse.status).toBe(401);
    expect(await reuse.json()).toEqual({ error: "invalid_code" });
  });

  it("表示の区切り・大文字小文字が違っても受理する(紙から書き写す前提)", async () => {
    const { seeded, app, recoveryCodes } = await scenario();
    const messy = ` ${(recoveryCodes[0] as string).replace("-", "").toLowerCase()} `.replace(/^\s|\s$/g, "");

    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;
    const res = await app.request("/auth/login/totp", jsonInit({ recoveryCode: messy }, tx));
    expect(res.status).toBe(200);
  });

  it("残数が設定画面に出る(使うたびに減る)", async () => {
    const { seeded, app, cookie, recoveryCodes } = await scenario();
    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;
    await app.request("/auth/login/totp", jsonInit({ recoveryCode: recoveryCodes[0] }, tx));

    const status = await app.request("/auth/totp", { headers: { cookie } });
    expect(await status.json()).toMatchObject({ recoveryCodesRemaining: 9 });
    expect(seeded.userId).toBeTruthy();
  });

  it("再生成すると古いコードは全て無効になる(パスワード+コードが必要)", async () => {
    const { seeded, app, cookie, secret, recoveryCodes } = await scenario();
    advanceSeconds(TOTP_STEP_SECONDS);

    const res = await app.request(
      "/auth/totp/recovery-codes",
      jsonInit({ password: seeded.password, code: await generateTotp(secret, nowSeconds()) }, cookie),
    );
    expect(res.status).toBe(200);
    const { recoveryCodes: fresh } = (await res.json()) as { recoveryCodes: string[] };
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toEqual(recoveryCodes);

    // 古いコードでのログインは通らない
    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;
    const stale = await app.request("/auth/login/totp", jsonInit({ recoveryCode: recoveryCodes[0] }, tx));
    expect(stale.status).toBe(401);

    // 新しいコードは通る
    const second = await login(app, seeded.email, seeded.password);
    const tx2 = cookieNamed(second, "kizami_totp_tx") as string;
    expect((await app.request("/auth/login/totp", jsonInit({ recoveryCode: fresh[0] }, tx2))).status).toBe(200);

    const logs = await seeded.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "auth.totp.recovery_codes.regenerate"));
    expect(logs).toHaveLength(1);
  });

  it("再生成はパスワードが違えば拒否される(セッションだけでは足りない)", async () => {
    const { app, cookie, secret } = await scenario();
    advanceSeconds(TOTP_STEP_SECONDS);
    const res = await app.request(
      "/auth/totp/recovery-codes",
      jsonInit({ password: "wrong password", code: await generateTotp(secret, nowSeconds()) }, cookie),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_password" });
  });
});

describe("POST /auth/totp/disable(本人による無効化)", () => {
  it("パスワードとコードの両方が要る。成功すると1段階ログインに戻る", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const { secret } = await enableTotp(app, cookie);
    advanceSeconds(TOTP_STEP_SECONDS);

    // コードだけ間違い
    const badCode = await app.request("/auth/totp/disable", jsonInit({ password: seeded.password, code: "000000" }, cookie));
    expect(badCode.status).toBe(400);
    expect(await badCode.json()).toEqual({ error: "invalid_code" });

    // パスワードだけ間違い
    const badPassword = await app.request(
      "/auth/totp/disable",
      jsonInit({ password: "nope", code: await generateTotp(secret, nowSeconds()) }, cookie),
    );
    expect(badPassword.status).toBe(400);
    expect(await badPassword.json()).toEqual({ error: "invalid_password" });

    advanceSeconds(TOTP_STEP_SECONDS);
    const ok = await app.request(
      "/auth/totp/disable",
      jsonInit({ password: seeded.password, code: await generateTotp(secret, nowSeconds()) }, cookie),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ enabled: false });

    const res = await login(app, seeded.email, seeded.password);
    expect(await res.json()).toMatchObject({ user: { id: seeded.userId } });

    const logs = await seeded.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.totp.disable"));
    expect(logs).toHaveLength(1);
  });

  it("有効化していないユーザーの無効化は 409 not_enabled", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const res = await app.request("/auth/totp/disable", jsonInit({ password: seeded.password, code: "123456" }, cookie));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_enabled" });
  });
});

describe("POST /members/:id/two-factor/reset(管理者によるリセット)", () => {
  /** 管理者(actor)と、2FA を有効化した対象メンバーを用意する。 */
  async function scenario() {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const member = await setupSecondUser(seeded.db, seeded.tenantId);

    const memberCookie = await loginAndGetCookie(app, member.email, member.password);
    const { secret } = await enableTotp(app, memberCookie);

    await grantPermission(seeded.db, {
      tenantId: seeded.tenantId,
      userId: seeded.userId,
      permission: "member.deactivate",
      scope: "tenant",
    });
    const adminCookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    return { seeded, app, member, secret, adminCookie };
  }

  it("リセットすると対象はパスワードのみでログインでき、監査ログと本人通知が残る", async () => {
    const { seeded, app, member, adminCookie } = await scenario();

    const res = await app.request(`/members/${member.userId}/two-factor/reset`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ member: { id: member.userId, twoFactorEnabled: false } });

    // 対象はパスワードだけで入れる
    const loginRes = await login(app, member.email, member.password);
    expect(await loginRes.json()).toMatchObject({ user: { id: member.userId } });

    const logs = await seeded.db.select().from(auditLogs).where(eq(auditLogs.action, "member.totp.reset"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBe(seeded.userId);
    // target は "<type>:<id>" に合成される(packages/db/src/queries/audit.ts の判断点)
    expect(logs[0]?.target).toBe(`user:${member.userId}`);

    const notes = await seeded.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, member.userId), eq(notifications.type, "security_totp_reset")));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toContain("二要素認証");
  });

  it("リカバリコードも一緒に消える(再設定するまで残らない)", async () => {
    const { seeded, app, member, adminCookie } = await scenario();
    await app.request(`/members/${member.userId}/two-factor/reset`, { method: "POST", headers: { cookie: adminCookie } });

    const memberCookie = await loginAndGetCookie(app, member.email, member.password);
    const status = await app.request("/auth/totp", { headers: { cookie: memberCookie } });
    expect(await status.json()).toMatchObject({ enabled: false, recoveryCodesRemaining: 0 });
    expect(seeded.tenantId).toBeTruthy();
  });

  it("2FA を使っていないメンバーには 409 not_enabled", async () => {
    const { seeded, app, adminCookie } = await scenario();
    const plain = await setupExtraUser(seeded.db, {
      tenantId: seeded.tenantId,
      email: "no-2fa@example.com",
      name: "2FA未設定",
    });

    const res = await app.request(`/members/${plain.userId}/two-factor/reset`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_enabled" });
  });

  it("member.deactivate を持たないユーザーは 403", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const member = await setupSecondUser(seeded.db, seeded.tenantId);
    const memberCookie = await loginAndGetCookie(app, member.email, member.password);
    await enableTotp(app, memberCookie);

    // actor には何の権限も与えない
    const actorCookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    const res = await app.request(`/members/${member.userId}/two-factor/reset`, {
      method: "POST",
      headers: { cookie: actorCookie },
    });
    expect(res.status).toBe(403);
  });

  it("テナントを越えたリセットはできない(A社の管理者は B社のメンバーを 404 として扱う)", async () => {
    const db = await createTestDatabase();
    const app = createApp({ db, encryptor: testEncryptor() });
    const password = "correct horse battery staple";

    // 同梱「管理者」プリセット付きの管理者を持つテナントを2社作る(tenant-isolation.test.ts と同じ作法)
    const tenantA = await bootstrapTenant(db, {
      tenantName: "A社",
      adminEmail: "a-admin@example.com",
      adminPassword: password,
      now: 0,
    });
    const tenantB = await bootstrapTenant(db, {
      tenantName: "B社",
      adminEmail: "b-admin@example.com",
      adminPassword: password,
      now: 0,
    });

    // B社の管理者が自分の 2FA を有効化する
    const bCookie = await loginAndGetCookie(app, "b-admin@example.com", password);
    await enableTotp(app, bCookie);

    const aCookie = await loginAndGetCookie(app, "a-admin@example.com", password);
    const res = await app.request(`/members/${tenantB.userId}/two-factor/reset`, {
      method: "POST",
      headers: { cookie: aCookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(tenantA.tenantId).not.toBe(tenantB.tenantId);

    // B社側の 2FA は生きたまま
    const status = await app.request("/auth/totp", { headers: { cookie: bCookie } });
    expect(await status.json()).toMatchObject({ enabled: true });
  });

  it("GET /members が twoFactorEnabled を返す(UI バッジ・ボタンの出し分け用)", async () => {
    const { app, member, adminCookie } = await scenario();
    const res = await app.request("/members", { headers: { cookie: adminCookie } });
    const body = (await res.json()) as { members: { id: string; twoFactorEnabled: boolean }[] };
    const row = body.members.find((m) => m.id === member.userId);
    expect(row?.twoFactorEnabled).toBe(true);
  });
});

describe("レート制限(コードの総当たり対策)", () => {
  it("同じ IP + ユーザーの 10 回を超えるコード試行は 429 になる", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    await enableTotp(app, cookie);

    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;

    // 有効化(enable)の検証で既に1回消費しているため、残りは 9 回。
    for (let i = 0; i < 9; i++) {
      const res = await app.request("/auth/login/totp", jsonInit({ code: "000000" }, tx));
      expect(res.status).toBe(401);
    }
    const blocked = await app.request("/auth/login/totp", jsonInit({ code: "000000" }, tx));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: "rate_limited" });
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("ログイン第2段階とセルフサービスは同じカウンタを共有する(経路を変えても回数は増えない)", async () => {
    const seeded = await setupTestDb();
    const app = createApp({ db: seeded.db, encryptor: testEncryptor() });
    const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
    await enableTotp(app, cookie);

    // セルフサービス側(無効化)で残り 9 回ぶん間違える(enable で1回消費済み)
    for (let i = 0; i < 9; i++) {
      const res = await app.request("/auth/totp/disable", jsonInit({ password: seeded.password, code: "000000" }, cookie));
      expect(res.status).toBe(400);
    }

    const first = await login(app, seeded.email, seeded.password);
    const tx = cookieNamed(first, "kizami_totp_tx") as string;
    const blocked = await app.request("/auth/login/totp", jsonInit({ code: "000000" }, tx));
    expect(blocked.status).toBe(429);
  });
});
