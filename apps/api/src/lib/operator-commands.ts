/**
 * 運用者 CLI(src/operator.ts)の中身。CLI 本体は引数の解釈と出力だけを担い、DB を触る処理は
 * ここに置く(CLI は import すると即実行されるため、テストから直接呼べる形に切り出した。
 * create-tenant が tenant-bootstrap.ts に処理を置いているのと同じ分け方)。
 *
 * 対象は KIZAMI Cloud の運用者作業(docs/design/saas.md「運用者コンソールはまず CLI」):
 * サインアップ招待コードの発行・一覧・失効と、テナント一覧。suspend・プラン上書きは
 * Phase 2(課金)で作るのでここには無い。
 */

import {
  createSignupInviteCode,
  listSignupInviteCodes,
  listTenantsWithActiveUserCount,
  revokeSignupInviteCode,
  type Database,
  type SignupInviteCode,
  type TenantOverviewRow,
} from "@kizami/db";
import { generateSignupInviteCode, hashSignupInviteCode } from "./signup-invite-code.js";

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
