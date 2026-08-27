import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.js";
import { loadGoldenCase } from "./support/load-fixture.js";
import { loadYamlFixtures } from "./support/fixtures.js";

// fixtures/*.yaml をビルド時に文字列として取り込む(node:fs は使わない — このスイートは
// Node レグと workerd レグの両方で走るため。support/fixtures.ts 冒頭の説明を参照)
const fixtures = loadYamlFixtures(
  import.meta.glob("../fixtures/*.yaml", { query: "?raw", import: "default", eager: true }),
);
const fixtureFiles = fixtures.map(([file]) => file);

describe("golden cases", () => {
  it("found at least one fixture", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const [file, yamlText] of fixtures) {
    const golden = loadGoldenCase(yamlText);

    it(`${file}: ${golden.name}`, () => {
      const output = calculate(golden.input);

      expect(output.totals).toEqual(golden.expected.totals);
      // 現行のゴールデンフィクスチャは全てフレックスのため flexBalance は必ず non-null
      expect(output.flexBalance, "flexBalance should be present for flex fixtures").not.toBeNull();
      expect(output.flexBalance?.frameMinutes).toBe(golden.expected.flexBalance.frame);
      expect(output.flexBalance?.actualMinutes).toBe(golden.expected.flexBalance.actual);
      expect(output.flexBalance?.diffMinutes).toBe(golden.expected.flexBalance.diff);

      const actualWarningKinds = [...output.warnings.map((w) => w.kind)].sort();
      const expectedWarningKinds = [...golden.expected.warningKinds].sort();
      expect(actualWarningKinds).toEqual(expectedWarningKinds);

      if (golden.expected.days) {
        for (const expectedDay of golden.expected.days) {
          const actualDay = output.days.find((d) => d.date === expectedDay.date);
          expect(actualDay, `day ${expectedDay.date} missing from output`).toBeDefined();
          expect(actualDay?.workedMinutes).toBe(expectedDay.worked);
          expect(actualDay?.breakMinutes).toBe(expectedDay.break);
          expect(actualDay?.lateNightMinutes).toBe(expectedDay.lateNight);
          expect(actualDay?.isLegalHoliday).toBe(expectedDay.legalHoliday);
          if (expectedDay.paidLeaveMinutes !== undefined) {
            expect(actualDay?.paidLeaveMinutes).toBe(expectedDay.paidLeaveMinutes);
          }
        }
      }
    });
  }
});
