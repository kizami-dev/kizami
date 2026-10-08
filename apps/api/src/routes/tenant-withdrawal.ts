/**
 * テナントの退会と全データのエクスポート(2026-10-05)。設計は docs/design/tenant-withdrawal.md。
 *
 * - GET  /tenant/withdrawal         … 退会の状態(通常 / 手続き中と削除予定の時刻)
 * - POST /tenant/withdrawal         … 退会を申請する(body `{ confirmTenantName }`。テナント名の再入力)
 * - POST /tenant/withdrawal/cancel  … 申請を取り消す
 * - GET  /tenant/export             … 全データの zip(退会と関係なく、通常の状態でも使える)。流しながら返し、
 *                                      テナントごとに1本・プロセス全体で2本まで(超えたら 429 `export_busy`)
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
  cancelTenantWithdrawalWithAudit,
  getTenantById,
  insertAuditLog,
  requestTenantWithdrawalWithAudit,
  type Database,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { requirePermission } from "../authz.js";
import { waitUntilOf } from "../lib/after-response.js";
import type { SystemMailSendFn } from "../lib/system-mail.js";
import {
  createTenantExportStream,
  TENANT_EXPORT_FORMAT,
  TENANT_EXPORT_FORMAT_VERSION,
  TENANT_EXPORT_RETRY_AFTER_SECONDS,
  tryAcquireTenantExportSlot,
} from "../lib/tenant-export-archive.js";
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
    // 退会の claim(条件付き UPDATE)と監査ログを1単位で(@kizami/db の requestTenantWithdrawalWithAudit —
    // atomic plan。D1 でも動く。docs/design/d1-atomic-writes.md §6 #10)。claim できなければ監査ログも残らない。
    const updated = await requestTenantWithdrawalWithAudit(db, {
      tenantId: user.tenantId,
      requestedAt: now,
      scheduledPurgeAt,
      audit: {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "tenant.withdrawal.request",
        targetType: "tenant",
        targetId: user.tenantId,
        detail: JSON.stringify({ scheduledPurgeAt, graceDays: WITHDRAWAL_GRACE_DAYS }),
        occurredAt: now,
      },
    });
    // 既に手続き中(二重送信・別の管理者が先に申請した)。冪等に 200 にせず 409 で伝える —
    // 削除予定の時刻は最初の申請のまま動かないことを、呼び出し側が取り違えないように。
    if (!updated) return c.json({ error: "already_withdrawing", withdrawal: withdrawalStateOf(tenant) }, 409);

    if (deps.mail) {
      const recipients = await listWithdrawalNoticeRecipients(db, user.tenantId);
      for (const { email: to, locale } of recipients) {
        // 宛先ごとにその人の言語で組み立てる(lib/tenant-withdrawal.ts の listWithdrawalNoticeRecipients)
        const mail = buildWithdrawalRequestedMail({ appBaseUrl: deps.mail.appBaseUrl, scheduledPurgeAt, locale });
        const sending = deps.mail.sendMail({ to, ...mail }).catch((err: unknown) => {
          console.error("tenant withdrawal: failed to send the request notice:", err);
        });
        // Workers では応答の後に打ち切られないよう waitUntil に載せる(Node は null = 従来どおり投げっぱなし)
        waitUntilOf(c)?.(sending);
      }
    }

    return c.json({ withdrawal: withdrawalStateOf(updated), graceDays: WITHDRAWAL_GRACE_DAYS, mailNotifications: deps.mail !== null });
  });

  app.post("/withdrawal/cancel", async (c) => {
    requirePermission(c, TENANT_WITHDRAW_PERMISSION, "tenant");
    const user = c.get("user");
    const now = nowMinutes();
    // 取り消しの claim と監査ログを1単位で(@kizami/db の cancelTenantWithdrawalWithAudit — atomic plan。
    // D1 でも動く。§6 #11)。監査の detail に入れる「取り消す前の値」は計画の前に読む(計画の中では読めない。
    // claim が通ったならこの値は取り消した申請のもの — 間に「取り消し → 再申請」が割り込んだときだけ古い申請を指す)。
    const before = await getTenantById(db, user.tenantId);
    const cancelled = await cancelTenantWithdrawalWithAudit(db, {
      tenantId: user.tenantId,
      audit: {
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
      },
    });
    if (!cancelled) {
      // 削除が始まっている(「削除中」の印がある)テナントは取り消せない — 確認と削除のすき間で
      // 取り消しと削除がぶつかったとき、削除の側にも取り消しの側にも中途半端に倒れないようにするため
      // (@kizami/db の claimTenantPurge / cancelTenantWithdrawal)。
      const tenant = await getTenantById(db, user.tenantId);
      if (tenant?.withdrawalPurgeStartedAt != null) return c.json({ error: "purge_in_progress" }, 409);
      return c.json({ error: "not_withdrawing" }, 409);
    }
    return c.json({ withdrawal: withdrawalStateOf(cancelled), graceDays: WITHDRAWAL_GRACE_DAYS, mailNotifications: deps.mail !== null });
  });

  app.get("/export", async (c) => {
    requirePermission(c, TENANT_WITHDRAW_PERMISSION, "tenant");
    const user = c.get("user");

    // テナントごとに1本・プロセス全体で TENANT_EXPORT_MAX_CONCURRENT 本まで(lib/tenant-export-archive.ts
    // 「同時に走る本数」)。権限の確認の後に取り、取れなければ何も読まず、監査ログも残さない(何も出していない)
    const slot = tryAcquireTenantExportSlot(user.tenantId);
    if (!slot.ok) {
      c.header("Retry-After", String(TENANT_EXPORT_RETRY_AFTER_SECONDS));
      return c.json({ error: "export_busy" }, 429);
    }
    const { release } = slot;
    let handedOver = false;
    try {
      const tenant = await getTenantById(db, user.tenantId);
      if (!tenant) return c.json({ error: "not_found" }, 404);
      const now = nowMinutes();

      // 判断点(2026-10-06、ストリーミング化): 監査ログは**流し始める前**に1件残す。
      // zip はファイルごとにローカルヘッダーを持つので、途中で切れた zip からも、切れる前までに
      // 届いたファイルは取り出せる。完了時に記録する形だと、最後の数バイトの手前で自分から切れば
      // 「ほぼ全員分の個人情報を持ち出したのに記録が無い」ことになる。監査ログで守りたいのは
      // 「誰がいつ全データを持ち出そうとしたか」なので、試みを記録する(失敗・中断した回も1件残る)。
      // 代わりに、行数などの数は流し終えるまで分からないので監査ログには入れない(zip の manifest.json に
      // 入り、サーバーのログにも完了時に出る)。中身そのものは従来どおり残さない。
      await insertAuditLog(db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "tenant.export",
        targetType: "tenant",
        targetId: user.tenantId,
        detail: JSON.stringify({ format: TENANT_EXPORT_FORMAT, formatVersion: TENANT_EXPORT_FORMAT_VERSION, recordedAt: "start" }),
        occurredAt: now,
      });

      const { stream, filename } = createTenantExportStream(db, { tenantId: user.tenantId, now, release });
      handedOver = true;
      // 大きさは作り終えるまで分からないので Content-Length は付けない(チャンク転送)
      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      c.header("Cache-Control", "no-store");
      return c.body(stream);
    } finally {
      // ストリームを作る前に終わった(404・テナントの読み出しや監査ログの書き込みの例外)ときは、ここで枠を返す。
      // 例外はそのまま投げ直され、アプリのエラーハンドラが 500 にする
      if (!handedOver) release();
    }
  });

  return app;
}
