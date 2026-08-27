/**
 * monthly_variable(1ヶ月単位の変形労働時間制)の YAML フィクスチャ(fixtures/shift/)を
 * calculate() 経由(打刻列の解釈〜集計まで通し)で検証する。
 *
 * fixtures/README.md の通り、既存の golden.test.ts / load-fixture.ts(flex 専用スキーマ)
 * とは別の、shift 専用の最小ローダーをこのファイル内に持つ。
 */
import { buildLawTimeline } from "@kizami/law";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.js";
import { utcMinutesFromLocalDateTime } from "../src/date.js";
import type { CalcSettings, EngineInput, PlainDateString, PunchKind, ShiftDay, ShiftDayType } from "../src/types.js";

import { loadYamlFixtures } from "./support/fixtures.js";

// fixtures/shift/*.yaml をビルド時に文字列として取り込む(golden.test.ts と同じ理由で
// node:fs を使わない — support/fixtures.ts 冒頭の説明を参照)
const fixtures = loadYamlFixtures(
  import.meta.glob("../fixtures/shift/*.yaml", { query: "?raw", import: "default", eager: true }),
);

const WEEKDAY_NAMES: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function parseHm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface RawShiftFixture {
  name: string;
  period: string;
  period_start_day: number;
  week_start_weekday?: string;
  tz_offset: number;
  day_boundary: string;
  shifts: Array<{ date: PlainDateString; day_type: ShiftDayType; start: string; end: string; break: number }>;
  punches: Array<{ kind: PunchKind; at: string }>;
  expected: {
    totals: { statutory: number; overtime: number; overtime60h: number; lateNight: number; statutoryHoliday: number };
    contains_warning_kinds: string[];
    variable_period: {
      period_start: PlainDateString;
      period_end: PlainDateString;
      scheduled_total_minutes: number;
      worked_total_minutes: number;
      period_overtime_minutes: number;
      attributed_to_this_month: boolean;
    };
  };
}

function loadShiftFixture(yamlText: string) {
  const raw = parse(yamlText) as RawShiftFixture;

  const settings: CalcSettings = {
    tzOffsetMinutes: raw.tz_offset,
    dayBoundaryMinutes: parseHm(raw.day_boundary),
    weekStartWeekday: WEEKDAY_NAMES[String(raw.week_start_weekday ?? "sunday")] ?? 0,
    // monthly_variable では法定休日の判定は ShiftDay.dayType が権威(shift-work.md)。
    // このフィールドは ShiftDay の無い日(missing_shift)へのフォールバックとしてのみ使われる。
    legalHoliday: { kind: "weekday", weekday: 0 },
    workSystem: { kind: "monthly_variable", periodStartDay: raw.period_start_day },
    breakRule: { mode: "punch" },
  };

  const shifts: ShiftDay[] = raw.shifts.map((s) => ({
    date: s.date,
    dayType: s.day_type,
    startMinutes: parseHm(s.start),
    endMinutes: parseHm(s.end),
    breakMinutes: s.break,
  }));

  const punches = raw.punches.map((p) => {
    const [datePart, timePart] = p.at.split("T");
    const [hourStr, minuteStr] = (timePart ?? "00:00").split(":");
    return {
      kind: p.kind,
      occurredAt: utcMinutesFromLocalDateTime(
        datePart as PlainDateString,
        { hour: Number(hourStr), minute: Number(minuteStr) },
        settings.tzOffsetMinutes,
      ),
    };
  });

  const [yearStr, monthStr] = raw.period.split("-");
  const period = { year: Number(yearStr), month: Number(monthStr) };

  const input: EngineInput = {
    punches,
    settingsTimeline: [{ from: "1970-01-01", settings }],
    lawTimeline: buildLawTimeline("2026-01-01", "2026-12-31", {
      isSmallOrMediumEnterprise: true,
      isSpecialProvisionWorkplace: false,
    }),
    period,
    paidLeave: [],
    shifts,
  };

  return { name: raw.name, input, expected: raw.expected };
}

const fixtureFiles = fixtures.map(([file]) => file);

describe("shift golden cases (monthly_variable)", () => {
  it("found at least one shift fixture", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const [file, yamlText] of fixtures) {
    const { name, input, expected } = loadShiftFixture(yamlText);

    it(`${file}: ${name}`, () => {
      const output = calculate(input);

      expect(output.workSystem).toBe("monthly_variable");
      expect(output.totals).toEqual(expected.totals);
      expect(output.flexBalance).toBeNull();

      expect(output.variablePeriod).toBeDefined();
      expect(output.variablePeriod?.periodStart).toBe(expected.variable_period.period_start);
      expect(output.variablePeriod?.periodEnd).toBe(expected.variable_period.period_end);
      expect(output.variablePeriod?.scheduledTotalMinutes).toBe(expected.variable_period.scheduled_total_minutes);
      expect(output.variablePeriod?.workedTotalMinutes).toBe(expected.variable_period.worked_total_minutes);
      expect(output.variablePeriod?.periodOvertimeMinutes).toBe(expected.variable_period.period_overtime_minutes);
      expect(output.variablePeriod?.attributedToThisMonth).toBe(expected.variable_period.attributed_to_this_month);

      const warningKinds = output.warnings.map((w) => w.kind);
      for (const expectedKind of expected.contains_warning_kinds) {
        expect(warningKinds, `expected warning kind ${expectedKind}`).toContain(expectedKind);
      }

      // 不変条件: withinScheduled + extra + overtime(日次分) = workedMinutes(法定休日を除く)。
      // 期間段(③)の加算は日ごとの内訳を書き換えないため、日次の内訳だけで見ればこの等式は
      // monthly_variable でも常に成り立つ(fixed.ts と同じ不変条件)。
      for (const day of output.days) {
        if (day.isLegalHoliday) continue;
        expect(day.withinScheduledMinutes + day.extraWithinStatutoryMinutes + day.statutoryOvertimeMinutes).toBe(
          day.workedMinutes,
        );
      }
    });
  }
});
