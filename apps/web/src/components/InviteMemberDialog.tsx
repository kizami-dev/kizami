"use client";

import { useEffect, useRef, useState } from "react";
import type { DepartmentDto, PermissionPresetDto } from "../lib/api";
import { messages } from "../lib/messages";

export interface InviteMemberFormValue {
  email: string;
  name: string;
  departmentId: string | null;
  /** "YYYY-MM-DD"。未入力なら空文字。 */
  hireDate: string;
  presetIds: string[];
}

export interface InviteMemberDialogProps {
  departments: DepartmentDto[];
  presets: PermissionPresetDto[];
  pending: boolean;
  error: string | null;
  onSubmit: (value: InviteMemberFormValue) => void;
  onCancel: () => void;
}

/**
 * メンバー招待フォーム(モーダル)。/settings/members から開く。
 * メール・氏名は必須、所属部署・入社日・権限プリセットは任意(依頼どおり)。
 * 既存の作成系フォーム(DepartmentFormDialog / PresetFormDialog)と同じ k-modal の作法に合わせる。
 */
export function InviteMemberDialog({ departments, presets, pending, error, onSubmit, onCancel }: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [presetIds, setPresetIds] = useState<string[]>([]);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function togglePreset(id: string) {
    setPresetIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ email: email.trim(), name: name.trim(), departmentId: departmentId === "" ? null : departmentId, hireDate, presetIds });
  }

  return (
    <div className="k-modal__backdrop" onClick={onCancel}>
      <div
        className="k-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-member-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-modal__header">
          <h2 id="invite-member-title" className="k-modal__title">
            {messages.members.inviteFormTitle}
          </h2>
          <button type="button" className="k-modal__close" onClick={onCancel} aria-label={messages.corrections.close}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="k-modal__body">
            <p className="member-invite-form__hint">{messages.members.inviteFormHint}</p>

            <div className="correction-field">
              <label htmlFor="invite-email">{messages.members.inviteEmailLabel}</label>
              <input
                id="invite-email"
                ref={emailRef}
                type="email"
                value={email}
                maxLength={255}
                placeholder={messages.members.inviteEmailPlaceholder}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="correction-field">
              <label htmlFor="invite-name">{messages.members.inviteNameLabel}</label>
              <input
                id="invite-name"
                type="text"
                value={name}
                maxLength={200}
                placeholder={messages.members.inviteNamePlaceholder}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="correction-field">
              <label htmlFor="invite-department">{messages.members.inviteDepartmentLabel}</label>
              <select id="invite-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">{messages.members.noDepartment}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="correction-field">
              <label htmlFor="invite-hire-date">{messages.members.inviteHireDateLabel}</label>
              <input id="invite-hire-date" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
            </div>

            {presets.length > 0 ? (
              <div className="correction-field">
                <span>{messages.members.invitePresetsLabel}</span>
                <ul className="preset-checkbox-list">
                  {presets.map((preset) => (
                    <li key={preset.id}>
                      <label className="preset-checkbox-list__item">
                        <input type="checkbox" checked={presetIds.includes(preset.id)} onChange={() => togglePreset(preset.id)} />
                        <span>{preset.name}</span>
                        {preset.description ? <span className="preset-checkbox-list__desc">{preset.description}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {error ? (
              <p className="correction-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="k-modal__footer">
            <button type="button" className="k-modal__cancel" onClick={onCancel} disabled={pending}>
              {messages.members.inviteCancel}
            </button>
            <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={pending}>
              {pending ? messages.members.inviteSubmitting : messages.members.inviteSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
