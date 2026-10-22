/**
 * Waku のサーバーエントリ(2026-10-22、セキュリティレビュー M4 で追加)。
 *
 * 中身は Waku の「managed mode」(このファイルが無いときに Waku が自動生成するエントリ:
 * waku/dist/lib/utils/managed.js の getManagedServerEntry)と同じ fsRouter + 既定アダプタで、
 * 違いは **fetch の結果にセキュリティヘッダを付けること**だけ(lib/security-headers.ts)。
 *
 * アダプタの middlewareFns ではなく fetch を包んでいるのは、ビルド後の静的ファイル
 * (`render: "static"` のページの HTML・アセット・sw.js)を配る serveStatic がミドルウェアより前に
 * 登録されていて、ミドルウェアでは静的配信の応答にヘッダを付けられないため(waku/dist/adapters/node.js)。
 *
 * `fsRouter` は `waku` から名前付きで import すること: Waku はこのファイルの import を見て
 * pages.gen.ts(ルートの型)を生成するかを決める(fs-router-typegen の detectFsRouterUsage)。
 */
import { fsRouter } from "waku";
import adapter from "waku/adapters/default";
import { apiOrigin, withSecurityHeaders } from "./lib/security-headers";

const entry = adapter(fsRouter(import.meta.glob("./pages/**/*.{tsx,ts}")));

// 開発サーバーでは CSP を付けない(Vite の HMR クライアントがインラインスクリプトと WebSocket を使う)
const csp = !import.meta.env.DEV;
const api = apiOrigin(import.meta.env.WAKU_PUBLIC_API_URL ?? "http://localhost:3001");

export default {
  ...entry,
  fetch: async (req: Request, ...args: unknown[]) => withSecurityHeaders(req, await entry.fetch(req, ...args), { csp, apiOrigin: api }),
};
