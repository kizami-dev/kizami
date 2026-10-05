/**
 * 運用者 CLI(src/operator.ts)の中身。CLI 本体は引数の解釈と出力だけを担い、DB を触る処理は
 * ここに置く(CLI は import すると即実行されるため、テストから直接呼べる形に切り出した。
 * create-tenant が tenant-bootstrap.ts に処理を置いているのと同じ分け方)。
 *
 * 対象は KIZAMI Cloud の運用者作業(docs/design/saas.md「運用者コンソールはまず CLI」):
 * サインアップ招待コードの発行・一覧・失効と、テナント一覧。suspend・プラン上書きは
 * Phase 2(課金)で作るのでここには無い。
 *
 * 2026-10-05: 退会したテナントの「今すぐ削除」(`tenant purge`)・削除の記録の一覧(`tenant purges`)・
 * 同梱プリセットの権限の同期(`tenant sync-presets`)を足した(docs/design/tenant-withdrawal.md)。
 */

import {
  createSignupInviteCode,
  getTenantById,
  listSignupInviteCodes,
  listTenantPurgeRecords,
  listTenantsWithActiveUserCount,
  requestTenantWithdrawal,
  revokeSignupInviteCode,
  type Database,
  type SignupInviteCode,
  type TenantOverviewRow,
  type TenantPurgeRecord,
} from "@kizami/db";
import { purgeWithdrawnTenant, type TenantWithdrawalMailer } from "../tenant-purge.js";
import { generateSignupInviteCode, hashSignupInviteCode } from "./signup-invite-code.js";
import { syncSystemPresetGrants } from "./tenant-bootstrap.js";

const DAY_MINUTES = 24 * 60;

export interface CreateInviteCodeParams {
  /** 既定 1 */
  maxUses?: number;
  /** 発行から何日で失効するか。省略 = 無期限 */
  expiresInDays?: number;
  note?: string;
  /** UTC エポック分。テストが固定値を渡せるようにしてある */
  nowMinutes: number;
}

/**
 * 招待コードを1件発行する。**平文はこの戻り値でしか得られない**(DB にはハッシュだけを保存する)。
 */
export async function createInviteCode(
  db: Database,
  params: CreateInviteCodeParams,
): Promise<{ plainCode: string; row: SignupInviteCode }> {
  const maxUses = params.maxUses ?? 1;
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    throw new Error("--max-uses must be a positive integer");
  }
  if (params.expiresInDays !== undefined && (!Number.isInteger(params.expiresInDays) || params.expiresInDays < 1)) {
    throw new Error("--expires-days must be a positive integer");
  }
  const plainCode = generateSignupInviteCode();
  const row = await createSignupInviteCode(db, {
    codeHash: await hashSignupInviteCode(plainCode),
    note: params.note ?? null,
    maxUses,
    expiresAt: params.expiresInDays !== undefined ? params.nowMinutes + params.expiresInDays * DAY_MINUTES : null,
    createdAt: params.nowMinutes,
  });
  return { plainCode, row };
}

export interface InviteCodeListing {
  id: string;
  note: string | null;
  usedCount: number;
  maxUses: number;
  /** UTC エポック分。null = 無期限 */
  expiresAt: number | null;
  revoked: boolean;
  /** 一覧用の状態。revoked > expired > exhausted > active の優先順 */
  status: "active" | "revoked" | "expired" | "exhausted";
}

/** 一覧(平文は出さない — そもそも DB に無い)。作成の新しい順。 */
export async function listInviteCodes(db: Database, params: { nowMinutes: number }): Promise<InviteCodeListing[]> {
  const rows = await listSignupInviteCodes(db);
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    usedCount: r.usedCount,
    maxUses: r.maxUses,
    expiresAt: r.expiresAt,
    revoked: r.revokedAt !== null,
    status:
      r.revokedAt !== null
        ? "revoked"
        : r.expiresAt !== null && r.expiresAt <= params.nowMinutes
          ? "expired"
          : r.usedCount >= r.maxUses
            ? "exhausted"
            : "active",
  }));
}

/** 失効する。見つからない・既に失効済みなら false。 */
export async function revokeInviteCode(db: Database, params: { id: string; nowMinutes: number }): Promise<boolean> {
  const row = await revokeSignupInviteCode(db, { id: params.id, revokedAt: params.nowMinutes });
  return row !== null;
}

/** テナント一覧(id / 名前 / 作成日 / 有効ユーザー数)。 */
export async function listTenants(db: Database): Promise<TenantOverviewRow[]> {
  return listTenantsWithActiveUserCount(db);
}

/**
 * 「今すぐ削除」の前に確認のために見せる内容。退会を申請していないテナントは削除できない
 * (`withdrawing: false` を見て CLI が断る)。名前は運用者の確認のためだけに画面へ出し、
 * 削除の記録には残さない。
 */
export interface PurgeCandidate {
  id: string;
  name: string;
  withdrawing: boolean;
  requestedAt: number | null;
  scheduledPurgeAt: number | null;
}

