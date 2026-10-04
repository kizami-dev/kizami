"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type ApiKeyDto, type ApiKeyScope, type IssuedApiKeyDto } from "../lib/api";
import { mapApiKeysErrorMessage, messages } from "../lib/messages";
import { formatDateTimeJst, toEpochMinutesJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsNav } from "./SettingsNav";
import { StateView } from "./ui/StateView";
import { PageHeader } from "./ui/PageHeader";

// SCOPE_OPTIONS/STATUS_LABEL をモジュールレベルの配列/オブジェクトとして持つと、import 時の言語
// (通常は既定の日本語)で messages のプロパティが凍結され、言語切替に追従しない(messages は
// Proxy 経由で現在ロケールを返すが、取り出した先の値はただの文字列のため)。SettingsAttendanceView の
// weekdayLabel と同じく、描画時に毎回引く関数にする(2026-08-23、凍結バグの修正)。
function scopeOptions(): { value: ApiKeyScope; label: string }[] {
  return [
    { value: "punch", label: messages.settingsApiKeys.scopePunch },
    { value: "read", label: messages.settingsApiKeys.scopeRead },
  ];
}

function statusOf(key: ApiKeyDto, nowMinutes: number): "active" | "revoked" | "expired" {
  if (key.revokedAt !== null) return "revoked";
  if (key.expiresAt !== null && key.expiresAt <= nowMinutes) return "expired";
  return "active";
}

function statusLabel(status: "active" | "revoked" | "expired"): string {
  return {
    active: messages.settingsApiKeys.statusActive,
    revoked: messages.settingsApiKeys.statusRevoked,
    expired: messages.settingsApiKeys.statusExpired,
  }[status];
}

/**
 * 公開打刻APIキーの管理画面(/settings/api-keys、v0.4 追加)。
 *
 * 権限不要(自分のキーは誰でも発行・一覧・失効できる、依頼「自分用なので権限不要」)。
 * - 発行フォーム(名前・スコープ・任意の有効期限)
 * - 発行直後だけ平文トークンを表示する専用パネル(以後は二度と取得できない旨を明示)
 * - 一覧(名前・スコープ・作成日・最終使用・期限・状態)+ 失効ボタン(ConfirmDialog)
 * - 使い方の例(curl)
 */
