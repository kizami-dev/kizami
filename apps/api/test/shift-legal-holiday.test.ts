import { describe, expect, it } from "vitest";
import { hasSufficientLegalHolidays, type LegalHolidayCheckDay } from "../src/lib/shift-legal-holiday.js";
import { dateFromEpochDay, epochDayFromDate } from "../src/lib/time.js";

// 2026-04-01(水)〜2026-04-30(木)、30日間(periodStartDay=1相当)。
const PERIOD_START = "2026-04-01";
const PERIOD_END = "2026-04-30";

function check(days: LegalHolidayCheckDay[]): boolean {
  return hasSufficientLegalHolidays({ days, periodStart: PERIOD_START, periodEnd: PERIOD_END, epochDayFromDate, dateFromEpochDay });
}

describe("hasSufficientLegalHolidays", () => {
  it("週1日を毎週満たしていれば true", () => {
    // 4つの完全な週(4/1-4/7, 4/8-4/14, 4/15-4/21, 4/22-4/28)それぞれの日曜日を法定休日にする。
    const days: LegalHolidayCheckDay[] = [
      { date: "2026-04-05", dayType: "legal_holiday" }, // 日
      { date: "2026-04-12", dayType: "legal_holiday" },
      { date: "2026-04-19", dayType: "legal_holiday" },
      { date: "2026-04-26", dayType: "legal_holiday" },
    ];
    expect(check(days)).toBe(true);
  });

  it("週1日を満たさない週があるが、4週4日は満たす場合は true", () => {
    // 1週目に休日を置かないが、4週間トータルでは4日ある(2週目に2日集中)。
    const days: LegalHolidayCheckDay[] = [
      { date: "2026-04-08", dayType: "legal_holiday" },
      { date: "2026-04-09", dayType: "legal_holiday" },
      { date: "2026-04-19", dayType: "legal_holiday" },
      { date: "2026-04-26", dayType: "legal_holiday" },
    ];
    expect(check(days)).toBe(true);
  });

  it("週1日も4週4日も満たさなければ false", () => {
    const days: LegalHolidayCheckDay[] = [{ date: "2026-04-05", dayType: "legal_holiday" }];
    expect(check(days)).toBe(false);
  });

  it("shift_days が1件も無ければ false", () => {
    expect(check([])).toBe(false);
  });

  it("work/non_working は法定休日として数えない", () => {
    const days: LegalHolidayCheckDay[] = [
      { date: "2026-04-05", dayType: "non_working" },
      { date: "2026-04-12", dayType: "work" },
    ];
    expect(check(days)).toBe(false);
  });
});
