import { describe, expect, it } from "vitest";
import { checkMandatoryFiveDays } from "../src/mandatory-five-days.js";
import type { LeaveGrantInput, LeaveUsageInput } from "../src/types.js";

describe("checkMandatoryFiveDays", () => {
  const grant10: LeaveGrantInput = { id: "g1", leaveType: "annual", grantedOn: "2024-04-01", days: 10, expiresOn: "2026-04-01" };

  it("ignores grants with fewer than 10 days (not subject to the obligation)", () => {
    const grant9: LeaveGrantInput = { id: "g0", leaveType: "annual", grantedOn: "2024-04-01", days: 9, expiresOn: "2026-04-01" };
    const statuses = checkMandatoryFiveDays([grant9], [], "2024-06-01");
    expect(statuses).toEqual([]);
  });

  it("returns shortage 2 (5 - 3 taken) with the correct deadline when only 3 full days were taken", () => {
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2024-05-01", unit: "full_day", minutes: 480, leaveType: "annual" },
      { id: "u2", date: "2024-06-01", unit: "full_day", minutes: 480, leaveType: "annual" },
      { id: "u3", date: "2024-07-01", unit: "full_day", minutes: 480, leaveType: "annual" },
    ];
    const statuses = checkMandatoryFiveDays([grant10], usages, "2025-01-01");
    expect(statuses).toEqual([
      {
        grantId: "g1",
        periodStart: "2024-04-01",
        periodEnd: "2025-04-01",
        taken: 3,
        required: 5,
        shortage: 2,
        deadline: "2025-04-01",
        satisfied: false,
      },
    ]);
  });

  it("is satisfied once 5 full days are taken within the period", () => {
    const usages: LeaveUsageInput[] = Array.from({ length: 5 }, (_, i) => ({
      id: `u${i}`,
      date: `2024-0${i + 4}-01`,
      unit: "full_day" as const,
      minutes: 480,
      leaveType: "annual" as const,
    }));
    const statuses = checkMandatoryFiveDays([grant10], usages, "2024-09-01");
    expect(statuses[0]?.satisfied).toBe(true);
    expect(statuses[0]?.shortage).toBe(0);
  });

  it("counts a half-day as 0.5: 10 half-day takings satisfy the 5-day obligation exactly", () => {
    const usages: LeaveUsageInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`,
      date: `2024-04-${String(2 + i).padStart(2, "0")}`,
      unit: "half_day_am" as const,
      minutes: 240,
      leaveType: "annual" as const,
    }));
    const statuses = checkMandatoryFiveDays([grant10], usages, "2024-05-01");
    expect(statuses[0]?.taken).toBe(5);
    expect(statuses[0]?.satisfied).toBe(true);
  });

  it("hourly usage does not count toward the obligation at all, even at the 5-day-equivalent volume", () => {
    // 40時間(所定8h×5日相当)を時間単位で取得しても義務は一切満たされない
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2024-04-10", unit: "hourly", minutes: 2400, leaveType: "annual" },
    ];
    const statuses = checkMandatoryFiveDays([grant10], usages, "2024-05-01");
    expect(statuses[0]?.taken).toBe(0);
    expect(statuses[0]?.shortage).toBe(5);
    expect(statuses[0]?.satisfied).toBe(false);
  });

  it("morning + afternoon half-days on the same date sum to 1.0 day", () => {
    const usages: LeaveUsageInput[] = [
      { id: "am", date: "2024-04-10", unit: "half_day_am", minutes: 240, leaveType: "annual" },
      { id: "pm", date: "2024-04-10", unit: "half_day_pm", minutes: 240, leaveType: "annual" },
    ];
    const statuses = checkMandatoryFiveDays([grant10], usages, "2024-05-01");
    expect(statuses[0]?.taken).toBe(1);
  });

  it("excludes usages outside the [grantedOn, grantedOn+1y) window and stocked-type usages", () => {
    const usages: LeaveUsageInput[] = [
      { id: "before", date: "2024-03-31", unit: "full_day", minutes: 480, leaveType: "annual" },
      { id: "onEnd", date: "2025-04-01", unit: "full_day", minutes: 480, leaveType: "annual" }, // periodEnd 自体は排他的
      { id: "stocked", date: "2024-05-01", unit: "full_day", minutes: 480, leaveType: "stocked" },
    ];
    const statuses = checkMandatoryFiveDays([grant10], usages, "2025-04-01");
    expect(statuses[0]?.taken).toBe(0);
  });

  /**
   * 比例付与(2026-08-24 追加)との境界。年5日取得義務は「その付与が10日以上か」だけで決まり
   * (労基法39条7項)、比例付与かどうかは条件ではない。週4日区分の 3年6ヶ月 は10日なので対象、
   * 2年6ヶ月 は9日なので対象外 — この判定は grants[].days に対して行われている必要がある。
   */
  it("proportional grants are judged by days alone: days4 at 3年6ヶ月 (10日) is subject, at 2年6ヶ月 (9日) is not", () => {
    const days4At30Months: LeaveGrantInput = { id: "g-9", leaveType: "annual", grantedOn: "2024-04-01", days: 9, expiresOn: "2026-04-01" };
    const days4At42Months: LeaveGrantInput = { id: "g-10", leaveType: "annual", grantedOn: "2025-04-01", days: 10, expiresOn: "2027-04-01" };

    const statuses = checkMandatoryFiveDays([days4At30Months, days4At42Months], [], "2025-06-01");
    expect(statuses.map((s) => s.grantId)).toEqual(["g-10"]);
    expect(statuses[0]?.required).toBe(5);
    expect(statuses[0]?.shortage).toBe(5);
  });

  it("right before the deadline: shortage reflects the exact remaining gap", () => {
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2024-04-01", unit: "full_day", minutes: 480, leaveType: "annual" },
      { id: "u2", date: "2024-05-01", unit: "full_day", minutes: 480, leaveType: "annual" },
      { id: "u3", date: "2024-06-01", unit: "full_day", minutes: 480, leaveType: "annual" },
      { id: "u4", date: "2024-07-01", unit: "full_day", minutes: 480, leaveType: "annual" },
    ];
    const statuses = checkMandatoryFiveDays([grant10], usages, "2025-03-31"); // 期限(2025-04-01)前日
    expect(statuses[0]?.taken).toBe(4);
    expect(statuses[0]?.shortage).toBe(1);
    expect(statuses[0]?.satisfied).toBe(false);
  });
});
