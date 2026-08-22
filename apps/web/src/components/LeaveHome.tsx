"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type LeaveBalanceDto, type LeaveRequestDto, type LeaveCapabilitiesDto } from "../lib/api";
import { messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { LeaveBalancePanel } from "./LeaveBalancePanel";
import { LeaveRequestForm } from "./LeaveRequestForm";
import { LeaveRequestsList } from "./LeaveRequestsList";

/**
 * 有給休暇ホーム(/leave)。本人の残高確認・申請・申請一覧(承認/却下/取下げ)をまとめる
 * (docs/requirements.md §5、既存の CorrectionsView と同じ「申請→pending→承認/却下/取下げ」の形)。
 */
export function LeaveHome() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [balance, setBalance] = useState<LeaveBalanceDto | null>(null);
  const [requests, setRequests] = useState<LeaveRequestDto[] | null>(null);
  // GET /settings/leave は leave.grant.manage(tenant スコープ)が必要なため、権限の無い
  // 一般ユーザーは 403 になり取得できない(独自判断点)。その場合は null のままにし、
  // LeaveRequestForm 側で API の既定値相当にフォールバックする。
  const [settings, setSettings] = useState<LeaveCapabilitiesDto | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [closedMonthRequestId, setClosedMonthRequestId] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState(false);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([api.getLeaveBalance(), api.listLeaveRequests("all")])
      .then(([balanceRes, requestsRes]) => {
        if (cancelled) return;
        setBalance(balanceRes);
        setRequests(requestsRes.requests);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setLoadError(err instanceof ApiError ? messages.leave.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // 申請フォームの選択肢は、認証だけで読める capabilities を使う
    // (/settings/leave は管理権限が要るため、一般の従業員は読めない)。
    api
      .getLeaveCapabilities()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, reloadKey]);

  function handleUnauthorized() {
    router.push("/login");
  }

  function handleSubmitted(result: { requestId: string; targetMonthClosed: boolean }) {
    setClosedMonthRequestId(result.targetMonthClosed ? result.requestId : null);
    setSubmitNotice(true);
    setReloadKey((k) => k + 1);
  }

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  // 時間単位年休の当年度消化済み分(概算)。年次・積立の両プールにまたがりうるため両方を合算する
  // (packages/leave/src/allocation.ts の「年度単位で年5日分上限を判定する」仕様の近似値。
  // 複数の年次付与年度が同時に有効な場合は概算になるが、通常運用では現在有効な1年度分と一致する)。
  const hourlyUsedMinutes = balance
    ? [...balance.annual.byGrant, ...balance.stocked.byGrant].reduce((sum, g) => sum + g.hourlyUsedMinutes, 0)
    : 0;

  return (
    <div className="leave">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="leave" />
      <main className="leave__main">
        <h1 className="leave__title">{messages.leave.title}</h1>
        <p className="leave__tagline">{messages.leave.tagline}</p>

        {loading ? <p className="monthly-loading">{messages.loading}</p> : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {balance ? <LeaveBalancePanel balance={balance} /> : null}

        {balance ? (
          <section className="leave__section">
            <h2 className="leave__section-title">{messages.leave.requestFormTitle}</h2>
            <LeaveRequestForm
              standardDayMinutes={balance.standardDayMinutes}
              settings={settings}
              hourlyUsedMinutes={hourlyUsedMinutes}
              onSubmitted={handleSubmitted}
              onUnauthorized={handleUnauthorized}
            />
            {submitNotice ? <p className="leave-admin-result">{messages.leave.submitted}</p> : null}
          </section>
        ) : null}

        {requests ? (
          <LeaveRequestsList
            requests={requests}
            currentUserId={guard.user.id}
            closedMonthRequestId={closedMonthRequestId}
            onChanged={() => {
              setSubmitNotice(false);
              setReloadKey((k) => k + 1);
            }}
            onUnauthorized={handleUnauthorized}
          />
        ) : null}
      </main>
    </div>
  );
}
