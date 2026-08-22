"use client";

import { useEffect, useState } from "react";
import { api, type HelpOverridesDto } from "./api";

/**
 * GET /help/overrides を全 HelpTip 間で共有するための薄いキャッシュ層。
 *
 * 独自判断点: HelpTip は1画面に何個も出るコンポーネントで、各インスタンスが個別に
 * GET /help/overrides を叩くと同一データを何度も取得してしまう。認証さえあれば誰でも
 * 読める(権限チェック無し)軽量なテナント全体データなので、モジュールスコープで
 * 1つの Promise を共有し、最初にマウントされた HelpTip だけが実際に fetch する
 * (2回目以降は同じ Promise を await するだけ)。
 *
 * ログアウト・ログイン(テナント切替)をまたいで古いデータを見せないよう、
 * invalidateHelpOverridesCache を認証まわりから呼べるようにしておく
 * (現状は呼び出し元が無く、将来 useAuthGuard 等から呼ぶ余地として用意)。
 */
let cachedPromise: Promise<HelpOverridesDto> | null = null;

function fetchHelpOverridesShared(): Promise<HelpOverridesDto> {
  if (!cachedPromise) {
    cachedPromise = api.getHelpOverrides().catch((err: unknown) => {
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}

/** 未認証・取得失敗時など、社内規定が読めない場合は「何も追記しない」に倒す(HelpTip 側で使う)。 */
export function invalidateHelpOverridesCache(): void {
  cachedPromise = null;
}

export interface HelpOverridesState {
  loading: boolean;
  overrides: Record<string, { bodyMd: string; updatedAt: number }>;
  workRulesUrl: string | null;
}

const INITIAL: HelpOverridesState = { loading: true, overrides: {}, workRulesUrl: null };

export function useHelpOverrides(): HelpOverridesState {
  const [state, setState] = useState<HelpOverridesState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    fetchHelpOverridesShared()
      .then((res) => {
        if (cancelled) return;
        setState({ loading: false, overrides: res.overrides, workRulesUrl: res.workRulesUrl });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, overrides: {}, workRulesUrl: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