export function ApiKeysSettingsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [keys, setKeys] = useState<ApiKeyDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [nameDraft, setNameDraft] = useState("");
  const [scopeDraft, setScopeDraft] = useState<Set<ApiKeyScope>>(new Set());
  const [expiresDraft, setExpiresDraft] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [justIssued, setJustIssued] = useState<IssuedApiKeyDto | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    return api
      .listApiKeys()
      .then((res) => setKeys(res.apiKeys))
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setLoadError(err instanceof ApiError ? messages.settingsApiKeys.loadFailed : messages.errors.network);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (guard.status !== "authed") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  function toggleScope(scope: ApiKeyScope) {
    setScopeDraft((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    setIssueError(null);

    if (nameDraft.trim() === "") {
      setIssueError(messages.settingsApiKeys.errors.invalid_name);
      return;
    }
    if (scopeDraft.size === 0) {
      setIssueError(messages.settingsApiKeys.errors.invalid_scopes);
      return;
    }
    let expiresAt: number | null = null;
    if (expiresDraft !== "") {
      // 選択した日の JST 23:59 を有効期限にする(「その日いっぱいは使える」という直感に合わせる)。
      expiresAt = toEpochMinutesJst(expiresDraft, "23:59");
      if (expiresAt === null) {
        setIssueError(messages.settingsApiKeys.errors.invalid_expires_at);
        return;
      }
    }

    setIssuing(true);
    try {
      const res = await api.createApiKey({ name: nameDraft.trim(), scopes: [...scopeDraft], expiresAt });
      setJustIssued(res.apiKey);
      setCopyState("idle");
      setNameDraft("");
      setScopeDraft(new Set());
      setExpiresDraft("");
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setIssueError(err instanceof ApiError ? mapApiKeysErrorMessage(err.body) : messages.errors.network);
    } finally {
      setIssuing(false);
    }
  }

  async function handleCopyToken() {
    if (!justIssued) return;
    try {
      await navigator.clipboard.writeText(justIssued.token);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function handleRevokeConfirm() {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await api.revokeApiKey(revokeTarget.id);
      setRevokeTarget(null);
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setRevokeError(err instanceof ApiError ? mapApiKeysErrorMessage(err.body) : messages.errors.network);
    } finally {
      setRevoking(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  const nowMin = Math.floor(Date.now() / 60_000);

  return (
    <div className="page-shell">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="page">
        <SettingsNav active="apiKeys" />
        <PageHeader title={messages.settingsApiKeys.title} lead={messages.settingsApiKeys.tagline} />

        {loadError ? <StateView kind="error">{loadError}</StateView> : null}

        {justIssued ? (
          <section className="api-keys__reveal" aria-live="polite">
            <h2 className="card__title">{messages.settingsApiKeys.createdTitle}</h2>
            <p className="api-keys__reveal-warning">{messages.settingsApiKeys.createdWarning}</p>
            <div className="field">
              <label htmlFor="api-key-token">{messages.settingsApiKeys.createdTokenLabel}</label>
              <div className="api-keys__token-row">
                <code id="api-key-token" className="api-keys__token">
                  {justIssued.token}
                </code>
                <button type="button" className="btn btn--primary" onClick={handleCopyToken}>
                  {copyState === "copied" ? messages.settingsApiKeys.copied : messages.settingsApiKeys.copy}
                </button>
              </div>
              {copyState === "failed" ? (
                <p className="notice notice--danger" role="alert">
                  {messages.settingsApiKeys.copyFailed}
                </p>
              ) : null}
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn--primary" onClick={() => setJustIssued(null)}>
                {messages.settingsApiKeys.createdDone}
              </button>
            </div>
          </section>
        ) : null}

        <section className="card">
          <h2 className="card__title">{messages.settingsApiKeys.createTitle}</h2>
          <form className="page-body page-body--form" onSubmit={handleIssue}>
            <div className="field">
              <label htmlFor="api-key-name">{messages.settingsApiKeys.nameLabel}</label>
              <input
                id="api-key-name"
                type="text"
                maxLength={100}
                placeholder={messages.settingsApiKeys.namePlaceholder}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
              />
            </div>

            <div className="field">
              <span>{messages.settingsApiKeys.scopesLabel}</span>
              <ul className="preset-checkbox-list">
                {scopeOptions().map((opt) => (
                  <li key={opt.value} className="preset-checkbox-list__item">
                    <label>
                      <input type="checkbox" checked={scopeDraft.has(opt.value)} onChange={() => toggleScope(opt.value)} />
                      {opt.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="field">
              <label htmlFor="api-key-expires">{messages.settingsApiKeys.expiresLabel}</label>
              <input id="api-key-expires" type="date" value={expiresDraft} onChange={(e) => setExpiresDraft(e.target.value)} />
              <p className="field__hint">{messages.settingsApiKeys.expiresHint}</p>
            </div>

            {issueError ? (
              <p className="notice notice--danger" role="alert">
                {issueError}
              </p>
            ) : null}

            <div className="btn-row">
              <button type="submit" className="btn btn--primary" disabled={issuing}>
                {issuing ? messages.settingsApiKeys.issuing : messages.settingsApiKeys.issue}
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <h2 className="card__title">{messages.settingsApiKeys.listTitle}</h2>
          {!keys || keys.length === 0 ? (
            <StateView kind="empty">{messages.settingsApiKeys.empty}</StateView>
          ) : (
            <div className="org-settings__table-wrap">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>{messages.settingsApiKeys.columnName}</th>
                    <th>{messages.settingsApiKeys.columnScopes}</th>
                    <th>{messages.settingsApiKeys.columnCreated}</th>
                    <th>{messages.settingsApiKeys.columnLastUsed}</th>
                    <th>{messages.settingsApiKeys.columnExpires}</th>
                    <th>{messages.settingsApiKeys.columnStatus}</th>
                    <th>{messages.settingsApiKeys.columnActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => {
                    const status = statusOf(key, nowMin);
                    return (
                      <tr key={key.id}>
                        <td>{key.name}</td>
                        <td>
                          <div className="api-keys__scopes">
                            {key.scopes.map((s) => (
                              <span key={s} className="badge badge--scope">
                                {s}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="org-table__muted">{formatDateTimeJst(key.createdAt)}</td>
                        <td className="org-table__muted">
                          {key.lastUsedAt === null ? messages.settingsApiKeys.neverUsed : formatDateTimeJst(key.lastUsedAt)}
                        </td>
                        <td className="org-table__muted">
                          {key.expiresAt === null ? messages.settingsApiKeys.noExpiry : formatDateTimeJst(key.expiresAt)}
                        </td>
                        <td>
                          <span className={`badge ${status === "active" ? "badge--cyan" : "badge--neutral"}`}>{statusLabel(status)}</span>
                        </td>
                        <td>
                          {status === "active" ? (
                            <button
                              type="button"
                              className="org-table__link-btn org-table__link-btn--danger"
                              onClick={() => {
                                setRevokeError(null);
                                setRevokeTarget(key);
                              }}
                            >
                              {messages.settingsApiKeys.revoke}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">{messages.settingsApiKeys.usageExampleTitle}</h2>
          <p className="field__hint">{messages.settingsApiKeys.usageExampleDesc}</p>
          <div className="api-keys__usage-example">
            <pre>{`${messages.settingsApiKeys.usageExampleCurlComment}
curl -X POST https://<your-kizami-host>/api/punches \\
  -H "Authorization: Bearer kzm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"clock_in"}'`}</pre>
          </div>
        </section>
      </main>

      {revokeTarget ? (
        <ConfirmDialog
          title={messages.settingsApiKeys.revokeConfirmTitle}
          message={messages.settingsApiKeys.revokeConfirmMessage}
          confirmLabel={messages.settingsApiKeys.revoke}
          tone="caution"
          note=""
          pending={revoking}
          error={revokeError}
          onConfirm={handleRevokeConfirm}
          onCancel={() => {
            setRevokeTarget(null);
            setRevokeError(null);
          }}
        />
      ) : null}
    </div>
  );
}
