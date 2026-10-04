"use client";

import type { LeaveBalanceDto, LeaveGrantAllocationDto, MandatoryFiveDaysStatusDto } from "../lib/api";
import { messages } from "../lib/messages";
import { splitMandatoryFiveDays } from "../lib/mandatory-five-days";
import { dateStrFromEpochMinutesJst, formatDaysHoursMinutes, nowMinutes } from "../lib/time";
import { HelpTip } from "./HelpTip";

export interface LeaveBalancePanelProps {
  balance: LeaveBalanceDto;
}

function GrantBreakdownTable({ byGrant, standardDayMinutes }: { byGrant: LeaveGrantAllocationDto[]; standardDayMinutes: number }) {
  if (byGrant.length === 0) {
    return <p className="leave-help">{messages.leave.noGrants}</p>;
  }
  return (
    <div className="leave-grant-table-wrap">
      <table className="leave-grant-table">
        <thead>
          <tr>
            <th>{messages.leave.grantColumnGrantedOn}</th>
            <th>{messages.leave.grantColumnDays}</th>
            <th>{messages.leave.grantColumnExpiresOn}</th>
            <th>{messages.leave.grantColumnRemaining}</th>
          </tr>
        </thead>
        <tbody>
          {byGrant.map((g) => (
            <tr key={g.id} className={g.expired ? "leave-grant-table__row--expired" : undefined}>
              <td>{g.grantedOn}</td>
              <td className="tabular-nums">{g.days}</td>
              <td className="tabular-nums">{g.expiresOn}</td>
              <td className="tabular-nums">
                {g.expired ? messages.leave.grantExpired : formatDaysHoursMinutes(g.remainingMinutes, standardDayMinutes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceCard({
  label,
  standardDayMinutes,
  summary,
}: {
  label: string;
  standardDayMinutes: number;
  summary: LeaveBalanceDto["annual"];
}) {
  return (
    <div className="leave-balance-card">
      <span className="leave-balance-card__type">{label}</span>
      <span className="leave-balance-card__remaining tabular-nums">
        {formatDaysHoursMinutes(summary.remainingMinutes, standardDayMinutes)}
      </span>
      <dl className="leave-balance-card__meta">
        <div>
          {messages.leave.grantedTotalLabel}:{" "}
          <span className="tabular-nums">{formatDaysHoursMinutes(summary.totalGrantedMinutes, standardDayMinutes)}</span>
        </div>
        <div>
          {messages.leave.usedTotalLabel}:{" "}
          <span className="tabular-nums">{formatDaysHoursMinutes(summary.usedMinutes, standardDayMinutes)}</span>
        </div>
      </dl>

      {summary.expiringSoon.length > 0 ? (
        <p className="leave-expiring">
          <span className="leave-expiring__mark" aria-hidden="true">
            ⚠
          </span>{" "}
          {messages.leave.expiringSoonTitle}: {messages.leave.expiringSoonNote}
        </p>
      ) : null}

      <details className="leave-grant-details">
        <summary>{messages.leave.grantBreakdownToggle}</summary>
        <GrantBreakdownTable byGrant={summary.byGrant} standardDayMinutes={standardDayMinutes} />
      </details>
    </div>
  );
}

function mandatoryItemClass(status: MandatoryFiveDaysStatusDto, expired = false): string {
  if (expired) return "leave-mandatory-item leave-mandatory-item--expired";
  return status.satisfied ? "leave-mandatory-item leave-mandatory-item--satisfied" : "leave-mandatory-item leave-mandatory-item--shortage";
}

function MandatoryItem({ status, expired = false }: { status: MandatoryFiveDaysStatusDto; expired?: boolean }) {
  return (
    <li className={mandatoryItemClass(status, expired)}>
      <span className="leave-mandatory-item__period">
        {status.periodStart} 〜 {status.periodEnd}
      </span>
      <span className="leave-mandatory-item__count tabular-nums">
        {messages.leave.mandatoryTakenLabel} {status.taken}
        {messages.leave.mandatoryShortageSuffix} / {messages.leave.mandatoryRequiredLabel} {status.required}
        {messages.leave.mandatoryShortageSuffix}
      </span>
      <span className="leave-mandatory-item__count tabular-nums">
        {messages.leave.mandatoryDeadlineLabel}: {status.deadline}
      </span>
      <span className="leave-mandatory-item__status">
        {expired
          ? messages.leave.mandatoryExpiredLabel
          : status.satisfied
            ? messages.leave.mandatorySatisfied
            : `${messages.leave.mandatoryShortagePrefix}${status.shortage}${messages.leave.mandatoryShortageSuffix}`}
      </span>
    </li>
  );
}

export function LeaveBalancePanel({ balance }: LeaveBalancePanelProps) {
  // 今の期間と次の期間だけを並べる。期限切れの未達は 1 行に畳む(過去分が何行も並ぶと、今やるべきことが埋もれる)。
  const { current, upcoming, expiredShortages } = splitMandatoryFiveDays(balance.mandatoryFiveDays, dateStrFromEpochMinutesJst(nowMinutes()));
  const shown = [...current, ...upcoming];
  return (
    <>
      <section className="leave__section">
        <h2 className="leave__section-title">
          {messages.leave.balanceTitle}
          <HelpTip helpKey="leave.grant" />
        </h2>
        <div className="leave-balance-grid">
          <BalanceCard label={messages.leave.annualLabel} standardDayMinutes={balance.standardDayMinutes} summary={balance.annual} />
          <BalanceCard label={messages.leave.stockedLabel} standardDayMinutes={balance.standardDayMinutes} summary={balance.stocked} />
        </div>
      </section>

      <section className="leave__section">
        <h2 className="leave__section-title">
          {messages.leave.mandatoryTitle}
          <HelpTip helpKey="leave.mandatory-five-days" />
        </h2>

        {shown.length === 0 && expiredShortages.length === 0 ? (
          <p className="correction-form__empty">{messages.leave.mandatoryNone}</p>
        ) : (
          <>
            {shown.length > 0 ? (
              <ul className="leave-mandatory-list">
                {shown.map((status) => (
                  <MandatoryItem key={status.grantId} status={status} />
                ))}
              </ul>
            ) : null}
            {expiredShortages.length > 0 ? (
              <details className="leave-mandatory-expired">
                <summary>{messages.leave.mandatoryExpiredSummary(expiredShortages.length)}</summary>
                <ul className="leave-mandatory-list">
                  {expiredShortages.map((status) => (
                    <MandatoryItem key={status.grantId} status={status} expired />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
