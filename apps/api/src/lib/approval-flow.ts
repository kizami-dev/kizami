/**
 * 多段承認(二段承認)の共通ロジック。仕様の正: docs/design/approval-flows.md
 *
 * 対象は「承認権限を持つ人が1回 approve すれば反映される」形の3種類の申請 —
 * 打刻修正(routes/corrections.ts)・休暇(routes/leave.ts)・休憩自動控除の打ち消し
 * (routes/auto-break-waivers.ts)。3ファイルは元々そろって同じ認可の形をしているので、
 * 段数の判定・段の解決・二次承認者の解決という「3箇所で同じ答えを出さねばならない」部分だけを
 * ここへ集約する(承認そのものの副作用 — 打刻の追記・残高の再検証・締め後修正 — は
 * 種別ごとに全く違うため、各ルートに残す)。
 *
 * 段の意味(設計):
 * - **一次承認(step 1)**: 従来どおり。その種別の承認権限を、申請対象者を含むスコープで
 *   持っている人(部署マネージャ等)。
 * - **二次承認(step 2)**: 同じ権限を **tenant スコープ**で持っている人(人事・本部を想定)。
 *   「部署の外から見て問題ないか」を確認する段なので、部署スコープの承認者では押せない。
 *
 * 不変条件(いずれも本モジュールで判定する):
 * - 同一人物が同じ申請の一次・二次を両方行うことはできない(段を分けた意味が無くなるため)。
 * - 申請者本人による承認(自己承認)の可否は**従来の権限判定のまま**変えない。KIZAMI では
 *   「自分の申請を承認する」こと自体は禁止しておらず、その種別の承認権限を持っているかどうかで
 *   決まる(routes/corrections.ts のヘッダコメント参照。監査ログに selfApproved を残す)。
 *   二段承認でも同じで、一次と二次が別人でありさえすればよい。
 */

import {
  createNotificationIfAbsent,
  DEFAULT_APPROVAL_FLOW_STEPS,
  getApprovalFlowSettings,
  type ApprovalFlowKind,
  type Database,
  type Transaction,
} from "@kizami/db";
import { dispatch } from "@kizami/notify";
import type { PermissionKey, Scope } from "@kizami/authz";
import { ForbiddenError } from "../authz.js";
import { resolveTenantScopeApprovers } from "./approvers.js";
import { buildPersonalChannels, type BuildPersonalChannelsOptions } from "./notification-channels.js";

export type { ApprovalFlowKind } from "@kizami/db";

/** 承認段数として受け付ける値。UI・API とも 1(単段)か 2(二段)だけ。 */
export const VALID_APPROVAL_STEPS: readonly number[] = [1, 2];

export interface ApprovalFlowSteps {
  correction: number;
  leave: number;
  auto_break_waiver: number;
}

/**
 * 未設定テナントの既定(全種別 単段)。値は packages/db 側の DEFAULT_APPROVAL_FLOW_STEPS
 * (スキーマの列 DEFAULT と対で管理されている)をそのまま使い、ここで再定義しない。
 */
export const DEFAULT_APPROVAL_FLOW: ApprovalFlowSteps = { ...DEFAULT_APPROVAL_FLOW_STEPS };

/** テナントの承認段数設定をまとめて読む(未設定なら既定=全種別1段)。 */
export async function loadApprovalFlowSteps(db: Database | Transaction, tenantId: string): Promise<ApprovalFlowSteps> {
  const row = await getApprovalFlowSettings(db, tenantId);
  if (!row) return { ...DEFAULT_APPROVAL_FLOW };
  return {
    correction: row.correctionSteps,
    leave: row.leaveSteps,
    auto_break_waiver: row.autoBreakWaiverSteps,
  };
}

/**
 * 申請作成時に「この申請に必要な段数」を決める。
 *
 * この値は申請行の `required_steps` に**凍結して保存する**(承認のたびに設定を読み直さない)。
 * 設定を後から変えても仕掛かり中の申請の段数は変わらない — グランドファザリングの判断点は
 * packages/db/src/schema/corrections.ts の同カラムのコメントと設計ドキュメント参照。
 */
