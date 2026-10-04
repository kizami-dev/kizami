import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../src/lib/markdown";

describe("parseInline", () => {
  it("太字とコードを分け、HTML はそのまま文字にする", () => {
    expect(parseInline("a **b** `c` <script>")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
      { kind: "text", text: " <script>" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("見出し・段落・箇条書き・番号付き・引用・区切り線に分ける", () => {
    const blocks = parseMarkdown("# 題\n\n本文1\n本文2\n\n- あ\n- い\n\n1. 一\n2. 二\n\n> 注意\n\n---");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "quote", "rule"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", inline: [{ kind: "text", text: "本文1 本文2" }] });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
  });
});
