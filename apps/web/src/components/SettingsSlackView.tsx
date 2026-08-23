"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type SlackSettingsDto, type UpdateSlackSettingsInput } from "../lib/api";
import { mapSlackSettingsErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsNav } from "./SettingsNav";

interface FormState {
  teamId: string;
  /** マスクされて返るため常に空欄始まり。空欄のまま送信すれば既存値を維持する(PUTの3値ルール)。 */
  signingSecret: string;
  enabled: boolean;
}

function toFormState(settings: SlackSettingsDto): FormState {
  return { teamId: settings.teamId ?? "", signingSecret: "", enabled: settings.enabled };
}

/**
 * Slack連携設定画面(/settings/slack、2026-08-22 追加)。docs/external-api/slack.md が仕様の正。
 *
 * 要件:
 * - 権限が無いユーザーには表示しない(API の 403 で判定、他の管理者向け設定画面と同じ流儀)
 * - Signing Secret はマスクされて返るため、空欄=既存値維持・入力あり=置換という
 *   UI規約にする(PUT /settings/notifications の webhookUrl と同じ流儀)
 * - 導入手順(Slackアプリの作成)への導線として docs/external-api/slack.md を案内する
 * - 従業員自身のSlackアカウント連携(/settings/slack-link)への導線も示す(権限不要のため
 *   この画面にアクセスできない一般従業員も別画面から自分で連携できることを明示する)
 */
export function SettingsSlackView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [settings, setSettings] = useState<SlackSettingsDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .getSlackSettings()
      .then((res) => {
        if (cancelled) return;
        setSettings(res);
        setForm(toFormState(res));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError(err instanceof ApiError ? messages.settingsSlack.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  function updateForm(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSaveSuccess(false);

    const body: UpdateSlackSettingsInput = {
      enabled: form.enabled,
      teamId: form.teamId.trim(),
      ...(form.signingSecret.trim() !== "" ? { signingSecret: form.signingSecret.trim() } : {}),
    };

    setSaving(true);
    try {
      const updated = await api.updateSlackSettings(body);
      setSettings(updated);
      setForm(toFormState(updated));
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapSlackSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSaving(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main">
        <SettingsNav active="slack" />
        <h1 className="settings-notif__title">{messages.settingsSlack.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsSlack.tagline}</p>
        <p className="settings-notif__field-hint">{messages.settingsSlack.setupGuideHint}</p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsSlack.noPermission}
          </p>
        ) : null}

        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && form && settings ? (
          <form className="settings-notif__form" onSubmit={handleSave}>
            <section className="settings-notif__section">
              <div className="correction-field">
                <label htmlFor="slack-team-id">{messages.settingsSlack.teamIdLabel}</label>
                <input
                  id="slack-team-id"
                  type="text"
                  value={form.teamId}
                  placeholder={messages.settingsSlack.teamIdPlaceholder}
                  onChange={(e) => updateForm({ teamId: e.target.value })}
                />
                <p className="settings-notif__field-hint">{messages.settingsSlack.teamIdHint}</p>
              </div>

              <div className="correction-field">
                <label htmlFor="slack-signing-secret">{messages.settingsSlack.signingSecretLabel}</label>
                <input
                  id="slack-signing-secret"
                  type="password"
                  autoComplete="new-password"
                  value={form.signingSecret}
                  onChange={(e) => updateForm({ signingSecret: e.target.value })}
                />
                <p className="settings-notif__field-hint">
                  {settings.signingSecretSet
                    ? messages.settingsSlack.signingSecretConfigured
                    : messages.settingsSlack.signingSecretNotConfigured}
                  {messages.common.hintSeparator}
                  {messages.settingsSlack.keepIfBlankHint}
                </p>
              </div>

              <label className="settings-notif__checkbox">
                <input type="checkbox" checked={form.enabled} onChange={(e) => updateForm({ enabled: e.target.checked })} />
                {messages.settingsSlack.enabledLabel}
              </label>
              <p className="settings-notif__field-hint">{messages.settingsSlack.enabledHint}</p>
            </section>

            {saveError ? (
              <p className="correction-error" role="alert">
                {saveError}
              </p>
            ) : null}
            {saveSuccess ? <p className="settings-notif__success">{messages.settingsSlack.saveSuccess}</p> : null}

            <p className="settings-notif__save-note">{messages.settingsSlack.saveNote}</p>

            <div className="settings-notif__actions">
              <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                {saving ? messages.settingsSlack.saving : messages.settingsSlack.save}
              </button>
            </div>

            <p className="settings-notif__field-hint">
              {messages.settingsSlack.linkNavHint}
              <Link to="/settings/slack-link">{messages.settingsSlack.linkNavLinkLabel}</Link>
              {messages.settingsSlack.linkNavHintSuffix}
            </p>
          </form>
        ) : null}
      </main>
    </div>
  );
}
