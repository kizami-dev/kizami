import { describe, expect, it } from "vitest";
import { calculateStockConversions } from "../src/stock-conversion.js";
import type { LeaveGrantInput, LeaveUsageInput } from "../src/types.js";

const STANDARD_DAY_MINUTES = 480;

describe("calculateStockConversions", () => {
  const grant: LeaveGrantInput = { id: "g1", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" };

  it("converts the full unused leftover when there is no cap pressure", () => {
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2020-08-01", unit: "full_day", minutes: 480, leaveType: "annual" }, // 1日消化 → 残9日
    ];
    const results = calculateStockConversions([grant], usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-07-01", // 失効日
      alreadyConvertedGrantIds: new Set(),
      stockMaxDays: 40,
      existingStockedDaysTotal: 0,
    });
    expect(results).toEqual([{ sourceGrantId: "g1", leftoverMinutes: 480 * 9, leftoverDays: 9, convertedDays: 9, truncatedDays: 0 }]);
  });

  it("does not convert a grant that has not expired yet as of asOf", () => {
    const results = calculateStockConversions([grant], [], {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-06-30", // 失効前日
      alreadyConvertedGrantIds: new Set(),
      stockMaxDays: 40,
      existingStockedDaysTotal: 0,
    });
    expect(results).toEqual([]);
  });

  it("skips a grant already converted (converted_from_grant_id known) — no double conversion", () => {
    const results = calculateStockConversions([grant], [], {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-07-01",
      alreadyConvertedGrantIds: new Set(["g1"]),
      stockMaxDays: 40,
      existingStockedDaysTotal: 5,
    });
    expect(results).toEqual([]);
  });

  it("truncates conversion at the stock cap and reports the truncated amount", () => {
    const results = calculateStockConversions([grant], [], {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-07-01", // 未消化10日分がまるごと失効
      alreadyConvertedGrantIds: new Set(),
      stockMaxDays: 40,
      existingStockedDaysTotal: 35, // 既に35日保有 → 残り枠5日
    });
    expect(results).toEqual([{ sourceGrantId: "g1", leftoverMinutes: 4800, leftoverDays: 10, convertedDays: 5, truncatedDays: 5 }]);
  });

  it("processes multiple expiring grants in chronological order, consuming the cap sequentially", () => {
    const grantA: LeaveGrantInput = { id: "gA", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" };
    const grantB: LeaveGrantInput = { id: "gB", leaveType: "annual", grantedOn: "2020-08-01", days: 11, expiresOn: "2022-08-01" };
    const results = calculateStockConversions([grantB, grantA], [], {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-09-01",
      alreadyConvertedGrantIds: new Set(),
      stockMaxDays: 15,
      existingStockedDaysTotal: 0,
    });
    // gA(古い方)から優先的に積立てられ、cap 15日のうち gA が10日消費、gB は残り5日のみ変換される
    expect(results.map((r) => r.sourceGrantId)).toEqual(["gA", "gB"]);
    expect(results[0]).toMatchObject({ convertedDays: 10, truncatedDays: 0 });
    expect(results[1]).toMatchObject({ convertedDays: 5, truncatedDays: 6 });
  });
});
