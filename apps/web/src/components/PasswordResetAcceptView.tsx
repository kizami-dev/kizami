"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "waku";
import { api, ApiError } from "../lib/api";
import { mapPasswordResetAcceptErrorMessage, messages } from "../lib/messages";
import { KizamiMark } from "./KizamiMark";

type ViewState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "ready"; tenantName: string | null; userName: string; email: string }
  | { kind: "accepted" }
  /** パスワード自体は更新済みだがセッション発行だけ失敗した場合(routes/password-resets.ts の判断点コメント参照)。 */
  | { kind: "sessionIssuanceFailed" };

/**
 * パスワードリセット受諾画面(/reset/[token]、認証ガード無し・公開)。
 * components/InviteAcceptView.tsx を手本にした(構成・状態機械・エラー画面・スタイルを流用)。
 * ログイン画面と同じ「紙白+中央カード」の構成(login-screen/login-card をそのまま使う)。
 *
 * 判断点: GET /password-resets/:token は 404(無効)と 410(期限切れ)を区別して返す
 * (apps/api/src/routes/password-resets.ts 冒頭の判断点コメント参照)ため、画面側もこの2つを
 * 別々の文言で案内する。使用(POST .../use)の実行直前に期限切れ・取り消し・使用済み化が発生する
 * 競合もあり得るため、送信時にも同じ 404/410 の分岐を持たせている(招待受諾と同じ設計)。
 */
export function PasswordResetAcceptView({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPasswordResetPreview(token)
      .then((res) => {
        if (cancelled) return;
        setState({ kind: "ready", tenantName: res.tenantName, userName: res.userName, email: res.email });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: err instanceof ApiError && err.status === 410 ? "expired" : "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError(messages.passwordResetAccept.passwordTooShort);
      return;
    }
    if (password !== passwordConfirm) {
      setError(messages.passwordResetAccept.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.usePasswordReset(token, password);
      if ("error" in res && res.error === "session_issuance_failed") {
        setState({ kind: "sessionIssuanceFailed" });
        return;
      }
      setState({ kind: "accepted" });
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
      // 2026-08-24: ステータス分岐(400 のみ特別扱い)からエラーコード分岐へ
      // (InviteAcceptView と同じ変更。429 rate_limited を専用の文言で出すため)。
      setError(
        err instanceof ApiError
          ? mapPasswordResetAcceptErrorMessage(err.body)
          : messages.passwordResetAccept.errors.default,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__mark" aria-hidden="true">
            <KizamiMark size={44} />
          </span>
          <span className="login-card__logo">{messages.appName}</span>
        </div>

        {state.kind === "loading" ? <p className="login-card__tagline">{messages.passwordResetAccept.loading}</p> : null}

        {state.kind === "invalid" ? (
          <>
            <h2 className="invite-accept__title">{messages.passwordResetAccept.invalidTitle}</h2>
            <p className="login-card__tagline">{messages.passwordResetAccept.invalidMessage}</p>
          </>
        ) : null}

        {state.kind === "expired" ? (
          <>
            <h2 className="invite-accept__title">{messages.passwordResetAccept.expiredTitle}</h2>
            <p className="login-card__tagline">{messages.passwordResetAccept.expiredMessage}</p>
          </>
        ) : null}

        {state.kind === "accepted" ? <p className="login-card__tagline">{messages.passwordResetAccept.acceptedRedirecting}</p> : null}

        {state.kind === "sessionIssuanceFailed" ? (
          <>
            <h2 className="invite-accept__title">{messages.passwordResetAccept.sessionIssuanceFailedTitle}</h2>
            <p className="login-card__tagline">{messages.passwordResetAccept.sessionIssuanceFailedMessage}</p>
            <button type="button" className="login-submit" onClick={() => router.push("/login")}>
              {messages.passwordResetAccept.goToLogin}
            </button>
          </>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <p className="login-card__tagline">
              {(state.tenantName ?? messages.passwordResetAccept.tenantUnnamed) + messages.passwordResetAccept.introSuffix}
            </p>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <div className="login-field">
                <label htmlFor="reset-accept-name">{messages.passwordResetAccept.nameLabel}</label>
                <input id="reset-accept-name" type="text" value={state.userName} readOnly />
              </div>

              <div className="login-field">
                <label htmlFor="reset-accept-email">{messages.passwordResetAccept.emailLabel}</label>
                <input id="reset-accept-email" type="email" value={state.email} readOnly />
              </div>

              <div className="login-field">
                <label htmlFor="reset-accept-password">{messages.passwordResetAccept.newPasswordLabel}</label>
                <input
                  id="reset-accept-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="login-field">
                <label htmlFor="reset-accept-password-confirm">{messages.passwordResetAccept.newPasswordConfirmLabel}</label>
                <input
                  id="reset-accept-password-confirm"
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
                <p className="login-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="login-submit" disabled={submitting}>
                {submitting ? messages.passwordResetAccept.submitting : messages.passwordResetAccept.submit}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
