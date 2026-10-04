import { describe, expect, it } from "vitest";
import type { MandatoryFiveDaysStatusDto } from "../src/lib/api";
import { splitMandatoryFiveDays } from "../src/lib/mandatory-five-days";

function m(grantId: string, periodStart: string, periodEnd: string, satisfied: boolean): MandatoryFiveDaysStatusDto {
  return { grantId, periodStart, periodEnd, taken: satisfied ? 5 : 0, required: 5, shortage: satisfied ? 0 : 5, deadline: periodEnd, satisfied };
}

describe("splitMandatoryFiveDays", () => {
  const today = "2026-10-05";
  const list = [
    m("old-miss", "2020-04-01", "2021-04-01", false),
    m("old-ok", "2021-04-01", "2022-04-01", true),
    m("older-miss", "2019-04-01", "2020-04-01", false),
    m("now", "2026-04-01", "2027-04-01", false),
    m("next", "2027-04-01", "2028-04-01", false),
  ];

  it("今の期間・次の期間・期限切れの未達に分ける", () => {
    const r = splitMandatoryFiveDays(list, today);
    expect(r.current.map((x) => x.grantId)).toEqual(["now"]);
    expect(r.upcoming.map((x) => x.grantId)).toEqual(["next"]);
    expect(r.expiredShortages.map((x) => x.grantId)).toEqual(["old-miss", "older-miss"]);
  });

  it("期限の当日は期限切れ(deadline は排他的上限)", () => {
    const r = splitMandatoryFiveDays([m("edge", "2025-10-05", "2026-10-05", false)], today);
    expect(r.current).toEqual([]);
    expect(r.expiredShortages).toHaveLength(1);
  });

  it("達成済みの過去分は表示しない", () => {
    const r = splitMandatoryFiveDays([m("old-ok", "2021-04-01", "2022-04-01", true)], today);
    expect(r).toEqual({ current: [], upcoming: [], expiredShortages: [] });
  });
});
