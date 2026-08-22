/**
 * 打刻列の解釈ステートマシン(docs/design/v01-data-model.md 「不正打刻列の解釈ルール」)。
 *
 * punches を occurredAt 昇順(同時刻は入力順)で走査し、状態 out / working / onBreak を遷移させながら
 * 実労働セグメント(休憩控除済み・[開始,終了)UTCエポック分)・休憩区間・警告を組み立てる。
 *
 * 「勤務区間」は clock_in で開始し clock_out で確定する 1 まとまりの単位として扱う。
 * 終端で確定しなかった勤務区間(working/onBreak のまま終わる)は、内部で組み立てていた
 * セグメント・休憩をまるごと破棄し missing_clock_out のみを警告する。
 */

import { resolveAttendanceDate } from "./date.js";
import type { CalcWarning, SettingsSpan, ValidPunch, WarningKind, WorkStretch } from "./types.js";

export interface Segment {
  /** UTC エポック分(含む) */
  start: number;
  /** UTC エポック分(含まない) */
  end: number;
}

export interface DeriveResult {
  workedSegments: Segment[];
  breakSegments: Segment[];
  warnings: CalcWarning[];
  /**
   * 出勤〜退勤の勤務区間。missing_clock_out で discard された(集計対象外の)区間も
   * clockOutAt: null として含む — 打刻の事実は集計とは別に表示したいため。
   */
  stretches: WorkStretch[];
}

type State = "out" | "working" | "onBreak";

export function deriveSegments(punches: ValidPunch[], settingsTimeline: SettingsSpan[]): DeriveResult {
  const sorted = [...punches]
    .map((punch, index) => ({ punch, index }))
    .sort((a, b) => a.punch.occurredAt - b.punch.occurredAt || a.index - b.index)
    .map((entry) => entry.punch);

  const workedSegments: Segment[] = [];
  const breakSegments: Segment[] = [];
  const warnings: CalcWarning[] = [];
  const stretches: WorkStretch[] = [];

  const warn = (kind: WarningKind, atMinutes: number) => {
    const { date } = resolveAttendanceDate(atMinutes, settingsTimeline);
    warnings.push({ kind, date, punchAt: atMinutes });
  };

  let state: State = "out";
  let subSegStart: number | null = null;
  let breakStart: number | null = null;
  let stretchStart: number | null = null;
  let stretchSegments: Segment[] = [];
  let stretchBreaks: Segment[] = [];

  const sumMinutes = (segments: Segment[]) => segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);

  const commitStretch = (clockOutAt: number) => {
    for (const seg of stretchSegments) workedSegments.push(seg);
    for (const seg of stretchBreaks) breakSegments.push(seg);
    if (stretchStart !== null) {
      // ここまでに組み立てた stretchSegments/stretchBreaks を合算すれば、この勤務区間の
      // 実労働・休憩がそのまま出る(休憩不足判定 §34-1 は勤怠日ではなくこの単位で行うため必要)。
      stretches.push({
        clockInAt: stretchStart,
        clockOutAt,
        workedMinutes: sumMinutes(stretchSegments),
        breakMinutes: sumMinutes(stretchBreaks),
      });
    }
    stretchSegments = [];
    stretchBreaks = [];
    stretchStart = null;
  };

  const discardStretch = () => {
    if (stretchStart !== null) {
      warn("missing_clock_out", stretchStart);
      // 集計(workedSegments/breakSegments)には含めないが、打刻の事実として stretches には残す。
      // 未退勤は実労働・休憩とも確定していないため workedMinutes/breakMinutes は null
      // (休憩不足判定の対象からも自動的に外れる — break-check.ts 参照)。
      stretches.push({ clockInAt: stretchStart, clockOutAt: null, workedMinutes: null, breakMinutes: null });
    }
    stretchSegments = [];
    stretchBreaks = [];
    stretchStart = null;
  };

  for (const punch of sorted) {
    const at = punch.occurredAt;
    switch (state) {
      case "out": {
        if (punch.kind === "clock_in") {
          state = "working";
          subSegStart = at;
          stretchStart = at;
          stretchSegments = [];
          stretchBreaks = [];
        } else if (punch.kind === "clock_out") {
          warn("clock_out_without_in", at);
        } else {
          // break_start / break_end
          warn("break_outside_work", at);
        }
        break;
      }
      case "working": {
        if (punch.kind === "clock_in") {
          warn("duplicate_clock_in", at);
        } else if (punch.kind === "clock_out") {
          if (subSegStart !== null && at > subSegStart) {
            stretchSegments.push({ start: subSegStart, end: at });
          }
          commitStretch(at);
          state = "out";
          subSegStart = null;
        } else if (punch.kind === "break_start") {
          if (subSegStart !== null && at > subSegStart) {
            stretchSegments.push({ start: subSegStart, end: at });
          }
          breakStart = at;
          subSegStart = null;
          state = "onBreak";
        } else {
          // break_end without a matching break_start
          warn("unmatched_break_end", at);
        }
        break;
      }
      case "onBreak": {
        if (punch.kind === "break_end") {
          if (breakStart !== null) {
            stretchBreaks.push({ start: breakStart, end: at });
          }
          breakStart = null;
          subSegStart = at;
          state = "working";
        } else if (punch.kind === "break_start") {
          warn("duplicate_break_start", at);
        } else if (punch.kind === "clock_in") {
          warn("duplicate_clock_in", at);
        } else {
          // clock_out during break: close the break at clock_out time, then finish the work stretch
          if (breakStart !== null) {
            stretchBreaks.push({ start: breakStart, end: at });
          }
          warn("clock_out_during_break", at);
          breakStart = null;
          commitStretch(at);
          state = "out";
          subSegStart = null;
        }
        break;
      }
    }
  }

  if (state === "working" || state === "onBreak") {
    discardStretch();
  }

  return { workedSegments, breakSegments, warnings, stretches };
}
