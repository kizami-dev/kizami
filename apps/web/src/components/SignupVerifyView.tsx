"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "waku";
import { api, ApiError } from "../lib/api";
import { mapSignupVerifyErrorMessage, messages } from "../lib/messages";
import { KizamiMark } from "./KizamiMark";
import { PreLoginLanguageSelect } from "./PreLoginLanguageSelect";

type ViewState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "ready"; organizationName: string; adminName: string; email: string }
  | { kind: "created" }
  /** テナントは作成済みだがセッション発行だけ失敗(POST が 200 のまま session_issuance_failed を返す) */
  | { kind: "sessionIssuanceFailed" };

/**
 * サインアップのメール確認画面(/signup/verify/[token]、認証ガード無し・公開)。
 * 招待受諾(InviteAcceptView)と同型。GET /signup/verify/:token は 404(無効・使用済み)と
 * 410(期限切れ)を区別して返す(routes/signup.ts)ので、画面も2つの文言で案内する。
 * パスワードは**ここで**設定する(登録フォームでは聞かない — 他人のメールで先にパスワードを決めて
 * 登録されるアカウント乗っ取りの防止、apps/api の routes/signup.ts 冒頭)。
 * 確認ボタンの POST でテナントが作られ、ログイン済みになったら招待受諾後と同じ "/" へ遷移する。
 */
export function SignupVerifyView({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSignupPreview(token)
      .then((res) => {
        if (cancelled) return;
        setState({ kind: "ready", organizationName: res.organizationName, adminName: res.adminName, email: res.email });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: err instanceof ApiError && err.status === 410 ? "expired" : "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError(messages.signupVerify.passwordTooShort);
      return;
    }
    if (password !== passwordConfirm) {
      setError(messages.signupVerify.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.confirmSignup(token, password);
      if ("error" in res && res.error === "session_issuance_failed") {
        setState({ kind: "sessionIssuanceFailed" });
        return;
      }
      setState({ kind: "created" });
      router.push("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setState({ kind: "expired" });
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setState({ kind: "invalid" });
        return;
      }
      setError(err instanceof ApiError ? mapSignupVerifyErrorMessage(err.body) : messages.signupVerify.errors.default);
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

        {state.kind === "loading" ? <p className="login-card__tagline">{messages.signupVerify.loading}</p> : null}

        {state.kind === "invalid" ? (
          <>
            <h2 className="invite-accept__title">{messages.signupVerify.invalidTitle}</h2>
            <p className="login-card__tagline">{messages.signupVerify.invalidMessage}</p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => router.push("/login")}>
              {messages.signupVerify.goToLogin}
            </button>
          </>
        ) : null}

        {state.kind === "expired" ? (
          <>
            <h2 className="invite-accept__title">{messages.signupVerify.expiredTitle}</h2>
            <p className="login-card__tagline">{messages.signupVerify.expiredMessage}</p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => router.push("/signup")}>
              {messages.signupVerify.goToSignup}
            </button>
          </>
        ) : null}

        {state.kind === "created" ? <p className="login-card__tagline">{messages.signupVerify.created}</p> : null}

        {state.kind === "sessionIssuanceFailed" ? (
          <>
            <h2 className="invite-accept__title">{messages.signupVerify.sessionIssuanceFailedTitle}</h2>
            <p className="login-card__tagline">{messages.signupVerify.sessionIssuanceFailedMessage}</p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => router.push("/login")}>
              {messages.signupVerify.goToLogin}
            </button>
          </>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <p className="login-card__tagline">{messages.signupVerify.intro}</p>

            <form className="login-form" onSubmit={handleConfirm} noValidate>
              <div className="field">
                <label htmlFor="signup-verify-organization">{messages.signupVerify.organizationLabel}</label>
                <input id="signup-verify-organization" type="text" value={state.organizationName} readOnly />
              </div>
              <div className="field">
                <label htmlFor="signup-verify-name">{messages.signupVerify.nameLabel}</label>
                <input id="signup-verify-name" type="text" value={state.adminName} readOnly />
              </div>
              <div className="field">
                <label htmlFor="signup-verify-email">{messages.signupVerify.emailLabel}</label>
                <input id="signup-verify-email" type="email" value={state.email} readOnly />
              </div>

              <div className="field">
                <label htmlFor="signup-verify-password">{messages.signupVerify.passwordLabel}</label>
                <input
                  id="signup-verify-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="signup-verify-password-confirm">{messages.signupVerify.passwordConfirmLabel}</label>
                <input
                  id="signup-verify-password-confirm"
                  name="new-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
              </div>

              {error ? (
                <p className="notice notice--danger" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={submitting}>
                {submitting ? messages.signupVerify.submitting : messages.signupVerify.submit}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
