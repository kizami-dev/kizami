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

/**
 * 「失敗だけを数える」レート制限(2026-10-22 追加、セキュリティレビュー M3)。
 *
 * `RateLimiter` は**試行そのもの**を数える(成功も1回に数える)。アカウント単位の上限で
 * それをやると、本人の正しいログインまで枠を食い、攻撃者がいない時でも締め出しが起きうる。
 * こちらは「失敗しうる試行」を受け付けた時点で1回ぶんを**予約**し(`reserve`)、成功したら
 * その予約だけを返す(`release`)。失敗ならそのまま残り、失敗1回として数えられる。
 *
 * 判断点(先に予約する理由): 「判定(記録しない)→ 遅い検証(PBKDF2 / TOTP)→ 失敗なら記録」の順だと、
 * 同時に投げられた N 本のリクエストが記録より前に全部判定を通り、上限を超えて試せてしまう(TOCTOU)。
 * `reserve` は判定と記録を同期的に一度に行う(JS の単一スレッド上で割り込まれない)ので、
 * 検証中の試行も上限の内側で数えられる。
 *
 * `reset` はキーの記録を丸ごと消す。**キーを共有しうる相手の成功で消してはいけない**
 * (例: メール単位のキーは複数テナントの同じメールで共有される — 攻撃者が自分のテナントで
 * 同じメールのアカウントを作ってログインに成功し、被害者側の失敗を消せてしまう)。そういうキーでは
 * `release`(自分の予約だけ返す)を使う。
 *
 * 置き場所・アルゴリズムは `createRateLimiter` と同じ(プロセス/アイソレート内メモリの
 * スライディングウィンドウ。冒頭の判断点がそのまま当てはまる — Workers ではアイソレートごとの
 * カウンタになり、実効の上限は緩くなる)。差し替え先も同じく Durable Object / Valkey を想定し、
 * 呼び出し側はこのインタフェースにだけ依存する(Valkey なら INCR を予約、DECR を返却にできる)。
 */
export interface FailureReservation extends RateLimitResult {
  /**
   * この予約を含めて窓内の失敗(予約)が上限に達したか。`allowed: true` のときだけ意味がある
   * (失敗が確定したら、この試行で使い切ったことになる — 呼び出し側の後始末用)。
   */
  reachedLimit: boolean;
  /** 予約を取り消す(成功時)。2回目以降の呼び出し・拒否された予約では何もしない。 */
  release(): void;
}

export interface FailureLimiter {
  /**
   * 窓内の失敗(予約中を含む)が上限未満なら1回ぶんを予約して `allowed: true` を返す。
   * 上限に達していれば何も記録せず `allowed: false`(拒否した試行は数えない — 窓が永久に空かなくならないように)。
   */
  reserve(key: string): FailureReservation;
  /** そのキーの記録を丸ごと消す。キーがその本人だけのものである場合に限って使う(上の判断点)。 */
  reset(key: string): void;
}

