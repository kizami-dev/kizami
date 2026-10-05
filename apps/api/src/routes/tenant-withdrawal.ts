/**
 * テナントの退会と全データのエクスポート(2026-10-05)。設計は docs/design/tenant-withdrawal.md。
 *
 * - GET  /tenant/withdrawal         … 退会の状態(通常 / 手続き中と削除予定の時刻)
 * - POST /tenant/withdrawal         … 退会を申請する(body `{ confirmTenantName }`。テナント名の再入力)
 * - POST /tenant/withdrawal/cancel  … 申請を取り消す
 * - GET  /tenant/export             … 全データの zip(退会と関係なく、通常の状態でも使える)
 *
 * 権限はすべて `tenant.withdraw`(テナント全体)。退会手続き中に許される書き込みは取り消しだけで、
 * それ以外は auth/tenant-withdrawal-guard.ts が 409 にする(ここに来る前に止まる)。
 *
 * ## テナント名の再入力(member.erase と同じ作法)
 *
 * 申請は30日後に会社のすべてのデータを消す操作で、取り違え(別のテナントにログインしていた等)に
 * 気づけないまま進むと取り返しがつかない。Web の確認ダイアログ(ConfirmDialog の confirmPhrase)と
 * 同じ照合をサーバーでも行い、一致しなければ 400 `confirmation_mismatch`(trim のみ。大文字小文字・
 * 全角半角は正規化しない — 似た名前で通ってしまうと確認の意味が薄れる)。
 *
 * ## メール(システムメールがある配備だけ)
 *
 * 申請を受け付けたら、`tenant.withdraw` を持つ全員へ削除予定の時刻とエクスポートの案内を送る
 * (文面は lib/tenant-withdrawal.ts。テナント名などのユーザー入力は入れない)。送信は応答を待たない
 * (signup と同じく、失敗はログのみ)。システムメールが無い配備(セルフホスト)では画面の表示だけ。
 */

