"use client";

import { useState } from "react";
import { Link, useRouter } from "waku";
import { api, ApiError, UnauthorizedError } from "../lib/api";
import { mapSlackLinkErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { StateView } from "./ui/StateView";

/**
 * Slack連携用トークンの入力画面(/settings/slack-link、2026-08-22 追加)。
 *
 * apps/api/src/routes/settings.ts の POST /settings/slack-link と同じく**権限不要**
 * (依頼: 全従業員が自分で連携するため)。/settings/notifications/me と同じ「自分用画面」の
 * 構成に合わせ、設定ハブへの戻りリンクのみを置き SettingsNav(管理者向けタブ)は表示しない。
 */
export function SlackLinkView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedSlackUserId, setLinkedSlackUserId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = token.trim();
    if (trimmed === "") {
      setError(messages.settingsSlackLink.errors.invalid_token);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.redeemSlackLinkToken(trimmed);
      setLinkedSlackUserId(res.slackUserId);
      setToken("");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? mapSlackLinkErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSubmitting(false);
    }
  }

  if (guard.status === "loading") {
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  return (
    <div className="settings-personal-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-personal-notif__main">
        <Link to="/settings" className="settings-nav__hub-link">
          <span aria-hidden="true">←</span> {messages.settingsNav.hubLink}
        </Link>

        <h1 className="settings-personal-notif__title">{messages.settingsSlackLink.title}</h1>
        <p className="settings-personal-notif__tagline">{messages.settingsSlackLink.tagline}</p>

        <section className="card">
          <h2 className="card__title">{messages.settingsSlackLink.howToTitle}</h2>
          <ol>
            <li>{messages.settingsSlackLink.howTo1}</li>
            <li>{messages.settingsSlackLink.howTo2}</li>
            <li>{messages.settingsSlackLink.howTo3}</li>
          </ol>
        </section>

        {linkedSlackUserId ? (
          <section className="api-keys__reveal" aria-live="polite">
            <h2 className="card__title">{messages.settingsSlackLink.successTitle}</h2>
            <p>{messages.settingsSlackLink.successMessage(linkedSlackUserId)}</p>
          </section>
        ) : (
          <form className="settings-personal-notif__form" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="slack-link-token">{messages.settingsSlackLink.tokenLabel}</label>
              <input
                id="slack-link-token"
                type="text"
                autoComplete="off"
                value={token}
                placeholder={messages.settingsSlackLink.tokenPlaceholder}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>

            {error ? (
              <p className="notice notice--danger" role="alert">
                {error}
              </p>
            ) : null}

            <div className="btn-row">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? messages.settingsSlackLink.submitting : messages.settingsSlackLink.submit}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
