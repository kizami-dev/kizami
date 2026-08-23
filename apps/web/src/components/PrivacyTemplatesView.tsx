"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type PrivacyTemplatesDto } from "../lib/api";
import { mapHelpSettingsErrorMessage, messages } from "../lib/messages";
import { invalidateHelpOverridesCache } from "../lib/useHelpOverrides";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsNav } from "./SettingsNav";

/** privacy.notice-template / privacy.internal-terms-template(packages/help-content 側で定義)。 */
const NOTICE_HELP_KEY = "privacy.notice-template";
const TERMS_HELP_KEY = "privacy.internal-terms-template";

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface TemplateCardProps {
  title: string;
  desc: string;
  content: string;
  filename: string;
  helpKey: string;
}

/**
 * 生成された雛形1件(通知 or 利用規約)を表示するカード。
 * コピー・Markdownダウンロード・「社内規定として登録」(help_overrides への書き込み)を提供する
 * (docs/design/ui-direction.md「個人情報まわりの雛形」§実装・パート3)。
 */
function TemplateCard({ title, desc, content, filename, helpKey }: TemplateCardProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      setTimeout(() => setCopyState("idle"), 3000);
    }
  }

  async function handleRegister() {
    setRegistering(true);
    setRegisterResult(null);
    try {
      await api.updateHelpOverride(helpKey, content);
      invalidateHelpOverridesCache();
      setRegisterResult({ ok: true, message: messages.settingsPrivacy.registerSuccess });
    } catch (err) {
      const message = err instanceof ApiError ? mapHelpSettingsErrorMessage(err.body) : messages.errors.network;
      setRegisterResult({ ok: false, message });
    } finally {
      setRegistering(false);
    }
  }

  return (
    <section className="settings-notif__section privacy-template__card">
      <h2 className="settings-notif__section-title">{title}</h2>
      <p className="settings-notif__field-hint">{desc}</p>

      <pre className="privacy-template__body">{content}</pre>

      <div className="settings-notif__actions privacy-template__actions">
        <button type="button" className="k-modal__confirm k-modal__confirm--neutral" onClick={handleCopy}>
          {copyState === "copied" ? messages.settingsPrivacy.copied : messages.settingsPrivacy.copy}
        </button>
        <button
          type="button"
          className="k-modal__confirm k-modal__confirm--neutral"
          onClick={() => downloadMarkdown(filename, content)}
        >
          {messages.settingsPrivacy.download}
        </button>
        <button type="button" className="k-modal__confirm k-modal__confirm--neutral" disabled={registering} onClick={handleRegister}>
          {registering ? messages.settingsPrivacy.registering : messages.settingsPrivacy.registerAsCompanyRule}
        </button>
      </div>

      {copyState === "failed" ? <p className="correction-error" role="alert">{messages.settingsPrivacy.copyFailed}</p> : null}
      {registerResult ? (
        <p className={registerResult.ok ? "settings-notif__success" : "correction-error"} role={registerResult.ok ? undefined : "alert"}>
          {registerResult.message}
        </p>
      ) : null}
    </section>
  );
}

/**
 * 個人情報まわりの雛形画面(/settings/privacy、2026-08-22 追加)。
 *
 * - 現在のテナント設定(GPSの有効/無効・保持期間)から生成された、従業員向けプライバシー通知と
 *   社内利用規約の雛形2種を表示する(GET /settings/privacy-templates)
 * - 雛形であって法的助言ではないことを画面上に常時明示する(ui-direction.md の要件)
 * - コピー・Markdownダウンロード・「社内規定として登録」(help_overrides への書き込み、
 *   HelpSettingsView と同じ流儀)を提供する
 */
export function PrivacyTemplatesView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [data, setData] = useState<PrivacyTemplatesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .getPrivacyTemplates()
      .then((res) => setData(res))
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError(err instanceof ApiError ? messages.settingsPrivacy.loadFailed : messages.errors.network);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (guard.status !== "authed") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main privacy-template__main">
        <SettingsNav active="privacy" />
        <h1 className="settings-notif__title">{messages.settingsPrivacy.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsPrivacy.tagline}</p>

        <p className="privacy-template__disclaimer" role="note">
          {messages.settingsPrivacy.disclaimer}
        </p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsPrivacy.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && data ? (
          <>
            <section className="settings-notif__section privacy-template__generated-from">
              <h2 className="settings-notif__section-title">{messages.settingsPrivacy.generatedFromTitle}</h2>
              <ul className="privacy-template__generated-from-list">
                <li>{data.generatedFrom.gpsEnabled ? messages.settingsPrivacy.generatedFromGpsOn : messages.settingsPrivacy.generatedFromGpsOff}</li>
                {data.generatedFrom.gpsEnabled ? (
                  <li>
                    {data.generatedFrom.gpsRetentionDays !== null
                      ? messages.settingsPrivacy.generatedFromRetention(data.generatedFrom.gpsRetentionDays)
                      : messages.settingsPrivacy.generatedFromRetentionSame}
                  </li>
                ) : null}
              </ul>
              <p className="settings-notif__field-hint">{messages.settingsPrivacy.generatedFromNote}</p>
            </section>

            <TemplateCard
              title={messages.settingsPrivacy.noticeSectionTitle}
              desc={messages.settingsPrivacy.noticeSectionDesc}
              content={data.privacyNotice}
              filename="privacy-notice.md"
              helpKey={NOTICE_HELP_KEY}
            />
            <TemplateCard
              title={messages.settingsPrivacy.termsSectionTitle}
              desc={messages.settingsPrivacy.termsSectionDesc}
              content={data.internalTerms}
              filename="internal-terms.md"
              helpKey={TERMS_HELP_KEY}
            />
          </>
        ) : null}
      </main>
    </div>
  );
}
