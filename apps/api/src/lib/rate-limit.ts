/**
 * 認証系エンドポイントのレート制限(ログイン総当たり・トークン推測への対策、2026-08-24 追加)。
 *
 * 公開デモインスタンスを出したことで「メール+パスワードの総当たり」「招待/リセットトークンの
 * 推測」が現実の脅威になったため、Tier 2 に置いていたレート制限を前倒しで入れる。
 *
 * ## 設計判断: プロセス内メモリのスライディングウィンドウ(v1 として意図的にそうしている)
 *
 * カウンタはこのプロセスのメモリ上の `Map` にしか持たない。理由:
 *
 * - KIZAMI の配備は SQLite ファイル DB を RWO の PVC に置く都合で **replicas=1 固定**
 *   (deploy/k8s/README.md)。プロセスは常に1つなので、共有ストアを持ち込む必然性が今は無い。
 * - 依存パッケージを増やさない(Valkey は打刻忘れリマインドのキュー用であって、リクエスト
 *   経路の同期依存にはしたくない — Valkey が落ちたらログインできない、という結合を避ける)。
 *
 * 逆に言うと、**マルチプロセス/マルチレプリカ、または Cloudflare Workers へ載せた瞬間に
 * この実装は正しくなくなる**(プロセスごとに別カウンタになり、実効の上限が台数倍になる。
 * Workers では等価な「プロセス」すら無い)。その日のために `RateLimiter` インタフェース
 * (`check(key) => { allowed, retryAfterSeconds }`)だけを公開し、呼び出し側は
 * `createRateLimiter` の戻り値の型ではなくこのインタフェースに依存する形にしてある。
 * 差し替え先の候補は Durable Object / KV / Valkey(INCR + EXPIRE)いずれでも、
 * `check` を async にするだけで同じ配線に載る。
 *
 * ## アルゴリズム
 *
 * 固定窓ではなくスライディングウィンドウ(キーごとに「窓内の試行時刻の配列」を持つ)。
 * 固定窓だと窓の境界をまたいで一瞬 2×max まで通せてしまうため、総当たり対策としては
 * スライディングの方が素直。max は 10〜120 程度と小さいので、配列を持つコストは無視できる。
 *
 * ブロックした試行は記録しない(記録すると攻撃者が叩き続ける限り窓が永久に空かず、
 * 同じ IP の正規利用者が延々締め出される)。
 */

import type { Context, MiddlewareHandler } from "hono";
import { getClientIp } from "./client-ip.js";

/** レート制限の判定結果。 */
export interface RateLimitResult {
  /** false ならこのリクエストは拒否する(429)。 */
  allowed: boolean;
  /** 拒否時、次に試せるまでの秒数(最低1)。許可時は 0。 */
  retryAfterSeconds: number;
}

/**
 * レート制限の最小インタフェース。将来 Durable Object / Valkey 実装へ差し替える際は、
 * これを満たす別実装を注入するだけで済むようにしてある(このファイル冒頭のコメント参照)。
 */
export interface RateLimiter {
  /** 1回の試行として記録し、許可/拒否を返す。拒否した試行はカウントに加えない。 */
  check(key: string): RateLimitResult;
}

