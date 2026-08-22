import { describe, expect, it } from "vitest";
import { calculateStatutoryGrants } from "../src/statutory.js";

describe("calculateStatutoryGrants — statutory (入社日基準)", () => {
  const hireDate = "2020-01-01";

  it("grants nothing before 6 months have elapsed", () => {
    const grants = calculateStatutoryGrants(hireDate, "2020-06-30", "statutory");
    expect(grants).toEqual([]);
  });

  it("grants 10 days exactly at the 6-month mark (boundary, inclusive)", () => {
    const grants = calculateStatutoryGrants(hireDate, "2020-07-01", "statutory");
    expect(grants).toEqual([{ leaveType: "annual", grantedOn: "2020-07-01", days: 10, expiresOn: "2022-07-01" }]);
  });

  it("follows the full statutory table through 6 years 6 months and caps at 20 thereafter", () => {
    // 入社から8年経過時点で確認(6年6ヶ月以降の複数回付与を含む)
    const grants = calculateStatutoryGrants(hireDate, "2028-06-30", "statutory");
    expect(grants.map((g) => g.days)).toEqual([10, 11, 12, 14, 16, 18, 20, 20]);
    expect(grants.map((g) => g.grantedOn)).toEqual([
      "2020-07-01",
      "2021-07-01",
      "2022-07-01",
      "2023-07-01",
      "2024-07-01",
      "2025-07-01",
      "2026-07-01",
      "2027-07-01",
    ]);
  });

  it("sets expiresOn to exactly 2 years after grantedOn for every grant", () => {
    const grants = calculateStatutoryGrants(hireDate, "2023-07-01", "statutory");
    for (const g of grants) {
      const [y, m, d] = g.grantedOn.split("-").map(Number);
      expect(g.expiresOn).toBe(`${(y ?? 0) + 2}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  });

  it("clamps month-end overflow correctly (leap-year hire date)", () => {
    const grants = calculateStatutoryGrants("2020-08-31", "2021-03-01", "statutory");
    // 2020-08-31 + 6ヶ月 = 2021-02-28(2021年2月末日にクランプ、2021年はうるう年でない)
    expect(grants).toEqual([{ leaveType: "annual", grantedOn: "2021-02-28", days: 10, expiresOn: "2023-02-28" }]);
  });
});

describe("calculateStatutoryGrants — fixed_date (基準日方式・全社一斉)", () => {
  it("throws when fixedDateMmDd is missing or malformed", () => {
    expect(() => calculateStatutoryGrants("2020-01-01", "2021-01-01", "fixed_date")).toThrow();
    expect(() => calculateStatutoryGrants("2020-01-01", "2021-01-01", "fixed_date", "13-99")).not.toThrow();
    // フォーマット違反(MM-DD でない)は弾く
    expect(() => calculateStatutoryGrants("2020-01-01", "2021-01-01", "fixed_date", "April 1")).toThrow();
  });

  it("first grant is the earliest basis date on/after hireDate+6mo; subsequent grants annually from the first", () => {
    // 入社 2020-01-10、基準日 4/1。6ヶ月後 = 2020-07-10。以降で最初の4/1 = 2021-04-01(通常の間隔)
    const grants = calculateStatutoryGrants("2020-01-10", "2023-04-01", "fixed_date", "04-01");
    expect(grants.map((g) => g.grantedOn)).toEqual(["2021-04-01", "2022-04-01", "2023-04-01"]);
    expect(grants.map((g) => g.days)).toEqual([10, 11, 12]);
  });

  it("handles a short first interval (hire lands just before the basis date)", () => {
    // 入社 2020-08-20、基準日 3/1。6ヶ月後 = 2021-02-20。以降で最初の3/1 = 2021-03-01
    // → 初回付与までの間隔は約6ヶ月強(通常の基準日方式で起こりうる「初年度が短い」ケース)
    const grants = calculateStatutoryGrants("2020-08-20", "2022-03-01", "fixed_date", "03-01");
    expect(grants.map((g) => g.grantedOn)).toEqual(["2021-03-01", "2022-03-01"]);
    expect(grants.map((g) => g.days)).toEqual([10, 11]);
    // 2回目以降は初回付与日からきっかり1年ずつ(短い初年度の影響を引きずらない)
    expect(grants[1]?.grantedOn).toBe("2022-03-01");
  });

  it("as-of date before the first eligible basis date yields no grants", () => {
    const grants = calculateStatutoryGrants("2020-08-20", "2021-02-28", "fixed_date", "03-01");
    expect(grants).toEqual([]);
  });
});
