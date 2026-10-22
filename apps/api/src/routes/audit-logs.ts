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
 * スコープ(2026-10-22、セキュリティ指摘 M7 で変更): 以前は「監査ログの行は特定ユーザーの
 * 記録に必ずしも対応しない」ことを理由に、department スコープでもテナント内の全件を返していた。
 * それでは部署スコープで付与した意味が無く、他部署のメンバーの記録やテナント設定の変更履歴まで
 * 読めてしまう。いまはスコープに従って絞り込む:
 * - tenant: テナント内の全件(従来どおり)
 * - department / department_and_descendants: 対象がスコープ内のユーザー・部署に帰属する行、
 *   または対象がユーザー・部署に帰属し操作者がスコープ内のユーザーである行だけ。
 *   テナント設定・締め・APIキーなどテナント単位の行は見せない
 *   (規則の詳細と、対象の種類ごとの帰属先は packages/db/src/queries/audit.ts の
 *   AuditLogScopeFilter / AUDIT_TARGET_OWNERS)
 * 絞り込みは SQL で行うので、ページング(limit・cursor)は絞り込み後の行に対してそのまま正しい。
 *
 * ページング: `id`(UUIDv7、時系列ソート可能)によるカーソル方式。`cursor` に前ページ最後の
 * `id` を渡すと、それより新しい行から返す(packages/db/src/queries/audit.ts 参照)。
 * `limit` 既定50・上限200。
 */

import { Hono } from "hono";
import { listAuditLogs, type AuditLogScopeFilter, type Database } from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { resolveAccessibleDepartmentIds, resolveAccessibleUserIds, type ScopeActor } from "../lib/scope.js";

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

/** テナント全体スコープなら undefined(絞り込みなし)。それ以外は見せてよいユーザー・部署。 */
async function resolveAuditScope(db: Database, actor: ScopeActor): Promise<AuditLogScopeFilter | undefined> {
  const userIds = await resolveAccessibleUserIds(db, { actor, permission: VIEW_PERMISSION });
  if (userIds === "all") return undefined;
  const departmentIds = await resolveAccessibleDepartmentIds(db, { actor, permission: VIEW_PERMISSION });
  return { userIds: [...userIds], departmentIds: departmentIds === "all" ? [] : [...departmentIds] };
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

    const scope = await resolveAuditScope(db, { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") });

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
      ...(scope !== undefined ? { scope } : {}),
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
