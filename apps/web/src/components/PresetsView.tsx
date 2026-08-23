"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type MemberDto,
  type PermissionCatalogEntryDto,
  type PermissionPresetDto,
} from "../lib/api";
import { mapPresetErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { HelpTip } from "./HelpTip";
import { PresetFormDialog, type PresetFormValue } from "./PresetFormDialog";
import { SettingsNav } from "./SettingsNav";

type FormState = { mode: "create" | "edit"; editingId?: string; readOnly: boolean; initial: PresetFormValue };
type DeleteState = { id: string; name: string };

/**
 * 権限プリセット管理画面(/settings/presets)。docs/requirements.md §4。
 * カタログ(GET /presets/catalog)を業務タスク単位のチェックボックス+スコープ選択で表示する。
 */
export function PresetsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [presets, setPresets] = useState<PermissionPresetDto[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionCatalogEntryDto[]>([]);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [formState, setFormState] = useState<FormState | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    Promise.all([api.listPresets(), api.getPresetCatalog()])
      .then(async ([presetRes, catalogRes]) => {
        if (cancelled) return;
        setPresets(presetRes.presets);
        setCatalog(catalogRes.catalog);
        // 割当人数の目安表示用。member.view 権限が無くても致命的にしない(ベストエフォート)。
        const membersRes = await api.listMembers().catch(() => null);
        if (!cancelled && membersRes) setMembers(membersRes.members);
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
        setLoadError(err instanceof ApiError ? messages.presets.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, reloadKey]);

  function assignedCount(preset: PermissionPresetDto): number {
    return members.filter((m) => m.presetNames.includes(preset.name)).length;
  }

  function openCreate() {
    setFormError(null);
    setFormState({ mode: "create", readOnly: false, initial: { name: "", description: "", grants: [] } });
  }

  function openEdit(preset: PermissionPresetDto) {
    setFormError(null);
    setFormState({
      mode: "edit",
      editingId: preset.id,
      readOnly: preset.isSystem,
      initial: { name: preset.name, description: preset.description ?? "", grants: preset.grants },
    });
  }

  function openDuplicate(preset: PermissionPresetDto) {
    setFormError(null);
    setFormState({
      mode: "create",
      readOnly: false,
      initial: { name: `${preset.name}のコピー`, description: preset.description ?? "", grants: preset.grants },
    });
  }

  async function handleFormSubmit(value: PresetFormValue) {
    if (!formState) return;
    setFormPending(true);
    setFormError(null);
    const description = value.description.trim() === "" ? null : value.description;
    try {
      if (formState.mode === "create") {
        await api.createPreset({ name: value.name, description, grants: value.grants });
      } else if (formState.editingId) {
        await api.updatePreset(formState.editingId, { name: value.name, description, grants: value.grants });
      }
      setFormState(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setFormError(err instanceof ApiError ? mapPresetErrorMessage(err.body) : messages.errors.network);
    } finally {
      setFormPending(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteState) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await api.deletePreset(deleteState.id);
      setDeleteState(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setDeleteError(err instanceof ApiError ? mapPresetErrorMessage(err.body) : messages.errors.network);
    } finally {
      setDeletePending(false);
    }
  }

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
        <SettingsNav active="presets" />
        <h1 className="org-settings__title">
          {messages.presets.title}
          <HelpTip helpKey="permission.presets" />
        </h1>
        <p className="org-settings__tagline">{messages.presets.tagline}</p>

        {forbidden ? (
          <p className="org-settings__forbidden" role="alert">
            {messages.presets.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && presets ? (
          <>
            <div className="org-settings__toolbar">
              <button type="button" className="org-settings__primary-btn" onClick={openCreate}>
                {messages.presets.addNew}
              </button>
            </div>

            {presets.length === 0 ? (
              <p className="org-settings__empty">{messages.presets.empty}</p>
            ) : (
              <div className="org-settings__table-wrap">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>{messages.presets.columnName}</th>
                      <th>{messages.presets.columnDescription}</th>
                      <th>{messages.presets.columnType}</th>
                      <th>{messages.presets.columnAssignedCount}</th>
                      <th>{messages.presets.columnActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {presets.map((preset) => (
                      <tr key={preset.id}>
                        <td>{preset.name}</td>
                        <td className="org-table__muted">{preset.description ?? messages.presets.noDescription}</td>
                        <td>
                          <span className={`chip${preset.isSystem ? " chip--system" : ""}`}>
                            {preset.isSystem ? messages.presets.systemBadge : messages.presets.customBadge}
                          </span>
                        </td>
                        <td className="tabular-nums">
                          {assignedCount(preset)}
                          {messages.presets.assignedCountUnit}
                        </td>
                        <td>
                          <div className="org-table__actions">
                            <button type="button" className="org-table__link-btn" onClick={() => openEdit(preset)}>
                              {messages.presets.edit}
                            </button>
                            {preset.isSystem ? (
                              <button type="button" className="org-table__link-btn" onClick={() => openDuplicate(preset)}>
                                {messages.presets.duplicate}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="org-table__link-btn org-table__link-btn--danger"
                                onClick={() => {
                                  setDeleteError(null);
                                  setDeleteState({ id: preset.id, name: preset.name });
                                }}
                              >
                                {messages.presets.delete}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </main>

      {formState ? (
        <PresetFormDialog
          mode={formState.mode}
          catalog={catalog}
          readOnly={formState.readOnly}
          initial={formState.initial}
          pending={formPending}
          error={formError}
          onSubmit={handleFormSubmit}
          onCancel={() => setFormState(null)}
        />
      ) : null}

      {deleteState ? (
        <ConfirmDialog
          title={messages.presets.confirmDeleteTitle}
          message={`「${deleteState.name}」— ${messages.presets.confirmDeleteMessage}`}
          confirmLabel={messages.presets.confirmDeleteLabel}
          tone="caution"
          note=""
          pending={deletePending}
          error={deleteError}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setDeleteState(null);
            setDeleteError(null);
          }}
        />
      ) : null}
    </div>
  );
}
