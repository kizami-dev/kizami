"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, UnauthorizedError, type AuthTenant, type AuthUser } from "./api";

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
 */
export function useAuthGuard(): AuthGuardResult {
  const router = useRouter();
  const [state, setState] = useState<AuthGuardResult>({ status: "loading", user: null, tenant: null, error: null });

  useEffect(() => {
    let cancelled = false;

    api
      .me()
      .then(({ user, tenant }) => {
        if (!cancelled) setState({ status: "authed", user, tenant, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
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
