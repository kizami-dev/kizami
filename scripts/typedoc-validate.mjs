#!/usr/bin/env node
/**
 * `pnpm docs:api` の実体。
 *
 * TypeDoc 0.28 系の `validation` オプションは notExported / notDocumented / invalidLink を
 * 一括りにしか error 化できない(`treatValidationWarningsAsErrors` は全カテゴリに効く)。
 * このプロジェクトでは
 *   - invalidLink   (壊れた {@link} 参照)
 *   - notExported   (公開APIが非公開の型を露出)
 * の2つだけを CI 失敗として扱い、
 *   - notDocumented (JSDoc未記載)
 * は警告に留めたい(現状のコメント充足率が不明なため)。
 *
 * そのため TypeDoc を子プロセスとして実行し、出力ログを分類してこのスクリプト側で
 * exit code を決める。TypeDoc 自体は `--treatWarningsAsErrors` を使わず、
 * validation.{invalidLink,notExported,notDocumented} をすべて `true` にして
 * 全カテゴリの警告を出力させたうえで、失敗させたい2カテゴリの警告文言だけを検出する。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// typedoc / typedoc-plugin-markdown は peer dependency の typescript が
// このリポジトリの typescript(7.x, TS Compiler API 非互換の native 版)と衝突するため、
// ルートではなく docs/ ワークスペースに typescript@5.x とあわせて隔離してインストールしている。
// 詳細は typedoc.json 隣接の説明、および完了報告を参照。
const typedocBin = path.join(rootDir, "docs", "node_modules", ".bin", "typedoc");

if (!existsSync(typedocBin)) {
  console.error(
    `typedoc binary not found at ${typedocBin}. Run "pnpm install" first (see docs/package.json devDependencies).`,
  );
  process.exit(1);
}

// notExported: 公開APIが非公開の型・値を参照している
const NOT_EXPORTED_PATTERNS = [
  /is referenced by .* but not included in the documentation/,
  /were marked as intentionally not exported/,
];

// invalidLink: {@link} / readme / document 内のリンクが解決できない、
// もしくは解決はできたが非公開でドキュメントに含まれない
const INVALID_LINK_PATTERNS = [
  /Failed to resolve link to/,
  /which was resolved but is not included in the documentation/,
];

const FAILING_PATTERNS = [...NOT_EXPORTED_PATTERNS, ...INVALID_LINK_PATTERNS];

const child = spawn(typedocBin, ["--options", path.join(rootDir, "typedoc.json")], {
  cwd: rootDir,
  stdio: ["ignore", "pipe", "pipe"],
});

let combined = "";

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  combined += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  combined += chunk.toString();
});

child.on("close", (code) => {
  // ANSI カラーコードを剥がしてから行単位でマッチさせる
  const plainLines = combined.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const failingLines = plainLines.filter((line) => FAILING_PATTERNS.some((re) => re.test(line)));

  if (failingLines.length > 0) {
    console.error("\n[docs:api] invalidLink / notExported の違反を検出しました(設計の綻びの可能性):\n");
    for (const line of failingLines) {
      console.error(`  - ${line.trim()}`);
    }
    console.error(
      "\n公開APIが非公開の型・値を露出しているか、{@link} 参照が壊れています。" +
        "型のexport漏れなら追加し、判断が必要な場合は設計を見直してください。\n",
    );
    process.exit(1);
  }

  if (code !== 0) {
    console.error(`\n[docs:api] typedoc exited with code ${code}`);
    process.exit(code ?? 1);
  }

  process.exit(0);
});
