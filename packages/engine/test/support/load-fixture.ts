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
  PaidLeaveEntry,
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
  /** 旧記法(後方互換): 全休日の一覧。standard_day 分の全休として解釈する */
  paid_leave_days?: string[];
  /** 新記法: 日付ごとの有給取得分数(時間単位年休を表現できる) */
  paid_leave?: Array<{ date: string; minutes: number }>;
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
      paid_leave_minutes?: number;
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
      paidLeaveMinutes?: number;
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

  // 旧記法(paid_leave_days: 全休の日付一覧)は standard_day 分の全休として解釈する。
  // 新記法(paid_leave: 日付+分数)と両方書かれていれば単純に連結する
  // (同日エントリの合算はエンジン側 buildDailyBreakdown/calculateFlexBalance が行う)。
  const legacyPaidLeave: PaidLeaveEntry[] = (raw.paid_leave_days ?? []).map((date) => ({
    date,
    minutes: settings.flex.standardDayMinutes,
  }));
  const explicitPaidLeave: PaidLeaveEntry[] = (raw.paid_leave ?? []).map((entry) => ({
    date: entry.date,
    minutes: entry.minutes,
  }));

  const input: EngineInput = {
    punches,
    settingsTimeline: [{ from: "1970-01-01", settings }],
    period: parsePeriod(raw.period),
    paidLeave: [...legacyPaidLeave, ...explicitPaidLeave],
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
      ...(d.paid_leave_minutes !== undefined ? { paidLeaveMinutes: d.paid_leave_minutes } : {}),
    }));
  }

  return { name: raw.name, input, expected };
}
