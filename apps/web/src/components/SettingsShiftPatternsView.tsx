"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type ShiftPatternDto } from "../lib/api";
import { mapShiftPatternErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsNav } from "./SettingsNav";
import { formatShiftPatternTime, ShiftPatternFormDialog, type ShiftPatternFormValue } from "./ShiftPatternFormDialog";

/**
 * シフトパターン管理画面(/settings/shift-patterns、v0.7 フェーズ3、2026-08-24 追加)。
 * docs/design/shift-work.md 決定事項2「パターン割当+個別編集」のパターン側 CRUD。
 * 編集APIは無い(作成専用+アーカイブのみ、apps/api/src/routes/settings/shift-patterns.ts)。
 */
export function SettingsShiftPatternsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [patterns, setPatterns] = useState<ShiftPatternDto[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<ShiftPatternDto | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .listShiftPatterns(showArchived)
      .then((res) => {
        if (!cancelled) setPatterns(res.patterns);
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
        setLoadError(err instanceof ApiError ? messages.shiftPatterns.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, showArchived, reloadKey]);

  async function handleFormSubmit(value: ShiftPatternFormValue) {
    setFormPending(true);
    setFormError(null);
    try {
      await api.createShiftPattern(value);
      setFormOpen(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setFormError(err instanceof ApiError ? mapShiftPatternErrorMessage(err.body) : messages.errors.network);
    } finally {
      setFormPending(false);
    }
  }

  async function handleArchiveConfirm() {
    if (!archiveTarget) return;
    setArchivePending(true);
    setArchiveError(null);
    try {
      await api.archiveShiftPattern(archiveTarget.id);
      setArchiveTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setArchiveError(err instanceof ApiError ? mapShiftPatternErrorMessage(err.body) : messages.errors.network);
    } finally {
      setArchivePending(false);
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
        <SettingsNav active="shiftPatterns" />
        <h1 className="org-settings__title">{messages.shiftPatterns.title}</h1>
        <p className="org-settings__tagline">{messages.shiftPatterns.tagline}</p>

        {forbidden ? (
          <p className="org-settings__forbidden" role="alert">
            {messages.shiftPatterns.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && patterns ? (
          <>
            <div className="org-settings__toolbar">
              <button type="button" className="org-settings__primary-btn" onClick={() => { setFormError(null); setFormOpen(true); }}>
                {messages.shiftPatterns.addNew}
              </button>
              <label className="attendance-settings__checkbox">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                {messages.shiftPatterns.showArchived}
              </label>
            </div>

            {patterns.length === 0 ? (
              <p className="org-settings__empty">{messages.shiftPatterns.empty}</p>
            ) : (
              <div className="org-settings__table-wrap">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>{messages.shiftPatterns.columnName}</th>
                      <th>{messages.shiftPatterns.columnDayType}</th>
                      <th>{messages.shiftPatterns.columnTime}</th>
                      <th>{messages.shiftPatterns.columnActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patterns.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.name}
                          {p.archivedAt !== null ? <span className="chip chip--system">{messages.shiftPatterns.archivedBadge}</span> : null}
                        </td>
                        <td>{messages.shiftDayTypeLabel[p.dayType]}</td>
                        <td className="tabular-nums">{formatShiftPatternTime(p.dayType, p.startMinutes, p.endMinutes)}</td>
                        <td>
                          {p.archivedAt === null ? (
                            <div className="org-table__actions">
                              <button
                                type="button"
                                className="org-table__link-btn org-table__link-btn--danger"
                                onClick={() => {
                                  setArchiveError(null);
                                  setArchiveTarget(p);
                                }}
                              >
                                {messages.shiftPatterns.archive}
                              </button>
                            </div>
                          ) : null}
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

      {formOpen ? (
        <ShiftPatternFormDialog
          pending={formPending}
          error={formError}
          onSubmit={handleFormSubmit}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          title={messages.shiftPatterns.confirmArchiveTitle}
          message={`「${archiveTarget.name}」— ${messages.shiftPatterns.confirmArchiveMessage}`}
          confirmLabel={messages.shiftPatterns.confirmArchiveLabel}
          tone="caution"
          note=""
          pending={archivePending}
          error={archiveError}
          onConfirm={handleArchiveConfirm}
          onCancel={() => {
            setArchiveTarget(null);
            setArchiveError(null);
          }}
        />
      ) : null}
    </div>
  );
}
