/**
 * OIDC(SSO)ログイン: POST /auth/oidc/start, GET /auth/oidc/callback, GET /auth/oidc/available
 *
 * 仕様の正は docs/design/sso-oidc.md。下回り(ディスカバリ・PKCE・トークン交換・ID トークン検証)は
 * apps/api/src/lib/oidc.ts にあり、このファイルは HTTP と DB 突合・セッション発行だけを担う。
 *
 * ## 最重要の設計判断: **自動プロビジョニングをしない**
 *
 * KIZAMI は招待式のみ(要件 §7)。SSO は「新しい入口」ではなく **既存ユーザーのログイン手段**
 * として実装する。コールバックでは IdP が返したメールアドレスを、設定されたテナント内の
 * `users.email` と突合し、**一致するユーザーが居なければログインを拒否する**(users 行は作らない)。
 * 理由:
 * - 誰を登録するかは会社の決定事項であり、IdP のテナントに居ることは「この会社の従業員として
 *   勤怠を打つ人」であることを意味しない(業務委託・グループ会社・退職後の残存アカウント)。
 * - 自動作成を許すと、部署も権限プリセットも所定労働時間も未設定のユーザーが増え、
 *   集計・承認経路が壊れた状態のまま打刻が始まる。
 * - 「登録は招待式のみ」という要件の唯一の抜け道を作らないため。
 *
 * ## メールアドレスの突合(大文字小文字)
 *
 * `lower(users.email) = lower(idp_email)` で突合する。パスワードログイン(routes/auth.ts)は
 * 完全一致だが、SSO では **IdP が返す表記を KIZAMI 側が選べない**(Entra ID は登録時の表記を
 * そのまま返す等)。ここだけ大文字小文字を無視するのは非対称だが、「表記が違うだけで
 * ログインできない」という運用事故の方が実害が大きいと判断した。
 * 大文字小文字だけが違う2アカウントが同一テナントに居る場合は、どちらか一方を選ばず
 * `sso_user_not_found` として拒否する(推測でログインさせない)。
 *
 * ## エラーの返し方
 *
 * コールバックはブラウザのトップレベル遷移なので JSON を返しても意味がない。
 * すべて `{appBaseUrl}/login?error=<code>` へ 302 で戻し、Web 側(LoginForm)が
 * コードを4言語の文言へ対応付ける(apps/web/src/lib/i18n/*.ts の `login.errors`)。
 */

import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { getTenantById, getTenantOidcSettings, insertAuditLog, users, type Database } from "@kizami/db";
import { createSession, setSessionCookie } from "../auth/session.js";
import { decryptSecret, type Encryptor } from "../lib/encryption.js";
import {
  buildAuthorizationUrl,
  createPkce,
  discover,
  exchangeCode,
  normalizeIssuer,
  OidcError,
  randomToken,
  timingSafeEqual,
  verifyIdToken,
  type OidcErrorCode,
  type OidcNetworkDeps,
} from "../lib/oidc.js";
import { nowMinutes } from "../lib/time.js";

/**
 * 認可リクエスト1回ぶんの状態を運ぶ Cookie。**サーバー側に状態テーブルを持たない**
 * (state/nonce/code_verifier を DB に置くと、放置された行の掃除という新しい運用が増える。
 * 暗号化 Cookie なら 10 分で自然に消え、replicas を増やしても共有ストアが要らない)。
 * 中身は Encryptor(AES-256-GCM)で暗号化するため、クライアントは読むことも改竄することもできない。
 */
const OIDC_TX_COOKIE_NAME = "kizami_oidc_tx";

/** 認可リクエストの有効期間(秒)。IdP でのログイン操作に必要な時間だけ持たせる。 */
const OIDC_TX_TTL_SECONDS = 600;

interface OidcTransaction {
  tenantId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** 発行時刻(UTC エポック分)。Cookie の Max-Age とは別に、サーバー側でも期限を確認する。 */
  issuedAt: number;
}

