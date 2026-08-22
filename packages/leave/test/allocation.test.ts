import { describe, expect, it } from "vitest";
import { allocateLeaveUsages } from "../src/allocation.js";
import { calculateBalance } from "../src/balance.js";
import { hourlyLeaveCapMinutes } from "../src/hourly.js";
import { resolveUsageMinutes } from "../src/usage-minutes.js";
import type { LeaveGrantInput, LeaveUsageInput } from "../src/types.js";

const STANDARD_DAY_MINUTES = 480; // 8時間(端数のないケース)

describe("resolveUsageMinutes", () => {
  it("full_day = standardDayMinutes", () => {
    expect(resolveUsageMinutes("full_day", 480)).toBe(480);
  });

  it("half_day_am/pm = standardDayMinutes/2, not floored (例: 450 → 225)", () => {
    expect(resolveUsageMinutes("half_day_am", 450)).toBe(225);
    expect(resolveUsageMinutes("half_day_pm", 450)).toBe(225);
  });

  it("hourly uses the explicit minutes and rejects missing/non-positive values", () => {
    expect(resolveUsageMinutes("hourly", 480, 120)).toBe(120);
    expect(() => resolveUsageMinutes("hourly", 480)).toThrow();
    expect(() => resolveUsageMinutes("hourly", 480, 0)).toThrow();
    expect(() => resolveUsageMinutes("hourly", 480, -30)).toThrow();
  });
});

describe("allocateLeaveUsages — FIFO・時効・繰越", () => {
  const grants: LeaveGrantInput[] = [
    { id: "g1", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" },
    { id: "g2", leaveType: "annual", grantedOn: "2021-07-01", days: 11, expiresOn: "2023-07-01" },
  ];

  it("consumes the oldest grant first (FIFO)", () => {
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2021-08-01", unit: "full_day", minutes: STANDARD_DAY_MINUTES, leaveType: "annual" },
    ];
    const result = allocateLeaveUsages(grants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2021-08-01",
    });
    expect(result.usages).toEqual([{ usageId: "u1", grantId: "g1" }]);
    const g1 = result.byGrant.find((g) => g.id === "g1");
    expect(g1?.usedMinutes).toBe(480);
    expect(g1?.remainingMinutes).toBe(480 * 9);
  });

  it("carries over unused balance from the older grant into the total remaining until it expires (繰越)", () => {
    // g1 は10日中3日しか使っていない状態(繰越7日分)。g1 が時効を迎える直前の時点では
    // g1 + g2 の残高が合算される。
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2020-08-01", unit: "full_day", minutes: STANDARD_DAY_MINUTES, leaveType: "annual" },
      { id: "u2", date: "2020-09-01", unit: "full_day", minutes: STANDARD_DAY_MINUTES, leaveType: "annual" },
      { id: "u3", date: "2020-10-01", unit: "full_day", minutes: STANDARD_DAY_MINUTES, leaveType: "annual" },
    ];
    const balance = calculateBalance(grants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-06-30", // g1 の時効(2022-07-01)の前日
    });
    // g1 remaining = (10-3)*480 = 3360, g2 remaining = 11*480 = 5280 → 合計 8640
    expect(balance.annual.remainingMinutes).toBe(3360 + 5280);
  });

  it("expires a grant exactly on its expiresOn date (asOf == expiresOn → remaining forfeited)", () => {
    const balanceBefore = calculateBalance(grants, [], {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-06-30",
    });
    const g1Before = balanceBefore.annual.byGrant.find((g) => g.id === "g1");
    expect(g1Before?.expired).toBe(false);
    expect(g1Before?.remainingMinutes).toBe(480 * 10);

    const balanceOn = calculateBalance(grants, [], {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-07-01",
    });
    const g1On = balanceOn.annual.byGrant.find((g) => g.id === "g1");
    expect(g1On?.expired).toBe(true);
    expect(g1On?.remainingMinutes).toBe(0);
    // g2 は未失効なので残高は g2 分のみ
    expect(balanceOn.annual.remainingMinutes).toBe(480 * 11);
  });

  it("reports expiringSoon for grants within the lookahead window", () => {
    const balance = calculateBalance(grants, [], {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2022-05-15", // g1 失効(2022-07-01)まで47日
      expiringSoonWithinDays: 60,
    });
    expect(balance.annual.expiringSoon.map((g) => g.id)).toEqual(["g1"]);
  });

  it("reports no_capacity when total remaining is insufficient", () => {
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2020-07-02", unit: "full_day", minutes: 480 * 21, leaveType: "annual" }, // 全付与合計(21日)を超える単発消化
    ];
    const result = allocateLeaveUsages(grants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2020-07-02",
    });
    expect(result.usages).toEqual([{ usageId: "u1", grantId: null, reason: "no_capacity" }]);
  });

  it("annual and stocked pools are independent (a stocked usage never draws from an annual grant)", () => {
    const mixedGrants: LeaveGrantInput[] = [
      { id: "a1", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" },
      { id: "s1", leaveType: "stocked", grantedOn: "2020-07-01", days: 5, expiresOn: "9999-12-31" },
    ];
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2020-08-01", unit: "full_day", minutes: 480, leaveType: "stocked" },
    ];
    const result = allocateLeaveUsages(mixedGrants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2020-08-01",
    });
    expect(result.usages).toEqual([{ usageId: "u1", grantId: "s1" }]);
    const annualState = result.byGrant.find((g) => g.id === "a1");
    expect(annualState?.usedMinutes).toBe(0);
  });
});

