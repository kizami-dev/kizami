/**
 * GET /members, POST /members, PATCH /members/:id, PUT /members/:id/presets,
 * POST /members/:id/invitations, DELETE /members/:id/invitations
 *
 * メンバー一覧・招待式登録・所属変更・プリセット割当のAPI。参照: docs/design/permission-catalog.md
 * §1.8(メンバー管理)、§1.12(権限管理)、docs/requirements.md §認証(招待式登録)。
 *
 * 権限: 一覧閲覧は `member.view`、メンバー作成・招待の発行/再発行/取り消しは `member.invite`
 * (カタログにある既存のメンバー管理系権限をそのまま使う。新設しない)、所属(departmentId)の
 * 変更は `member.profile.edit`。プリセット割当(PUT /:id/presets)は
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
 * スコープの粒度: requirePermission は「保持スコープが最低限 department 以上か」までしか
 * 見ないため、対象メンバー・対象部署が実際に actor の管轄下(所属部署・その配下)にいるかは
 * apps/api/src/lib/scope.ts の resolveAccessibleUserIds() / resolveAccessibleDepartmentIds()
 * で別途絞り込む(以前はここが未実装で、department_and_descendants しか持たないユーザーでも
 * テナント全体を操作できてしまっていた)。
 */

import { Hono } from "hono";
import {
  createInvitation,
  createUser,
  getDepartmentById,
  getLatestInvitationForUser,
  getUserById,
  insertAuditLog,
  isUniqueConstraintError,
  listInvitationsForTenant,
  listTenantAssignedPresetNames,
  listTenantMembershipsWithDepartment,
  listTenantUserIdsWithCredentials,
  listTenantUsers,
  revokeInvitation,
  updateUserHireDate,
  upsertMembership,
  userHasCredential,
  type Database,
  type Invitation,
} from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { generateInvitationToken, INVITATION_TTL_MINUTES } from "../auth/invitation-token.js";
import { ForbiddenError, requirePermission } from "../authz.js";
import { resolveAccessibleDepartmentIds, resolveAccessibleUserIds } from "../lib/scope.js";
import { nowMinutes } from "../lib/time.js";
import { ASSIGNMENT_MANAGE_PERMISSION, assignPresetsToMember } from "./presets.js";

const VIEW_PERMISSION = "member.view";
const EDIT_PERMISSION = "member.profile.edit";
// 招待式登録(docs/requirements.md §認証)。カタログ上は「メンバーを招待・追加できる」権限で、
// メンバー作成(POST /members)・招待の再発行/取り消しをこの1つの権限で保護する
// (依頼「新設しない」— 既存のメンバー管理系権限に合わせた)。
const INVITE_PERMISSION = "member.invite";

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

export function createMembersRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    requirePermission(c, VIEW_PERMISSION, "department");
    const user = c.get("user");

    const accessibleUserIds = await resolveAccessibleUserIds(db, {
      actor: { id: user.id, tenantId: user.tenantId, permissions: c.get("permissions") },
      permission: VIEW_PERMISSION,
    });

    const [tenantUsers, membershipRows, presetNameRows, invitationRows, credentialUserIds] = await Promise.all([
      listTenantUsers(db, user.tenantId),
      listTenantMembershipsWithDepartment(db, user.tenantId),
      listTenantAssignedPresetNames(db, user.tenantId),
      listInvitationsForTenant(db, user.tenantId),
      listTenantUserIdsWithCredentials(db, user.tenantId),
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
    let target: Awaited<ReturnType<typeof createUser>>;
    try {
      target = await createUser(db, {
        tenantId: actor.tenantId,
        email,
        name: name.trim(),
        hireDate: resolvedHireDate,
        createdAt: now,
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return c.json({ error: "email_already_exists" }, 409);
      }
      throw err;
    }

    if (resolvedDepartmentId !== undefined) {
      await upsertMembership(db, { tenantId: actor.tenantId, userId: target.id, departmentId: resolvedDepartmentId, createdAt: now });
    }

    const { token, hash } = await generateInvitationToken();
    const invitation = await createInvitation(db, {
      tenantId: actor.tenantId,
      userId: target.id,
      tokenHash: hash,
      expiresAt: now + INVITATION_TTL_MINUTES,
      createdBy: actor.id,
      createdAt: now,
    });

    // presetIds の反映は招待発行の後に行う: 万一 presetIds が不正(未知のID等)でも、
    // 「作成はしたが招待は一切飛ばせなかった」状態を避け、招待自体は確実に成立させる
    // (presetsは後からでも PUT /members/:id/presets で直せるが、招待し直しは再発行の
    // 手間がかかるため、失敗時の実害が小さい方を後段に置いた判断)。
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

    await insertAuditLog(db, {
      tenantId: actor.tenantId,
      actorId: actor.id,
      action: "member.invite",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({ email: target.email, departmentId: resolvedDepartmentId ?? null }),
      occurredAt: now,
    });

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
