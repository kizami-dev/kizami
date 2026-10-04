"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link, useRouter } from "waku";
import { api, ApiError, type PasswordResetConfigDto } from "../lib/api";
import { mapForgotPasswordErrorMessage, messages } from "../lib/messages";
import { KizamiMark } from "./KizamiMark";
import { TurnstileWidget } from "./TurnstileWidget";
import { PreLoginLanguageSelect } from "./PreLoginLanguageSelect";

type ViewState =
  | { kind: "loading" }
  /** システムメールが無い配備(GET /password-resets/config が selfService: false)。フォームは出さず案内だけ */
  | { kind: "closed" }
  | { kind: "ready"; config: PasswordResetConfigDto }
  | { kind: "sent" };

/**
 * 「パスワードを忘れた」画面(/forgot-password、認証ガード無し・公開)。SignupForm と同じ構成
 * (login-screen / login-card)。メール(+ Turnstile のキーがある配備では Turnstile)を送ると、
 * 「該当するアカウントがあればメールを送りました」とだけ表示する。そのメールアドレスのアカウントが
 * 実在するか・メールが実際に出たか(5分スロットルで抑止されたか)は API が区別せず、画面にも出さない
 * (ユーザー列挙対策、apps/api/src/routes/password-resets.ts 冒頭)。
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  /** 送信に失敗したらウィジェットを作り直す(トークンは単回使用) */
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPasswordResetConfig()
      .then((config) => {
        if (cancelled) return;
        setState(config.selfService ? { kind: "ready", config } : { kind: "closed" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "closed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (state.kind !== "ready") return;
    setError(null);

    const siteKey = state.config.turnstileSiteKey;
    if (siteKey && !turnstileToken) {
      setError(messages.forgotPassword.turnstileRequired);
      return;
    }

    setSubmitting(true);
    try {
      await api.requestPasswordReset({ email: email.trim(), ...(siteKey && turnstileToken ? { turnstileToken } : {}) });
      setState({ kind: "sent" });
    } catch (err) {
      setError(err instanceof ApiError ? mapForgotPasswordErrorMessage(err.body) : messages.forgotPassword.errors.default);
      setTurnstileToken(null);
      setTurnstileResetKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <PreLoginLanguageSelect />
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__mark" aria-hidden="true">
            <KizamiMark size={44} />
          </span>
          <span className="login-card__logo">{messages.appName}</span>
        </div>

        {state.kind === "loading" ? <p className="login-card__tagline">{messages.forgotPassword.loading}</p> : null}

        {state.kind === "closed" ? (
          <>
            <h2 className="invite-accept__title">{messages.forgotPassword.closedTitle}</h2>
            <p className="login-card__tagline">{messages.forgotPassword.closedMessage}</p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => router.push("/login")}>
              {messages.forgotPassword.backToLogin}
            </button>
          </>
        ) : null}

        {state.kind === "sent" ? (
          <>
            <h2 className="invite-accept__title">{messages.forgotPassword.sentTitle}</h2>
            <p className="login-card__tagline">{messages.forgotPassword.sentMessage}</p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => router.push("/login")}>
              {messages.forgotPassword.backToLogin}
            </button>
          </>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <p className="login-card__tagline">{messages.forgotPassword.tagline}</p>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="forgot-email">{messages.forgotPassword.emailLabel}</label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {state.config.turnstileSiteKey ? (
                <TurnstileWidget siteKey={state.config.turnstileSiteKey} onToken={setTurnstileToken} resetKey={turnstileResetKey} />
              ) : null}

              {error ? (
                <p className="notice notice--danger" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={submitting}>
                {submitting ? messages.forgotPassword.submitting : messages.forgotPassword.submit}
              </button>
            </form>

            <p className="login-signup-link">
              <Link to="/login">{messages.forgotPassword.backToLogin}</Link>
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
