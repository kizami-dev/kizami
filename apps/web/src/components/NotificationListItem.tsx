"use client";

import type { Unstable_RouteHref as RouteHref } from "waku/router/client";
import type { NotificationDto } from "../lib/api";
import { messages } from "../lib/messages";
import { notificationLinkFor } from "../lib/notifications";
import { formatDateLabel, formatDateTimeJst } from "../lib/time";

export interface NotificationListItemProps {
  notification: NotificationDto;
  /** この通知に対する既読化リクエストが処理中かどうか(ボタンを無効化する)。 */
  pending: boolean;
  onNavigate: (href: RouteHref) => void;
  onMarkRead: (id: string) => void;
}

/**
 * 通知1件の表示(NotificationBell のドロップダウン・NotificationsListView の一覧で共有)。
 * 見た目・操作は元々 NotificationBell 単体に実装されていたものをそのまま切り出した
 * (2026-08-22、通知一覧画面の追加に伴うリファクタ)。
 */
export function NotificationListItem({ notification: n, pending, onNavigate, onMarkRead }: NotificationListItemProps) {
  const isUnread = n.readAt === null;
  const link = notificationLinkFor(n);

  return (
    <li className={`notif-item${isUnread ? " notif-item--unread" : ""}`}>
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
        {link ? (
          <button type="button" className="notif-item__link-btn" onClick={() => onNavigate(link.href)}>
            {link.label}
          </button>
        ) : null}
        {isUnread ? (
          <button type="button" className="notif-item__read-btn" onClick={() => onMarkRead(n.id)} disabled={pending}>
            {messages.notifications.markRead}
          </button>
        ) : null}
      </div>
    </li>
  );
}
