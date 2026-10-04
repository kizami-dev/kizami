/**
 * Cloudflare Turnstile のサーバー側検証(siteverify)。
 *
 * セルフサインアップ(routes/signup.ts)は未認証で開放され、確認メールを送るという副作用を
 * 持つ。メール爆撃・登録の濫用への歯止めとして、IP レート制限に加えて Turnstile を必須にしている。
 *
 * - 検証は必ずサーバーで行う(ウィジェットのトークンをクライアントの申告だけで信用しない)
 * - `remoteip` にはレート制限と同じクライアント IP(lib/client-ip.ts)を付ける。取れなかった
 *   ("unknown")ときは付けない(任意項目)
 * - `fetch` は注入可能(テストが Cloudflare に出ていかないため)。既定は globalThis.fetch
 * - 通信失敗・5xx は「検証できなかった」(`unavailable`)として、トークン不正(`failed`)と区別する。
 *   前者は 503、後者は 400 で返す(利用者が直せるのは後者だけ)
 *
 * 開発・テストの鍵は Cloudflare 公式のテスト用ダミーを使う(docs/design/saas.md の環境変数表):
 * site key `1x00000000000000000000AA`(常に通る)、secret key `1x0000000000000000000000000000000AA`
 * (常に成功)/ `2x0000000000000000000000000000000AA`(常に失敗)。
 */

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = { ok: true } | { ok: false; reason: "failed" | "unavailable" };

export interface VerifyTurnstileParams {
  secret: string;
  /** ウィジェットが発行したトークン(フォームの `cf-turnstile-response`) */
  token: string;
  remoteIp?: string;
  fetchFn?: typeof fetch;
}

const VERIFY_TIMEOUT_MS = 5_000;

export async function verifyTurnstile(params: VerifyTurnstileParams): Promise<TurnstileResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const form = new URLSearchParams({ secret: params.secret, response: params.token });
  if (params.remoteIp !== undefined && params.remoteIp !== "" && params.remoteIp !== "unknown") {
    form.set("remoteip", params.remoteIp);
  }

  let res: Response;
  try {
    res = await fetchFn(TURNSTILE_VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
  } catch (err) {
    console.error("turnstile: siteverify request failed:", err);
    return { ok: false, reason: "unavailable" };
  }
  if (!res.ok) {
    console.error(`turnstile: siteverify returned HTTP ${res.status}`);
    return { ok: false, reason: "unavailable" };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const success = typeof body === "object" && body !== null && (body as { success?: unknown }).success === true;
  return success ? { ok: true } : { ok: false, reason: "failed" };
}

export interface TurnstileEnvConfig {
  secretKey: string;
  siteKey: string;
}

/**
 * 環境変数 `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` の**両方**が設定されていれば設定を返し、
 * どちらかが欠けていれば null(= Turnstile を使わない)。本人用パスワード再設定(routes/password-resets.ts)が
 * 「キーが設定されている配備では必須、無ければ不要」の判定に使う。サインアップはこれとは別に、
 * 有効なのに欠けていれば起動時に落とす(lib/signup-config.ts)。
 */
export function parseTurnstileEnv(env: Record<string, string | undefined>): TurnstileEnvConfig | null {
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  if (!secretKey || !siteKey) return null;
  return { secretKey, siteKey };
}