export async function resolveRequiredSteps(db: Database | Transaction, tenantId: string, kind: ApprovalFlowKind): Promise<number> {
  const steps = await loadApprovalFlowSteps(db, tenantId);
  return steps[kind];
}

/** 承認処理を進めてよいか判定した結果。 */
export interface ApprovalStepPlan {
  /** この承認操作が何段目か(1 = 一次 / 2 = 二次)。監査ログ・通知の文面に使う。 */
  step: number;
  /** true ならこの承認で確定 — 申請内容を実際に反映してよい。false なら一次承認のみ。 */
  isFinal: boolean;
  /** 更新先の status。 */
  nextStatus: "approved" | "approved_step1";
  /** 楽観ロックに使う遷移元の status。 */
  fromStatus: "pending" | "approved_step1";
}

/** 承認の段が確定できない場合に返すエラーコード(HTTP 409 のボディにそのまま載せる)。 */
export type ApprovalStepError =
  /** 対象が pending / approved_step1 のいずれでもない(既に決裁済み・取り下げ済み) */
  | "not_pending"
  /** 二次承認を、一次承認を行った本人が押そうとした */
  | "same_approver_as_step1";

export interface ResolveApprovalStepParams {
  /** 申請行(3種別に共通する列だけを見る)。 */
  row: {
    status: string;
    requiredSteps: number;
    step1DecidedBy: string | null;
  };
  /** いま承認しようとしている人。 */
  actorId: string;
  /** actor の実効権限(c.get("permissions"))。二次承認の tenant スコープ判定に使う。 */
  permissions: Map<PermissionKey, Scope>;
  /** その種別の承認権限キー。 */
  permission: PermissionKey;
}

/**
 * 申請の現在状態から「いま行う承認が何段目で、それで確定するか」を決める。
 *
 * 返り値が文字列(ApprovalStepError)なら 409 で返すべき業務上の競合。
 * 二次承認の権限不足だけは例外(ForbiddenError)を投げる — 他の権限判定と同じ扱いにして、
 * 403 のボディに理由を載せない方針(apps/api/src/app.ts の onError)にそろえるため。
 */
export function resolveApprovalStep(params: ResolveApprovalStepParams): ApprovalStepPlan | ApprovalStepError {
  const { row, actorId, permissions, permission } = params;

  // 単段(既定)は従来どおり: pending からの1回の承認で確定する。
  if (row.requiredSteps < 2) {
    if (row.status !== "pending") return "not_pending";
    return { step: 1, isFinal: true, nextStatus: "approved", fromStatus: "pending" };
  }

  if (row.status === "pending") {
    // 一次承認。権限判定は単段のときと完全に同じ(呼び出し側が既に済ませている)。
    return { step: 1, isFinal: false, nextStatus: "approved_step1", fromStatus: "pending" };
  }

  if (row.status === "approved_step1") {
    // 二次承認。テナント全体スコープの承認権限が要る(人事・本部を想定)。
    if (permissions.get(permission) !== "tenant") {
      throw new ForbiddenError(`second-step approval requires ${permission} at tenant scope`);
    }
    // 一次と二次が同一人物では段を分けた意味が無い。
    if (row.step1DecidedBy !== null && row.step1DecidedBy === actorId) {
      return "same_approver_as_step1";
    }
    return { step: 2, isFinal: true, nextStatus: "approved", fromStatus: "approved_step1" };
  }

  return "not_pending";
}

/**
 * 却下・取り下げが可能な状態か(pending / approved_step1 のどちらでも可)。
 *
 * 却下は「どちらの段でも差し戻せる」— 二次承認者が内容に問題を見つけたら、一次で承認済みでも
 * 却下できるべき。取り下げも同様に**最終承認が下りるまで**申請者本人が行える。
 */
