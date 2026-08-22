#!/usr/bin/env node
/**
 * `pnpm docs:guide` の実体。
 *
 * packages/help-content/content/*.ja.md を VitePress が読めるページ(docs/guide/*.md)として
 * 書き出す。docs/api/(typedoc生成物)と同じ扱いで、docs/guide/ は生成物なので .gitignore に
 * 含め、コミットはしない(単一ソースは content/ 側)。
 *
 * 各ページの先頭に出所バッジ(法令 or KIZAMIの仕様。法令は根拠条文つき)を1行差し込む。
 * ここで使う HELP のエントリ抽出ロジックは packages/help-content/scripts/generate.mjs の
 * collectEntries を再利用し、frontmatterパーサを二重に持たない。
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectEntries } from "../packages/help-content/scripts/generate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const guideDir = path.join(rootDir, "docs", "guide");

function slugOf(key) {
  return key.split(".").join("-");
}

function badgeLine(entry) {
  if (entry.origin === "law") {
    return `<span class="help-origin-badge help-origin-badge--law">法令 · ${entry.basis}</span>`;
  }
  if (entry.origin === "product") {
    return `<span class="help-origin-badge help-origin-badge--product">KIZAMIの仕様</span>`;
  }
  return `<span class="help-origin-badge help-origin-badge--company">自社の規定</span>`;
}

function audienceLine(entry) {
  const labels = entry.audience.map((a) => (a === "employee" ? "従業員の方へ" : "労務担当者の方へ"));
  return `<p class="help-origin-audience">対象: ${labels.join("・")}</p>`;
}

function renderPage(entry) {
  return `${badgeLine(entry)}
${audienceLine(entry)}

${entry.body}
`;
}

function main() {
  if (existsSync(guideDir)) rmSync(guideDir, { recursive: true, force: true });
  mkdirSync(guideDir, { recursive: true });

  const entries = collectEntries();
  for (const entry of entries) {
    const file = path.join(guideDir, `${slugOf(entry.key)}.md`);
    writeFileSync(file, renderPage(entry), "utf8");
  }

  // 一覧ページ(サイドバーの「制度ガイド」トップから遷移できる索引)
  const employeeEntries = entries.filter((e) => e.audience.includes("employee"));
  const adminEntries = entries.filter((e) => e.audience.includes("admin"));
  const indexBody = `# 制度ガイド

KIZAMI が根拠にしている法令・仕様の説明です。アプリのヘルプ(?アイコン)から個別のページへ
リンクしています。

## 従業員の方へ

${employeeEntries.map((e) => `- [${firstHeading(e.body)}](./${slugOf(e.key)})`).join("\n")}

## 労務担当者の方へ

${adminEntries.map((e) => `- [${firstHeading(e.body)}](./${slugOf(e.key)})`).join("\n")}
`;
  writeFileSync(path.join(guideDir, "index.md"), indexBody, "utf8");

  console.log(`[docs:guide] docs/guide/ に ${entries.length} 件のページ(+索引)を書き出しました。`);
}

function firstHeading(body) {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1] : "";
}

main();
