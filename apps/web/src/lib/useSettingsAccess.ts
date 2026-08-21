"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export interface SettingsAccess {
  loading: boolean;
  notifications: boolean;
  departments: boolean;
  members: boolean;
  presets: boolean;
}

const INITIAL: SettingsAccess = { loading: true, notifications: false, departments: false, members: false, presets: false };

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
    ]).then(([notifications, departments, members, presets]) => {
      if (cancelled) return;
      setAccess({ loading: false, notifications, departments, members, presets });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return access;
}
