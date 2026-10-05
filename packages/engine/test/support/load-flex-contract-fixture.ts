/**
 * フレックスの契約上の枠と繰越のゴールデンケース(fixtures/flex-contract/*.yaml)のローダー。
 * テストコード専用(src からは参照しない)。
 *
 * トップレベルのフィクスチャ(load-fixture.ts)と違う点:
 * - `calendar`(所定休日のカレンダー)を持ち、所定労働日はエンジンの `listScheduledWorkDates` で数える
 *   (所定労働日の数え方もゴールデンケースで固定するため)
 * - `months` に複数の月を並べられる。2か月目以降の `carry_in` は前の月の `carry_out` をそのまま使い、
 *   各月の `next_period_capacity` は次の月の枠(`computeFlexFrames` の carryCapacityMinutes)から
 *   求める — apps/api/src/lib/flex-contract.ts が締め前の月を連鎖して計算するのと同じ組み立て
 * - 打刻は `work`(日付の集合 × 出退勤・休憩の時刻)で生成できる。100時間単位の月を
 *   打刻1件ずつ書くと読めないため
 */

import { buildLawTimeline } from "@kizami/law";
import { parse } from "yaml";
import { daysInMonth, utcMinutesFromLocalDateTime } from "../../src/date.js";
import { computeFlexFrames, listScheduledWorkDates } from "../../src/index.js";
import type {
  CalcSettings,
  CalendarTimelineSpan,
  EngineInput,
  FlexTotalHoursBasis,
  LawTimelineSpan,
  PaidLeaveEntry,
  PlainDateString,
  PunchKind,
  SettingsSpan,
  ValidPunch,
  Weekday,
} from "../../src/types.js";

const WEEKDAY_NAMES: Record<string, Weekday> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function weekday(name: string): Weekday {
  const value = WEEKDAY_NAMES[name];
  if (value === undefined) throw new Error(`unknown weekday: ${name}`);
  return value;
}

function parseHm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}

interface RawWork {
  /** "scheduled"(その月の所定労働日すべて)か、日付の配列 */
  dates: "scheduled" | PlainDateString[];
  in: string;
  out: string;
  /** [休憩開始, 休憩終了]。省略時は休憩なし */
  break?: [string, string];
}

interface RawMonth {
  period: string; // "YYYY-MM"
  /** 前月から送られてきた繰越(分)。1か月目だけ書ける(2か月目以降は前の月の carry_out を使う) */
  carry_in?: number;
  /** 翌月が受け入れられる繰越の上限(分)。省略時は次の月の枠から求め、最後の月なら0 */
  next_period_capacity?: number;
  work?: RawWork[];
  punches?: Array<{ kind: PunchKind; at: string }>;
  paid_leave?: Array<{ date: string; minutes: number }>;
  expected: {
    scheduled_work_days: number;
    totals: { statutory: number; overtime: number; overtime60h: number; lateNight: number; statutoryHoliday: number };
    flex_balance: {
      frame: number;
      actual: number;
      diff: number;
      statutory_frame: number;
      contract_frame: number | null;
      carry_in: number;
      within_statutory_excess: number;
      carry_out: number;
      confirmed_shortfall: number;
    };
    warnings: string[];
  };
}

interface RawFlexContractFixture {
  name: string;
  law_reference?: string;
  settings: {
    tz_offset: number;
    day_boundary: string;
    legal_holiday: { weekday: string };
    flex: { standard_day: string; total_hours_basis: FlexTotalHoursBasis; carry_over_shortfall: boolean };
  };
  calendar: { weekdays: string[]; national_holidays: boolean; extra_holidays?: string[]; extra_workdays?: string[] };
  months: RawMonth[];
}

export interface FlexContractMonthCase {
  period: { year: number; month: number };
  /** carry_in を前の月から受け取る月か(1か月目は false) */
  chained: boolean;
  /** 1か月目の carry_in(chained なら使わない) */
  carryIn: number;
  /** 明示された翌月の受け入れ上限。undefined なら次の月から求める */
  nextPeriodCapacity: number | undefined;
  /** carry_in / flexContract 以外を埋めた EngineInput。scheduledWorkDates は埋めてある */
  input: EngineInput;
  scheduledWorkDays: number;
  nationalHolidayDataUnavailable: boolean;
  expected: RawMonth["expected"];
}

export interface FlexContractGoldenCase {
  name: string;
  months: FlexContractMonthCase[];
  /** 翌月の受け入れ上限を求めるための、任意の月の settings/law タイムライン */
  settingsTimeline: SettingsSpan[];
  lawTimelineFor: (period: { year: number; month: number }) => LawTimelineSpan[];
  calendarTimeline: CalendarTimelineSpan[];
}

function parsePeriod(period: string): { year: number; month: number } {
  const [year, month] = period.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0 };
}

