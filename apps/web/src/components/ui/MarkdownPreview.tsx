import { parseMarkdown, type InlineNode } from "../../lib/markdown";

function renderInline(nodes: InlineNode[]) {
  return nodes.map((n, i) => {
    if (n.kind === "strong") return <strong key={i}>{n.text}</strong>;
    if (n.kind === "code") return <code key={i}>{n.text}</code>;
    return n.text;
  });
}

/**
 * Markdown の整形表示。HTML は一切差し込まず、lib/markdown.ts の構造を React 要素にする。
 * 見出しは画面の h2(カードの題)より下の h3/h4/h5 に下げる。
 */
export function MarkdownPreview({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading": {
            const Tag = (["h3", "h4", "h5"] as const)[b.level - 1]!;
            return <Tag key={i}>{renderInline(b.inline)}</Tag>;
          }
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return <blockquote key={i}>{renderInline(b.inline)}</blockquote>;
          case "rule":
            return <hr key={i} />;
          default:
            return <p key={i}>{renderInline(b.inline)}</p>;
        }
      })}
    </div>
  );
}
