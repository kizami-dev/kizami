"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, API_BASE_URL, ApiError, UnauthorizedError, type SsoSettingsDto, type UpdateSsoSettingsInput } from "../lib/api";
import { mapSsoSettingsErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsNav } from "./SettingsNav";
import { StateView } from "./ui/StateView";
import { PageHeader } from "./ui/PageHeader";

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
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  const redirectUri = `${API_BASE_URL}/auth/oidc/callback`;

  return (
    <div className="page-shell">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="page">
        <SettingsNav active="sso" />
        <PageHeader title={messages.settingsSso.title} lead={messages.settingsSso.tagline} />
        <p className="field__hint">{messages.settingsSso.noAutoProvisioningNote}</p>
        <p className="field__hint">{messages.settingsSso.setupGuideHint}</p>

        {forbidden ? (
          <p className="notice notice--danger" role="alert">
            {messages.settingsSso.noPermission}
          </p>
        ) : null}

        {loadError ? <StateView kind="error">{loadError}</StateView> : null}

        {!forbidden && form && settings ? (
          <form className="page-body page-body--form" onSubmit={handleSave}>
            <section className="card">
              <div className="field">
                <label htmlFor="sso-redirect-uri">{messages.settingsSso.redirectUriLabel}</label>
                <input id="sso-redirect-uri" type="text" value={redirectUri} readOnly />
                <p className="field__hint">{messages.settingsSso.redirectUriHint}</p>
              </div>

              <div className="field">
                <label htmlFor="sso-issuer">{messages.settingsSso.issuerLabel}</label>
                <input
                  id="sso-issuer"
                  type="url"
                  value={form.issuer}
                  placeholder={messages.settingsSso.issuerPlaceholder}
                  onChange={(e) => updateForm({ issuer: e.target.value })}
                />
                <p className="field__hint">{messages.settingsSso.issuerHint}</p>
              </div>

              <div className="field">
                <label htmlFor="sso-client-id">{messages.settingsSso.clientIdLabel}</label>
                <input id="sso-client-id" type="text" value={form.clientId} onChange={(e) => updateForm({ clientId: e.target.value })} />
                <p className="field__hint">{messages.settingsSso.clientIdHint}</p>
              </div>

              <div className="field">
                <label htmlFor="sso-client-secret">{messages.settingsSso.clientSecretLabel}</label>
                <input
                  id="sso-client-secret"
                  type="password"
                  autoComplete="new-password"
                  value={form.clientSecret}
                  onChange={(e) => updateForm({ clientSecret: e.target.value })}
                />
                <p className="field__hint">
                  {settings.clientSecretSet
                    ? messages.settingsSso.clientSecretConfigured
                    : messages.settingsSso.clientSecretNotConfigured}
                  {messages.common.hintSeparator}
                  {messages.settingsSso.keepIfBlankHint}
                </p>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={form.allowUnverifiedEmail}
                  onChange={(e) => updateForm({ allowUnverifiedEmail: e.target.checked })}
                />
                {messages.settingsSso.allowUnverifiedLabel}
              </label>
              <p className="field__hint">{messages.settingsSso.allowUnverifiedHint}</p>

              <label className="check">
                <input type="checkbox" checked={form.enabled} onChange={(e) => updateForm({ enabled: e.target.checked })} />
                {messages.settingsSso.enabledLabel}
              </label>
              <p className="field__hint">{messages.settingsSso.enabledHint}</p>
            </section>

            {saveError ? (
              <p className="notice notice--danger" role="alert">
                {saveError}
              </p>
            ) : null}
            {saveSuccess ? <p className="notice notice--success">{messages.settingsSso.saveSuccess}</p> : null}

            <p className="field__hint">{messages.settingsSso.saveNote}</p>

            <div className="btn-row">
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? messages.settingsSso.saving : messages.settingsSso.save}
              </button>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
}
