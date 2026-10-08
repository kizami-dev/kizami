/**
 * GET /members, POST /members, PATCH /members/:id, PUT /members/:id/presets,
 * POST /members/:id/invitations, DELETE /members/:id/invitations,
 * POST /members/:id/password-resets, DELETE /members/:id/password-resets,
 * POST /members/:id/deactivate, POST /members/:id/reactivate, POST /members/:id/erase,
 * GET /members/:id/work-policy, POST /members/:id/work-policy
 *
 * メンバー一覧・招待式登録・パスワードリセット(管理者発行)・退職処理(無効化)・所属変更・
 * プリセット割当のAPI。参照: docs/design/permission-catalog.md §1.8(メンバー管理)、
 * §1.12(権限管理)、docs/requirements.md §認証(招待式登録)。
 *
 * 権限: 一覧閲覧は `member.view`、メンバー作成・招待の発行/再発行/取り消し・パスワードリセットの
 * 発行/取り消しは `member.invite`(カタログにある既存のメンバー管理系権限をそのまま使う。
 * パスワードリセット用の専用権限は新設しない — 選定理由は下記 INVITE_PERMISSION のコメント参照)、
 * 所属(departmentId)の変更は `member.profile.edit`、無効化・再有効化は `member.deactivate`
 * (カタログに専用キーが既にある)、退職者の個人データ消去は `member.erase`
 * (2026-08-27 新設。無効化と同格ではなく一段重い — 理由は ERASE_PERMISSION のコメント参照)。プリセット割当(PUT /:id/presets)は
 * `permission.assignment.manage` — 実際の検証・固定原則(自己昇格/自己降格/最後の権限管理
 * 保持者保護)の判定は routes/presets.ts の `assignPresetsToMember()` に委譲する(依頼の
 * section 分けでは C. presets.ts の管轄だが、URL は /members/:id/presets にネストするため、
 * ハンドラ自体はこのファイルに置く)。
 *
 * 招待式登録(2026-08-23): 管理者がメンバーを作成した時点で users 行ができる(「招待中」)。
 * auth_credentials はまだ無くログイン不可。招待トークンの発行・受諾の流れと設計判断は
 * packages/db/src/schema/invitations.ts / packages/db/src/queries/invitations.ts、
 * および受諾エンドポイント routes/invitations.ts(未認証・公開)を参照。
 *
 * パスワードリセット・退職処理(2026-08-23、Tier 0): 招待と同型の作法(平文トークンは発行時
 * 1度だけ・DB には SHA-256 のみ)。設計判断は packages/db/src/schema/password-resets.ts、
 * queries/password-resets.ts、queries/member-lifecycle.ts、queries/sessions.ts、
 * および使用エンドポイント routes/password-resets.ts(未認証・公開)を参照。
 *
 * 退職者データのライフサイクル(2026-08-27、docs/design/data-retention.md): 退職処理
 * (`POST /:id/deactivate`)が `users.deactivated_at` を記録し、そこからテナント設定の保持年数
 * (3 or 5、労働基準法109条)が経過して初めて `POST /:id/erase` による**匿名化**が可能になる。
 * 消去は勤怠記録の行を1件も消さない(集計と保存義務の両立)。線引きの表は上記設計ドキュメント。
 *
 * スコープの粒度: requirePermission は「保持スコープが最低限 department 以上か」までしか
 * 見ないため、対象メンバー・対象部署が実際に actor の管轄下(所属部署・その配下)にいるかは
 * apps/api/src/lib/scope.ts の resolveAccessibleUserIds() / resolveAccessibleDepartmentIds()
 * で別途絞り込む(以前はここが未実装で、department_and_descendants しか持たないユーザーでも
 * テナント全体を操作できてしまっていた)。
 *
 * メンバー個別の労働時間制割当(2026-08-23、Tier 0 その3): GET/POST /:id/work-policy。
 * 制度(フレックス/固定時間制)は所定労働時間の算出を通じて賃金に直結するため、メンバー管理系
 * (`member.*`)の権限では保護しない — GET/POST /settings/work-policy と同じ
 * `WORK_POLICY_PERMISSION`(tenant_settings.flex.manage、カタログ上テナント全体のみ)を要求する
 * (判断点)。制度 CRUD 用の UI は作らず(依頼の設計方針)、ポリシーは kind(flex/fixed)ごとに
 * テナントで高々1本を get-or-create し、メンバーへの割当は「その kind を選ぶ」ことで表現する
 * 設計(所定労働時間が人ごとに違うケースは docs/design/shift-work.md のシフト制での対応まで
 * 将来課題として持ち越す)。詳細な設計判断は packages/db/src/queries/work-policies.ts の
 * `getOrCreateTenantWorkPolicyByKind` のコメント参照。
 *
 * 名前付きの制度(2026-10-05、時短勤務対応の第1段階): 上の「kind ごとに1本」をやめ、テナントは
 * 制度を名前付きで複数持てるようにした(制度の管理は routes/settings/work-policies.ts)。
 * POST /:id/work-policy は `workPolicyId`(制度の id)で割当先を指定するのが正規の入力になり、
 * 従来の `kind` 入力は後方互換のために残す(その kind の既定の制度に割り当てる)。
 * 招待(POST /)でも `workPolicyId` を任意で受け付ける — 指定が無ければ従来どおりテナントの
 * 既定の制度を割り当てる。招待と同じ日から別の制度にしたいとき、後から割当を足すと
 * 同日の重複(409 assignment_already_exists)になって直せないため、招待の時点で選べるようにした。
 */

