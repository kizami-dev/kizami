import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { migrateDb } from "@kizami/db/node";
import { createApp } from "./app.js";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { buildErrorReporterFromEnv } from "./lib/error-report.js";
import { authPostAllowedOrigins } from "./lib/json-post-guard.js";
import { buildNotifyOutboundDeps, buildOutboundGuardFromEnv } from "./lib/outbound-guard.js";
import { withStartupRetry } from "./lib/startup-retry.js";
import { parseSignupEnv } from "./lib/signup-config.js";
import { parseSystemMailEnv } from "./lib/system-mail-config.js";
import { parseTurnstileEnv } from "./lib/turnstile.js";
import { nodemailerSendFn } from "./lib/smtp.js";
import { createSystemMailSender } from "./lib/system-mail.js";
import { resolveRelease } from "./lib/version.js";
import { buildVapidFromEnv } from "./lib/web-push.js";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL ?? "file:./kizami.db";

// Secure Cookie は既定 ON。http のみの環境では COOKIE_SECURE=false で無効化
// (localhost は secure context 扱いのため開発時も既定のままでよい)
const secureCookies = process.env.COOKIE_SECURE !== "false";

// 開発時は Waku dev サーバー(別オリジン)からの呼び出しを許可する
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

// 秘密情報(webhookUrl・smtpPassword)の暗号化に使う。未設定/不正なら null
// (settings.ts の PUT が秘密情報の保存を 503 で拒否する — 平文フォールバックはしない)。
const encryptor = buildEncryptorFromEnv();

// レート制限のクライアント IP 判定に CF-Connecting-IP / X-Forwarded-For を使ってよいか。
// 既定 ON(本番は Cloudflare Tunnel → Caddy → api の経路が保証されており、エッジが
// CF-Connecting-IP を必ず上書きするため信頼できる)。api を直接インターネットへ晒す配備では
// TRUST_PROXY=false にすること(ヘッダを偽装するだけでレート制限を回避できてしまうため)。
// 判断の背景は apps/api/src/lib/client-ip.ts 冒頭のコメント。
const trustProxy = process.env.TRUST_PROXY !== "false";

// OIDC(SSO)ログイン(docs/design/sso-oidc.md)。
// - APP_BASE_URL: 成功時 "/" ・失敗時 "/login?error=..." へ戻す Web アプリのベース URL。
//   本番は api と web を同一オリジンで配信する前提なので未設定(=相対パス)でよい。
//   開発時は web(:3000)と api(:3001)が別オリジンなので、CORS_ORIGIN を明示していれば
//   それを流用する(未設定なら相対パスのまま = 同一オリジン配信とみなす)。
// - OIDC_REDIRECT_URI: IdP に登録した戻り先。未設定ならリクエスト URL から導出する
//   (前段でホスト名を書き換えている配備では明示すること)。
// `||`(空文字も未設定扱い): compose が未設定の APP_BASE_URL を空文字で渡してくるため。
const appBaseUrl = process.env.APP_BASE_URL || process.env.CORS_ORIGIN;
const oidcRedirectUri = process.env.OIDC_REDIRECT_URI;

// ブラウザプッシュ通知(Web Push、docs/design/web-push.md)。VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY / VAPID_SUBJECT がすべて揃っている場合だけ有効になる。未設定なら null で、
// /push/* は 404 push_unavailable を返し Web UI からプッシュ通知の UI ごと消える。
// 鍵の生成: `pnpm generate-vapid`(deploy/k8s/README.md 参照)。
const vapid = buildVapidFromEnv();

// 可観測性(docs/design/observability.md)。どちらも**未設定なら機能ごと無効**:
// - METRICS_TOKEN 未設定 → GET /metrics は生えない(404)
// - SENTRY_DSN 未設定 → エラー報告は no-op(外部へは何も出ていかない)
const release = resolveRelease();
const metricsToken = process.env.METRICS_TOKEN;
const errorReporter = buildErrorReporterFromEnv(process.env, { release, runtime: "node" });

// セルフサインアップ(KIZAMI Cloud、docs/design/saas.md)。SIGNUP_MODE が off 以外なのに
// 必須の環境変数(TURNSTILE_SECRET_KEY / TURNSTILE_SITE_KEY / SYSTEM_SMTP_URL /
// SYSTEM_MAIL_FROM / APP_BASE_URL)が欠けていれば、**起動時に欠けているものを列挙してエラー終了**する
// (登録フォームは出るのに誰も登録を完了できない、という状態を公開後に発見しないため。
// 理由は lib/signup-config.ts 冒頭)。off(既定)なら何も変わらない。
const signupEnv = parseSignupEnv(process.env);
if (!signupEnv.ok) {
  for (const message of signupEnv.errors) console.error(`[kizami] invalid signup configuration: ${message}`);
  process.exit(1);
}
const signupConfig = signupEnv.config;

