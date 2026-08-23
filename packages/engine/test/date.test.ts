/**
 * date.ts の Temporal 化(第5波)で「整数演算の癖」に依存していた挙動を個別に固定するテスト。
 *
 * 既存の 101 テスト・ゴールデンフィクスチャは月次集計を通した間接的な検証であり、
 * ここでは date.ts の内部関数そのものを、実世界の暦事実(既知の曜日・うるう年・
 * 1970年より前の負の epoch日)に対して直接検証する。
 */
import { describe, expect, it } from "vitest";
import {
  attendanceDayEndUtc,
  civilFromDays,
  dateStringFromEpochDay,
  daysFromCivil,
  daysInMonth,
  epochDayFromDateString,
  parseDateString,
  resolveAttendanceDate,
  utcMinutesFromLocalDateTime,
  weekdayFromEpochDay,
} from "../src/date.js";
import type { CalcSettings, SettingsSpan } from "../src/types.js";

describe("daysFromCivil / civilFromDays — epoch日の基準点と往復", () => {
  it("1970-01-01 は epoch日 0", () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(civilFromDays(0)).toEqual({ year: 1970, month: 1, day: 1 });
  });

  it("負の epoch日(1970年より前)を正しく扱う", () => {
    // 1970-01-01 の前日
    expect(daysFromCivil(1969, 12, 31)).toBe(-1);
    expect(civilFromDays(-1)).toEqual({ year: 1969, month: 12, day: 31 });
    // 1969年は平年なので、1969-01-01 は 1970-01-01 の365日前
    expect(daysFromCivil(1969, 1, 1)).toBe(-365);
    expect(civilFromDays(-365)).toEqual({ year: 1969, month: 1, day: 1 });
  });

  it("2000-01-01 は epoch日 10957(既知のうるう年計算込みの値)", () => {
    // 1970-01-01〜2000-01-01: 30年 × 365日 + うるう日7回(1972,76,80,84,88,92,96)
    expect(daysFromCivil(2000, 1, 1)).toBe(10957);
    expect(civilFromDays(10957)).toEqual({ year: 2000, month: 1, day: 1 });
  });

  it("うるう日(2000-02-29, 世紀年でも400で割り切れるためうるう年)を正しく往復する", () => {
    const epochDay = daysFromCivil(2000, 2, 29);
    expect(civilFromDays(epochDay)).toEqual({ year: 2000, month: 2, day: 29 });
    // 翌日は 2000-03-01(平年の世紀年 1900 なら 1900-02-29 は存在しないが、
    // 2000 は 400 で割り切れるためうるう年 — グレゴリオ暦の判定がそのまま効いていることの確認)
    expect(civilFromDays(epochDay + 1)).toEqual({ year: 2000, month: 3, day: 1 });
  });

  it("2月30日のような実在しない日付は例外にする(overflow: reject)", () => {
    expect(() => daysFromCivil(2024, 2, 30)).toThrow();
  });
});

describe("weekdayFromEpochDay — 既知の曜日事実", () => {
  it("epoch日 0 (1970-01-01) は木曜(4)", () => {
    expect(weekdayFromEpochDay(0)).toBe(4);
  });

  it("2000-01-01(土曜)= epoch日 10957", () => {
    expect(weekdayFromEpochDay(10957)).toBe(6);
  });

  it("負の epoch日でも正しい曜日を返す(1969-12-31 は水曜)", () => {
    expect(weekdayFromEpochDay(-1)).toBe(3);
  });

  it("epoch日が7増えるごとに同じ曜日に戻る(正・負どちらの向きでも)", () => {
    for (let offset = -21; offset <= 21; offset += 7) {
      expect(weekdayFromEpochDay(offset)).toBe(weekdayFromEpochDay(0));
    }
  });
});

describe("daysInMonth — 月末日数(うるう年の世紀年ルール込み)", () => {
  it("うるう年の2月は29日、平年は28日", () => {
    expect(daysInMonth(2024, 2)).toBe(29); // 4で割り切れる
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28); // 100で割り切れるが400では割り切れない → 平年
    expect(daysInMonth(2000, 2)).toBe(29); // 400で割り切れる → うるう年
  });

  it("30日・31日の月", () => {
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });
});

describe("parseDateString / epochDayFromDateString / dateStringFromEpochDay — 往復と厳格パース", () => {
  it("文字列 ⇔ epoch日 ⇔ 文字列で往復する", () => {
    const date = "2026-08-23";
    const epochDay = epochDayFromDateString(date);
    expect(dateStringFromEpochDay(epochDay)).toBe(date);
  });

  it("存在しない日付文字列は例外にする(旧実装の寛容なロールオーバーとは異なる、意図した挙動変更)", () => {
    expect(() => parseDateString("2024-02-30")).toThrow();
    expect(() => epochDayFromDateString("2024-02-30")).toThrow();
  });

  it("同じ日付文字列を繰り返し解決しても結果が一致する(メモ化の透過性)", () => {
    const a = epochDayFromDateString("2026-04-10");
    const b = epochDayFromDateString("2026-04-10");
    expect(a).toBe(b);
  });
});

describe("日界オフセット(dayBoundaryMinutes)を跨ぐ解決 — resolveAttendanceDate / attendanceDayEndUtc", () => {
  const settings: CalcSettings = {
    tzOffsetMinutes: 540, // Asia/Tokyo
    dayBoundaryMinutes: 300, // 05:00 始まりの日界
    weekStartWeekday: 0,
    legalHoliday: { kind: "weekday", weekday: 0 },
    workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
    breakRule: { mode: "punch" },
  };
  const timeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];

  it("日界(05:00)の直前は前日の勤怠日、直後は当日の勤怠日になる", () => {
    const before = utcMinutesFromLocalDateTime("2026-04-10", { hour: 4, minute: 59 }, settings.tzOffsetMinutes);
    const after = utcMinutesFromLocalDateTime("2026-04-10", { hour: 5, minute: 0 }, settings.tzOffsetMinutes);
    expect(resolveAttendanceDate(before, timeline).date).toBe("2026-04-09");
    expect(resolveAttendanceDate(after, timeline).date).toBe("2026-04-10");
  });

  it("attendanceDayEndUtc は次の日界の瞬間(排他)と一致する", () => {
    const end = attendanceDayEndUtc("2026-04-09", settings);
    const justBefore = end - 1;
    const justAfter = end;
    expect(resolveAttendanceDate(justBefore, timeline).date).toBe("2026-04-09");
    expect(resolveAttendanceDate(justAfter, timeline).date).toBe("2026-04-10");
  });
});
