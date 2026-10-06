"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, UnauthorizedError, type AuthTenant, type AuthUser } from "./api";
import { syncLocaleWithServer } from "./i18n/sync";
import { isTenantWithdrawingError, setTenantWithdrawalNoticeFromTenant } from "./tenantWithdrawal";

export type AuthGuardStatus = "loading" | "authed" | "error";

export interface AuthGuardResult {
  status: AuthGuardStatus;
  user: AuthUser | null;
  /** テナント名等の表示専用情報(2026-08-23 追加)。user 未確定の間は同じく null。 */
  tenant: AuthTenant | null;
  error: unknown;
}

/**
 * 保護ページ用の認証ガード。マウント時に GET /me を確認し、未認証(401)なら
 * /login へ誘導する。それ以外のエラー(ネットワーク断等)は画面側に委ねる。
 *
 * 2026-10-05: 退会手続き中のテナントで退会の権限を持たない人のセッションは 401 `tenant_withdrawing`
 * になる(docs/design/tenant-withdrawal.md)。ログイン画面へ戻すときに理由を出せるよう `?error=` を付ける。
 * 読んだ退会の状態は、全画面のバナーのために lib/tenantWithdrawal.ts のストアへ置く。
 */
export function useAuthGuard(): AuthGuardResult {
  const router = useRouter();
  const [state, setState] = useState<AuthGuardResult>({ status: "loading", user: null, tenant: null, error: null });

  useEffect(() => {
    let cancelled = false;

    api
      .me()
      .then(({ user, tenant }) => {
        if (cancelled) return;
        setTenantWithdrawalNoticeFromTenant(tenant);
        // 表示言語をサーバーと揃える(ページの読み込みごとに1回。lib/i18n/sync.ts)
        syncLocaleWithServer(user.locale);
        setState({ status: "authed", user, tenant, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push(isTenantWithdrawingError(err.body) ? "/login?error=tenant_withdrawing" : "/login");
          return;
        }
        setState({ status: "error", user: null, tenant: null, error: err });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
