"use client";

import { useEffect, useState } from "react";
import { api, type EffectivePermissionDto } from "./api";

/**
 * GET /me/effective-permissions を全画面間で共有するための薄いキャッシュ層(2026-08-23
 * レビュー第2波、実効権限のクライアント側推定の全廃)。
 *
 * 判断点(完了報告に明記): この API 追加より前は「実効権限」を知る手段が無く、画面ごとに
 * 別々の推定方法(useSettingsAccess の10本並列プローブ・CorrectionsView の
 * hasApprovePermission ヒューリスティック・MembersView の canInvite 再計算)に頼っていた。
 * いずれも false negative が既知だった(コメント参照)。GET /me/effective-permissions は
 * 認証ユーザー自身の実効権限の最終形を1回で返すため、以後はこのフック1つに集約する。
 *
 * lib/useHelpOverrides.ts と同じ設計: 1画面に何個もマウントされうる呼び出し元
 * (useSettingsAccess・CorrectionsView・LeaveRequestsList・MembersView 等)が個別に
 * GET を叩かないよう、モジュールスコープで1つの Promise を共有する(最初にマウントされた
 * 呼び出し元だけが実際に fetch し、以後は同じ Promise を await するだけ)。
 *
 * ログアウト・ログイン(テナント切替)をまたいで古い権限を見せないよう、
 * invalidateEffectivePermissionsCache を AppHeader のログアウト処理から呼ぶ。
 */
let cachedPromise: Promise<EffectivePermissionDto[]> | null = null;

function fetchEffectivePermissionsShared(): Promise<EffectivePermissionDto[]> {
  if (!cachedPromise) {
    cachedPromise = api
      .getEffectivePermissions()
      .then((res) => res.permissions)
      .catch((err: unknown) => {
        cachedPromise = null;
        throw err;
      });
  }
  return cachedPromise;
}

/** ログアウト・ログイン(テナント切替)時に呼ぶ(AppHeader#handleLogout 参照)。 */
export function invalidateEffectivePermissionsCache(): void {
  cachedPromise = null;
}

export interface EffectivePermissionsState {
  loading: boolean;
  /** 取得失敗時は空配列(安全側に倒し、権限が必要な機能はすべて非表示にする)。 */
  permissions: EffectivePermissionDto[];
}

const INITIAL: EffectivePermissionsState = { loading: true, permissions: [] };

/**
 * 認証ユーザー自身の実効権限一覧を返す共有フック。UI の出し分け(ナビ・ボタンの表示可否)用の
 * 参考情報であり、実際の許可判定は常に apps/api 側(requirePermission)が行う
 * (apps/api/src/routes/me.ts の判断点コメントと同じ位置づけ)。
 */
export function useEffectivePermissions(): EffectivePermissionsState {
  const [state, setState] = useState<EffectivePermissionsState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    fetchEffectivePermissionsShared()
      .then((permissions) => {
        if (!cancelled) setState({ loading: false, permissions });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, permissions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
