"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export interface SettingsAccess {
  loading: boolean;
  notifications: boolean;
  departments: boolean;
  members: boolean;
  presets: boolean;
  /** GET /settings/tenant-profile(alert.labor_limit.configure)。v0.3 追加。 */
  tenantProfile: boolean;
  /** GET /settings/leave(leave.grant.manage)。v0.3 追加。 */
  leave: boolean;
  /**
   * /settings/help(社内規定の編集)。2026-08-22 追加。
   *
   * 判断点: PUT /help/overrides/:key・PUT /settings/work-rules-url は
   * notification.settings.manage を要求するが、GET /help/overrides はその権限の有無に
   * 関わらず認証だけで 200 を返す(従業員も読めるようにするため)ため、他の画面のように
   * 「一覧 GET を叩いて 200/403 で判定する」手が使えない。実際に要求する権限が
   * notifications と同一(notification.settings.manage)なので、notifications の
   * プローブ結果をそのまま転用する(追加のリクエストを増やさない)。
   */
  help: boolean;
  /**
   * /settings/privacy(個人情報まわりの雛形。2026-08-22 追加)。
   * GET /settings/privacy-templates が要求する権限は help と同一(notification.settings.manage)
   * なので、help と同様に notifications のプローブ結果を転用する(追加のリクエストを増やさない)。
   */
  privacy: boolean;
  /**
   * /settings/attendance(テナント設定の版管理: 日界・法定休日・休憩ルール・GPS・フレックス。
   * 2026-08-22 追加)。GET /settings/attendance(tenant_settings.calendar.manage)と
   * GET /settings/work-policy(tenant_settings.flex.manage)は別々の権限なので、
   * どちらか一方でも通れば画面自体は表示する(画面側は各セクションを個別に出し分ける)。
   */
  attendance: boolean;
  /**
   * /settings/api-keys(公開打刻APIキーの管理。v0.4 追加)。
   *
   * 判断点: 依頼どおり「自分用なので権限不要」— 自分のキーの発行・一覧・失効は全認証済み
   * ユーザーが行える(GET /api-keys は自分のキーだけなら常に200)ため、他の項目のような
   * 権限プローブは不要で常に true。
   */
  apiKeys: boolean;
}

const INITIAL: SettingsAccess = {
  loading: true,
  notifications: false,
  departments: false,
  members: false,
  presets: false,
  tenantProfile: false,
  leave: false,
  help: false,
  privacy: false,
  attendance: false,
  apiKeys: true,
};

/**
 * 設定サブナビ(AppHeader・SettingsNav・設定ハブ)がどの /settings/* を表示してよいかを判定する。
 *
 * 判断点: apps/api には「自分の実効権限一覧」を返すエンドポイントが無く(apps/api は変更禁止)、
 * 各画面の一覧 API を叩いて 200/403 で判定する既存の流儀(AppHeader の通知設定リンク判定)を
 * そのまま他の3画面にも拡張する。失敗時は安全側(非表示)に倒す。
 */
export function useSettingsAccess(): SettingsAccess {
  const [access, setAccess] = useState<SettingsAccess>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    async function probe<T>(fn: () => Promise<T>): Promise<boolean> {
      try {
        await fn();
        return true;
      } catch {
        return false;
      }
    }

    Promise.all([
      probe(() => api.getNotificationSettings()),
      probe(() => api.listDepartments()),
      probe(() => api.listMembers()),
      probe(() => api.listPresets()),
      probe(() => api.getTenantProfile()),
      probe(() => api.getLeaveSettings()),
      probe(() => api.getAttendanceSettings()),
      probe(() => api.getWorkPolicySettings()),
    ]).then(([notifications, departments, members, presets, tenantProfile, leave, attendanceSettings, workPolicySettings]) => {
      if (cancelled) return;
      setAccess({
        loading: false,
        notifications,
        departments,
        members,
        presets,
        tenantProfile,
        leave,
        help: notifications,
        privacy: notifications,
        attendance: attendanceSettings || workPolicySettings,
        apiKeys: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return access;
}
