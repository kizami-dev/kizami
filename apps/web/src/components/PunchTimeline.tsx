import type { CSSProperties } from "react";
import type { Punch, PunchKind } from "../lib/api";
import { messages } from "../lib/messages";

/**
 * 今日の打刻を 0〜24 時の時間軸に打つ装飾図(打刻画面「今日の打刻」)。
 *
 * 細い K の罫線を時間軸にし、出勤(C)・休憩(Y)・退勤(M)を見当合わせトンボ(出勤=空の円、
 * 休憩=四角、退勤=塗りの円。いずれも十字つき)で時刻の位置に打つ。色だけに頼らず形でも区別する。いまの時刻には点線の縦線を引く。時刻そのものはこの図に頼らず、隣のリスト
 * (.tombo-row__list)がテキストで持つため、図全体は aria-hidden の装飾。
 *
 * 軸の始点は 0 時固定。打刻の取得窓(lib/time.ts の jstTodayWindow)が JST の暦日 0 時起点で、
 * テナントの日界(dayBoundaryMinutes)はこの画面に届いていないため、日界には合わせていない。
 *
 * 近い時刻のトンボは重ならないよう縦に段(lane)をずらし、軸へ細い支線で結ぶ。
 */

const DAY_MINUTES = 1440;
const TICK_HOURS = [0, 6, 12, 18, 24] as const;
/** この間隔(軸の全幅に対する割合 %)より近いトンボは次の段へずらす。スマホ幅でトンボ(約 24px)が重ならない値。 */
const MIN_GAP_PERCENT = 8;
const MAX_LANES = 4;

function variantOf(kind: PunchKind): "in" | "break" | "out" {
  if (kind === "clock_in") return "in";
  if (kind === "clock_out") return "out";
  return "break";
}

export interface PunchTimelineProps {
  punches: Punch[];
  /** 今日 0 時(JST)の UTC エポック分 */
  dayStart: number;
  /** 現在の UTC エポック分 */
  nowMin: number;
}

interface Mark {
  id: string;
  percent: number;
  lane: number;
  variant: "in" | "break" | "out";
}

function layoutMarks(punches: Punch[], dayStart: number): Mark[] {
  const sorted = [...punches].sort((a, b) => a.occurredAt - b.occurredAt);
  const laneLast: number[] = [];
  return sorted.map((p) => {
    const percent = Math.min(100, Math.max(0, ((p.occurredAt - dayStart) / DAY_MINUTES) * 100));
    let lane = laneLast.findIndex((last) => percent - last >= MIN_GAP_PERCENT);
    if (lane === -1) lane = laneLast.length < MAX_LANES ? laneLast.length : MAX_LANES - 1;
    laneLast[lane] = percent;
    return { id: p.id, percent, lane, variant: variantOf(p.kind) };
  });
}

/**
 * 見当合わせトンボ(十字つきの印)。色は親の color(--chip-color)に追従する。
 * 色が見分けにくい人のため、種類を形でも変える: 出勤=空の円、休憩=四角、退勤=塗りの円。
 */
function RegistrationMark({ variant }: { variant: "in" | "break" | "out" }) {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      {variant === "break" ? (
        <rect x="4.75" y="4.75" width="10.5" height="10.5" fill="var(--k-surface)" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <circle
          cx="10"
          cy="10"
          r="5.5"
          fill={variant === "out" ? "currentColor" : "var(--k-surface)"}
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
      <path d="M10 1v18M1 10h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
      {variant === "out" ? <circle cx="10" cy="10" r="1.5" fill="var(--k-surface)" /> : null}
    </svg>
  );
}

export function PunchTimeline({ punches, dayStart, nowMin }: PunchTimelineProps) {
  const marks = layoutMarks(punches, dayStart);
  const lanes = Math.max(1, ...marks.map((m) => m.lane + 1));
  const nowPercent = Math.min(100, Math.max(0, ((nowMin - dayStart) / DAY_MINUTES) * 100));
  const nowAlign = nowPercent > 88 ? "end" : nowPercent < 12 ? "start" : "center";

  return (
    <div className="punch-timeline" aria-hidden="true" style={{ "--tl-lanes": lanes } as CSSProperties}>
      <div className="punch-timeline__plot">
        <span className="punch-timeline__now" data-align={nowAlign} style={{ left: `${nowPercent}%` }}>
          <span className="punch-timeline__now-label">{messages.today.nowLabel}</span>
        </span>
        <span className="punch-timeline__axis" />
        {TICK_HOURS.map((h) => (
          <span key={h} className="punch-timeline__tick" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {marks.map((m) => (
          <span
            key={m.id}
            className={`punch-timeline__mark punch-timeline__mark--${m.variant}`}
            style={{ left: `${m.percent}%`, "--tl-lane": m.lane } as CSSProperties}
          >
            <RegistrationMark variant={m.variant} />
          </span>
        ))}
      </div>
      <div className="punch-timeline__scale">
        {TICK_HOURS.map((h) => (
          <span key={h} className="punch-timeline__scale-label tabular-nums" style={{ left: `${(h / 24) * 100}%` }}>
            {h}:00
          </span>
        ))}
      </div>
    </div>
  );
}
