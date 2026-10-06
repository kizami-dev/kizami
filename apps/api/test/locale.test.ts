import { describe, expect, it } from "vitest";
import { LOCALE_ORDER } from "../../web/src/lib/i18n/index.js";
import { DEFAULT_LOCALE, parseLocale, resolveLocale, SUPPORTED_LOCALES } from "../src/lib/locale.js";

describe("lib/locale", () => {
  it("API の対応ロケールは Web の LOCALE_ORDER と一致する(片方だけ増やしたときに検出する)", () => {
    expect([...SUPPORTED_LOCALES]).toEqual([...LOCALE_ORDER]);
  });

  it("parseLocale は許可リストへの完全一致だけを通す", () => {
    for (const locale of SUPPORTED_LOCALES) expect(parseLocale(locale)).toBe(locale);
    for (const bad of ["en-US", "EN", "zh-TW", "zh-hant", "", " ja", "fr", null, undefined, 1, {}, ["ja"]]) {
      expect(parseLocale(bad)).toBeNull();
    }
  });

  it("resolveLocale は左から最初に有効なものを返し、無ければ ja", () => {
    expect(resolveLocale("en", "ko")).toBe("en");
    expect(resolveLocale("fr", null, "ko", "zh")).toBe("ko");
    expect(resolveLocale(undefined, null, 5)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale()).toBe("ja");
  });
});
