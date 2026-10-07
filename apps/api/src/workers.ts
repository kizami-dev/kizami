/**
 * Cloudflare Workers(workerd)エントリ。Node 版(src/node.ts)と同じ `createApp()` を共有する。
 *
 * 要件 §8「Cloudflare Workers + D1 での動作を保証する」の実体。設計・制約の一覧は
 * docs/design/workers-d1.md を参照(**このファイルだけ読んで配備しないこと** — D1 では
 * 明示トランザクションが使えないなど、Node 版と機能差がある)。
 *
 * ## Node 版との違い
 *
 * | | Node(src/node.ts) | Workers(このファイル) |
 * | --- | --- | --- |
 * | DB | `migrateDb({ url: DATABASE_URL })`(起動時にマイグレーション適用) | `createD1Database(env.DB)`(マイグレーションはデプロイ時に wrangler が適用) |
 * | 設定の入手元 | `process.env` | `env`(wrangler の vars / secrets) |
 * | テナントの SMTP | nodemailer(`notify.smtpSendFn`) | `cloudflare:sockets` の自前の SMTP クライアント(lib/smtp-client.ts + lib/workers-smtp-socket.ts。465 / STARTTLS、ポート 25 は不可) |
 * | システムメール | `SYSTEM_SMTP_URL`(nodemailer) | Email Service の `send_email` バインディング `EMAIL`(lib/email-service-mail.ts) |
 * | SSRF ガード(OUTBOUND_*) | 名前を解決して検査した IP に接続 | 名前と IP リテラルだけの検査(lib/outbound-hostname-guard.ts。プライベートアドレスには元々届かない) |
 * | 定期スキャン | src/worker.ts(BullMQ + Valkey) | **Cron Triggers**(下の `scheduled()` → src/workers-cron.ts。スキャン本体は共通) |
 * | レート制限 | プロセス内メモリ(replicas=1 前提) | **アイソレート内メモリ**(= 実質もっと緩い。lib/rate-limit.ts の判断点参照) |
 *
 * ## リクエストごとに `createApp()` しない理由
 *
 * レート制限のカウンタは `createApp()` 呼び出しに閉じている(lib/rate-limit.ts)。毎リクエスト
 * 組み立て直すとカウンタが毎回リセットされ、レート制限が完全に無効化される。そのためアイソレート
 * 内でモジュールスコープにキャッシュする(D1 バインディングが同一である限り使い回す)。
 */

import { Hono } from "hono";
import { createD1Database, type D1DatabaseBinding } from "@kizami/db";
import type { SmtpSendFn } from "@kizami/notify";
import { createApp } from "./app.js";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { buildErrorReporterFromEnv } from "./lib/error-report.js";
import { authPostAllowedOrigins } from "./lib/json-post-guard.js";
import { createTenantQuotas, parseQuotaEnv } from "./lib/tenant-quotas.js";
import { buildVapidFromEnv } from "./lib/web-push.js";
import { parseEmailServiceMailEnv, type EmailServiceMailConfig } from "./lib/email-service-mail.js";
import { createHostnameOutboundGuard } from "./lib/outbound-hostname-guard.js";
import { parseOutboundEnv, type OutboundChecker } from "./lib/outbound-policy.js";
import { createSmtpSendFn, SmtpError } from "./lib/smtp-client.js";
import { parseTurnstileEnv } from "./lib/turnstile.js";
import { WORKERS_SMTP_BLOCKED_PORTS, workersSmtpConnector } from "./lib/workers-smtp-socket.js";
import type { TenantWithdrawalMailer } from "./tenant-purge.js";
import { runWorkersCron, WORKERS_CRON_LOG_PREFIX, type WorkersCronResult } from "./workers-cron.js";

/**
 * wrangler.jsonc の bindings / vars / secrets。
 * 名前と意味は src/node.ts が読む環境変数と一対一に揃えてある(配備手順を1つに保つため)。
 */
