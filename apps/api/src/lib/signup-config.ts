/**
 * セルフサインアップ(KIZAMI Cloud、docs/design/saas.md「サインアップ」)の環境変数の解釈。
 *
 * - `SIGNUP_MODE`: 未設定/空/`off`(既定)= 無効、`invite` = 招待コード必須、`open` = 自由登録。
 *   無効のとき signup 系エンドポイントは `GET /signup/config` 以外すべて 404 で、
 *   セルフホストの体験を一切変えない。
 * - 有効にするなら次の5つが**全部**要る: `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` /
 *   `SYSTEM_SMTP_URL` / `SYSTEM_MAIL_FROM` / `APP_BASE_URL`。
 *
 * ## fail-fast(判断点)
 *
 * 有効なのに設定が欠けていると、登録フォームは見えるのに確認メールが出ない(= 誰も登録を完了
 * できない)とか、Turnstile が検証できず全員弾かれる、といった「動いているように見えて実は
 * 動かない」状態になる。公開サービスでそれに気づくのは利用者の問い合わせより後になるので、
 * 起動時に**欠けている変数名を明示してエラー終了**させる(node.ts)。`SIGNUP_MODE` の綴り間違い
 * (`Invite` や `enabled` 等)も黙って off 扱いにすると「有効にしたつもりで無効」になるため、
 * 不明な値は同じくエラーにする。
 *
 * このファイルは env を引数に取る純関数で、副作用(プロセス終了・nodemailer の生成)は持たない
 * (ユニットテストできるようにするため。終了は node.ts が担う)。nodemailer も import しない
 * (app.ts → routes/signup.ts の経路に Node 専用モジュールを持ち込まないため。Workers 対応)。
 */

export type SignupMode = "off" | "invite" | "open";

/** 有効時に必須の環境変数。欠落の報告順もこの並びにする。 */
export const SIGNUP_REQUIRED_ENV = [
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_SITE_KEY",
  "SYSTEM_SMTP_URL",
  "SYSTEM_MAIL_FROM",
  "APP_BASE_URL",
] as const;

/** 有効化されたサインアップの設定(送信関数・fetch の注入は createApp 側で足す)。 */
export interface SignupEnvConfig {
  mode: "invite" | "open";
  turnstileSecretKey: string;
  turnstileSiteKey: string;
  systemSmtpUrl: string;
  systemMailFrom: string;
  /** 確認リンクの組み立てに使う Web のベース URL(末尾スラッシュ無し) */
  appBaseUrl: string;
}

export type SignupEnvResult =
  | { ok: true; config: SignupEnvConfig | null }
  | { ok: false; errors: string[] };

type Env = Record<string, string | undefined>;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/**
 * 環境変数から設定を解釈する。
 *
 * - off(既定)なら `{ ok: true, config: null }`(他の変数は見ない)
 * - 有効なら必須変数の欠落・SYSTEM_SMTP_URL のスキーム・APP_BASE_URL の形式を検証し、
 *   問題を**すべて**列挙して返す(1つ直すたびに再起動して次のエラーを見る、を避ける)
 */
export function parseSignupEnv(env: Env): SignupEnvResult {
  const rawMode = (env.SIGNUP_MODE ?? "").trim().toLowerCase();
  if (rawMode === "" || rawMode === "off") return { ok: true, config: null };
  if (rawMode !== "invite" && rawMode !== "open") {
    return { ok: false, errors: [`SIGNUP_MODE must be one of "off", "invite", "open" (got "${env.SIGNUP_MODE}")`] };
  }

  const errors: string[] = [];
  const missing = SIGNUP_REQUIRED_ENV.filter((name) => !present(env[name]));
  if (missing.length > 0) {
    errors.push(`SIGNUP_MODE=${rawMode} requires these environment variables, but they are missing: ${missing.join(", ")}`);
  }

  const smtpUrl = env.SYSTEM_SMTP_URL?.trim();
  if (smtpUrl && !/^smtps?:\/\//i.test(smtpUrl)) {
    errors.push("SYSTEM_SMTP_URL must start with smtp:// or smtps://");
  }
  const baseUrl = env.APP_BASE_URL?.trim();
  if (baseUrl && !/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
    errors.push("APP_BASE_URL must be an absolute http(s) URL (e.g. https://app.kizami.dev)");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    config: {
      mode: rawMode,
      turnstileSecretKey: env.TURNSTILE_SECRET_KEY!.trim(),
      turnstileSiteKey: env.TURNSTILE_SITE_KEY!.trim(),
      systemSmtpUrl: smtpUrl!,
      systemMailFrom: env.SYSTEM_MAIL_FROM!.trim(),
      appBaseUrl: baseUrl!.replace(/\/+$/, ""),
    },
  };
}
