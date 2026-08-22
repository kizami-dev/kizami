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
}

const INITIAL: SettingsAccess = {
  loading: true,
  notifications: false,
  departments: false,
  members: false,
  presets: false,
  tenantProfile: false,
  leave: false,
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
    ]).then(([notifications, departments, members, presets, tenantProfile, leave]) => {
      if (cancelled) return;
      setAccess({ loading: false, notifications, departments, members, presets, tenantProfile, leave });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return access;
}
