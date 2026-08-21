"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "waku";
import { api, ApiError } from "../lib/api";
import { messages } from "../lib/messages";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (err instanceof ApiError && err.status === 401) {
        setError(messages.login.invalidCredentials);
      } else {
        setError(messages.login.genericError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__logo">{messages.login.title}</span>
          <span className="login-card__tombo" aria-hidden="true">
            ✛
          </span>
        </div>
        <p className="login-card__tagline">{messages.login.tagline}</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}

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
      </div>
    </div>
  );
}
