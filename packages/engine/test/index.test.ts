import { resolveLawRules } from "@kizami/law";
import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.js";
import type { CalcSettings, EngineInput, SettingsSpan } from "../src/types.js";

const flexSettings: CalcSettings = {
  tzOffsetMinutes: 540,
  dayBoundaryMinutes: 0,
  weekStartWeekday: 1,
  legalHoliday: { kind: "weekday", weekday: 0 },
  workSystem: { kind: "flex", settlement: "monthly", core: null, standardDayMinutes: 480 },
  breakRule: { mode: "punch" },
};

const fixedSettings: CalcSettings = {
  ...flexSettings,
  workSystem: { kind: "fixed", standardDayMinutes: 480 },
};

const lawTimeline = [
  {
    from: "1970-01-01",
    law: resolveLawRules("2026-01-01", { isSmallOrMediumEnterprise: true, isSpecialProvisionWorkplace: false }),
  },
];

const period = { year: 2026, month: 4 };

function baseInput(settingsTimeline: SettingsSpan[]): EngineInput {
  return {
    punches: [],
    settingsTimeline,
    lawTimeline,
    period,
    paidLeave: [],
  };
}

describe("calculate — workSystem による分岐", () => {
  it("flex の設定なら workSystem: 'flex' で flexBalance が入る", () => {
    const output = calculate(baseInput([{ from: "1970-01-01", settings: flexSettings }]));
    expect(output.workSystem).toBe("flex");
    expect(output.flexBalance).not.toBeNull();
  });

  it("fixed の設定なら workSystem: 'fixed' で flexBalance は null", () => {
    const output = calculate(baseInput([{ from: "1970-01-01", settings: fixedSettings }]));
    expect(output.workSystem).toBe("fixed");
    expect(output.flexBalance).toBeNull();
  });
});

describe("calculate — mixed_work_system 警告", () => {
  it("期間の途中で flex → fixed に切り替わると mixed_work_system 警告を出し、期間開始日(flex)の版で計算する", () => {
    const settingsTimeline: SettingsSpan[] = [
      { from: "1970-01-01", settings: flexSettings },
      { from: "2026-04-16", settings: fixedSettings }, // 期間の途中で切り替わる
    ];
    const output = calculate(baseInput(settingsTimeline));

    expect(output.warnings.map((w) => w.kind)).toContain("mixed_work_system");
    // 期間開始日(4/1)時点では flex なので、そのまま最後まで flex として計算される
    expect(output.workSystem).toBe("flex");
    expect(output.flexBalance).not.toBeNull();
  });

  it("期間の途中で fixed → flex に切り替わっても mixed_work_system 警告が出て期間開始日(fixed)の版で計算する", () => {
    const settingsTimeline: SettingsSpan[] = [
      { from: "1970-01-01", settings: fixedSettings },
      { from: "2026-04-16", settings: flexSettings },
    ];
    const output = calculate(baseInput(settingsTimeline));

    expect(output.warnings.map((w) => w.kind)).toContain("mixed_work_system");
    expect(output.workSystem).toBe("fixed");
    expect(output.flexBalance).toBeNull();
  });

  it("労働時間制が期間を通じて一定なら mixed_work_system は出ない", () => {
    const output = calculate(baseInput([{ from: "1970-01-01", settings: flexSettings }]));
    expect(output.warnings.map((w) => w.kind)).not.toContain("mixed_work_system");
  });
});
