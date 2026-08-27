/**
 * 二要素認証(TOTP)の**セルフサービス**API:
 * GET /auth/totp, POST /auth/totp/setup, POST /auth/totp/enable,
 * POST /auth/totp/disable, POST /auth/totp/recovery-codes
 *
 * 仕様の正は docs/design/two-factor-auth.md。ログインの第2段階(POST /auth/login/totp)は
 * 未認証で叩く必要があるため routes/auth.ts にある(このファイルは**認証済み本人**の操作のみ)。
 *
 * ## 権限チェックを一切しない
 *
 * 個人の通知設定(routes/notification-preferences.ts)・APIキー(routes/api-keys.ts)と同じ扱いで、
 * 対象は常に「セッションの本人」。他人の 2FA に触れる操作はここには無い
 * (管理者によるリセットは routes/members.ts 側、`member.deactivate` 権限が要る)。
 *
 * ## 有効化は2段階(setup → enable)
 *
 * `setup` で鍵を作って QR を返し、`enable` で**認証アプリが出したコードを1つ検証できたときだけ**
 * 有効にする。1段階にすると「QR をうまく読めていなかった」「端末の時計が大きくずれていた」に
 * 気づかないまま 2FA が有効になり、次のログインで自分を締め出す。
 *
 * ## 無効化・リカバリコード再生成はパスワード + コードの両方を要求する
 *
 * どちらも「盗まれたセッションで 2FA を外す/リカバリコードを本人の知らないものへ置き換える」
 * ことを許すと 2FA の意味がなくなる操作なので、**その場でもう一度2要素を通す**ことを求める。
 * パスワードだけ・コードだけでは足りない(セッションを盗んだ攻撃者は、そのどちらか片方しか
 * 持っていないのが普通のため)。
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  authCredentials,
  countUnusedRecoveryCodes,
  enableUserTotp,
  getTenantById,
  getUserTotp,
  insertAuditLog,
  replaceRecoveryCodes,
  deleteUserTotp,
  upsertPendingUserTotp,
  type Database,
} from "@kizami/db";
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from "@kizami/crypto";
import type { AppEnv } from "../auth/middleware.js";
import { verifyPassword } from "../auth/password.js";
import { generateRecoveryCodes, normalizeTotpCode } from "../auth/totp.js";
import { getClientIp } from "../lib/client-ip.js";
import { decryptSecret, type Encryptor } from "../lib/encryption.js";
import { rateLimitedResponse, type RateLimiter } from "../lib/rate-limit.js";
import { nowMinutes } from "../lib/time.js";

export interface TotpRoutesOptions {
  /**
   * 共有鍵の暗号化・復号に使う。**無い場合 2FA は一切使えない**(503 encryption_unavailable)。
   * 共有鍵は検証に平文が要る=一方向ハッシュにできない値なので、平文で保存する妥協はしない
   * (packages/db/src/schema/totp.ts の設計コメント参照)。
   */
  encryptor?: Encryptor | null;
  /**
   * コード検証の総当たり対策(`ip|userId` ごと)。ログイン第2段階(routes/auth.ts)と
   * **同じ RateLimiter インスタンス**を共有する — 攻撃者から見れば「6桁を当てる」という
   * 同じ試行であり、経路を変えれば回数が倍になるのでは意味がないため。
   */
  rateLimit?: { perIpUser: RateLimiter; trustProxy: boolean };
}

interface CodeBody {
  code?: unknown;
  password?: unknown;
}

