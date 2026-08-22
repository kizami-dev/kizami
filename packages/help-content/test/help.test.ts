import { describe, expect, it } from "vitest";
import { collectEntries, renderGeneratedTs } from "../scripts/generate.mjs";
import { HELP, HELP_KEYS } from "../src/generated.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedFile = path.join(__dirname, "..", "src", "generated.ts");

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

  it("生成物(src/generated.ts)が content/*.ja.md から再生成した内容と一致する(driftチェック)", () => {
    const entries = collectEntries();
    const expected = renderGeneratedTs(entries);
    const actual = readFileSync(generatedFile, "utf8");
    expect(actual, "content/*.ja.md を変更したら `pnpm --filter @kizami/help-content build` を再実行してコミットしてください").toBe(
      expected,
    );
  });
});