export async function describePurgeCandidate(db: Database, tenantId: string): Promise<PurgeCandidate | null> {
  const tenant = await getTenantById(db, tenantId);
  if (!tenant) return null;
  return {
    id: tenant.id,
    name: tenant.name,
    withdrawing: tenant.withdrawalRequestedAt !== null,
    requestedAt: tenant.withdrawalRequestedAt,
    scheduledPurgeAt: tenant.withdrawalScheduledPurgeAt,
  };
}

/**
 * 退会を申請したテナントを、削除予定の時刻を待たずに今すぐ削除する(`tenant purge`)。
 *
 * 確認(`confirmTenantId` がテナント id と完全に一致すること)を**この関数の中で**行う — CLI の
 * 対話を経ない呼び出し(テスト・将来の管理画面)でも、確認なしに消せないようにするため。
 * 退会を申請していないテナントは消さない(@kizami/db の purgeTenant も同じ判定をする)。
 *
 * `afterRestore`(`--after-restore`): バックアップから復元した後に、**復元の前に削除済みだった**テナントを
 * 削除し直すための経路(deploy/k8s-cloud/README.md「復旧手順」)。復元した dump が申請より前のものだと
 * テナントは通常の状態に戻っているので、申請の状態にしてから(予定 = 今)同じ経路で削除する。
 * 運用者が復元前の削除の記録(`tenant purges` の出力)と照らして id を渡すこと。メールは送らない
 * (テナントには既に完了を知らせている)。
 */
export async function purgeTenantNow(
  db: Database,
  params: { tenantId: string; confirmTenantId: string; nowMinutes: number; mailer: TenantWithdrawalMailer | null; afterRestore?: boolean },
): Promise<
  | { status: "purged" | "already_purged"; record: TenantPurgeRecord; mailsSent: number }
  | { status: "confirmation_mismatch" | "not_withdrawing" | "not_claimed" | "not_found" }
> {
  if (params.confirmTenantId.trim() !== params.tenantId) return { status: "confirmation_mismatch" };
  if (params.afterRestore) {
    // 既に申請の状態なら何も変わらない(条件付き UPDATE)
    await requestTenantWithdrawal(db, { tenantId: params.tenantId, requestedAt: params.nowMinutes, scheduledPurgeAt: params.nowMinutes });
  }
  // 定期ジョブと同じ経路(「削除中」の印を条件付き UPDATE で取る)。予定の時刻だけを待たない。
  const result = await purgeWithdrawnTenant(db, {
    tenantId: params.tenantId,
    nowMinutes: params.nowMinutes,
    mailer: params.afterRestore ? null : params.mailer,
    requireDue: false,
  });
  if (result.status === "purged" || result.status === "already_purged") {
    return { status: result.status, record: result.record, mailsSent: result.mailsSent };
  }
  return { status: result.status };
}

/** 削除の記録の一覧(`tenant purges`)。個人情報は含まない(テナント id・時刻・行数だけ)。 */
export async function listPurgeRecords(db: Database): Promise<Array<TenantPurgeRecord & { totalRows: number }>> {
  const rows = await listTenantPurgeRecords(db);
  return rows.map((r) => ({
    ...r,
    totalRows: Object.values(JSON.parse(r.deletedCounts) as Record<string, number>).reduce((a, b) => a + b, 0),
  }));
}

/**
 * 全テナントの同梱プリセットへ、権限カタログに増えた権限を追記する(`tenant sync-presets`)。
 * 既存のテナントの「管理者」に `tenant.withdraw` のような新しい権限を届ける経路。
 * 追加のみで削除はしない(syncSystemPresetGrants の docstring)。
 */
export async function syncPresetsForAllTenants(db: Database): Promise<Array<{ tenantId: string; added: Map<string, string[]> }>> {
  const result: Array<{ tenantId: string; added: Map<string, string[]> }> = [];
  for (const tenant of await listTenantsWithActiveUserCount(db)) {
    const added = await syncSystemPresetGrants(db, tenant.id);
    if (added.size > 0) result.push({ tenantId: tenant.id, added });
  }
  return result;
}

/** UTC エポック分 → "YYYY-MM-DD HH:mm"(UTC)。CLI の表示用。 */
export function formatMinutesUtc(minutes: number): string {
  return new Date(minutes * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

/** `--max-uses 3` / `--max-uses=3` 形式の引数を読む(create-tenant.ts の argValue と同じ作法)。 */
export function argValue(argv: string[], flag: string): string | undefined {
  const prefixed = argv.find((a) => a.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 3);
  const index = argv.indexOf(`--${flag}`);
  if (index >= 0) return argv[index + 1];
  return undefined;
}

/** 整数オプションの解釈。省略なら undefined、整数でなければ例外。 */
export function intArg(argv: string[], flag: string): number | undefined {
  const raw = argValue(argv, flag);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`--${flag} must be a positive integer (got "${raw}")`);
  return Number(raw);
}
