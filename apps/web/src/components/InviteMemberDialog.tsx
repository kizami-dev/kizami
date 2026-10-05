"use client";

import { useEffect, useRef, useState } from "react";
import type { DepartmentDto, PermissionPresetDto, WorkPolicyDto } from "../lib/api";
import { messages } from "../lib/messages";

export interface InviteMemberFormValue {
  email: string;
  name: string;
  departmentId: string | null;
  /** "YYYY-MM-DD"。未入力なら空文字。 */
  hireDate: string;
  presetIds: string[];
  /** 割り当てる労働時間制の制度(2026-10-05)。null = テナントの既定の制度 */
  workPolicyId: string | null;
}

export interface InviteMemberDialogProps {
  departments: DepartmentDto[];
  presets: PermissionPresetDto[];
  /**
   * 選べる労働時間制の制度(アーカイブ済みを除く)。空なら選択欄を出さない
   * (tenant_settings.flex.manage を持たない人には呼び出し側が空を渡す)。
   */
  workPolicies: WorkPolicyDto[];
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
export function InviteMemberDialog({ departments, presets, workPolicies, pending, error, onSubmit, onCancel }: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [presetIds, setPresetIds] = useState<string[]>([]);
  const [workPolicyId, setWorkPolicyId] = useState("");
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
    onSubmit({
      email: email.trim(),
      name: name.trim(),
      departmentId: departmentId === "" ? null : departmentId,
      hireDate,
      presetIds,
      workPolicyId: workPolicyId === "" ? null : workPolicyId,
    });
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

            <div className="field">
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

            <div className="field">
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

            <div className="field">
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

            <div className="field">
              <label htmlFor="invite-hire-date">{messages.members.inviteHireDateLabel}</label>
              <input id="invite-hire-date" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
            </div>

            {/*
              労働時間制の制度(2026-10-05、名前付きの制度)。招待と同じ日から別の制度にしたいとき、
              後から割当を足すと同じ日の重複になって直せないため、招待の時点で選べるようにする。
              未選択 = 既定の制度(API が自動で割り当てる)。
            */}
            {workPolicies.length > 0 ? (
              <div className="field">
                <label htmlFor="invite-work-policy">{messages.members.inviteWorkPolicyLabel}</label>
                <select id="invite-work-policy" value={workPolicyId} onChange={(e) => setWorkPolicyId(e.target.value)}>
                  <option value="">
                    {messages.members.inviteWorkPolicyDefaultOption(workPolicies.find((p) => p.isDefault)?.name ?? "")}
                  </option>
                  {workPolicies
                    .filter((p) => !p.isDefault)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <p className="field__hint">{messages.members.inviteWorkPolicyHint}</p>
              </div>
            ) : null}

            {presets.length > 0 ? (
              <div className="field">
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
              <p className="notice notice--danger" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="k-modal__footer">
            <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={pending}>
              {messages.members.inviteCancel}
            </button>
            <button type="submit" className="btn btn--primary" disabled={pending}>
              {pending ? messages.members.inviteSubmitting : messages.members.inviteSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