// 本人用の「パスワードを忘れた」(2026-10-04)。**SIGNUP_MODE とは独立**に、システムメール
// (SYSTEM_SMTP_URL / SYSTEM_MAIL_FROM / APP_BASE_URL)が揃っているときだけ有効にする。揃っていなければ
// 無効(= セルフホストの体験は変わらない)で、ここでは落とさない。ただし値があるのに形式が不正なら、
// 「設定したつもりで無効」を黙って放置しないよう警告を出す。Turnstile は両方のキーがあるときだけ必須にする。
const systemMailEnv = parseSystemMailEnv(process.env);
for (const message of systemMailEnv.errors) console.warn(`[kizami] password self-service reset disabled: ${message}`);
const systemMailConfig = systemMailEnv.config;
const turnstileConfig = parseTurnstileEnv(process.env);

// アプリ側の SSRF 対策(lib/outbound-policy.ts)。OUTBOUND_BLOCK_PRIVATE=true(または OUTBOUND_DENY_CIDRS)で
// 有効、**既定は無効**。テナントが設定できる送り先(Webhook・SMTP・OIDC の issuer・プッシュの endpoint)への接続を、
// 検査済みの IP にだけ行う。運用者が設定する送り先(SENTRY_DSN・SYSTEM_SMTP_URL・Turnstile)は対象外。
// 形式が不正なら「設定したつもりで素通し」を避けるため起動時に落とす。
const outboundEnv = buildOutboundGuardFromEnv(process.env);
if (outboundEnv.errors.length > 0) {
  for (const message of outboundEnv.errors) console.error(`[kizami] invalid outbound configuration: ${message}`);
  process.exit(1);
}
const outboundGuard = outboundEnv.guard;
// 送信関数(transport)は signup とパスワード再設定で1つを共有する。
const systemMailSender =
  systemMailConfig !== null ? createSystemMailSender({ smtpUrl: systemMailConfig.systemSmtpUrl, from: systemMailConfig.systemMailFrom }) : null;

// 起動直後の一時的な接続失敗(クラスタ DNS の EAI_AGAIN 等)は待って再試行する(lib/startup-retry.ts)
const { db } = await withStartupRetry(() => migrateDb({ url: databaseUrl }));
const app = createApp({
  db,
  secureCookies,
  corsOrigin,
  // ログイン等の未認証 POST の Origin 検証。許可するのは**明示された** APP_BASE_URL / CORS_ORIGIN だけ
  // (corsOrigin の開発用既定値は含めない。lib/json-post-guard.ts)。どちらも未設定なら検証しない。
  authPostOrigins: authPostAllowedOrigins([process.env.APP_BASE_URL, process.env.CORS_ORIGIN]),
  notify: buildNotifyOutboundDeps(outboundGuard, nodemailerSendFn),
  encryptor,
  trustProxy,
  vapid,
  release,
  errorReporter,
  ...(metricsToken !== undefined ? { metricsToken } : {}),
  ...(signupConfig !== null
    ? {
        signup: {
          mode: signupConfig.mode,
          turnstileSecretKey: signupConfig.turnstileSecretKey,
          turnstileSiteKey: signupConfig.turnstileSiteKey,
          appBaseUrl: signupConfig.appBaseUrl,
          // signupConfig が非 null なら systemMailConfig も非 null(同じ解析を通っている)
          sendMail: systemMailSender!,
        },
      }
    : {}),
  ...(systemMailConfig !== null && systemMailSender !== null
    ? {
        selfServiceReset: {
          appBaseUrl: systemMailConfig.appBaseUrl,
          sendMail: systemMailSender,
          ...(turnstileConfig !== null ? { turnstile: turnstileConfig } : {}),
        },
      }
    : {}),
  oidc: {
    ...(appBaseUrl !== undefined ? { appBaseUrl } : {}),
    ...(oidcRedirectUri !== undefined ? { redirectUri: oidcRedirectUri } : {}),
    // OIDC の discovery・トークン・JWKS の取得も、SSRF ガード有効時は検査済みの IP にだけ接続する
    ...(outboundGuard !== null ? { network: { fetchImpl: outboundGuard.fetch } } : {}),
  },
});

// リバースプロキシ/トンネルのパス振り分け(kizami.example.com/api/* → ここ)を
// パス書き換えなしで受けられるよう、/api プレフィクス付きでも同じアプリを提供する
const root = new Hono();
root.route("/api", app);
root.route("/", app);

serve({ fetch: root.fetch, port });
console.log(`kizami api listening on :${port}`);
