/**
 * apps/api/src/lib/closing-snapshot.ts の単体テスト。
 *
 * EngineOutput ⇔ closing_snapshots 行の変換ロジックを、DB や HTTP を経由せず直接検証する
 * (実際の締め処理・エクスポートの統合テストは apps/api/test/closings.test.ts /
 * closing-amend.test.ts / exports.test.ts 側でカバーする)。
 */

import { describe, expect, it } from "vitest";
import type { ClosingSnapshot } from "@kizami/db";
import type { DailyBreakdown, EngineOutput } from "@kizami/engine";
import { engineOutputFromSnapshots, snapshotInputsFromEngineOutput, sumFixedBreakdown } from "../src/lib/closing-snapshot.js";

/** テストに必要な最小限のフィールドだけ埋めた DailyBreakdown を作る。 */
function fakeDay(overrides: Partial<DailyBreakdown> & { date: string }): DailyBreakdown {
  return {
    workedMinutes: 0,
    breakMinutes: 0,
    lateNightMinutes: 0,
    isLegalHoliday: false,
    legalHolidayMinutes: 0,
    isPaidLeave: false,
    paidLeaveMinutes: 0,
    autoDeductedBreakMinutes: 0,
    stretches: [],
    withinScheduledMinutes: 0,
    extraWithinStatutoryMinutes: 0,
    statutoryOvertimeMinutes: 0,
    allowances: [],
    ...overrides,
  };
}

function fakeRow(overrides: Partial<ClosingSnapshot> & { category: string; minutes: number }): ClosingSnapshot {
  return {
    id: "row-id",
    tenantId: "tenant-1",
    closingEventId: "event-1",
    userId: "user-1",
    ...overrides,
  } as ClosingSnapshot;
}

describe("sumFixedBreakdown", () => {
  it("sums withinScheduledMinutes / extraWithinStatutoryMinutes across days", () => {
    const days = [
      fakeDay({ date: "2026-04-01", withinScheduledMinutes: 480, extraWithinStatutoryMinutes: 30 }),
      fakeDay({ date: "2026-04-02", withinScheduledMinutes: 420, extraWithinStatutoryMinutes: 0 }),
    ];
    expect(sumFixedBreakdown(days)).toEqual({ withinScheduledMinutes: 900, extraWithinStatutoryMinutes: 30 });
  });

  it("returns zeros for an empty days array (not a crash)", () => {
    expect(sumFixedBreakdown([])).toEqual({ withinScheduledMinutes: 0, extraWithinStatutoryMinutes: 0 });
  });
});

describe("snapshotInputsFromEngineOutput", () => {
  const totals = { statutory: 480, overtime: 60, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 };

  it("fixed: writes the 5 category rows + fixedWithinScheduled/fixedExtraWithinStatutory, and no flex rows", () => {
    const output: EngineOutput = {
      days: [fakeDay({ date: "2026-04-01", withinScheduledMinutes: 450, extraWithinStatutoryMinutes: 30 })],
      totals,
      flexBalance: null,
      workSystem: "fixed",
      warnings: [],
      allowanceTotals: [],
    };

    const rows = snapshotInputsFromEngineOutput({
      tenantId: "t1",
      closingEventId: "e1",
      userId: "u1",
      output,
    });

    const byCategory = Object.fromEntries(rows.map((r) => [r.category, r.minutes]));
    expect(byCategory.statutory).toBe(480);
    expect(byCategory.fixedWithinScheduled).toBe(450);
    expect(byCategory.fixedExtraWithinStatutory).toBe(30);
    expect(byCategory.flexFrame).toBeUndefined();
    expect(byCategory.flexActual).toBeUndefined();
    expect(byCategory.flexDiff).toBeUndefined();
    expect(rows).toHaveLength(7); // 5区分 + fixed2種
  });

  it("flex: writes the 5 category rows + flexFrame/flexActual/flexDiff, and no fixed rows (0埋めにしない)", () => {
    const output: EngineOutput = {
      days: [fakeDay({ date: "2026-04-01" })],
      totals,
      flexBalance: { frameMinutes: 9600, actualMinutes: 9500, diffMinutes: -100 },
      workSystem: "flex",
      warnings: [],
      allowanceTotals: [],
    };

    const rows = snapshotInputsFromEngineOutput({
      tenantId: "t1",
      closingEventId: "e1",
      userId: "u1",
      output,
    });

    const byCategory = Object.fromEntries(rows.map((r) => [r.category, r.minutes]));
    expect(byCategory.flexFrame).toBe(9600);
    expect(byCategory.flexActual).toBe(9500);
    expect(byCategory.flexDiff).toBe(-100);
    expect(byCategory.fixedWithinScheduled).toBeUndefined();
    expect(byCategory.fixedExtraWithinStatutory).toBeUndefined();
    expect(rows).toHaveLength(8); // 5区分 + flex3種
  });

  it("手当: allowanceTotals の各件を allowance:<definitionId> の行として書く(0分も含む)", () => {
    const output: EngineOutput = {
      days: [fakeDay({ date: "2026-04-01" })],
      totals,
      flexBalance: { frameMinutes: 9600, actualMinutes: 9500, diffMinutes: -100 },
      workSystem: "flex",
      warnings: [],
      allowanceTotals: [
        { definitionId: "def-early", minutes: 90 },
        { definitionId: "def-unused", minutes: 0 },
      ],
    };

    const rows = snapshotInputsFromEngineOutput({
      tenantId: "t1",
      closingEventId: "e1",
      userId: "u1",
      output,
    });

    const byCategory = Object.fromEntries(rows.map((r) => [r.category, r.minutes]));
    expect(byCategory["allowance:def-early"]).toBe(90);
    expect(byCategory["allowance:def-unused"]).toBe(0);
    expect(rows).toHaveLength(10); // 5区分 + flex3種 + 手当2種
  });
});

