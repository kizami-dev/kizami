"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "waku";
import { api, ApiError } from "../lib/api";
import { messages } from "../lib/messages";
import { KizamiMark } from "./KizamiMark";

type ViewState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "ready"; tenantName: string | null; userName: string; email: string }
  | { kind: "accepted" };

/**
 * 招待受諾画面(/invite/[token]、認証ガード無し・公開)。docs/requirements.md §7「登録は招待式のみ」。
 * ログイン画面と同じ「紙白+中央カード」の構成(login-screen/login-card をそのまま使う)。
 *
 * 判断点: GET /invitations/:token は 404(無効)と 410(期限切れ)を区別して返す
 * (apps/api/src/routes/invitations.ts の判断点コメント参照)ため、画面側もこの2つを
 * 別々の文言で案内する。受諾(POST .../accept)の実行直前に期限切れ・取り消しが発生する
 * 競合もあり得るため、送信時にも同じ 404/410 の分岐を持たせている。
 */
export function InviteAcceptView({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getInvitationPreview(token)
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
      setError(messages.inviteAccept.passwordTooShort);
      return;
    }
    if (password !== passwordConfirm) {
      setError(messages.inviteAccept.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      await api.acceptInvitation(token, password);
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
      setError(err instanceof ApiError && err.status === 400 ? messages.inviteAccept.errors.invalid_password : messages.inviteAccept.errors.default);
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

        {state.kind === "loading" ? <p className="login-card__tagline">{messages.inviteAccept.loading}</p> : null}

        {state.kind === "invalid" ? (
          <>
            <h2 className="invite-accept__title">{messages.inviteAccept.invalidTitle}</h2>
            <p className="login-card__tagline">{messages.inviteAccept.invalidMessage}</p>
          </>
        ) : null}

        {state.kind === "expired" ? (
          <>
            <h2 className="invite-accept__title">{messages.inviteAccept.expiredTitle}</h2>
            <p className="login-card__tagline">{messages.inviteAccept.expiredMessage}</p>
          </>
        ) : null}

        {state.kind === "accepted" ? <p className="login-card__tagline">{messages.inviteAccept.acceptedRedirecting}</p> : null}

        {state.kind === "ready" ? (
          <>
            <p className="login-card__tagline">
              {(state.tenantName ?? messages.inviteAccept.invitedByUnnamed) + messages.inviteAccept.invitedBySuffix}
            </p>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <div className="login-field">
                <label htmlFor="invite-accept-name">{messages.inviteAccept.nameLabel}</label>
                <input id="invite-accept-name" type="text" value={state.userName} readOnly />
              </div>

              <div className="login-field">
                <label htmlFor="invite-accept-email">{messages.inviteAccept.emailLabel}</label>
                <input id="invite-accept-email" type="email" value={state.email} readOnly />
              </div>

              <div className="login-field">
                <label htmlFor="invite-accept-password">{messages.inviteAccept.passwordLabel}</label>
                <input
                  id="invite-accept-password"
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
                <label htmlFor="invite-accept-password-confirm">{messages.inviteAccept.passwordConfirmLabel}</label>
                <input
                  id="invite-accept-password-confirm"
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
                {submitting ? messages.inviteAccept.submitting : messages.inviteAccept.submit}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