import { Hono } from "hono";
import {
  createInvitation,
  createInvitedMember,
  deactivateMember,
  eraseUserPersonalDataAtomically,
  removeUserTotp,
  createPasswordResetToken,
  getDepartmentById,
  getLatestInvitationForUser,
  getLatestPasswordResetTokenForUser,
  getUserById,
  getUserTotp,
  insertAuditLog,
  isUniqueConstraintError,
  listAssignedPresetGrants,
  listCurrentWorkPolicyAssignmentsForTenant,
  listInvitationsForTenant,
  listPasswordResetTokensForTenant,
  listTenantAssignedPresetNames,
  listTenantMembershipsWithDepartment,
  listTenantPresetGrantsByUser,
  listTenantTotpEnabledUserIds,
  listTenantUserIdsWithCredentials,
  listTenantUsers,
  listUserPolicyAssignments,
  insertWorkPolicyVersion,
  listWorkPolicyVersions,
  getTenantById,
  reactivateUser,
  revokeInvitation,
  revokePasswordResetToken,
  updateUserHireDate,
  updateUserLeaveGrantClass,
  upsertMembership,
  userHasCredential,
  type Database,
  type Invitation,
  type PasswordResetToken,
  type UserPolicyAssignmentHistoryRow,
  getOrCreateTenantWorkPolicy,
  getOrCreateTenantWorkPolicyByKind,
  getWorkPolicyById,
  listTenantWorkPolicies,
  assignUserWorkPolicy,
} from "@kizami/db";
import { isLeaveGrantClass, type LeaveGrantClass } from "@kizami/leave";
import type { AppEnv } from "../auth/middleware.js";
import { generateInvitationToken, INVITATION_TTL_MINUTES } from "../auth/invitation-token.js";
import { generatePasswordResetToken, PASSWORD_RESET_TTL_MINUTES } from "../auth/password-reset-token.js";
import { effectivePermissionsFromPresets, ForbiddenError, requirePermission } from "../authz.js";
import {
  DEFAULT_RETENTION_YEARS,
  evaluateRetention,
  localDateFromEpochMinutes,
  type RetentionStatus,
} from "../lib/data-retention.js";
import { resolveAccessibleDepartmentIds, resolveAccessibleUserIds } from "../lib/scope.js";
import { nowMinutes, todayLocalDate } from "../lib/time.js";
import { TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";
import type { TenantQuotas } from "../lib/tenant-quotas.js";
import { ASSIGNMENT_MANAGE_PERMISSION, assignPresetsToMember, PRESET_MANAGE_PERMISSION } from "./presets.js";
import { WORK_POLICY_PERMISSION } from "./settings/permissions.js";
import {
  FIXED_SETTLEMENT_PERIOD_PLACEHOLDER,
  isValidStandardDayMinutes,
  isWorkPolicyKind,
  versionEffectiveOn,
} from "./settings/work-policy-version-input.js";

const VIEW_PERMISSION = "member.view";
const EDIT_PERMISSION = "member.profile.edit";
// 招待式登録(docs/requirements.md §認証)。カタログ上は「メンバーを招待・追加できる」権限で、
// メンバー作成(POST /members)・招待の再発行/取り消しをこの1つの権限で保護する
// (依頼「新設しない」— 既存のメンバー管理系権限に合わせた)。
//
// パスワードリセット(管理者発行、Tier 0)の発行/取り消しもこの権限を流用する。カタログには
// パスワード/資格情報の再発行に特化した専用キーが無く(docs/design/permission-catalog.md
// §1.8「メンバー管理」に該当項目なし)、依頼の指示どおり「なければ member.invite」を適用した。
// 判断根拠: リセットは「ログイン手段を(再)発行する」という点で招待の再発行と同じ性質の操作
// であり、招待の再発行/取り消しと同じ権限・同じスコープ規約で保護するのが最も一貫している。
const INVITE_PERMISSION = "member.invite";
// 退職処理(無効化・再有効化)。カタログに専用キー `member.deactivate` が既にあるためそのまま使う
// (docs/design/permission-catalog.md §1.8。危険フラグ付き — 権限プリセット編集UIで重点表示される)。
const DEACTIVATE_PERMISSION = "member.deactivate";
/**
 * 退職者の個人データ消去(POST /:id/erase、2026-08-27、docs/design/data-retention.md)。
 *
 * 判断点: `member.deactivate` は流用しない。2FA リセットのときは「他人のログイン要件を
 * 一段弱める操作 = 退職処理と同格」として流用したが、消去は同格ではなく**一段重い**
 * (無効化には再有効化があるが、消去には戻す経路が存在しない)。カタログに専用キー
 * `member.erase` を新設した(packages/authz/src/catalog.ts、TENANT_ONLY・危険フラグ付き)。
 */
const ERASE_PERMISSION = "member.erase";

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 255;
/** ごく簡易な形式チェックのみ(実在確認はしない、送達確認は招待リンクの到達自体が兼ねる)。 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "YYYY-MM-DD" の書式チェックのみ(既存 routes/leave.ts の DATE_RE と同じ流儀)。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  return body as Record<string, unknown>;
}

type InviteStatus = "active" | "invited" | "invite_expired";

/**
 * メンバー一覧に出す招待状態。判定はここに集約する(依頼「判定ロジックはクエリ層かヘルパに集約」)。
 *
 * - active: 受諾済み(auth_credentials あり)。この判定を最優先し、受諾後は招待側の状態を見ない
 * - invited: 未受諾で、直近の招待が有効(未失効・期限内)
 * - invite_expired: それ以外すべて(未受諾かつ、招待が一度も無い/直近が失効済み/期限切れ)。
 *   「取り消し済みで未再発行」と「期限切れ」はどちらも実務上は同じ「管理者が再発行すべき」
 *   状態であり、依頼で定義された3値にこの2つを区別する枠が無いため、あえてまとめている
 *   (判断点)
 */
function inviteStatusFor(params: { hasCredential: boolean; latestInvitation: Invitation | null; now: number }): InviteStatus {
  if (params.hasCredential) return "active";
  const inv = params.latestInvitation;
  if (inv && inv.revokedAt === null && inv.acceptedAt === null && inv.expiresAt > params.now) {
    return "invited";
  }
  return "invite_expired";
}

/**
 * メンバー一覧に出すパスワードリセットのバッジ用フラグ(依頼「招待の inviteStatus と同じ流儀で」)。
 * 招待と違い受諾状態は関係しない(受諾済みユーザーへの発行が前提の機能のため)ので、単純に
 * 「直近のリセットトークンが未使用・未失効・期限内か」だけを見る真偽値にする(3値のような
 * 状態遷移がなく、判断点として複雑化させる理由がないため)。
 */
function hasPendingPasswordResetFor(params: { latestPasswordReset: PasswordResetToken | null; now: number }): boolean {
  const pr = params.latestPasswordReset;
  return pr !== null && pr.revokedAt === null && pr.usedAt === null && pr.expiresAt > params.now;
}

/**
 * listUserPolicyAssignments() が返す履歴(effectiveFrom 昇順)から、指定日時点で実効の割当を
 * 解決する(「date 以下で最大の effectiveFrom」、apps/api/src/lib/settings.ts の
 * `latestAtOrBefore` と同じ規則。あちらは engine 用の型を扱うため、ここでは
 * `UserPolicyAssignmentHistoryRow` 向けに同じロジックを小さく再実装している)。
 * 該当が無ければ null(まだ一度も割当が無い、または全ての割当が date より未来)。
 */
function resolveEffectiveAssignment(
  history: UserPolicyAssignmentHistoryRow[],
  date: string,
): UserPolicyAssignmentHistoryRow | null {
  let chosen: UserPolicyAssignmentHistoryRow | null = null;
  for (const h of history) {
    if (h.effectiveFrom <= date && (chosen === null || h.effectiveFrom > chosen.effectiveFrom)) {
      chosen = h;
    }
  }
  return chosen;
}

/**
 * 制度の id で割り当てる前の検査(2026-10-05、名前付きの制度)。招待(POST /)と
 * POST /:id/work-policy の両方で使う。
 *
 * - id が文字列でない・このテナントの制度でない → 400 invalid_work_policy_id
 *   (他テナントの制度の存在は明かさない。部署の invalid_department_id と同じ扱い)
 * - アーカイブ済み → 409 work_policy_archived(アーカイブは「新しい割当に出さない」こと)
 * - 割当の適用開始日の時点で有効な版が無い(制度の初版がそれより後)→ 409
 *   work_policy_not_effective_yet。素通しにすると、その間の月次・有給で buildSettingsTimeline が
 *   版を解決できず 500 になるため、入口で止める
 */
async function checkAssignableWorkPolicy(
  db: Database,
  params: { tenantId: string; workPolicyId: unknown; effectiveFrom: string },
): Promise<
  | { ok: true; policy: { id: string; name: string }; version: { kind: string; standardDayMinutes: number } }
  | { ok: false; status: 400 | 409; error: string }
> {
  if (typeof params.workPolicyId !== "string" || params.workPolicyId === "") {
    return { ok: false, status: 400, error: "invalid_work_policy_id" };
  }
  const policy = await getWorkPolicyById(db, { tenantId: params.tenantId, id: params.workPolicyId });
  if (!policy) return { ok: false, status: 400, error: "invalid_work_policy_id" };
  if (policy.archivedAt !== null) return { ok: false, status: 409, error: "work_policy_archived" };
  const versions = await listWorkPolicyVersions(db, { tenantId: params.tenantId, workPolicyId: policy.id });
  const version = versionEffectiveOn(versions, params.effectiveFrom);
  if (!version) return { ok: false, status: 409, error: "work_policy_not_effective_yet" };
  return { ok: true, policy: { id: policy.id, name: policy.name }, version };
}

/**
 * メンバー1人分の保持期間の状態(2026-08-27、docs/design/data-retention.md)。
 *
 * `deactivated_at`(UTC エポック分)をローカル暦日に落としてから純関数
 * `evaluateRetention` に渡す。在籍中(isActive=true)は退職日そのものが存在しないので
 * null を渡し、`erasable: false` になる。
 */
function retentionStatusFor(params: {
  user: { isActive: boolean; deactivatedAt: number | null };
  retentionYears: number;
  today: string;
}): RetentionStatus {
  const { user, retentionYears, today } = params;
  const deactivatedDate =
    user.isActive || user.deactivatedAt === null ? null : localDateFromEpochMinutes(user.deactivatedAt, TZ_OFFSET_MINUTES_JST);
  return evaluateRetention({ deactivatedDate, retentionYears, today });
}

export function createMembersRoutes(db: Database, deps: { quotas?: TenantQuotas } = {}) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") },
      permission: VIEW_PERMISSION,
    });

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const [
      tenantUsers,
      membershipRows,
      presetNameRows,
      invitationRows,
      credentialUserIds,
      passwordResetRows,
      workPolicyByUser,
      totpEnabledUserIds,
      tenant,
      workPolicies,
    ] =
      await Promise.all([
        listTenantUsers(db, user.tenantId),
        listTenantMembershipsWithDepartment(db, user.tenantId),
        listTenantAssignedPresetNames(db, user.tenantId),
        listInvitationsForTenant(db, user.tenantId),
        listTenantUserIdsWithCredentials(db, user.tenantId),
        listPasswordResetTokensForTenant(db, user.tenantId),
        // 現在の労働時間制(UI バッジ用、2026-08-23 追加)。テナント全体を2クエリで一括解決する
        // (packages/db/src/queries/work-policies.ts の listCurrentWorkPolicyAssignmentsForTenant 参照、
        // ユーザーごとの個別クエリにはしない — N+1 回避)。2026-10-05 から制度の id も返す
        // (同じ kind の制度が複数ありうるため、制度名を出すのに id が要る)。
        listCurrentWorkPolicyAssignmentsForTenant(db, { tenantId: user.tenantId, asOfDate: today }),
        // 二要素認証の有効状態(UI バッジ + 「2FAをリセット」ボタンの出し分け、2026-08-27)。
        // テナント分を1クエリで取る(ユーザーごとの個別クエリにしない — N+1 回避)。
        listTenantTotpEnabledUserIds(db, user.tenantId),
        // 退職者データの保持年数(2026-08-27、docs/design/data-retention.md)。
        // 一覧に「消去可能になった退職者」を出すために必要(判定は暦日で行う純関数
        // evaluateRetention に委譲する)。
        getTenantById(db, user.tenantId),
        // 制度名の解決用(2026-10-05、名前付きの制度)。テナントの制度は数本〜十数本なので全件で足りる。
        listTenantWorkPolicies(db, user.tenantId),
      ]);
    const workPolicyNameById = new Map(workPolicies.map((p) => [p.id, p.name]));
    const allUsers = accessibleUserIds === "all" ? tenantUsers : tenantUsers.filter((u) => accessibleUserIds.has(u.id));

    // membershipRows は createdAt 降順。1ユーザーに複数行あり得るため最初に出現した
    // (=最新の)行だけを採用する(packages/db/src/queries/members.ts の規約)。
    const departmentByUser = new Map<string, { id: string; name: string }>();
    for (const m of membershipRows) {
      if (!departmentByUser.has(m.userId)) {
        departmentByUser.set(m.userId, { id: m.departmentId, name: m.departmentName });
      }
    }

    const presetNamesByUser = new Map<string, string[]>();
    for (const p of presetNameRows) {
      const list = presetNamesByUser.get(p.userId) ?? [];
      list.push(p.presetName);
      presetNamesByUser.set(p.userId, list);
    }

    // invitationRows は createdAt 降順(queries/invitations.ts の規約)。同一 userId が
    // 複数出現し得るため最初に出現した(=最新の)招待だけを採用する。
    const latestInvitationByUser = new Map<string, Invitation>();
    for (const inv of invitationRows) {
      if (!latestInvitationByUser.has(inv.userId)) {
        latestInvitationByUser.set(inv.userId, inv);
      }
    }

    // passwordResetRows も createdAt 降順(queries/password-resets.ts の規約)。同一 userId が
    // 複数出現し得るため最初に出現した(=最新の)トークンだけを採用する。
    const latestPasswordResetByUser = new Map<string, PasswordResetToken>();
    for (const pr of passwordResetRows) {
      if (!latestPasswordResetByUser.has(pr.userId)) {
        latestPasswordResetByUser.set(pr.userId, pr);
      }
    }

    const now = nowMinutes();
    const retentionYears = tenant?.personalDataRetentionYears ?? DEFAULT_RETENTION_YEARS;

    return c.json({
      members: allUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        // 退職者データのライフサイクル(2026-08-27、docs/design/data-retention.md)。
        // deactivatedAt が null の無効化済みユーザー(この機能より前に退職処理された行)は
        // retention.erasable が false になる — 起算日不明のものを消してよいとは答えない。
        erasedAt: u.erasedAt,
        retention: retentionStatusFor({ user: u, retentionYears, today }),
        // 入社日(2026-08-22 追加)。法定付与の計算に使う(routes/leave.ts の
        // POST /leave/grants/auto)。null = 未設定 → 法定付与ができない(画面側で警告表示)。
        hireDate: u.hireDate,
        // 有給付与の区分(2026-08-24 追加、労基法39条3項の比例付与)。想定外の値は "full"
        // に倒す(少なく付与する方向へ倒さない — packages/leave/src/statutory.ts の判断点)。
        leaveGrantClass: isLeaveGrantClass(u.leaveGrantClass) ? u.leaveGrantClass : "full",
        department: departmentByUser.get(u.id) ?? null,
        presetNames: presetNamesByUser.get(u.id) ?? [],
        // 招待式登録(2026-08-23 追加)の状態。値の意味は inviteStatusFor() 参照。
        inviteStatus: inviteStatusFor({
          hasCredential: credentialUserIds.has(u.id),
          latestInvitation: latestInvitationByUser.get(u.id) ?? null,
          now,
        }),
        // パスワードリセット(管理者発行、Tier 0)の未処理トークン有無。UI バッジ用。
        hasPendingPasswordReset: hasPendingPasswordResetFor({
          latestPasswordReset: latestPasswordResetByUser.get(u.id) ?? null,
          now,
        }),
        // 現在の労働時間制("flex" | "fixed")。UI バッジ用。null = 割当が一度も無い、または
        // 解決不能(通常起こり得ない不整合) — どちらも同じ null として表す
        // (listCurrentWorkPolicyKindsForTenant の規約、割当自体が無いユーザーは Map に
        // 含まれないため `.get(u.id) ?? null` で両ケースとも null に落ちる)。
        workSystemKind: workPolicyByUser.get(u.id)?.kind ?? null,
        // 現在割り当てられている制度(2026-10-05、名前付きの制度)。null = 割当が一度も無い。
        workPolicyId: workPolicyByUser.get(u.id)?.workPolicyId ?? null,
        workPolicyName: workPolicyNameById.get(workPolicyByUser.get(u.id)?.workPolicyId ?? "") ?? null,
        // 二要素認証(TOTP)を有効化済みか(2026-08-27)。UI バッジと、ロックアウト救済の
        // 「2FAをリセット」ボタンの出し分けに使う(docs/design/two-factor-auth.md)。
        twoFactorEnabled: totpEnabledUserIds.has(u.id),
      })),
    });
  });

  /**
   * メンバー作成 + 招待発行(招待式登録の起点、docs/requirements.md §認証)。
   * この時点では users 行のみができ、auth_credentials はまだ作らない(受諾するまでログイン不可、
   * routes/invitations.ts の POST /invitations/:token/accept で初めて作られる)。
   */
  app.post("/", async (c) => {
    requirePermission(c, INVITE_PERMISSION, "department");
    const actor = c.get("user");

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const { email, name, departmentId, hireDate, presetIds, workPolicyId } = body as {
      email?: unknown;
      name?: unknown;
      departmentId?: unknown;
      hireDate?: unknown;
      presetIds?: unknown;
      workPolicyId?: unknown;
    };

    if (typeof email !== "string" || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
      return c.json({ error: "invalid_email" }, 400);
    }
    if (typeof name !== "string" || name.trim() === "" || name.length > MAX_NAME_LENGTH) {
      return c.json({ error: "invalid_name" }, 400);
    }

    // セキュリティ(レビュー指摘 F2): departmentId 省略時、以前は下のスコープ絞り込みが
    // 丸ごとスキップされ、department/department_and_descendants スコープの招待者が
    // 「部署未設定」のメンバーをテナント全体に対して自由に作成できてしまっていた
    // (絞り込みは「departmentId が指定された場合」にしか効かないザル穴 — スコープの素通り)。
    // actor のスコープが tenant でない限り、departmentId の省略そのものを拒否する
    // (department 未設定の新規メンバーを作れるのは tenant スコープの招待者だけにする)。
    const actorInviteScope = c.get("permissions").get(INVITE_PERMISSION);
    if (departmentId === undefined && actorInviteScope !== "tenant") {
      return c.json({ error: "department_id_required" }, 400);
    }

    let resolvedDepartmentId: string | undefined;
    if (departmentId !== undefined) {
      if (typeof departmentId !== "string") return c.json({ error: "invalid_department_id" }, 400);
      const department = await getDepartmentById(db, { tenantId: actor.tenantId, id: departmentId });
      if (!department) return c.json({ error: "invalid_department_id" }, 400);

      // member.profile.edit の所属変更(PATCH /:id)と同じ絞り込み: department スコープの
      // 招待者が自分の管轄外の部署へ新規メンバーを送り込めてしまわないようにする。
      const accessibleDeptIds = await resolveAccessibleDepartmentIds(db, {
        actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
        permission: INVITE_PERMISSION,
      });
      if (accessibleDeptIds !== "all" && !accessibleDeptIds.has(department.id)) {
        throw new ForbiddenError(`department ${department.id} is outside actor's scope`);
      }
      resolvedDepartmentId = department.id;
    }

    let resolvedHireDate: string | null = null;
    if (hireDate !== undefined && hireDate !== null) {
      if (typeof hireDate !== "string" || !DATE_RE.test(hireDate)) {
        return c.json({ error: "invalid_hire_date" }, 400);
      }
      resolvedHireDate = hireDate;
    }

    let presetIdList: string[] | undefined;
    if (presetIds !== undefined) {
      if (!Array.isArray(presetIds) || !presetIds.every((v): v is string => typeof v === "string")) {
        return c.json({ error: "invalid_body" }, 400);
      }
      // プリセット割当も同時に行う場合は permission.assignment.manage も要る(member.invite
      // だけでは、招待作成に便乗して任意の権限プリセットを付与できてしまうため — PUT
      // /members/:id/presets と同じ権限で保護する)。ユーザー作成前に検証し、権限が無ければ
      // ここで打ち切る(招待済みだが presetIds は無視、のような中途半端な状態を作らないため)。
      requirePermission(c, ASSIGNMENT_MANAGE_PERMISSION, "department");
      presetIdList = presetIds;
    }

    // 招待と同時の制度の割当(2026-10-05、名前付きの制度)。割当先の制度は所定労働時間を通じて
    // 賃金に直結するため、presetIds と同じ考え方で、指定した場合だけ POST /:id/work-policy と同じ
    // WORK_POLICY_PERMISSION も要求する(member.invite だけでは選べない)。適用開始日は既定の制度の
    // 自動割当と同じ「入社日(未指定なら今日)」。
    const assignmentEffectiveFrom = resolvedHireDate ?? todayLocalDate(TZ_OFFSET_MINUTES_JST);
    let chosenWorkPolicyId: string | undefined;
    if (workPolicyId !== undefined && workPolicyId !== null) {
      requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
      const checked = await checkAssignableWorkPolicy(db, {
        tenantId: actor.tenantId,
        workPolicyId,
        effectiveFrom: assignmentEffectiveFrom,
      });
      if (!checked.ok) return c.json({ error: checked.error }, checked.status);
      chosenWorkPolicyId = checked.policy.id;
    }

    // 利用上限(lib/tenant-quotas.ts)。在籍メンバー数(招待中を含む)が配備の上限に達していたら断る
    const capacity = await deps.quotas?.checkMemberCapacity(db, actor.tenantId);
    if (capacity && !capacity.ok) return c.json({ error: "member_limit_reached", limit: capacity.limit }, 409);

    // 招待・再設定リンクの発行数の上限(管理者の操作だけが使う枠。lib/tenant-quotas.ts)
    if (deps.quotas && !(await deps.quotas.consumeInviteResetMail(db, actor.tenantId))) {
      return c.json({ error: "invite_reset_limit_reached" }, 409);
    }

    const now = nowMinutes();
    // トークンの生成自体は DB を伴わない純粋な計算(crypto乱数 + ハッシュ化)のため、
    // 書き込みの前に済ませておく(トランザクションの保持時間を必要最小限にする)。
    const { token, hash } = await generateInvitationToken();

    // 1単位(レビュー指摘): ユーザー作成・所属・制度の割当・招待作成・監査ログ追記をまとめて書く。
    // 以前はこれらが個別のクエリとして実行されており、例えば招待作成が失敗すると
    // 「ユーザー行だけ作られ、招待が一切飛ばない」ユーザーが残ってしまっていた(手動での後始末が
    // 必要になる不整合)。2026-10-08 から db.transaction() ではなく packages/db の atomic plan
    // (`createInvitedMember`)で書く — D1 でも動く(docs/design/d1-atomic-writes.md #23)。
    //
    // テナント既定の労働時間制を自動割当する(2026-08-23)。これが無いと招待で作られた
    // メンバーは制度未割当のまま(buildSettingsTimeline が解決できず有給・月次が 500)。
    // 適用開始日は入社日(未指定なら今日)— 入社日より前の期間は集計対象にならないため。
    // 別の制度にしたい場合は後から work policy の割当を追加すれば上書きされる(effective-dated)。
    // 2026-10-05: 招待で制度を選んだ場合(workPolicyId)はその制度を割り当てる(上の検証済み)。
    //
    // presetIds の割当(assignPresetsToMember)は既存の設計判断どおりこの単位の外に
    // 残す: 固定原則(自己昇格・自己降格・最後の権限管理保持者保護)の検証を含む独立した
    // ドメインロジックであり、万一 presetIds が不正でも「作成・招待自体は確実に成立させる」
    // という元々のコメントの意図(下記参照)をそのまま維持するため。
    let target: Awaited<ReturnType<typeof createInvitedMember>>["user"];
    let invitation: Awaited<ReturnType<typeof createInvitedMember>>["invitation"];
    try {
      const created = await createInvitedMember(db, {
        tenantId: actor.tenantId,
        email,
        name: name.trim(),
        hireDate: resolvedHireDate,
        ...(resolvedDepartmentId !== undefined ? { departmentId: resolvedDepartmentId } : {}),
        ...(chosenWorkPolicyId !== undefined ? { workPolicyId: chosenWorkPolicyId } : {}),
        defaultWorkPolicyName: "標準",
        effectiveFrom: assignmentEffectiveFrom,
        tokenHash: hash,
        expiresAt: now + INVITATION_TTL_MINUTES,
        actorId: actor.id,
        createdAt: now,
      });
      target = created.user;
      invitation = created.invitation;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return c.json({ error: "email_already_exists" }, 409);
      }
      throw err;
    }

    // presetIds の反映は招待発行の後(書き込みの確定後)に行う: 万一 presetIds が
    // 不正(未知のID等)でも、「作成はしたが招待は一切飛ばせなかった」状態を避け、招待自体は
    // 確実に成立させる(presetsは後からでも PUT /members/:id/presets で直せるが、招待し直しは
    // 再発行の手間がかかるため、失敗時の実害が小さい方を後段に置いた判断)。
    if (presetIdList !== undefined) {
      const result = await assignPresetsToMember({
        db,
        actor: { id: actor.id, tenantId: actor.tenantId },
        targetUserId: target.id,
        presetIds: presetIdList,
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status);
      }
    }

    // 平文トークンはこのレスポンスにのみ含まれる(以後は二度と取得できない、routes/api-keys.ts
    // と同じ作法)。inviteUrl のような完成URLはここでは組み立てない — API は Web の
    // オリジンを知らないため、フロント側で token からリンクを組み立てる(依頼の判断点)。
    return c.json(
      {
        member: {
          id: target.id,
          name: target.name,
          email: target.email,
          isActive: target.isActive,
          hireDate: target.hireDate,
          department: resolvedDepartmentId ? { id: resolvedDepartmentId } : null,
        },
        invitation: { id: invitation.id, token, expiresAt: invitation.expiresAt },
      },
      201,
    );
  });

  /** 招待の再発行(旧招待は revoke される)。既に受諾済み(active)なら 409。 */
  app.post("/:id/invitations", async (c) => {
    requirePermission(c, INVITE_PERMISSION, "department");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: INVITE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    // 退職処理(無効化)済みのメンバーへの招待再発行は不可(依頼の判断点: 退職者にログイン手段を
    // 与え直す操作は、再有効化(POST /:id/reactivate)を経由すべきであり、この経路からは通さない)。
    if (!target.isActive) {
      return c.json({ error: "member_inactive" }, 409);
    }

    if (await userHasCredential(db, { tenantId: actor.tenantId, userId: id })) {
      return c.json({ error: "already_active" }, 409);
    }

    // 招待・再設定リンクの発行数の上限(管理者の操作だけが使う枠。lib/tenant-quotas.ts)
    if (deps.quotas && !(await deps.quotas.consumeInviteResetMail(db, actor.tenantId))) {
      return c.json({ error: "invite_reset_limit_reached" }, 409);
    }

    const now = nowMinutes();
    const { token, hash } = await generateInvitationToken();
    const invitation = await createInvitation(db, {
      tenantId: actor.tenantId,
      userId: id,
      tokenHash: hash,
      expiresAt: now + INVITATION_TTL_MINUTES,
      createdBy: actor.id,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.invite.reissue",
      targetType: "user",
      targetId: id,
      detail: JSON.stringify({}),
      occurredAt: now,
    });

    return c.json({ invitation: { id: invitation.id, token, expiresAt: invitation.expiresAt } }, 201);
  });

  /** 招待の取り消し。対象に未決着(未受諾・未失効)の招待が無ければ 404、既に決着済みなら 409。 */
  app.delete("/:id/invitations", async (c) => {
    requirePermission(c, INVITE_PERMISSION, "department");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: INVITE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    const latest = await getLatestInvitationForUser(db, { tenantId: actor.tenantId, userId: id });
    if (!latest) return c.json({ error: "not_found" }, 404);

    const now = nowMinutes();
    const revoked = await revokeInvitation(db, { tenantId: actor.tenantId, id: latest.id, revokedAt: now });
    if (!revoked) {
      // 直近の招待が既に受諾済み・失効済み(同時取り消し等の競合含む)。
      return c.json({ error: latest.acceptedAt !== null ? "already_accepted" : "already_revoked" }, 409);
    }

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.invite.revoke",
      targetType: "user",
      targetId: id,
      detail: JSON.stringify({}),
      occurredAt: now,
    });

    return c.json({ invitation: { id: revoked.id, revokedAt: revoked.revokedAt } });
  });

  /**
   * パスワードリセットの管理者発行(Tier 0)。対象は受諾済み(auth_credentials あり)の
   * メンバーに限る — 未受諾者(招待中)は招待の再発行(POST /:id/invitations)が正しい導線
   * であり、そちらへ誘導する意味で 409 not_active を返す(依頼の指示どおりのエラー名)。
   */
  app.post("/:id/password-resets", async (c) => {
    requirePermission(c, INVITE_PERMISSION, "department");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: INVITE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    // 退職処理(無効化)済みのメンバーへのリセット発行は不可(依頼の判断点、招待再発行と同じ扱い)。
    // 「not_active」(未受諾)とは別のエラー名にして、UI 側が原因を出し分けられるようにする。
    if (!target.isActive) {
      return c.json({ error: "member_inactive" }, 409);
    }

    if (!(await userHasCredential(db, { tenantId: actor.tenantId, userId: id }))) {
      return c.json({ error: "not_active" }, 409);
    }

    // 招待・再設定リンクの発行数の上限(管理者の操作だけが使う枠。lib/tenant-quotas.ts)
    if (deps.quotas && !(await deps.quotas.consumeInviteResetMail(db, actor.tenantId))) {
      return c.json({ error: "invite_reset_limit_reached" }, 409);
    }

    const now = nowMinutes();
    const { token, hash } = await generatePasswordResetToken();
    const resetToken = await createPasswordResetToken(db, {
      tenantId: actor.tenantId,
      userId: id,
      tokenHash: hash,
      expiresAt: now + PASSWORD_RESET_TTL_MINUTES,
      createdBy: actor.id,
      createdAt: now,
    });

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.password_reset.issue",
      targetType: "user",
      targetId: id,
      detail: JSON.stringify({}),
      occurredAt: now,
    });

    // 平文トークンはこのレスポンスにのみ含まれる(以後は二度と取得できない、招待発行と同じ作法)。
    return c.json({ passwordReset: { id: resetToken.id, token, expiresAt: resetToken.expiresAt } }, 201);
  });

  /** パスワードリセットの取り消し。対象に未決着(未使用・未失効)のトークンが無ければ 404、既に決着済みなら 409。 */
  app.delete("/:id/password-resets", async (c) => {
    requirePermission(c, INVITE_PERMISSION, "department");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: INVITE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    const latest = await getLatestPasswordResetTokenForUser(db, { tenantId: actor.tenantId, userId: id });
    if (!latest) return c.json({ error: "not_found" }, 404);

    const now = nowMinutes();
    const revoked = await revokePasswordResetToken(db, { tenantId: actor.tenantId, id: latest.id, revokedAt: now });
    if (!revoked) {
      // 直近のトークンが既に使用済み・失効済み(同時取り消し等の競合含む)。
      return c.json({ error: latest.usedAt !== null ? "already_used" : "already_revoked" }, 409);
    }

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.password_reset.revoke",
      targetType: "user",
      targetId: id,
      detail: JSON.stringify({}),
      occurredAt: now,
    });

    return c.json({ passwordReset: { id: revoked.id, revokedAt: revoked.revokedAt } });
  });

  /**
   * 退職処理(無効化)。固定原則: 最後の「権限管理」(`permission.preset.manage`)保持者は
   * 無効化不可(routes/presets.ts の assignPresetsToMember と同じ判定ロジックをここでも適用する
   * — 割当を外す操作ではないが、無効化されたユーザーは実効的に権限を行使できなくなるため、
   * 「最後の1人からその権限を失わせる操作」として同じ保護をかける)。自分自身の無効化も不可。
   *
   * isActive=false・全セッション revoke・pending 招待 revoke・未使用リセットトークン revoke・
   * 監査ログ追記は1つの db.transaction にまとめる(members.ts の POST / 〔メンバー作成〕と同じ
   * 「途中失敗で不整合な半端状態を残さない」判断)。
   */
  app.post("/:id/deactivate", async (c) => {
    requirePermission(c, DEACTIVATE_PERMISSION, "department");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    // 自分自身の無効化は不可(自分のログイン手段を自分で奪えてしまう事故防止)。
    if (id === actor.id) {
      return c.json({ error: "cannot_deactivate_self" }, 409);
    }

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: DEACTIVATE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    if (!target.isActive) {
      return c.json({ error: "already_inactive" }, 409);
    }

    // 固定原則: 最後の「権限管理」保持者の保護(routes/presets.ts の assignPresetsToMember の
    // 判定を土台にするが、無効化特有の1点だけ変えている: 他の保持者を数える際、既に isActive=false
    // な保持者は除外する。presets.ts 側は割当変更の対象が常に active なメンバーである前提のため
    // isActive を見ないが、無効化はまさに「holder が active から inactive に変わる」操作なので、
    // 既に無効化済みの holder を「他に1人いる」とカウントしてしまうと、実際にはログインできる
    // 権限管理者が0人になる無効化を通してしまう(判断点)。
    const targetGrantSets = await listAssignedPresetGrants(db, { tenantId: actor.tenantId, userId: id });
    const targetEffective = effectivePermissionsFromPresets(targetGrantSets);
    if (targetEffective.has(PRESET_MANAGE_PERMISSION)) {
      const [allGrantsByUser, tenantUsers] = await Promise.all([
        listTenantPresetGrantsByUser(db, actor.tenantId),
        listTenantUsers(db, actor.tenantId),
      ]);
      const activeUserIds = new Set(tenantUsers.filter((u) => u.isActive).map((u) => u.id));
      let otherHolders = 0;
      for (const [userId, rawGrantSets] of allGrantsByUser) {
        if (userId === id || !activeUserIds.has(userId)) continue;
        const effective = effectivePermissionsFromPresets(rawGrantSets);
        if (effective.has(PRESET_MANAGE_PERMISSION)) otherHolders++;
      }
      if (otherHolders === 0) {
        return c.json({ error: "last_admin" }, 409);
      }
    }

    const now = nowMinutes();
    // 無効化(deactivatedAt の記録、2026-08-27。個人データ保持期間の起算日になる — これが無いと
    // 「いつ退職したか」が分からず消去可能日を決められない)・全セッション・招待・リセットトークンの
    // 失効・監査ログを1単位で書く(packages/db の deactivateMember。atomic plan なので D1 でも動く)。
    await deactivateMember(db, { tenantId: actor.tenantId, userId: id, actorId: actor.id, nowMinutes: now });

    return c.json({ member: { id, isActive: false, deactivatedAt: now } });
  });

  /**
   * 二要素認証(2FA)のリセット(ロックアウト救済、2026-08-27)。
   * docs/design/two-factor-auth.md「管理者によるリセット」。
   *
   * 認証アプリを入れた端末を失くし、リカバリコードも手元に無い従業員を救う唯一の経路。
   * TOTP の登録とリカバリコードを消すだけで、パスワードには触れない(次のログインは
   * パスワードのみで通り、本人が改めて 2FA を設定し直す)。
   *
   * ## 権限の選定(判断点)
   *
   * `member.deactivate`(退職処理)と同格に置く。これは**他人のログイン要件を一段弱める**操作で、
   * 攻撃者から見れば「2FA を消してからパスワードを総当たり/リセットする」踏み台になる。
   * `member.invite`(招待・パスワードリセット発行)より重い扱いが妥当で、カタログ上
   * 「危険」と印の付いた既存キーは `member.deactivate` — 専用キーを新設せず、これを流用する。
   *
   * ## 事後の可視性
   *
   * 監査ログ(`member.totp.reset`)に加え、**本人へアプリ内通知を送る**。管理者が黙って
   * 2FA を外せてしまうと、乗っ取られた管理者アカウントによる 2FA 解除に本人が気づけない。
   * 通知は「受け取り設定で OFF にできない」アプリ内のみに送る(個人チャネルの
   * カテゴリには載せない — セキュリティ事象は本人が黙らせられるべきではないため。
   * apps/api/src/lib/notification-preferences.ts の resolveNotificationCategory には
   * 意図的に追加していない)。
   */
  app.post("/:id/two-factor/reset", async (c) => {
    requirePermission(c, DEACTIVATE_PERMISSION, "department");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: DEACTIVATE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    const existing = await getUserTotp(db, { tenantId: actor.tenantId, userId: id });
    if (!existing) return c.json({ error: "not_enabled" }, 409);

    const now = nowMinutes();
    // TOTP・リカバリコードの削除・監査ログ・本人への通知を1単位で書く(packages/db の removeUserTotp。
    // atomic plan なので D1 でも動く)。
    await removeUserTotp(db, {
      tenantId: actor.tenantId,
      userId: id,
      audit: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: "member.totp.reset",
        targetType: "user",
        targetId: id,
        detail: JSON.stringify({}),
        occurredAt: now,
      },
      notification: {
        tenantId: actor.tenantId,
        userId: id,
        type: "security_totp_reset",
        // 勤怠日に紐づかない通知なので null(notifications の UNIQUE は NULL 同士を
        // 区別するため、リセットのたびに新しい通知が作られる — schema/notifications.ts の判断点)。
        subjectDate: null,
        title: "二要素認証が管理者によって解除されました",
        body: `${actor.displayName} が二要素認証の設定を解除しました。心当たりがない場合は、すぐに管理者へ連絡してください。再設定は「設定 → セキュリティ」から行えます。`,
        createdAt: now,
      },
    });

    return c.json({ member: { id, twoFactorEnabled: false } });
  });

  /** 再有効化。isActive=true に戻すのみ(セッション・招待・リセットトークンの復元は行わない — 必要なら改めて発行する)。 */
  app.post("/:id/reactivate", async (c) => {
    requirePermission(c, DEACTIVATE_PERMISSION, "department");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: DEACTIVATE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    if (target.isActive) {
      return c.json({ error: "already_active" }, 409);
    }

    // 消去済み(erased)は無効化とは別の**終端状態**であり、再有効化できない(2026-08-27)。
    // 氏名・メール・認証情報は既に失われていて戻す先が無く、tombstone のまま復活させると
    // 「削除済みユーザー」という名前でログインできる人ができてしまう。
    if (target.erasedAt !== null) {
      return c.json({ error: "already_erased" }, 409);
    }

    // 再有効化も在籍者が1人増えるので、招待と同じ利用上限(lib/tenant-quotas.ts)を掛ける
    const capacity = await deps.quotas?.checkMemberCapacity(db, actor.tenantId);
    if (capacity && !capacity.ok) return c.json({ error: "member_limit_reached", limit: capacity.limit }, 409);

    const now = nowMinutes();
    await reactivateUser(db, { tenantId: actor.tenantId, userId: id });

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.reactivate",
      targetType: "user",
      targetId: id,
      detail: JSON.stringify({}),
      occurredAt: now,
    });

    return c.json({ member: { id, isActive: true } });
  });

  /**
   * 退職者の個人データ消去(匿名化)。2026-08-27、docs/design/data-retention.md。
   *
   * ## 何をするか
   *
   * 氏名を「削除済みユーザー」に、メールを tombstone(`user_deleted_<id>@invalid`)に置き換え、
   * 認証情報・2FA・セッション・プッシュ購読・個人通知設定・APIキー・招待/リセットトークン・
   * Slack連携・本人宛通知を物理削除し、punch_events の IP/UA/GPS 列を null 化する。
   * **勤怠記録の行そのものは1件も消さない**(労働基準法109条の保存義務と集計の完全性)。
   * 実際の消去処理と各テーブルの線引きの理由は packages/db/src/queries/erasure.ts を参照。
   *
   * ## 実行できる条件(3段)
   *
   * 1. 退職処理済み(`isActive=false`)であること。在籍者の個人データは利用目的が達成されていない
   * 2. 退職日(`deactivatedAt`)が記録されていること。起算日が分からないものは消させない
   * 3. 退職日 + テナント設定の保持年数(3 or 5)が**経過している**こと。未経過は
   *    409 `retention_period_active`(残り日数・消去可能日つき)で断る
   *
   * ## 冪等ではなく 409 で弾く
   *
   * 2回目の実行は 409 `already_erased`。冪等に 200 を返すと「消したつもりの相手が実は別人だった」
   * ときに気づけないうえ、監査ログに同じ操作が何度も並ぶ。取り返しのつかない操作は、
   * 「もう終わっている」ことを明示的に伝えるほうが安全。
   *
   * ## 監査ログ
   *
   * `member.erase` を追記する。target は ID 参照(`user:<id>`)なので、匿名化後もどの行に対する
   * 操作だったかは辿れる一方、氏名は残らない。detail には消した件数の内訳だけを入れ、
   * **消した値そのもの(氏名・メール)は絶対に入れない** — 監査ログに書けば消したことにならない。
   */
  app.post("/:id/erase", async (c) => {
    // TENANT_ONLY のカタログ項目なので、要求スコープもテナント全体
    // (部署長が自部署の退職者だけ消せる、という状態を作らない)。
    requirePermission(c, ERASE_PERMISSION, "tenant");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    // 他テナントのユーザーIDを指定した場合もここで 404(getUserById が tenantId で絞る)。
    if (!target) return c.json({ error: "not_found" }, 404);

    // 自分自身は消せない(そもそも自分を無効化できないので到達し得ないが、
    // 「取り返しのつかない操作を自分に対して行えない」ことを明示的に守る)。
    if (id === actor.id) {
      return c.json({ error: "cannot_erase_self" }, 409);
    }

    if (target.erasedAt !== null) {
      return c.json({ error: "already_erased" }, 409);
    }

    if (target.isActive) {
      return c.json({ error: "not_deactivated" }, 409);
    }

    const tenant = await getTenantById(db, actor.tenantId);
    const retentionYears = tenant?.personalDataRetentionYears ?? DEFAULT_RETENTION_YEARS;
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const retention = retentionStatusFor({ user: target, retentionYears, today });

    // 退職日が記録されていない(この機能より前に無効化された行)。起算日不明のまま消させない。
    // 復旧手順は再有効化 → 退職処理のやり直し(docs/design/data-retention.md「移行」)。
    if (retention.deactivatedDate === null) {
      return c.json({ error: "deactivated_at_unknown" }, 409);
    }

    if (!retention.erasable) {
      return c.json(
        {
          error: "retention_period_active",
          retention: { ...retention, retentionYears },
        },
        409,
      );
    }

    const now = nowMinutes();
    // 匿名化・物理削除・null 化・監査ログを1単位で書く(packages/db の eraseUserPersonalDataAtomically。
    // atomic plan なので D1 でも動く)。users の匿名化は `erased_at IS NULL` の claim なので、
    // 事前判定をすり抜けた同時の二重消去は片方だけが通り、負けた側は何も書かない(→ 409)。
    // 監査ログの件数は計画の前に数えたもの(packages/db/src/queries/erasure.ts 冒頭の判断点)。
    const result = await eraseUserPersonalDataAtomically(db, {
      tenantId: actor.tenantId,
      userId: id,
      erasedAt: now,
      audit: (removed) => ({
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: "member.erase",
        targetType: "user",
        targetId: id,
        // 消した値そのものは入れない(上記コメント)。何件消えたかの内訳と、
        // どの保持期間設定・どの退職日を根拠に許可したかだけを残す。
        detail: JSON.stringify({
          removed,
          retentionYears,
          deactivatedDate: retention.deactivatedDate,
          erasableFrom: retention.erasableFrom,
        }),
        occurredAt: now,
      }),
    });
    if (result === null) {
      return c.json({ error: "already_erased" }, 409);
    }

    return c.json({
      member: { id, isActive: false, erasedAt: now, name: result.name, email: result.email },
      removed: result.removed,
    });
  });

  app.patch("/:id", async (c) => {
    requirePermission(c, EDIT_PERMISSION, "department");
    const user = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: user.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    // 404(存在しない)を先に判定してから、実在する対象がスコープ外かを判定する
    // (対象の有無を先に漏らさない一般的な優先順位に加え、既存テストの404期待とも整合する)。
    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") },
      permission: EDIT_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(id)) {
      throw new ForbiddenError(`target user ${id} is outside actor's scope`);
    }

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);
    // 対応フィールド: departmentId(所属変更、v0.2) / hireDate(入社日、2026-08-22 追加) /
    // leaveGrantClass(有給付与の区分=比例付与、2026-08-24 追加)。
    // いずれも省略可能な PATCH(部分更新)だが、全部省略は無効なリクエストとして拒否する。
    if (body.departmentId === undefined && body.hireDate === undefined && body.leaveGrantClass === undefined) {
      return c.json({ error: "invalid_body" }, 400);
    }

    let departmentId: string | undefined;
    if (body.departmentId !== undefined) {
      if (typeof body.departmentId !== "string") {
        return c.json({ error: "invalid_department_id" }, 400);
      }
      const department = await getDepartmentById(db, { tenantId: user.tenantId, id: body.departmentId });
      if (!department) return c.json({ error: "invalid_department_id" }, 400);
      departmentId = department.id;
    }

    let hireDate: string | null | undefined;
    if (body.hireDate !== undefined) {
      if (body.hireDate === null) {
        hireDate = null;
      } else if (typeof body.hireDate === "string" && DATE_RE.test(body.hireDate)) {
        hireDate = body.hireDate;
      } else {
        return c.json({ error: "invalid_hire_date" }, 400);
      }
    }

    // 有給付与の区分(労基法39条3項・労基法施行規則24条の3)。null は許さない — 「未設定」は
    // 存在せず、比例付与に該当しない人は明示的に "full" である(DB の DEFAULT も 'full')。
    let leaveGrantClass: LeaveGrantClass | undefined;
    if (body.leaveGrantClass !== undefined) {
      if (!isLeaveGrantClass(body.leaveGrantClass)) {
        return c.json({ error: "invalid_leave_grant_class" }, 400);
      }
      leaveGrantClass = body.leaveGrantClass;
    }

    const now = nowMinutes();
    if (departmentId !== undefined) {
      await upsertMembership(db, { tenantId: user.tenantId, userId: target.id, departmentId, createdAt: now });
    }
    if (hireDate !== undefined) {
      await updateUserHireDate(db, { tenantId: user.tenantId, userId: target.id, hireDate });
    }
    if (leaveGrantClass !== undefined) {
      await updateUserLeaveGrantClass(db, { tenantId: user.tenantId, userId: target.id, leaveGrantClass });
    }

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "member.update",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(hireDate !== undefined ? { hireDate } : {}),
        // 付与区分の変更は付与日数に直結するため、変更前後の両方を残す(監査で「いつ誰が
        // 比例付与へ落としたか」を日数の根拠として追えるようにする)。
        ...(leaveGrantClass !== undefined ? { leaveGrantClassFrom: target.leaveGrantClass, leaveGrantClass } : {}),
      }),
      occurredAt: now,
    });

    return c.json({
      member: {
        id: target.id,
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(hireDate !== undefined ? { hireDate } : {}),
        ...(leaveGrantClass !== undefined ? { leaveGrantClass } : {}),
      },
    });
  });

  /**
   * kind ごとのポリシーを新規作成する際、standardDayMinutes の初期値がテナントの既定ポリシー
   * からも一切解決できない(既定ポリシーがまだ一度も版を持たない、シード未経由の稀なテスト DB
   * 等)場合の最終フォールバック。8時間(480分)。apps/api/src/seed.ts・
   * apps/web/src/components/SettingsAttendanceView.tsx の既定表示値と揃える。
   *
   * kind = "fixed" / "monthly_variable" のとき DB 列(work_policy_versions.settlement_period は
   * NOT NULL)を埋めるプレースホルダは、2026-10-05 から routes/settings/work-policy-version-input.ts の
   * FIXED_SETTLEMENT_PERIOD_PLACEHOLDER を共有している(同じ値を2箇所で決め打ちしない)。
   */
  const FALLBACK_STANDARD_DAY_MINUTES = 480;

  /** GET /members/:id/work-policy のレスポンス要素(1割当分)。 */
  function serializeAssignment(h: UserPolicyAssignmentHistoryRow) {
    return {
      effectiveFrom: h.effectiveFrom,
      // 2026-10-05(名前付きの制度): 同じ kind の制度が複数ありうるため、どの制度かを id で返す。
      workPolicyId: h.workPolicyId,
      workPolicyName: h.workPolicyName,
      kind: h.kind,
      standardDayMinutes: h.standardDayMinutes,
    };
  }

  /** 現在(今日時点)実効の労働時間制と、割当履歴を返す。 */
  app.get("/:id/work-policy", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const history = await listUserPolicyAssignments(db, { tenantId: actor.tenantId, userId: id });
    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const effective = resolveEffectiveAssignment(history, today);

    return c.json({
      effective: effective ? serializeAssignment(effective) : null,
      history: history.map(serializeAssignment),
    });
  });

  /**
   * メンバーへの労働時間制の割当(割当は追記専用)。
   *
   * 入力は次のどちらか(2026-10-05、名前付きの制度):
   * - `{ workPolicyId, effectiveFrom }`(正規): 指定した制度を割り当てる。制度の存在・アーカイブ・
   *   適用開始日の時点で版があるかは `checkAssignableWorkPolicy` で検査する。所定労働時間は
   *   制度の版が持つため、この形では `kind` / `standardDayMinutes` を受け付けない(400 invalid_body —
   *   受け付けると、共有している制度の所定を1人の割当のついでに書き換えてしまう)
   * - `{ kind, effectiveFrom, standardDayMinutes? }`(後方互換): その kind の既定の制度
   *   (`getOrCreateTenantWorkPolicyByKind`)に割り当てる。従来の挙動のまま
   *
   * バリデーション・エラー名は GET/POST /settings/work-policy(routes/settings/work-policy.ts)と
   * 揃える(effectiveFrom が過去日なら 409 effective_from_in_past、同日への重複割当は 409)。
   */
  app.post("/:id/work-policy", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    const byPolicyId = body.workPolicyId !== undefined;
    if (byPolicyId) {
      if (body.kind !== undefined || body.standardDayMinutes !== undefined) {
        return c.json({ error: "invalid_body" }, 400);
      }
    } else if (!isWorkPolicyKind(body.kind)) {
      // 2026-08-23 shift-work.md 決定事項5: "monthly_variable"(1ヶ月単位の変形労働時間制)も
      // 受け付ける。routes/settings/work-policy.ts の POST /work-policy と同じ3値。
      return c.json({ error: "invalid_work_system_kind" }, 400);
    }

    if (typeof body.effectiveFrom !== "string" || !DATE_RE.test(body.effectiveFrom)) {
      return c.json({ error: "invalid_effective_from" }, 400);
    }
    const effectiveFrom = body.effectiveFrom;

    // 2026-08-24(v0.7 フェーズ4): monthly_variable(シフト制)の
    // work_policy_versions.standard_day_minutes は「1日あたりの基準所定時間(有給換算用)」を
    // 意味するようになった(シフトの無い日に有給を取ったとき1日分を何分に換算するか —
    // apps/api/src/lib/leave-minutes.ts 参照)。この制度を割り当てるときに管理者が明示できるよう
    // 任意項目として受け付ける(省略時は従来どおりテナント既定ポリシーの実効値を引き継ぐ)。
    // kind 入力(後方互換)のときだけ。範囲は制度の版と同じ(固定時間制は 1〜480 分)。
    if (!byPolicyId && body.standardDayMinutes !== undefined) {
      if (!isWorkPolicyKind(body.kind) || !isValidStandardDayMinutes(body.kind, body.standardDayMinutes)) {
        return c.json({ error: "invalid_standard_day_minutes" }, 400);
      }
    }
    const requestedStandardDayMinutes = body.standardDayMinutes as number | undefined;

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) {
      return c.json({ error: "effective_from_in_past" }, 409);
    }

    const history = await listUserPolicyAssignments(db, { tenantId: actor.tenantId, userId: id });
    // 同日への重複割当は禁止(work_policy_versions.version_already_exists と同じ「追記専用の
    // 版管理では同じ日を2度上書きできない」という規約。制度が同じか違うかは問わない —
    // 「その日から何が有効か」は常に1つに定まるべきため)。
    if (history.some((h) => h.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "assignment_already_exists" }, 409);
    }
    const before = resolveEffectiveAssignment(history, today);

    const now = nowMinutes();

    let policy: { id: string; name: string };
    let assignedKind: string;
    let assignedStandardDayMinutes: number;
    if (byPolicyId) {
      const checked = await checkAssignableWorkPolicy(db, { tenantId: actor.tenantId, workPolicyId: body.workPolicyId, effectiveFrom });
      if (!checked.ok) return c.json({ error: checked.error }, checked.status);
      policy = checked.policy;
      assignedKind = checked.version.kind;
      assignedStandardDayMinutes = checked.version.standardDayMinutes;
    } else {
      const kind = body.kind as "flex" | "fixed" | "monthly_variable";
      const legacy = await resolveLegacyKindPolicy({ tenantId: actor.tenantId, kind, effectiveFrom, today, now, requestedStandardDayMinutes });
      if (!legacy.ok) return c.json({ error: legacy.error }, legacy.status);
      policy = legacy.policy;
      assignedKind = kind;
      assignedStandardDayMinutes = legacy.standardDayMinutes;
    }

    await assignUserWorkPolicy(db, { tenantId: actor.tenantId, userId: id, workPolicyId: policy.id, effectiveFrom, createdAt: now });

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.work_policy.assign",
      targetType: "user",
      targetId: id,
      // before/after は従来どおり kind(既存の監査ログの読み手を壊さない)。2026-10-05 から、同じ kind の
      // 制度を区別できるよう、制度の id と名前も残す。
      detail: JSON.stringify({
        before: before ? before.kind : null,
        after: assignedKind,
        effectiveFrom,
        beforeWorkPolicyId: before ? before.workPolicyId : null,
        beforeWorkPolicyName: before ? before.workPolicyName : null,
        afterWorkPolicyId: policy.id,
        afterWorkPolicyName: policy.name,
      }),
      occurredAt: now,
    });

    return c.json(
      {
        assignment: {
          workPolicyId: policy.id,
          workPolicyName: policy.name,
          kind: assignedKind,
          effectiveFrom,
          standardDayMinutes: assignedStandardDayMinutes,
        },
      },
      201,
    );
  });

  /**
   * kind 入力(後方互換)の割当先を解決する。中身は 2026-10-05 より前の POST /:id/work-policy の
   * 処理そのまま(関数に括り出し、固定時間制の所定の上限〔480分〕を初版の引き継ぎにも効かせた)。
   */
  async function resolveLegacyKindPolicy(params: {
    tenantId: string;
    kind: "flex" | "fixed" | "monthly_variable";
    effectiveFrom: string;
    today: string;
    now: number;
    requestedStandardDayMinutes: number | undefined;
  }): Promise<{ ok: true; policy: { id: string; name: string }; standardDayMinutes: number } | { ok: false; status: 409; error: string }> {
    const { tenantId, kind, effectiveFrom, today, now, requestedStandardDayMinutes } = params;

    // standardDayMinutes の初期値: テナント既定ポリシー(GET/POST /settings/work-policy が
    // 管理する、名前ベースの "標準" ポリシー)の現在の実効値を流用する(依頼の判断点)。
    // 理由: v0.1〜v0.2 はメンバー個別に所定労働時間を設定する手段を持たなかった。根拠のない値を
    // 決め打ちするより、テナントが既に運用しているフレックスの標準時間を初期値として引き継ぐ方が
    // 実態に近い。この値は「kind に対応するポリシーを新規作成する場合の初版」にのみ使われ
    // (既存ポリシーが見つかればこの値は無視される)、以後は制度の版の追加で上書きできる。
    const defaultPolicy = await getOrCreateTenantWorkPolicy(db, { tenantId, name: "標準", createdAt: now });
    const defaultPolicyVersions = await listWorkPolicyVersions(db, { tenantId, workPolicyId: defaultPolicy.id });
    // listWorkPolicyVersions は effectiveFrom 昇順(queries/work-policies.ts の規約)。
    // 昇順に辿って「today 以下」の版で毎回上書きすれば、ループ後に残るのは today 時点で
    // 実効の版(= today 以下で最大の effectiveFrom を持つ版)になる。
    let defaultPolicyEffectiveMinutes: number | null = null;
    for (const v of defaultPolicyVersions) {
      if (v.effectiveFrom <= today) {
        defaultPolicyEffectiveMinutes = v.standardDayMinutes;
      }
    }
    // 固定時間制の所定の上限(480分)を超える値を初版に持ち込まない(既定の制度がフレックスで
    // 標準時間を8時間超にしている場合など)。
    const inheritedMinutes =
      defaultPolicyEffectiveMinutes !== null && isValidStandardDayMinutes(kind, defaultPolicyEffectiveMinutes)
        ? defaultPolicyEffectiveMinutes
        : null;
    const standardDayMinutes = requestedStandardDayMinutes ?? inheritedMinutes ?? FALLBACK_STANDARD_DAY_MINUTES;

    const policy = await getOrCreateTenantWorkPolicyByKind(db, {
      tenantId,
      kind,
      // 名前は表示専用(kind による検索には影響しない、getOrCreateTenantWorkPolicyByKind の
      // コメント参照)。flex は既存の GET/POST /settings/work-policy と同じ "標準" に揃える
      // (実際、通常運用ではその既存ポリシーがそのまま見つかって再利用される)。fixed・
      // monthly_variable は区別できる名前にする。
      name: kind === "flex" ? "標準" : kind === "fixed" ? "標準(固定時間制)" : "標準(シフト制)",
      createdAt: now,
      defaultVersion: {
        settlementPeriod: kind === "flex" ? "monthly" : FIXED_SETTLEMENT_PERIOD_PLACEHOLDER,
        standardDayMinutes,
      },
    });

    // 明示指定があり、既存ポリシーの実効値と食い違う場合は版を1つ追記して反映する
    // (getOrCreateTenantWorkPolicyByKind の defaultVersion は「ポリシーを新規作成した場合」に
    // しか使われないため、既にそのkindのポリシーがあるテナントでは指定が無視されてしまう)。
    // この変更は同じ制度の他のメンバーにも及ぶ — 人ごとに所定を変えたい場合は、2026-10-05 以降は
    // 名前付きの制度を作って workPolicyId で割り当てる(この kind 入力は後方互換のためだけに残す)。
    if (requestedStandardDayMinutes !== undefined) {
      const policyVersions = await listWorkPolicyVersions(db, { tenantId, workPolicyId: policy.id });
      let effectiveMinutes: number | null = null;
      // コアタイム(labor law §32-3)は「その日に有効な版」の値をそのまま引き継ぐ。ここで
      // 追記する版は standardDayMinutes を変えるためだけのものなので、テナントの
      // コアタイム設定(POST /settings/work-policy で入れた値)を意図せず消してしまわないようにする。
      let effectiveCore: string | null = null;
      for (const v of policyVersions) {
        if (v.effectiveFrom <= effectiveFrom) {
          effectiveMinutes = v.standardDayMinutes;
          effectiveCore = v.core;
        }
      }
      if (effectiveMinutes !== requestedStandardDayMinutes) {
        if (policyVersions.some((v) => v.effectiveFrom === effectiveFrom)) {
          // 同じ日に別の値の版が既にある。追記専用の版管理では同じ日を2度上書きできない
          // (routes/settings/work-policy.ts の version_already_exists と同じ規約)。
          return { ok: false, status: 409, error: "version_already_exists" };
        }
        await insertWorkPolicyVersion(db, {
          tenantId,
          workPolicyId: policy.id,
          effectiveFrom,
          kind,
          settlementPeriod: kind === "flex" ? "monthly" : FIXED_SETTLEMENT_PERIOD_PLACEHOLDER,
          core: kind === "flex" ? effectiveCore : null,
          standardDayMinutes: requestedStandardDayMinutes,
          createdAt: now,
        });
      }
    }

    // 応答の standardDayMinutes は従来どおり「初版に使った値(明示指定があればその値)」。
    return { ok: true, policy: { id: policy.id, name: policy.name }, standardDayMinutes };
  }

  app.put("/:id/presets", async (c) => {
    requirePermission(c, ASSIGNMENT_MANAGE_PERMISSION, "department");
    const actor = c.get("user");
    const targetId = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id: targetId });
    if (!target) return c.json({ error: "not_found" }, 404);

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: actor.id, tenantId: actor.tenantId, permissions: c.get("permissions") },
      permission: ASSIGNMENT_MANAGE_PERMISSION,
    });
    if (accessibleUserIds !== "all" && !accessibleUserIds.has(targetId)) {
      throw new ForbiddenError(`target user ${targetId} is outside actor's scope`);
    }

    const body = await parseJsonBody(c);
    if (
      body === null ||
      !Array.isArray(body.presetIds) ||
      !body.presetIds.every((v): v is string => typeof v === "string")
    ) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const result = await assignPresetsToMember({
      db,
      actor: { id: actor.id, tenantId: actor.tenantId },
      targetUserId: target.id,
      presetIds: body.presetIds,
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "permission_assignment.update",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({ presetIds: result.presetIds, presetNames: result.presetNames }),
      occurredAt: nowMinutes(),
    });

    return c.json({ presetIds: result.presetIds });
  });

  return app;
}
