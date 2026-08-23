"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type LeaveRequestDto, type MonthlyAttendance } from "./api";
import { messages } from "./messages";
import type { AuthGuardStatus } from "./useAuthGuard";

export interface UseMonthlyDataResult {
  data: MonthlyAttendance | null;
  /**
   * 承認済み休暇の日付→申請のマップ(2026-08-23 追加)。
   * DailyBreakdown.paidLeaveMinutes は分数しか持たず、全休/半休(午前・午後)/時間単位の
   * 区別が表示に出せない(480分が全休なのか8時間分の時間単位なのか判別できない)ため、
   * 申請一覧から unit を引く。事前申請した将来の休暇日もこのマップで月次に見える。
   */
  leaveByDate: Map<string, LeaveRequestDto[]>;
  loading: boolean;
  error: string | null;
  reloadKey: number;
  reload: () => void;
}

/**
 * 月次画面の本体データ(月次集計・承認済み休暇)を取得するフック。
 * MonthlyView から状態・fetch effect を切り出したもの(挙動不変、第3波分割)。
 * reloadKey は締め/解除・打刻修正の反映トリガとして呼び出し元(ClosingPanel・CorrectionForm)
 * からも参照/更新される。
 *
 * userId(2026-08-23 追加、他人の勤怠閲覧): 省略時は自分自身。指定時は API 側で
 * attendance.record.view のスコープ判定が入る(apps/api/src/routes/attendance.ts)。
 */
export function useMonthlyData(guardStatus: AuthGuardStatus, monthParam: string, userId?: string): UseMonthlyDataResult {
  const router = useRouter();

  const [data, setData] = useState<MonthlyAttendance | null>(null);
  const [leaveByDate, setLeaveByDate] = useState<Map<string, LeaveRequestDto[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (guardStatus !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .monthly(monthParam, userId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? messages.errors.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardStatus, monthParam, userId, reloadKey]);

  // 承認済み休暇の取得は月次本体と独立に行い、失敗しても月次表示を妨げない
  // (マーカーが出ないだけに留める。他人閲覧時、閲覧側が leave.request の他人分参照権限を
  // 持たなければ403になるが、同じく静かに諦める — マーカーが出ないだけで月次表示自体は継続する)。
  useEffect(() => {
    if (guardStatus !== "authed") return;
    let cancelled = false;
    api
      .listLeaveRequests("all", userId)
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, LeaveRequestDto[]>();
        for (const req of res.requests) {
          if (req.status !== "approved") continue;
          if (!req.leaveDate.startsWith(monthParam)) continue;
          const list = map.get(req.leaveDate) ?? [];
          list.push(req);
          map.set(req.leaveDate, list);
        }
        setLeaveByDate(map);
      })
      .catch(() => {
        if (!cancelled) setLeaveByDate(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [guardStatus, monthParam, userId, reloadKey]);

  return {
    data,
    leaveByDate,
    loading,
    error,
    reloadKey,
    reload: () => setReloadKey((k) => k + 1),
  };
}
