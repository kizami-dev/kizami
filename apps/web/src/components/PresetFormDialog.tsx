"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PermissionCatalogEntryDto, PermissionGrantDto, Scope } from "../lib/api";
import { messages } from "../lib/messages";
import { groupCatalogByCategory, INTERNAL_VIEW_LABELS } from "../lib/permissions";

export interface PresetFormValue {
  name: string;
  description: string;
  grants: PermissionGrantDto[];
}

export interface PresetFormDialogProps {
  mode: "create" | "edit";
  catalog: PermissionCatalogEntryDto[];
  /** true: 標準プリセットの内容確認用(全フィールド読み取り専用、保存不可)。 */
  readOnly: boolean;
  initial: PresetFormValue;
  pending: boolean;
  error: string | null;
  onSubmit: (value: PresetFormValue) => void;
  onCancel: () => void;
}

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * 権限プリセットの作成・編集フォーム(業務タスク単位のチェックボックス+スコープ選択)。
 * 平易さの要件(docs/requirements.md §4): グループ化・descriptionJa併記・危険項目の強調・
 * 「操作は閲覧を含意する」の明示、をすべてここで満たす。
 */
export function PresetFormDialog({ mode, catalog, readOnly, initial, pending, error, onSubmit, onCancel }: PresetFormDialogProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [selected, setSelected] = useState<Record<string, Scope>>(() =>
    Object.fromEntries(initial.grants.map((g) => [g.key, g.scope])),
  );
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const catalogMap = useMemo(() => new Map(catalog.map((e) => [e.key, e])), [catalog]);
  const groups = useMemo(() => groupCatalogByCategory(catalog), [catalog]);

  function impliedLabel(key: string): string {
    return catalogMap.get(key)?.labelJa ?? INTERNAL_VIEW_LABELS[key] ?? key;
  }

  function toggleEntry(entry: PermissionCatalogEntryDto) {
    if (readOnly) return;
    setSelected((prev) => {
      const next = { ...prev };
      if (entry.key in next) {
        delete next[entry.key];
      } else {
        const first = entry.scopes[0];
        if (first) next[entry.key] = first;
      }
      return next;
    });
  }

  function changeScope(key: string, scope: Scope) {
    if (readOnly) return;
    setSelected((prev) => ({ ...prev, [key]: scope }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const grants: PermissionGrantDto[] = Object.entries(selected).map(([key, scope]) => ({ key, scope }));
    onSubmit({ name, description, grants });
  }

  return (
    <div className="k-modal__backdrop" onClick={onCancel}>
      <div
        className="k-modal k-modal--preset"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="preset-form-title" className="k-modal__title">
            {mode === "create" ? messages.presets.formTitleCreate : messages.presets.formTitleEdit}
          </h2>
          <button type="button" className="k-modal__close" onClick={onCancel} aria-label={messages.presets.close}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="k-modal__body">
            {readOnly ? <p className="preset-form__readonly-note">{messages.presets.formReadonlyNote}</p> : null}

            <div className="correction-field">
              <label htmlFor="preset-name">{messages.presets.nameLabel}</label>
              <input
                id="preset-name"
                ref={nameRef}
                type="text"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder={messages.presets.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
                disabled={readOnly}
                required
              />
            </div>

            <div className="correction-field">
              <label htmlFor="preset-description">{messages.presets.descriptionLabel}</label>
              <textarea
                id="preset-description"
                value={description}
                maxLength={MAX_DESCRIPTION_LENGTH}
                placeholder={messages.presets.descriptionPlaceholder}
                onChange={(e) => setDescription(e.target.value)}
                disabled={readOnly}
              />
            </div>

            <div className="preset-form__permissions">
              <p className="preset-form__permissions-label">{messages.presets.permissionsLabel}</p>
              {groups.map((group) => (
                <section key={group.id} className="preset-form__group">
                  <h3 className="preset-form__group-title">{group.labelJa}</h3>
                  <ul className="preset-form__entry-list">
                    {group.entries.map((entry) => {
                      const checked = entry.key in selected;
                      const scope = selected[entry.key];
                      return (
                        <li
                          key={entry.key}
                          className={`preset-form__entry${entry.dangerous ? " preset-form__entry--dangerous" : ""}`}
                        >
                          <label className="preset-form__entry-header">
                            <input type="checkbox" checked={checked} disabled={readOnly} onChange={() => toggleEntry(entry)} />
                            <span className="preset-form__entry-label">{entry.labelJa}</span>
                            {entry.dangerous ? <span className="preset-form__dangerous-badge">{messages.presets.dangerousBadge}</span> : null}
                          </label>
                          <p className="preset-form__entry-desc">{entry.descriptionJa}</p>

                          {checked ? (
                            <div className="preset-form__entry-details">
                              {entry.scopes.length > 1 ? (
                                <label className="preset-form__scope-select">
                                  {messages.presets.scopeLabel}:
                                  <select
                                    value={scope}
                                    disabled={readOnly}
                                    onChange={(e) => changeScope(entry.key, e.target.value as Scope)}
                                  >
                                    {entry.scopes.map((s) => (
                                      <option key={s} value={s}>
                                        {messages.scopeLabel[s]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : (
                                <p className="preset-form__scope-fixed">
                                  {messages.presets.scopeLabel}: {scope ? messages.scopeLabel[scope] : ""}
                                </p>
                              )}

                              {entry.impliesView.length > 0 ? (
                                <p className="preset-form__implies">
                                  {messages.presets.impliesViewPrefix}
                                  {entry.impliesView.map((k) => impliedLabel(k)).join("、")}
                                </p>
                              ) : null}

                              {entry.dangerous ? <p className="preset-form__dangerous-note">{messages.presets.dangerousNote}</p> : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            {error ? (
              <p className="correction-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="k-modal__footer">
            <button type="button" className="k-modal__cancel" onClick={onCancel} disabled={pending}>
              {readOnly ? messages.presets.close : messages.presets.cancel}
            </button>
            {readOnly ? null : (
              <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={pending}>
                {pending ? messages.presets.saving : messages.presets.save}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
