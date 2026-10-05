"use client";

import { type FlexBalance, type MonthlyAttendance } from "../../lib/api";
import { messages } from "../../lib/messages";
import { formatDurationHm } from "../../lib/time";
import { HelpTip } from "../HelpTip";

/**
 * 36協定・原則(限度時間)の月あたり上限: 45時間(労基法36条4項)。
 * 特別条項による延長(年720時間等の例外上限)はここでは扱わない — 固定時間制のフレックス収支
 * バー置き換え(ui-direction.md「月次」節)は「原則の限度に対する位置」を示すためのもので、
 * 特別条項の適用有無はテナント側の36協定運用に依存し月次一覧単体では判定できないため。
 */
const AGREEMENT36_MONTHLY_LIMIT_MINUTES = 45 * 60;

export interface WorkloadBarProps {
  data: MonthlyAttendance;
}

/**
 * フレックス収支バー(フレックスの場合)/ 36協定の月45時間に対する時間外の位置バー
 * (固定時間制の場合)/ 期間の法定総枠に対する実労働バー(monthly_variable の場合、2026-08-24 追加)。
 * MonthlyView から切り出したもの(挙動不変、第3波分割)。
 */
export function WorkloadBar({ data }: WorkloadBarProps) {
  const flex = data.figures.flexBalance;
  const flexPercent = flex && flex.frameMinutes > 0 ? Math.min(100, Math.max(0, (flex.actualMinutes / flex.frameMinutes) * 100)) : 0;

  // 固定時間制: フレックス収支バーと同じ見た目で「36協定 月45時間に対する時間外の位置」を出す
  // (ui-direction.md「月次」節「フレックス収支バーの置き換え」)。
  const overtimeMinutes = data.figures.totals.overtime;
  const overtimeOverLimit = Math.max(0, overtimeMinutes - AGREEMENT36_MONTHLY_LIMIT_MINUTES);
  const overtimePercent = Math.min(100, Math.max(0, (overtimeMinutes / AGREEMENT36_MONTHLY_LIMIT_MINUTES) * 100));

  if (data.workSystem === "monthly_variable") {
    const vp = data.figures.variablePeriod;
    // 締め済み月(source: "snapshot")は variablePeriod が常に null(決定事項3)。
    if (!vp) {
      return (
        <div className="flex-balance">
          <span className="flex-balance__label">
            {messages.monthly.variablePeriodBarLabel}
            <HelpTip helpKey="attendance.work-system" />
          </span>
          <p className="attendance-settings__field-hint">{messages.monthly.variablePeriodUnavailableNote}</p>
        </div>
      );
    }
    const workedPercent = vp.statutoryFrameMinutes > 0 ? Math.min(100, Math.max(0, (vp.workedTotalMinutes / vp.statutoryFrameMinutes) * 100)) : 0;
    const overFrame = Math.max(0, vp.workedTotalMinutes - vp.statutoryFrameMinutes);
    return (
      <div className="flex-balance">
        <span className="flex-balance__label">
          {messages.monthly.variablePeriodBarLabel}
          <HelpTip helpKey="attendance.work-system" />
        </span>
        <div
          className={`flex-balance__track${overFrame > 0 ? " flex-balance__track--over" : ""}`}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={vp.statutoryFrameMinutes}
          aria-valuenow={vp.workedTotalMinutes}
          aria-label={messages.monthly.variablePeriodBarLabel}
        >
          <div className="flex-balance__fill" style={{ width: `${workedPercent}%` }} />
        </div>
        <div className="flex-balance__numbers tabular-nums">
          <span>
            {formatDurationHm(vp.workedTotalMinutes)} / {formatDurationHm(vp.statutoryFrameMinutes)} {messages.monthly.variablePeriodBarUnit}
          </span>
          <span className={overFrame > 0 ? "flex-balance__diff--negative" : "flex-balance__diff--positive"}>
            {overFrame > 0
              ? `+${formatDurationHm(overFrame)} ${messages.monthly.variablePeriodBarOverLabel}`
              : `${messages.monthly.variablePeriodBarRemainingLabel} ${formatDurationHm(vp.statutoryFrameMinutes - vp.workedTotalMinutes)}`}
          </span>
        </div>
        <p className="attendance-settings__field-hint tabular-nums">
          {messages.monthly.variablePeriodRangeLabel(vp.periodStart, vp.periodEnd)} / {messages.monthly.variablePeriodScheduledLabel}:{" "}
          {formatDurationHm(vp.scheduledTotalMinutes)}
        </p>
        {!vp.attributedToThisMonth ? <p className="attendance-settings__field-hint">{messages.monthly.variablePeriodNotAttributedNote}</p> : null}
      </div>
    );
  }

  return data.workSystem === "flex" ? (
    <div className="flex-balance">
      <span className="flex-balance__label">
        {messages.monthly.flexBalanceLabel}
        <HelpTip helpKey="attendance.flex-frame" />
      </span>
      <div
        className="flex-balance__track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={flex?.frameMinutes ?? 0}
        aria-valuenow={flex?.actualMinutes ?? 0}
        aria-label={messages.monthly.flexBalanceLabel}
      >
        <div className="flex-balance__fill" style={{ width: `${flexPercent}%` }} />
      </div>
      <div className="flex-balance__numbers tabular-nums">
        <span>
          {formatDurationHm(flex?.actualMinutes ?? 0)} / {formatDurationHm(flex?.frameMinutes ?? 0)}{" "}
          {messages.monthly.flexBalanceUnit}
        </span>
        <span className={(flex?.diffMinutes ?? 0) < 0 ? "flex-balance__diff--short" : "flex-balance__diff--positive"}>
          {(flex?.diffMinutes ?? 0) >= 0 ? "+" : ""}
          {formatDurationHm(flex?.diffMinutes ?? 0)}
          {(flex?.diffMinutes ?? 0) < 0 ? ` ${messages.monthly.flexShortLabel}` : ""}
        </span>
      </div>
      {flex && flex.contractFrameMinutes !== null ? <FlexContractBreakdown flex={flex} overtimeMinutes={data.figures.totals.overtime} /> : null}
    </div>
  ) : (
    <div className="flex-balance">
      <span className="flex-balance__label">
        {messages.monthly.overtimeBarLabel}
        <HelpTip helpKey="agreement36.limits" />
      </span>
      <div
        className={`flex-balance__track${overtimeOverLimit > 0 ? " flex-balance__track--over" : ""}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={AGREEMENT36_MONTHLY_LIMIT_MINUTES}
        aria-valuenow={overtimeMinutes}
        aria-label={messages.monthly.overtimeBarLabel}
      >
        <div className="flex-balance__fill" style={{ width: `${overtimePercent}%` }} />
      </div>
      <div className="flex-balance__numbers tabular-nums">
        <span>
          {formatDurationHm(overtimeMinutes)} / {formatDurationHm(AGREEMENT36_MONTHLY_LIMIT_MINUTES)}{" "}
          {messages.monthly.overtimeBarUnit}
        </span>
        <span className={overtimeOverLimit > 0 ? "flex-balance__diff--negative" : "flex-balance__diff--positive"}>
          {overtimeOverLimit > 0
            ? `+${formatDurationHm(overtimeOverLimit)} ${messages.monthly.overtimeBarOverLabel}`
            : `${messages.monthly.overtimeBarRemainingLabel} ${formatDurationHm(AGREEMENT36_MONTHLY_LIMIT_MINUTES - overtimeMinutes)}`}
        </span>
      </div>
    </div>
  );
}

/**
 * フレックスの内訳(2026-10-05、契約上の枠)。総労働時間の決め方が「所定日数 × 標準時間」の
 * 制度のときだけ、収支バーの下に3段の区分(枠内 → 法定内超過 → 法定外)と繰越をチップで並べる。
 * 収支バー自体は「実績 / 枠(契約上の枠 + 前月からの繰越)」のまま。法定の枠の制度では出さない
 * (従来の表示を変えないため。繰越・法定内超過は常に0)。
 *
 * 繰越の受け入れ・送り出しは0のときは出さない(繰り越さない制度や、繰越の無い月で並びを増やさない)。
 * 法定外は totals.overtime(区分別合計の「残業」と同じ値)を、ここでは3段の最後として並べ直す。
 */
function FlexContractBreakdown({ flex, overtimeMinutes }: { flex: FlexBalance; overtimeMinutes: number }) {
  const m = messages.monthly;
  const chips: Array<{ key: string; label: string; minutes: number; tone?: "short" | "overtime" }> = [
    { key: "contract", label: m.flexContractFrameLabel, minutes: flex.contractFrameMinutes ?? 0 },
    ...(flex.carryInMinutes > 0 ? [{ key: "carryIn", label: m.flexCarryInLabel, minutes: flex.carryInMinutes }] : []),
    { key: "statutory", label: m.flexStatutoryFrameLabel, minutes: flex.statutoryFrameMinutes },
    { key: "excess", label: m.flexWithinStatutoryExcessLabel, minutes: flex.withinStatutoryExcessMinutes },
    { key: "overtime", label: m.flexOvertimeLabel, minutes: overtimeMinutes, tone: "overtime" as const },
    ...(flex.carryOutMinutes > 0 ? [{ key: "carryOut", label: m.flexCarryOutLabel, minutes: flex.carryOutMinutes }] : []),
    { key: "confirmed", label: m.flexConfirmedShortfallLabel, minutes: flex.confirmedShortfallMinutes, tone: "short" as const },
  ];
  return (
    <div className="flex-balance__breakdown" data-testid="flex-contract-breakdown">
      <p className="field__hint">
        {m.flexContractBasisNote}
        <HelpTip helpKey="attendance.flex-contract" />
      </p>
      <div className="totals-row">
        {chips.map((chip) => (
          <span
            key={chip.key}
            className={`totals-chip${chip.tone === "overtime" ? " totals-chip--overtime" : ""}${chip.tone === "short" && chip.minutes > 0 ? " totals-chip--short" : ""}`}
          >
            <span className="totals-chip__label">{chip.label}</span>
            <span className="totals-chip__value tabular-nums">{formatDurationHm(chip.minutes)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
