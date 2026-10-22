/**
 * 環境変数からの設定読み込み(依頼: 「環境変数 KIZAMI_API_URL と KIZAMI_API_KEY を受け取る」)。
 */

export interface KizamiMcpConfig {
  apiUrl: string;
  apiKey: string;
}

export class ConfigError extends Error {}

/** 平文 http を許すホスト(ローカル開発用)。URL の hostname は IPv6 を角括弧付きで返す。 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * KIZAMI_API_URL を検証する。API キーを Bearer で送るため、平文 http で外部へ出すと
 * 経路上でキーが盗まれる。https か、ローカル(localhost / 127.0.0.1 / [::1])の http だけ許す。
 */
export function assertSafeApiUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`KIZAMI_API_URL がURLとして解釈できません: ${raw}`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return;
  throw new ConfigError(
    "KIZAMI_API_URL は https:// で始まるURLを指定してください(APIキーが平文で送られるのを防ぐため。localhost / 127.0.0.1 / [::1] のみ http:// を許可します)。",
  );
}

export function loadConfigFromEnv(env: Record<string, string | undefined> = process.env): KizamiMcpConfig {
  const apiUrl = env.KIZAMI_API_URL;
  const apiKey = env.KIZAMI_API_KEY;

  if (!apiUrl || apiUrl.trim() === "") {
    throw new ConfigError(
      "環境変数 KIZAMI_API_URL が設定されていません。KIZAMI API のベースURL(例: http://localhost:3001)を設定してください。",
    );
  }
  if (!apiKey || apiKey.trim() === "") {
    throw new ConfigError(
      "環境変数 KIZAMI_API_KEY が設定されていません。KIZAMI の「設定 > APIキー」で発行したキー(kzm_ から始まる文字列)を設定してください。",
    );
  }
  if (!apiKey.startsWith("kzm_")) {
    throw new ConfigError('KIZAMI_API_KEY の形式が不正です("kzm_" から始まる公開打刻APIキーを指定してください)。');
  }

  assertSafeApiUrl(apiUrl.trim());

  return { apiUrl: apiUrl.trim(), apiKey: apiKey.trim() };
}
