/**
 * GET/PUT /settings/approval-flow — 多段承認(二段承認)のテナント単位設定。
 * 仕様の正: docs/design/approval-flows.md
 *
 * 権限は専用キー `approval_flow.manage`(TENANT_ONLY・危険フラグなし)。既存キーを転用しなかった
 * 理由は packages/authz/src/catalog.ts の §1.15 の判断点コメントを参照。
 *
 * 形は routes/settings/sso.ts と同じ「1テナント1行・丸ごと置き換え・変更は監査ログに残す」。
 * 秘密情報を含まないため GET のマスキングは無い。
 *
 * 既定値の扱い: 行が無いテナントは全種別 1段(単段)として GET が返す。PUT で初めて行ができる
 * (未設定と「明示的に1段を選んだ」を区別しない — どちらも挙動は同じで、区別する意味が無い)。
 */

import type { Hono } from "hono";
import { getApprovalFlowSettings, insertAuditLog, upsertApprovalFlowSettings, type Database } from "@kizami/db";
import type { AppEnv } from "../../auth/middleware.js";
import { requirePermission } from "../../authz.js";
import { DEFAULT_APPROVAL_FLOW, VALID_APPROVAL_STEPS } from "../../lib/approval-flow.js";
import { nowMinutes } from "../../lib/time.js";
import { APPROVAL_FLOW_PERMISSION } from "./permissions.js";
import { parseJsonRecord } from "./shared.js";

function serialize(settings: Awaited<ReturnType<typeof getApprovalFlowSettings>>) {
  return {
    correctionSteps: settings?.correctionSteps ?? DEFAULT_APPROVAL_FLOW.correction,
    leaveSteps: settings?.leaveSteps ?? DEFAULT_APPROVAL_FLOW.leave,
    autoBreakWaiverSteps: settings?.autoBreakWaiverSteps ?? DEFAULT_APPROVAL_FLOW.auto_break_waiver,
    updatedAt: settings?.updatedAt ?? null,
    updatedBy: settings?.updatedBy ?? null,
  };
}

/** 1 か 2 の整数のみ受け付ける(未指定は既存値の維持ではなく 400 — 3値とも常に送らせる)。 */
function isValidSteps(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && VALID_APPROVAL_STEPS.includes(value);
}

export function registerApprovalFlowRoutes(app: Hono<AppEnv>, db: Database) {
  app.get("/approval-flow", async (c) => {
    requirePermission(c, APPROVAL_FLOW_PERMISSION, "tenant");
    const user = c.get("user");
    return c.json(serialize(await getApprovalFlowSettings(db, user.tenantId)));
  });

  app.put("/approval-flow", async (c) => {
    requirePermission(c, APPROVAL_FLOW_PERMISSION, "tenant");
    const user = c.get("user");

    const body = await parseJsonRecord(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    if (!isValidSteps(body.correctionSteps)) return c.json({ error: "invalid_correction_steps" }, 400);
    if (!isValidSteps(body.leaveSteps)) return c.json({ error: "invalid_leave_steps" }, 400);
    if (!isValidSteps(body.autoBreakWaiverSteps)) return c.json({ error: "invalid_auto_break_waiver_steps" }, 400);

    const before = serialize(await getApprovalFlowSettings(db, user.tenantId));

    const now = nowMinutes();
    const updated = await upsertApprovalFlowSettings(db, {
      tenantId: user.tenantId,
      correctionSteps: body.correctionSteps,
      leaveSteps: body.leaveSteps,
      autoBreakWaiverSteps: body.autoBreakWaiverSteps,
      updatedAt: now,
      updatedBy: user.id,
    });

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "approval_flow_settings.update",
      targetType: "approval_flow_settings",
      targetId: user.tenantId,
      // 承認の厳しさを変える操作なので、変更前後の両方を残す(「いつ誰が2段を1段に緩めたか」を
      // 後から追えるようにする — 監査ログの主目的)。
      detail: JSON.stringify({
        before: { correctionSteps: before.correctionSteps, leaveSteps: before.leaveSteps, autoBreakWaiverSteps: before.autoBreakWaiverSteps },
        after: {
          correctionSteps: updated.correctionSteps,
          leaveSteps: updated.leaveSteps,
          autoBreakWaiverSteps: updated.autoBreakWaiverSteps,
        },
      }),
      occurredAt: now,
    });

    return c.json(serialize(updated));
  });
}
