"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type NotificationSettingsDto,
  type NotificationTestResult,
  type UpdateNotificationSettingsInput,
} from "../lib/api";
import { mapNotificationSettingsErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsNav } from "./SettingsNav";

interface FormState {
  webhookEnabled: boolean;
  /** マスクされて返るため常に空欄始まり。空欄のまま送信すれば既存値を維持する(PUTの3値ルール)。 */
  webhookUrl: string;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFrom: string;
  /** マスクされて返るため常に空欄始まり。空欄のまま送信すれば既存値を維持する。 */
  smtpPassword: string;
}

function toFormState(settings: NotificationSettingsDto): FormState {
  return {
    webhookEnabled: settings.webhookEnabled,
    webhookUrl: "",
    smtpEnabled: settings.smtpEnabled,
    smtpHost: settings.smtpHost ?? "",
    smtpPort: settings.smtpPort !== null ? String(settings.smtpPort) : "",
    smtpUser: settings.smtpUser ?? "",
    smtpFrom: settings.smtpFrom ?? "",
    smtpPassword: "",
  };
}

/**
 * 通知設定画面(/settings/notifications)。要件:
 * - 権限が無いユーザーには表示しない(API の 403 で判定、ナビにも出さない — ナビ側は AppHeader が担当)
 * - webhookUrl/smtpPassword はマスクされて返るため、空欄=既存値維持・入力あり=置換という
 *   UI規約にする(このUIから明示的なクリア操作は提供しない、独自判断点)
 * - テスト送信は実行前に確認ダイアログを挟む(実際に1通送信するため)
 */
