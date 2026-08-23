"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "waku";
import type { Unstable_RouteHref as RouteHref } from "waku/router/client";
import { api, ApiError, UnauthorizedError, type NotificationDto } from "../lib/api";
import { messages } from "../lib/messages";
import { categorizeNotificationType, type NotificationCategory } from "../lib/notifications";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { NotificationListItem } from "./NotificationListItem";

/** GET /notifications が実際に返す最大件数(apps/api/src/routes/notifications.ts の MAX_LIST_LIMIT)。
 * APIはページングパラメータを持たないため、この件数に達したら「古い通知は表示されません」と
 * 明示する形で打ち止めにする(APIの変更は行わない、という依頼を踏まえた判断)。 */
const MAX_LIST_LIMIT = 100;

type StatusFilter = "all" | "unread";
type TypeFilter = "all" | NotificationCategory;

const TYPE_FILTERS: { value: TypeFilter; label: () => string }[] = [
  { value: "all", label: () => messages.notificationsPage.filterTypeAll },
  { value: "missing_clock_out", label: () => messages.notificationsPage.filterTypeMissingClockOut },
  { value: "overtime", label: () => messages.notificationsPage.filterTypeOvertime },
  { value: "leave", label: () => messages.notificationsPage.filterTypeLeave },
];

/**
 * 通知一覧画面(`/notifications`、2026-08-22 追加)。
 *
 * ヘッダーのベルのドロップダウンは直近の一部しか見せず、過去の通知を遡れない
 * (docs/design/ui-direction.md「今後のUI作業 > 2」)。この画面は同じ GET /notifications を
 * 使いつつ、絞り込み(既読状態・種別)とまとめて既読を提供する。
 *
 * - 一覧を開いただけでは既読にしない(ベルのドロップダウンと同じ方針)
 * - 既読状態(全部/未読のみ)は API 側の unreadOnly で絞り込む。種別(打刻忘れ/36協定/有給)は
 *   API に絞り込みパラメータが無いため、取得した最大100件をクライアント側でフィルタする
 * - API が最大100件までしか返さない制約はそのまま受け入れ、「もっと見る」は実装しない
 *   (offset/cursor 系のパラメータが無いため実現できない)。件数が上限に達していれば
 *   その旨を明示する
 */
