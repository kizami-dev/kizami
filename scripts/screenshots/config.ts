/**
 * `pnpm screenshots` の共通設定(ポート・パス・デモ認証情報)。
 *
 * ポートは実開発(3000/3001)・docsサーバ等と衝突しにくい番号を選んでいる。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "../..");

export const API_PORT = 47411;
export const WEB_PORT = 47412;
export const API_BASE_URL = `http://localhost:${API_PORT}`;
export const WEB_BASE_URL = `http://localhost:${WEB_PORT}`;

export const ADMIN_EMAIL = "admin@kizami.example";
export const ADMIN_PASSWORD = "kizami-demo-pass";
export const TENANT_NAME = "サンプル商事株式会社";

export const OUTPUT_DIR = path.join(ROOT_DIR, "docs", "public", "screenshots");

/** 撮影1回ごとに使い捨てる一時ディレクトリ(SQLiteファイル・各種ログ置き場)。 */
export function makeRunDir(): string {
  return mkdtempSync(path.join(tmpdir(), "kizami-screenshots-"));
}

/** node:crypto を使わず WebCrypto だけで 32byte の base64 鍵を作る(apps/api と同じ思想)。 */
export function randomEncryptionKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