export interface WorkerEnv {
  /** D1 バインディング(wrangler.jsonc の `d1_databases[].binding`)。 */
  DB: D1DatabaseBinding;
  /** セッション Cookie に Secure を付けるか。`"false"` のときだけ無効化(既定 ON)。 */
  COOKIE_SECURE?: string;
  /** 開発時に別オリジンの Web から呼ぶ場合の許可オリジン。 */
  CORS_ORIGIN?: string;
  /** 前段プロキシのヘッダ(CF-Connecting-IP 等)を信頼するか。`"false"` で無効化。 */
  TRUST_PROXY?: string;
  /** OIDC 成功/失敗時に戻す Web アプリのベース URL。 */
  APP_BASE_URL?: string;
  /** IdP に登録した戻り先。未設定ならリクエスト URL から導出する。 */
  OIDC_REDIRECT_URI?: string;
  /** 秘密情報の暗号化鍵(32バイトの base64)。secret として設定する。 */
  KIZAMI_ENCRYPTION_KEY?: string;
  /** Web Push の VAPID 公開鍵。 */
  VAPID_PUBLIC_KEY?: string;
  /** Web Push の VAPID 秘密鍵。secret として設定する。 */
  VAPID_PRIVATE_KEY?: string;
  /** Web Push の VAPID subject(`mailto:` か `https://`)。 */
  VAPID_SUBJECT?: string;
  /** Prometheus スクレイプ用トークン。未設定なら GET /metrics は生えない(404)。secret 推奨。 */
  METRICS_TOKEN?: string;
  /** エラー報告(Sentry 互換)の DSN。未設定なら no-op。secret として設定する。 */
  SENTRY_DSN?: string;
  /** エラー報告の server_name。 */
  SENTRY_SERVER_NAME?: string;
  /** エラー報告の environment。 */
  SENTRY_ENVIRONMENT?: string;
  /**
   * リリース版("0.7.0" 等)。Node 版は package.json から読む(lib/version.ts)が、
   * Workers ではファイルを読めないので vars で渡す。未設定なら "unknown"。
   */
  KIZAMI_RELEASE?: string;
  /**
   * Cloudflare Email Service の `send_email` バインディング(wrangler.jsonc の `send_email[].name`)。
   * システムメール(運用者名義)の送信に使う。`SYSTEM_MAIL_FROM` / `APP_BASE_URL` と3つ揃ったときだけ有効
   * (lib/email-service-mail.ts)。Node の `SYSTEM_SMTP_URL` に相当する。
   */
  EMAIL?: unknown;
  /** システムメールの差出人(`noreply@example.com` か `KIZAMI <noreply@example.com>`)。Email Sending に登録したドメイン */
  SYSTEM_MAIL_FROM?: string;
  /** SSRF ガード(Node と同じ名前。Workers で効くのは名前と IP リテラルの検査だけ — lib/outbound-hostname-guard.ts) */
  OUTBOUND_BLOCK_PRIVATE?: string;
  OUTBOUND_DENY_CIDRS?: string;
  OUTBOUND_ALLOW_HOSTS?: string;
  /** 本人用のパスワード再設定の Turnstile(Node と同じ。両方あるときだけ必須) */
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
}

/**
 * D1 で `db.transaction()` が使えるか(docs/design/workers-d1.md「D1 で動かないもの」)。
 *
 * **false の間は、システムメールがあっても本人用のパスワード再設定と退会の申請のメールを createApp に渡さない**。
 * どちらの経路もトランザクションを使うので D1 では失敗し、渡すと画面に「パスワードを忘れた」が出るのに
 * 誰も再設定できない(応答の後の処理がログに失敗を残すだけ)状態になる。D1 のトランザクション対応が入ったら
 * **ここを true にするだけで**、組み立て済みのシステムメール(Email Service)がそのまま点く
 * (応答の後のメールは lib/after-response.ts が waitUntil に載せる)。
 *
 * セルフサインアップはこのフラグと関係なく Workers では常に無効(下の createWorkerApp のコメント)。
 * Cron の退会の再通知・削除の完了のメールはトランザクションを使わないので、このフラグを待たずに出る。
 */
export const D1_TRANSACTIONS_SUPPORTED = false;

/** 外向きの通知の依存(createApp の `notify` と Cron に渡す)。 */
interface WorkerOutboundDeps {
  smtpSendFn: SmtpSendFn;
  tenantFetchImpl?: typeof fetch;
  outbound?: OutboundChecker;
}

