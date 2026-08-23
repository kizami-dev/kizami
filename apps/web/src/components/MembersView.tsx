"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type DepartmentDto,
  type IssuedInvitationDto,
  type MemberDto,
  type PermissionCatalogEntryDto,
  type PermissionPresetDto,
} from "../lib/api";
import { mapAssignmentErrorMessage, mapMemberErrorMessage, messages } from "../lib/messages";
import { computeEffectivePermissions, matchAssignedPresetIds } from "../lib/permissions";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { EffectivePermissionsPanel } from "./EffectivePermissionsPanel";
import { InviteLinkDialog } from "./InviteLinkDialog";
import { InviteMemberDialog, type InviteMemberFormValue } from "./InviteMemberDialog";
import { SettingsNav } from "./SettingsNav";

/**
 * メンバー管理画面(/settings/members)。所属変更・権限プリセット割当・実効権限ビュー(必須要件)。
 * docs/requirements.md §4。
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

  // 招待リンクの提示画面(発行・再発行いずれの直後にも使う共通の reveal 状態)。
  const [revealInvite, setRevealInvite] = useState<{ memberName: string; memberEmail: string; invitation: IssuedInvitationDto } | null>(
    null,
  );

  const [reissueTarget, setReissueTarget] = useState<MemberDto | null>(null);
  const [reissuePending, setReissuePending] = useState(false);
  const [reissueError, setReissueError] = useState<string | null>(null);

  const [revokeInviteTarget, setRevokeInviteTarget] = useState<MemberDto | null>(null);
  const [revokeInvitePending, setRevokeInvitePending] = useState(false);
  const [revokeInviteError, setRevokeInviteError] = useState<string | null>(null);

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

  function toggleExpand(member: MemberDto) {
    if (expandedId === member.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(member.id);
    setSelectedPresetIds(matchAssignedPresetIds(member.presetNames, presets));
    setAssignError(null);
    setAssignSaved(false);
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
      setRevealInvite({ memberName: res.member.name, memberEmail: res.member.email, invitation: res.invitation });
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
      setRevealInvite({ memberName: reissueTarget.name, memberEmail: reissueTarget.email, invitation: res.invitation });
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

  /**
   * 招待の発行・再発行・取り消し(member.invite)を出すかどうかの判定(判断点、完了報告に明記):
   * apps/api には「自分の実効権限」を返すエンドポイントが無く、GET /members も一覧全体の
   * inviteStatus しか返さない(自分の権限有無は分からない)。そのため、一覧に含まれる
   * 自分自身の presetNames(member.presetNames)を GET /presets と突き合わせて実効権限を
   * 計算する — これはメンバー詳細の「できること」パネル(effectiveEntries、上記)で既に
   * 使っている computeEffectivePermissions をそのまま自分自身に適用するだけであり、
   * 新しいAPI呼び出しを増やさない。あくまでUI表示の出し分け用の推定であり、実際の許可判定は
   * 常に apps/api 側(requirePermission)が行う。
   */
  const selfMember = members?.find((m) => guard.user && m.id === guard.user.id) ?? null;
  const selfPresetIds = useMemo(
    () => (selfMember ? matchAssignedPresetIds(selfMember.presetNames, presets) : []),
    [selfMember, presets],
  );
  const selfEffectiveEntries = useMemo(() => {
    const selected = presets.filter((p) => selfPresetIds.includes(p.id));
    return computeEffectivePermissions(
      selected.map((p) => ({ name: p.name, grants: p.grants })),
      catalog,
    );
  }, [presets, selfPresetIds, catalog]);
  const canInvite = selfEffectiveEntries.some((e) => e.key === "member.invite");

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

        {!forbidden && members && canInvite ? (
          <div className="org-settings__toolbar">
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
          </div>
        ) : null}

        {!forbidden && members ? (
          members.length === 0 ? (
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
                    <th>{messages.members.columnInviteStatus}</th>
                    <th>{messages.members.columnActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const isExpanded = expandedId === member.id;
                    return (
                      <Fragment key={member.id}>
                        <tr>
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
                            {/* active(通常状態)は無印。招待中・期限切れのみバッジを出す(依頼どおり)。 */}
                            {member.inviteStatus !== "active" ? (
                              <span className={`invite-status-badge invite-status-badge--${member.inviteStatus}`}>
                                {messages.members.inviteStatusBadge[member.inviteStatus]}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <div className="org-table__actions">
                              <button type="button" className="org-table__link-btn" onClick={() => toggleExpand(member)}>
                                {isExpanded ? messages.members.detailToggleClose : messages.members.detailToggleOpen}
                              </button>
                              {canInvite && member.inviteStatus !== "active" ? (
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
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr key={`${member.id}-detail`}>
                            <td colSpan={7} className="org-table__detail-cell">
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

      {revealInvite ? (
        <InviteLinkDialog
          memberName={revealInvite.memberName}
          memberEmail={revealInvite.memberEmail}
          invitation={revealInvite.invitation}
          onClose={() => setRevealInvite(null)}
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
    </div>
  );
}