describe("allocateLeaveUsages — 時間単位年休の年度上限(2026-08-22訂正: 1時間切り上げ・繰越込み)", () => {
  it("caps at ceil(standardDayMinutes/60)*60*maxDays, not standardDayMinutes*maxDays (所定450分の例)", () => {
    // 所定450分(7時間30分) → 1日分は8時間(480分)に切り上げ。上限日数5日 → 2400分(2250分ではない)
    expect(hourlyLeaveCapMinutes(450, 5)).toBe(2400);
  });

  it("respects a tenant-configured max days lower than the statutory default of 5", () => {
    expect(hourlyLeaveCapMinutes(450, 3)).toBe(1440); // 8h × 3日
  });

  it("rejects an hourly usage that would push the fiscal-year total over the cap, even though grant capacity remains", () => {
    const grants: LeaveGrantInput[] = [
      { id: "g1", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" },
      { id: "g2", leaveType: "annual", grantedOn: "2021-07-01", days: 11, expiresOn: "2023-07-01" },
    ];
    // g2 の年度([2021-07-01, 2022-07-01))内の2件の時間単位申請。cap=2400分(8h×5)
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2021-07-10", unit: "hourly", minutes: 2000, leaveType: "annual" },
      { id: "u2", date: "2021-07-20", unit: "hourly", minutes: 500, leaveType: "annual" }, // 合計2500 > 2400
    ];
    const result = allocateLeaveUsages(grants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2021-08-01",
    });
    // u1 は g1(繰越分、FIFOで先頭)から充当される。g1 の残余は 4800分あり u1 の2000分は
    // 楽々収まるので u1 は成功する。
    expect(result.usages[0]).toEqual({ usageId: "u1", grantId: "g1" });
    // u2 は「付与としての残余」は十分あるが(g1 残り2800分)、年度上限(2400分)を超えるため拒否される。
    expect(result.usages[1]).toEqual({ usageId: "u2", grantId: null, reason: "hourly_limit_exceeded" });
  });

  it("counts carried-over (previous grant's) hourly usage toward the current fiscal year's cap", () => {
    // 前年度に付与された g1(繰越中)から、当年度(g2の期間)内の日付で時間単位取得した分も
    // 当年度の上限に合算される、という仕様そのものを上のテストで検証済み。
    // ここでは逆に「上限ちょうど」で成功することを確認する。
    const grants: LeaveGrantInput[] = [
      { id: "g1", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" },
      { id: "g2", leaveType: "annual", grantedOn: "2021-07-01", days: 11, expiresOn: "2023-07-01" },
    ];
    const usages: LeaveUsageInput[] = [
      { id: "u1", date: "2021-07-10", unit: "hourly", minutes: 2400, leaveType: "annual" }, // ちょうど上限
    ];
    const result = allocateLeaveUsages(grants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2021-08-01",
    });
    expect(result.usages).toEqual([{ usageId: "u1", grantId: "g1" }]);
  });

  it("half-day and full-day usages do not consume the hourly-only cap", () => {
    const grants: LeaveGrantInput[] = [
      { id: "g1", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" },
    ];
    const usages: LeaveUsageInput[] = [
      // 時間単位を上限ちょうどまで使い切る
      { id: "u1", date: "2020-07-05", unit: "hourly", minutes: 2400, leaveType: "annual" },
      // 上限を使い切った後でも、半休・全休は上限判定の対象外なので問題なく充当される
      { id: "u2", date: "2020-07-06", unit: "half_day_am", minutes: 240, leaveType: "annual" },
      { id: "u3", date: "2020-07-07", unit: "full_day", minutes: 480, leaveType: "annual" },
    ];
    const result = allocateLeaveUsages(grants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2020-07-10",
    });
    expect(result.usages.every((u) => u.grantId === "g1")).toBe(true);
  });

  it("both a morning and an afternoon half-day request on the same date succeed and sum to a full day's minutes", () => {
    const grants: LeaveGrantInput[] = [
      { id: "g1", leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" },
    ];
    const usages: LeaveUsageInput[] = [
      { id: "am", date: "2020-08-01", unit: "half_day_am", minutes: 240, leaveType: "annual" },
      { id: "pm", date: "2020-08-01", unit: "half_day_pm", minutes: 240, leaveType: "annual" },
    ];
    const result = allocateLeaveUsages(grants, usages, {
      standardDayMinutes: STANDARD_DAY_MINUTES,
      hourlyLeaveMaxDays: 5,
      asOf: "2020-08-01",
    });
    expect(result.usages.every((u) => u.grantId === "g1")).toBe(true);
    const g1 = result.byGrant.find((g) => g.id === "g1");
    expect(g1?.usedMinutes).toBe(480); // 240 + 240 = 1日分
  });
});
