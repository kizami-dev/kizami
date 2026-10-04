"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type DataRetentionDto, type PrivacyTemplatesDto } from "../lib/api";
import { mapHelpSettingsErrorMessage, messages } from "../lib/messages";
import { invalidateHelpOverridesCache } from "../lib/useHelpOverrides";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsNav } from "./SettingsNav";
import { buttonClass } from "./ui/Button";
import { MarkdownPreview } from "./ui/MarkdownPreview";
import { StateView } from "./ui/StateView";
import { Tabs, tabId, tabPanelId } from "./ui/Tabs";
import { PageHeader } from "./ui/PageHeader";

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
  const [view, setView] = useState<"preview" | "source">("preview");
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
    <section className="card privacy-template__card">
      <h2 className="card__title">{title}</h2>
      <p className="field__hint">{desc}</p>

      <Tabs
        idPrefix={helpKey}
        ariaLabel={title}
        value={view}
        onChange={setView}
        tabs={[
          { id: "preview", label: messages.settingsPrivacy.viewPreview },
          { id: "source", label: messages.settingsPrivacy.viewSource },
        ]}
      />
      <div role="tabpanel" id={tabPanelId(helpKey, view)} aria-labelledby={tabId(helpKey, view)}>
        {view === "preview" ? (
          <MarkdownPreview className="privacy-template__body" source={content} />
        ) : (
          <pre className="privacy-template__body privacy-template__body--source">{content}</pre>
        )}
      </div>

      {/* 主操作は「社内規定として登録」の1つ。コピー・ダウンロードは副操作。 */}
      <div className="btn-row privacy-template__actions">
        <button type="button" className={buttonClass("primary")} disabled={registering} onClick={handleRegister}>
          {registering ? messages.settingsPrivacy.registering : messages.settingsPrivacy.registerAsCompanyRule}
        </button>
        <button type="button" className={buttonClass("secondary")} onClick={handleCopy}>
          {copyState === "copied" ? messages.settingsPrivacy.copied : messages.settingsPrivacy.copy}
        </button>
        <button type="button" className={buttonClass("secondary")} onClick={() => downloadMarkdown(filename, content)}>
          {messages.settingsPrivacy.download}
        </button>
      </div>

      {copyState === "failed" ? <p className="notice notice--danger" role="alert">{messages.settingsPrivacy.copyFailed}</p> : null}
      {registerResult ? (
        <p className={registerResult.ok ? "notice notice--success" : "notice notice--danger"} role={registerResult.ok ? undefined : "alert"}>
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

  /**
   * 退職者データの保持年数(2026-08-27 追加、docs/design/data-retention.md)。
   * ここに置く理由: この値は雛形の「退職後の取り扱い」節に直接効く(GET /settings/privacy-templates
   * の入力の一部)ので、雛形を確認しながら決められる同じ画面にあるのが自然。
   * 実際に消去を実行できるのは別権限(`member.erase`)を持つ人で、画面もメンバー管理側。
   */
  const [retention, setRetention] = useState<DataRetentionDto | null>(null);
  const [retentionPending, setRetentionPending] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);

  async function handleRetentionChange(years: number) {
    setRetentionPending(true);
    setRetentionError(null);
    setRetentionSaved(false);
    try {
      const updated = await api.updateDataRetention(years);
      setRetention(updated);
      setRetentionSaved(true);
      // 雛形の文面に年数が入っているので、保存したら生成し直す。
      load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setRetentionError(err instanceof ApiError ? messages.settingsPrivacy.retentionSaveFailed : messages.errors.network);
    } finally {
      setRetentionPending(false);
    }
  }

  function load() {
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .getDataRetention()
      .then((res) => setRetention(res))
      // 保持年数の取得に失敗しても雛形の表示は続ける(403 は下の getPrivacyTemplates 側で拾う)。
      .catch(() => undefined);
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
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  return (
    <div className="page-shell">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="page">
        <SettingsNav active="privacy" />
        <PageHeader title={messages.settingsPrivacy.title} lead={messages.settingsPrivacy.tagline} />

        <p className="notice notice--info" role="note">
          {messages.settingsPrivacy.disclaimer}
        </p>

        {forbidden ? (
          <p className="notice notice--danger" role="alert">
            {messages.settingsPrivacy.noPermission}
          </p>
        ) : null}
        {loadError ? <StateView kind="error">{loadError}</StateView> : null}

        {!forbidden && data ? (
          <div className="page-body page-body--form">
            <section className="card privacy-template__generated-from">
              <h2 className="card__title">{messages.settingsPrivacy.generatedFromTitle}</h2>
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
              <p className="field__hint">{messages.settingsPrivacy.generatedFromNote}</p>
            </section>

            {retention ? (
              <section className="card">
                <h2 className="card__title">{messages.settingsPrivacy.retentionTitle}</h2>
                <p className="field__hint">{messages.settingsPrivacy.retentionHint}</p>
                <div className="field">
                  <label htmlFor="personal-data-retention-years">{messages.settingsPrivacy.retentionLabel}</label>
                  <select
                    id="personal-data-retention-years"
                    value={String(retention.personalDataRetentionYears)}
                    disabled={retentionPending}
                    onChange={(e) => void handleRetentionChange(Number(e.target.value))}
                  >
                    {retention.allowedYears.map((years) => (
                      <option key={years} value={years}>
                        {messages.settingsPrivacy.retentionOption(years)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="field__hint">{messages.settingsPrivacy.retentionLegalNote}</p>
                <p className="field__hint">{messages.settingsPrivacy.retentionExecutionNote}</p>
                {retentionError ? (
                  <p className="notice notice--danger" role="alert">
                    {retentionError}
                  </p>
                ) : null}
                {retentionSaved && !retentionError ? <p className="notice notice--success">{messages.settingsPrivacy.retentionSaved}</p> : null}
              </section>
            ) : null}

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
          </div>
        ) : null}
      </main>
    </div>
  );
}
