"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link, useRouter } from "waku";
import { api, ApiError, type SignupConfigDto } from "../lib/api";
import { mapSignupErrorMessage, messages } from "../lib/messages";
import { KizamiMark } from "./KizamiMark";
import { TurnstileWidget } from "./TurnstileWidget";
import { PreLoginLanguageSelect } from "./PreLoginLanguageSelect";

type ViewState =
  | { kind: "loading" }
  /** SIGNUP_MODE=off の配備(GET /signup/config が mode: "off")。フォームは出さず案内だけ */
  | { kind: "closed" }
  | { kind: "ready"; config: SignupConfigDto & { mode: "invite" | "open"; turnstileSiteKey: string } }
  | { kind: "sent"; email: string };

/**
 * セルフサインアップ画面(/signup、認証ガード無し・公開、KIZAMI Cloud)。
 * 招待受諾(InviteAcceptView)・ログインと同じ「紙白+中央カード」(login-screen/login-card)。
 *
 * 判断点: モードは GET /signup/config で都度確認する(静的書き出しのページにビルド時の値を
 * 焼き込まない — 同じイメージを SIGNUP_MODE の違う環境で使うため)。招待コード欄は invite モードのときだけ出す。
 * パスワードはここでは聞かない(確認リンクを踏んだ本人が /signup/verify/[token] で設定する。
 * 他人のメールで先にパスワードを決めて登録されるアカウント乗っ取りの防止、routes/signup.ts 冒頭)。
 * 送信後は「確認メールを送りました」とだけ表示する。そのメールアドレスが既に使われているかは
 * API が区別せず、画面にも出さない(ユーザー列挙対策、routes/signup.ts の判断点)。
 */
export function SignupForm() {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [organizationName, setOrganizationName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  /** 送信に失敗したらウィジェットを作り直す(トークンは単回使用) */
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSignupConfig()
      .then((config) => {
        if (cancelled) return;
        if (config.mode === "off" || !config.turnstileSiteKey) {
          setState({ kind: "closed" });
          return;
        }
        setState({ kind: "ready", config: { ...config, mode: config.mode, turnstileSiteKey: config.turnstileSiteKey } });
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

    if (!turnstileToken) {
      setError(messages.signup.turnstileRequired);
      return;
    }

    setSubmitting(true);
    try {
      await api.signup({
        email: email.trim(),
        organizationName: organizationName.trim(),
        adminName: adminName.trim(),
        turnstileToken,
        ...(state.config.mode === "invite" ? { inviteCode: inviteCode.trim() } : {}),
      });
      setState({ kind: "sent", email: email.trim() });
    } catch (err) {
      setError(err instanceof ApiError ? mapSignupErrorMessage(err.body) : messages.signup.errors.default);
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

        {state.kind === "loading" ? <p className="login-card__tagline">{messages.signup.loading}</p> : null}

        {state.kind === "closed" ? (
          <>
            <h2 className="invite-accept__title">{messages.signup.closedTitle}</h2>
            <p className="login-card__tagline">{messages.signup.closedMessage}</p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => router.push("/login")}>
              {messages.signup.backToLogin}
            </button>
          </>
        ) : null}

        {state.kind === "sent" ? (
          <>
            <h2 className="invite-accept__title">{messages.signup.sentTitle}</h2>
            <p className="login-card__tagline">{messages.signup.sentMessage(state.email)}</p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => router.push("/login")}>
              {messages.signup.backToLogin}
            </button>
          </>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <p className="login-card__tagline">{messages.signup.tagline}</p>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="signup-organization">{messages.signup.organizationNameLabel}</label>
                <input
                  id="signup-organization"
                  name="organization"
                  type="text"
                  autoComplete="organization"
                  required
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="signup-name">{messages.signup.adminNameLabel}</label>
                <input
                  id="signup-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="signup-email">{messages.signup.emailLabel}</label>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {state.config.mode === "invite" ? (
                <div className="field">
                  <label htmlFor="signup-invite-code">{messages.signup.inviteCodeLabel}</label>
                  <input
                    id="signup-invite-code"
                    name="invite-code"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    required
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                  />
                  <small className="signup-hint">{messages.signup.inviteCodeHint}</small>
                </div>
              ) : null}

              <TurnstileWidget siteKey={state.config.turnstileSiteKey} onToken={setTurnstileToken} resetKey={turnstileResetKey} />

              {error ? (
                <p className="notice notice--danger" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={submitting}>
                {submitting ? messages.signup.submitting : messages.signup.submit}
              </button>
            </form>

            <p className="login-signup-link">
              {messages.signup.haveAccount} <Link to="/login">{messages.signup.backToLogin}</Link>
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
