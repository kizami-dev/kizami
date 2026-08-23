"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "waku";
import { api, ApiError, MultipleTenantsError, type LoginTenantOption } from "../lib/api";
import { messages } from "../lib/messages";
import { KizamiMark } from "./KizamiMark";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 複数テナント一致時のテナント選択(2026-08-23 追加)。email/password は検証済みのまま
   * 保持し、選択後の再送でパスワード再入力を求めない(Slack のワークスペース選択と同じ体験)。 */
  const [tenantOptions, setTenantOptions] = useState<LoginTenantOption[] | null>(null);

  // 既にログイン済みならホームへ誘導する(判断点: v0.1 では静かに素通りさせる)
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(() => {
        if (!cancelled) router.replace("/");
      })
      .catch(() => {
        // 未認証・通信エラーはログイン画面に留まる
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email, password);
      router.push("/");
    } catch (err) {
      if (err instanceof MultipleTenantsError) {
        setTenantOptions(err.tenants);
      } else if (err instanceof ApiError && err.status === 401) {
        setError(messages.login.invalidCredentials);
      } else {
        setError(messages.login.genericError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectTenant(tenantId: string) {
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email, password, tenantId);
      router.push("/");
    } catch {
      // ここでの失敗は基本的に通信エラーのみ(email/password は直前に検証済み)。
      setError(messages.login.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  function handleBackToEmail() {
    setTenantOptions(null);
    setError(null);
    // パスワードは再入力させる(選択画面に戻る=別アカウントでの再挑戦の起点のため、
    // 検証済み状態を持ち越さない)。
    setPassword("");
  }

  const selectingTenant = tenantOptions !== null;

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__mark" aria-hidden="true">
            <KizamiMark size={44} />
          </span>
          <span className="login-card__logo">{messages.login.title}</span>
        </div>
        <p className="login-card__tagline">{messages.login.tagline}</p>

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        {selectingTenant ? (
          <div className="login-tenant-select">
            <h2 className="login-tenant-select__title">{messages.login.tenantSelectTitle}</h2>
            <p className="login-tenant-select__desc">{messages.login.tenantSelectDescription}</p>

            <ul className="login-tenant-select__list">
              {tenantOptions.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="login-tenant-select__item"
                    disabled={submitting}
                    onClick={() => handleSelectTenant(t.id)}
                  >
                    {t.name ?? messages.login.tenantUnnamed}
                  </button>
                </li>
              ))}
            </ul>

            <button type="button" className="login-tenant-select__back" onClick={handleBackToEmail} disabled={submitting}>
              {messages.login.backToEmail}
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="login-email">{messages.login.emailLabel}</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="login-field">
              <label htmlFor="login-password">{messages.login.passwordLabel}</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting ? messages.login.submitting : messages.login.submit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
