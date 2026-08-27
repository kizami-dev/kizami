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
 * | 定期スキャン | src/worker.ts(BullMQ + Valkey) | **無し**(Cron Triggers + Queues は今後の課題) |
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
import { buildVapidFromEnv } from "./lib/web-push.js";

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
}

/** アイソレート内キャッシュ(上のコメント「リクエストごとに createApp() しない理由」)。 */
let cached: { binding: D1DatabaseBinding; app: ReturnType<typeof createWorkerApp> } | undefined;

/**
 * `env` から Hono アプリを組み立てる(テストからも使えるよう export する)。
 *
 * リバースプロキシのパス振り分け(kizami.example.com/api/* → ここ)をパス書き換えなしで
 * 受けられるよう、src/node.ts と同じく `/api` プレフィクス付きでも同じアプリを提供する。
 */
export function createWorkerApp(env: WorkerEnv) {
  const { db } = createD1Database(env.DB);

  const app = createApp({
    db,
    // Workers は常に HTTPS 終端の後ろなので Secure Cookie は既定 ON のままでよい
    secureCookies: env.COOKIE_SECURE !== "false",
    ...(env.CORS_ORIGIN !== undefined ? { corsOrigin: env.CORS_ORIGIN } : {}),
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

export default {
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