/**
 * テナントの SMTP の送信関数と、SSRF ガード(OUTBOUND_* が設定されているときだけ)を組み立てる。
 *
 * - 送信関数は lib/smtp-client.ts + `cloudflare:sockets`。ポート 25 は Workers が塞いでいるので、接続の前に
 *   分かりやすいエラーで断る
 * - OUTBOUND_* の値が不正なら**投げる**(Node は起動時に終了する。「設定したつもりで素通し」を避けるため、
 *   Workers では要求ごとに 500 になる — 設定を直すまで直らないことがログで分かる)
 */
function buildWorkerOutbound(env: WorkerEnv): WorkerOutboundDeps {
  const { policy, errors } = parseOutboundEnv(env as unknown as Record<string, string | undefined>);
  if (errors.length > 0) throw new Error(`[kizami] invalid outbound configuration: ${errors.join("; ")}`);
  const smtpSendFn = createSmtpSendFn(workersSmtpConnector, {
    checkTarget: ({ port }) => {
      if (WORKERS_SMTP_BLOCKED_PORTS.has(port)) {
        throw new SmtpError("prepare", `outbound port ${port} is blocked on Cloudflare Workers; use 587 (STARTTLS) or 465 (TLS)`);
      }
    },
  });
  if (policy === null) return { smtpSendFn };
  const guard = createHostnameOutboundGuard(policy);
  return { smtpSendFn: guard.wrapSmtpSend(smtpSendFn), tenantFetchImpl: guard.fetch, outbound: guard };
}

/** システムメール(Email Service)。揃っていなければ null。値が不正なら警告だけ出す(Node と同じ)。 */
function buildWorkerSystemMail(env: WorkerEnv): EmailServiceMailConfig | null {
  const { config, errors } = parseEmailServiceMailEnv(env);
  for (const message of errors) console.warn(`[kizami] system mail disabled: ${message}`);
  return config;
}

/** アイソレート内キャッシュ(上のコメント「リクエストごとに createApp() しない理由」)。 */
let cached: { binding: D1DatabaseBinding; app: ReturnType<typeof createWorkerApp> } | undefined;

/**
 * `env` から Hono アプリを組み立てる(テストからも使えるよう export する)。
 *
 * リバースプロキシのパス振り分け(kizami.example.com/api/* → ここ)をパス書き換えなしで
 * 受けられるよう、src/node.ts と同じく `/api` プレフィクス付きでも同じアプリを提供する。
 */
function parseWorkerQuotaEnv(env: Record<string, string | undefined>) {
  const { limits, errors } = parseQuotaEnv(env);
  for (const message of errors) console.warn(`[kizami] ignoring an invalid quota setting: ${message}`);
  return limits;
}

