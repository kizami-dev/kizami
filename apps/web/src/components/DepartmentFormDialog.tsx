"use client";

import { useEffect, useRef, useState } from "react";
import type { DepartmentDto } from "../lib/api";
import { messages } from "../lib/messages";

export interface DepartmentFormValue {
  name: string;
  parentId: string | null;
}

export interface DepartmentFormDialogProps {
  mode: "create" | "edit";
  departments: DepartmentDto[];
  /** 編集対象自身のID(自分自身・自分の配下は親候補の選択肢から除く)。作成時は undefined。 */
  editingId?: string;
  initial: DepartmentFormValue;
  pending: boolean;
  error: string | null;
  onSubmit: (value: DepartmentFormValue) => void;
  onCancel: () => void;
}

/**
 * 部署の追加・編集フォーム(モーダル)。/settings/departments から開く。
 *
 * 判断点: 親候補の選択肢からは自分自身のみを除外する(自明に無効なため)。自分の配下を
 * 親に選んだ場合はあえて選択肢から隠さず、API の circular_reference 判定にそのまま委ね、
 * 「自分自身や配下の部署は親にできません」という明確なエラー文言で伝える
 * (要件: 循環参照エラーの表示を検証すること — クライアント側で全ケースを事前に隠すと
 * このフィードバック経路を検証できず、深い階層でのみ再現するUIになってしまうため)。
 */
export function DepartmentFormDialog({
  mode,
  departments,
  editingId,
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: DepartmentFormDialogProps) {
  const [name, setName] = useState(initial.name);
  const [parentId, setParentId] = useState<string>(initial.parentId ?? "");
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

  const parentOptions = departments.filter((d) => d.id !== editingId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ name, parentId: parentId === "" ? null : parentId });
  }

  return (
    <div className="k-modal__backdrop" onClick={onCancel}>
      <div
        className="k-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="department-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="department-form-title" className="k-modal__title">
            {mode === "create" ? messages.departments.formTitleCreate : messages.departments.formTitleEdit}
          </h2>
          <button type="button" className="k-modal__close" onClick={onCancel} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="k-modal__body">
            <div className="correction-field">
              <label htmlFor="department-name">{messages.departments.nameLabel}</label>
              <input
                id="department-name"
                ref={nameRef}
                type="text"
                value={name}
                maxLength={200}
                placeholder={messages.departments.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="correction-field">
              <label htmlFor="department-parent">{messages.departments.parentLabel}</label>
              <select id="department-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{messages.departments.parentNone}</option>
                {parentOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {error ? (
              <p className="correction-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="k-modal__footer">
            <button type="button" className="k-modal__cancel" onClick={onCancel} disabled={pending}>
              {messages.departments.cancel}
            </button>
            <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={pending}>
              {pending ? messages.departments.saving : messages.departments.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
