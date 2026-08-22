import { describe, expect, it } from "vitest";
import { deriveSegments } from "../src/derive.js";
import type { CalcSettings, SettingsSpan, ValidPunch } from "../src/types.js";

const settings: CalcSettings = {
  tzOffsetMinutes: 0,
  dayBoundaryMinutes: 0,
  weekStartWeekday: 0,
  legalHoliday: { kind: "weekday", weekday: 0 },
  workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};

const timeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];

function punch(kind: ValidPunch["kind"], occurredAt: number): ValidPunch {
  return { kind, occurredAt };
}

function warningKinds(punches: ValidPunch[]): string[] {
  return deriveSegments(punches, timeline).warnings.map((w) => w.kind);
}

describe("deriveSegments — state machine", () => {
  it("out + clock_in starts a work stretch", () => {
    const result = deriveSegments([punch("clock_in", 0), punch("clock_out", 480)], timeline);
    expect(result.workedSegments).toEqual([{ start: 0, end: 480 }]);
    expect(result.breakSegments).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("working + break_start/break_end splits the work stretch around a break", () => {
    const result = deriveSegments(
      [punch("clock_in", 0), punch("break_start", 180), punch("break_end", 240), punch("clock_out", 480)],
      timeline,
    );
    expect(result.workedSegments).toEqual([
      { start: 0, end: 180 },
      { start: 240, end: 480 },
    ]);
    expect(result.breakSegments).toEqual([{ start: 180, end: 240 }]);
    expect(result.warnings).toEqual([]);
  });

  it("out + clock_out warns clock_out_without_in and produces no segment", () => {
    const result = deriveSegments([punch("clock_out", 100)], timeline);
    expect(result.workedSegments).toEqual([]);
    expect(warningKinds([punch("clock_out", 100)])).toEqual(["clock_out_without_in"]);
  });

  it("out + break_start warns break_outside_work", () => {
    expect(warningKinds([punch("break_start", 100)])).toEqual(["break_outside_work"]);
  });

  it("out + break_end warns break_outside_work", () => {
    expect(warningKinds([punch("break_end", 100)])).toEqual(["break_outside_work"]);
  });

  it("working + clock_in warns duplicate_clock_in and keeps the first clock_in (first wins)", () => {
    const punches = [punch("clock_in", 0), punch("clock_in", 50), punch("clock_out", 100)];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["duplicate_clock_in"]);
    expect(result.workedSegments).toEqual([{ start: 0, end: 100 }]);
  });

  it("working + break_end (no matching break_start) warns unmatched_break_end and does not split", () => {
    const punches = [punch("clock_in", 0), punch("break_end", 50), punch("clock_out", 100)];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["unmatched_break_end"]);
    expect(result.workedSegments).toEqual([{ start: 0, end: 100 }]);
    expect(result.breakSegments).toEqual([]);
  });

  it("onBreak + break_start warns duplicate_break_start and keeps the original break start", () => {
    const punches = [
      punch("clock_in", 0),
      punch("break_start", 50),
      punch("break_start", 70),
      punch("break_end", 100),
      punch("clock_out", 200),
    ];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["duplicate_break_start"]);
    expect(result.breakSegments).toEqual([{ start: 50, end: 100 }]);
    expect(result.workedSegments).toEqual([
      { start: 0, end: 50 },
      { start: 100, end: 200 },
    ]);
  });

  it("onBreak + clock_in warns duplicate_clock_in", () => {
    const punches = [
      punch("clock_in", 0),
      punch("break_start", 50),
      punch("clock_in", 60),
      punch("break_end", 100),
      punch("clock_out", 200),
    ];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["duplicate_clock_in"]);
    expect(result.workedSegments).toEqual([
      { start: 0, end: 50 },
      { start: 100, end: 200 },
    ]);
    expect(result.breakSegments).toEqual([{ start: 50, end: 100 }]);
  });

  it("onBreak + clock_out closes the break at clock_out time and warns clock_out_during_break", () => {
    const punches = [punch("clock_in", 0), punch("break_start", 50), punch("clock_out", 80)];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["clock_out_during_break"]);
    expect(result.workedSegments).toEqual([{ start: 0, end: 50 }]);
    expect(result.breakSegments).toEqual([{ start: 50, end: 80 }]);
  });

  it("terminal working state discards the whole open stretch and warns missing_clock_out", () => {
    const punches = [punch("clock_in", 0), punch("clock_out", 100), punch("clock_in", 150)];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["missing_clock_out"]);
    // Only the completed first stretch is kept; the trailing open clock_in is discarded entirely.
    expect(result.workedSegments).toEqual([{ start: 0, end: 100 }]);
  });

  it("terminal onBreak state discards the whole open stretch (including the started break) and warns missing_clock_out only", () => {
    const punches = [punch("clock_in", 0), punch("break_start", 50)];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["missing_clock_out"]);
    expect(result.workedSegments).toEqual([]);
    expect(result.breakSegments).toEqual([]);
  });

  it("missing_clock_out warning is attributed to the clock_in that opened the unclosed stretch", () => {
    const punches = [punch("clock_in", 0), punch("clock_out", 100), punch("clock_in", 150)];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings).toEqual([{ kind: "missing_clock_out", date: "1970-01-01", punchAt: 150 }]);
  });

  it("sorts punches by occurredAt regardless of input order, preserving input order for exact ties", () => {
    const punches = [punch("clock_out", 100), punch("clock_in", 0)];
    const result = deriveSegments(punches, timeline);
    expect(result.workedSegments).toEqual([{ start: 0, end: 100 }]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps the first punch as effective on an exact-timestamp tie (input order wins)", () => {
    // Two clock_in at the same instant: the first one (input order) opens the stretch,
    // the second is the duplicate.
    const punches = [punch("clock_in", 0), punch("clock_in", 0), punch("clock_out", 100)];
    const result = deriveSegments(punches, timeline);
    expect(result.warnings.map((w) => w.kind)).toEqual(["duplicate_clock_in"]);
    expect(result.workedSegments).toEqual([{ start: 0, end: 100 }]);
  });
});

