import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Database } from "@kizami/db";
import type { VapidKeys } from "@kizami/notify";
import type { Encryptor } from "./lib/encryption.js";
import { apiKeyScopeGuardMiddleware } from "./auth/api-key-scope-guard.js";
import { authOrApiKeyMiddleware, type AppEnv } from "./auth/middleware.js";
import { ForbiddenError } from "./authz.js";
import { MonthClosedError, MonthClosedRequiresUnlockError } from "./lib/closing-guard.js";
import { createApiKeysRoutes } from "./routes/api-keys.js";
import { createAttendanceRoutes } from "./routes/attendance.js";
import { createAuditLogsRoutes } from "./routes/audit-logs.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createTotpRoutes } from "./routes/auth-totp.js";
import { createOidcRoutes, type OidcRoutesOptions } from "./routes/auth-oidc.js";
import { createAutoBreakWaiversRoutes } from "./routes/auto-break-waivers.js";
import { createClosingsRoutes } from "./routes/closings.js";
import { createCorrectionsRoutes } from "./routes/corrections.js";
import { createDepartmentsRoutes } from "./routes/departments.js";
import { createExportsRoutes } from "./routes/exports.js";
import { createHelpRoutes } from "./routes/help.js";
import { createInvitationsRoutes } from "./routes/invitations.js";
import { createMeRoutes } from "./routes/me.js";
import { createMembersRoutes } from "./routes/members.js";
import { createNotificationsRoutes } from "./routes/notifications.js";
import { createNotificationPreferencesRoutes } from "./routes/notification-preferences.js";
import { createPasswordResetsRoutes } from "./routes/password-resets.js";
import { createPresetsRoutes } from "./routes/presets.js";
import { createPunchesRoutes } from "./routes/punches.js";
import { createPushRoutes } from "./routes/push.js";
import { createSettingsRoutes, type SettingsRoutesDeps } from "./routes/settings/index.js";
import { createShiftsRoutes } from "./routes/shifts.js";
import { createSlackRoutes } from "./routes/slack.js";
import { createLeaveRoutes } from "./routes/leave.js";
import { createRateLimiter, ipRateLimitMiddleware, RATE_LIMITS } from "./lib/rate-limit.js";

export interface CreateAppDeps {
  db: Database;
  /**
   * セッション Cookie に Secure を付けるか。省略時 false(テスト用)。
   * 実行環境のエントリポイント(node.ts 等)は明示的に渡すこと(既定 ON)。
   */
  secureCookies?: boolean;
  /**
   * 許可する CORS オリジン(開発時の Waku dev サーバー用)。
   * 省略時は CORS ヘッダを付けない(本番は同一オリジン配信が前提)。
   */
  corsOrigin?: string;
  /**
   * POST /settings/notifications/test が使う通知チャネルの依存差し替え
   * (実際の送信を行う Node 実装は node.ts が渡す。テストは偽実装を注入して実送信しない)。
   */
  notify?: SettingsRoutesDeps;
  /**
   * 秘密情報(webhookUrl・smtpPassword)の暗号化・復号に使う Encryptor。
   * 未設定/null の場合、settings.ts の PUT は秘密情報を含む更新を 503 で拒否する
   * (平文フォールバックはしない)。node.ts / worker.ts は環境変数 KIZAMI_ENCRYPTION_KEY から
   * apps/api/src/lib/encryption.ts の buildEncryptorFromEnv() で組み立てて渡す。
   */
  encryptor?: Encryptor | null;
  /**
   * 前段プロキシ(Cloudflare Tunnel → Caddy)が付ける CF-Connecting-IP / X-Forwarded-For を
   * レート制限のクライアント IP 判定に使ってよいか(既定 true)。
   *
   * api を直接インターネットへ晒す配備では **必ず false にすること**
   * (false ならヘッダを一切見ず TCP のソースアドレスのみを使う)。node.ts は環境変数
   * `TRUST_PROXY=false` でこれを渡す。判断の背景は lib/client-ip.ts 冒頭のコメント。
   */
  trustProxy?: boolean;
  /**
   * レート制限の時刻源(ミリ秒)。既定は `Date.now`。テストが窓の経過を実時間を待たずに
   * 再現するための注入点(lib/rate-limit.ts の RateLimiterOptions.now)。
   */
  rateLimitNow?: () => number;
  /**
   * OIDC(SSO)ログインの配線(docs/design/sso-oidc.md、2026-08-24 追加)。
   * `secureCookies` と `encryptor` は createApp の同名オプションから引き継ぐため、ここでは
   * それ以外(redirect_uri・Web のベース URL・テストの偽 IdP 用 fetch)だけを渡す。
   */
  oidc?: Omit<OidcRoutesOptions, "secureCookies" | "encryptor">;
  /**
   * ブラウザプッシュ通知(Web Push)の VAPID 鍵(docs/design/web-push.md、2026-08-24 追加)。
   * node.ts / worker.ts は環境変数 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT から
   * lib/web-push.ts の buildVapidFromEnv() で組み立てて渡す。未設定/null なら
   * /push/* は 404 push_unavailable を返し、GET /settings/notifications/me は
   * pushAvailable: false を返す(= Web UI からプッシュ通知の UI が消える)。
   */
  vapid?: VapidKeys | null;
}

