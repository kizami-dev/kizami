"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type AuditLogDto, type ListAuditLogsParams } from "../lib/api";
import { messages } from "../lib/messages";
import { dateWindowJst, formatDateTimeJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsNav } from "./SettingsNav";

/**
 * apps/api の監査ログ挿入箇所(apps/api/src/routes/*.ts の insertAuditLog 呼び出し)から
 * grep で収集した action 名の一覧(2026-08-27 時点、55種。従来コメントの「46種」は
 * その後の追加分が反映されておらず実数と食い違っていたため、この機会に数え直した)。翻訳はしない — action はコードに
 * 現れる識別子そのものであり、4言語で意味が変わるものではないため(依頼の select はこの一覧を
 * そのまま列挙すればよい、と読んだ判断点)。増減したら本配列を追従させる。
 */
const KNOWN_ACTIONS: readonly string[] = [
  "allowance_definition.create",
  "allowance_definition_version.create",
  "api_key.create",
  "api_key.revoke",
  // 多段承認(2026-08-24 追加、docs/design/approval-flows.md)。二段承認の**一次承認**は
  // 最終決裁とは別のアクションとして記録する(approve_step1) — 監査で「反映された承認」と
  // 「まだ反映されていない一次承認」を取り違えないため。
  "approval_flow_settings.update",
  // 二要素認証(2026-08-27 追加)。本人の操作(auth.totp.*)と、管理者による強制解除
  // (member.totp.reset)は別アクションとして記録される。
  "auth.totp.disable",
  "auth.totp.enable",
  "auth.totp.recovery_codes.regenerate",
  "auto_break_waiver.approve",
  "auto_break_waiver.approve_step1",
  "auto_break_waiver.reject",
  "closing.amend",
  "closing.close",
  "closing.reopen",
  "correction.approve",
  "correction.approve_step1",
  "correction.reject",
  "department.create",
  "department.delete",
  "department.update",
  "export.attendance",
  "help_override.delete",
  "help_override.update",
  "leave_grant.auto_create",
  "leave_grant.convert_expired",
  "leave_grant.manual_create",
  "leave_grant_proposal.approve",
  "leave_grant_proposal.reject",
  "leave_request.approve",
  "leave_request.approve_step1",
  "leave_request.reject",
  "leave_settings.update",
  "member.deactivate",
  "member.invite",
  "member.invite.reissue",
  "member.invite.revoke",
  "member.password_reset.issue",
  "member.password_reset.revoke",
  "member.reactivate",
  "member.totp.reset",
  "member.update",
  "member.work_policy.assign",
  "notification_settings.test",
  "notification_settings.update",
  "permission_assignment.update",
  "permission_preset.create",
  "permission_preset.delete",
  "permission_preset.update",
  "privacy_contact.update",
  "slack_link.create",
  "slack_settings.update",
  "tenant_profile.update",
  "tenant_setting_version.create",
  "work_policy_version.create",
  "work_rules_url.update",
];

/** "YYYY-MM-DD" の簡易バリデーション(input type="date" の値をそのまま受ける)。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface AppliedFilters {
  action: string;
  actorId: string;
  fromDate: string;
  toDate: string;
}

const EMPTY_FILTERS: AppliedFilters = { action: "", actorId: "", fromDate: "", toDate: "" };

/** AppliedFilters → GET /audit-logs のクエリパラメータ(cursor/limit を除く)。 */
function toParams(filters: AppliedFilters): Omit<ListAuditLogsParams, "cursor" | "limit"> {
  const params: Omit<ListAuditLogsParams, "cursor" | "limit"> = {};
  if (filters.action !== "") params.action = filters.action;
  if (filters.actorId.trim() !== "") params.actorId = filters.actorId.trim();
  if (filters.fromDate !== "" && DATE_RE.test(filters.fromDate)) params.from = dateWindowJst(filters.fromDate).from;
  if (filters.toDate !== "" && DATE_RE.test(filters.toDate)) params.to = dateWindowJst(filters.toDate).to;
  return params;
}

/** JSON文字列を整形する。パースできなければ元の文字列をそのまま返す(壊れたJSONでも表示は続ける)。 */
function formatDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

/**
 * 監査ログ閲覧(/settings/audit-logs、Tier 1 新設)。読み取り専用 — 編集・削除のUIは無い
 * (punch_events と同じ、不可変な追記専用ログ)。
 *
 * フィルタの「操作者」は現状 userId の直接入力にした(判断点、完了報告に明記): audit_log.view
 * のスコープ(自部署/自部署+配下/テナント全体)は attendance.record.view のスコープとは別物で、
 * GET /attendance/members のメンバー一覧をそのまま流用すると実際に閲覧可能な操作者集合と
 * 一致しない可能性がある。GET /members(部署管理向け)も member.view 権限が別途要るため、
 * audit_log.view だけを持つ閲覧者に必ず使えるとは限らない。テーブルに actorName が出るため、
 * 名前→ID の特定は一覧を見ながら行える。
 */