export function createWorkerApp(env: WorkerEnv, options: { d1TransactionsSupported?: boolean } = {}) {
  const { db } = createD1Database(env.DB);
  const outbound = buildWorkerOutbound(env);
  const systemMail = buildWorkerSystemMail(env);
  const transactionalMailFlows = (options.d1TransactionsSupported ?? D1_TRANSACTIONS_SUPPORTED) && systemMail !== null;
  const turnstile = parseTurnstileEnv(env as unknown as Record<string, string | undefined>);

  // 可観測性(docs/design/observability.md)。Node 版(src/node.ts)と同じ環境変数名を使う。
  // Node と違い package.json を読めないので、版は vars の KIZAMI_RELEASE から取る。
  const release = env.KIZAMI_RELEASE ?? "unknown";
  const flatEnv = env as unknown as Record<string, string | undefined>;

  const app = createApp({
    db,
    // Workers は常に HTTPS 終端の後ろなので Secure Cookie は既定 ON のままでよい
    secureCookies: env.COOKIE_SECURE !== "false",
    ...(env.CORS_ORIGIN !== undefined ? { corsOrigin: env.CORS_ORIGIN } : {}),
    // ログイン等の未認証 POST の Origin 検証(Node 版と同じ。lib/json-post-guard.ts)
    authPostOrigins: authPostAllowedOrigins([env.APP_BASE_URL, env.CORS_ORIGIN]),
    // テナントごとの利用上限(QUOTA_* の vars。不正な値は警告して無制限のまま)
    quotas: createTenantQuotas(parseWorkerQuotaEnv(flatEnv)),
    // `signup` は渡さない = **セルフサインアップは常に無効**(`GET /signup/config` は
    // `{ mode: "off" }`、他の /signup/* は 404)。システムメールは Email Service で送れるようになったが、
    // 確認フロー(テナントの作成)が db.transaction() に依存し D1 では使えない。加えてセルフサインアップは
    // KIZAMI Cloud(Node で運用)のための機能で、Workers 配備で公開登録を受ける想定が無い
    // (docs/design/saas.md の実行基盤の節、docs/design/workers-d1.md「メール」)。
    //
    // テナントの SMTP(通知チャネルのメール、POST /settings/notifications/test のテスト送信)は
    // `cloudflare:sockets` の SMTP クライアントで送る(buildWorkerOutbound)。SSRF ガードの検査も同じ依存に載る。
    notify: outbound,
    // 本人用のパスワード再設定・退会の申請のメールは D1 のトランザクション対応まで渡さない(D1_TRANSACTIONS_SUPPORTED)
    ...(transactionalMailFlows && systemMail !== null
      ? {
          selfServiceReset: {
            appBaseUrl: systemMail.appBaseUrl,
            sendMail: systemMail.sendMail,
            ...(turnstile !== null ? { turnstile } : {}),
          },
          tenantWithdrawalMail: { appBaseUrl: systemMail.appBaseUrl, sendMail: systemMail.sendMail },
        }
      : {}),
    //
    // buildEncryptorFromEnv / buildVapidFromEnv は Node 版では process.env を読む。
    // Workers では vars/secrets が env に平坦に入るので、そのまま渡せる
    // (どちらも決まったキーしか見ないので DB バインディングが混ざっていても害はない)
    encryptor: buildEncryptorFromEnv(env as unknown as Record<string, string | undefined>),
    // Workers の前段は必ず Cloudflare のエッジで、CF-Connecting-IP は必ず上書きされる
    trustProxy: env.TRUST_PROXY !== "false",
    vapid: buildVapidFromEnv(env as unknown as Record<string, string | undefined>),
    release,
    // workerd では process メトリクス(RSS・uptime)が取れないので、その2本だけ欠ける
    // (lib/metrics.ts の collectProcessMetrics)。他は Node 版と同じ内容が出る。
    ...(env.METRICS_TOKEN !== undefined ? { metricsToken: env.METRICS_TOKEN } : {}),
    errorReporter: buildErrorReporterFromEnv(flatEnv, { release, runtime: "workerd" }),
    oidc: {
      ...(env.APP_BASE_URL !== undefined ? { appBaseUrl: env.APP_BASE_URL } : {}),
      ...(env.OIDC_REDIRECT_URI !== undefined ? { redirectUri: env.OIDC_REDIRECT_URI } : {}),
      // OIDC の discovery・トークン・JWKS の取得も、SSRF ガード有効時は同じ検査を通す(Node と同じ場所)
      ...(outbound.tenantFetchImpl !== undefined ? { network: { fetchImpl: outbound.tenantFetchImpl } } : {}),
    },
  });

  const root = new Hono();
  root.route("/api", app);
  root.route("/", app);
  return root;
}

/**
 * `scheduled()` の第1引数(`ScheduledController`)の、使う面だけの構造的な宣言。
 * `@cloudflare/workers-types` を型解決に持ち込むと @types/node のグローバルと衝突するため
 * (packages/db/src/d1.ts の D1DatabaseBinding と同じ判断)。
 */
export interface ScheduledControllerLike {
  /** 起動した cron 式(wrangler.jsonc の `triggers.crons` の文字列そのもの) */
  readonly cron: string;
  /** 予定時刻(ミリ秒)。スキャンの「今」に使う(src/workers-cron.ts「冪等と再試行」) */
  readonly scheduledTime: number;
  /** この起動を失敗にしても再試行させない */
  noRetry?(): void;
}

