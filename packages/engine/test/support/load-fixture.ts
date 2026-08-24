/**
 * ゴールデンケース YAML(docs/design/v01-data-model.md の確定スキーマ)を EngineInput +
 * 期待値へ変換するローダー。テストコード専用(src からは参照しない)。
 */

import { buildLawTimeline } from "@kizami/law";
import { parse } from "yaml";
import { daysInMonth, utcMinutesFromLocalDateTime } from "../../src/date.js";
import type {
  CalcSettings,
  CoreTime,
  EngineInput,
  LegalHolidayRule,
  PaidLeaveEntry,
  PlainDateString,
  PunchKind,
} from "../../src/types.js";

/**
 * フィクスチャに `law:` 指定が無い場合の既定プロファイル(中小企業・特例措置対象外)。
 * 判断点: 既存の全ゴールデンケースは period が 2026-04 等、現行のすべての法令版の施行日より
 * 十分後の日付なので、この既定プロファイルで buildLawTimeline すると常に「現行法(最新版)」
 * 1本だけの lawTimeline になる — 「フィクスチャに法令指定が無ければ現行法(十分新しい日付)の
 * 版を使う」という要求を、period の日付をそのまま使うことで特別扱いなしに満たせる。
 */
const DEFAULT_LAW_PROFILE = { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false };

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

interface RawCoreTime {
  start: string;
  end: string;
  weekdays?: string[];
}

/** フィクスチャの core 指定を engine の `CoreTime` へ変換する(null はそのまま「なし」)。 */
function parseCoreTime(raw: RawCoreTime | null | undefined): CoreTime | null {
  if (!raw) return null;
  const core: CoreTime = { startMinutes: parseHm(raw.start), endMinutes: parseHm(raw.end) };
  if (raw.weekdays) {
    core.weekdays = raw.weekdays.map((name) => {
      const weekday = WEEKDAY_NAMES[name];
      if (weekday === undefined) throw new Error(`unknown core weekday: ${name}`);
      return weekday;
    });
  }
  return core;
}

interface RawFixture {
  name: string;
  law_reference?: string;
  settings: {
    tz_offset: number;
    day_boundary: string;
    /** 週の起算曜日(省略時は sunday)。現行フィクスチャは全てフレックスのため実際には未使用 */
    week_start_weekday?: string;
    legal_holiday: RawLegalHoliday;
    /**
     * `core` はコアタイム(labor law §32-3)。null なら「コアタイムなし」。
     * 時刻は "HH:MM"、`weekdays` は曜日名の配列(省略時は engine 既定の月〜金)。
     */
    flex: { settlement: "monthly"; core: RawCoreTime | null; standard_day: string };
    break_rule: { mode: "punch" };
  };
  period: string; // "YYYY-MM"
  /** 法令プロファイル(省略時は DEFAULT_LAW_PROFILE = 中小企業・特例措置対象外)。 */
  law?: { is_small_or_medium_enterprise?: boolean; is_special_provision_workplace?: boolean };
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

  // flex の所定(分)。settings.workSystem.standardDayMinutes として後段でも使うが、
  // WorkSystem が flex/fixed/monthly_variable の3分岐になり monthly_variable が
  // standardDayMinutes を持たないため、`CalcSettings` 型に代入した後の `settings.workSystem`
  // はプロパティアクセス時に絞り込まれず union のまま扱われる。ここで値を変数に取っておき、
  // 後段はこちらを直接参照する(絞り込みが不要になり、かつ二重に情報源を持たずに済む)。
  const flexStandardDayMinutes = parseHm(raw.settings.flex.standard_day);
  const settings: CalcSettings = {
    tzOffsetMinutes: raw.settings.tz_offset,
    dayBoundaryMinutes: parseHm(raw.settings.day_boundary),
    // 既存フィクスチャは週起算曜日を指定しないため、既定で日曜起算にする
    // (現行フィクスチャは全てフレックスで週次判定を使わないため実際には効かない)。
    weekStartWeekday: WEEKDAY_NAMES[String(raw.settings.week_start_weekday ?? "sunday")] ?? 0,
    legalHoliday: parseLegalHoliday(raw.settings.legal_holiday),
    workSystem: {
      kind: "flex",
      settlement: raw.settings.flex.settlement,
      core: parseCoreTime(raw.settings.flex.core),
      standardDayMinutes: flexStandardDayMinutes,
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
    minutes: flexStandardDayMinutes,
  }));
  const explicitPaidLeave: PaidLeaveEntry[] = (raw.paid_leave ?? []).map((entry) => ({
    date: entry.date,
    minutes: entry.minutes,
  }));

  const period = parsePeriod(raw.period);
  const lawProfile = {
    isSmallOrMediumEnterprise: raw.law?.is_small_or_medium_enterprise ?? DEFAULT_LAW_PROFILE.isSmallOrMediumEnterprise,
    isSpecialProvisionWorkplace: raw.law?.is_special_provision_workplace ?? DEFAULT_LAW_PROFILE.isSpecialProvisionWorkplace,
  };
  const periodStartDate: PlainDateString = `${String(period.year).padStart(4, "0")}-${String(period.month).padStart(2, "0")}-01`;
  const periodEndDay = daysInMonth(period.year, period.month);
  const periodEndDate: PlainDateString = `${String(period.year).padStart(4, "0")}-${String(period.month).padStart(2, "0")}-${String(periodEndDay).padStart(2, "0")}`;

  const input: EngineInput = {
    punches,
    settingsTimeline: [{ from: "1970-01-01", settings }],
    lawTimeline: buildLawTimeline(periodStartDate, periodEndDate, lawProfile),
    period,
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
