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
 * | SMTP 送信 | nodemailer(`notify.smtpSendFn`) | **無し**(nodemailer は node:net 依存)。テスト送信は 503 になる |
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
import { createApp } from "./app.js";
import { buildEncryptorFromEnv } from "./lib/encryption.js";
import { buildErrorReporterFromEnv } from "./lib/error-report.js";
import { authPostAllowedOrigins } from "./lib/json-post-guard.js";
import { createTenantQuotas, parseQuotaEnv } from "./lib/tenant-quotas.js";
import { buildVapidFromEnv } from "./lib/web-push.js";
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

export function createWorkerApp(env: WorkerEnv) {
  const { db } = createD1Database(env.DB);

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
    // `signup` も渡さない = **セルフサインアップは常に無効**(`GET /signup/config` は
    // `{ mode: "off" }`、他の /signup/* は 404)。システムメールの送信(nodemailer)が workerd で
    // 動かず、確認フローが依存する db.transaction() も D1 では使えないため
    // (docs/design/saas.md の実行基盤の節、docs/design/workers-d1.md)。
    //
    // `notify` は渡さない: Workers には nodemailer が無い(node:net 依存)ため
    // POST /settings/notifications/test の SMTP テスト送信は 503 になる。fetch ベースの
    // メール API を使う SmtpSendFn を1本書けば差し込めるが v1.0 時点では未実装
    // (@kizami/notify 側の変更は不要 — docs/design/workers-d1.md「今後の課題」)。
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
 * - 依存は Node のワーカー(src/worker.ts)と同じ環境変数名から組み立てる: 暗号化鍵・VAPID・利用上限・エラー報告。
 *   SMTP の送信関数は無い(nodemailer は node:net 依存。メールのチャネルは組み立てられない = アプリ内・Webhook・
 *   プッシュだけ)。退会のメールも無い(システムメールの送信手段が無い)。SSRF ガード(OUTBOUND_*)も渡さない
 *   (Workers はプライベートアドレスに届かない — lib/outbound-policy.ts 末尾)
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

  const result = await runWorkersCron({
    cron: controller.cron,
    scheduledTime: controller.scheduledTime,
    deps: {
      db,
      personalChannelOptions: { quotas, encryptor, vapid: buildVapidFromEnv(flatEnv) },
      notifyDeps: { quotas, encryptor },
      withdrawalMailer: null,
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
