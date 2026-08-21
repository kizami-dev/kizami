import { describe, expect, it } from "vitest";
import { EMPTY_RESULT } from "../src/index.js";

describe("engine scaffold", () => {
  it("empty result has all categories at zero", () => {
    expect(Object.values(EMPTY_RESULT).every((v) => v === 0)).toBe(true);
  });
});
