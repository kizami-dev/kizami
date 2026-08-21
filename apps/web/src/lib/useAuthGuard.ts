"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, UnauthorizedError, type AuthUser } from "./api";

export type AuthGuardStatus = "loading" | "authed" | "error";

export interface AuthGuardResult {
  status: AuthGuardStatus;
  user: AuthUser | null;
  error: unknown;
}

/**
 * 保護ページ用の認証ガード。マウント時に GET /me を確認し、未認証(401)なら
 * /login へ誘導する。それ以外のエラー(ネットワーク断等)は画面側に委ねる。
 */
export function useAuthGuard(): AuthGuardResult {
  const router = useRouter();
  const [state, setState] = useState<AuthGuardResult>({ status: "loading", user: null, error: null });

  useEffect(() => {
    let cancelled = false;

    api
      .me()
      .then(({ user }) => {
        if (!cancelled) setState({ status: "authed", user, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setState({ status: "error", user: null, error: err });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
