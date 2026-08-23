import { describe, expect, it } from "vitest";
import { collectLocalizedEntries, renderGeneratedTs } from "../scripts/generate.mjs";
import { HELP, HELP_BY_LOCALE, HELP_KEYS, HELP_LOCALES, HELP_MISSING_KEYS, HELP_SOURCE_LOCALE, HELP_TRANSLATION_NOTICE } from "../src/generated.js";
import { helpEntriesFor, helpEntryFor, helpTranslationNotice } from "../src/index.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedFile = path.join(__dirname, "..", "src", "generated.ts");

/** 訳文ロケール(日本語=正 を除いたもの)。 */
const TRANSLATED_LOCALES = HELP_LOCALES.filter((l) => l !== HELP_SOURCE_LOCALE);

/** 本文中の見出し行(`# ` 〜 `###### `)を数える。訳文が構造ごと落ちていないかの確認用。 */
function headingCount(body: string): number {
  return body.split("\n").filter((line) => /^#{1,6}\s+\S/.test(line)).length;
}

/** 本文中の制度ガイド内リンク先(`](./slug)`)の集合。訳文でリンク先が書き換わっていないかの確認用。 */
function docLinkTargets(body: string): string[] {
  return [...body.matchAll(/\]\((\.\/[^)]+)\)/g)].map((m) => m[1] ?? "").sort();
}

