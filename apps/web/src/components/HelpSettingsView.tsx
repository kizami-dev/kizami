"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type HelpOverridesDto } from "../lib/api";
import { helpEntries, helpEntry, helpNotice, type HelpEntry, type HelpKey } from "../lib/help";
import { mapHelpSettingsErrorMessage, messages } from "../lib/messages";
import { invalidateHelpOverridesCache } from "../lib/useHelpOverrides";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsNav } from "./SettingsNav";
import { StateView } from "./ui/StateView";
import { PageHeader } from "./ui/PageHeader";
import { Badge } from "./ui/Badge";

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
  /** 左の一覧の絞り込み語と、折りたたみの開閉(キーは「audience-origin」。未指定は閉じる)。 */
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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

  // helpEntries() は現在の UI ロケールのヘルプ本文を返す(訳文が無いキーは日本語。lib/help.ts 参照)。
  // 依存配列が空でよいのは、言語切替時に LocaleGate が子ツリーごと再マウントするため
  // (lib/i18n/index.ts のコメント参照) — この useMemo もそこで作り直される。
  const grouped = useMemo(() => groupEntries(helpEntries()), []);

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

  // 開いた直後に右ペインが空にならないよう、最初の項目を選んで開く(その項目のグループも開く)。
  useEffect(() => {
    if (!data || selectedKey !== null) return;
    const first = [grouped.employee.law, grouped.employee.product, grouped.admin.law, grouped.admin.product].find((l) => l.length > 0)?.[0];
    if (!first) return;
    const groupKey = grouped.employee.law[0] === first ? "employee-law" : grouped.employee.product[0] === first ? "employee-product" : grouped.admin.law[0] === first ? "admin-law" : "admin-product";
    setOpenGroups((prev) => ({ ...prev, [groupKey]: true }));
    setSelectedKey(first.key);
    setBodyDraft(data.overrides[first.key]?.bodyMd ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  const selectedEntry = selectedKey ? helpEntry(selectedKey) : null;
  const translationNotice = helpNotice();

  const needle = query.trim().toLowerCase();
  function matches(entry: HelpEntry): boolean {
    return needle === "" || firstHeading(entry.body).toLowerCase().includes(needle) || entry.key.toLowerCase().includes(needle);
  }

  function renderList(audienceKey: "employee" | "admin", title: string, entries: { law: HelpEntry[]; product: HelpEntry[] }) {
    const visible = { law: entries.law.filter(matches), product: entries.product.filter(matches) };
    if (visible.law.length === 0 && visible.product.length === 0) return null;
    return (
      <div className="help-settings__list-group">
        <h3 className="help-settings__list-group-title">{title}</h3>
        {(["law", "product"] as const).map((origin) => {
          if (visible[origin].length === 0) return null;
          const groupKey = `${audienceKey}-${origin}`;
          // 絞り込み中は一致した項目が見えるよう全部開く。
          const open = needle !== "" || Boolean(openGroups[groupKey]);
          return (
            <details key={origin} className="help-settings__list-subgroup" open={open}>
              <summary
                className="help-settings__list-subgroup-title"
                onClick={(e) => {
                  e.preventDefault();
                  setOpenGroups((prev) => ({ ...prev, [groupKey]: !open }));
                }}
              >
                {originLabel(origin)}
                <span className="help-settings__list-count tabular-nums">{visible[origin].length}</span>
              </summary>
              <ul className="help-settings__list">
                {visible[origin].map((entry) => {
                  const hasOverride = Boolean(data?.overrides[entry.key]);
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        className={`help-settings__list-item${selectedKey === entry.key ? " help-settings__list-item--active" : ""}`}
                        onClick={() => selectKey(entry.key)}
                      >
                        <span>{firstHeading(entry.body)}</span>
                        {hasOverride ? <Badge tone="neutral" className="badge--dashed">
                            {messages.settingsHelp.hasOverrideBadge}
                          </Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>
    );
  }

  return (
    <div className="page-shell">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="page">
        <SettingsNav active="help" />
        <PageHeader title={messages.settingsHelp.title} lead={messages.settingsHelp.tagline} />

        {forbidden ? (
          <p className="notice notice--danger" role="alert">
            {messages.settingsHelp.noPermission}
          </p>
        ) : null}
        {loadError ? <StateView kind="error">{loadError}</StateView> : null}

        {!forbidden && data ? (
          <>
            <section className="card help-settings__guidelines">
              <h2 className="card__title">{messages.settingsHelp.guidelinesTitle}</h2>
              <ol className="help-settings__guideline-list">
                <li>{messages.settingsHelp.guideline1}</li>
                <li>{messages.settingsHelp.guideline2}</li>
                <li>{messages.settingsHelp.guideline3}</li>
              </ol>
            </section>

            <section className="card">
              <h2 className="card__title">{messages.settingsHelp.workRulesSectionTitle}</h2>
              <p className="field__hint">{messages.settingsHelp.workRulesDesc}</p>
              <form className="page-body page-body--form" onSubmit={handleWorkRulesSave}>
                <div className="field">
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
                  <p className="notice notice--danger" role="alert">
                    {workRulesError}
                  </p>
                ) : null}
                {workRulesSuccess ? <p className="notice notice--success">{messages.settingsHelp.workRulesSaveSuccess}</p> : null}
                <div className="btn-row">
                  <button type="submit" className="btn btn--primary" disabled={workRulesSaving}>
                    {workRulesSaving ? messages.settingsHelp.workRulesSaving : messages.settingsHelp.workRulesSave}
                  </button>
                </div>
              </form>
            </section>

            <div className="help-settings__grid">
              <div className="help-settings__list-panel">
                <h2 className="card__title">{messages.settingsHelp.listTitle}</h2>
                <div className="field">
                  <label htmlFor="help-search" className="visually-hidden">
                    {messages.settingsHelp.searchLabel}
                  </label>
                  <input
                    id="help-search"
                    type="search"
                    placeholder={messages.settingsHelp.searchPlaceholder}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {renderList("employee", messages.settingsHelp.listEmployeeGroup, grouped.employee)}
                {renderList("admin", messages.settingsHelp.listAdminGroup, grouped.admin)}
                {needle !== "" &&
                [grouped.employee.law, grouped.employee.product, grouped.admin.law, grouped.admin.product].every((l) => l.filter(matches).length === 0) ? (
                  <p className="field__hint">{messages.settingsHelp.searchNoResults}</p>
                ) : null}
              </div>

              <div className="help-settings__editor-panel">
                {!selectedEntry || !selectedKey ? (
                  <p className="field__hint">{messages.settingsHelp.selectPrompt}</p>
                ) : (
                  <>
                    <section className="help-settings__reference">
                      <h2 className="card__title">{messages.settingsHelp.referenceTitle}</h2>
                      <Badge tone={selectedEntry.origin === "law" ? "key" : "neutral"} className="help-tip__badge">
                        {selectedEntry.origin === "law" && selectedEntry.basis
                          ? `${originLabel("law")} · ${selectedEntry.basis}`
                          : originLabel(selectedEntry.origin)}
                      </Badge>
                      <p className="help-settings__reference-summary">{selectedEntry.summary}</p>
                      {translationNotice ? <p className="help-tip__notice">{translationNotice}</p> : null}
                    </section>

                    <form className="page-body page-body--form" onSubmit={handleSave}>
                      <section className="card">
                        <h2 className="card__title">
                          {messages.settingsHelp.editorTitle}
                          <Badge tone="neutral" className="help-tip__badge badge--dashed">
                            {messages.settingsNav.help}
                          </Badge>
                        </h2>
                        <p className="field__hint">{messages.settingsHelp.editorPlaceholderNote}</p>
                        <div className="field">
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
                        {bodyDraft.trim() === "" ? <p className="field__hint">{messages.settingsHelp.empty}</p> : null}

                        {saveError ? (
                          <p className="notice notice--danger" role="alert">
                            {saveError}
                          </p>
                        ) : null}
                        {saveSuccess ? <p className="notice notice--success">{messages.settingsHelp.saveSuccess}</p> : null}

                        <div className="btn-row">
                          <button type="submit" className="btn btn--primary" disabled={saving}>
                            {saving ? messages.settingsHelp.saving : messages.settingsHelp.save}
                          </button>
                          {data.overrides[selectedKey] ? (
                            <button
                              type="button"
                              className="btn btn--danger-ghost"
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
