"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type HelpOverridesDto } from "../lib/api";
import { HELP, type HelpEntry, type HelpKey } from "../lib/help";
import { mapHelpSettingsErrorMessage, messages } from "../lib/messages";
import { invalidateHelpOverridesCache } from "../lib/useHelpOverrides";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsNav } from "./SettingsNav";

// モジュールレベルで messages のプロパティを取り出して定数化すると、import 時の言語
// (通常は既定の日本語)で凍結され、言語切替に追従しない(messages は Proxy 経由で現在ロケールを
// 返すが、取り出した先のオブジェクトはただの値のため)。SettingsAttendanceView の weekdayLabel と
// 同じく、描画時に毎回引く関数にする(2026-08-23、ApiKeysSettingsView 実装時に発見された同型バグの修正)。
function originLabel(origin: HelpEntry["origin"]): string {
  return {
    law: messages.settingsHelp.originLaw,
    product: messages.settingsHelp.originProduct,
    company: messages.settingsHelp.originLaw, // 組み込み HELP には company は含まれないため到達しない
  }[origin];
}

/**
 * ヘルプキーの一覧を audience(従業員向け/労務担当者向け)→ origin(法令/KIZAMIの仕様)の
 * 2段階でグループ分けする(依頼「audience と origin でグループ分けすると探しやすい」)。
 * 両方の audience を持つキーは両方のグループに出す(packages/help-content/README.md の方針どおり)。
 */
function groupEntries(entries: HelpEntry[]) {
  function byOrigin(list: HelpEntry[]) {
    const law = list.filter((e) => e.origin === "law").sort((a, b) => a.key.localeCompare(b.key));
    const product = list.filter((e) => e.origin === "product").sort((a, b) => a.key.localeCompare(b.key));
    return { law, product };
  }
  return {
    employee: byOrigin(entries.filter((e) => e.audience.includes("employee"))),
    admin: byOrigin(entries.filter((e) => e.audience.includes("admin"))),
  };
}

function firstHeading(body: string): string {
  const m = /^#\s+(.+)$/m.exec(body);
  return m?.[1] ?? body.slice(0, 24);
}

/**
 * 社内規定の編集画面(/settings/help、2026-08-22 追加)。
 *
 * - 左: 組み込みヘルプキーの一覧(audience×originでグループ分け)。自社の規定が既にある
 *   キーには「追記あり」バッジを付ける
 * - 右: 選んだキーの組み込みの説明(法令/KIZAMIの仕様)を横に置きながら、自社の規定を
 *   Markdown で編集できるフォーム。companyExample をプレースホルダとして薄く表示する
 * - ガイドライン(ui-direction.md の3原則)を画面上に常時表示する
 * - 就業規則URLの設定もこの画面に置く
 */
