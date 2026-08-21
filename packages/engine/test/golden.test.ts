import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calculate } from "../src/index.js";
import { loadGoldenCase } from "./support/load-fixture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".yaml"));

describe("golden cases", () => {
  it("found at least one fixture", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    const yamlText = readFileSync(join(fixturesDir, file), "utf-8");
    const golden = loadGoldenCase(yamlText);

    it(`${file}: ${golden.name}`, () => {
      const output = calculate(golden.input);

      expect(output.totals).toEqual(golden.expected.totals);
      expect(output.flexBalance.frameMinutes).toBe(golden.expected.flexBalance.frame);
      expect(output.flexBalance.actualMinutes).toBe(golden.expected.flexBalance.actual);
      expect(output.flexBalance.diffMinutes).toBe(golden.expected.flexBalance.diff);

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
        }
      }
    });
  }
});
