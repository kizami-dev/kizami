"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type DepartmentDto,
  type LeaveGrantClass,
  type MemberDto,
  type MemberWorkPolicySettingsDto,
  type PermissionCatalogEntryDto,
  type PermissionPresetDto,
  type WorkPolicyDto,
} from "../lib/api";
import { formatEffectiveFrom } from "../lib/effective-from";
import { mapAssignmentErrorMessage, mapMemberErrorMessage, messages } from "../lib/messages";
import { computeEffectivePermissions, hasEffectivePermission, matchAssignedPresetIds } from "../lib/permissions";
import { dateStrFromEpochMinutesJst, formatDurationHm, nowMinutes } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useEffectivePermissions } from "../lib/useEffectivePermissions";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { EffectivePermissionsPanel } from "./EffectivePermissionsPanel";
import { InviteLinkDialog } from "./InviteLinkDialog";
import { InviteMemberDialog, type InviteMemberFormValue } from "./InviteMemberDialog";
import { SettingsNav } from "./SettingsNav";
import { MenuButton, type MenuItem } from "./ui/MenuButton";
import { StateView } from "./ui/StateView";
import { PageHeader } from "./ui/PageHeader";

/**
 * 労働時間制の制度の表示(「固定・時短(6時間)(固定時間制・1日6:00)」)。選択肢と現在値で共通。
 * 2026-10-05(名前付きの制度): 割当は kind ではなく制度を名前で選ぶ。同じ種類の制度が複数ありうるため、
 * 種類と所定も添えて見分けられるようにする。
 */
function workPolicyLabel(name: string, kind: WorkPolicyDto["kind"], standardDayMinutes: number | null): string {
  const summary = workPolicySummary(kind, standardDayMinutes);
  return summary === null ? name : messages.members.workPolicyOption(name, summary);
}

/**
 * 制度の種類と1日の所定の要約(「固定時間制・1日6:00」)。選択欄の下の補足と、現在値・履歴で使う。
 * 変形労働時間制で基準所定が 0(未設定)のときは、所定はシフトで決まる旨を出す(0:00 と出さない)。
 */
function workPolicySummary(kind: WorkPolicyDto["kind"], standardDayMinutes: number | null): string | null {
  if (!kind || standardDayMinutes === null) return null;
  const standard =
    kind === "monthly_variable" && standardDayMinutes === 0
      ? messages.settingsWorkPolicies.standardDayByShift
      : messages.members.workPolicyStandardPerDay(formatDurationHm(standardDayMinutes));
  return messages.members.workPolicySummary(messages.monthly.workSystemValue[kind], standard);
}