describe("HELP辞書の整合性(packages/help-content/README.md の frontmatter 仕様)", () => {
  it("全キーがユニークである", () => {
    const seen = new Set<string>();
    for (const key of HELP_KEYS) {
      expect(seen.has(key), `重複キー: ${key}`).toBe(false);
      seen.add(key);
    }
    expect(HELP_KEYS.length).toBeGreaterThan(0);
  });

  it("origin: law のエントリには basis がある", () => {
    for (const key of HELP_KEYS) {
      const entry = HELP[key];
      if (entry.origin === "law") {
        expect(entry.basis, `${key} は origin: law なのに basis がありません`).toBeTruthy();
        expect(entry.basis!.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("summary が空でない", () => {
    for (const key of HELP_KEYS) {
      expect(HELP[key].summary.trim().length, `${key} の summary が空です`).toBeGreaterThan(0);
    }
  });

  it("companyExample を持つのは origin: law または product のみ(company は DB 管理でここには置かない)", () => {
    for (const key of HELP_KEYS) {
      expect(["law", "product"]).toContain(HELP[key].origin);
    }
  });

  it("HELP[key].key が辞書のキー自体と一致する", () => {
    for (const key of HELP_KEYS) {
      expect(HELP[key].key).toBe(key);
    }
  });

  it("生成物(src/generated.ts)が content/*.md から再生成した内容と一致する(driftチェック)", () => {
    const expected = renderGeneratedTs(collectLocalizedEntries());
    const actual = readFileSync(generatedFile, "utf8");
    expect(actual, "content/*.md を変更したら `pnpm --filter @kizami/help-content build` を再実行してコミットしてください").toBe(
      expected,
    );
  });
});

describe("訳文の完全性(ja/en/ko/zh)", () => {
  it("どのロケールにも訳文の欠落が無い", () => {
    // 欠落があればロケールごとに一覧で出す。実行時は helpEntryFor が日本語へフォールバックする
    // ので画面は壊れないが、その言語のユーザーには日本語が出ている = 未完了の作業として落とす。
    const report = HELP_LOCALES.filter((locale) => HELP_MISSING_KEYS[locale].length > 0).map(
      (locale) => `${locale}: ${HELP_MISSING_KEYS[locale].join(", ")}`,
    );
    expect(report, `訳文が欠けています(content/<slug>.<lang>.md を追加してください)\n${report.join("\n")}`).toEqual([]);
  });

  it("日本語(正)には全キーが揃っている", () => {
    expect(Object.keys(HELP_BY_LOCALE[HELP_SOURCE_LOCALE]).sort()).toEqual([...HELP_KEYS].sort());
  });

  it.each(TRANSLATED_LOCALES)("%s: キー集合が日本語と一致する", (locale) => {
    expect(Object.keys(HELP_BY_LOCALE[locale]).sort()).toEqual([...HELP_KEYS].sort());
  });

  it.each(TRANSLATED_LOCALES)("%s: audience / origin / key が日本語と一致する(翻訳対象ではない分類値)", (locale) => {
    for (const key of HELP_KEYS) {
      const translated = HELP_BY_LOCALE[locale][key];
      expect(translated, `${locale} に ${key} がありません`).toBeDefined();
      expect(translated!.key).toBe(key);
      expect([...translated!.audience].sort()).toEqual([...HELP[key].audience].sort());
      expect(translated!.origin).toBe(HELP[key].origin);
    }
  });

  it.each(TRANSLATED_LOCALES)("%s: summary / body が空でなく、origin: law には basis がある", (locale) => {
    for (const key of HELP_KEYS) {
      const entry = HELP_BY_LOCALE[locale][key]!;
      expect(entry.summary.trim().length, `${locale}/${key} の summary が空です`).toBeGreaterThan(0);
      expect(entry.body.trim().length, `${locale}/${key} の body が空です`).toBeGreaterThan(0);
      if (entry.origin === "law") {
        expect(entry.basis?.trim().length, `${locale}/${key} は origin: law なのに basis がありません`).toBeGreaterThan(0);
      }
    }
  });

  it.each(TRANSLATED_LOCALES)("%s: summary が1行である(frontmatterパーサが複数行スカラーを扱えないため)", (locale) => {
    for (const key of HELP_KEYS) {
      expect(HELP_BY_LOCALE[locale][key]!.summary.includes("\n"), `${locale}/${key} の summary が複数行です`).toBe(false);
    }
  });

  it.each(TRANSLATED_LOCALES)("%s: 日本語に companyExample があるキーには訳文にもある", (locale) => {
    for (const key of HELP_KEYS) {
      const hasSource = HELP[key].companyExample !== undefined;
      const hasTranslated = HELP_BY_LOCALE[locale][key]!.companyExample !== undefined;
      expect(hasTranslated, `${locale}/${key}: companyExample の有無が日本語と食い違っています`).toBe(hasSource);
    }
  });

  it.each(TRANSLATED_LOCALES)("%s: 本文の見出し数が日本語と一致する(節ごと落ちていないことの確認)", (locale) => {
    for (const key of HELP_KEYS) {
      expect(headingCount(HELP_BY_LOCALE[locale][key]!.body), `${locale}/${key} の見出し数が日本語と違います`).toBe(
        headingCount(HELP[key].body),
      );
    }
  });

  it.each(TRANSLATED_LOCALES)("%s: 制度ガイド内リンクの参照先が日本語と一致する", (locale) => {
    for (const key of HELP_KEYS) {
      expect(docLinkTargets(HELP_BY_LOCALE[locale][key]!.body), `${locale}/${key} のリンク先が日本語と違います`).toEqual(
        docLinkTargets(HELP[key].body),
      );
    }
  });
});

describe("ロケール解決(helpEntryFor の日本語フォールバック)", () => {
  it("訳文があるロケールではその訳文を返す", () => {
    const key = HELP_KEYS[0]!;
    for (const locale of HELP_LOCALES) {
      expect(helpEntryFor(key, locale)).toBe(HELP_BY_LOCALE[locale][key]);
    }
  });

  it("日本語では常に日本語エントリを返す", () => {
    for (const key of HELP_KEYS) {
      expect(helpEntryFor(key, HELP_SOURCE_LOCALE)).toBe(HELP[key]);
    }
  });

  it("訳文が無いキーは日本語へフォールバックする(undefined を返さない)", () => {
    // 訳文は全て揃っている状態を完全性テストで保証しているため、フォールバック経路は
    // 通常の実行では通らない。ここでは辞書から1件だけ外して、その1件が undefined ではなく
    // 日本語エントリで埋まることを確認する(将来キーを追加して訳文が遅れたときの挙動)。
    const key = HELP_KEYS[0]!;
    const saved = HELP_BY_LOCALE.en[key];
    try {
      delete HELP_BY_LOCALE.en[key];
      expect(helpEntryFor(key, "en")).toBe(HELP[key]);
    } finally {
      // saved は完全性テストが保証するとおり必ず存在する(exactOptionalPropertyTypes のため undefined 代入は不可)。
      if (saved) HELP_BY_LOCALE.en[key] = saved;
    }
  });

  it("helpEntriesFor は全キー分を返す", () => {
    for (const locale of HELP_LOCALES) {
      const entries = helpEntriesFor(locale);
      expect(entries).toHaveLength(HELP_KEYS.length);
      expect(entries.map((e) => e.key)).toEqual(HELP_KEYS);
    }
  });
});

describe("翻訳注記(1箇所のみ)", () => {
  it("日本語(正)には注記が無く、訳文ロケールには注記がある", () => {
    expect(helpTranslationNotice(HELP_SOURCE_LOCALE)).toBe("");
    for (const locale of TRANSLATED_LOCALES) {
      expect(helpTranslationNotice(locale).trim().length, `${locale} の翻訳注記が空です`).toBeGreaterThan(0);
    }
  });

  it("HELP_TRANSLATION_NOTICE は全ロケール分のキーを持つ", () => {
    expect(Object.keys(HELP_TRANSLATION_NOTICE).sort()).toEqual([...HELP_LOCALES].sort());
  });
});
