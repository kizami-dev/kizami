/**
 * システムメール(運用者名義の、テナントに属さないメール)の環境変数の解釈。
 *
 * 次の3つが**全部**揃っているとき「システムメールがある配備」になる:
 * `SYSTEM_SMTP_URL`(`smtp://` / `smtps://`)/ `SYSTEM_MAIL_FROM` / `APP_BASE_URL`(メール内リンクの組み立てに使う
 * Web のベース URL)。送信の実体は lib/system-mail.ts。
 *
 * ## なぜ signup-config から切り出したか(2026-10-04)
 *
 * 以前はセルフサインアップ(lib/signup-config.ts)の設定解析の中でこの3つを読んでいた。本人用の
 * 「パスワードを忘れた」再設定(routes/password-resets.ts)もシステムメールを使うが、**SIGNUP_MODE とは
 * 独立**に有効にしたい(セルフホストでサインアップは使わないが、システムメールだけは持つ配備が
 * あり得る)。そこで「システムメールの有無」の解析をここへ独立させ、signup はこれを使う側に回した。
 *
 * ## fail-fast はここでは行わない(判断点)
 *
 * このファイルは**判定材料を返すだけ**で、エラー終了はしない。
 * - 3つが揃っていなければ `config: null`(= システムメールなし。本人用の再設定は無効 = セルフホストの
 *   体験は変わらない)。何が欠けているかは `missing` で返す。
 * - 値はあるが形式が不正(`SYSTEM_SMTP_URL` のスキーム・`APP_BASE_URL` の形式)なら `errors` に入れ、
 *   `config` は null。
 * signup は有効なのに欠けている/不正なら起動時に落とす(lib/signup-config.ts の fail-fast、node.ts が担う。
 * 挙動は従来のまま)。本人用の再設定は「ある配備でだけ有効」なので落とさないが、node.ts は `errors` が
 * あれば警告を出す(設定したつもりで無効、を黙って放置しないため)。
 *
 * env を引数に取る純関数で、副作用(プロセス終了・nodemailer の生成)は持たない。nodemailer も
 * import しない(app.ts → routes/ の経路に Node 専用モジュールを持ち込まないため。Workers 対応)。
 */

/** システムメールに必須の環境変数。欠落の報告順もこの並びにする。 */
export const SYSTEM_MAIL_REQUIRED_ENV = ["SYSTEM_SMTP_URL", "SYSTEM_MAIL_FROM", "APP_BASE_URL"] as const;

export interface SystemMailEnvConfig {
  systemSmtpUrl: string;
  systemMailFrom: string;
  /** メール内リンクの組み立てに使う Web のベース URL(末尾スラッシュ無し) */
  appBaseUrl: string;
}

export interface SystemMailEnvResult {
  /** 3つが揃っていて形式も正しいときだけ非 null */
  config: SystemMailEnvConfig | null;
  /** 未設定(空白だけを含む)の変数名。`SYSTEM_MAIL_REQUIRED_ENV` の並び */
  missing: string[];
  /** 値はあるが形式が不正な変数についての説明 */
  errors: string[];
}

export type Env = Record<string, string | undefined>;

/** 値が設定されている(空白だけではない)か。 */
export function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

export function parseSystemMailEnv(env: Env): SystemMailEnvResult {
  const missing = SYSTEM_MAIL_REQUIRED_ENV.filter((name) => !present(env[name]));

  const errors: string[] = [];
  const smtpUrl = env.SYSTEM_SMTP_URL?.trim();
  if (smtpUrl && !/^smtps?:\/\//i.test(smtpUrl)) {
    errors.push("SYSTEM_SMTP_URL must start with smtp:// or smtps://");
  }
  const baseUrl = env.APP_BASE_URL?.trim();
  if (baseUrl && !/^https?:\/\/[^/\s]+/i.test(baseUrl)) {
    errors.push("APP_BASE_URL must be an absolute http(s) URL (e.g. https://app.kizami.dev)");
  }

  if (missing.length > 0 || errors.length > 0) return { config: null, missing, errors };

  return {
    config: {
      systemSmtpUrl: smtpUrl!,
      systemMailFrom: env.SYSTEM_MAIL_FROM!.trim(),
      appBaseUrl: baseUrl!.replace(/\/+$/, ""),
    },
    missing,
    errors,
  };
}