export function NotificationsListView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const [notifications, setNotifications] = useState<NotificationDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pendingReadId, setPendingReadId] = useState<string | null>(null);
  const [markAllPending, setMarkAllPending] = useState(false);
  const [markReadError, setMarkReadError] = useState<string | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .listNotifications(statusFilter === "unread")
      .then((res) => {
        if (!cancelled) setNotifications(res.notifications);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setLoadError(err instanceof ApiError ? messages.notifications.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, statusFilter]);

  const displayed = useMemo(() => {
    if (!notifications) return [];
    if (typeFilter === "all") return notifications;
    return notifications.filter((n) => categorizeNotificationType(n.type) === typeFilter);
  }, [notifications, typeFilter]);

  const unreadDisplayedIds = useMemo(() => displayed.filter((n) => n.readAt === null).map((n) => n.id), [displayed]);

  function handleNavigate(href: RouteHref) {
    router.push(href);
  }

  async function handleMarkRead(id: string) {
    setPendingReadId(id);
    setMarkReadError(null);
    try {
      const res = await api.markNotificationRead(id);
      setNotifications((prev) => {
        if (!prev) return prev;
        // 未読のみ表示中に既読化した場合、その通知はこの絞り込みからは外れる
        if (statusFilter === "unread") return prev.filter((n) => n.id !== id);
        return prev.map((n) => (n.id === id ? res.notification : n));
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setMarkReadError(messages.notifications.markReadFailed);
    } finally {
      setPendingReadId(null);
    }
  }

  async function handleMarkAllVisibleRead() {
    if (unreadDisplayedIds.length === 0) return;
    setMarkAllPending(true);
    setMarkReadError(null);
    try {
      const results = await Promise.allSettled(unreadDisplayedIds.map((id) => api.markNotificationRead(id)));

      const anyUnauthorized = results.some((r) => r.status === "rejected" && r.reason instanceof UnauthorizedError);
      if (anyUnauthorized) {
        router.push("/login");
        return;
      }

      const updatedById = new Map<string, NotificationDto>();
      let anyFailed = false;
      for (const r of results) {
        if (r.status === "fulfilled") {
          updatedById.set(r.value.notification.id, r.value.notification);
        } else {
          anyFailed = true;
        }
      }

      setNotifications((prev) => {
        if (!prev) return prev;
        if (statusFilter === "unread") return prev.filter((n) => !updatedById.has(n.id));
        return prev.map((n) => updatedById.get(n.id) ?? n);
      });

      if (anyFailed) setMarkReadError(messages.notifications.markReadFailed);
    } finally {
      setMarkAllPending(false);
    }
  }

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const isTruncated = notifications !== null && notifications.length >= MAX_LIST_LIMIT;

  return (
    <div className="notif-list-page">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="notifications" />
      <main className="notif-list-page__main">
        <h1 className="notif-list-page__title">{messages.notificationsPage.title}</h1>
        <p className="notif-list-page__tagline">{messages.notificationsPage.tagline}</p>

        <div className="notif-list-page__controls">
          <div className="notif-filter-group" role="group" aria-label={messages.notificationsPage.filterStatusGroupLabel}>
            <button
              type="button"
              className={`notif-filter-btn${statusFilter === "all" ? " notif-filter-btn--active" : ""}`}
              aria-pressed={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            >
              {messages.notificationsPage.filterStatusAll}
            </button>
            <button
              type="button"
              className={`notif-filter-btn${statusFilter === "unread" ? " notif-filter-btn--active" : ""}`}
              aria-pressed={statusFilter === "unread"}
              onClick={() => setStatusFilter("unread")}
            >
              {messages.notificationsPage.filterStatusUnread}
            </button>
          </div>

          <div className="notif-filter-group" role="group" aria-label={messages.notificationsPage.filterTypeGroupLabel}>
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`notif-filter-btn${typeFilter === f.value ? " notif-filter-btn--active" : ""}`}
                aria-pressed={typeFilter === f.value}
                onClick={() => setTypeFilter(f.value)}
              >
                {f.label()}
              </button>
            ))}
          </div>
        </div>

        {loading ? <p className="monthly-loading">{messages.loading}</p> : null}
        {loadError ? (
          <p className="monthly-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {markReadError ? (
          <p className="correction-error" role="alert">
            {markReadError}
          </p>
        ) : null}

        {!loading && notifications && displayed.length === 0 ? (
          <p className="notif-list-page__empty">
            {notifications.length === 0 ? messages.notificationsPage.empty : messages.notificationsPage.emptyFiltered}
          </p>
        ) : null}

        {displayed.length > 0 ? (
          <>
            <div className="notif-list-page__bulk">
              <button
                type="button"
                className="notif-item__read-btn"
                disabled={unreadDisplayedIds.length === 0 || markAllPending}
                onClick={handleMarkAllVisibleRead}
              >
                {markAllPending ? messages.notificationsPage.markAllReadPending : messages.notificationsPage.markAllRead}
              </button>
            </div>
            <ul className="notif-list notif-list-page__list">
              {displayed.map((n) => (
                <NotificationListItem
                  key={n.id}
                  notification={n}
                  pending={pendingReadId === n.id}
                  onNavigate={handleNavigate}
                  onMarkRead={handleMarkRead}
                />
              ))}
            </ul>
          </>
        ) : null}

        {isTruncated ? <p className="notif-list-page__truncated">{messages.notificationsPage.truncatedNotice}</p> : null}
      </main>
    </div>
  );
}
