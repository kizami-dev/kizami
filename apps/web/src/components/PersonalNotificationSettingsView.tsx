"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type NotificationTestResult,
  type PersonalNotificationCategory,
  type PersonalNotificationSettingsDto,
  type UpdatePersonalNotificationSettingsInput,
} from "../lib/api";
import { mapPersonalNotificationSettingsErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useSettingsAccess } from "../lib/useSettingsAccess";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";

const CATEGORIES: PersonalNotificationCategory[] = [
  "missing_clock_out",
  "overtime_alert",
  "leave_alert",
  "correction_alert",
  // approval_request(2026-08-23 Tier 0 その4 追加): 承認権限を持つ人向けの「承認依頼が届いた」カテゴリ。
  "approval_request",
  // shift_variance(2026-08-24 追加): 前日の自分の勤務がシフトとずれたときの本人向け通知。
  "shift_variance",
];

interface FormState {
  categories: Record<PersonalNotificationCategory, { email: boolean; webhook: boolean }>;
  emailAddress: string;
  /** マスクされて返るため常に空欄始まり。空欄のまま送信すれば既存値を維持する(PUTの3値ルール)。 */
  webhookUrl: string;
}

function toFormState(settings: PersonalNotificationSettingsDto): FormState {
  const categories = {} as FormState["categories"];
  for (const category of CATEGORIES) {
    categories[category] = { email: settings.categories[category].email, webhook: settings.categories[category].webhook };
  }
  return { categories, emailAddress: settings.emailAddress.value ?? "", webhookUrl: "" };
}

/**
 * 個人の通知設定画面(/settings/notifications/me, 2026-08-22 追加)。
 * docs/requirements.md §7「通知設定の2層構造」— 認証済みなら誰でも自分の設定だけを読み書きできる
 * (権限チェック無し)。テナント設定(/settings/notifications、管理者向け)とは別画面にし、
 * 画面上で違いを明示する(バナー+相互リンク)。
 *
 * 判断点(完了報告に明記): 通知の種類はカテゴリ3種(打刻忘れ/36協定・時間外/有給アラート)に
 * 束ねて表示する(apps/api/src/lib/notification-preferences.ts と揃える。理由は同ファイルの
 * コメント参照 — notifications.type 14種類のうち従業員が意識する単位はこの粒度で十分なため)。
 */
