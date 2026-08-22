import { describe, expect, it } from "vitest";
import { currentJstMonth, jstCalendarDayWindow } from "../src/time.js";

describe("jstCalendarDayWindow", () => {
  it("covers exactly one day (1439 minutes span)", () => {
    const { from, to } = jstCalendarDayWindow(0);
    expect(to - from).toBe(1439);
  });

  it("places UTC midnight (09:00 JST) inside the same JST day", () => {
    // 2026-08-22T00:00:00Z = 2026-08-22 09:00 JST
    const nowMin = Date.UTC(2026, 7, 22, 0, 0) / 60_000;
    const { from, to } = jstCalendarDayWindow(nowMin);
    expect(nowMin).toBeGreaterThanOrEqual(from);
    expect(nowMin).toBeLessThanOrEqual(to);
  });

  it("puts 23:59 JST and the following 00:00 JST in different JST days", () => {
    // 2026-08-21T14:59:00Z = 2026-08-21 23:59 JST
    const justBefore = Date.UTC(2026, 7, 21, 14, 59) / 60_000;
    // 2026-08-21T15:00:00Z = 2026-08-22 00:00 JST
    const justAfter = Date.UTC(2026, 7, 21, 15, 0) / 60_000;
    const before = jstCalendarDayWindow(justBefore);
    const after = jstCalendarDayWindow(justAfter);
    expect(before.from).not.toBe(after.from);
  });
});

describe("currentJstMonth", () => {
  it("formats as YYYY-MM", () => {
    const nowMin = Date.UTC(2026, 7, 22, 12, 0) / 60_000; // 2026-08-22 21:00 JST
    expect(currentJstMonth(nowMin)).toBe("2026-08");
  });

  it("rolls over to the next month across the JST month boundary", () => {
    // 2026-08-31T15:30:00Z = 2026-09-01 00:30 JST
    const nowMin = Date.UTC(2026, 7, 31, 15, 30) / 60_000;
    expect(currentJstMonth(nowMin)).toBe("2026-09");
  });
});
