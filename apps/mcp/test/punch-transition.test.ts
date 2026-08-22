import { describe, expect, it } from "vitest";
import { describeInvalidPunchTransition, isValidPunchTransition } from "../src/punch-transition.js";

describe("isValidPunchTransition", () => {
  it("only allows clock_in while out", () => {
    expect(isValidPunchTransition("out", "clock_in")).toBe(true);
    expect(isValidPunchTransition("out", "clock_out")).toBe(false);
    expect(isValidPunchTransition("out", "break_start")).toBe(false);
    expect(isValidPunchTransition("out", "break_end")).toBe(false);
  });

  it("allows clock_out or break_start while working", () => {
    expect(isValidPunchTransition("working", "clock_out")).toBe(true);
    expect(isValidPunchTransition("working", "break_start")).toBe(true);
    expect(isValidPunchTransition("working", "clock_in")).toBe(false);
    expect(isValidPunchTransition("working", "break_end")).toBe(false);
  });

  it("allows break_end or clock_out while on break (clock_out closes the break)", () => {
    expect(isValidPunchTransition("onBreak", "break_end")).toBe(true);
    expect(isValidPunchTransition("onBreak", "clock_out")).toBe(true);
    expect(isValidPunchTransition("onBreak", "clock_in")).toBe(false);
    expect(isValidPunchTransition("onBreak", "break_start")).toBe(false);
  });
});

describe("describeInvalidPunchTransition", () => {
  it("names the current state, the rejected kind, and the allowed alternatives", () => {
    const message = describeInvalidPunchTransition("out", "clock_out");
    expect(message).toContain("勤務外");
    expect(message).toContain("退勤");
    expect(message).toContain("出勤");
  });

  it("lists both allowed kinds when more than one is valid", () => {
    const message = describeInvalidPunchTransition("working", "clock_in");
    expect(message).toContain("退勤");
    expect(message).toContain("休憩開始");
  });
});