export function PersonalNotificationSettingsView() {
  const router = useRouter();
  const guard = useAuthGuard();
  const settingsAccess = useSettingsAccess();

  const [settings, setSettings] = useState<PersonalNotificationSettingsDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [testConfirmOpen, setTestConfirmOpen] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<NotificationTestResult | null | undefined>(undefined);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getPersonalNotificationSettings()
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
        setLoadError(err instanceof ApiError ? messages.settingsPersonalNotifications.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  function updateCategory(category: PersonalNotificationCategory, patch: Partial<{ email: boolean; webhook: boolean }>) {
    setForm((prev) =>
      prev ? { ...prev, categories: { ...prev.categories, [category]: { ...prev.categories[category], ...patch } } } : prev,
    );
  }

  function updateField(patch: Partial<Pick<FormState, "emailAddress" | "webhookUrl">>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSaveSuccess(false);

    const body: UpdatePersonalNotificationSettingsInput = {
      categories: {
        missing_clock_out: { email: form.categories.missing_clock_out.email, webhook: form.categories.missing_clock_out.webhook },
        overtime_alert: { email: form.categories.overtime_alert.email, webhook: form.categories.overtime_alert.webhook },
        leave_alert: { email: form.categories.leave_alert.email, webhook: form.categories.leave_alert.webhook },
        correction_alert: { email: form.categories.correction_alert.email, webhook: form.categories.correction_alert.webhook },
        approval_request: { email: form.categories.approval_request.email, webhook: form.categories.approval_request.webhook },
        shift_variance: { email: form.categories.shift_variance.email, webhook: form.categories.shift_variance.webhook },
      },
      // 空欄のまま送信 = 既存値を維持(3値ルールのうち「省略」に相当)。
      ...(form.emailAddress.trim() !== "" ? { emailAddress: form.emailAddress.trim() } : {}),
      ...(form.webhookUrl.trim() !== "" ? { webhookUrl: form.webhookUrl.trim() } : {}),
    };

    setSaving(true);
    try {
      const updated = await api.updatePersonalNotificationSettings(body);
      setSettings(updated);
      setForm(toFormState(updated));
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapPersonalNotificationSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConfirm() {
    setTestPending(true);
    setTestError(null);
    try {
      const res = await api.testPersonalWebhook();
      setTestResult(res.result);
      setTestConfirmOpen(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setTestError(err instanceof ApiError ? mapPersonalNotificationSettingsErrorMessage(err.body) : messages.errors.network);
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
    <div className="settings-personal-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-personal-notif__main">
        <Link to="/settings" className="settings-nav__hub-link">
          <span aria-hidden="true">←</span> {messages.settingsNav.hubLink}
        </Link>

        <h1 className="settings-personal-notif__title">{messages.settingsPersonalNotifications.title}</h1>
        <p className="settings-personal-notif__tagline">{messages.settingsPersonalNotifications.tagline}</p>

        <p className="settings-personal-notif__banner">
          {settingsAccess.notifications ? (
            <>
              {messages.settingsPersonalNotifications.distinctionBanner}{" "}
              <Link to="/settings/notifications">{messages.settingsPersonalNotifications.linkToTenantSettings}</Link>
            </>
          ) : (
            messages.settingsPersonalNotifications.distinctionBannerNoAccess
          )}
        </p>

        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {form && settings ? (
          <form className="settings-personal-notif__form" onSubmit={handleSave}>
            <section className="settings-notif__section">
              <h2 className="settings-notif__section-title">{messages.settingsPersonalNotifications.categoriesSectionTitle}</h2>
              <p className="settings-notif__field-hint">{messages.settingsPersonalNotifications.inappAlwaysOnHint}</p>

              <div className="settings-personal-notif__category-table" role="table">
                <div className="settings-personal-notif__category-row settings-personal-notif__category-row--header" role="row">
                  <span role="columnheader" />
                  <span role="columnheader">{messages.settingsPersonalNotifications.categoryColumnInapp}</span>
                  <span role="columnheader">{messages.settingsPersonalNotifications.categoryColumnEmail}</span>
                  <span role="columnheader">{messages.settingsPersonalNotifications.categoryColumnWebhook}</span>
                </div>
                {CATEGORIES.map((category) => (
                  <div className="settings-personal-notif__category-row" role="row" key={category}>
                    <span role="cell" className="settings-personal-notif__category-label">
                      {messages.settingsPersonalNotifications.categories[category]}
                    </span>
                    <span role="cell">
                      <input type="checkbox" checked disabled aria-label={messages.settingsPersonalNotifications.categoryColumnInapp} />
                    </span>
                    <span role="cell">
                      <input
                        type="checkbox"
                        checked={form.categories[category].email}
                        onChange={(e) => updateCategory(category, { email: e.target.checked })}
                        aria-label={messages.settingsPersonalNotifications.categoryColumnEmail}
                      />
                    </span>
                    <span role="cell">
                      <input
                        type="checkbox"
                        checked={form.categories[category].webhook}
                        onChange={(e) => updateCategory(category, { webhook: e.target.checked })}
                        aria-label={messages.settingsPersonalNotifications.categoryColumnWebhook}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="settings-notif__section">
              <h2 className="settings-notif__section-title">{messages.settingsPersonalNotifications.emailSectionTitle}</h2>
              <div className="correction-field">
                <label htmlFor="personal-email-address">{messages.settingsPersonalNotifications.emailAddressLabel}</label>
                <input
                  id="personal-email-address"
                  type="text"
                  inputMode="email"
                  value={form.emailAddress}
                  placeholder={messages.settingsPersonalNotifications.emailAddressPlaceholder}
                  onChange={(e) => updateField({ emailAddress: e.target.value })}
                />
                <p className="settings-notif__field-hint">
                  {messages.settingsPersonalNotifications.emailAddressEffectiveHint(settings.emailAddress.effective)}
                </p>
              </div>
            </section>

            <section className="settings-notif__section">
              <h2 className="settings-notif__section-title">{messages.settingsPersonalNotifications.webhookSectionTitle}</h2>
              <div className="correction-field">
                <label htmlFor="personal-webhook-url">{messages.settingsPersonalNotifications.webhookUrlLabel}</label>
                <input
                  id="personal-webhook-url"
                  type="text"
                  inputMode="url"
                  value={form.webhookUrl}
                  placeholder={messages.settingsPersonalNotifications.webhookUrlPlaceholder}
                  onChange={(e) => updateField({ webhookUrl: e.target.value })}
                />
                <p className="settings-notif__field-hint">
                  {settings.webhookUrl.configured
                    ? `${messages.settingsPersonalNotifications.webhookUrlConfigured}(${settings.webhookUrl.preview})`
                    : messages.settingsPersonalNotifications.webhookUrlNotConfigured}
                  {messages.common.hintSeparator}
                  {messages.settingsPersonalNotifications.keepIfBlankHint}
                </p>
              </div>
            </section>

            {saveError ? (
              <p className="correction-error" role="alert">
                {saveError}
              </p>
            ) : null}
            {saveSuccess ? <p className="settings-notif__success">{messages.settingsPersonalNotifications.saveSuccess}</p> : null}

            <div className="settings-notif__actions">
              <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                {saving ? messages.settingsPersonalNotifications.saving : messages.settingsPersonalNotifications.save}
              </button>
              <button
                type="button"
                className="k-modal__cancel"
                disabled={!settings.webhookUrl.configured}
                onClick={() => {
                  setTestError(null);
                  setTestResult(undefined);
                  setTestConfirmOpen(true);
                }}
              >
                {messages.settingsPersonalNotifications.testSend}
              </button>
            </div>

            {testResult !== undefined ? (
              <section className="settings-notif__test-results">
                <h2 className="settings-notif__section-title">{messages.settingsPersonalNotifications.testSendResultTitle}</h2>
                {testResult ? (
                  <ul className="test-result-list">
                    <li className={`test-result-item${testResult.ok ? " test-result-item--ok" : " test-result-item--error"}`}>
                      <span className="test-result-item__channel">{testResult.channel}</span>
                      <span className="test-result-item__status">
                        {testResult.ok
                          ? messages.settingsPersonalNotifications.testSendOk
                          : messages.settingsPersonalNotifications.testSendFailed}
                      </span>
                      {!testResult.ok && testResult.error ? (
                        <span className="test-result-item__error">{testResult.error}</span>
                      ) : null}
                    </li>
                  </ul>
                ) : (
                  <p className="settings-notif__field-hint">{messages.settingsPersonalNotifications.errors.not_configured}</p>
                )}
              </section>
            ) : null}
          </form>
        ) : null}
      </main>

      {testConfirmOpen ? (
        <ConfirmDialog
          title={messages.settingsPersonalNotifications.testSendConfirmTitle}
          message={messages.settingsPersonalNotifications.testSendConfirmMessage}
          confirmLabel={messages.settingsPersonalNotifications.testSendConfirmLabel}
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
