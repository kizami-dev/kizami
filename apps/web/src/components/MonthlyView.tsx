"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import { messages } from "../lib/messages";
import {
  currentYearMonthJst,
  formatMonthLabel,
  formatMonthParam,
  parseMonthParam,
  shiftMonth,
  type YearMonth,
} from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useMonthlyData } from "../lib/useMonthlyData";
import { AppHeader } from "./AppHeader";
import { CorrectionForm } from "./CorrectionForm";
import { HelpTip } from "./HelpTip";
import { ClosingDiffTable } from "./monthly/ClosingDiffTable";
import { ClosingPanel } from "./monthly/ClosingPanel";
import { CsvExport } from "./monthly/CsvExport";
import { MemberSwitcher } from "./monthly/MemberSwitcher";
import { MonthlyAttendanceTable } from "./monthly/MonthlyAttendanceTable";
import { MonthlyTotals } from "./monthly/MonthlyTotals";
import { WorkloadBar } from "./monthly/WorkloadBar";

export function MonthlyView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const queryParams = new URLSearchParams(router.query);
  const ym: YearMonth = parseMonthParam(queryParams.get("month")) ?? currentYearMonthJst();
  const monthParam = formatMonthParam(ym);
  /** 通知(打刻忘れ)からの導線: ?date=YYYY-MM-DD が付いていれば該当日の修正フォームを自動で開く。 */
  const autoOpenDate = queryParams.get("date");

  /**
   * 他人の勤怠閲覧(2026-08-23 追加)。?userId= 省略時は自分自身。URLに乗せることで
   * 共有可能にする(依頼どおり)。self かどうかの判定は guard.user.id との比較。
   */
  const queryUserId = queryParams.get("userId");
  const selfId = guard.user?.id;
  const targetUserId = queryUserId ?? selfId;
  const viewingOthers = targetUserId !== undefined && selfId !== undefined && targetUserId !== selfId;

  function switchTargetUser(newUserId: string) {
    const params = new URLSearchParams();
    params.set("month", monthParam);
    if (selfId !== undefined && newUserId !== selfId) {
      params.set("userId", newUserId);
    }
    router.push(`/monthly?${params.toString()}`);
  }

  const { data, leaveByDate, loading, error, reloadKey, reload } = useMonthlyData(
    guard.status,
    monthParam,
    viewingOthers ? targetUserId : undefined,
  );
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);

  useEffect(() => {
    // 他人を見ている間は修正フォームを開かない(依頼: 修正は本人操作、閲覧のみ)。
    if (autoOpenDate && !viewingOthers) setCorrectionDate(autoOpenDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenDate, viewingOthers]);

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const prevMonthParam = formatMonthParam(shiftMonth(ym, -1));
  const nextMonthParam = formatMonthParam(shiftMonth(ym, 1));
  // 他人の勤怠閲覧中は月送りでも userId を引き継ぐ(依頼どおり URL 共有可能にするため。
  // 引き継がないと前月/翌月リンクを踏むたびに自分の月次へ戻ってしまう)。
  const userIdSuffix = viewingOthers && targetUserId !== undefined ? `&userId=${encodeURIComponent(targetUserId)}` : "";

  return (
    <div className="monthly">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="monthly" />
      <main className="monthly__main">
        <div className="monthly__nav">
          <Link to={`/monthly?month=${prevMonthParam}${userIdSuffix}`} className="monthly__nav-link">
            ← {messages.monthly.prevMonth}
          </Link>
          <h1 className="monthly__title">{formatMonthLabel(ym)}</h1>
          <Link to={`/monthly?month=${nextMonthParam}${userIdSuffix}`} className="monthly__nav-link">
            {messages.monthly.nextMonth} →
          </Link>
        </div>

        {/*
          他人の勤怠閲覧(2026-08-23 追加)。メンバー一覧が自分だけなら MemberSwitcher 自体が
          何も描画しない(依頼どおり)。切替は URL(?userId=)に反映するため共有可能。
        */}
        {selfId !== undefined ? (
          <MemberSwitcher selfId={selfId} targetUserId={targetUserId ?? selfId} onChange={switchTargetUser} />
        ) : null}

        {viewingOthers && data ? (
          <p className="monthly__viewing-others" role="status">
            {messages.monthly.viewingOthersLabel(data.user.name)}
          </p>
        ) : null}

        {loading ? <p className="monthly-loading">{messages.loading}</p> : null}
        {error ? <p className="monthly-error">{error}</p> : null}

        {data ? (
          <>
            {data.closing.closed ? (
              <div className="closing-status">
                <span className="closing-badge closing-badge--closed">{messages.closing.closedBadge}</span>
                {data.closing.amended ? (
                  <span className="closing-badge closing-badge--amended">{messages.closing.amendedBadge}</span>
                ) : null}
                {data.figures.source === "snapshot" ? (
                  <span className="closing-badge closing-badge--snapshot closing-badge--small">
                    {messages.closing.snapshotBadge}
                  </span>
                ) : null}
              </div>
            ) : null}

            <WorkloadBar data={data} />

            <MonthlyTotals data={data} />

            <ClosingDiffTable data={data} />
          </>
        ) : null}

        {/*
          締めパネル・CSVエクスポートは、それぞれ月次本体と独立の GET(締め状態・CSV権限プローブ)を
          持つため、data の到着を待たずマウントする(元実装で対応する effect が data 未取得でも
          動いていたのと同じタイミングを保つ)。表示条件自体(data ? (…) : null)は各コンポーネント
          内部で再現する。
        */}
        <ClosingPanel monthParam={monthParam} reloadKey={reloadKey} onReload={reload} userId={guard.user.id} data={data} />

        <CsvExport monthParam={monthParam} data={data} />

        {data ? (
          <>
            {/*
              いまどの制度で見ているかの明示(ui-direction.md「月次」節)。フレックスの利用者が
              「時間外列が無い」ことに気づいたとき、理由(制度の違い)に到達できるようにする。
            */}
            <p className="monthly-table__work-system">
              {messages.monthly.workSystemLabel}: <strong>{messages.monthly.workSystemValue[data.workSystem]}</strong>
              <HelpTip helpKey="attendance.work-system" />
            </p>

            <MonthlyAttendanceTable data={data} leaveByDate={leaveByDate} {...(viewingOthers ? {} : { onCorrect: setCorrectionDate })} />
          </>
        ) : null}
      </main>

      {correctionDate ? (
        <CorrectionForm
          date={correctionDate}
          autoDeductedBreakMinutes={data?.days.find((d) => d.date === correctionDate)?.autoDeductedBreakMinutes ?? 0}
          onClose={() => setCorrectionDate(null)}
          onSubmitted={() => {
            setCorrectionDate(null);
            reload();
          }}
          onUnauthorized={() => {
            setCorrectionDate(null);
            router.push("/login");
          }}
        />
      ) : null}
    </div>
  );
}