export interface RateLimiterOptions {
  /** 窓の長さ(ミリ秒)。 */
  windowMs: number;
  /** 窓内に許可する最大試行回数。 */
  max: number;
  /**
   * 現在時刻(ミリ秒)を返す関数。既定は `Date.now`。
   * テストが窓の経過を実時間を待たずに再現するための注入点(タイマーを進める代わりに
   * この関数の戻り値を進める)。
   */
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, max } = options;
  const now = options.now ?? (() => Date.now());
  /** key -> 窓内に受理した試行の時刻(ミリ秒)。古い順に並ぶ。 */
  const hits = new Map<string, number[]>();
  /** 全キーの一括掃除を最後に行った時刻。掃除は最大でも窓1つぶんに1回しか走らせない。 */
  let lastSweepAt = now();

  /**
   * 使われなくなったキーを Map から落とす(遅延掃除)。毎リクエスト全走査すると
   * キー数に比例したコストが常時かかるので、窓1つぶんの間隔を空けてまとめて行う。
   * 攻撃時はキーが増え続けうるが、掃除の周期が窓と同じである以上、Map に残るのは
   * 「直近1窓ぶんに現れたキー」の規模に収まる。
   */
  function sweep(currentMs: number): void {
    if (currentMs - lastSweepAt < windowMs) return;
    lastSweepAt = currentMs;
    const threshold = currentMs - windowMs;
    for (const [key, timestamps] of hits) {
      const alive = timestamps.filter((t) => t > threshold);
      if (alive.length === 0) hits.delete(key);
      else hits.set(key, alive);
    }
  }

  return {
    check(key: string): RateLimitResult {
      const currentMs = now();
      sweep(currentMs);

      const threshold = currentMs - windowMs;
      const timestamps = (hits.get(key) ?? []).filter((t) => t > threshold);

      if (timestamps.length >= max) {
        // 最も古い試行が窓から出るまで待てば1回ぶん空く。
        // max <= 0(=全面拒否)のときは窓内に試行が1件も無いので、窓1つぶんを目安に返す。
        const oldest = timestamps[0];
        const waitMs = oldest === undefined ? windowMs : oldest + windowMs - currentMs;
        hits.set(key, timestamps);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }

      timestamps.push(currentMs);
      hits.set(key, timestamps);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** 15分。ログイン・トークン系エンドポイントの窓の既定値。 */
export const AUTH_WINDOW_MS = 15 * 60_000;

/**
 * レート制限の上限値(1箇所に集約して、運用中に調整しやすくしておく)。
 *
 * - `loginPerIpEmail` / `loginPerIp`: ログインは「IP+メール」と「IP のみ」の二段構え。
 *   前者は特定アカウントへの総当たりを、後者は多数のメールを試す横断的な総当たりを止める。
 * - `tokenPerIp`: 招待受諾・パスワードリセットのトークン経路(GET の検証も含む)。
 *   トークンは 32 バイト乱数なので推測は現実的でないが、レート制限は総当たりの費用を
 *   決定的に上げる安価な保険。
 * - `apiKeyPerIp`: 公開打刻 API(`Authorization: Bearer kzm_...`)のキー推測対策。
 *   IC カードリーダー等の常時接続クライアントを想定して 120回/分と大きめに取る。
 */
export const RATE_LIMITS = {
  loginPerIpEmail: { windowMs: AUTH_WINDOW_MS, max: 10 },
  loginPerIp: { windowMs: AUTH_WINDOW_MS, max: 30 },
  tokenPerIp: { windowMs: AUTH_WINDOW_MS, max: 20 },
  apiKeyPerIp: { windowMs: 60_000, max: 120 },
} as const;

/**
 * 429 レスポンス。
 *
 * ボディは `{ error: "rate_limited", retryAfterSeconds }` のみで、
 * **「そのメールアドレスが存在するか」は一切示さない**(存在しないメールでも同じ 429 になる)。
 * ログイン応答のユーザー列挙対策(routes/auth.ts の DUMMY_HASH)をレート制限で台無しに
 * しないための決まりごと。
 */
export function rateLimitedResponse(c: Context, retryAfterSeconds: number): Response {
  c.header("Retry-After", String(retryAfterSeconds));
  return c.json({ error: "rate_limited", retryAfterSeconds }, 429);
}

export interface IpRateLimitOptions {
  /** 前段プロキシ(Cloudflare Tunnel)のヘッダを信頼するか。lib/client-ip.ts 参照。 */
  trustProxy: boolean;
  /**
   * 真を返したリクエストだけを制限の対象にする(省略時は全リクエスト)。
   * 公開打刻 API のように「APIキー認証のリクエストだけ数えたい」場合に使う。
   */
  appliesTo?: (c: Context) => boolean;
}

/**
 * クライアント IP だけをキーにするレート制限ミドルウェア。
 * 招待受諾/パスワードリセットのトークン経路と、公開打刻 API のキー認証に使う。
 */
export function ipRateLimitMiddleware(limiter: RateLimiter, options: IpRateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    if (options.appliesTo && !options.appliesTo(c)) {
      await next();
      return;
    }
    const result = limiter.check(getClientIp(c, options.trustProxy));
    if (!result.allowed) return rateLimitedResponse(c, result.retryAfterSeconds);
    await next();
  };
}
