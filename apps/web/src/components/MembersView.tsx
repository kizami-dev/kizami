"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type DepartmentDto,
  type MemberDto,
  type MemberWorkPolicySettingsDto,
  type PermissionCatalogEntryDto,
  type PermissionPresetDto,
  type WorkSystemKind,
} from "../lib/api";
import { mapAssignmentErrorMessage, mapMemberErrorMessage, messages } from "../lib/messages";
import { computeEffectivePermissions, hasEffectivePermission, matchAssignedPresetIds } from "../lib/permissions";
import { dateStrFromEpochMinutesJst, nowMinutes } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useEffectivePermissions } from "../lib/useEffectivePermissions";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { EffectivePermissionsPanel } from "./EffectivePermissionsPanel";
import { InviteLinkDialog } from "./InviteLinkDialog";
import { InviteMemberDialog, type InviteMemberFormValue } from "./InviteMemberDialog";
import { SettingsNav } from "./SettingsNav";

/**
 * メンバー管理画面(/settings/members)。所属変更・権限プリセット割当・実効権限ビュー(必須要件)。
 * docs/requirements.md §4。2026-08-23 Tier 0 その4で、パスワードリセットの管理者発行・
 * 退職処理(無効化/再有効化)・メンバー個別の労働時間制割当を追加した。
 */