/** `ExecutionContext` の使う面だけ。 */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Cron Triggers の1回の起動(src/workers-cron.ts)。テストからも呼べるよう export する。
 *
 * - 依存は Node のワーカー(src/worker.ts)と同じ環境変数名から組み立てる: 暗号化鍵・VAPID・利用上限・エラー報告・
 *   テナントの SMTP と SSRF ガード(buildWorkerOutbound — HTTP と同じ)・退会のメール(システムメール =
 *   Email Service があるときだけ。再通知・完了のメールはトランザクションを使わないので D1 でも出せる)
 * - エラー報告の送信は撃ちっ放しなので、`ctx.waitUntil()` に登録して起動の終わりで打ち切られないようにする
 * - 1本でも失敗したら `noRetry()` してから投げる(Cron Events に失敗を残す。即時の再試行はさせない)。
 *   対応表に無い cron 式も同じ(何も走らせずに投げる)
 */
export async function handleScheduled(controller: ScheduledControllerLike, env: WorkerEnv, ctx: ExecutionContextLike): Promise<WorkersCronResult> {
  const { db } = createD1Database(env.DB);
  const flatEnv = env as unknown as Record<string, string | undefined>;
  const release = env.KIZAMI_RELEASE ?? "unknown";
  const trackedFetch: typeof fetch = (input, init) => {
    const pending = fetch(input, init);
    ctx.waitUntil(pending.then(
      () => undefined,
      () => undefined,
    ));
    return pending;
  };
  const encryptor = buildEncryptorFromEnv(flatEnv);
  const quotas = createTenantQuotas(parseWorkerQuotaEnv(flatEnv));
  const outbound = buildWorkerOutbound(env);
  const systemMail = buildWorkerSystemMail(env);
  const withdrawalMailer: TenantWithdrawalMailer | null =
    systemMail !== null ? { appBaseUrl: systemMail.appBaseUrl, sendMail: systemMail.sendMail } : null;
  // テナントの送り先への送信の依存(Node の worker.ts の notifyOutboundDeps と同じ形。保存時のチェッカーは要らない)
  const sendDeps = {
    smtpSendFn: outbound.smtpSendFn,
    ...(outbound.tenantFetchImpl !== undefined ? { tenantFetchImpl: outbound.tenantFetchImpl } : {}),
  };

  const result = await runWorkersCron({
    cron: controller.cron,
    scheduledTime: controller.scheduledTime,
    deps: {
      db,
      personalChannelOptions: { ...sendDeps, quotas, encryptor, vapid: buildVapidFromEnv(flatEnv) },
      notifyDeps: { ...sendDeps, quotas, encryptor },
      withdrawalMailer,
      errorReporter: buildErrorReporterFromEnv(flatEnv, { release, runtime: "workerd", fetchFn: trackedFetch }),
    },
  });

  if (result.unknownCron) {
    // 設定の食い違い(wrangler.jsonc と対応表)。再試行しても直らないので noRetry して、失敗として残す
    controller.noRetry?.();
    throw new Error(`${WORKERS_CRON_LOG_PREFIX} no scan is mapped to cron "${controller.cron}"`);
  }
  const failed = result.outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.job);
  if (failed.length > 0) {
    controller.noRetry?.();
    throw new Error(`${WORKERS_CRON_LOG_PREFIX} ${failed.length} scan(s) failed for cron "${controller.cron}": ${failed.join(", ")}`);
  }
  return result;
}

export default {
  async scheduled(controller: ScheduledControllerLike, env: WorkerEnv, ctx: ExecutionContextLike): Promise<void> {
    await handleScheduled(controller, env, ctx);
  },

  fetch(request: Request, env: WorkerEnv, ctx: unknown): Response | Promise<Response> {
    // バインディングが差し替わった(= 別の環境で起動し直した)ときだけ組み立て直す
    if (cached === undefined || cached.binding !== env.DB) {
      cached = { binding: env.DB, app: createWorkerApp(env) };
    }
    // c.env には Workers の env をそのまま渡す(lib/client-ip.ts が `env.incoming` を
    // ダックタイピングで覗くが、Workers では undefined になり CF-Connecting-IP 側へ落ちる)
    return cached.app.fetch(request, env as never, ctx as never);
  },
};
