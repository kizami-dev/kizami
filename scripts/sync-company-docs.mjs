#!/usr/bin/env node
/**
 * `pnpm docs:company` の実体。
 *
 * リポジトリルートの `docs-local/`(存在すれば)の Markdown を、VitePress が読める
 * ページ(docs/company/*.md)としてコピーする。docs/guide/・docs/api/ と同じ扱いで、
 * docs/company/ は生成物なので .gitignore に含め、コミットはしない(単一ソースは
 * docs-local/ 側 — こちらも .gitignore 対象。導入企業ごとに異なる社内文書を KIZAMI の
 * リポジトリにコミットさせない、フォーク不要でアップグレードと衝突しないための仕組み)。
 *
 * docs-local/ が存在しない場合は何もしない(docs/company/ を作らない)。
 * docs/.vitepress/config.mts の buildCompanyDocsSidebar はその場合サイドバーの
 * 「社内規定」セクション自体を省略し、`vitepress dev`/`build` を壊さない
 * (buildGuideSidebar・buildApiSidebar と同じ流儀)。
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const sourceDir = path.join(rootDir, "docs-local");
const outDir = path.join(rootDir, "docs", "company");

function firstHeading(body) {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1] : "";
}

function slugOf(filename) {
  return filename.replace(/\.md$/, "");
}

function main() {
  // docs-local/ が無い(未導入 or まだ何も置いていない)環境ではセクション自体を出さない。
  if (!existsSync(sourceDir)) {
    console.log("[docs:company] docs-local/ が存在しないためスキップします(社内規定セクションは表示されません)。");
    return;
  }

  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".md") && name !== "README.example.md" && statSync(path.join(sourceDir, name)).isFile())
    .sort((a, b) => a.localeCompare(b));

  const pages = [];
  for (const file of files) {
    const body = readFileSync(path.join(sourceDir, file), "utf8");
    const slug = slugOf(file);
    writeFileSync(path.join(outDir, `${slug}.md`), body, "utf8");
    pages.push({ slug, title: firstHeading(body) || slug });
  }

  const indexBody = `# 社内規定

導入企業が \`docs-local/\` に置いた文書です(KIZAMI 本体のドキュメントではありません)。

${pages.length === 0 ? "まだ文書がありません。`docs-local/README.example.md` を参考に Markdown ファイルを置いてください。" : pages.map((p) => `- [${p.title}](./${p.slug})`).join("\n")}
`;
  writeFileSync(path.join(outDir, "index.md"), indexBody, "utf8");

  console.log(`[docs:company] docs/company/ に ${pages.length} 件のページ(+索引)を書き出しました。`);
}

main();
