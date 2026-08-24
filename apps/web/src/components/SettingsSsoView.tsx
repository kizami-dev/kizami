"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, API_BASE_URL, ApiError, UnauthorizedError, type SsoSettingsDto, type UpdateSsoSettingsInput } from "../lib/api";
import { mapSsoSettingsErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsNav } from "./SettingsNav";

interface FormState {
  issuer: string;
  clientId: string;
  /** マスクされて返るため常に空欄始まり。空欄のまま送信すれば既存値を維持する(PUT の3値ルール)。 */
  clientSecret: string;
  enabled: boolean;
  allowUnverifiedEmail: boolean;
}

function toFormState(settings: SsoSettingsDto): FormState {
  return {
    issuer: settings.issuer ?? "",
    clientId: settings.clientId ?? "",
    clientSecret: "",
    enabled: settings.enabled,
    allowUnverifiedEmail: settings.allowUnverifiedEmail,
  };
}

/**
 * SSO(OIDC)設定画面(/settings/sso、2026-08-24 追加)。docs/design/sso-oidc.md が仕様の正。
 *
 * 構成は SettingsSlackView をそのまま踏襲している(権限が無ければ API の 403 で判定・
 * シークレットは空欄=維持・保存は監査ログに残る旨を明示)。この画面固有の要素は3つ:
 * - **自動プロビジョニングをしない**ことを最初に明記する。管理者が最も誤解しやすい点であり
 *   (「SSO を入れれば社員が勝手に入れる」と思われがち)、招待運用と矛盾しないことを伝える。
 * - IdP 側に登録すべきリダイレクト URI を、この環境の実際の値として提示する(手打ちさせない)。
 * - 「メール未確認でもログインを許可する」は既定 OFF の危険側スイッチとして、
 *   何が起きるかを添えて出す。
 */
export function SettingsSsoView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [settings, setSettings] = useState<SsoSettingsDto | null>(null);
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
      .getSsoSettings()
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
        setLoadError(err instanceof ApiError ? messages.settingsSso.loadFailed : messages.errors.network);
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

    const body: UpdateSsoSettingsInput = {
      enabled: form.enabled,
      issuer: form.issuer.trim(),
      clientId: form.clientId.trim(),
      allowUnverifiedEmail: form.allowUnverifiedEmail,
      ...(form.clientSecret.trim() !== "" ? { clientSecret: form.clientSecret.trim() } : {}),
    };

    setSaving(true);
    try {
      const updated = await api.updateSsoSettings(body);
      setSettings(updated);
      setForm(toFormState(updated));
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapSsoSettingsErrorMessage(err.body) : messages.errors.network);
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

  const redirectUri = `${API_BASE_URL}/auth/oidc/callback`;

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main">
        <SettingsNav active="sso" />
        <h1 className="settings-notif__title">{messages.settingsSso.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsSso.tagline}</p>
        <p className="settings-notif__field-hint">{messages.settingsSso.noAutoProvisioningNote}</p>
        <p className="settings-notif__field-hint">{messages.settingsSso.setupGuideHint}</p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsSso.noPermission}
          </p>
        ) : null}

        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && form && settings ? (
          <form className="settings-notif__form" onSubmit={handleSave}>
            <section className="settings-notif__section">
              <div className="correction-field">
                <label htmlFor="sso-redirect-uri">{messages.settingsSso.redirectUriLabel}</label>
                <input id="sso-redirect-uri" type="text" value={redirectUri} readOnly />
                <p className="settings-notif__field-hint">{messages.settingsSso.redirectUriHint}</p>
              </div>

              <div className="correction-field">
                <label htmlFor="sso-issuer">{messages.settingsSso.issuerLabel}</label>
                <input
                  id="sso-issuer"
                  type="url"
                  value={form.issuer}
                  placeholder={messages.settingsSso.issuerPlaceholder}
                  onChange={(e) => updateForm({ issuer: e.target.value })}
                />
                <p className="settings-notif__field-hint">{messages.settingsSso.issuerHint}</p>
              </div>

              <div className="correction-field">
                <label htmlFor="sso-client-id">{messages.settingsSso.clientIdLabel}</label>
                <input id="sso-client-id" type="text" value={form.clientId} onChange={(e) => updateForm({ clientId: e.target.value })} />
                <p className="settings-notif__field-hint">{messages.settingsSso.clientIdHint}</p>
              </div>

              <div className="correction-field">
                <label htmlFor="sso-client-secret">{messages.settingsSso.clientSecretLabel}</label>
                <input
                  id="sso-client-secret"
                  type="password"
                  autoComplete="new-password"
                  value={form.clientSecret}
                  onChange={(e) => updateForm({ clientSecret: e.target.value })}
                />
                <p className="settings-notif__field-hint">
                  {settings.clientSecretSet
                    ? messages.settingsSso.clientSecretConfigured
                    : messages.settingsSso.clientSecretNotConfigured}
                  {messages.common.hintSeparator}
                  {messages.settingsSso.keepIfBlankHint}
                </p>
              </div>

              <label className="settings-notif__checkbox">
                <input
                  type="checkbox"
                  checked={form.allowUnverifiedEmail}
                  onChange={(e) => updateForm({ allowUnverifiedEmail: e.target.checked })}
                />
                {messages.settingsSso.allowUnverifiedLabel}
              </label>
              <p className="settings-notif__field-hint">{messages.settingsSso.allowUnverifiedHint}</p>

              <label className="settings-notif__checkbox">
                <input type="checkbox" checked={form.enabled} onChange={(e) => updateForm({ enabled: e.target.checked })} />
                {messages.settingsSso.enabledLabel}
              </label>
              <p className="settings-notif__field-hint">{messages.settingsSso.enabledHint}</p>
            </section>

            {saveError ? (
              <p className="correction-error" role="alert">
                {saveError}
              </p>
            ) : null}
            {saveSuccess ? <p className="settings-notif__success">{messages.settingsSso.saveSuccess}</p> : null}

            <p className="settings-notif__save-note">{messages.settingsSso.saveNote}</p>

            <div className="settings-notif__actions">
              <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                {saving ? messages.settingsSso.saving : messages.settingsSso.save}
              </button>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
}