/** 現在時刻(UTC 秒)。TOTP はステップ 30 秒なので分解能は秒で足りる。 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createTotpRoutes(db: Database, options: TotpRoutesOptions) {
  const app = new Hono<AppEnv>();

  /** コード検証の試行を1回消費する。制限に掛かっていれば 429 レスポンスを返す。 */
  function checkRateLimit(c: Context<AppEnv>, userId: string): Response | null {
    if (!options.rateLimit) return null;
    const ip = getClientIp(c, options.rateLimit.trustProxy);
    const result = options.rateLimit.perIpUser.check(`${ip}|${userId}`);
    if (!result.allowed) return rateLimitedResponse(c, result.retryAfterSeconds);
    return null;
  }

  // ---- GET /auth/totp -------------------------------------------------------
  /** 設定画面の表示用。共有鍵は絶対に返さない(setup の直後だけ、setup のレスポンスで返す)。 */
  app.get("/", async (c) => {
    const user = c.get("user");
    const row = await getUserTotp(db, { tenantId: user.tenantId, userId: user.id });
    const enabled = row?.enabledAt != null;
    return c.json({
      /** 鍵が設定されていない配備では 2FA の UI ごと出さない(有効化しても運用できないため)。 */
      available: Boolean(options.encryptor),
      enabled,
      enabledAt: row?.enabledAt ?? null,
      recoveryCodesRemaining: enabled ? await countUnusedRecoveryCodes(db, { tenantId: user.tenantId, userId: user.id }) : 0,
    });
  });

  // ---- POST /auth/totp/setup ------------------------------------------------
  /**
   * 共有鍵を新規発行し、`otpauth://` URI と base32 表記を返す(**この応答でしか鍵を返さない**)。
   * 行は「セットアップ中」(enabled_at = null)として保存する。
   */
  app.post("/setup", async (c) => {
    const encryptor = options.encryptor;
    if (!encryptor) return c.json({ error: "encryption_unavailable" }, 503);

    const user = c.get("user");
    const existing = await getUserTotp(db, { tenantId: user.tenantId, userId: user.id });
    if (existing?.enabledAt != null) {
      // 有効化済みのまま鍵を作り直すと、成功した瞬間ではなく setup の時点で古い鍵が死ぬ
      // (= 認証アプリを更新し損ねると締め出される)。一度無効化してからやり直させる。
      return c.json({ error: "already_enabled" }, 409);
    }

    const secret = generateTotpSecret();
    await upsertPendingUserTotp(db, {
      tenantId: user.tenantId,
      userId: user.id,
      secretEncrypted: await encryptor.encrypt(secret),
      createdAt: nowMinutes(),
    });

    const tenant = await getTenantById(db, user.tenantId);
    // 認証アプリの一覧で「どの会社の KIZAMI か」が分かるようにする(顧問社労士のように
    // 複数テナントに登録される人が居るため、製品名だけだと区別できない)。
    const issuer = tenant?.name ? `KIZAMI (${tenant.name})` : "KIZAMI";
    return c.json({ secret, otpauthUri: buildOtpauthUri({ issuer, accountName: user.email, secret }) });
  });

  // ---- POST /auth/totp/enable ----------------------------------------------
  /** セットアップ中の鍵をコードで確認して有効化し、リカバリコード 10 本を1度だけ返す。 */
  app.post("/enable", async (c) => {
    const encryptor = options.encryptor;
    if (!encryptor) return c.json({ error: "encryption_unavailable" }, 503);

    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { code } = (body ?? {}) as CodeBody;
    if (typeof code !== "string" || code === "") return c.json({ error: "invalid_body" }, 400);

    const limited = checkRateLimit(c, user.id);
    if (limited) return limited;

    const row = await getUserTotp(db, { tenantId: user.tenantId, userId: user.id });
    if (!row) return c.json({ error: "setup_required" }, 409);
    if (row.enabledAt != null) return c.json({ error: "already_enabled" }, 409);

    const secret = await decryptSecret(encryptor, row.secretEncrypted);
    if (secret === null) {
      console.error(`totp: cannot decrypt secret for user ${user.id} (encryption key missing or mismatched)`);
      return c.json({ error: "encryption_unavailable" }, 503);
    }

    const verified = await verifyTotp({ secret, code: normalizeTotpCode(code), unixSeconds: nowSeconds() });
    if (!verified) return c.json({ error: "invalid_code" }, 400);

    const now = nowMinutes();
    const recovery = await generateRecoveryCodes();
    await db.transaction(async (tx) => {
      await enableUserTotp(tx, {
        tenantId: user.tenantId,
        userId: user.id,
        enabledAt: now,
        // 確認に使ったコードはこの時点で「使用済み」にする(同じコードでログインの
        // 第2段階を通せてしまうと、有効化直後だけリプレイ防止に穴が空く)。
        lastUsedCounter: verified.counter,
      });
      await replaceRecoveryCodes(tx, {
        tenantId: user.tenantId,
        userId: user.id,
        codeHashes: recovery.hashes,
        createdAt: now,
      });
      await insertAuditLog(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.totp.enable",
        targetType: "users",
        targetId: user.id,
        detail: JSON.stringify({}),
        occurredAt: now,
      });
    });

    return c.json({ enabled: true, recoveryCodes: recovery.codes });
  });

  // ---- POST /auth/totp/disable ---------------------------------------------
  /** 本人による無効化。現在のパスワードと有効なコードの両方を要求する。 */
  app.post("/disable", async (c) => {
    const encryptor = options.encryptor;
    if (!encryptor) return c.json({ error: "encryption_unavailable" }, 503);

    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { code, password } = (body ?? {}) as CodeBody;
    if (typeof code !== "string" || code === "" || typeof password !== "string" || password === "") {
      return c.json({ error: "invalid_body" }, 400);
    }

    const limited = checkRateLimit(c, user.id);
    if (limited) return limited;

    const row = await getUserTotp(db, { tenantId: user.tenantId, userId: user.id });
    if (!row || row.enabledAt == null) return c.json({ error: "not_enabled" }, 409);

    if (!(await verifyCurrentPassword(db, { tenantId: user.tenantId, userId: user.id }, password))) {
      return c.json({ error: "invalid_password" }, 400);
    }

    const secret = await decryptSecret(encryptor, row.secretEncrypted);
    if (secret === null) {
      console.error(`totp: cannot decrypt secret for user ${user.id} (encryption key missing or mismatched)`);
      return c.json({ error: "encryption_unavailable" }, 503);
    }
    const verified = await verifyTotp({
      secret,
      code: normalizeTotpCode(code),
      unixSeconds: nowSeconds(),
      minCounterExclusive: row.lastUsedCounter,
    });
    if (!verified) return c.json({ error: "invalid_code" }, 400);

    const now = nowMinutes();
    await db.transaction(async (tx) => {
      await deleteUserTotp(tx, { tenantId: user.tenantId, userId: user.id });
      await insertAuditLog(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.totp.disable",
        targetType: "users",
        targetId: user.id,
        detail: JSON.stringify({}),
        occurredAt: now,
      });
    });

    return c.json({ enabled: false });
  });

  // ---- POST /auth/totp/recovery-codes --------------------------------------
  /**
   * リカバリコードの再生成。**古いコードは全て無効になる**(replaceRecoveryCodes が全削除する)。
   * 無効化と同じく、その場でパスワードとコードの両方を要求する。
   */
  app.post("/recovery-codes", async (c) => {
    const encryptor = options.encryptor;
    if (!encryptor) return c.json({ error: "encryption_unavailable" }, 503);

    const user = c.get("user");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { code, password } = (body ?? {}) as CodeBody;
    if (typeof code !== "string" || code === "" || typeof password !== "string" || password === "") {
      return c.json({ error: "invalid_body" }, 400);
    }

    const limited = checkRateLimit(c, user.id);
    if (limited) return limited;

    const row = await getUserTotp(db, { tenantId: user.tenantId, userId: user.id });
    if (!row || row.enabledAt == null) return c.json({ error: "not_enabled" }, 409);

    if (!(await verifyCurrentPassword(db, { tenantId: user.tenantId, userId: user.id }, password))) {
      return c.json({ error: "invalid_password" }, 400);
    }

    const secret = await decryptSecret(encryptor, row.secretEncrypted);
    if (secret === null) {
      console.error(`totp: cannot decrypt secret for user ${user.id} (encryption key missing or mismatched)`);
      return c.json({ error: "encryption_unavailable" }, 503);
    }
    const verified = await verifyTotp({
      secret,
      code: normalizeTotpCode(code),
      unixSeconds: nowSeconds(),
      minCounterExclusive: row.lastUsedCounter,
    });
    if (!verified) return c.json({ error: "invalid_code" }, 400);

    const now = nowMinutes();
    const recovery = await generateRecoveryCodes();
    await db.transaction(async (tx) => {
      await replaceRecoveryCodes(tx, {
        tenantId: user.tenantId,
        userId: user.id,
        codeHashes: recovery.hashes,
        createdAt: now,
      });
      await insertAuditLog(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.totp.recovery_codes.regenerate",
        targetType: "users",
        targetId: user.id,
        detail: JSON.stringify({}),
        occurredAt: now,
      });
    });

    return c.json({ recoveryCodes: recovery.codes });
  });

  return app;
}

/** 現在のパスワードを照合する(auth_credentials は1ユーザー1行)。 */
async function verifyCurrentPassword(
  db: Database,
  params: { tenantId: string; userId: string },
  password: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(authCredentials)
    .where(and(eq(authCredentials.tenantId, params.tenantId), eq(authCredentials.userId, params.userId)))
    .limit(1);
  const cred = rows[0];
  if (!cred) return false;
  return verifyPassword(password, cred.passwordHash);
}
