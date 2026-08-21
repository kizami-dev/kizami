"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type DepartmentDto } from "../lib/api";
import { mapDepartmentErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { DepartmentFormDialog, type DepartmentFormValue } from "./DepartmentFormDialog";
import { SettingsNav } from "./SettingsNav";

interface TreeNode {
  dept: DepartmentDto;
  children: TreeNode[];
}

function buildTree(departments: DepartmentDto[]): TreeNode[] {
  const byId = new Map(departments.map((d) => [d.id, { dept: d, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const d of departments) {
    const node = byId.get(d.id);
    if (!node) continue;
    if (d.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(d.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node); // 親が見つからない(データ不整合)場合はルート扱いで安全に表示する
  }
  return roots;
}

type FormState = { mode: "create" | "edit"; editingId?: string; initial: DepartmentFormValue };
type DeleteState = { id: string; name: string };

/**
 * 部署管理画面(/settings/departments)。部署ツリーの表示・追加・名前変更・親の変更・削除。
 * docs/requirements.md §4(部署ツリー+役職ベースの組織モデル)・§10(コンテキストヘルプ)。
 */
export function DepartmentsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [departments, setDepartments] = useState<DepartmentDto[] | null>(null);
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
    api
      .listDepartments()
      .then((res) => {
        if (cancelled) return;
        setDepartments(res.departments);
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
        setLoadError(err instanceof ApiError ? messages.departments.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, reloadKey]);

  const tree = useMemo(() => (departments ? buildTree(departments) : []), [departments]);

  function openCreate(parentId: string | null) {
    setFormError(null);
    setFormState({ mode: "create", initial: { name: "", parentId } });
  }

  function openEdit(dept: DepartmentDto) {
    setFormError(null);
    setFormState({ mode: "edit", editingId: dept.id, initial: { name: dept.name, parentId: dept.parentId } });
  }

  async function handleFormSubmit(value: DepartmentFormValue) {
    if (!formState) return;
    setFormPending(true);
    setFormError(null);
    try {
      if (formState.mode === "create") {
        await api.createDepartment({ name: value.name, ...(value.parentId !== null ? { parentId: value.parentId } : {}) });
      } else if (formState.editingId) {
        await api.updateDepartment(formState.editingId, { name: value.name, parentId: value.parentId });
      }
      setFormState(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setFormError(err instanceof ApiError ? mapDepartmentErrorMessage(err.body) : messages.errors.network);
    } finally {
      setFormPending(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteState) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await api.deleteDepartment(deleteState.id);
      setDeleteState(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setDeleteError(err instanceof ApiError ? mapDepartmentErrorMessage(err.body) : messages.errors.network);
    } finally {
      setDeletePending(false);
    }
  }

  function renderNode(node: TreeNode, depth: number) {
    return (
      <li key={node.dept.id} className="dept-tree__item">
        <div className="dept-tree__row" style={{ paddingLeft: `${depth * 1.5}rem` }}>
          <span className="dept-tree__name">{node.dept.name}</span>
          <div className="dept-tree__actions">
            <button type="button" className="dept-tree__btn" onClick={() => openCreate(node.dept.id)}>
              {messages.departments.addChild}
            </button>
            <button type="button" className="dept-tree__btn" onClick={() => openEdit(node.dept)}>
              {messages.departments.rename}
            </button>
            <button
              type="button"
              className="dept-tree__btn dept-tree__btn--danger"
              onClick={() => {
                setDeleteError(null);
                setDeleteState({ id: node.dept.id, name: node.dept.name });
              }}
            >
              {messages.departments.delete}
            </button>
          </div>
        </div>
        {node.children.length > 0 ? (
          <ul className="dept-tree__children">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="org-settings">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="settings" />
      <main className="org-settings__main">
        <SettingsNav active="departments" />
        <h1 className="org-settings__title">{messages.departments.title}</h1>
        <p className="org-settings__tagline">{messages.departments.tagline}</p>

        {forbidden ? (
          <p className="org-settings__forbidden" role="alert">
            {messages.departments.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && departments ? (
          <>
            <div className="org-settings__toolbar">
              <button type="button" className="org-settings__primary-btn" onClick={() => openCreate(null)}>
                {messages.departments.addRoot}
              </button>
            </div>

            {tree.length === 0 ? (
              <p className="org-settings__empty">{messages.departments.empty}</p>
            ) : (
              <ul className="dept-tree">{tree.map((n) => renderNode(n, 0))}</ul>
            )}
          </>
        ) : null}
      </main>

      {formState ? (
        <DepartmentFormDialog
          mode={formState.mode}
          departments={departments ?? []}
          {...(formState.editingId ? { editingId: formState.editingId } : {})}
          initial={formState.initial}
          pending={formPending}
          error={formError}
          onSubmit={handleFormSubmit}
          onCancel={() => setFormState(null)}
        />
      ) : null}

      {deleteState ? (
        <ConfirmDialog
          title={messages.departments.confirmDeleteTitle}
          message={`「${deleteState.name}」— ${messages.departments.confirmDeleteMessage}`}
          confirmLabel={messages.departments.confirmDeleteLabel}
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