export function MembersView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [presets, setPresets] = useState<PermissionPresetDto[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /** 一覧フィルタ(2026-08-23 Tier 0 その4 追加)。既定は有効なメンバーのみ表示する。 */
  const [showInactive, setShowInactive] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [assignPending, setAssignPending] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSaved, setAssignSaved] = useState(false);

  const [deptChangePendingId, setDeptChangePendingId] = useState<string | null>(null);
  const [deptChangeError, setDeptChangeError] = useState<{ memberId: string; message: string } | null>(null);

  // 入社日(2026-08-22 追加)。department の <select> と違い date input は逐次コミットしないほうが
  // 扱いやすいため、行ごとの下書き(hireDateDrafts)を保持して明示的な保存ボタンで確定する。
  const [hireDateDrafts, setHireDateDrafts] = useState<Record<string, string>>({});
  const [hireDatePendingId, setHireDatePendingId] = useState<string | null>(null);
  const [hireDateError, setHireDateError] = useState<{ memberId: string; message: string } | null>(null);
  const [hireDateSavedId, setHireDateSavedId] = useState<string | null>(null);

  // 招待式登録(2026-08-23 追加、docs/requirements.md §7)。
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // 一度きりのリンク提示画面(招待の発行・再発行、パスワードリセットの発行、いずれの直後にも使う
  // 共通の reveal 状態。2026-08-23 Tier 0 その4: InviteLinkDialog を variant で共用するのに合わせ、
  // 保持する値も token/expiresAt のフラットな形に一般化した)。
  const [revealLink, setRevealLink] = useState<{
    variant: "invite" | "reset";
    memberName: string;
    memberEmail: string;
    token: string;
    expiresAt: number;
  } | null>(null);

  const [reissueTarget, setReissueTarget] = useState<MemberDto | null>(null);
  const [reissuePending, setReissuePending] = useState(false);
  const [reissueError, setReissueError] = useState<string | null>(null);

  const [revokeInviteTarget, setRevokeInviteTarget] = useState<MemberDto | null>(null);
  const [revokeInvitePending, setRevokeInvitePending] = useState(false);
  const [revokeInviteError, setRevokeInviteError] = useState<string | null>(null);

  // パスワードリセットの管理者発行(2026-08-23 Tier 0 その4 追加)。発行自体は既存セッションに
  // 影響しないため招待発行と同様に確認なしで即実行し、取り消しのみ確認ダイアログを挟む
  // (招待の再発行/取り消しと同じ非対称、このファイル内 handleRevokeResetConfirm 付近のコメント参照)。
  const [resetIssuePendingId, setResetIssuePendingId] = useState<string | null>(null);
  const [resetIssueError, setResetIssueError] = useState<{ memberId: string; message: string } | null>(null);

  const [revokeResetTarget, setRevokeResetTarget] = useState<MemberDto | null>(null);
  const [revokeResetPending, setRevokeResetPending] = useState(false);
  const [revokeResetError, setRevokeResetError] = useState<string | null>(null);

  // 退職処理(無効化・再有効化、2026-08-23 Tier 0 その4 追加)。無効化はログイン不可・セッション
  // 失効を伴う影響の大きい操作のため確認ダイアログを挟む(Mトーン)。再有効化は元に戻す操作
  // (新たに何かを壊すものではない)のため確認を挟まず即実行する。
  const [deactivateTarget, setDeactivateTarget] = useState<MemberDto | null>(null);
  const [deactivatePending, setDeactivatePending] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [reactivatePendingId, setReactivatePendingId] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<{ memberId: string; message: string } | null>(null);

  // メンバー個別の労働時間制(2026-08-23 Tier 0 その4 追加)。GET/POST /members/:id/work-policy は
  // tenant_settings.flex.manage(テナント全体スコープ)を要求するため、この権限を持たない場合は
  // そもそも GET も 403 になる — 詳細行を開いたときにその権限を持つ場合のみ取得する
  // (下記 toggleExpand・canManageWorkPolicy 参照)。
  const todayDate = dateStrFromEpochMinutesJst(nowMinutes());
  const [workPolicy, setWorkPolicy] = useState<MemberWorkPolicySettingsDto | null>(null);
  const [workPolicyLoading, setWorkPolicyLoading] = useState(false);
  const [workPolicyForm, setWorkPolicyForm] = useState<{ kind: WorkSystemKind; effectiveFrom: string }>({
    kind: "flex",
    effectiveFrom: todayDate,
  });
  const [workPolicySaving, setWorkPolicySaving] = useState(false);
  const [workPolicyError, setWorkPolicyError] = useState<string | null>(null);
  const [workPolicySuccess, setWorkPolicySuccess] = useState(false);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .listMembers()
      .then(async (res) => {
        if (cancelled) return;
        setMembers(res.members);
        // 部署・プリセット・カタログは補助データのため個別に失敗しても致命的にしない
        // (メンバー一覧の権限はあるが部署/プリセット管理権限が無いケースがあり得るため)。
        const [deptRes, presetRes, catalogRes] = await Promise.allSettled([
          api.listDepartments(),
          api.listPresets(),
          api.getPresetCatalog(),
        ]);
        if (cancelled) return;
        if (deptRes.status === "fulfilled") setDepartments(deptRes.value.departments);
        if (presetRes.status === "fulfilled") setPresets(presetRes.value.presets);
        if (catalogRes.status === "fulfilled") setCatalog(catalogRes.value.catalog);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError(err instanceof ApiError ? messages.members.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, reloadKey]);

  /**
   * 招待の発行・再発行・取り消し(POST/DELETE /members/:id/invitations)・パスワードリセットの
   * 発行/取り消し(POST/DELETE /members/:id/password-resets)が要求する member.invite
   * (department スコープ)を出すかどうかの判定(2026-08-23 レビュー第2波)。
   *
   * 以前は GET /members が返す自分自身の presetNames を GET /presets と突き合わせて
   * computeEffectivePermissions で再計算する推定に頼っており、未文書の false negative が
   * 2経路あった(プリセット未取得時・自分がメンバー一覧に現れないタイミングでの一時的な空判定)。
   * GET /me/effective-permissions(実効権限の最終形をサーバー側で確定済み)の追加により、
   * この再計算は不要になった。
   */
  const { permissions: effectivePermissions } = useEffectivePermissions();
  const canInvite = hasEffectivePermission(effectivePermissions, "member.invite", "department");
  /** 退職処理(無効化・再有効化、2026-08-23 Tier 0 その4 追加)。 */
  const canDeactivate = hasEffectivePermission(effectivePermissions, "member.deactivate", "department");
  /**
   * メンバー個別の労働時間制割当(2026-08-23 Tier 0 その4 追加)。GET/POST /settings/work-policy
   * と同じ tenant_settings.flex.manage(テナント全体のみ)を要求する — apps/api/src/routes/
   * members.ts の GET/POST /:id/work-policy と揃える(判断点、依頼どおり member.* 系権限では保護しない)。
   */
  const canManageWorkPolicy = hasEffectivePermission(effectivePermissions, "tenant_settings.flex.manage", "tenant");

  function toggleExpand(member: MemberDto) {
    if (expandedId === member.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(member.id);
    setSelectedPresetIds(matchAssignedPresetIds(member.presetNames, presets));
    setAssignError(null);
    setAssignSaved(false);

    setWorkPolicy(null);
    setWorkPolicyError(null);
    setWorkPolicySuccess(false);
    setWorkPolicyForm({ kind: "flex", effectiveFrom: todayDate });
    // 権限が無ければ GET も 403 になるため呼ばない(このファイル冒頭の canManageWorkPolicy コメント参照)。
    // 依頼「権限が無ければセクションは読み取り専用」は、この API 設計(GET/POST が同一権限)の下では
    // 「フォームを出さない」以上の読み取り専用状態を提供できないため、セクション自体を非表示にする
    // (下の JSX で canManageWorkPolicy を条件にしている、完了報告の判断点)。
    if (canManageWorkPolicy) {
      setWorkPolicyLoading(true);
      api
        .getMemberWorkPolicy(member.id)
        .then((res) => {
          setWorkPolicy(res);
          setWorkPolicyForm({ kind: res.effective?.kind ?? "flex", effectiveFrom: todayDate });
        })
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) {
            router.push("/login");
            return;
          }
          setWorkPolicyError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
        })
        .finally(() => setWorkPolicyLoading(false));
    }
  }

  function togglePreset(presetId: string) {
    setAssignSaved(false);
    setSelectedPresetIds((prev) => (prev.includes(presetId) ? prev.filter((id) => id !== presetId) : [...prev, presetId]));
  }

  async function handleDepartmentChange(memberId: string, departmentId: string) {
    if (!departmentId) return;
    setDeptChangePendingId(memberId);
    setDeptChangeError(null);
    try {
      await api.updateMemberDepartment(memberId, departmentId);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setDeptChangeError({
        memberId,
        message: err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network,
      });
    } finally {
      setDeptChangePendingId(null);
    }
  }

  function hireDateDraftFor(member: MemberDto): string {
    return hireDateDrafts[member.id] ?? member.hireDate ?? "";
  }

  async function handleHireDateSave(member: MemberDto) {
    const draft = hireDateDraftFor(member).trim();
    const value = draft === "" ? null : draft;
    setHireDatePendingId(member.id);
    setHireDateError(null);
    setHireDateSavedId(null);
    try {
      await api.updateMemberHireDate(member.id, value);
      setHireDateSavedId(member.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setHireDateError({
        memberId: member.id,
        message: err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network,
      });
    } finally {
      setHireDatePendingId(null);
    }
  }

  async function handleAssignSave(memberId: string) {
    setAssignPending(true);
    setAssignError(null);
    setAssignSaved(false);
    try {
      await api.assignMemberPresets(memberId, selectedPresetIds);
      setAssignSaved(true);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setAssignError(err instanceof ApiError ? mapAssignmentErrorMessage(err.body) : messages.errors.network);
    } finally {
      setAssignPending(false);
    }
  }

  async function handleInviteSubmit(value: InviteMemberFormValue) {
    setInvitePending(true);
    setInviteError(null);
    try {
      const res = await api.createMember({
        email: value.email,
        name: value.name,
        ...(value.departmentId !== null ? { departmentId: value.departmentId } : {}),
        ...(value.hireDate !== "" ? { hireDate: value.hireDate } : {}),
        ...(value.presetIds.length > 0 ? { presetIds: value.presetIds } : {}),
      });
      setInviteFormOpen(false);
      setRevealLink({
        variant: "invite",
        memberName: res.member.name,
        memberEmail: res.member.email,
        token: res.invitation.token,
        expiresAt: res.invitation.expiresAt,
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setInviteError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setInvitePending(false);
    }
  }

  function openReissueConfirm(member: MemberDto) {
    setReissueTarget(member);
    setReissueError(null);
  }

  async function handleReissueConfirm() {
    if (!reissueTarget) return;
    setReissuePending(true);
    setReissueError(null);
    try {
      const res = await api.reissueInvitation(reissueTarget.id);
      setRevealLink({
        variant: "invite",
        memberName: reissueTarget.name,
        memberEmail: reissueTarget.email,
        token: res.invitation.token,
        expiresAt: res.invitation.expiresAt,
      });
      setReissueTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setReissueError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setReissuePending(false);
    }
  }

  function openRevokeInviteConfirm(member: MemberDto) {
    setRevokeInviteTarget(member);
    setRevokeInviteError(null);
  }

  async function handleRevokeInviteConfirm() {
    if (!revokeInviteTarget) return;
    setRevokeInvitePending(true);
    setRevokeInviteError(null);
    try {
      await api.revokeInvitation(revokeInviteTarget.id);
      setRevokeInviteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setRevokeInviteError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setRevokeInvitePending(false);
    }
  }

  /** パスワードリセットの発行(2026-08-23 Tier 0 その4 追加)。既存セッションを壊さないため確認なしで即実行する。 */
  async function handleIssueReset(member: MemberDto) {
    setResetIssuePendingId(member.id);
    setResetIssueError(null);
    try {
      const res = await api.issueMemberPasswordReset(member.id);
      setRevealLink({
        variant: "reset",
        memberName: member.name,
        memberEmail: member.email,
        token: res.passwordReset.token,
        expiresAt: res.passwordReset.expiresAt,
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setResetIssueError({
        memberId: member.id,
        message: err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network,
      });
    } finally {
      setResetIssuePendingId(null);
    }
  }

  function openRevokeResetConfirm(member: MemberDto) {
    setRevokeResetTarget(member);
    setRevokeResetError(null);
  }

  async function handleRevokeResetConfirm() {
    if (!revokeResetTarget) return;
    setRevokeResetPending(true);
    setRevokeResetError(null);
    try {
      await api.revokeMemberPasswordReset(revokeResetTarget.id);
      setRevokeResetTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setRevokeResetError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setRevokeResetPending(false);
    }
  }

  function openDeactivateConfirm(member: MemberDto) {
    setDeactivateTarget(member);
    setDeactivateError(null);
  }

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;
    setDeactivatePending(true);
    setDeactivateError(null);
    try {
      await api.deactivateMember(deactivateTarget.id);
      setDeactivateTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setDeactivateError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setDeactivatePending(false);
    }
  }

  async function handleReactivate(member: MemberDto) {
    setReactivatePendingId(member.id);
    setReactivateError(null);
    try {
      await api.reactivateMember(member.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setReactivateError({
        memberId: member.id,
        message: err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network,
      });
    } finally {
      setReactivatePendingId(null);
    }
  }

  async function handleWorkPolicySubmit(e: React.FormEvent, memberId: string) {
    e.preventDefault();
    setWorkPolicySaving(true);
    setWorkPolicyError(null);
    setWorkPolicySuccess(false);
    try {
      await api.assignMemberWorkPolicy(memberId, workPolicyForm);
      const res = await api.getMemberWorkPolicy(memberId);
      setWorkPolicy(res);
      setWorkPolicySuccess(true);
      // 一覧のバッジ(workSystemKind)にも反映させる。
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setWorkPolicyError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setWorkPolicySaving(false);
    }
  }

  const visibleMembers = useMemo(() => members?.filter((m) => showInactive || m.isActive) ?? null, [members, showInactive]);

  const expandedMember = members?.find((m) => m.id === expandedId) ?? null;

  const savedPresetIdsForExpanded = useMemo(
    () => (expandedMember ? matchAssignedPresetIds(expandedMember.presetNames, presets) : []),
    [expandedMember, presets],
  );
  const hasUnsavedChange =
    expandedMember !== null &&
    (selectedPresetIds.length !== savedPresetIdsForExpanded.length ||
      [...selectedPresetIds].sort().join(",") !== [...savedPresetIdsForExpanded].sort().join(","));

  const effectiveEntries = useMemo(() => {
    const selected = presets.filter((p) => selectedPresetIds.includes(p.id));
    return computeEffectivePermissions(
      selected.map((p) => ({ name: p.name, grants: p.grants })),
      catalog,
    );
  }, [presets, selectedPresetIds, catalog]);

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="org-settings">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="org-settings__main org-settings__main--wide">
        <SettingsNav active="members" />
        <h1 className="org-settings__title">{messages.members.title}</h1>
        <p className="org-settings__tagline">{messages.members.tagline}</p>

        {forbidden ? (
          <p className="org-settings__forbidden" role="alert">
            {messages.members.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && members ? (
          <div className="org-settings__toolbar">
            <label className="org-settings__filter">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              {messages.members.showInactiveToggle}
            </label>
            {canInvite ? (
              <button
                type="button"
                className="org-settings__primary-btn"
                onClick={() => {
                  setInviteError(null);
                  setInviteFormOpen(true);
                }}
              >
                {messages.members.inviteButton}
              </button>
            ) : null}
          </div>
        ) : null}

        {!forbidden && visibleMembers ? (
          visibleMembers.length === 0 ? (
            <p className="org-settings__empty">{messages.members.empty}</p>
          ) : (
            <div className="org-settings__table-wrap">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>{messages.members.columnName}</th>
                    <th>{messages.members.columnEmail}</th>
                    <th>{messages.members.columnDepartment}</th>
                    <th>{messages.members.columnHireDate}</th>
                    <th>{messages.members.columnPresets}</th>
                    <th>{messages.members.columnWorkSystem}</th>
                    <th>{messages.members.columnInviteStatus}</th>
                    <th>{messages.members.columnStatus}</th>
                    <th>{messages.members.columnActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMembers.map((member) => {
                    const isExpanded = expandedId === member.id;
                    const isSelf = member.id === guard.user?.id;
                    return (
                      <Fragment key={member.id}>
                        <tr className={member.isActive ? undefined : "member-row--inactive"}>
                          <td>{member.name}</td>
                          <td className="org-table__muted">{member.email}</td>
                          <td>
                            {departments.length > 0 ? (
                              <select
                                aria-label={messages.members.departmentChangeLabel}
                                value={member.department?.id ?? ""}
                                disabled={deptChangePendingId === member.id}
                                onChange={(e) => handleDepartmentChange(member.id, e.target.value)}
                              >
                                {member.department === null ? <option value="">{messages.members.noDepartment}</option> : null}
                                {departments.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="org-table__muted">{member.department?.name ?? messages.members.noDepartment}</span>
                            )}
                            {deptChangeError?.memberId === member.id ? (
                              <p className="correction-error" role="alert">
                                {deptChangeError.message}
                              </p>
                            ) : null}
                          </td>
                          <td>
                            <div className="member-hire-date">
                              <input
                                type="date"
                                aria-label={messages.members.hireDateLabel}
                                value={hireDateDraftFor(member)}
                                disabled={hireDatePendingId === member.id}
                                onChange={(e) => setHireDateDrafts((prev) => ({ ...prev, [member.id]: e.target.value }))}
                              />
                              <button
                                type="button"
                                className="org-table__link-btn"
                                disabled={hireDatePendingId === member.id}
                                onClick={() => handleHireDateSave(member)}
                              >
                                {hireDatePendingId === member.id ? messages.members.hireDateSaving : messages.members.hireDateSave}
                              </button>
                              {!member.hireDate ? (
                                <p className="member-hire-date__warning" role="alert">
                                  {messages.members.hireDateWarning}
                                </p>
                              ) : null}
                              {hireDateError?.memberId === member.id ? (
                                <p className="correction-error" role="alert">
                                  {hireDateError.message}
                                </p>
                              ) : null}
                              {hireDateSavedId === member.id ? (
                                <p className="settings-notif__success">{messages.members.hireDateSaved}</p>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            {member.presetNames.length > 0 ? (
                              <div className="chip-row">
                                {member.presetNames.map((name, i) => (
                                  <span key={`${member.id}-${name}-${i}`} className="chip">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="org-table__muted">{messages.members.noPresets}</span>
                            )}
                          </td>
                          <td>
                            {member.workSystemKind ? (
                              <span className="chip">{messages.monthly.workSystemValue[member.workSystemKind]}</span>
                            ) : (
                              <span className="org-table__muted">{messages.members.workSystemUnset}</span>
                            )}
                          </td>
                          <td>
                            <div className="chip-row">
                              {/* active(通常状態)は無印。招待中・期限切れのみバッジを出す(依頼どおり)。 */}
                              {member.inviteStatus !== "active" ? (
                                <span className={`invite-status-badge invite-status-badge--${member.inviteStatus}`}>
                                  {messages.members.inviteStatusBadge[member.inviteStatus]}
                                </span>
                              ) : null}
                              {member.hasPendingPasswordReset ? (
                                <span className="invite-status-badge invite-status-badge--invited">
                                  {messages.members.passwordResetBadge}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            {!member.isActive ? (
                              <span className="invite-status-badge invite-status-badge--inactive">{messages.members.inactiveBadge}</span>
                            ) : null}
                          </td>
                          <td>
                            <div className="org-table__actions">
                              <button type="button" className="org-table__link-btn" onClick={() => toggleExpand(member)}>
                                {isExpanded ? messages.members.detailToggleClose : messages.members.detailToggleOpen}
                              </button>
                              {canInvite && member.isActive && member.inviteStatus !== "active" ? (
                                <>
                                  <button type="button" className="org-table__link-btn" onClick={() => openReissueConfirm(member)}>
                                    {messages.members.reissueButton}
                                  </button>
                                  <button
                                    type="button"
                                    className="org-table__link-btn org-table__link-btn--danger"
                                    onClick={() => openRevokeInviteConfirm(member)}
                                  >
                                    {messages.members.revokeInviteButton}
                                  </button>
                                </>
                              ) : null}
                              {canInvite && member.isActive && member.inviteStatus === "active" ? (
                                <button
                                  type="button"
                                  className="org-table__link-btn"
                                  disabled={resetIssuePendingId === member.id}
                                  onClick={() => handleIssueReset(member)}
                                >
                                  {resetIssuePendingId === member.id ? messages.members.inviteSubmitting : messages.members.passwordResetButton}
                                </button>
                              ) : null}
                              {canInvite && member.hasPendingPasswordReset ? (
                                <button
                                  type="button"
                                  className="org-table__link-btn org-table__link-btn--danger"
                                  onClick={() => openRevokeResetConfirm(member)}
                                >
                                  {messages.members.passwordResetRevokeButton}
                                </button>
                              ) : null}
                              {canDeactivate && member.isActive && !isSelf ? (
                                <button
                                  type="button"
                                  className="org-table__link-btn org-table__link-btn--danger"
                                  onClick={() => openDeactivateConfirm(member)}
                                >
                                  {messages.members.deactivateButton}
                                </button>
                              ) : null}
                              {canDeactivate && !member.isActive ? (
                                <button
                                  type="button"
                                  className="org-table__link-btn"
                                  disabled={reactivatePendingId === member.id}
                                  onClick={() => handleReactivate(member)}
                                >
                                  {reactivatePendingId === member.id ? messages.members.reactivating : messages.members.reactivateButton}
                                </button>
                              ) : null}
                            </div>
                            {resetIssueError?.memberId === member.id ? (
                              <p className="correction-error" role="alert">
                                {resetIssueError.message}
                              </p>
                            ) : null}
                            {reactivateError?.memberId === member.id ? (
                              <p className="correction-error" role="alert">
                                {reactivateError.message}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr key={`${member.id}-detail`}>
                            <td colSpan={9} className="org-table__detail-cell">
                              <div className="member-detail">
                                <section className="member-detail__section">
                                  <h2 className="member-detail__section-title">{messages.members.presetAssignTitle}</h2>
                                  <p className="member-detail__hint">{messages.members.presetAssignHint}</p>
                                  {presets.length === 0 ? (
                                    <p className="org-settings__empty">{messages.members.noPresetsAvailable}</p>
                                  ) : (
                                    <ul className="preset-checkbox-list">
                                      {presets.map((preset) => (
                                        <li key={preset.id}>
                                          <label className="preset-checkbox-list__item">
                                            <input
                                              type="checkbox"
                                              checked={selectedPresetIds.includes(preset.id)}
                                              onChange={() => togglePreset(preset.id)}
                                            />
                                            <span>{preset.name}</span>
                                            {preset.description ? (
                                              <span className="preset-checkbox-list__desc">{preset.description}</span>
                                            ) : null}
                                          </label>
                                        </li>
                                      ))}
                                    </ul>
                                  )}

                                  {hasUnsavedChange ? (
                                    <p className="member-detail__unsaved">{messages.members.presetAssignUnsaved}</p>
                                  ) : null}
                                  {assignError ? (
                                    <p className="correction-error" role="alert">
                                      {assignError}
                                    </p>
                                  ) : null}
                                  {assignSaved && !hasUnsavedChange ? (
                                    <p className="settings-notif__success">{messages.members.presetAssignSaved}</p>
                                  ) : null}

                                  <button
                                    type="button"
                                    className="k-modal__confirm k-modal__confirm--neutral"
                                    disabled={assignPending}
                                    onClick={() => handleAssignSave(member.id)}
                                  >
                                    {assignPending ? messages.members.presetAssignSaving : messages.members.presetAssignSave}
                                  </button>
                                </section>

                                <section className="member-detail__section">
                                  <h2 className="member-detail__section-title">{messages.members.effectiveTitle}</h2>
                                  <p className="member-detail__hint">{messages.members.effectiveHint}</p>
                                  <EffectivePermissionsPanel entries={effectiveEntries} />
                                </section>

                                {canManageWorkPolicy ? (
                                  <section className="member-detail__section member-detail__section--full">
                                    <h2 className="member-detail__section-title">{messages.members.workPolicyTitle}</h2>
                                    <p className="member-detail__hint">{messages.members.workPolicyHint}</p>

                                    {workPolicyLoading ? (
                                      <p className="org-settings__empty">{messages.loading}</p>
                                    ) : (
                                      <>
                                        <div className="member-work-policy__current">
                                          {workPolicy?.effective ? (
                                            <>
                                              <span>
                                                {messages.members.workPolicyCurrentLabel}:{" "}
                                                {messages.monthly.workSystemValue[workPolicy.effective.kind]}
                                              </span>
                                              <span className="member-work-policy__current-effective-from tabular-nums">
                                                {messages.members.workPolicyCurrentEffectiveFrom}: {workPolicy.effective.effectiveFrom}
                                              </span>
                                            </>
                                          ) : (
                                            <span className="org-settings__empty">{messages.members.workPolicyNoneYet}</span>
                                          )}
                                        </div>

                                        <h3 className="member-detail__section-title">{messages.members.workPolicyFormTitle}</h3>
                                        <form
                                          className="member-work-policy__form"
                                          onSubmit={(e) => handleWorkPolicySubmit(e, member.id)}
                                        >
                                          <div className="correction-field">
                                            <label htmlFor={`member-work-policy-kind-${member.id}`}>
                                              {messages.members.workPolicyKindLabel}
                                            </label>
                                            <select
                                              id={`member-work-policy-kind-${member.id}`}
                                              value={workPolicyForm.kind}
                                              onChange={(e) =>
                                                setWorkPolicyForm((prev) => ({ ...prev, kind: e.target.value as WorkSystemKind }))
                                              }
                                            >
                                              <option value="flex">{messages.monthly.workSystemValue.flex}</option>
                                              <option value="fixed">{messages.monthly.workSystemValue.fixed}</option>
                                            </select>
                                          </div>
                                          <div className="correction-field">
                                            <label htmlFor={`member-work-policy-effective-from-${member.id}`}>
                                              {messages.members.workPolicyEffectiveFromLabel}
                                            </label>
                                            <input
                                              id={`member-work-policy-effective-from-${member.id}`}
                                              type="date"
                                              min={todayDate}
                                              value={workPolicyForm.effectiveFrom}
                                              onChange={(e) =>
                                                setWorkPolicyForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))
                                              }
                                              required
                                            />
                                            <span className="settings-notif__field-hint">
                                              {messages.members.workPolicyEffectiveFromHint}
                                            </span>
                                          </div>

                                          {workPolicyError ? (
                                            <p className="correction-error" role="alert">
                                              {workPolicyError}
                                            </p>
                                          ) : null}
                                          {workPolicySuccess ? (
                                            <p className="settings-notif__success">{messages.members.workPolicySubmitSuccess}</p>
                                          ) : null}

                                          <button
                                            type="submit"
                                            className="k-modal__confirm k-modal__confirm--neutral"
                                            disabled={workPolicySaving}
                                          >
                                            {workPolicySaving ? messages.members.workPolicySubmitting : messages.members.workPolicySubmit}
                                          </button>
                                        </form>

                                        <h3 className="member-detail__section-title">{messages.members.workPolicyHistoryTitle}</h3>
                                        {!workPolicy || workPolicy.history.length === 0 ? (
                                          <p className="org-settings__empty">{messages.members.workPolicyHistoryEmpty}</p>
                                        ) : (
                                          <div className="org-settings__table-wrap">
                                            <table className="org-table">
                                              <thead>
                                                <tr>
                                                  <th>{messages.members.workPolicyHistoryColumnEffectiveFrom}</th>
                                                  <th>{messages.members.workPolicyHistoryColumnKind}</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {[...workPolicy.history].reverse().map((h) => (
                                                  <tr key={h.effectiveFrom}>
                                                    <td className="tabular-nums">{h.effectiveFrom}</td>
                                                    <td>{messages.monthly.workSystemValue[h.kind]}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </section>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </main>

      {inviteFormOpen ? (
        <InviteMemberDialog
          departments={departments}
          presets={presets}
          pending={invitePending}
          error={inviteError}
          onSubmit={handleInviteSubmit}
          onCancel={() => setInviteFormOpen(false)}
        />
      ) : null}

      {revealLink ? (
        <InviteLinkDialog
          variant={revealLink.variant}
          memberName={revealLink.memberName}
          memberEmail={revealLink.memberEmail}
          token={revealLink.token}
          expiresAt={revealLink.expiresAt}
          onClose={() => setRevealLink(null)}
        />
      ) : null}

      {reissueTarget ? (
        <ConfirmDialog
          title={messages.members.reissueConfirmTitle}
          message={`「${reissueTarget.name}」— ${messages.members.reissueConfirmMessage}`}
          confirmLabel={messages.members.reissueButton}
          tone="neutral"
          note=""
          pending={reissuePending}
          error={reissueError}
          onConfirm={handleReissueConfirm}
          onCancel={() => {
            setReissueTarget(null);
            setReissueError(null);
          }}
        />
      ) : null}

      {revokeInviteTarget ? (
        <ConfirmDialog
          title={messages.members.revokeInviteConfirmTitle}
          message={`「${revokeInviteTarget.name}」— ${messages.members.revokeInviteConfirmMessage}`}
          confirmLabel={messages.members.revokeInviteButton}
          tone="caution"
          note=""
          pending={revokeInvitePending}
          error={revokeInviteError}
          onConfirm={handleRevokeInviteConfirm}
          onCancel={() => {
            setRevokeInviteTarget(null);
            setRevokeInviteError(null);
          }}
        />
      ) : null}

      {revokeResetTarget ? (
        <ConfirmDialog
          title={messages.members.passwordResetRevokeConfirmTitle}
          message={`「${revokeResetTarget.name}」— ${messages.members.passwordResetRevokeConfirmMessage}`}
          confirmLabel={messages.members.passwordResetRevokeButton}
          tone="caution"
          note=""
          pending={revokeResetPending}
          error={revokeResetError}
          onConfirm={handleRevokeResetConfirm}
          onCancel={() => {
            setRevokeResetTarget(null);
            setRevokeResetError(null);
          }}
        />
      ) : null}

      {deactivateTarget ? (
        <ConfirmDialog
          title={messages.members.deactivateConfirmTitle}
          message={
            <>
              {`「${deactivateTarget.name}」— ${messages.members.deactivateConfirmMessage}`}
              <ul className="deactivate-confirm__impact">
                <li>{messages.members.deactivateConfirmImpactLogin}</li>
                <li>{messages.members.deactivateConfirmImpactSession}</li>
                <li>{messages.members.deactivateConfirmImpactInviteReset}</li>
              </ul>
            </>
          }
          confirmLabel={messages.members.deactivateButton}
          tone="caution"
          note=""
          pending={deactivatePending}
          error={deactivateError}
          onConfirm={handleDeactivateConfirm}
          onCancel={() => {
            setDeactivateTarget(null);
            setDeactivateError(null);
          }}
        />
      ) : null}
    </div>
  );
}
