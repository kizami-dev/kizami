/**
 * UI 辞書とロケール判定(src/lib/i18n)のテスト。
 *
 * tour.test.ts と同じ方針で jsdom は使わない。ブラウザの言語・localStorage・document は
 * vi.stubGlobal で最小限の代役を差し込む。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INTL_LOCALE,
  LOCALE_NATIVE_NAMES,
  LOCALE_ORDER,
  LOCALE_STORAGE_KEY,
  chineseLocaleFromLanguageTag,
  detectLocale,
  getLocale,
  getMessages,
  localeFromLanguageTag,
  resolveInitialLocale,
  setLocale,
  type Locale,
} from "../src/lib/i18n";
import { en } from "../src/lib/i18n/en";
import { ja } from "../src/lib/i18n/ja";
import { ko } from "../src/lib/i18n/ko";
import { zh } from "../src/lib/i18n/zh";
import { zhHant } from "../src/lib/i18n/zh-Hant";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 辞書の全文字列値(関数値は除く)をキーパス付きで平らにする。 */
function flattenStrings(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => flattenStrings(v, prefix ? `${prefix}.${k}` : k));
}

describe("ロケールの一覧", () => {
  it("LOCALE_ORDER は ja, en, ko, zh, zh-Hant の順", () => {
    expect([...LOCALE_ORDER]).toEqual(["ja", "en", "ko", "zh", "zh-Hant"]);
  });

  it("自称は簡体が「简体中文」、繁体が「繁體中文」", () => {
    expect(LOCALE_NATIVE_NAMES.zh).toBe("简体中文");
    expect(LOCALE_NATIVE_NAMES["zh-Hant"]).toBe("繁體中文");
  });

  it("Intl ロケールは簡体が zh-Hans-CN、繁体が zh-Hant-TW", () => {
    expect(INTL_LOCALE.zh).toBe("zh-Hans-CN");
    expect(INTL_LOCALE["zh-Hant"]).toBe("zh-Hant-TW");
  });
});

describe("ブラウザの言語からの推定", () => {
  it.each([
    ["zh-TW", "zh-Hant"],
    ["zh-tw", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-MO", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["zh-Hant-TW", "zh-Hant"],
    ["zh-Hant-CN", "zh-Hant"],
    ["zh", "zh"],
    ["zh-CN", "zh"],
    ["zh-SG", "zh"],
    ["zh-Hans", "zh"],
    ["zh-Hans-CN", "zh"],
    ["zh-Hans-TW", "zh"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["en-US", "en"],
  ] as [string, Locale][])("%s → %s", (tag, expected) => {
    expect(localeFromLanguageTag(tag.toLowerCase())).toBe(expected);
  });

  it("対応しない言語は null", () => {
    expect(localeFromLanguageTag("fr-fr")).toBeNull();
    expect(localeFromLanguageTag("zhx")).toBeNull();
  });

  it("chineseLocaleFromLanguageTag は文字体系サブタグを地域より優先する", () => {
    expect(chineseLocaleFromLanguageTag("zh-hans-tw")).toBe("zh");
    expect(chineseLocaleFromLanguageTag("zh-hant-cn")).toBe("zh-Hant");
  });

  it("detectLocale は navigator.languages の先頭から順に最初に対応できたものを採る", () => {
    vi.stubGlobal("navigator", { languages: ["fr-FR", "zh-TW", "en-US"], language: "fr-FR" });
    expect(detectLocale()).toBe("zh-Hant");
    vi.stubGlobal("navigator", { languages: ["zh-CN", "zh-TW"], language: "zh-CN" });
    expect(detectLocale()).toBe("zh");
  });

  it("対応する言語が無ければ ja", () => {
    vi.stubGlobal("navigator", { languages: ["fr-FR"], language: "fr-FR" });
    expect(detectLocale()).toBe("ja");
  });
});

describe("localStorage と html lang", () => {
  function stubBrowser(initial: Record<string, string> = {}) {
    const data = { ...initial };
    const documentElement = { lang: "" };
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (k in data ? (data[k] as string) : null),
        setItem: (k: string, v: string) => {
          data[k] = v;
        },
      },
    });
    vi.stubGlobal("document", { documentElement });
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
    return { data, documentElement };
  }

  it("保存済みの zh-Hant は推定より優先される", () => {
    stubBrowser({ [LOCALE_STORAGE_KEY]: "zh-Hant" });
    expect(resolveInitialLocale()).toBe("zh-Hant");
  });

  it("setLocale('zh-Hant') は localStorage に保存し、html lang を zh-Hant にし、辞書を切り替える", () => {
    const { data, documentElement } = stubBrowser();
    setLocale("zh-Hant");
    expect(data[LOCALE_STORAGE_KEY]).toBe("zh-Hant");
    expect(documentElement.lang).toBe("zh-Hant");
    expect(getLocale()).toBe("zh-Hant");
    expect(getMessages()).toBe(zhHant);
    setLocale("zh");
    expect(documentElement.lang).toBe("zh-Hans");
    setLocale("ja");
    expect(getMessages()).toBe(ja);
  });
});

describe("言語と表示の設定画面の文言", () => {
  it("タイトルは ja が「言語と表示」、en が「Language & display」", () => {
    expect(ja.settingsDisplay.title).toBe("言語と表示");
    expect(en.settingsDisplay.title).toBe("Language & display");
  });

  it("ko / zh / zh-Hant にもタイトルとナビ・ハブの文言がある", () => {
    for (const dict of [ko, zh, zhHant]) {
      expect(dict.settingsDisplay.title.length).toBeGreaterThan(0);
      expect(dict.settingsNav.display.length).toBeGreaterThan(0);
      expect(dict.settingsHub.displayTitle.length).toBeGreaterThan(0);
    }
    expect(zhHant.settingsDisplay.title).toBe("語言與顯示");
  });
});

describe("繁体中文辞書(zh-Hant)", () => {
  const entries = flattenStrings(zhHant);

  it("文字列の値が空でない(空文字を意図するキーは日本語辞書でも空)", () => {
    const jaEntries = new Map(flattenStrings(ja));
    const empty = entries.filter(([k, v]) => v === "" && jaEntries.get(k) !== "").map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("簡体字が残っていない", () => {
    // 日本語の新字体と重ならない、簡体字だけの字を拾う(日本語コメントは新字体なので誤検出しない)。
    const simplified = /[们这为时间务规则权设击录应开关员发过还对动长门现请认证显个没产从态书买传价众优兴养军农决况净减创办劳协议组织约结统计总编辑选项导读经师变场报换损拟档标构样检测据领页预题类]/;
    const found = entries.filter(([, v]) => simplified.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(found).toEqual([]);
  });

  it("大陸の用語が残っていない(台湾の用語に置き換える)", () => {
    const forbidden = ["許可權", "登錄", "默認", "軟件", "硬件", "網絡", "信息", "數據", "視頻", "屏幕", "文件夾", "服務器", "退出登入", "賬"];
    const found = entries.flatMap(([k, v]) => forbidden.filter((w) => v.includes(w)).map((w) => `${k}: ${w}`));
    expect(found).toEqual([]);
  });

  it("主要な語は台湾の用語である", () => {
    expect(zhHant.nav.logout).toBe("登出");
    expect(zhHant.login.passwordLabel).toBe("密碼");
    expect(zhHant.login.submit).toBe("登入");
    expect(zhHant.login.emailLabel).toBe("電子郵件地址");
    expect(zhHant.nav.settings).toBe("設定");
  });
});
