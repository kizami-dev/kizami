/**
 * フレックスの契約上の枠(2026-10-05)の単体テスト。
 *
 * - 回帰: 既定(法定の枠)の制度の結果が、契約上の枠を入れる前と1分も変わらないこと。
 *   トップレベルのゴールデンケース全件について、(a) そのまま、(b) 総労働時間の決め方を明示的に
 *   "statutory_frame" にし、所定労働日・繰越の入力も渡した場合、の両方で totals・日別・警告・
 *   従来の3項目(frame/actual/diff)がフィクスチャの期待値と一致することを確かめる
 * - 所定休日のカレンダー(calendar.ts)の数え方
 */
import { describe, expect, it } from "vitest";
import { calculate, listScheduledWorkDates } from "../src/index.js";
import type { CalendarTimelineSpan, CalcSettings, EngineInput, SettingsSpan, WorkSystem } from "../src/types.js";
import { loadGoldenCase } from "./support/load-fixture.js";
import { loadYamlFixtures } from "./support/fixtures.js";

const fixtures = loadYamlFixtures(
  import.meta.glob("../fixtures/*.yaml", { query: "?raw", import: "default", eager: true }),
);

function withStatutoryBasis(input: EngineInput): EngineInput {
  return {
    ...input,
    settingsTimeline: input.settingsTimeline.map((span) => {
      const ws = span.settings.workSystem;
      if (ws.kind !== "flex") return span;
      const workSystem: WorkSystem = { ...ws, totalHoursBasis: "statutory_frame", carryOverShortfall: false };
      return { ...span, settings: { ...span.settings, workSystem } };
    }),
    flexContract: {
      scheduledWorkDates: ["2026-04-01", "2026-04-02"],
      carryInMinutes: 600,
      nextPeriodCarryCapacityMinutes: 1000,
    },
  };
}

describe("statutory-frame basis is unchanged (regression)", () => {
  for (const [file, yamlText] of fixtures) {
    const golden = loadGoldenCase(yamlText);
    it(`${file}: same totals, days and frame/actual/diff as before`, () => {
      const plain = calculate(golden.input);
      const explicit = calculate(withStatutoryBasis(golden.input));

      for (const output of [plain, explicit]) {
        expect(output.totals).toEqual(golden.expected.totals);
        expect(output.flexBalance?.frameMinutes).toBe(golden.expected.flexBalance.frame);
        expect(output.flexBalance?.actualMinutes).toBe(golden.expected.flexBalance.actual);
        expect(output.flexBalance?.diffMinutes).toBe(golden.expected.flexBalance.diff);
        // 新しい項目は「法定の枠が基準」を表す中立の値
        expect(output.flexBalance?.statutoryFrameMinutes).toBe(golden.expected.flexBalance.frame);
        expect(output.flexBalance?.contractFrameMinutes).toBeNull();
        expect(output.flexBalance?.carryInMinutes).toBe(0);
        expect(output.flexBalance?.withinStatutoryExcessMinutes).toBe(0);
        expect(output.flexBalance?.carryOutMinutes).toBe(0);
        expect(output.flexBalance?.confirmedShortfallMinutes).toBe(Math.max(0, -golden.expected.flexBalance.diff));
      }
      expect(explicit.days).toEqual(plain.days);
      expect(explicit.warnings).toEqual(plain.warnings);
    });
  }
});

describe("scheduled_days basis without flexContract", () => {
  it("treats a missing flexContract as zero scheduled days instead of silently falling back to the statutory frame", () => {
    const golden = loadGoldenCase(fixtures.find(([file]) => file === "flex-basic.yaml")?.[1] ?? "");
    const input = withStatutoryBasis(golden.input);
    const settingsTimeline = input.settingsTimeline.map((span) => {
      const ws = span.settings.workSystem;
      if (ws.kind !== "flex") return span;
      return { ...span, settings: { ...span.settings, workSystem: { ...ws, totalHoursBasis: "scheduled_days" as const } } };
    });
    const { flexContract: _omit, ...rest } = input;
    const output = calculate({ ...rest, settingsTimeline });
    expect(output.flexBalance?.contractFrameMinutes).toBe(0);
    expect(output.flexBalance?.frameMinutes).toBe(0);
  });
});

describe("listScheduledWorkDates", () => {
  const baseSettings: CalcSettings = {
    tzOffsetMinutes: 540,
    dayBoundaryMinutes: 0,
    weekStartWeekday: 0,
    legalHoliday: { kind: "weekday", weekday: 0 },
    workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 360 },
    breakRule: { mode: "punch" },
  };
  const settingsTimeline: SettingsSpan[] = [{ from: "1970-01-01", settings: baseSettings }];
  const period = { year: 2026, month: 8 };

  it("uses the default calendar (Sat/Sun + national holidays) when no version exists", () => {
    const { dates, nationalHolidayDataUnavailable } = listScheduledWorkDates([], settingsTimeline, period);
    expect(dates).toHaveLength(20);
    expect(dates).not.toContain("2026-08-11"); // 山の日
    expect(dates).not.toContain("2026-08-01"); // 土曜
    expect(nationalHolidayDataUnavailable).toBe(false);
  });

  it("applies extra holidays and lets extra workdays override weekday and national-holiday rules", () => {
    const calendarTimeline: CalendarTimelineSpan[] = [
      {
        from: "2026-01-01",
        calendar: {
          weekdays: [0, 6],
          nationalHolidays: true,
          extraHolidays: ["2026-08-13", "2026-08-14"], // お盆
          extraWorkdays: ["2026-08-11", "2026-08-01", "2026-08-14"], // 山の日・土曜は営業、8/14 は両方にあれば営業を優先
        },
      },
    ];
    const { dates } = listScheduledWorkDates(calendarTimeline, settingsTimeline, period);
    expect(dates).toContain("2026-08-11");
    expect(dates).toContain("2026-08-01");
    expect(dates).toContain("2026-08-14");
    expect(dates).not.toContain("2026-08-13");
    expect(dates).toHaveLength(20 + 2 - 1);
  });

  it("always treats the legal holiday as a non-working day even if the calendar does not list it", () => {
    const calendarTimeline: CalendarTimelineSpan[] = [
      // 所定休日の曜日に日曜を入れ忘れ、さらに日曜を営業日に足しても、法定休日(日曜)は所定労働日にならない
      { from: "2026-01-01", calendar: { weekdays: [6], nationalHolidays: true, extraHolidays: [], extraWorkdays: ["2026-08-02"] } },
    ];
    const { dates } = listScheduledWorkDates(calendarTimeline, settingsTimeline, period);
    expect(dates.some((d) => ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"].includes(d))).toBe(false);
    expect(dates).toHaveLength(20);
  });

  it("switches the calendar version on its effective date", () => {
    const calendarTimeline: CalendarTimelineSpan[] = [
      { from: "1970-01-01", calendar: { weekdays: [0, 6], nationalHolidays: true, extraHolidays: [], extraWorkdays: [] } },
      // 8/17 から水曜も所定休日(週休3日)
      { from: "2026-08-17", calendar: { weekdays: [0, 3, 6], nationalHolidays: true, extraHolidays: [], extraWorkdays: [] } },
    ];
    const { dates } = listScheduledWorkDates(calendarTimeline, settingsTimeline, period);
    expect(dates).toContain("2026-08-12"); // 切替前の水曜
    expect(dates).not.toContain("2026-08-19");
    expect(dates).not.toContain("2026-08-26");
    expect(dates).toHaveLength(18);
  });
});