export function createFailureLimiter(options: RateLimiterOptions): FailureLimiter {
  const { windowMs, max } = options;
  const now = options.now ?? (() => Date.now());
  /** key -> 窓内の失敗(予約)の時刻(ミリ秒)。古い順に並ぶ。 */
  const failures = new Map<string, number[]>();
  let lastSweepAt = now();

  /** createRateLimiter の sweep と同じ遅延掃除。 */
  function sweep(currentMs: number): void {
    if (currentMs - lastSweepAt < windowMs) return;
    lastSweepAt = currentMs;
    const threshold = currentMs - windowMs;
    for (const [key, timestamps] of failures) {
      const alive = timestamps.filter((t) => t > threshold);
      if (alive.length === 0) failures.delete(key);
      else failures.set(key, alive);
    }
  }

  const noop = () => {};

  return {
    reserve(key: string): FailureReservation {
      const currentMs = now();
      sweep(currentMs);
      const threshold = currentMs - windowMs;
      const timestamps = (failures.get(key) ?? []).filter((t) => t > threshold);

      if (timestamps.length >= max) {
        failures.set(key, timestamps);
        // 上限を割り込むには、古い方から (length - max + 1) 件が窓を出る必要がある。
        const pivot = timestamps[timestamps.length - max];
        const waitMs = pivot === undefined ? windowMs : pivot + windowMs - currentMs;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)), reachedLimit: true, release: noop };
      }

      timestamps.push(currentMs);
      failures.set(key, timestamps);
      let released = false;
      return {
        allowed: true,
        retryAfterSeconds: 0,
        reachedLimit: timestamps.length >= max,
        release(): void {
          if (released) return;
          released = true;
          const list = failures.get(key);
          if (!list) return;
          // 自分の予約(同じ時刻の1件)だけを外す。同時刻の別の予約と区別は付かないが、どれを外しても件数は同じ。
          const index = list.lastIndexOf(currentMs);
          if (index === -1) return;
          list.splice(index, 1);
          if (list.length === 0) failures.delete(key);
        },
      };
    },
    reset(key: string): void {
      failures.delete(key);
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
 * - `totpPerIpUser`: 二要素認証のコード検証(`ip|userId`)。ログイン第2段階(POST /auth/login/totp)と
 *   本人による有効化・無効化・リカバリコード再生成(routes/auth-totp.ts)で**同じインスタンス**を
 *   共有する。6桁は 100万通りしかなく、±1ステップの許容で受理窓が3つあるため、レート制限が
 *   無ければ総当たりが現実的な範囲に入る。ログイン(IP+メール)と同じ 10回/15分に揃える。
 * - `oidcPerIp`: OIDC(SSO)ログインの未認証3経路(start / callback / available)。
 *   start は任意の issuer への HTTP 送出、callback は ID トークンの持ち込み、available は
 *   メールアドレスの在籍照会の入口であり、いずれも総当たり・偵察の的になる。
 *   トークン経路と同じ 20回/15分に揃える(SSO ログインは1人あたり1日数回の操作のため十分)。
 * - `signupPerIp`: セルフサインアップの登録(POST /signup、2026-10-03 追加)。1回ごとに確認メールの
 *   送信と Turnstile の siteverify という外部への副作用が走り、PBKDF2 のハッシュ化も伴うので
 *   他より厳しい 5回/15分(正規の利用は「1回登録して確認するだけ」で、打ち間違いの再試行を
 *   見込んでも十分)。確認リンクの GET/POST(/signup/verify/*)は招待・リセットと同じ
 *   `tokenPerIp` を使う。判断点(NAT の巻き添え)は app.ts のトークン経路のコメントと同じ。
 * - `passwordChangePerIpUser`: ログイン中の本人によるパスワード変更(POST /auth/password/change、
 *   `ip|userId`、2026-10-04 追加)。現在のパスワードの照合を伴うので、盗まれたセッションからの総当たり
 *   (現在のパスワード当て)の的になる。`totpPerIpUser`(2FA の無効化等も現在のパスワードを要求する)と
 *   同じ 10回/15分に揃える。別のインスタンスにしてあり(共有しない)、2FA 側の枠を食わない。
 * - `passwordResetRequestPerIp`: 本人用「パスワードを忘れた」の要求(POST /password-resets、2026-10-04 追加)。
 *   1回ごとに Turnstile の siteverify・DB 書き込み・システムメール送信という副作用が走るので、
 *   サインアップの登録(`signupPerIp`)と同じ 5回/15分。メール単位の 5 分スロットルはこれとは別
 *   (db の password_reset_requests、IP を変えても効く)。受諾画面のリンク(GET/POST /password-resets/:token/*)は
 *   従来どおり `tokenPerIp`。
 *
 * 以下3つは「失敗だけを数える」`FailureLimiter` 用(2026-10-22 追加、セキュリティレビュー M3。
 * IP を変えながらの総当たりに IP 単位の上限が効かない問題への対策)。いずれも IP をキーに含めない。
 *
 * - `loginFailuresPerAccount`: パスワードログインの**失敗**を、正規化したメール(小文字化)単位で数える。
 *   20回/15分を超えたら、IP を問わずそのメールへのログインを 429 にする(正しいパスワードでも)。
 *   - キーはメールのみで、リクエストの tenantId は**含めない**(tenantId はクライアントが自由に付け外し
 *     できる値なので、含めるとバケツを増やして上限を倍化できてしまう)。
 *   - アカウントの実在に関係なく同じように数え、同じ 429 を返す(実在の判定材料にしない)。
 *   - 上限を IP+メール(10回)より大きい 20回にしてあるのは、**1つの IP だけではアカウントを
 *     ロックできない**ようにするため(社内 NAT の向こうで誰かが打ち間違いを続けても、他の場所からの
 *     本人のログインは止まらない)。IP を回す攻撃者には 15分あたり 20回(1日 1,920回)が上限になる。
 *   - 試行を受け付けた時点で1回ぶんを予約し、パスワードが一致したらその予約だけを返す(成功は数えない)。
 *     **過去の失敗は成功しても消さない** — メールは複数テナントで共有されうるので、攻撃者が自分のテナントに
 *     同じメールのアカウントを作ってログインに成功し、被害者の失敗を消すことができてしまうため。
 *   - 判断点(締め出し): 攻撃者が意図的に失敗を送り続ければ、被害者は最長 15分ずつ締め出されうる。
 *     恒久ロック(管理者解除が必要な方式)は採らず、窓が空けば自然に戻る方式にして DoS の影響を抑える。
 * - `loginFailuresPerTrustedDevice`: 上の締め出しの緩和(auth/trusted-device.ts)。以前このメールで最後まで
 *   ログインできた端末の封をした Cookie(`kizami_trusted_device`)を持つリクエストは、共有のメール単位のバケツの
 *   代わりに端末ごと(`trusted|tenantId|userId|issuedAt`)に数える。攻撃者がメール単位のバケツを埋めても、本人は
 *   いつもの端末から入れる。1つのブラウザの打ち間違いには IP+メールと同じ 10回/15分で十分で、盗まれた Cookie で
 *   総当たりされても 15分 10回に抑えられる。指数的に待たせる(バックオフ)はしない — 締め出しを長引かせるだけなので。
 * - `totpFailuresPerTx`: ログイン第2段階(POST /auth/login/totp)の**1つの中間状態(tx Cookie)あたり**の
 *   コード/リカバリコードの失敗回数。5回失敗したらその tx は無効になり、パスワードからやり直し
 *   (401 totp_expired)。Cookie は暗号化されたステートレスな値で書き換えられないため、
 *   `tenantId|userId|issuedAt` をキーにサーバー側で数える。窓は tx の寿命(5分)より長い 10分。
 *   issuedAt は分単位なので、同じ分に発行された tx 同士は枠を共有する(厳しい側に倒れるだけ)。
 * - `totpFailuresPerUser`: 同じく第2段階の失敗をユーザー単位(`tenantId|userId`、IP を問わない)で数える。
 *   10回/15分で 429。パスワードを知る攻撃者が tx を取り直し・IP を回しても、6桁の試行は
 *   15分あたり 10回に抑えられる。キーはそのユーザーだけのものなので、第2要素が通ったら reset する。
 * - 2つの TOTP 用も、検証の前に予約する(同時に投げて上限を超えさせない。FailureLimiter の判断点)。
 */
export const RATE_LIMITS = {
  loginPerIpEmail: { windowMs: AUTH_WINDOW_MS, max: 10 },
  loginPerIp: { windowMs: AUTH_WINDOW_MS, max: 30 },
  totpPerIpUser: { windowMs: AUTH_WINDOW_MS, max: 10 },
  tokenPerIp: { windowMs: AUTH_WINDOW_MS, max: 20 },
  apiKeyPerIp: { windowMs: 60_000, max: 120 },
  oidcPerIp: { windowMs: AUTH_WINDOW_MS, max: 20 },
  signupPerIp: { windowMs: AUTH_WINDOW_MS, max: 5 },
  passwordChangePerIpUser: { windowMs: AUTH_WINDOW_MS, max: 10 },
  passwordResetRequestPerIp: { windowMs: AUTH_WINDOW_MS, max: 5 },
  loginFailuresPerAccount: { windowMs: AUTH_WINDOW_MS, max: 20 },
  loginFailuresPerTrustedDevice: { windowMs: AUTH_WINDOW_MS, max: 10 },
  totpFailuresPerTx: { windowMs: 10 * 60_000, max: 5 },
  totpFailuresPerUser: { windowMs: AUTH_WINDOW_MS, max: 10 },
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