export interface OidcRoutesOptions {
  secureCookies: boolean;
  /**
   * client_secret の復号と、認可リクエスト状態 Cookie の暗号化に使う。
   * 無い場合、SSO は開始できない(503 encryption_unavailable)。平文フォールバックはしない。
   */
  encryptor?: Encryptor | null;
  /**
   * IdP に登録した redirect_uri。省略時はリクエスト URL から導出する
   * (`https://host/auth/oidc/callback`。リバースプロキシで /api 配下に載せている場合も
   * そのパスがそのまま使われる)。前段でホスト名を書き換えている配備では明示すること。
   */
  redirectUri?: string;
  /**
   * Web アプリのベース URL(末尾スラッシュ無し)。省略時は相対パスで戻す
   * (本番の同一オリジン配信を既定とする)。開発時は api:3001 / web:3000 と別オリジンのため
   * `http://localhost:3000` を渡す。
   */
  appBaseUrl?: string;
  /** ディスカバリ・JWKS・トークン交換の fetch 差し替え(テストの偽 IdP 用)。 */
  network?: OidcNetworkDeps;
}

function appUrl(options: OidcRoutesOptions, path: string): string {
  const base = options.appBaseUrl?.replace(/\/+$/, "") ?? "";
  return `${base}${path}`;
}

function resolveRedirectUri(c: Context, options: OidcRoutesOptions): string {
  if (options.redirectUri) return options.redirectUri;
  const url = new URL(c.req.url);
  // /auth/oidc/start でも /auth/oidc/callback でも同じ URL を導けるようにする
  // (トークン交換の redirect_uri は認可リクエスト時と完全一致している必要がある)。
  const path = url.pathname.replace(/\/(start|callback)$/, "/callback");
  return `${url.origin}${path}`;
}