import { Hono } from "hono";
import {
  cancelTenantWithdrawal,
  getTenantById,
  insertAuditLog,
  requestTenantWithdrawal,
  type Database,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import type { SystemMailSendFn } from "../lib/system-mail.js";
import { buildTenantExportArchive } from "../lib/tenant-export-archive.js";
import {
  buildWithdrawalRequestedMail,
  listWithdrawalNoticeRecipients,
  TENANT_WITHDRAW_PERMISSION,
  WITHDRAWAL_GRACE_DAYS,
  WITHDRAWAL_GRACE_MINUTES,
  withdrawalStateOf,
} from "../lib/tenant-withdrawal.js";
import { nowMinutes } from "../lib/time.js";

/** createApp に渡す、退会のメールの設定(渡さない = メールを出さない。セルフホスト・Workers)。 */
export interface TenantWithdrawalMailDeps {
  /** メール内のリンク(`${appBaseUrl}/settings/withdrawal`)のベース URL。末尾スラッシュ無し */
  appBaseUrl: string;
  /** システムメールの送信関数(実装は node.ts が渡す。テストは偽実装) */
  sendMail: SystemMailSendFn;
}

export function createTenantWithdrawalRoutes(db: Database, deps: { mail: TenantWithdrawalMailDeps | null }) {
  const app = new Hono<AppEnv>();

  app.get("/withdrawal", async (c) => {
    requirePermission(c, TENANT_WITHDRAW_PERMISSION, "tenant");
    const user = c.get("user");
    const tenant = await getTenantById(db, user.tenantId);
    return c.json({
      withdrawal: withdrawalStateOf(tenant),
      graceDays: WITHDRAWAL_GRACE_DAYS,
      // 申請・削除の前にメールが届く配備か(画面の案内の出し分け用)
      mailNotifications: deps.mail !== null,
    });
  });

  app.post("/withdrawal", async (c) => {
    requirePermission(c, TENANT_WITHDRAW_PERMISSION, "tenant");
    const user = c.get("user");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    const confirmTenantName = typeof body === "object" && body !== null ? (body as { confirmTenantName?: unknown }).confirmTenantName : undefined;
    if (typeof confirmTenantName !== "string") return c.json({ error: "invalid_body" }, 400);

    const tenant = await getTenantById(db, user.tenantId);
    if (!tenant) return c.json({ error: "not_found" }, 404);
    if (confirmTenantName.trim() !== tenant.name) return c.json({ error: "confirmation_mismatch" }, 400);

    const now = nowMinutes();
    const scheduledPurgeAt = now + WITHDRAWAL_GRACE_MINUTES;
    const updated = await db.transaction(async (tx) => {
      const row = await requestTenantWithdrawal(tx, { tenantId: user.tenantId, requestedAt: now, scheduledPurgeAt });
      if (!row) return null;
      await insertAuditLog(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "tenant.withdrawal.request",
        targetType: "tenant",
        targetId: user.tenantId,
        detail: JSON.stringify({ scheduledPurgeAt, graceDays: WITHDRAWAL_GRACE_DAYS }),
        occurredAt: now,
      });
      return row;
    });
    // 既に手続き中(二重送信・別の管理者が先に申請した)。冪等に 200 にせず 409 で伝える —
    // 削除予定の時刻は最初の申請のまま動かないことを、呼び出し側が取り違えないように。
    if (!updated) return c.json({ error: "already_withdrawing", withdrawal: withdrawalStateOf(tenant) }, 409);

    if (deps.mail) {
      const mail = buildWithdrawalRequestedMail({ appBaseUrl: deps.mail.appBaseUrl, scheduledPurgeAt });
      const recipients = await listWithdrawalNoticeRecipients(db, user.tenantId);
      for (const to of recipients) {
        void deps.mail.sendMail({ to, ...mail }).catch((err: unknown) => {
          console.error("tenant withdrawal: failed to send the request notice:", err);
        });
      }
    }

    return c.json({ withdrawal: withdrawalStateOf(updated), graceDays: WITHDRAWAL_GRACE_DAYS, mailNotifications: deps.mail !== null });
  });

  app.post("/withdrawal/cancel", async (c) => {
    requirePermission(c, TENANT_WITHDRAW_PERMISSION, "tenant");
    const user = c.get("user");
    const now = nowMinutes();
    const cancelled = await db.transaction(async (tx) => {
      const before = await getTenantById(tx, user.tenantId);
      const row = await cancelTenantWithdrawal(tx, { tenantId: user.tenantId });
      if (!row) return null;
      await insertAuditLog(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "tenant.withdrawal.cancel",
        targetType: "tenant",
        targetId: user.tenantId,
        detail: JSON.stringify({
          requestedAt: before?.withdrawalRequestedAt ?? null,
          scheduledPurgeAt: before?.withdrawalScheduledPurgeAt ?? null,
        }),
        occurredAt: now,
      });
      return row;
    });
    if (!cancelled) return c.json({ error: "not_withdrawing" }, 409);
    return c.json({ withdrawal: withdrawalStateOf(cancelled), graceDays: WITHDRAWAL_GRACE_DAYS, mailNotifications: deps.mail !== null });
  });

  app.get("/export", async (c) => {
    requirePermission(c, TENANT_WITHDRAW_PERMISSION, "tenant");
    const user = c.get("user");
    const now = nowMinutes();
    const archive = await buildTenantExportArchive(db, { tenantId: user.tenantId, now });
    if (!archive) return c.json({ error: "not_found" }, 404);

    // 中身そのものは残さない。何をどれだけ出したかの数だけ
    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "tenant.export",
      targetType: "tenant",
      targetId: user.tenantId,
      detail: JSON.stringify({ ...archive.summary, bytes: archive.bytes.byteLength }),
      occurredAt: now,
    });

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${archive.filename}"`);
    c.header("Cache-Control", "no-store");
    return c.body(archive.bytes as Uint8Array<ArrayBuffer>);
  });

  return app;
}
