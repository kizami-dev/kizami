/**
 * エラー報告(Sentry プロトコル互換)。設計は docs/design/observability.md。
 *
 * 想定する送り先は **セルフホストの受け口**(sentry-relay → GlitchTip / Bugsink)。
 * Sentry SaaS でも同じ DSN 形式で動くが、KIZAMI 本体は AGPL のセルフホスト製品なので
 * 「外部 SaaS へ既定で何かを送る」ことはしない — `SENTRY_DSN` 未設定なら完全な no-op。
 *
 * ## 判断点: @sentry/node を使わない(2026-08-27)
 *
 * - @sentry/node は `http` / `https` / `async_hooks` などのグローバルにパッチを当てる。
 *   打刻という監査対象の処理系に、観測のためだけにそこまで踏み込ませたくない
 * - 依存が重い(推移的に数十パッケージ)。KIZAMI は Compose 一発で動く配布物であることを
 *   優先しており、`node_modules` を膨らませる判断は慎重にしたい
 * - workerd でも同じコードを動かしたい(要件 §8)。SDK のランタイム分岐に付き合うより、
 *   必要な機能(例外1件を store API へ POST する)だけを自前で持つほうが小さい
 *
 * 逆に**やらないこと**を明示しておく: パフォーマンス計測(traces)、ブレッドクラム、
 * セッション追跡、ソースマップのアップロード、自動のグローバル例外フック。必要になったら
 * そのとき改めて SDK の導入を検討する。
 *
 * ## 送信のかたち
 *
 * - store API(`POST <origin>/api/<projectId>/store/`)に JSON を1件 POST する。
 *   envelope API ではなく store API を使うのは、GlitchTip / Bugsink / sentry-relay の
 *   いずれもが受けられる最小公倍数だから
 * - **gzip しない**(`Content-Encoding` を付けない)。判断点: 筆者の自前 sentry-relay は
 *   gzip されたペイロードを取りこぼすバグを踏んだ実績があり(2026-06)、イベント1件は
 *   高々数 KB で圧縮の利得がほぼ無い。壊れやすさと引き換えにする価値がない
 * - **撃ちっ放し**(fire-and-forget)。`capture()` は同期に戻り、送信は 3秒でタイムアウトする。
 *   送信に失敗しても呼び出し元には伝えない(エラー報告の失敗でリクエストを壊さない)
 *
 * ## プライバシー(この実装の要)
 *
 * イベントに載せてよいのは次だけ。増やすときは docs/design/observability.md の
 * 「エラー報告に載せないもの」を必ず更新すること。
 *
 * - 例外の type / message / スタックトレース(コードに書かれた文字列)
 * - `route`(**ルートパターン**。`/punches/:id` であって `/punches/019abc…` ではない)と method
 * - `tenant`(テナントID の SHA-256 先頭8桁**のみ**。生の ID は決して載せない)
 * - `runtime` / `release` / `server_name` / `environment`
 *
 * 載せないもの: **リクエストボディ・クエリ文字列・ヘッダ・Cookie・メールアドレス・
 * ユーザーID・氏名・打刻の位置情報**。`request` / `user` / `breadcrumbs` フィールドは
 * そもそも組み立てない(「うっかり入る」余地を型ごと消してある)。
 */

/** DSN を分解した結果。 */
export interface SentryDsn {
  /** イベントの POST 先(store API の URL、末尾スラッシュ付き) */
  storeUrl: string;
  /** DSN のユーザー名部分(公開キー) */
  publicKey: string;
  /** 旧形式 DSN の `key:secret@` の secret 部分。無ければ undefined */
  secretKey?: string;
  /** プロジェクトID(DSN パスの最後の要素) */
  projectId: string;
}

/**
 * Sentry DSN(`https://<publicKey>@<host>[/<path>]/<projectId>`)を分解する。
 * 形式が不正なら null(呼び出し側は「エラー報告を無効化する」と解釈する)。
 *
 * セルフホストの受け口はサブパス配下に置かれることがある
 * (例 `https://key@relay.example.com/sentry/42` → `/sentry/api/42/store/`)ので、
 * プロジェクトIDより前のパスは prefix としてそのまま残す。
 */
