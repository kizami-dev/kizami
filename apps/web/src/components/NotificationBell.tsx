"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type NotificationDto } from "../lib/api";
import { messages } from "../lib/messages";
import { formatDateLabel, formatDateTimeJst } from "../lib/time";

const POLL_INTERVAL_MS = 60_000;

/**
 * ヘッダーの通知ベル(未読バッジ+ドロップダウン一覧)。
 *
 * - 未読数は60秒間隔でポーリングするが、画面がバックグラウンドの間(document.visibilityState
 *   !== "visible")は止める
 * - 一覧を開いても自動で全既読にはしない(要件: ユーザーが意図せず既読にしてしまうのを避ける)。
 *   既読化は各通知の「既読にする」ボタンによる明示操作のみ
 * - 打刻忘れ通知(type === "missing_clock_out")には対象日の月次画面(修正フォーム自動オープン)
 *   への導線を添える
 */
export function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDto[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [markReadError, setMarkReadError] = useState<string | null>(null);
  const [pendingReadId, setPendingReadId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function fetchCount() {
      try {
        const res = await api.unreadNotificationCount();
        if (!cancelled) setUnreadCount(res.count);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
        }
        // ネットワーク瞬断等は無視して次回ポーリングに委ねる
      }
    }

    function start() {
      if (intervalId !== undefined) return;
      void fetchCount();
      intervalId = setInterval(fetchCount, POLL_INTERVAL_MS);
    }
    function stop() {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    }

    if (document.visibilityState === "visible") start();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function loadList() {
    setListLoading(true);
    setListError(null);
    api
      .listNotifications()
      .then((res) => setNotifications(res.notifications))
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setListError(err instanceof ApiError ? messages.notifications.loadFailed : messages.errors.network);
      })
      .finally(() => setListLoading(false));
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setMarkReadError(null);
      loadList();
    }
  }

  async function handleMarkRead(id: string) {
    setPendingReadId(id);
    setMarkReadError(null);
    try {
      const res = await api.markNotificationRead(id);
      setNotifications((prev) => (prev ? prev.map((n) => (n.id === id ? res.notification : n)) : prev));
      setUnreadCount((c) => Math.max(0, c - 1));
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

  function handleOpenCorrection(subjectDate: string) {
    setOpen(false);
    const month = subjectDate.slice(0, 7);
    router.push(`/monthly?month=${month}&date=${subjectDate}`);
  }

  return (
    <div className="notif-bell" ref={containerRef}>
      <button
        type="button"
        id="notif-bell-trigger"
        className="notif-bell__btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${messages.notifications.bellLabel}${unreadCount > 0 ? `(${messages.notifications.unread} ${unreadCount}件)` : ""}`}
        onClick={handleToggle}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 16v-5a6 6 0 1 0-12 0v5l-1.6 2.4A1 1 0 0 0 5.24 20h13.52a1 1 0 0 0 .84-1.6L18 16Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="notif-bell__badge tabular-nums" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-panel" role="dialog" aria-label={messages.notifications.title}>
          <div className="notif-panel__header">
            <span className="notif-panel__title">{messages.notifications.title}</span>
          </div>

          {listLoading ? <p className="notif-panel__hint">{messages.loading}</p> : null}
          {listError ? (
            <p className="correction-error" role="alert">
              {listError}
            </p>
          ) : null}
          {markReadError ? (
            <p className="correction-error" role="alert">
              {markReadError}
            </p>
          ) : null}

          {notifications && notifications.length === 0 ? (
            <p className="notif-panel__hint">{messages.notifications.empty}</p>
          ) : null}

          {notifications && notifications.length > 0 ? (
            <ul className="notif-list">
              {notifications.map((n) => {
                const isUnread = n.readAt === null;
                return (
                  <li key={n.id} className={`notif-item${isUnread ? " notif-item--unread" : ""}`}>
                    <div className="notif-item__header">
                      {isUnread ? (
                        <span className="notif-item__unread-mark" aria-hidden="true">
                          ●
                        </span>
                      ) : null}
                      <span className="notif-item__title">{n.title}</span>
                      {isUnread ? <span className="visually-hidden">({messages.notifications.unread})</span> : null}
                    </div>
                    <p className="notif-item__body">{n.body}</p>
                    <div className="notif-item__meta tabular-nums">
                      {n.subjectDate ? (
                        <span>
                          {messages.notifications.subjectDateLabel}: {formatDateLabel(n.subjectDate)}
                        </span>
                      ) : null}
                      <span>
                        {messages.notifications.receivedAtLabel}: {formatDateTimeJst(n.createdAt)}
                      </span>
                    </div>
                    <div className="notif-item__actions">
                      {n.type === "missing_clock_out" && n.subjectDate ? (
                        <button
                          type="button"
                          className="notif-item__link-btn"
                          onClick={() => handleOpenCorrection(n.subjectDate as string)}
                        >
                          {messages.notifications.openCorrection}
                        </button>
                      ) : null}
                      {isUnread ? (
                        <button
                          type="button"
                          className="notif-item__read-btn"
                          onClick={() => handleMarkRead(n.id)}
                          disabled={pendingReadId === n.id}
                        >
                          {messages.notifications.markRead}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