export function isOpenForDecision(status: string): boolean {
  return status === "pending" || status === "approved_step1";
}

/** 却下がどの段で行われたかを申請行から導く(一次承認済みなら二次段での却下)。 */
export function rejectionStep(row: { requiredSteps: number; step1DecidedBy: string | null }): number {
  return row.requiredSteps >= 2 && row.step1DecidedBy !== null ? 2 : 1;
}

/**
 * 一覧・詳細レスポンスに載せる承認フローの状態。UI が「一次承認済み(二次承認待ち)」等の
 * チップを描くために使う(GET は種別ごとに形が違うので、この3値だけを共通で足す)。
 */
export interface ApprovalFlowStateDto {
  /** 作成時に凍結された必要段数(1 or 2)。 */
  requiredSteps: number;
  /** 次に必要な承認が何段目か。決裁・取り下げ済みなら null。 */
  currentStep: number | null;
  step1DecidedBy: string | null;
  /** UTC エポック分 */
  step1DecidedAt: number | null;
}

export interface NotifyStep2ApproversParams {
  tenantId: string;
  /** その種別の承認権限キー(tenant スコープで持っている人が二次承認者候補)。 */
  permission: PermissionKey;
  /** 通知タイプ。`approval_request_` で始めること(個人設定のカテゴリ判定がこの接頭辞を見る)。 */
  notificationType: string;
  title: string;
  body: string;
  /** 通知しない相手(一次承認者=既に決裁済みの人、および申請者本人)。 */
  excludeUserIds: readonly string[];
  /** UTC エポック分 */
  now: number;
}

/**
 * 一次承認が済んだ申請について、二次承認者候補へ「二次承認をお願いします」を通知する。
 *
 * 既存の承認依頼通知(申請作成時、routes/corrections.ts の POST /)と同じ形:
 * アプリ内通知 + buildPersonalChannels 経由の個人チャネル、カテゴリは approval_request。
 * テナント共有 Webhook には**送らない** — 共有チャネルへは「申請が出た」ことだけを1度流す方針で
 * (lib/notification-channels.ts の設計原則: 共有チャネルに他人の勤怠の詳細を流さない)、
 * 段が進んだことまで全社チャネルに流す必要は無いと判断した。
 *
 * 既に決裁に関与した人(一次承認者)には再通知しない(依頼の要件)。
 * ベストエフォート(送信の失敗で承認自体を巻き戻さない)なのは既存の通知箇所と同じ。
 */
export async function notifyStep2Approvers(
  db: Database,
  deps: BuildPersonalChannelsOptions,
  params: NotifyStep2ApproversParams,
): Promise<void> {
  const { tenantId, permission, notificationType, title, body, excludeUserIds, now } = params;
  const excluded = new Set(excludeUserIds);
  const candidates = (await resolveTenantScopeApprovers(db, { tenantId, permission })).filter((id) => !excluded.has(id));

  for (const approverId of candidates) {
    const notification = await createNotificationIfAbsent(db, {
      tenantId,
      userId: approverId,
      type: notificationType,
      subjectDate: null,
      title,
      body,
      createdAt: now,
    });
    if (notification) {
      const channels = await buildPersonalChannels(db, { tenantId, userId: approverId, notificationType }, deps);
      if (channels.length > 0) {
        await dispatch(channels, { to: {}, title, body });
      }
    }
  }
}

/** 申請行から ApprovalFlowStateDto を組み立てる(3種別で共通)。 */
export function approvalFlowState(row: {
  status: string;
  requiredSteps: number;
  step1DecidedBy: string | null;
  step1DecidedAt: number | null;
}): ApprovalFlowStateDto {
  let currentStep: number | null = null;
  if (row.status === "pending") currentStep = 1;
  else if (row.status === "approved_step1") currentStep = 2;

  return {
    requiredSteps: row.requiredSteps,
    currentStep,
    step1DecidedBy: row.step1DecidedBy,
    step1DecidedAt: row.step1DecidedAt,
  };
}