describe("engineOutputFromSnapshots", () => {
  it("round-trips fixedBreakdown without collapsing to 0", () => {
    const rows = [
      fakeRow({ category: "statutory", minutes: 480 }),
      fakeRow({ category: "fixedWithinScheduled", minutes: 450 }),
      fakeRow({ category: "fixedExtraWithinStatutory", minutes: 30 }),
    ];

    const result = engineOutputFromSnapshots(rows);
    expect(result.fixedBreakdown).toEqual({ withinScheduledMinutes: 450, extraWithinStatutoryMinutes: 30 });
    expect(result.flexBalance).toBeNull();
  });

  it("round-trips flexBalance and reports fixedBreakdown: null for a flex month", () => {
    const rows = [
      fakeRow({ category: "statutory", minutes: 480 }),
      fakeRow({ category: "flexFrame", minutes: 9600 }),
      fakeRow({ category: "flexActual", minutes: 9500 }),
      fakeRow({ category: "flexDiff", minutes: -100 }),
    ];

    const result = engineOutputFromSnapshots(rows);
    expect(result.flexBalance).toEqual({ frameMinutes: 9600, actualMinutes: 9500, diffMinutes: -100 });
    expect(result.fixedBreakdown).toBeNull();
  });

  it("does not collapse a real zero-minute fixed breakdown to null (行があれば0でも null にしない)", () => {
    const rows = [
      fakeRow({ category: "fixedWithinScheduled", minutes: 0 }),
      fakeRow({ category: "fixedExtraWithinStatutory", minutes: 0 }),
    ];

    const result = engineOutputFromSnapshots(rows);
    expect(result.fixedBreakdown).toEqual({ withinScheduledMinutes: 0, extraWithinStatutoryMinutes: 0 });
  });

  it("returns flexBalance: null and fixedBreakdown: null without throwing when there are no rows at all (対象ユーザーの行が皆無)", () => {
    const result = engineOutputFromSnapshots([]);
    expect(result.flexBalance).toBeNull();
    expect(result.fixedBreakdown).toBeNull();
    expect(result.totals).toEqual({ statutory: 0, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 });
    expect(result.allowanceTotals).toEqual([]);
  });

  it("手当: allowance:<definitionId> 行を definitionId ごとに復元し、他の区分の解釈に影響しない", () => {
    const rows = [
      fakeRow({ category: "statutory", minutes: 480 }),
      fakeRow({ category: "flexFrame", minutes: 9600 }),
      fakeRow({ category: "allowance:def-early", minutes: 90 }),
      fakeRow({ category: "allowance:def-unused", minutes: 0 }),
    ];

    const result = engineOutputFromSnapshots(rows);
    expect(result.totals.statutory).toBe(480);
    expect(result.flexBalance?.frameMinutes).toBe(9600);
    expect(result.allowanceTotals).toEqual(
      expect.arrayContaining([
        { definitionId: "def-early", minutes: 90 },
        { definitionId: "def-unused", minutes: 0 },
      ]),
    );
    expect(result.allowanceTotals).toHaveLength(2);
  });
});
