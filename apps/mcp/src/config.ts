/**
 * 環境変数からの設定読み込み(依頼: 「環境変数 KIZAMI_API_URL と KIZAMI_API_KEY を受け取る」)。
 */

export interface KizamiMcpConfig {
  apiUrl: string;
  apiKey: string;
}

export class ConfigError extends Error {}

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

  return { apiUrl: apiUrl.trim(), apiKey: apiKey.trim() };
}
