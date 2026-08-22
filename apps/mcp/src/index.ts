#!/usr/bin/env node
/**
 * KIZAMI MCP サーバーのエントリポイント。stdio で待ち受ける
 * (Claude Desktop / Claude Code のようなローカルクライアントがこのプロセスを子プロセスとして
 * 起動し、標準入出力で JSON-RPC をやり取りする。リモート接続は将来の課題)。
 *
 * 設定は環境変数のみ(KIZAMI_API_URL, KIZAMI_API_KEY)。詳細は README.md 参照。
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KizamiApiClient } from "./client.js";
import { ConfigError, loadConfigFromEnv } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const client = new KizamiApiClient({ baseUrl: config.apiUrl, apiKey: config.apiKey });
  const server = createServer(client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdio サーバーは接続後も常駐する(クライアントが切断するとプロセスも終了する)。
  console.error(`kizami-mcp: connected (KIZAMI_API_URL=${config.apiUrl})`);
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`kizami-mcp: 設定エラー — ${err.message}`);
  } else {
    console.error("kizami-mcp: 起動に失敗しました", err);
  }
  process.exitCode = 1;
});