/** 有給付与の区分の選択肢(表示順。@kizami/leave の LeaveGrantClass と一致)。 */
const LEAVE_GRANT_CLASS_OPTIONS: readonly LeaveGrantClass[] = ["full", "days4", "days3", "days2", "days1"];

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

  // 有給付与の区分(比例付与、2026-08-24 追加)。入社日と同じく行ごとの下書き + 明示的な保存。
  // 誤って比例付与に落とすと法定より少ない日数しか付与されないため、選択と同時にはコミットしない。
  const [grantClassDrafts, setGrantClassDrafts] = useState<Record<string, LeaveGrantClass>>({});
  const [grantClassPendingId, setGrantClassPendingId] = useState<string | null>(null);
  const [grantClassError, setGrantClassError] = useState<{ memberId: string; message: string } | null>(null);
  const [grantClassSavedId, setGrantClassSavedId] = useState<string | null>(null);

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

  // 二要素認証の管理者リセット(2026-08-27 追加)。認証アプリもリカバリコードも失った人の
  // 唯一の救済経路のため管理者に出すが、実行すると対象者の 2FA 保護が外れる(次回は
  // パスワードのみでログインできてしまう)ので、退職処理と同じく確認ダイアログを挟む。
  const [twoFactorResetTarget, setTwoFactorResetTarget] = useState<MemberDto | null>(null);
  const [twoFactorResetPending, setTwoFactorResetPending] = useState(false);
  const [twoFactorResetError, setTwoFactorResetError] = useState<string | null>(null);

  // 退職者の個人データ消去(2026-08-27 追加、docs/design/data-retention.md)。
  // 無効化と違って**取り消せない**ため、確認ダイアログでは影響の列挙に加えて対象者氏名の
  // 再入力を求める(ConfirmDialog の confirmPhrase)。
  const [eraseTarget, setEraseTarget] = useState<MemberDto | null>(null);
  const [erasePending, setErasePending] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  // メンバー個別の労働時間制(2026-08-23 Tier 0 その4 追加)。GET/POST /members/:id/work-policy は
  // tenant_settings.flex.manage(テナント全体スコープ)を要求するため、この権限を持たない場合は
  // そもそも GET も 403 になる — 詳細行を開いたときにその権限を持つ場合のみ取得する
  // (下記 toggleExpand・canManageWorkPolicy 参照)。
  const todayDate = dateStrFromEpochMinutesJst(nowMinutes());
  const [workPolicy, setWorkPolicy] = useState<MemberWorkPolicySettingsDto | null>(null);
  const [workPolicyLoading, setWorkPolicyLoading] = useState(false);
  const [workPolicyForm, setWorkPolicyForm] = useState<{ workPolicyId: string; effectiveFrom: string }>({
    workPolicyId: "",
    effectiveFrom: todayDate,
  });
  /**
   * テナントの労働時間制の制度(GET /settings/work-policies、tenant_settings.flex.manage)。
   * 割当の選択肢と、招待フォームの制度の選択肢に使う。権限が無ければ 403 で空のまま
   * (その場合は割当の区画も招待の選択欄も出さない)。
   */
  const [workPolicies, setWorkPolicies] = useState<WorkPolicyDto[]>([]);
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
        const [deptRes, presetRes, catalogRes, workPoliciesRes] = await Promise.allSettled([
          api.listDepartments(),
          api.listPresets(),
          api.getPresetCatalog(),
          api.listWorkPolicies(),
        ]);
        if (cancelled) return;
        if (deptRes.status === "fulfilled") setDepartments(deptRes.value.departments);
        if (presetRes.status === "fulfilled") setPresets(presetRes.value.presets);
        if (catalogRes.status === "fulfilled") setCatalog(catalogRes.value.catalog);
        if (workPoliciesRes.status === "fulfilled") setWorkPolicies(workPoliciesRes.value.policies);
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
   * 退職者の個人データ消去(2026-08-27 追加)。`member.deactivate` とは別のカタログ項目で、
   * スコープはテナント全体のみ(部署長が自部署の退職者だけ消せる状態を作らないため —
   * packages/authz/src/catalog.ts の member.erase のコメント参照)。
   */
  const canErase = hasEffectivePermission(effectivePermissions, "member.erase", "tenant");
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
    setWorkPolicyForm({ workPolicyId: member.workPolicyId ?? "", effectiveFrom: todayDate });
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
          // 選択の初期値は今の制度(変えたいものだけ選び直せばよい)。
          setWorkPolicyForm({ workPolicyId: res.effective?.workPolicyId ?? member.workPolicyId ?? "", effectiveFrom: todayDate });
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

  function grantClassDraftFor(member: MemberDto): LeaveGrantClass {
    return grantClassDrafts[member.id] ?? member.leaveGrantClass;
  }

  async function handleGrantClassSave(member: MemberDto) {
    const value = grantClassDraftFor(member);
    setGrantClassPendingId(member.id);
    setGrantClassError(null);
    setGrantClassSavedId(null);
    try {
      await api.updateMemberLeaveGrantClass(member.id, value);
      setGrantClassSavedId(member.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setGrantClassError({
        memberId: member.id,
        message: err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network,
      });
    } finally {
      setGrantClassPendingId(null);
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
        ...(value.workPolicyId !== null ? { workPolicyId: value.workPolicyId } : {}),
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

  function openTwoFactorResetConfirm(member: MemberDto) {
    setTwoFactorResetTarget(member);
    setTwoFactorResetError(null);
  }

  async function handleTwoFactorResetConfirm() {
    if (!twoFactorResetTarget) return;
    setTwoFactorResetPending(true);
    setTwoFactorResetError(null);
    try {
      await api.resetMemberTwoFactor(twoFactorResetTarget.id);
      setTwoFactorResetTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setTwoFactorResetError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setTwoFactorResetPending(false);
    }
  }

  function openEraseConfirm(member: MemberDto) {
    setEraseTarget(member);
    setEraseError(null);
  }

  async function handleEraseConfirm() {
    if (!eraseTarget) return;
    setErasePending(true);
    setEraseError(null);
    try {
      await api.eraseMember(eraseTarget.id);
      setEraseTarget(null);
      // 消去後は氏名・メールが変わるため、詳細を開いたままにしない(古い氏名が残って見える)。
      setExpandedId(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setEraseError(err instanceof ApiError ? mapMemberErrorMessage(err.body) : messages.errors.network);
    } finally {
      setErasePending(false);
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
    setWorkPolicyError(null);
    setWorkPolicySuccess(false);

    if (workPolicyForm.workPolicyId === "") {
      setWorkPolicyError(messages.members.errors.invalid_work_policy_id);
      return;
    }

    setWorkPolicySaving(true);
    try {
      // 2026-10-05(名前付きの制度): 制度の id で割り当てる。所定は制度の版が持つため、
      // 人ごとに所定を変えたいときは制度を分ける(勤怠ルールの「労働時間制の制度」)。
      await api.assignMemberWorkPolicy(memberId, {
        workPolicyId: workPolicyForm.workPolicyId,
        effectiveFrom: workPolicyForm.effectiveFrom,
      });
      const res = await api.getMemberWorkPolicy(memberId);
      setWorkPolicy(res);
      setWorkPolicySuccess(true);
      // 一覧のバッジ(workSystemKind・制度名)にも反映させる。
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

  /** 行の「…」メニューに畳む操作。出し分けの条件は、表に直接並べていた頃と同じ。 */
  function menuItemsFor(member: MemberDto, isSelf: boolean): MenuItem[] {
    const items: MenuItem[] = [];
    if (canInvite && member.isActive && member.inviteStatus !== "active") {
      items.push({ key: "reissue", label: messages.members.reissueButton, onSelect: () => openReissueConfirm(member) });
      items.push({ key: "revokeInvite", label: messages.members.revokeInviteButton, danger: true, onSelect: () => openRevokeInviteConfirm(member) });
    }
    if (canInvite && member.isActive && member.inviteStatus === "active") {
      items.push({
        key: "passwordReset",
        label: resetIssuePendingId === member.id ? messages.members.inviteSubmitting : messages.members.passwordResetButton,
        disabled: resetIssuePendingId === member.id,
        onSelect: () => handleIssueReset(member),
      });
    }
    if (canInvite && member.hasPendingPasswordReset) {
      items.push({ key: "revokeReset", label: messages.members.passwordResetRevokeButton, danger: true, onSelect: () => openRevokeResetConfirm(member) });
    }
    if (canDeactivate && member.isActive && !isSelf) {
      items.push({ key: "deactivate", label: messages.members.deactivateButton, danger: true, onSelect: () => openDeactivateConfirm(member) });
    }
    // 2FA リセットは退職処理と同じ member.deactivate 権限で出す(どちらも「その人のログイン手段に手を入れる」操作)。
    // 自分自身には出さない — 自分の 2FA は /settings/security でパスワード+コードを添えて外すのが正規の手順。
    if (canDeactivate && member.twoFactorEnabled && !isSelf) {
      items.push({ key: "twoFactorReset", label: messages.members.twoFactorResetButton, danger: true, onSelect: () => openTwoFactorResetConfirm(member) });
    }
    if (canDeactivate && !member.isActive && member.erasedAt === null) {
      items.push({
        key: "reactivate",
        label: reactivatePendingId === member.id ? messages.members.reactivating : messages.members.reactivateButton,
        disabled: reactivatePendingId === member.id,
        onSelect: () => handleReactivate(member),
      });
    }
    // 消去は「退職処理済み」かつ「保持期間を経過した」人にだけ出す。押せない状態の項目を出して
    // 409 を返させるより、出さないほうが誤解が少ない — 残り日数は状態列に出ている。
    if (canErase && !member.isActive && member.erasedAt === null && member.retention.erasable) {
      items.push({ key: "erase", label: messages.members.eraseButton, danger: true, onSelect: () => openEraseConfirm(member) });
    }
    return items;
  }

  const visibleMembers = useMemo(() => members?.filter((m) => showInactive || m.isActive) ?? null, [members, showInactive]);

  const expandedMember = members?.find((m) => m.id === expandedId) ?? null;

  // 詳細は表の直後に出る(長い一覧では押した行から離れる)ため、開いたら詳細の区画を画面に入れる。
  useEffect(() => {
    if (expandedId === null) return;
    document.getElementById("member-detail-panel")?.scrollIntoView({ block: "nearest" });
  }, [expandedId]);

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
      selected.map((p) => ({ name: p.name, grants: p.grants, denies: p.denies })),
      catalog,
    );
  }, [presets, selectedPresetIds, catalog]);

  if (guard.status === "loading" || loading) {
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  return (
    <div className="org-settings">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="page">
        <SettingsNav active="members" />
        <PageHeader
          title={messages.members.title}
          lead={messages.members.tagline}
          actions={
            !forbidden && members && canInvite ? (
              <button
                type="button"
                className="btn btn--primary"
                data-tour="member-invite"
                onClick={() => {
                  setInviteError(null);
                  setInviteFormOpen(true);
                }}
              >
                {messages.members.inviteButton}
              </button>
            ) : null
          }
        />

        {forbidden ? (
          <p className="notice notice--danger" role="alert">
            {messages.members.noPermission}
          </p>
        ) : null}
        {loadError ? <StateView kind="error">{loadError}</StateView> : null}

        {!forbidden && members ? (
          <div className="page-toolbar">
            <label className="check">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              {messages.members.showInactiveToggle}
            </label>
          </div>
        ) : null}

        {!forbidden && visibleMembers ? (
          visibleMembers.length === 0 ? (
            <StateView kind="empty">{messages.members.empty}</StateView>
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
                          <td className="member-cell--nowrap">
                            {member.department?.name ?? <span className="org-table__muted">{messages.members.noDepartment}</span>}
                          </td>
                          <td className="member-cell--nowrap tabular-nums">
                            {member.hireDate ? (
                              member.hireDate
                            ) : (
                              <span className="badge badge--magenta" title={messages.members.hireDateWarning}>
                                {messages.members.hireDateUnset}
                              </span>
                            )}
                          </td>
                          <td>
                            {member.presetNames.length > 0 ? (
                              <div className="badge-row">
                                {member.presetNames.map((name, i) => (
                                  <span key={`${member.id}-${name}-${i}`} className="badge badge--neutral">
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
                              <div className="badge-row">
                                <span className="badge badge--neutral">{messages.monthly.workSystemValue[member.workSystemKind]}</span>
                                {/* 制度名(2026-10-05)。同じ種類の制度が複数あるとき、どれかを見分けるため */}
                                {member.workPolicyName ? <span>{member.workPolicyName}</span> : null}
                              </div>
                            ) : (
                              <span className="org-table__muted">{messages.members.workSystemUnset}</span>
                            )}
                          </td>
                          <td>
                            <div className="badge-row">
                              {/* active(通常状態)は無印。招待中・期限切れのみバッジを出す(依頼どおり)。 */}
                              {member.inviteStatus !== "active" ? (
                                <span className={`badge ${member.inviteStatus === "invite_expired" ? "badge--magenta" : "badge--cyan"}`}>
                                  {messages.members.inviteStatusBadge[member.inviteStatus]}
                                </span>
                              ) : null}
                              {member.hasPendingPasswordReset ? (
                                <span className="badge badge--cyan">
                                  {messages.members.passwordResetBadge}
                                </span>
                              ) : null}
                              {/* 二要素認証(2026-08-27 追加)。有効な人だけ出す(無効は無印)。 */}
                              {member.twoFactorEnabled ? (
                                <span className="badge badge--cyan">
                                  {messages.members.twoFactorBadge}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            {!member.isActive ? (
                              <span className="badge badge--magenta">{messages.members.inactiveBadge}</span>
                            ) : null}
                            {/*
                             * 退職者データの保持状況(2026-08-27、docs/design/data-retention.md)。
                             * 「消去可能になった退職者」を一覧で見つけられるようにするのがこの表示の目的。
                             * 日次ワーカーによる通知は**しない** — 消去は期限のある義務ではなく
                             * 「もう消してよい」という状態にすぎず、急かすと誤操作を誘う。
                             */}
                            {member.erasedAt !== null ? (
                              <span className="badge badge--magenta">{messages.members.erasedBadge}</span>
                            ) : !member.isActive && member.retention.deactivatedDate !== null ? (
                              <span className="member-retention" title={messages.members.retentionTitle}>
                                <span className="member-retention__from tabular-nums">
                                  {messages.members.retentionRetiredOn}: {member.retention.deactivatedDate}
                                </span>
                                <span className={member.retention.erasable ? "member-retention__ready" : "member-retention__waiting"}>
                                  {member.retention.erasable
                                    ? messages.members.retentionErasable
                                    : messages.members.retentionRemaining(member.retention.remainingDays ?? 0, member.retention.erasableFrom ?? "")}
                                </span>
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <div className="org-table__actions">
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                aria-expanded={isExpanded}
                                onClick={() => toggleExpand(member)}
                              >
                                {isExpanded ? messages.members.detailShortClose : messages.members.detailShortOpen}
                              </button>
                              <MenuButton label={messages.members.moreActions} items={menuItemsFor(member, isSelf)} />
                            </div>
                            {resetIssueError?.memberId === member.id ? (
                              <p className="notice notice--danger" role="alert">
                                {resetIssueError.message}
                              </p>
                            ) : null}
                            {reactivateError?.memberId === member.id ? (
                              <p className="notice notice--danger" role="alert">
                                {reactivateError.message}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {/*
          メンバーの詳細(2026-10-05: 表の中の1行〔colspan〕から、表の直後の区画へ移した)。
          表の行として描くと、横スクロールの枠(表の min-width)の幅で組まれて本文からはみ出していた。
          本文(.page)の幅で組み、狭い画面では1列に落とす。開いた行の「閉じる」と、ここの「閉じる」は同じ操作。
        */}
        {expandedMember && !forbidden ? (
          <section id="member-detail-panel" className="card" aria-labelledby="member-detail-panel-title">
            <div className="btn-row">
              <h2 id="member-detail-panel-title" className="card__title">
                {expandedMember.name}
              </h2>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggleExpand(expandedMember)}>
                {messages.members.detailShortClose}
              </button>
            </div>
            {(() => {
              const member = expandedMember;
              return (
          <div className="member-detail">
            <section className="member-detail__section member-detail__section--full">
              <h2 className="member-detail__section-title">{messages.members.basicsTitle}</h2>
              <div className="field-row">
                <div className="field">
                  <label htmlFor={`member-department-${member.id}`}>{messages.members.columnDepartment}</label>
                  {departments.length > 0 ? (
                    <select
                      id={`member-department-${member.id}`}
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
                    <p className="notice notice--danger" role="alert">
                      {deptChangeError.message}
                    </p>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor={`member-hire-date-${member.id}`}>{messages.members.columnHireDate}</label>
                  <div className="member-basics__hire-date">
                    <input
                      id={`member-hire-date-${member.id}`}
                      type="date"
                      value={hireDateDraftFor(member)}
                      disabled={hireDatePendingId === member.id}
                      onChange={(e) => setHireDateDrafts((prev) => ({ ...prev, [member.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={hireDatePendingId === member.id}
                      onClick={() => handleHireDateSave(member)}
                    >
                      {hireDatePendingId === member.id ? messages.members.hireDateSaving : messages.members.hireDateSave}
                    </button>
                  </div>
                  {!member.hireDate ? (
                    <p className="notice notice--caution" role="alert">
                      {messages.members.hireDateWarning}
                    </p>
                  ) : null}
                  {hireDateError?.memberId === member.id ? (
                    <p className="notice notice--danger" role="alert">
                      {hireDateError.message}
                    </p>
                  ) : null}
                  {hireDateSavedId === member.id ? (
                    <p className="notice notice--success">{messages.members.hireDateSaved}</p>
                  ) : null}
                </div>
              </div>
            </section>

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
                <p className="notice notice--danger" role="alert">
                  {assignError}
                </p>
              ) : null}
              {assignSaved && !hasUnsavedChange ? (
                <p className="notice notice--success">{messages.members.presetAssignSaved}</p>
              ) : null}

              <button
                type="button"
                className="btn btn--primary"
                disabled={assignPending}
                onClick={() => handleAssignSave(member.id)}
              >
                {assignPending ? messages.members.presetAssignSaving : messages.members.presetAssignSave}
              </button>
            </section>

            <section className="member-detail__section">
              <h2 className="member-detail__section-title">{messages.members.leaveGrantClassTitle}</h2>
              <p className="member-detail__hint">{messages.members.leaveGrantClassHint}</p>
              {/* 共通の .field に入れて、他の選択欄と同じ高さ・幅にする(2026-10-05) */}
              <div className="field">
                <select
                  aria-label={messages.members.leaveGrantClassLabel}
                  value={grantClassDraftFor(member)}
                  disabled={grantClassPendingId === member.id}
                  onChange={(e) => {
                    const next = e.target.value as LeaveGrantClass;
                    setGrantClassSavedId(null);
                    setGrantClassDrafts((prev) => ({ ...prev, [member.id]: next }));
                  }}
                >
                  {LEAVE_GRANT_CLASS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {messages.members.leaveGrantClassOption[value]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="member-detail__hint">{messages.members.leaveGrantClassNote}</p>
              {grantClassError?.memberId === member.id ? (
                <p className="notice notice--danger" role="alert">
                  {grantClassError.message}
                </p>
              ) : null}
              {grantClassSavedId === member.id ? (
                <p className="notice notice--success">{messages.members.leaveGrantClassSaved}</p>
              ) : null}
              <button
                type="button"
                className="btn btn--secondary"
                disabled={grantClassPendingId === member.id}
                onClick={() => handleGrantClassSave(member)}
              >
                {grantClassPendingId === member.id
                  ? messages.members.leaveGrantClassSaving
                  : messages.members.leaveGrantClassSave}
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
                            {workPolicyLabel(
                              workPolicy.effective.workPolicyName,
                              workPolicy.effective.kind,
                              workPolicy.effective.standardDayMinutes,
                            )}
                          </span>
                          <span className="member-work-policy__current-effective-from tabular-nums">
                            {messages.members.workPolicyCurrentEffectiveFrom}: {formatEffectiveFrom(workPolicy.effective.effectiveFrom)}
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
                      <div className="field">
                        <label htmlFor={`member-work-policy-id-${member.id}`}>
                          {messages.members.workPolicyPolicyLabel}
                        </label>
                        <select
                          id={`member-work-policy-id-${member.id}`}
                          value={workPolicyForm.workPolicyId}
                          onChange={(e) =>
                            setWorkPolicyForm((prev) => ({ ...prev, workPolicyId: e.target.value }))
                          }
                          required
                        >
                          {/* アーカイブ済みの制度は新しい割当の選択肢に出さない */}
                          {workPolicies
                            .filter((p) => p.archivedAt === null)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                        {/* 選択肢は名前だけにし(長いと選択欄で切れるため)、種類と所定はここに補足として出す。 */}
                        {(() => {
                          const selected = workPolicies.find((p) => p.id === workPolicyForm.workPolicyId);
                          const summary = selected ? workPolicySummary(selected.kind, selected.effective?.standardDayMinutes ?? null) : null;
                          return summary ? <span className="field__hint">{summary}</span> : null;
                        })()}
                        <span className="field__hint">
                          {workPolicies.every((p) => p.archivedAt !== null) ? `${messages.members.workPolicyNoAssignable} ` : null}
                          <Link to="/settings/attendance">{messages.members.workPolicyManageLink}</Link>
                        </span>
                      </div>
                      <div className="field">
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
                        <span className="field__hint">
                          {messages.members.workPolicyEffectiveFromHint}
                        </span>
                      </div>
                      {workPolicyError ? (
                        <p className="notice notice--danger" role="alert">
                          {workPolicyError}
                        </p>
                      ) : null}
                      {workPolicySuccess ? (
                        <p className="notice notice--success">{messages.members.workPolicySubmitSuccess}</p>
                      ) : null}

                      <button
                        type="submit"
                        className="btn btn--primary"
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
                              <th>{messages.members.workPolicyHistoryColumnPolicy}</th>
                              <th>{messages.members.workPolicyHistoryColumnKind}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...workPolicy.history].reverse().map((h) => (
                              <tr key={h.effectiveFrom}>
                                <td className="tabular-nums">{formatEffectiveFrom(h.effectiveFrom)}</td>
                                <td>{h.workPolicyName}</td>
                                <td className="tabular-nums">
                                  {workPolicySummary(h.kind, h.standardDayMinutes)}
                                </td>
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
              );
            })()}
          </section>
        ) : null}
      </main>

      {inviteFormOpen ? (
        <InviteMemberDialog
          departments={departments}
          presets={presets}
          // 制度の選択は tenant_settings.flex.manage を持つ人だけ(API も同じ権限を要求する)。
          workPolicies={canManageWorkPolicy ? workPolicies.filter((p) => p.archivedAt === null) : []}
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

      {twoFactorResetTarget ? (
        <ConfirmDialog
          title={messages.members.twoFactorResetConfirmTitle}
          message={
            <>
              {`「${twoFactorResetTarget.name}」— ${messages.members.twoFactorResetConfirmMessage}`}
              <ul className="deactivate-confirm__impact">
                <li>{messages.members.twoFactorResetConfirmImpactLogin}</li>
                <li>{messages.members.twoFactorResetConfirmImpactNotify}</li>
                <li>{messages.members.twoFactorResetConfirmImpactAudit}</li>
                <li>{messages.members.twoFactorResetConfirmImpactReenroll}</li>
              </ul>
            </>
          }
          confirmLabel={messages.members.twoFactorResetButton}
          tone="caution"
          note=""
          pending={twoFactorResetPending}
          error={twoFactorResetError}
          onConfirm={handleTwoFactorResetConfirm}
          onCancel={() => {
            setTwoFactorResetTarget(null);
            setTwoFactorResetError(null);
          }}
        />
      ) : null}

      {eraseTarget ? (
        <ConfirmDialog
          title={messages.members.eraseConfirmTitle}
          message={
            <>
              {`「${eraseTarget.name}」— ${messages.members.eraseConfirmMessage}`}
              <ul className="deactivate-confirm__impact">
                <li>{messages.members.eraseConfirmImpactIdentity}</li>
                <li>{messages.members.eraseConfirmImpactCredentials}</li>
                <li>{messages.members.eraseConfirmImpactAttendance}</li>
                <li>{messages.members.eraseConfirmImpactAudit}</li>
                <li>{messages.members.eraseConfirmImpactIrreversible}</li>
              </ul>
            </>
          }
          extraNote={messages.members.eraseConfirmLegalNote}
          confirmLabel={messages.members.eraseButton}
          tone="caution"
          note=""
          confirmPhrase={{
            phrase: eraseTarget.name,
            label: messages.members.eraseConfirmPhraseLabel(eraseTarget.name),
            placeholder: eraseTarget.name,
            mismatchHint: messages.members.eraseConfirmPhraseMismatch,
          }}
          pending={erasePending}
          error={eraseError}
          onConfirm={handleEraseConfirm}
          onCancel={() => {
            setEraseTarget(null);
            setEraseError(null);
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
                <li>{messages.members.deactivateConfirmImpactRetention}</li>
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
