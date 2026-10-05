import { describe, expect, it } from "vitest";
import { isNationalHoliday, isNationalHolidayDataAvailable, NATIONAL_HOLIDAY_DATA_RANGE } from "../src/index.js";

describe("national holidays", () => {
  it("knows fixed-date holidays, substitute holidays and citizens' holidays", () => {
    expect(isNationalHoliday("2026-01-01")).toBe(true); // 元日
    expect(isNationalHoliday("2026-05-06")).toBe(true); // 振替休日(5/3 が日曜)
    expect(isNationalHoliday("2026-09-22")).toBe(true); // 国民の休日(敬老の日と秋分の日に挟まれた日)
    expect(isNationalHoliday("2026-08-11")).toBe(true); // 山の日
    expect(isNationalHoliday("2026-08-12")).toBe(false);
    expect(isNationalHoliday("2020-07-24")).toBe(true); // 五輪特例のスポーツの日
  });

  it("reports the covered range so callers can warn instead of assuming no holidays", () => {
    expect(NATIONAL_HOLIDAY_DATA_RANGE.firstYear).toBe(2000);
    expect(NATIONAL_HOLIDAY_DATA_RANGE.lastYear).toBeGreaterThanOrEqual(2027);
    expect(isNationalHolidayDataAvailable("2027-12-31")).toBe(true);
    expect(isNationalHolidayDataAvailable("1999-12-31")).toBe(false);
    expect(isNationalHolidayDataAvailable(`${NATIONAL_HOLIDAY_DATA_RANGE.lastYear + 1}-01-01`)).toBe(false);
  });
});