/** メールアドレスの空白を落として小文字化する(突合キーの正規化)。 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createOidcRoutes(db: Database, options: OidcRoutesOptions) {
  const app = new Hono();

  function failRedirect(c: Context, code: OidcErrorCode | "encryption_unavailable"): Response {
    deleteCookie(c, OIDC_TX_COOKIE_NAME, { path: "/" });
    return c.redirect(appUrl(options, `/login?error=${encodeURIComponent(code)}`), 302);
  }

  /**
   * テナントの OIDC 設定を読み、使える状態(有効かつ issuer/clientId/clientSecret が揃っている)
   * なら復号済みの client_secret とともに返す。使えなければエラーコードを返す。
   */
  async function loadUsableConfig(
    tenantId: string,
  ): Promise<
    | { ok: true; issuer: string; clientId: string; clientSecret: string; allowUnverifiedEmail: boolean }
    | { ok: false; code: OidcErrorCode | "encryption_unavailable" }
  > {
    const settings = await getTenantOidcSettings(db, tenantId);
    if (!settings || !settings.enabled) return { ok: false, code: "sso_not_enabled" };
    if (!settings.issuer || !settings.clientId || !settings.clientSecret) {
      return { ok: false, code: "sso_config_incomplete" };
    }
    const clientSecret = await decryptSecret(options.encryptor, settings.clientSecret);
    if (clientSecret === null) {
      // 鍵未設定・鍵不一致・破損。設定は存在するが使えない状態なので、利用者には
      // 「SSO が使えない」ことだけを伝え、原因はサーバーログに残す。
      console.error(`oidc: cannot decrypt client_secret for tenant ${tenantId} (encryption key missing or mismatched)`);
      return { ok: false, code: "encryption_unavailable" };
    }
    return {
      ok: true,
      issuer: normalizeIssuer(settings.issuer),
      clientId: settings.clientId,
      clientSecret,
      allowUnverifiedEmail: settings.allowUnverifiedEmail,
    };
  }

  // ---- GET /auth/oidc/available?email= --------------------------------------
  //
  // ログイン画面が「SSO でログイン」ボタンを出すかどうかを決めるための照会。
  //
  // 情報開示の判断点(完了報告・設計文書にも記載): この経路は未認証で叩けるため、
  // 素朴に実装すると「そのメールアドレスがどの会社に存在するか」を漏らす。既存の
  // パスワードログインは、テナント名の開示をパスワード検証の通過後に限っている
  // (routes/auth.ts の multiple_tenants)。ここでは開示範囲を次の2点で絞る:
  //   1. **SSO が有効なテナントしか返さない**。SSO を使っていない会社の存在は一切漏れない
  //      (= 既存のパスワードログインの開示面を広げない)。
  //   2. 「該当なし」と「メールアドレス自体が存在しない」を区別しない(どちらも空配列・200)。
  // そのうえで IP レート制限(20回/15分、app.ts)を掛け、総当たりでの名簿作成を割に合わなくする。
  // 完全な秘匿は SSO ボタンの出し分けという要件と両立しないため、この線で妥協している。
  app.get("/available", async (c) => {
    const email = c.req.query("email");
    if (typeof email !== "string" || email.trim() === "") {
      return c.json({ error: "invalid_query" }, 400);
    }

    const rows = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`);

    const tenantIds = [...new Set(rows.filter((u) => u.isActive).map((u) => u.tenantId))];
    const result: { id: string; name: string | null; ssoEnabled: true }[] = [];
    for (const tenantId of tenantIds) {
      const config = await loadUsableConfig(tenantId);
      if (!config.ok) continue;
      const tenant = await getTenantById(db, tenantId);
      result.push({ id: tenantId, name: tenant?.name ?? null, ssoEnabled: true });
    }

    // `ssoEnabled` は常に true になる(上のとおり有効なテナントしか載せない)。
    // レスポンス形状を将来変えずに済ませるためフィールド自体は残してある。
    return c.json({ tenants: result });
  });

  // ---- POST /auth/oidc/start ------------------------------------------------
  app.post("/start", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) return c.json({ error: "invalid_body" }, 400);
    const { tenantId } = body as { tenantId?: unknown };
    if (typeof tenantId !== "string" || tenantId === "") return c.json({ error: "invalid_body" }, 400);

    const encryptor = options.encryptor;
    if (!encryptor) {
      // 状態 Cookie の暗号化にも client_secret の復号にも鍵が要る。
      return c.json({ error: "encryption_unavailable" }, 503);
    }

    const config = await loadUsableConfig(tenantId);
    if (!config.ok) {
      return c.json({ error: config.code }, config.code === "encryption_unavailable" ? 503 : 400);
    }

    let authorizationUrl: string;
    const state = randomToken();
    const nonce = randomToken();
    const pkce = await createPkce();
    try {
      const discovery = await discover(config.issuer, options.network);
      authorizationUrl = buildAuthorizationUrl({
        discovery,
        clientId: config.clientId,
        redirectUri: resolveRedirectUri(c, options),
        state,
        nonce,
        codeChallenge: pkce.challenge,
      });
    } catch (err) {
      if (err instanceof OidcError) {
        console.error(`oidc start failed for tenant ${tenantId}: ${err.message}`);
        return c.json({ error: err.code }, 502);
      }
      throw err;
    }

    const tx: OidcTransaction = { tenantId, state, nonce, codeVerifier: pkce.verifier, issuedAt: nowMinutes() };
    setCookie(c, OIDC_TX_COOKIE_NAME, await encryptor.encrypt(JSON.stringify(tx)), {
      httpOnly: true,
      // Lax: IdP からのコールバックはトップレベルの GET 遷移なので Lax で届く。
      // None にすると同 Cookie が任意のクロスサイト POST にも乗るため、必要のない緩和はしない。
      sameSite: "Lax",
      path: "/",
      secure: options.secureCookies,
      maxAge: OIDC_TX_TTL_SECONDS,
    });

    return c.json({ redirectUrl: authorizationUrl });
  });

  // ---- GET /auth/oidc/callback ---------------------------------------------
  app.get("/callback", async (c) => {
    const encryptor = options.encryptor;
    if (!encryptor) return failRedirect(c, "encryption_unavailable");

    // IdP がエラーを返した場合(利用者が同意を拒否した等)。
    const idpError = c.req.query("error");
    if (typeof idpError === "string" && idpError !== "") {
      console.error(`oidc callback: idp returned error=${idpError}`);
      return failRedirect(c, "sso_failed");
    }

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (typeof code !== "string" || code === "" || typeof state !== "string" || state === "") {
      return failRedirect(c, "sso_state_mismatch");
    }

    const cookieValue = getCookie(c, OIDC_TX_COOKIE_NAME);
    if (!cookieValue) return failRedirect(c, "sso_state_mismatch");
    const decrypted = await encryptor.decrypt(cookieValue);
    if (decrypted === null) return failRedirect(c, "sso_state_mismatch");

    let tx: OidcTransaction;
    try {
      tx = JSON.parse(decrypted) as OidcTransaction;
    } catch {
      return failRedirect(c, "sso_state_mismatch");
    }
    if (
      typeof tx.tenantId !== "string" ||
      typeof tx.state !== "string" ||
      typeof tx.nonce !== "string" ||
      typeof tx.codeVerifier !== "string" ||
      typeof tx.issuedAt !== "number"
    ) {
      return failRedirect(c, "sso_state_mismatch");
    }
    // Cookie の Max-Age はクライアント任せなので、サーバー側でも期限を確認する。
    if (nowMinutes() - tx.issuedAt > OIDC_TX_TTL_SECONDS / 60) return failRedirect(c, "sso_state_mismatch");
    if (!timingSafeEqual(tx.state, state)) return failRedirect(c, "sso_state_mismatch");

    const config = await loadUsableConfig(tx.tenantId);
    if (!config.ok) return failRedirect(c, config.code);

    let identity: { email: string; emailVerified: boolean; subject: string };
    try {
      const discovery = await discover(config.issuer, options.network);
      const idToken = await exchangeCode(
        {
          discovery,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          redirectUri: resolveRedirectUri(c, options),
          code,
          codeVerifier: tx.codeVerifier,
        },
        options.network,
      );
      identity = await verifyIdToken(
        { discovery, idToken, clientId: config.clientId, expectedNonce: tx.nonce },
        options.network,
      );
    } catch (err) {
      if (err instanceof OidcError) {
        console.error(`oidc callback failed for tenant ${tx.tenantId}: ${err.message}`);
        return failRedirect(c, err.code);
      }
      throw err;
    }

    // email_verified の既定は「未検証は拒否」。allowUnverifiedEmail はテナント単位の逃げ道
    // (schema/oidc.ts のコメント参照)。ここを緩めると、任意のメールアドレスを名乗れる IdP で
    //  他人になりすませるため、既定は必ず false 側にしておく。
    if (!identity.emailVerified && !config.allowUnverifiedEmail) {
      console.error(`oidc callback: unverified email rejected for tenant ${tx.tenantId}`);
      return failRedirect(c, "sso_email_unverified");
    }

    const candidates = (
      await db
        .select()
        .from(users)
        .where(and(eq(users.tenantId, tx.tenantId), sql`lower(${users.email}) = ${normalizeEmail(identity.email)}`))
    ).filter((u) => u.isActive);

    if (candidates.length !== 1) {
      // 0件 = 招待されていない(自動作成はしない)。2件以上 = 大文字小文字だけが違う
      // 同居アカウント。どちらも「誰としてログインすべきか決まらない」ので同じ扱いにする。
      console.error(
        `oidc callback: no unique user for email in tenant ${tx.tenantId} (matched ${candidates.length} active user(s))`,
      );
      return failRedirect(c, "sso_user_not_found");
    }
    const user = candidates[0] as (typeof candidates)[number];

    const now = nowMinutes();
    const session = await createSession(db, { tenantId: user.tenantId, userId: user.id, nowMinutes: now });
    setSessionCookie(c, session.token, { secure: options.secureCookies });

    // 監査ログ: パスワードログインには現状ログを残していない(v0.1 以来)。SSO は
    // 「社外の IdP を信頼して入る」経路であり、いつ誰がどの issuer 経由で入ったかは
    // 事後調査の材料になるため、こちらだけ先に記録する(action は将来パスワード側を
    // 足すときにも使えるよう `auth.login` + detail.method の形にしてある)。
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "auth.login",
      targetType: "users",
      targetId: user.id,
      detail: JSON.stringify({ method: "oidc", issuer: config.issuer, subject: identity.subject }),
      occurredAt: now,
    });

    deleteCookie(c, OIDC_TX_COOKIE_NAME, { path: "/" });
    return c.redirect(appUrl(options, "/"), 302);
  });

  return app;
}