export function SettingsNotificationsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [settings, setSettings] = useState<NotificationSettingsDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [testConfirmOpen, setTestConfirmOpen] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<NotificationTestResult[] | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .getNotificationSettings()
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
        setLoadError(err instanceof ApiError ? messages.settingsNotifications.loadFailed : messages.errors.network);
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

    let smtpPort: number | null = null;
    if (form.smtpPort.trim() !== "") {
      const parsed = Number(form.smtpPort);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        setSaveError(messages.settingsNotifications.errors.invalid_smtp_port);
        return;
      }
      smtpPort = parsed;
    }

    const body: UpdateNotificationSettingsInput = {
      webhookEnabled: form.webhookEnabled,
      smtpEnabled: form.smtpEnabled,
      smtpHost: form.smtpHost,
      smtpUser: form.smtpUser,
      smtpFrom: form.smtpFrom,
      smtpPort,
      ...(form.webhookUrl.trim() !== "" ? { webhookUrl: form.webhookUrl.trim() } : {}),
      ...(form.smtpPassword !== "" ? { smtpPassword: form.smtpPassword } : {}),
    };

    setSaving(true);
    try {
      const updated = await api.updateNotificationSettings(body);
      setSettings(updated);
      setForm(toFormState(updated));
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapNotificationSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConfirm() {
    setTestPending(true);
    setTestError(null);
    try {
      const res = await api.testNotificationSettings();
      setTestResults(res.results);
      setTestConfirmOpen(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setTestError(err instanceof ApiError ? mapNotificationSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setTestPending(false);
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
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="settings" />
      <main className="settings-notif__main">
        <SettingsNav active="notifications" />
        <h1 className="settings-notif__title">{messages.settingsNotifications.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsNotifications.tagline}</p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsNotifications.noPermission}
          </p>
        ) : null}

        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && form && settings ? (
          <>
            <form className="settings-notif__form" onSubmit={handleSave}>
              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">{messages.settingsNotifications.webhookSectionTitle}</h2>
                <label className="settings-notif__checkbox">
                  <input
                    type="checkbox"
                    checked={form.webhookEnabled}
                    onChange={(e) => updateForm({ webhookEnabled: e.target.checked })}
                  />
                  {messages.settingsNotifications.webhookEnabledLabel}
                </label>
                <div className="correction-field">
                  <label htmlFor="webhook-url">{messages.settingsNotifications.webhookUrlLabel}</label>
                  <input
                    id="webhook-url"
                    type="text"
                    inputMode="url"
                    value={form.webhookUrl}
                    placeholder={messages.settingsNotifications.webhookUrlPlaceholder}
                    onChange={(e) => updateForm({ webhookUrl: e.target.value })}
                  />
                  <p className="settings-notif__field-hint">
                    {settings.webhookUrl.configured
                      ? `${messages.settingsNotifications.webhookUrlConfigured}(${settings.webhookUrl.preview})`
                      : messages.settingsNotifications.webhookUrlNotConfigured}
                    {" ・ "}
                    {messages.settingsNotifications.keepIfBlankHint}
                  </p>
                </div>
              </section>

              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">{messages.settingsNotifications.smtpSectionTitle}</h2>
                <label className="settings-notif__checkbox">
                  <input
                    type="checkbox"
                    checked={form.smtpEnabled}
                    onChange={(e) => updateForm({ smtpEnabled: e.target.checked })}
                  />
                  {messages.settingsNotifications.smtpEnabledLabel}
                </label>

                <div className="correction-field-row">
                  <div className="correction-field">
                    <label htmlFor="smtp-host">{messages.settingsNotifications.smtpHostLabel}</label>
                    <input
                      id="smtp-host"
                      type="text"
                      value={form.smtpHost}
                      onChange={(e) => updateForm({ smtpHost: e.target.value })}
                    />
                  </div>
                  <div className="correction-field">
                    <label htmlFor="smtp-port">{messages.settingsNotifications.smtpPortLabel}</label>
                    <input
                      id="smtp-port"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      value={form.smtpPort}
                      onChange={(e) => updateForm({ smtpPort: e.target.value })}
                    />
                  </div>
                </div>

                <div className="correction-field-row">
                  <div className="correction-field">
                    <label htmlFor="smtp-user">{messages.settingsNotifications.smtpUserLabel}</label>
                    <input
                      id="smtp-user"
                      type="text"
                      value={form.smtpUser}
                      onChange={(e) => updateForm({ smtpUser: e.target.value })}
                    />
                  </div>
                  <div className="correction-field">
                    <label htmlFor="smtp-from">{messages.settingsNotifications.smtpFromLabel}</label>
                    <input
                      id="smtp-from"
                      type="text"
                      inputMode="email"
                      value={form.smtpFrom}
                      onChange={(e) => updateForm({ smtpFrom: e.target.value })}
                    />
                  </div>
                </div>

                <div className="correction-field">
                  <label htmlFor="smtp-password">{messages.settingsNotifications.smtpPasswordLabel}</label>
                  <input
                    id="smtp-password"
                    type="password"
                    autoComplete="new-password"
                    value={form.smtpPassword}
                    onChange={(e) => updateForm({ smtpPassword: e.target.value })}
                  />
                  <p className="settings-notif__field-hint">
                    {settings.smtpPasswordSet
                      ? messages.settingsNotifications.smtpPasswordConfigured
                      : messages.settingsNotifications.smtpPasswordNotConfigured}
                    {" ・ "}
                    {messages.settingsNotifications.keepIfBlankHint}
                  </p>
                </div>
              </section>

              {saveError ? (
                <p className="correction-error" role="alert">
                  {saveError}
                </p>
              ) : null}
              {saveSuccess ? <p className="settings-notif__success">{messages.settingsNotifications.saveSuccess}</p> : null}

              <p className="settings-notif__save-note">{messages.settingsNotifications.saveNote}</p>

              <div className="settings-notif__actions">
                <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                  {saving ? messages.settingsNotifications.saving : messages.settingsNotifications.save}
                </button>
                <button
                  type="button"
                  className="k-modal__cancel"
                  onClick={() => {
                    setTestError(null);
                    setTestResults(null);
                    setTestConfirmOpen(true);
                  }}
                >
                  {messages.settingsNotifications.testSend}
                </button>
              </div>
            </form>

            {testResults ? (
              <section className="settings-notif__test-results">
                <h2 className="settings-notif__section-title">{messages.settingsNotifications.testSendResultTitle}</h2>
                <ul className="test-result-list">
                  {testResults.map((r) => (
                    <li
                      key={r.channel}
                      className={`test-result-item${r.ok ? " test-result-item--ok" : " test-result-item--error"}`}
                    >
                      <span className="test-result-item__channel">
                        {messages.settingsNotifications.testSendChannelLabel[r.channel] ?? r.channel}
                      </span>
                      <span className="test-result-item__status">
                        {r.ok ? messages.settingsNotifications.testSendOk : messages.settingsNotifications.testSendFailed}
                      </span>
                      {!r.ok && r.error ? <span className="test-result-item__error">{r.error}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </main>

      {testConfirmOpen ? (
        <ConfirmDialog
          title={messages.settingsNotifications.testSendConfirmTitle}
          message={messages.settingsNotifications.testSendConfirmMessage}
          confirmLabel={messages.settingsNotifications.testSendConfirmLabel}
          tone="neutral"
          note=""
          pending={testPending}
          error={testError}
          onConfirm={handleTestConfirm}
          onCancel={() => {
            setTestConfirmOpen(false);
            setTestError(null);
          }}
        />
      ) : null}
    </div>
  );
}
