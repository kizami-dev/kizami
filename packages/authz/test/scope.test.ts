import { describe, expect, it } from "vitest";
import { scopeRank, scopeSatisfies, widerScope } from "../src/scope.js";
import type { Scope } from "../src/types.js";

const ORDERED: Scope[] = ["self", "department", "department_and_descendants", "tenant"];

describe("scopeRank", () => {
  it("ranks scopes from narrowest to widest", () => {
    for (let i = 0; i < ORDERED.length - 1; i++) {
      expect(scopeRank(ORDERED[i] as Scope)).toBeLessThan(scopeRank(ORDERED[i + 1] as Scope));
    }
  });
});

describe("widerScope", () => {
  it("returns the wider of two scopes regardless of argument order", () => {
    expect(widerScope("self", "tenant")).toBe("tenant");
    expect(widerScope("tenant", "self")).toBe("tenant");
    expect(widerScope("department", "department_and_descendants")).toBe("department_and_descendants");
  });

  it("returns the same scope when both are equal", () => {
    expect(widerScope("department", "department")).toBe("department");
  });
});

describe("scopeSatisfies", () => {
  it("a wider or equal granted scope satisfies a narrower or equal required scope", () => {
    expect(scopeSatisfies("tenant", "self")).toBe(true);
    expect(scopeSatisfies("tenant", "tenant")).toBe(true);
    expect(scopeSatisfies("department_and_descendants", "department")).toBe(true);
  });

  it("a narrower granted scope does not satisfy a wider required scope", () => {
    expect(scopeSatisfies("self", "tenant")).toBe(false);
    expect(scopeSatisfies("department", "department_and_descendants")).toBe(false);
  });
});
