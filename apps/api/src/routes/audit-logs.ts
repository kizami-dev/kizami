/**
 * GET /audit-logs
 *
 * 監査ログ閲覧API(Tier 1)。参照: docs/design/permission-catalog.md §1.13(`audit_log.view`、
 * 適用スコープ 自部署 / 自部署+配下部署 / テナント全体、危険フラグあり)。
 *
 * **読み取り専用**。監査ログは punch_events と同様に不可変な追記専用テーブル
 * (docs/design/v01-data-model.md §audit_logs)であり、更新・削除APIは絶対に作らない
 * (依頼どおり)。
 *
 * 判断点(スコープの粒度): カタログ上 `audit_log.view` は department スコープを持つが、
 * audit_logs の各行(action/target)は「特定ユーザーの記録」に必ずしも対応しない
 * (例: テナント設定変更・締め操作・部署の作成 は特定の対象ユーザーを持たない)。
 * apps/api/src/lib/scope.ts の resolveAccessibleUserIds は「対象ユーザーの集合」を返す
 * 設計であり、対象ユーザーを持たない行にはそもそも適用できない。よって routes/closings.ts が
 * closing(これも「特定ユーザーの記録」ではない)を resolveAccessibleUserIds で絞り込まず
 * `requirePermission(c, ..., "department")` によるテナント内一律のゲートのみで扱っている
 * (closings.ts 冒頭コメント「使うと設計方針1に反する部分締めになってしまう」参照)のと同じ
 * 判断を踏襲し、`audit_log.view` を保持していれば(department スコープ以上)テナント内の
 * 監査ログ全件を対象にする。department 単位の行絞り込みは行わない。
 *
 * ページング: `id`(UUIDv7、時系列ソート可能)によるカーソル方式。`cursor` に前ページ最後の
 * `id` を渡すと、それより新しい行から返す(packages/db/src/queries/audit.ts 参照)。
 * `limit` 既定50・上限200。
 */

import { Hono } from "hono";
import { listAuditLogs, type Database } from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";

const VIEW_PERMISSION = "audit_log.view";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** クエリ文字列を整数(UTC エポック分)としてパースする。不正・非整数は null。未指定は undefined。 */
function parseMinutesParam(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) return null;
  return Number(value);
}

/** limit クエリをパースする。未指定は既定値、不正値(非正整数・上限超過)は null。 */
function parseLimitParam(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (n < 1 || n > MAX_LIMIT) return null;
  return n;
}

export interface AuditLogDto {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  /** JSON 文字列のまま返す(UI 側で整形する)。 */
  detail: string | null;
  occurredAt: number;
}

/** DB の合成 target カラム(`"<targetType>:<targetId>"`)を分解する(insertAuditLog の逆変換)。 */
function splitTarget(target: string): { targetType: string; targetId: string } {
  const i = target.indexOf(":");
  if (i === -1) return { targetType: target, targetId: "" };
  return { targetType: target.slice(0, i), targetId: target.slice(i + 1) };
}

export function createAuditLogsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const actorId = c.req.query("actorId");
    const targetType = c.req.query("targetType");
    const targetId = c.req.query("targetId");
    const action = c.req.query("action");
    const cursor = c.req.query("cursor");

    const fromMinutes = parseMinutesParam(c.req.query("from"));
    const toMinutes = parseMinutesParam(c.req.query("to"));
    if (fromMinutes === null || toMinutes === null) {
      return c.json({ error: "invalid_range" }, 400);
    }
    if (fromMinutes !== undefined && toMinutes !== undefined && fromMinutes > toMinutes) {
      return c.json({ error: "invalid_range" }, 400);
    }

    const limit = parseLimitParam(c.req.query("limit"));
    if (limit === null) {
      return c.json({ error: "invalid_limit" }, 400);
    }

    // limit+1 件取ってページの続きがあるかを判定する(既存の cursor 方式は本リポジトリ初導入。
    // hasMore を返すことでクライアントは「次の cursor を送るべきか」を毎回自力で推測せずに済む)。
    const rows = await listAuditLogs(db, {
      tenantId: user.tenantId,
      ...(actorId !== undefined ? { actorId } : {}),
      ...(targetType !== undefined ? { targetType } : {}),
      ...(targetId !== undefined ? { targetId } : {}),
      ...(action !== undefined ? { action } : {}),
      ...(fromMinutes !== undefined ? { fromMinutes } : {}),
      ...(toMinutes !== undefined ? { toMinutes } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const logs: AuditLogDto[] = page.map((row) => {
      const { targetType: rowTargetType, targetId: rowTargetId } = splitTarget(row.target);
      return {
        id: row.id,
        actorId: row.actorId,
        actorName: row.actorName,
        action: row.action,
        targetType: rowTargetType,
        targetId: rowTargetId,
        detail: row.afterDigest,
        occurredAt: row.occurredAt,
      };
    });

    return c.json({ logs, nextCursor });
  });

  return app;
}