function monthRange(period: { year: number; month: number }): { from: PlainDateString; to: PlainDateString } {
  const ym = `${String(period.year).padStart(4, "0")}-${String(period.month).padStart(2, "0")}`;
  return { from: `${ym}-01`, to: `${ym}-${String(daysInMonth(period.year, period.month)).padStart(2, "0")}` };
}

export function loadFlexContractGoldenCase(yamlText: string): FlexContractGoldenCase {
  const raw = parse(yamlText) as RawFlexContractFixture;
  const standardDay = parseHm(raw.settings.flex.standard_day);
  const settings: CalcSettings = {
    tzOffsetMinutes: raw.settings.tz_offset,
    dayBoundaryMinutes: parseHm(raw.settings.day_boundary).hour * 60 + parseHm(raw.settings.day_boundary).minute,
    weekStartWeekday: 0,
    legalHoliday: { kind: "weekday", weekday: weekday(raw.settings.legal_holiday.weekday) },
    workSystem: {
      kind: "flex",
      settlement: "monthly",
      core: null,
      standardDayMinutes: standardDay.hour * 60 + standardDay.minute,
      totalHoursBasis: raw.settings.flex.total_hours_basis,
      carryOverShortfall: raw.settings.flex.carry_over_shortfall,
    },
    breakRule: { mode: "punch" },
  };
  const settingsTimeline: SettingsSpan[] = [{ from: "1970-01-01", settings }];
  const calendarTimeline: CalendarTimelineSpan[] = [
    {
      from: "1970-01-01",
      calendar: {
        weekdays: raw.calendar.weekdays.map(weekday),
        nationalHolidays: raw.calendar.national_holidays,
        extraHolidays: raw.calendar.extra_holidays ?? [],
        extraWorkdays: raw.calendar.extra_workdays ?? [],
      },
    },
  ];
  // フィクスチャの既定の法令プロファイル(中小企業・特例措置対象外。load-fixture.ts と同じ)
  const lawTimelineFor = (period: { year: number; month: number }) => {
    const { from, to } = monthRange(period);
    return buildLawTimeline(from, to, { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false });
  };

  const months = raw.months.map((m, index): FlexContractMonthCase => {
    const period = parsePeriod(m.period);
    const scheduled = listScheduledWorkDates(calendarTimeline, settingsTimeline, period);

    const punches: ValidPunch[] = [];
    const at = (date: PlainDateString, hm: string) => utcMinutesFromLocalDateTime(date, parseHm(hm), settings.tzOffsetMinutes);
    for (const work of m.work ?? []) {
      const dates = work.dates === "scheduled" ? scheduled.dates : work.dates;
      for (const date of dates) {
        punches.push({ kind: "clock_in", occurredAt: at(date, work.in) });
        if (work.break) {
          punches.push({ kind: "break_start", occurredAt: at(date, work.break[0]) });
          punches.push({ kind: "break_end", occurredAt: at(date, work.break[1]) });
        }
        punches.push({ kind: "clock_out", occurredAt: at(date, work.out) });
      }
    }
    for (const p of m.punches ?? []) {
      const [datePart, timePart] = p.at.split("T");
      punches.push({ kind: p.kind, occurredAt: at(datePart as PlainDateString, timePart ?? "00:00") });
    }
    punches.sort((a, b) => a.occurredAt - b.occurredAt);

    const paidLeave: PaidLeaveEntry[] = (m.paid_leave ?? []).map((e) => ({ date: e.date, minutes: e.minutes }));

    return {
      period,
      chained: index > 0,
      carryIn: m.carry_in ?? 0,
      nextPeriodCapacity: m.next_period_capacity,
      input: {
        punches,
        settingsTimeline,
        lawTimeline: lawTimelineFor(period),
        period,
        paidLeave,
        flexContract: {
          scheduledWorkDates: scheduled.dates,
          carryInMinutes: 0,
          nationalHolidayDataUnavailable: scheduled.nationalHolidayDataUnavailable,
        },
      },
      scheduledWorkDays: scheduled.dates.length,
      nationalHolidayDataUnavailable: scheduled.nationalHolidayDataUnavailable,
      expected: m.expected,
    };
  });

  return { name: raw.name, months, settingsTimeline, lawTimelineFor, calendarTimeline };
}

/**
 * 翌月(next)が受け入れられる繰越の上限を、翌月の枠から求める
 * (apps/api/src/lib/flex-contract.ts が翌月の設定とカレンダーから求めるのと同じ式)。
 */
export function carryCapacityOf(golden: FlexContractGoldenCase, next: FlexContractMonthCase): number {
  return computeFlexFrames(golden.settingsTimeline, golden.lawTimelineFor(next.period), next.period, next.input.flexContract?.scheduledWorkDates ?? [])
    .carryCapacityMinutes;
}
