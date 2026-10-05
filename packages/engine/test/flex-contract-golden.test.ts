/**
 * フレックスの契約上の枠と不足の繰越(2026-10-05、docs/design/work-systems.md)のゴールデンケース。
 * fixtures/flex-contract/*.yaml を calculate() 経由(打刻列の解釈〜集計まで通し)で検証する。
 *
 * 複数の月を並べたフィクスチャは、前の月の carryOutMinutes を次の月の carryInMinutes に、
 * 次の月の枠から求めた受け入れ上限を前の月の nextPeriodCarryCapacityMinutes に渡して順に計算する
 * (support/load-flex-contract-fixture.ts 冒頭の説明を参照)。
 */
import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.js";
import { loadYamlFixtures } from "./support/fixtures.js";
import { carryCapacityOf, loadFlexContractGoldenCase } from "./support/load-flex-contract-fixture.js";

// node:fs を使わない理由は support/fixtures.ts 冒頭の説明を参照
const fixtures = loadYamlFixtures(
  import.meta.glob("../fixtures/flex-contract/*.yaml", { query: "?raw", import: "default", eager: true }),
);

describe("flex contract frame golden cases", () => {
  it("found the flex-contract fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const [file, yamlText] of fixtures) {
    const golden = loadFlexContractGoldenCase(yamlText);

    it(`${file}: ${golden.name}`, () => {
      let previousCarryOut = 0;
      golden.months.forEach((month, index) => {
        const label = `${file} ${month.period.year}-${String(month.period.month).padStart(2, "0")}`;
        const next = golden.months[index + 1];
        const nextCapacity = month.nextPeriodCapacity ?? (next ? carryCapacityOf(golden, next) : 0);
        const flexContract = month.input.flexContract;
        if (!flexContract) throw new Error("loader must fill flexContract");

        const output = calculate({
          ...month.input,
          flexContract: {
            ...flexContract,
            carryInMinutes: month.chained ? previousCarryOut : month.carryIn,
            nextPeriodCarryCapacityMinutes: nextCapacity,
          },
        });

        expect(month.scheduledWorkDays, `${label} scheduled work days`).toBe(month.expected.scheduled_work_days);
        expect(output.workSystem).toBe("flex");
        expect(output.totals, `${label} totals`).toEqual(month.expected.totals);
        const b = output.flexBalance;
        expect(b, `${label} flexBalance`).not.toBeNull();
        const e = month.expected.flex_balance;
        expect(
          {
            frame: b?.frameMinutes,
            actual: b?.actualMinutes,
            diff: b?.diffMinutes,
            statutory_frame: b?.statutoryFrameMinutes,
            contract_frame: b?.contractFrameMinutes,
            carry_in: b?.carryInMinutes,
            within_statutory_excess: b?.withinStatutoryExcessMinutes,
            carry_out: b?.carryOutMinutes,
            confirmed_shortfall: b?.confirmedShortfallMinutes,
          },
          `${label} flexBalance`,
        ).toEqual(e);
        expect([...output.warnings.map((w) => w.kind)].sort(), `${label} warnings`).toEqual([...month.expected.warnings].sort());

        // 3段の区分の不変条件: 枠内 + 法定内超過 = totals.statutory、frame + diff = actual
        if (b) {
          expect(Math.min(b.actualMinutes, b.frameMinutes) + b.withinStatutoryExcessMinutes).toBe(output.totals.statutory);
          expect(b.frameMinutes + b.diffMinutes).toBe(b.actualMinutes);
          expect(b.carryOutMinutes + b.confirmedShortfallMinutes).toBe(Math.max(0, -b.diffMinutes));
        }
        previousCarryOut = b?.carryOutMinutes ?? 0;
      });
    });
  }
});
