/**
 * 最小限の Markdown 解析(雛形・社内規定のプレビュー用)。
 *
 * HTML を組み立てず、構造(ブロックと文中の装飾)だけを返す。描画側(ui/MarkdownPreview)が
 * React 要素にするので、本文中の `<` や `&` は文字のまま出る(HTML として解釈されない)。
 * 対応: 見出し(#〜###)・段落・箇条書き(- / *)・番号付き(1.)・引用(>)・区切り線(---)・
 * 文中の **太字** と `コード`。表・リンク・画像は対応しない(そのまま文字として出る)。
 */
export type InlineNode = { kind: "text"; text: string } | { kind: "strong"; text: string } | { kind: "code"; text: string };

export type BlockNode =
  | { kind: "heading"; level: 1 | 2 | 3; inline: InlineNode[] }
  | { kind: "paragraph"; inline: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: InlineNode[][] }
  | { kind: "quote"; inline: InlineNode[] }
  | { kind: "rule" };

const INLINE_PATTERN = /\*\*(.+?)\*\*|`([^`]+)`/g;

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE_PATTERN)) {
    const index = m.index ?? 0;
    if (index > last) nodes.push({ kind: "text", text: source.slice(last, index) });
    if (m[1] !== undefined) nodes.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) nodes.push({ kind: "code", text: m[2] });
    last = index + m[0].length;
  }
  if (last < source.length) nodes.push({ kind: "text", text: source.slice(last) });
  return nodes;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|\*{3,})$/;

export function parseMarkdown(source: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: InlineNode[][] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length > 0) blocks.push({ kind: "quote", inline: parseInline(quote.join(" ")) });
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushAll();
      continue;
    }
    if (RULE.test(line)) {
      flushAll();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, inline: parseInline(heading[2] ?? "") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = ordered !== null;
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push(parseInline((bullet ?? ordered)![1] ?? ""));
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      flushParagraph();
      flushList();
      quote.push(q[1] ?? "");
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}
