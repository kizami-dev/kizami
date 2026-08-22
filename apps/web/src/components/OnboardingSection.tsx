"use client";

import { useEffect, useState } from "react";
import { Link } from "waku";
import type { Unstable_RouteHref as RouteHref } from "waku/router/client";
import { api } from "../lib/api";
import type { HelpKey } from "../lib/help";
import { messages } from "../lib/messages";
import { nowMinutes } from "../lib/time";
import { HelpTip } from "./HelpTip";

const DISMISSED_KEY = "kizami:onboarding:dismissed";

interface OnboardingItem {
  id: string;
  title: string;
  reason: string;
  actionLabel: string;
  href: RouteHref;
  helpKey?: HelpKey;
}

export interface OnboardingSectionProps {
  /** guard.status === "authed" になってから取得を始める(GET /me を DashboardView と共有し、二重に叩かない)。 */
  authed: boolean;
  /** 打刻するたびに増える DashboardView の reloadKey。変化したら「打刻したことがない」項目を再判定する。 */
  refreshKey: number;
}

/**
 * ダッシュボードの「はじめに」セクション(2026-08-22 追加)。
 * docs/design/ui-direction.md「今後のUI作業 > 5. オンボーディング」。
 *
 * 方針:
 * - 新しいAPI・テーブルは作らない。既存のAPIから状態を導出し、未完了の項目だけを列挙する
 *   (完了したら消える。全部完了したら何も出さない)
 * - モーダルでは操作を強制しない(このセクション自体、押し付けがましくならないよう
 *   ダッシュボードの他カードと同じ静かなトーンで表示するだけで、閉じるまで居座らせない)
 * - 各項目は「その人が実際に操作できること」に限る(コーディネーターからの是正指示、2026-08-23)。
 *   権限が足りずAPIが403を返す項目は「判定できない」として出さない(エラー表示もしない)
 * - 入社日は従業員本人ではなく管理者向けの項目にする — 入社日の編集(PATCH /members/:id)は
 *   member.profile.edit 権限を要求し、本人には編集権限が無いため、本人に促しても操作できない。
 *   GET /members(member.view 権限)が読めた場合にのみ「入社日未設定のメンバー数」を数えて出す。
 *   注記(判断点): member.view と member.profile.edit は別権限であり、閲覧はできるが編集はできない
 *   カスタムプリセットの下では過剰表示になり得るが、apps/api を変更せずに「自分の実効権限」を
 *   安全に確認する手段が無い(PATCH は副作用があるため試し撃ちできない)ため、同梱プリセット
 *   (管理者・マネージャー、どちらも両方の権限を持つ)を前提にこの近似で妥協した
 * - 「もう表示しない」は localStorage のみに保存する(サーバーには一切送らない)
 */
export function OnboardingSection({ authed, refreshKey }: OnboardingSectionProps) {
  const [dismissed, setDismissed] = useState(false);
  const [items, setItems] = useState<OnboardingItem[] | null>(null);

  useEffect(() => {
    if (!authed || dismissed) return;
    let cancelled = false;

    let alreadyDismissed = false;
    try {
      alreadyDismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      alreadyDismissed = false;
    }
    if (alreadyDismissed) {
      setDismissed(true);
      return;
    }

    Promise.allSettled([
      api.listPunches(0, nowMinutes()),
      api.getPersonalNotificationSettings(),
      api.getAttendanceSettings(),
      api.getWorkPolicySettings(),
      api.getNotificationSettings(),
      api.listMembers(),
    ]).then((results) => {
      if (cancelled) return;
      const [punchesR, personalR, attendanceR, workPolicyR, channelsR, membersR] = results;
      const next: OnboardingItem[] = [];

      // ---- 従業員向け(権限不問、自分のことだけ) ----
      if (punchesR.status === "fulfilled" && punchesR.value.punches.length === 0) {
        next.push({
          id: "punch",
          title: messages.onboarding.punchTitle,
          reason: messages.onboarding.punchReason,
          actionLabel: messages.onboarding.punchAction,
          href: "/punch",
        });
      }

      if (personalR.status === "fulfilled" && personalR.value.updatedAt === null) {
        next.push({
          id: "notif-prefs",
          title: messages.onboarding.notifPrefsTitle,
          reason: messages.onboarding.notifPrefsReason,
          actionLabel: messages.onboarding.notifPrefsAction,
          href: "/settings/notifications/me",
        });
      }

      // ---- 管理者向け(それぞれ独立に判定できたときだけ出す。403等は「判定できない」として無視) ----
      const attendanceHistoryLen = attendanceR.status === "fulfilled" ? attendanceR.value.history.length : null;
      const workPolicyHistoryLen = workPolicyR.status === "fulfilled" ? workPolicyR.value.history.length : null;
      const attendanceUnconfirmed =
        (attendanceHistoryLen !== null && attendanceHistoryLen <= 1) || (workPolicyHistoryLen !== null && workPolicyHistoryLen <= 1);
      if (attendanceUnconfirmed) {
        next.push({
          id: "attendance",
          title: messages.onboarding.attendanceTitle,
          reason: messages.onboarding.attendanceReason,
          actionLabel: messages.onboarding.attendanceAction,
          href: "/settings/attendance",
          helpKey: "attendance.day-boundary",
        });
      }

      if (channelsR.status === "fulfilled" && channelsR.value.updatedAt === null) {
        next.push({
          id: "channels",
          title: messages.onboarding.channelsTitle,
          reason: messages.onboarding.channelsReason,
          actionLabel: messages.onboarding.channelsAction,
          href: "/settings/notifications",
        });
      }

      if (membersR.status === "fulfilled") {
        const hireDateMissingCount = membersR.value.members.filter((m) => m.hireDate === null).length;
        if (hireDateMissingCount > 0) {
          next.push({
            id: "hire-date",
            title: messages.onboarding.hireDateTitle(hireDateMissingCount),
            reason: messages.onboarding.hireDateReason,
            actionLabel: messages.onboarding.hireDateAction,
            href: "/settings/members",
            helpKey: "leave.grant",
          });
        }
        if (membersR.value.members.length <= 1) {
          next.push({
            id: "solo",
            title: messages.onboarding.soloTitle,
            reason: messages.onboarding.soloReason,
            actionLabel: messages.onboarding.soloAction,
            href: "/settings/members",
          });
        }
      }

      setItems(next);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, dismissed, refreshKey]);

  function handleDismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // プライベートブラウズ等で保存できなくても、このセッション中だけでも非表示にできれば十分
    }
    setDismissed(true);
  }

  if (dismissed || !items || items.length === 0) return null;

  return (
    <section className="dashboard-card onboarding" aria-label={messages.onboarding.title}>
      <div className="onboarding__header">
        <h2 className="dashboard-card__title">{messages.onboarding.title}</h2>
        <button type="button" className="onboarding__dismiss" onClick={handleDismiss}>
          {messages.onboarding.dismiss}
        </button>
      </div>
      <ul className="onboarding__list">
        {items.map((item) => (
          <li key={item.id} className="onboarding__item">
            <p className="onboarding__item-title">
              {item.title}
              {item.helpKey ? <HelpTip helpKey={item.helpKey} /> : null}
            </p>
            <p className="onboarding__item-reason">{item.reason}</p>
            <Link to={item.href} className="dashboard-todo__row-link">
              {item.actionLabel}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
