import { describe, expect, it } from "vitest";
import {
  calculateAttendanceRate,
  estimateCalendarWorkingDates,
  resolveAttendanceRatePeriod,
} from "../src/attendance-rate.js";

describe("resolveAttendanceRatePeriod", () => {
  it("returns [基準日 − 1年, 基準日 − 1日]", () => {
    expect(resolveAttendanceRatePeriod("2026-04-01")).toEqual({ periodFrom: "2025-04-01", periodTo: "2026-03-31" });
  });

  it("clips the start to hireDate for the first grant", () => {
    // 入社 2025-10-01 の初回付与(6ヶ月後 2026-04-01)。算定期間は入社日より前へ遡らない。
    expect(resolveAttendanceRatePeriod("2026-04-01", "2025-10-01")).toEqual({
      periodFrom: "2025-10-01",
      periodTo: "2026-03-31",
    });
  });

  it("keeps the natural start when hireDate is older than one year", () => {
    expect(resolveAttendanceRatePeriod("2026-04-01", "2020-01-01")).toEqual({
      periodFrom: "2025-04-01",
      periodTo: "2026-03-31",
    });
  });
});

describe("estimateCalendarWorkingDates", () => {
  it("excludes the given weekdays (0=日曜)", () => {
    // 2026-08-03(月)〜2026-08-09(日)の1週間。土日を除くと平日5日。
    const dates = estimateCalendarWorkingDates("2026-08-03", "2026-08-09", [0, 6]);
    expect(dates).toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]);
  });

  it("excludes only the legal holiday weekday when that is all the tenant declares", () => {
    const dates = estimateCalendarWorkingDates("2026-08-03", "2026-08-09", [0]);
    expect(dates).toHaveLength(6);
    expect(dates).not.toContain("2026-08-09"); // 日曜
  });

  it("returns an empty array when the period is inverted (hireDate after grantedOn)", () => {
    expect(estimateCalendarWorkingDates("2026-08-10", "2026-08-03", [0, 6])).toEqual([]);
  });
});

describe("calculateAttendanceRate", () => {
  const period = { periodFrom: "2026-08-01", periodTo: "2026-08-10" };

  it("counts attendance days over working days", () => {
    const result = calculateAttendanceRate({
      ...period,
      basis: "shift",
      workingDates: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
      attendedDates: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"],
      paidLeaveDates: [],
    });
    expect(result).toEqual({ ...period, workingDays: 5, attendedDays: 4, rate: 0.8, basis: "shift" });
  });

  it("counts approved paid leave days as attendance (年休取得日は出勤扱い)", () => {
    const result = calculateAttendanceRate({
      ...period,
      basis: "shift",
      workingDates: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
      attendedDates: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"],
      paidLeaveDates: ["2026-08-07"],
    });
    expect(result.attendedDays).toBe(5);
    expect(result.rate).toBe(1);
  });

  it("never counts a day twice when it is both worked and taken as leave", () => {
    const result = calculateAttendanceRate({
      ...period,
      basis: "shift",
      workingDates: ["2026-08-03", "2026-08-04"],
      attendedDates: ["2026-08-03"],
      paidLeaveDates: ["2026-08-03"],
    });
    expect(result.attendedDays).toBe(1);
  });

  it("ignores attendance on days that are not working days (法定休日・非労働日の労働)", () => {
    const result = calculateAttendanceRate({
      ...period,
      basis: "calendar_estimate",
      workingDates: ["2026-08-03", "2026-08-04"],
      attendedDates: ["2026-08-03", "2026-08-04", "2026-08-09"],
      paidLeaveDates: [],
    });
    expect(result.attendedDays).toBe(2);
    expect(result.rate).toBe(1);
  });

  it("ignores dates outside the period on both sides", () => {
    const result = calculateAttendanceRate({
      ...period,
      basis: "calendar_estimate",
      workingDates: ["2026-07-31", "2026-08-03", "2026-08-11"],
      attendedDates: ["2026-07-31", "2026-08-03"],
      paidLeaveDates: [],
    });
    expect(result.workingDays).toBe(1);
    expect(result.attendedDays).toBe(1);
  });

  it("deduplicates repeated working dates", () => {
    const result = calculateAttendanceRate({
      ...period,
      basis: "shift",
      workingDates: ["2026-08-03", "2026-08-03", "2026-08-04"],
      attendedDates: [],
      paidLeaveDates: [],
    });
    expect(result.workingDays).toBe(2);
  });

  it("returns rate=null (not 0) when there are no working days at all", () => {
    const result = calculateAttendanceRate({
      ...period,
      basis: "shift",
      workingDates: [],
      attendedDates: ["2026-08-03"],
      paidLeaveDates: [],
    });
    expect(result).toEqual({ ...period, workingDays: 0, attendedDays: 0, rate: null, basis: "shift" });
  });
});
