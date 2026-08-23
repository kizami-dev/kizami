import { describe, expect, it } from "vitest";
import { computeVariablePeriodRange } from "../src/lib/variable-period.js";

describe("computeVariablePeriodRange", () => {
  it("periodStartDay=16: 3/16〜4/15 が4月の締めに対応する期間", () => {
    expect(computeVariablePeriodRange({ year: 2026, month: 4 }, 16)).toEqual({
      periodStart: "2026-03-16",
      periodEnd: "2026-04-15",
    });
  });

  it("periodStartDay=1: 暦月そのものが期間になる", () => {
    expect(computeVariablePeriodRange({ year: 2026, month: 4 }, 1)).toEqual({
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });
  });

  it("periodStartDay=28: 2/28〜3/27 が3月の締めに対応する期間", () => {
    expect(computeVariablePeriodRange({ year: 2026, month: 3 }, 28)).toEqual({
      periodStart: "2026-02-28",
      periodEnd: "2026-03-27",
    });
  });

  it("年をまたぐケース(1月の締め、periodStartDay=16)", () => {
    expect(computeVariablePeriodRange({ year: 2026, month: 1 }, 16)).toEqual({
      periodStart: "2025-12-16",
      periodEnd: "2026-01-15",
    });
  });
});