describe("deriveSegments — stretches (打刻の事実)", () => {
  it("a normal clock_in/clock_out pair produces one stretch", () => {
    const result = deriveSegments([punch("clock_in", 0), punch("clock_out", 480)], timeline);
    expect(result.stretches).toEqual([
      { clockInAt: 0, clockOutAt: 480, workedMinutes: 480, breakMinutes: 0, autoDeductedBreakMinutes: 0 },
    ]);
  });

  it("a break in the middle does not split the stretch (only the segments), and worked/break minutes reflect it", () => {
    const result = deriveSegments(
      [punch("clock_in", 0), punch("break_start", 180), punch("break_end", 240), punch("clock_out", 480)],
      timeline,
    );
    expect(result.stretches).toEqual([
      { clockInAt: 0, clockOutAt: 480, workedMinutes: 420, breakMinutes: 60, autoDeductedBreakMinutes: 0 },
    ]);
  });

  it("multiple clock_in/clock_out cycles in one day produce multiple stretches (中抜け)", () => {
    const punches = [
      punch("clock_in", 0),
      punch("clock_out", 240),
      punch("clock_in", 300),
      punch("clock_out", 480),
    ];
    const result = deriveSegments(punches, timeline);
    expect(result.stretches).toEqual([
      { clockInAt: 0, clockOutAt: 240, workedMinutes: 240, breakMinutes: 0, autoDeductedBreakMinutes: 0 },
      { clockInAt: 300, clockOutAt: 480, workedMinutes: 180, breakMinutes: 0, autoDeductedBreakMinutes: 0 },
    ]);
  });

  it("an unclosed stretch (missing_clock_out) is still included, with clockOutAt/workedMinutes/breakMinutes: null", () => {
    const punches = [punch("clock_in", 0), punch("clock_out", 100), punch("clock_in", 150)];
    const result = deriveSegments(punches, timeline);
    expect(result.stretches).toEqual([
      { clockInAt: 0, clockOutAt: 100, workedMinutes: 100, breakMinutes: 0, autoDeductedBreakMinutes: 0 },
      { clockInAt: 150, clockOutAt: null, workedMinutes: null, breakMinutes: null, autoDeductedBreakMinutes: null },
    ]);
    // 集計(workedSegments)からは除外されるが、stretches には打刻の事実として残る
    expect(result.workedSegments).toEqual([{ start: 0, end: 100 }]);
  });

  it("clock_out during a break still closes the stretch normally", () => {
    const punches = [punch("clock_in", 0), punch("break_start", 50), punch("clock_out", 80)];
    const result = deriveSegments(punches, timeline);
    expect(result.stretches).toEqual([
      { clockInAt: 0, clockOutAt: 80, workedMinutes: 50, breakMinutes: 30, autoDeductedBreakMinutes: 0 },
    ]);
  });

  it("a fully unclosed stretch (missing_clock_out at working, no segments) is still recorded", () => {
    const punches = [punch("clock_in", 0), punch("break_start", 50)];
    const result = deriveSegments(punches, timeline);
    expect(result.stretches).toEqual([
      { clockInAt: 0, clockOutAt: null, workedMinutes: null, breakMinutes: null, autoDeductedBreakMinutes: null },
    ]);
  });
});
