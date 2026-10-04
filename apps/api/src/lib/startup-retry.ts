/**
 * 起動時の DB 接続(マイグレーション)を、一時的なネットワーク失敗に限って再試行する(2026-10-05 追加、v0.8.1)。
 *
 * ## なぜ要るか
 *
 * KIZAMI Cloud(k8s + PostgreSQL)では、Pod の起動直後の数秒間、クラスタ DNS への問い合わせが
 * `EAI_AGAIN` で失敗することがある(CoreDNS が別ノードにあり、Pod のネットワークが整う前に
 * 最初の名前解決が走るため)。api はマイグレーションに失敗すると終了し、k8s の再起動で回復するが、
 * 入れ替えのたびに1回落ちるのはノイズで、再起動の待ち時間(バックオフ)だけ切り替えも遅れる。
 *
 * ## どこまで待つか(判断点)
 *
 * - 再試行するのは「待てば直る」種類の失敗だけ(名前解決の一時失敗・接続拒否・タイムアウト・
 *   PostgreSQL の起動中応答)。認証失敗やマイグレーションの SQL エラーは即座に投げる —
 *   待っても直らず、再試行で原因のログが埋もれるだけなので。
 * - 合計の待ち時間は既定で約30秒。それでも駄目なら投げて、プロセスの終了と k8s の再起動に任せる
 *   (worker.ts の「起動失敗は確実に終了する」と同じ方針)。
 * - SQLite(ファイル DB)は接続失敗がそもそも起きないので、この関数を通しても1回で抜ける。
 *
 * DB 層(`migrateDb`)ではなく起動処理の側に置いているのは、テストや CLI(seed・operator)では
 * 接続できなければすぐ失敗してほしいため。
 */

/** 再試行してよい(待てば直る)エラーコード。Node のシステムエラーと PostgreSQL の SQLSTATE。 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "EAI_AGAIN", // 名前解決の一時失敗
  "ENOTFOUND", // 名前が(まだ)引けない — Service の作成直後など
  "ECONNREFUSED", // 接続先がまだ待ち受けていない
  "ECONNRESET",
  "ETIMEDOUT",
  "57P03", // cannot_connect_now(PostgreSQL の起動・復旧中)
]);

/**
 * エラーが「待てば直る」接続の失敗かを判定する。Drizzle はドライバのエラーを `cause` に包んで
 * 投げる(`DrizzleQueryError` → `cause: Error: getaddrinfo EAI_AGAIN ...`)ので、cause を辿る。
 */
export function isTransientConnectError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface StartupRetryOptions {
  /** 試行回数の上限(初回を含む)。既定 10 */
  attempts?: number;
  /** 1回目の待ち時間(ミリ秒)。以降は倍々で、maxDelayMs で頭打ち。既定 500 */
  baseDelayMs?: number;
  /** 待ち時間の上限(ミリ秒)。既定 5000 */
  maxDelayMs?: number;
  /** 再試行のたびに呼ぶ(ログ用)。既定は console.warn */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** テスト用の待機関数 */
  sleep?: (ms: number) => Promise<void>;
}

/** `fn` を実行し、一時的な接続失敗なら待って再試行する。それ以外の失敗と上限超えはそのまま投げる。 */
export async function withStartupRetry<T>(fn: () => Promise<T>, options: StartupRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 10;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const onRetry =
    options.onRetry ??
    (({ attempt, delayMs, error }) => {
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.warn(`[kizami] database not reachable yet (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms: ${reason}`);
    });

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isTransientConnectError(error)) throw error;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      onRetry({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
