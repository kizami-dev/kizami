/**
 * ゴールデンケース YAML(docs/design/v01-data-model.md の確定スキーマ)を EngineInput +
 * 期待値へ変換するローダー。テストコード専用(src からは参照しない)。
 */

import { parse } from "yaml";
import { utcMinutesFromLocalDateTime } from "../../src/date.js";
import type {
  CalcSettings,
  EngineInput,
  LegalHolidayRule,
  PlainDateString,
  PunchKind,
} from "../../src/types.js";

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

interface RawLegalHoliday {
  weekday?: string;
  dates?: string[];
}

function parseLegalHoliday(raw: RawLegalHoliday): LegalHolidayRule {
  if (raw.dates) {
    return { kind: "dates", dates: raw.dates };
  }
  const weekday = WEEKDAY_NAMES[String(raw.weekday)];
  if (weekday === undefined) {
    throw new Error(`unknown legal_holiday weekday: ${raw.weekday}`);
  }
  return { kind: "weekday", weekday };
}

interface RawFixture {
  name: string;
  law_reference?: string;
  settings: {
    tz_offset: number;
    day_boundary: string;
    legal_holiday: RawLegalHoliday;
    flex: { settlement: "monthly"; core: null; standard_day: string };
    break_rule: { mode: "punch" };
  };
  period: string; // "YYYY-MM"
  paid_leave_days?: string[];
  punches: Array<{ kind: PunchKind; at: string }>;
  expected: {
    totals: {
      statutory: number;
      overtime: number;
      overtime60h: number;
      lateNight: number;
      statutoryHoliday: number;
    };
    flex_balance: { frame: number; actual: number; diff: number };
    warnings: string[];
    days?: Array<{
      date: PlainDateString;
      worked: number;
      break: number;
      late_night: number;
      legal_holiday: boolean;
    }>;
  };
}

export interface GoldenCase {
  name: string;
  input: EngineInput;
  expected: {
    totals: {
      statutory: number;
      overtime: number;
      overtime60h: number;
      lateNight: number;
      statutoryHoliday: number;
    };
    flexBalance: { frame: number; actual: number; diff: number };
    warningKinds: string[];
    days?: Array<{
      date: PlainDateString;
      worked: number;
      break: number;
      lateNight: number;
      legalHoliday: boolean;
    }>;
  };
}

function parsePeriod(period: string): { year: number; month: number } {
  const [year, month] = period.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0 };
}

export function loadGoldenCase(yamlText: string): GoldenCase {
  const raw = parse(yamlText) as RawFixture;

  const settings: CalcSettings = {
    tzOffsetMinutes: raw.settings.tz_offset,
    dayBoundaryMinutes: parseHm(raw.settings.day_boundary),
    legalHoliday: parseLegalHoliday(raw.settings.legal_holiday),
    flex: {
      settlement: raw.settings.flex.settlement,
      core: raw.settings.flex.core,
      standardDayMinutes: parseHm(raw.settings.flex.standard_day),
    },
    breakRule: { mode: raw.settings.break_rule.mode },
  };

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

  const input: EngineInput = {
    punches,
    settingsTimeline: [{ from: "1970-01-01", settings }],
    period: parsePeriod(raw.period),
    paidLeaveDays: raw.paid_leave_days ?? [],
  };

  const expected: GoldenCase["expected"] = {
    totals: raw.expected.totals,
    flexBalance: raw.expected.flex_balance,
    warningKinds: raw.expected.warnings ?? [],
  };
  if (raw.expected.days) {
    expected.days = raw.expected.days.map((d) => ({
      date: d.date,
      worked: d.worked,
      break: d.break,
      lateNight: d.late_night,
      legalHoliday: d.legal_holiday,
    }));
  }

  return { name: raw.name, input, expected };
}
