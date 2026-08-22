/**
 * KIZAMI MCP サーバー本体の組み立て。トランスポート(stdio)には依存しない
 * — index.ts がこれを StdioServerTransport に繋ぐ。テストからは createServer() を直接呼び、
 * 実際に MCP クライアント(InMemoryTransport など)で tools/list・tools/call を検証できる。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KizamiApiClient } from "./client.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "kizami";
export const SERVER_VERSION = "0.1.0";

export function createServer(client: KizamiApiClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, client);
  return server;
}
