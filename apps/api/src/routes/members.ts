/**
 * GET /members, POST /members, PATCH /members/:id, PUT /members/:id/presets,
 * POST /members/:id/invitations, DELETE /members/:id/invitations,
 * POST /members/:id/password-resets, DELETE /members/:id/password-resets,
 * POST /members/:id/deactivate, POST /members/:id/reactivate,
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
 * (カタログに専用キーが既にある)。プリセット割当(PUT /:id/presets)は
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
 */

import { Hono } from "hono";
import {
  createInvitation,
  createInvitationInTx,
  createPasswordResetToken,
  createUser,
  deactivateUser,
  getDepartmentById,
  getLatestInvitationForUser,
  getLatestPasswordResetTokenForUser,
  getUserById,
  insertAuditLog,
  isUniqueConstraintError,
  listAssignedPresetGrants,
  listCurrentWorkPolicyKindsForTenant,
  listInvitationsForTenant,
  listPasswordResetTokensForTenant,
  listTenantAssignedPresetNames,
  listTenantMembershipsWithDepartment,
  listTenantPresetGrantsByUser,
  listTenantUserIdsWithCredentials,
  listTenantUsers,
  listUserPolicyAssignments,
  listWorkPolicyVersions,
  reactivateUser,
  revokeAllPasswordResetTokensForUser,
  revokeAllSessionsForUser,
  revokeInvitation,
  revokePasswordResetToken,
  revokePendingInvitationForUser,
  updateUserHireDate,
  upsertMembership,
  userHasCredential,
  type Database,
  type Invitation,
  type PasswordResetToken,
  type UserPolicyAssignmentHistoryRow,
  getOrCreateTenantWorkPolicy,
  getOrCreateTenantWorkPolicyByKind,
  assignUserWorkPolicy,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { generateInvitationToken, INVITATION_TTL_MINUTES } from "../auth/invitation-token.js";
import { generatePasswordResetToken, PASSWORD_RESET_TTL_MINUTES } from "../auth/password-reset-token.js";
import { effectivePermissionsFromRawGrantSets, ForbiddenError, requirePermission } from "../authz.js";
import { resolveAccessibleDepartmentIds, resolveAccessibleUserIds } from "../lib/scope.js";
import { nowMinutes, todayLocalDate } from "../lib/time.js";
import { TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";
import { ASSIGNMENT_MANAGE_PERMISSION, assignPresetsToMember, PRESET_MANAGE_PERMISSION } from "./presets.js";
import { WORK_POLICY_PERMISSION } from "./settings/permissions.js";

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

export function createMembersRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") },
      permission: VIEW_PERMISSION,
    });

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    const [tenantUsers, membershipRows, presetNameRows, invitationRows, credentialUserIds, passwordResetRows, workPolicyKindByUser] =
      await Promise.all([
        listTenantUsers(db, user.tenantId),
        listTenantMembershipsWithDepartment(db, user.tenantId),
        listTenantAssignedPresetNames(db, user.tenantId),
        listInvitationsForTenant(db, user.tenantId),
        listTenantUserIdsWithCredentials(db, user.tenantId),
        listPasswordResetTokensForTenant(db, user.tenantId),
        // 現在の労働時間制(UI バッジ用、2026-08-23 追加)。テナント全体を2クエリで一括解決する
        // (packages/db/src/queries/work-policies.ts の listCurrentWorkPolicyKindsForTenant 参照、
        // ユーザーごとの個別クエリにはしない — N+1 回避)。
        listCurrentWorkPolicyKindsForTenant(db, { tenantId: user.tenantId, asOfDate: today }),
      ]);
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

    return c.json({
      members: allUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        // 入社日(2026-08-22 追加)。法定付与の計算に使う(routes/leave.ts の
        // POST /leave/grants/auto)。null = 未設定 → 法定付与ができない(画面側で警告表示)。
        hireDate: u.hireDate,
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
        workSystemKind: workPolicyKindByUser.get(u.id) ?? null,
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

    const { email, name, departmentId, hireDate, presetIds } = body as {
      email?: unknown;
      name?: unknown;
      departmentId?: unknown;
      hireDate?: unknown;
      presetIds?: unknown;
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

    const now = nowMinutes();
    // トークンの生成自体は DB を伴わない純粋な計算(crypto乱数 + ハッシュ化)のため、
    // トランザクションの外で先に済ませておく(トランザクションの保持時間を必要最小限にする)。
    const { token, hash } = await generateInvitationToken();

    // トランザクション化(レビュー指摘): createUser・upsertMembership・招待作成・監査ログ追記を
    // 1つの db.transaction にまとめる。以前はこの4つが個別のクエリとして実行されており、
    // 例えば招待作成が失敗すると「ユーザー行だけ作られ、招待が一切飛ばない」ユーザーが
    // 残ってしまっていた(手動での後始末が必要になる不整合)。
    //
    // presetIds の割当(assignPresetsToMember)は既存の設計判断どおりトランザクションの外に
    // 残す: 固定原則(自己昇格・自己降格・最後の権限管理保持者保護)の検証を含む独立した
    // ドメインロジックであり、万一 presetIds が不正でも「作成・招待自体は確実に成立させる」
    // という元々のコメントの意図(下記参照)をそのまま維持するため。
    let target: Awaited<ReturnType<typeof createUser>>;
    let invitation: Awaited<ReturnType<typeof createInvitationInTx>>;
    try {
      const created = await db.transaction(async (tx) => {
        const createdUser = await createUser(tx, {
          tenantId: actor.tenantId,
          email,
          name: name.trim(),
          hireDate: resolvedHireDate,
          createdAt: now,
        });

        if (resolvedDepartmentId !== undefined) {
          await upsertMembership(tx, { tenantId: actor.tenantId, userId: createdUser.id, departmentId: resolvedDepartmentId, createdAt: now });
        }

        // テナント既定の労働時間制を自動割当する(2026-08-23)。これが無いと招待で作られた
        // メンバーは制度未割当のまま(buildSettingsTimeline が解決できず有給・月次が 500)。
        // 適用開始日は入社日(未指定なら今日)— 入社日より前の期間は集計対象にならないため。
        // 別の制度にしたい場合は後から work policy の割当を追加すれば上書きされる(effective-dated)。
        const defaultPolicy = await getOrCreateTenantWorkPolicy(tx, {
          tenantId: actor.tenantId,
          name: "標準",
          createdAt: now,
        });
        await assignUserWorkPolicy(tx, {
          tenantId: actor.tenantId,
          userId: createdUser.id,
          workPolicyId: defaultPolicy.id,
          effectiveFrom: resolvedHireDate ?? todayLocalDate(TZ_OFFSET_MINUTES_JST),
          createdAt: now,
        });

        const createdInvitation = await createInvitationInTx(tx, {
          tenantId: actor.tenantId,
          userId: createdUser.id,
          tokenHash: hash,
          expiresAt: now + INVITATION_TTL_MINUTES,
          createdBy: actor.id,
          createdAt: now,
        });

        await insertAuditLog(tx, {
          tenantId: actor.tenantId,
          actorId: actor.id,
          action: "member.invite",
          targetType: "user",
          targetId: createdUser.id,
          detail: JSON.stringify({ email: createdUser.email, departmentId: resolvedDepartmentId ?? null }),
          occurredAt: now,
        });

        return { user: createdUser, invitation: createdInvitation };
      });
      target = created.user;
      invitation = created.invitation;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return c.json({ error: "email_already_exists" }, 409);
      }
      throw err;
    }

    // presetIds の反映は招待発行の後(トランザクション確定後)に行う: 万一 presetIds が
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
    const targetEffective = effectivePermissionsFromRawGrantSets(targetGrantSets);
    if (targetEffective.has(PRESET_MANAGE_PERMISSION)) {
      const [allGrantsByUser, tenantUsers] = await Promise.all([
        listTenantPresetGrantsByUser(db, actor.tenantId),
        listTenantUsers(db, actor.tenantId),
      ]);
      const activeUserIds = new Set(tenantUsers.filter((u) => u.isActive).map((u) => u.id));
      let otherHolders = 0;
      for (const [userId, rawGrantSets] of allGrantsByUser) {
        if (userId === id || !activeUserIds.has(userId)) continue;
        const effective = effectivePermissionsFromRawGrantSets(rawGrantSets);
        if (effective.has(PRESET_MANAGE_PERMISSION)) otherHolders++;
      }
      if (otherHolders === 0) {
        return c.json({ error: "last_admin" }, 409);
      }
    }

    const now = nowMinutes();
    await db.transaction(async (tx) => {
      await deactivateUser(tx, { tenantId: actor.tenantId, userId: id });
      await revokeAllSessionsForUser(tx, { tenantId: actor.tenantId, userId: id, revokedAt: now });
      await revokePendingInvitationForUser(tx, { tenantId: actor.tenantId, userId: id, revokedAt: now });
      await revokeAllPasswordResetTokensForUser(tx, { tenantId: actor.tenantId, userId: id, revokedAt: now });
      await insertAuditLog(tx, {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: "member.deactivate",
        targetType: "user",
        targetId: id,
        detail: JSON.stringify({}),
        occurredAt: now,
      });
    });

    return c.json({ member: { id, isActive: false } });
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
    // 対応フィールド: departmentId(所属変更、v0.2) / hireDate(入社日、2026-08-22 追加)。
    // どちらも省略可能な PATCH(部分更新)だが、両方省略は無効なリクエストとして拒否する。
    if (body.departmentId === undefined && body.hireDate === undefined) {
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

    const now = nowMinutes();
    if (departmentId !== undefined) {
      await upsertMembership(db, { tenantId: user.tenantId, userId: target.id, departmentId, createdAt: now });
    }
    if (hireDate !== undefined) {
      await updateUserHireDate(db, { tenantId: user.tenantId, userId: target.id, hireDate });
    }

    await insertAuditLog(db, {
      tenantId: user.tenantId,
      actorId: user.id,
      action: "member.update",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({ ...(departmentId !== undefined ? { departmentId } : {}), ...(hireDate !== undefined ? { hireDate } : {}) }),
      occurredAt: now,
    });

    return c.json({
      member: {
        id: target.id,
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(hireDate !== undefined ? { hireDate } : {}),
      },
    });
  });

  /**
   * kind = "fixed" のとき、DB 列(work_policy_versions.settlement_period は NOT NULL)を埋める
   * ためだけのプレースホルダ。この値自体に意味は無く、GET/POST /settings/work-policy と同じ
   * 理由(settlementPeriod は flex 専用の列で fixed では無視される、packages/db/src/schema/
   * settings.ts のコメント参照)でここでも決め打ちにする。文字列としてはあちらと同じ "monthly" に
   * 揃えているが、意味的には無関係な値であり参照はしないこと。
   */
  const FIXED_SETTLEMENT_PERIOD_PLACEHOLDER = "monthly";

  /**
   * kind ごとのポリシーを新規作成する際、standardDayMinutes の初期値がテナントの既定ポリシー
   * からも一切解決できない(既定ポリシーがまだ一度も版を持たない、シード未経由の稀なテスト DB
   * 等)場合の最終フォールバック。8時間(480分)。apps/api/src/seed.ts・
   * apps/web/src/components/SettingsAttendanceView.tsx の既定表示値と揃える。
   */
  const FALLBACK_STANDARD_DAY_MINUTES = 480;

  /** GET /members/:id/work-policy のレスポンス要素(1割当分)。 */
  function serializeAssignment(h: UserPolicyAssignmentHistoryRow) {
    return { effectiveFrom: h.effectiveFrom, kind: h.kind, standardDayMinutes: h.standardDayMinutes, workPolicyName: h.workPolicyName };
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
   * メンバーへの労働時間制割当(kind の選択として表現、割当は追記専用)。
   *
   * `{ kind: "flex" | "fixed", effectiveFrom }` を受け取り、kind に対応する共有ポリシーを
   * get-or-create した上で `assignUserWorkPolicy` を追記する。バリデーション・エラー名は
   * GET/POST /settings/work-policy(routes/settings/work-policy.ts)と揃える
   * (effectiveFrom が過去日なら 409 effective_from_in_past、同日への重複割当は 409)。
   */
  app.post("/:id/work-policy", async (c) => {
    requirePermission(c, WORK_POLICY_PERMISSION, "tenant");
    const actor = c.get("user");
    const id = c.req.param("id");

    const target = await getUserById(db, { tenantId: actor.tenantId, id });
    if (!target) return c.json({ error: "not_found" }, 404);

    const body = await parseJsonBody(c);
    if (body === null) return c.json({ error: "invalid_body" }, 400);

    if (body.kind !== "flex" && body.kind !== "fixed") {
      return c.json({ error: "invalid_work_system_kind" }, 400);
    }
    const kind = body.kind;

    if (typeof body.effectiveFrom !== "string" || !DATE_RE.test(body.effectiveFrom)) {
      return c.json({ error: "invalid_effective_from" }, 400);
    }
    const effectiveFrom = body.effectiveFrom;

    const today = todayLocalDate(TZ_OFFSET_MINUTES_JST);
    if (effectiveFrom < today) {
      return c.json({ error: "effective_from_in_past" }, 409);
    }

    const history = await listUserPolicyAssignments(db, { tenantId: actor.tenantId, userId: id });
    // 同日への重複割当は禁止(work_policy_versions.version_already_exists と同じ「追記専用の
    // 版管理では同じ日を2度上書きできない」という規約。kind が同じか違うかは問わない —
    // 「その日から何が有効か」は常に1つに定まるべきため)。
    if (history.some((h) => h.effectiveFrom === effectiveFrom)) {
      return c.json({ error: "assignment_already_exists" }, 409);
    }
    const before = resolveEffectiveAssignment(history, today);

    const now = nowMinutes();

    // standardDayMinutes の初期値: テナント既定ポリシー(GET/POST /settings/work-policy が
    // 管理する、名前ベースの "標準" ポリシー)の現在の実効値を流用する(依頼の判断点)。
    // 理由: v0.1〜v0.2 はメンバー個別に所定労働時間を設定する手段を持たない(所定労働時間が
    // 人ごとに違うケースは docs/design/shift-work.md のシフト制〔日単位の所定〕が入るまでの
    // 将来課題)。根拠のない値を決め打ちするより、テナントが既に運用しているフレックスの
    // 標準時間を初期値として引き継ぐ方が実態に近い。この値は「kind に対応するポリシーを
    // 新規作成する場合の初版」にのみ使われ(既存ポリシーが見つかればこの値は無視される)、
    // 以後は本エンドポイントを含む別の割当や GET/POST /settings/work-policy の版追加で
    // 個別に上書きできる。
    const defaultPolicy = await getOrCreateTenantWorkPolicy(db, { tenantId: actor.tenantId, name: "標準", createdAt: now });
    const defaultPolicyVersions = await listWorkPolicyVersions(db, { tenantId: actor.tenantId, workPolicyId: defaultPolicy.id });
    // listWorkPolicyVersions は effectiveFrom 昇順(queries/work-policies.ts の規約)。
    // 昇順に辿って「today 以下」の版で毎回上書きすれば、ループ後に残るのは today 時点で
    // 実効の版(= today 以下で最大の effectiveFrom を持つ版)になる。
    let defaultPolicyEffectiveMinutes: number | null = null;
    for (const v of defaultPolicyVersions) {
      if (v.effectiveFrom <= today) {
        defaultPolicyEffectiveMinutes = v.standardDayMinutes;
      }
    }
    const standardDayMinutes = defaultPolicyEffectiveMinutes ?? FALLBACK_STANDARD_DAY_MINUTES;

    const policy = await getOrCreateTenantWorkPolicyByKind(db, {
      tenantId: actor.tenantId,
      kind,
      // 名前は表示専用(kind による検索には影響しない、getOrCreateTenantWorkPolicyByKind の
      // コメント参照)。flex は既存の GET/POST /settings/work-policy と同じ "標準" に揃える
      // (実際、通常運用ではその既存ポリシーがそのまま見つかって再利用される)。fixed は
      // 区別できる名前にする。
      name: kind === "flex" ? "標準" : "標準(固定時間制)",
      createdAt: now,
      defaultVersion: {
        settlementPeriod: kind === "flex" ? "monthly" : FIXED_SETTLEMENT_PERIOD_PLACEHOLDER,
        standardDayMinutes,
      },
    });

    await assignUserWorkPolicy(db, { tenantId: actor.tenantId, userId: id, workPolicyId: policy.id, effectiveFrom, createdAt: now });

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.work_policy.assign",
      targetType: "user",
      targetId: id,
      detail: JSON.stringify({ before: before ? before.kind : null, after: kind, effectiveFrom }),
      occurredAt: now,
    });

    return c.json({ assignment: { kind, effectiveFrom, standardDayMinutes } }, 201);
  });

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