export function parseSentryDsn(dsn: string): SentryDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const publicKey = url.username;
  if (publicKey === "") return null;

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const projectId = segments.pop();
  if (projectId === undefined) return null;

  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return {
    storeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/store/`,
    publicKey,
    ...(url.password !== "" ? { secretKey: url.password } : {}),
    projectId,
  };
}

/** スタックトレースの1フレーム(Sentry のインタフェース定義に合わせた最小形)。 */
export interface SentryFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  /** node_modules / ランタイム内部でなければ true */
  in_app: boolean;
}

/** 送信するイベント本体(store API のペイロード)。 */
export interface SentryEvent {
  event_id: string;
  /** Unix エポック秒(小数可) */
  timestamp: number;
  platform: string;
  level: "error";
  logger: string;
  release?: string;
  server_name?: string;
  environment?: string;
  /** `GET /punches/:id` のようなルート識別子(生パスではない) */
  transaction?: string;
  tags: Record<string, string>;
  exception: {
    values: {
      type: string;
      value: string;
      stacktrace?: { frames: SentryFrame[] };
    }[];
  };
}

/** `capture()` に添える文脈。**ここに生のパスやユーザー情報を渡さないこと**。 */
export interface ErrorReportContext {
  /** HTTP メソッド */
  method?: string;
  /** ルートパターン(`c.req.routePath`。生パスではない) */
  route?: string;
  /** ワーカーのスキャン名(apps/api/src/worker.ts) */
  job?: string;
  /** テナントID。**そのままは送らない** — SHA-256 の先頭8桁だけをタグ `tenant` にする */
  tenantId?: string;
}

/** エラー報告の口。DSN 未設定の場合も同じ型の no-op 実装が返る。 */
export interface ErrorReporter {
  /** 例外を1件報告する(同期に戻る。送信は撃ちっ放し) */
  capture(error: unknown, context?: ErrorReportContext): void;
}

/** `createErrorReporter` のオプション。 */
export interface ErrorReporterOptions {
  /** `SENTRY_DSN`。undefined / 空文字なら no-op レポーターになる */
  dsn: string | undefined;
  /** リリース版(タグ `release` と `release` フィールド)。 */
  release?: string;
  /** `server_name`(どのインスタンスからの報告か)。 */
  serverName?: string;
  /** `environment`(production / staging 等)。 */
  environment?: string;
  /** タグ `runtime`("node" / "workerd")。既定 "node"。 */
  runtime?: string;
  /** 送信関数の注入点(テストは偽の fetch を渡す)。既定 `globalThis.fetch`。 */
  fetchFn?: typeof fetch;
  /** 時刻源(ミリ秒)。既定 `Date.now`。 */
  now?: () => number;
  /** 同一シグネチャを再送しない窓(ミリ秒)。既定 60000。 */
  dedupeWindowMs?: number;
  /** 送信のタイムアウト(ミリ秒)。既定 3000。 */
  timeoutMs?: number;
  /** 窓あたりに送る上限件数(異なるエラーが大量に出た場合の保険)。既定 30。 */
  maxEventsPerWindow?: number;
  /** `event_id`(ハイフン無し32桁の16進)の生成。既定は `crypto.randomUUID()` から作る。 */
  generateEventId?: () => string;
}

/** 何もしないレポーター(`SENTRY_DSN` 未設定時)。 */
export const noopErrorReporter: ErrorReporter = { capture: () => undefined };

/** メッセージ・フレーム数の上限(1イベントを数 KB に収める)。 */
const MAX_VALUE_LENGTH = 512;
const MAX_FRAMES = 30;

/** `at fn (file:line:col)` / `at file:line:col` の両方を拾う。 */
const STACK_LINE = /^\s*at\s+(?:(?<fn>.+?)\s+\()?(?<file>.+?):(?<line>\d+):(?<col>\d+)\)?\s*$/;

/**
 * `Error.stack` をベストエフォートで解析する。
 *
 * 解析できない行は黙って捨てる(V8 以外のフォーマットや `at <anonymous>` など)。
 * 戻り値は Sentry の規約どおり**古いフレームが先頭**(例外が起きた場所が末尾)。
 */
export function parseStackFrames(stack: string | undefined): SentryFrame[] {
  if (stack === undefined) return [];
  const frames: SentryFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = STACK_LINE.exec(line);
    const groups = match?.groups;
    if (!groups) continue;
    const filename = groups.file ?? "";
    const fn = groups.fn;
    frames.push({
      filename,
      ...(fn !== undefined ? { function: fn } : {}),
      lineno: Number(groups.line),
      colno: Number(groups.col),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  // 例外に近い順(V8 の並び)で来るので、末尾が最古。Sentry は逆順を期待する。
  // 長すぎるスタックは**新しい側**を残す(原因に近いのはそちら)。
  return frames.slice(0, MAX_FRAMES).reverse();
}

/** 未知の値から `{ type, value, stack }` を取り出す(Error でない値も投げられるため)。 */
export function describeError(error: unknown): { type: string; value: string; stack: string | undefined } {
  if (error instanceof Error) {
    return {
      type: error.name === "" ? "Error" : error.name,
      value: truncate(error.message),
      stack: error.stack,
    };
  }
  if (typeof error === "string") return { type: "Error", value: truncate(error), stack: undefined };
  // オブジェクトを JSON.stringify するとリクエストボディ等が紛れ込みかねないので、型名だけにする
  return { type: "Error", value: `non-Error thrown: ${typeof error}`, stack: undefined };
}

function truncate(value: string): string {
  return value.length <= MAX_VALUE_LENGTH ? value : `${value.slice(0, MAX_VALUE_LENGTH)}…`;
}

/** 重複判定に使うシグネチャ(type + message + 最も原因に近いフレーム)。 */
export function eventSignature(type: string, value: string, frames: SentryFrame[]): string {
  const top = frames.at(-1);
  const location = top === undefined ? "-" : `${top.filename}:${top.lineno ?? 0}`;
  return `${type}|${value}|${location}`;
}

/** テナントID → タグに載せる 8桁の16進(SHA-256 の先頭4バイト)。 */
export async function tenantTag(tenantId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tenantId));
  return [...new Uint8Array(digest).slice(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 既定の event_id 生成(ハイフン無し32桁)。 */
function defaultEventId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * エラー報告レポーターを作る。`dsn` が未設定 / 解析不能なら `noopErrorReporter` を返す
 * (呼び出し側は分岐せずに `reporter.capture(...)` を書ける)。
 */
export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  if (options.dsn === undefined || options.dsn.trim() === "") return noopErrorReporter;
  const parsed = parseSentryDsn(options.dsn.trim());
  if (parsed === null) {
    console.warn("[error-report] SENTRY_DSN の形式が不正です。エラー報告を無効化します");
    return noopErrorReporter;
  }
  // 型注釈を付けた const に移して null を落とす(下の send() クロージャからも非 null で見える)
  const dsn: SentryDsn = parsed;

  const now = options.now ?? (() => Date.now());
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const dedupeWindowMs = options.dedupeWindowMs ?? 60_000;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const maxEventsPerWindow = options.maxEventsPerWindow ?? 30;
  const generateEventId = options.generateEventId ?? defaultEventId;
  const runtime = options.runtime ?? "node";
  const platform = runtime === "node" ? "node" : "javascript";

  /** シグネチャ -> 最後に送った時刻(ミリ秒)。窓を跨いだものは送信のたびに掃除する。 */
  const lastSentAt = new Map<string, number>();
  /** 現在の窓の開始時刻と、その窓で送った件数(異種エラーの嵐に対する保険)。 */
  let windowStartedAt = now();
  let sentInWindow = 0;

  const authHeader = [
    "Sentry sentry_version=7",
    `sentry_client=kizami/${options.release ?? "unknown"}`,
    `sentry_key=${dsn.publicKey}`,
    ...(dsn.secretKey !== undefined ? [`sentry_secret=${dsn.secretKey}`] : []),
  ].join(", ");

  return {
    capture(error: unknown, context?: ErrorReportContext): void {
      const currentMs = now();

      // 窓の更新と、窓あたりの上限。上限を超えたぶんは静かに捨てる
      // (エラーの嵐で送信キューが積み上がってプロセスを潰すことを防ぐのが目的)。
      if (currentMs - windowStartedAt >= dedupeWindowMs) {
        windowStartedAt = currentMs;
        sentInWindow = 0;
        for (const [key, at] of lastSentAt) {
          if (currentMs - at >= dedupeWindowMs) lastSentAt.delete(key);
        }
      }

      const { type, value, stack } = describeError(error);
      const frames = parseStackFrames(stack);
      const signature = eventSignature(type, value, frames);

      const previous = lastSentAt.get(signature);
      if (previous !== undefined && currentMs - previous < dedupeWindowMs) return;
      if (sentInWindow >= maxEventsPerWindow) return;

      lastSentAt.set(signature, currentMs);
      sentInWindow += 1;

      const transaction = buildTransaction(context);
      const event: SentryEvent = {
        event_id: generateEventId(),
        timestamp: currentMs / 1000,
        platform,
        level: "error",
        logger: "kizami",
        ...(options.release !== undefined ? { release: options.release } : {}),
        ...(options.serverName !== undefined ? { server_name: options.serverName } : {}),
        ...(options.environment !== undefined ? { environment: options.environment } : {}),
        ...(transaction !== undefined ? { transaction } : {}),
        tags: {
          runtime,
          release: options.release ?? "unknown",
          ...(context?.route !== undefined ? { route: context.route } : {}),
          ...(context?.job !== undefined ? { job: context.job } : {}),
        },
        exception: {
          values: [
            {
              type,
              value,
              ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
            },
          ],
        },
      };

      // 撃ちっ放し。await しない・例外を外へ出さない(報告の失敗で本体を壊さない)。
      void send(event, context?.tenantId).catch(() => undefined);
    },
  };

  async function send(event: SentryEvent, tenantId: string | undefined): Promise<void> {
    if (tenantId !== undefined) {
      try {
        event.tags.tenant = await tenantTag(tenantId);
      } catch {
        // ハッシュが取れない環境ではタグごと諦める(生の ID は絶対に載せない)
      }
    }
    try {
      const response = await fetchFn(dsn.storeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": authHeader,
          // gzip しない(冒頭コメント「送信のかたち」)。明示しておくことで
          // 中継が Content-Encoding を推測して壊すことも避ける。
          "Content-Encoding": "identity",
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        console.warn(`[error-report] 送信に失敗しました (status=${response.status})`);
      }
    } catch {
      // ネットワーク断・タイムアウト。ログも出さない
      // (受け口が落ちている間、報告のたびにログを吐くと本来のログが埋まるため)
    }
  }
}

/** `GET /punches/:id` の形。ワーカー起因なら `scan <job>`。どちらも無ければ undefined。 */
function buildTransaction(context: ErrorReportContext | undefined): string | undefined {
  if (context?.route !== undefined) {
    return context.method === undefined ? context.route : `${context.method} ${context.route}`;
  }
  if (context?.job !== undefined) return `scan ${context.job}`;
  return undefined;
}

/**
 * 環境変数からレポーターを組み立てる(buildVapidFromEnv / buildEncryptorFromEnv と同じ流儀)。
 *
 * - `SENTRY_DSN`: 未設定なら no-op(既定の状態なので警告も出さない)
 * - `SENTRY_SERVER_NAME`: 省略時 `HOSTNAME`(k8s / Compose が Pod 名・コンテナ名を入れる)
 * - `SENTRY_ENVIRONMENT`: 省略時 `NODE_ENV`
 */
export function buildErrorReporterFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: { release?: string; runtime?: string } = {},
): ErrorReporter {
  const serverName = env.SENTRY_SERVER_NAME ?? env.HOSTNAME;
  const environment = env.SENTRY_ENVIRONMENT ?? env.NODE_ENV;
  return createErrorReporter({
    dsn: env.SENTRY_DSN,
    ...(options.release !== undefined ? { release: options.release } : {}),
    ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
    ...(serverName !== undefined ? { serverName } : {}),
    ...(environment !== undefined ? { environment } : {}),
  });
}