export function AuditLogsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [rangeError, setRangeError] = useState<string | null>(null);

  function load(filters: AppliedFilters) {
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .listAuditLogs({ ...toParams(filters), limit: 50 })
      .then((res) => {
        setLogs(res.logs);
        setNextCursor(res.nextCursor);
        setLoaded(true);
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
        setLoadError(messages.settingsAuditLogs.loadFailed);
      })
      .finally(() => setLoading(false));
  }

  // 認証確定後の初回読み込み(1回だけ)。フィルタ適用時は handleApply が明示的に再読込する。
  useEffect(() => {
    if (guard.status !== "authed") return;
    load(EMPTY_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (draft.fromDate !== "" && draft.toDate !== "" && draft.toDate < draft.fromDate) {
      setRangeError(messages.settingsAuditLogs.filterInvalidRange);
      return;
    }
    setRangeError(null);
    setApplied(draft);
    load(draft);
  }

  function handleClear() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setRangeError(null);
    load(EMPTY_FILTERS);
  }

  function handleLoadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    api
      .listAuditLogs({ ...toParams(applied), cursor: nextCursor, limit: 50 })
      .then((res) => {
        setLogs((prev) => [...prev, ...res.logs]);
        setNextCursor(res.nextCursor);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setLoadError(messages.settingsAuditLogs.loadMoreFailed);
      })
      .finally(() => setLoadingMore(false));
  }

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main audit-logs__main">
        <SettingsNav active="auditLogs" />
        <h1 className="settings-notif__title">{messages.settingsAuditLogs.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsAuditLogs.tagline}</p>
        <p className="audit-logs__immutable-note">{messages.settingsAuditLogs.immutableNote}</p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsAuditLogs.forbidden}
          </p>
        ) : (
          <>
            <form className="audit-logs__filters" onSubmit={handleApply}>
              <div className="correction-field">
                <label htmlFor="audit-logs-action">{messages.settingsAuditLogs.filterActionLabel}</label>
                <select
                  id="audit-logs-action"
                  value={draft.action}
                  onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                >
                  <option value="">{messages.settingsAuditLogs.filterActionAll}</option>
                  {KNOWN_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div className="correction-field">
                <label htmlFor="audit-logs-actor">{messages.settingsAuditLogs.filterActorLabel}</label>
                <input
                  id="audit-logs-actor"
                  type="text"
                  placeholder={messages.settingsAuditLogs.filterActorPlaceholder}
                  value={draft.actorId}
                  onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
                />
              </div>

              <div className="correction-field-row">
                <div className="correction-field">
                  <label htmlFor="audit-logs-from">{messages.settingsAuditLogs.filterFromLabel}</label>
                  <input
                    id="audit-logs-from"
                    type="date"
                    value={draft.fromDate}
                    onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
                  />
                </div>
                <div className="correction-field">
                  <label htmlFor="audit-logs-to">{messages.settingsAuditLogs.filterToLabel}</label>
                  <input
                    id="audit-logs-to"
                    type="date"
                    value={draft.toDate}
                    onChange={(e) => setDraft({ ...draft, toDate: e.target.value })}
                  />
                </div>
              </div>

              {rangeError ? (
                <p className="correction-error" role="alert">
                  {rangeError}
                </p>
              ) : null}

              <div className="settings-notif__actions">
                <button type="submit" className="k-modal__confirm k-modal__confirm--neutral">
                  {messages.settingsAuditLogs.filterApply}
                </button>
                <button type="button" className="k-modal__cancel" onClick={handleClear}>
                  {messages.settingsAuditLogs.filterClear}
                </button>
              </div>
            </form>

            {loading ? <p className="monthly-loading">{messages.loading}</p> : null}
            {loadError ? <p className="monthly-error">{loadError}</p> : null}

            {!loading && loaded ? (
              logs.length === 0 ? (
                <p className="org-settings__empty">{messages.settingsAuditLogs.empty}</p>
              ) : (
                <>
                  <div className="org-settings__table-wrap">
                    <table className="org-table">
                      <thead>
                        <tr>
                          <th>{messages.settingsAuditLogs.columnOccurredAt}</th>
                          <th>{messages.settingsAuditLogs.columnActor}</th>
                          <th>{messages.settingsAuditLogs.columnAction}</th>
                          <th>{messages.settingsAuditLogs.columnTarget}</th>
                          <th>{messages.settingsAuditLogs.columnDetail}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log) => (
                          <tr key={log.id}>
                            <td className="org-table__muted tabular-nums">{formatDateTimeJst(log.occurredAt)}</td>
                            <td>
                              <div>{log.actorName}</div>
                              <div className="org-table__muted">{log.actorId}</div>
                            </td>
                            <td>
                              <code>{log.action}</code>
                            </td>
                            <td>
                              <div>{log.targetType}</div>
                              {log.targetId !== "" ? <div className="org-table__muted">{log.targetId}</div> : null}
                            </td>
                            <td>
                              {log.detail === null ? (
                                <span className="org-table__muted">{messages.settingsAuditLogs.detailUnavailable}</span>
                              ) : (
                                <details className="audit-logs__detail">
                                  <summary>{messages.settingsAuditLogs.detailToggle}</summary>
                                  <pre className="audit-logs__detail-json">{formatDetail(log.detail)}</pre>
                                </details>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {nextCursor !== null ? (
                    <div className="settings-notif__actions">
                      <button type="button" className="k-modal__cancel" onClick={handleLoadMore} disabled={loadingMore}>
                        {loadingMore ? messages.settingsAuditLogs.loadingMore : messages.settingsAuditLogs.loadMore}
                      </button>
                    </div>
                  ) : null}
                </>
              )
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