/**
 * ランタイム非依存の Hono アプリ本体。
 * Node からは node.ts、Workers からは workers.ts がこれを共有する(要件 §8)。
 *
 * DB(@kizami/engine と @kizami/db 接続済み)を deps 経由で注入するファクトリにすることで、
 * テストは :memory: DB を、Node ランタイムは env から作った DB をそれぞれ渡せるようにする。
 */
export function createApp(deps: CreateAppDeps) {
  const { db, secureCookies = false, corsOrigin, notify, encryptor, trustProxy = true, rateLimitNow, oidc, vapid } = deps;
  const app = new Hono<AppEnv>();

  if (corsOrigin) {
    app.use("*", cors({ origin: corsOrigin, credentials: true }));
  }

  // 認証系のレート制限(2026-08-24、公開デモインスタンス公開に伴い Tier 2 から前倒し)。
  // カウンタはこの createApp 呼び出しに閉じたプロセス内メモリ(lib/rate-limit.ts 冒頭の
  // 「replicas=1 前提」の判断点を参照)。テストは createApp ごとに独立したカウンタを得る。
  const now = rateLimitNow ?? (() => Date.now());
  const rateLimiters = {
    loginPerIpEmail: createRateLimiter({ ...RATE_LIMITS.loginPerIpEmail, now }),
    loginPerIp: createRateLimiter({ ...RATE_LIMITS.loginPerIp, now }),
    totpPerIpUser: createRateLimiter({ ...RATE_LIMITS.totpPerIpUser, now }),
    tokenPerIp: createRateLimiter({ ...RATE_LIMITS.tokenPerIp, now }),
    apiKeyPerIp: createRateLimiter({ ...RATE_LIMITS.apiKeyPerIp, now }),
    oidcPerIp: createRateLimiter({ ...RATE_LIMITS.oidcPerIp, now }),
  };

  app.get("/healthz", (c) => c.json({ ok: true, name: "kizami" }));

  // OIDC(SSO)ログインの3経路は未認証で開放される(セッションを張る前の経路のため)。
  // start は「任意の issuer へ HTTP を出させる」入口、callback は「ID トークンを持ち込ませる」入口、
  // available は「メールアドレスの在籍照会」なので、いずれも IP ごとに 20回/15分で頭を押さえる
  // (招待・パスワードリセットのトークン経路と同じ上限。RATE_LIMITS.oidcPerIp)。
  // Hono は登録順に評価するため、この use() は対応する route() より前に置く必要がある。
  app.use("/auth/oidc/*", ipRateLimitMiddleware(rateLimiters.oidcPerIp, { trustProxy }));
  app.route("/auth/oidc", createOidcRoutes(db, { ...(oidc ?? {}), secureCookies, encryptor: encryptor ?? null }));

  app.route(
    "/auth",
    createAuthRoutes(db, {
      secureCookies,
      rateLimit: {
        perIpEmail: rateLimiters.loginPerIpEmail,
        perIp: rateLimiters.loginPerIp,
        // 2FA のコード検証はセルフサービス側(/auth/totp/*)と同じカウンタを共有する
        // (経路を変えても総当たりの回数が増えないように。lib/rate-limit.ts の RATE_LIMITS)。
        perIpUser: rateLimiters.totpPerIpUser,
        trustProxy,
      },
      encryptor: encryptor ?? null,
    }),
  );

  // 招待受諾・パスワードリセットのトークン経路は未認証で開放されている(下記)ぶん、
  // トークン推測の総当たりに晒される。IP ごとに 20回/15分で頭を押さえる(検証用の GET も
  // 同じバケツに入れる — 総当たりは GET の方が安上がりなので、POST だけ絞っても意味がない)。
  //
  // 判断点(NAT の巻き添え): オフィスの共有グローバル IP から大量の従業員が一斉に招待を
  // 受諾すると、正規利用でもこの上限に触れうる。上限は lib/rate-limit.ts の RATE_LIMITS に
  // 集約してあるので、運用でそういう事象が出たら緩める。まずは安全側の値で入れる。
  //
  // Hono は登録順にハンドラを評価するため、この use() は対応する route() より前に置く必要がある。
  const tokenRateLimit = ipRateLimitMiddleware(rateLimiters.tokenPerIp, { trustProxy });
  app.use("/invitations/*", tokenRateLimit);
  app.use("/password-resets/*", tokenRateLimit);

  // GET /invitations/:token, POST /invitations/:token/accept(招待受諾)も認証ミドルウェアの
  // 外側に置く。受諾前のユーザーはまだ auth_credentials を持たずセッションも張れないため
  // (docs/requirements.md §認証)。
  app.route("/invitations", createInvitationsRoutes(db, { secureCookies }));

  // GET /password-resets/:token, POST /password-resets/:token/use(管理者発行パスワードリセットの
  // 使用、Tier 0)も同じ理由で認証ミドルウェアの外側に置く(使用前のユーザーはまだ有効なセッションを
  // 張れない・張っていても新しいパスワードを知らないため、この経路自体を未認証で開放する)。
  app.route("/password-resets", createPasswordResetsRoutes(db, { secureCookies }));

  // POST /slack/commands(Slackスラッシュコマンド打刻)は認証ミドルウェアの外側に置く。
  // Slackはセッションを持たないため、署名検証(routes/slack.ts)が認証の代わりになる
  // (docs/external-api/slack.md)。
  app.route("/slack", createSlackRoutes(db, { encryptor: encryptor ?? null }));

  const authed = new Hono<AppEnv>();
  // 公開打刻API(`Authorization: Bearer kzm_...`)のキー推測対策(2026-08-24)。
  // 認証ミドルウェアより前に置く — 無効なキーは 401 で弾かれてルートまで到達しないため、
  // 認証の後ろに置いても総当たりを止められない。
  //
  // 判断点(セッション Cookie 認証は対象外): appliesTo で Authorization ヘッダ付きの
  // リクエストだけに限定する。Web UI(Cookie 認証)はこの制限を一切通らないので、
  // オフィスの共有 IP から多数の従業員が打刻しても巻き添えにならない。
  // 上限 120回/分は IC カードリーダー等の常時接続クライアントを想定した大きめの値。
  authed.use(
    "*",
    ipRateLimitMiddleware(rateLimiters.apiKeyPerIp, {
      trustProxy,
      appliesTo: (c) => c.req.header("authorization")?.startsWith("Bearer ") ?? false,
    }),
  );
  // セッションCookie / 公開打刻APIキーの両方を受け付ける(v0.4)。認証後、APIキー認証のみ
  // エンドポイント許可表(apiKeyScopeGuardMiddleware)でさらに絞り込む。
  authed.use("*", authOrApiKeyMiddleware(db, { secureCookies }));
  authed.use("*", apiKeyScopeGuardMiddleware());
  authed.route("/me", createMeRoutes(db));
  // 二要素認証(TOTP)のセルフサービス(docs/design/two-factor-auth.md、2026-08-27)。
  // 認証済み本人のみ・権限チェック無し(routes/auth-totp.ts 冒頭コメント)。ログインの
  // 第2段階(POST /auth/login/totp)は未認証で叩く必要があるため routes/auth.ts 側にある。
  // APIキー認証では触れない(auth/api-key-scope-guard.ts の許可表に載せていない = 403)。
  authed.route(
    "/auth/totp",
    createTotpRoutes(db, {
      encryptor: encryptor ?? null,
      rateLimit: { perIpUser: rateLimiters.totpPerIpUser, trustProxy },
    }),
  );
  authed.route("/api-keys", createApiKeysRoutes(db));
  authed.route("/punches", createPunchesRoutes(db));
  authed.route("/attendance", createAttendanceRoutes(db));
  authed.route("/shifts", createShiftsRoutes(db));
  // 承認・却下の本人通知を外部チャネル(メール/個人Webhook)へも流すための deps(2026-08-23 承認モデル統一の配線)
  authed.route("/corrections", createCorrectionsRoutes(db, { ...(notify ?? {}), encryptor: encryptor ?? null, vapid: vapid ?? null }));
  // 休憩自動控除の打ち消し申請(docs/design/breaks.md)。承認通知の送信に settings.ts と同じ
  // notify 依存(smtpSendFn 等)+ encryptor を必要とするため、同じ deps をそのまま渡す。
  authed.route("/auto-break-waivers", createAutoBreakWaiversRoutes(db, { ...(notify ?? {}), encryptor: encryptor ?? null, vapid: vapid ?? null }));
  authed.route("/notifications", createNotificationsRoutes(db));
  authed.route("/settings", createSettingsRoutes(db, { ...(notify ?? {}), encryptor: encryptor ?? null }));
  // 個人の通知受け取り設定(GET/PUT /settings/notifications/me, POST /settings/notifications/me/test)。
  // 権限チェック無し(認証済み本人のみ、routes/notification-preferences.ts 冒頭コメント参照)。
  // /settings/notifications(テナント設定, createSettingsRoutes)とはパスの衝突が無いため
  // 別のサブルータとしてマウントできる("/notifications" 完全一致 vs "/notifications/me")。
  authed.route(
    "/settings/notifications",
    createNotificationPreferencesRoutes(db, { ...(notify ?? {}), encryptor: encryptor ?? null, vapid: vapid ?? null }),
  );
  // ブラウザプッシュ通知の購読管理(GET /push/vapid-public-key, GET/POST/DELETE /push/subscriptions)。
  // 個人の通知設定と同じく権限チェック無し(認証済み本人のみ — routes/push.ts 冒頭コメント参照)。
  authed.route("/push", createPushRoutes(db, { vapid: vapid ?? null }));
  authed.route("/help", createHelpRoutes(db));
  authed.route("/departments", createDepartmentsRoutes(db));
  authed.route("/members", createMembersRoutes(db));
  authed.route("/presets", createPresetsRoutes(db));
  authed.route("/closings", createClosingsRoutes(db));
  authed.route("/exports", createExportsRoutes(db));
  authed.route("/leave", createLeaveRoutes(db, { ...(notify ?? {}), encryptor: encryptor ?? null, vapid: vapid ?? null }));
  authed.route("/audit-logs", createAuditLogsRoutes(db));
  app.route("/", authed);

  app.onError((err, c) => {
    if (err instanceof ForbiddenError) {
      // 403 の詳細(どの権限・スコープで弾かれたか)はクライアントへは返さない(情報最小化)が、
      // 運用調査のためサーバーログには残す。スタックトレースは不要(ForbiddenError は想定内の
      // 分岐であり、バグ調査に要るのは「誰が何を試みて弾かれたか」のメッセージのみのため)。
      console.error(`forbidden: ${err.message}`);
      return c.json({ error: "forbidden" }, 403);
    }
    if (err instanceof MonthClosedRequiresUnlockError) {
      return c.json({ error: "month_closed_requires_unlock" }, 409);
    }
    if (err instanceof MonthClosedError) {
      return c.json({ error: "month_closed" }, 409);
    }
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
