"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { mapPasswordChangeErrorMessage, messages } from "../lib/messages";

/** 新しいパスワードの最低文字数(apps/api/src/auth/password-policy.ts の MIN_PASSWORD_LENGTH と同じ)。 */
const MIN_PASSWORD_LENGTH = 12;

/**
 * ログイン中の本人によるパスワード変更欄(設定のセキュリティ画面、2026-10-04 追加)。
 * POST /auth/password/change を呼ぶ。成功すると、サーバーが今のセッション以外をすべて失効させるので、
 * 「ほかの端末からはログアウトしました」と表示する(この画面のセッションは残る)。
 *
 * 現在のパスワードは毎回入力させる(盗まれたセッションだけでは変更できないようにするため、
 * apps/api/src/routes/auth-password.ts 冒頭)。SSO のみのアカウント(パスワード資格情報なし)は
 * API が 409 no_password_credential を返し、その旨をエラー欄に出す。
 */
export function PasswordChangeSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(messages.settingsSecurity.passwordChange.tooShort);
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError(messages.settingsSecurity.passwordChange.mismatch);
      return;
    }

    setSubmitting(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? mapPasswordChangeErrorMessage(err.body) : messages.settingsSecurity.passwordChange.errors.default,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card__title">{messages.settingsSecurity.passwordChange.title}</h2>
      <p className="field__hint">{messages.settingsSecurity.passwordChange.description}</p>

      <form className="page-body page-body--form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="password-change-current">{messages.settingsSecurity.passwordChange.currentLabel}</label>
          <input
            id="password-change-current"
            name="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password-change-new">{messages.settingsSecurity.passwordChange.newLabel}</label>
          <input
            id="password-change-new"
            name="new-password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password-change-confirm">{messages.settingsSecurity.passwordChange.confirmLabel}</label>
          <input
            id="password-change-confirm"
            name="new-password-confirm"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
          />
        </div>

        {error ? (
          <p className="notice notice--danger" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="field__hint" role="status">
            {messages.settingsSecurity.passwordChange.success}
          </p>
        ) : null}

        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? messages.settingsSecurity.passwordChange.submitting : messages.settingsSecurity.passwordChange.submit}
          </button>
        </div>
      </form>
    </section>
  );
}