export function HelpSettingsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [data, setData] = useState<HelpOverridesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<HelpKey | null>(null);
  const [bodyDraft, setBodyDraft] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [workRulesUrlDraft, setWorkRulesUrlDraft] = useState("");
  const [workRulesSaving, setWorkRulesSaving] = useState(false);
  const [workRulesError, setWorkRulesError] = useState<string | null>(null);
  const [workRulesSuccess, setWorkRulesSuccess] = useState(false);

  const grouped = useMemo(() => groupEntries(Object.values(HELP)), []);

  function load() {
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    return api
      .getHelpOverrides()
      .then((res) => {
        setData(res);
        setWorkRulesUrlDraft(res.workRulesUrl ?? "");
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError(err instanceof ApiError ? messages.settingsHelp.loadFailed : messages.errors.network);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (guard.status !== "authed") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  function selectKey(key: HelpKey) {
    setSelectedKey(key);
    setBodyDraft(data?.overrides[key]?.bodyMd ?? "");
    setSaveError(null);
    setSaveSuccess(false);
    setDeleteError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedKey) return;
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      await api.updateHelpOverride(selectedKey, bodyDraft);
      invalidateHelpOverridesCache();
      const refreshed = await api.getHelpOverrides();
      setData(refreshed);
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapHelpSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!selectedKey) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteHelpOverride(selectedKey);
      invalidateHelpOverridesCache();
      const refreshed = await api.getHelpOverrides();
      setData(refreshed);
      setBodyDraft("");
      setDeleteConfirmOpen(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setDeleteError(err instanceof ApiError ? mapHelpSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setDeleting(false);
    }
  }

  async function handleWorkRulesSave(e: React.FormEvent) {
    e.preventDefault();
    setWorkRulesError(null);
    setWorkRulesSuccess(false);
    setWorkRulesSaving(true);
    try {
      const res = await api.updateWorkRulesUrl(workRulesUrlDraft);
      invalidateHelpOverridesCache();
      setData((prev) => (prev ? { ...prev, workRulesUrl: res.workRulesUrl } : prev));
      setWorkRulesUrlDraft(res.workRulesUrl ?? "");
      setWorkRulesSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setWorkRulesError(err instanceof ApiError ? mapHelpSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setWorkRulesSaving(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const selectedEntry = selectedKey ? HELP[selectedKey] : null;

  function renderList(title: string, entries: { law: HelpEntry[]; product: HelpEntry[] }) {
    if (entries.law.length === 0 && entries.product.length === 0) return null;
    return (
      <div className="help-settings__list-group">
        <h3 className="help-settings__list-group-title">{title}</h3>
        {(["law", "product"] as const).map((origin) =>
          entries[origin].length === 0 ? null : (
            <div key={origin} className="help-settings__list-subgroup">
              <span className="help-settings__list-subgroup-title">{originLabel(origin)}</span>
              <ul className="help-settings__list">
                {entries[origin].map((entry) => {
                  const hasOverride = Boolean(data?.overrides[entry.key]);
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        className={`help-settings__list-item${selectedKey === entry.key ? " help-settings__list-item--active" : ""}`}
                        onClick={() => selectKey(entry.key)}
                      >
                        <span>{firstHeading(entry.body)}</span>
                        {hasOverride ? <span className="help-settings__badge-mini">{messages.settingsHelp.hasOverrideBadge}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main help-settings__main">
        <SettingsNav active="help" />
        <h1 className="settings-notif__title">{messages.settingsHelp.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsHelp.tagline}</p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsHelp.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && data ? (
          <>
            <section className="settings-notif__section help-settings__guidelines">
              <h2 className="settings-notif__section-title">{messages.settingsHelp.guidelinesTitle}</h2>
              <ol className="help-settings__guideline-list">
                <li>{messages.settingsHelp.guideline1}</li>
                <li>{messages.settingsHelp.guideline2}</li>
                <li>{messages.settingsHelp.guideline3}</li>
              </ol>
            </section>

            <section className="settings-notif__section">
              <h2 className="settings-notif__section-title">{messages.settingsHelp.workRulesSectionTitle}</h2>
              <p className="settings-notif__field-hint">{messages.settingsHelp.workRulesDesc}</p>
              <form className="settings-notif__form" onSubmit={handleWorkRulesSave}>
                <div className="correction-field">
                  <label htmlFor="work-rules-url">{messages.settingsHelp.workRulesUrlLabel}</label>
                  <input
                    id="work-rules-url"
                    type="url"
                    placeholder={messages.settingsHelp.workRulesUrlPlaceholder}
                    value={workRulesUrlDraft}
                    onChange={(e) => setWorkRulesUrlDraft(e.target.value)}
                  />
                </div>
                {workRulesError ? (
                  <p className="correction-error" role="alert">
                    {workRulesError}
                  </p>
                ) : null}
                {workRulesSuccess ? <p className="settings-notif__success">{messages.settingsHelp.workRulesSaveSuccess}</p> : null}
                <div className="settings-notif__actions">
                  <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={workRulesSaving}>
                    {workRulesSaving ? messages.settingsHelp.workRulesSaving : messages.settingsHelp.workRulesSave}
                  </button>
                </div>
              </form>
            </section>

            <div className="help-settings__grid">
              <div className="help-settings__list-panel">
                <h2 className="settings-notif__section-title">{messages.settingsHelp.listTitle}</h2>
                {renderList(messages.settingsHelp.listEmployeeGroup, grouped.employee)}
                {renderList(messages.settingsHelp.listAdminGroup, grouped.admin)}
              </div>

              <div className="help-settings__editor-panel">
                {!selectedEntry || !selectedKey ? (
                  <p className="settings-notif__field-hint">{messages.settingsHelp.selectPrompt}</p>
                ) : (
                  <>
                    <section className="help-settings__reference">
                      <h2 className="settings-notif__section-title">{messages.settingsHelp.referenceTitle}</h2>
                      <span className={`help-tip__badge help-tip__badge--${selectedEntry.origin}`}>
                        {selectedEntry.origin === "law" && selectedEntry.basis
                          ? `${originLabel("law")} · ${selectedEntry.basis}`
                          : originLabel(selectedEntry.origin)}
                      </span>
                      <p className="help-settings__reference-summary">{selectedEntry.summary}</p>
                    </section>

                    <form className="settings-notif__form" onSubmit={handleSave}>
                      <section className="settings-notif__section">
                        <h2 className="settings-notif__section-title">
                          {messages.settingsHelp.editorTitle}
                          <span className="help-tip__badge help-tip__badge--company">{messages.settingsNav.help}</span>
                        </h2>
                        <p className="settings-notif__field-hint">{messages.settingsHelp.editorPlaceholderNote}</p>
                        <div className="correction-field">
                          <label htmlFor="help-body-md">{messages.settingsHelp.bodyLabel}</label>
                          <textarea
                            id="help-body-md"
                            className="help-settings__textarea"
                            rows={10}
                            value={bodyDraft}
                            placeholder={selectedEntry.companyExample ?? ""}
                            onChange={(e) => setBodyDraft(e.target.value)}
                          />
                        </div>
                        {bodyDraft.trim() === "" ? <p className="settings-notif__field-hint">{messages.settingsHelp.empty}</p> : null}

                        {saveError ? (
                          <p className="correction-error" role="alert">
                            {saveError}
                          </p>
                        ) : null}
                        {saveSuccess ? <p className="settings-notif__success">{messages.settingsHelp.saveSuccess}</p> : null}

                        <div className="settings-notif__actions">
                          <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                            {saving ? messages.settingsHelp.saving : messages.settingsHelp.save}
                          </button>
                          {data.overrides[selectedKey] ? (
                            <button
                              type="button"
                              className="k-modal__confirm k-modal__confirm--caution"
                              disabled={saving}
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteConfirmOpen(true);
                              }}
                            >
                              {messages.settingsHelp.delete}
                            </button>
                          ) : null}
                        </div>
                      </section>
                    </form>
                  </>
                )}
              </div>
            </div>
          </>
        ) : null}
      </main>

      {deleteConfirmOpen ? (
        <ConfirmDialog
          title={messages.settingsHelp.deleteConfirmTitle}
          message={messages.settingsHelp.deleteConfirmMessage}
          confirmLabel={messages.settingsHelp.delete}
          tone="caution"
          note=""
          pending={deleting}
          error={deleteError}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setDeleteConfirmOpen(false);
            setDeleteError(null);
          }}
        />
      ) : null}
    </div>
  );
}
