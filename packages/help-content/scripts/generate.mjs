/**
 * packages/help-content/content/*.md を読み取り、型付き辞書のソース(src/generated.ts)を
 * 生成する。
 *
 * なぜビルド時生成なのか: apps/web はブラウザで動くため、Node の `node:fs` に依存する
 * 実行時読み込みは選べない。ここで frontmatter を解析し、静的なオブジェクトリテラルとして
 * 書き出すことで、生成後の src/generated.ts はブラウザ・Node のどちらでも import できる
 * 依存ゼロのモジュールになる。
 *
 * frontmatter は README.md が定める固定フォーマット(scalar / [array] / `|` ブロックスカラー)
 * だけを扱えればよいため、汎用 YAML パーサは導入せず、この形式専用の最小限のパーサを書く。
 *
 * 使い方:
 *   node scripts/generate.mjs          … src/generated.ts を書き出す
 *   node scripts/generate.mjs --check  … 書き出さず、現在の src/generated.ts と一致するか検証する
 *                                        (不一致 or 未生成なら exit 1。CIのドリフト検出に使う)
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const contentDir = path.join(packageRoot, "content");
const outFile = path.join(packageRoot, "src", "generated.ts");

const VALID_AUDIENCES = new Set(["employee", "admin"]);
const VALID_ORIGINS = new Set(["law", "product", "company"]);

/** frontmatter の1ブロック分をパースする。README.md の frontmatter 仕様に合わせた最小実装。 */
function parseFrontmatter(raw, sourceFile) {
  const fields = {};
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const m = /^([A-Za-z][\w.-]*):\s*(.*)$/.exec(line);
    if (!m) {
      throw new Error(`${sourceFile}: frontmatterの行を解釈できません: ${JSON.stringify(line)}`);
    }
    const [, key, rest] = m;
    if (rest === "|") {
      // ブロックスカラー: 次の行から、2スペースインデントの行が続く限り取り込む
      const blockLines = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
        blockLines.push(lines[i].startsWith("  ") ? lines[i].slice(2) : "");
        i++;
      }
      // 末尾の空行を落とす
      while (blockLines.length > 0 && blockLines[blockLines.length - 1] === "") blockLines.pop();
      fields[key] = blockLines.join("\n");
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      fields[key] = rest
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      i++;
      continue;
    }
    fields[key] = rest.trim();
    i++;
  }
  return fields;
}

/** 1つの content/*.md ファイルを { key, lang, entry, body } にパースする。 */
function parseContentFile(absPath) {
  const raw = readFileSync(absPath, "utf8");
  const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!fmMatch) {
    throw new Error(`${absPath}: frontmatter (--- ... ---) が見つかりません`);
  }
  const [, fmRaw, bodyRaw] = fmMatch;
  const fields = parseFrontmatter(fmRaw, absPath);

  const filename = path.basename(absPath);
  const langMatch = /\.([a-z]{2})\.md$/.exec(filename);
  if (!langMatch) {
    throw new Error(`${absPath}: ファイル名は <slug>.<lang>.md の形式である必要があります`);
  }
  const lang = langMatch[1];

  if (!fields.key) throw new Error(`${absPath}: frontmatter に key がありません`);
  if (!fields.audience || !Array.isArray(fields.audience) || fields.audience.length === 0) {
    throw new Error(`${absPath}: frontmatter に audience(配列)がありません`);
  }
  for (const a of fields.audience) {
    if (!VALID_AUDIENCES.has(a)) throw new Error(`${absPath}: 不正な audience: ${a}`);
  }
  if (!fields.origin || !VALID_ORIGINS.has(fields.origin)) {
    throw new Error(`${absPath}: frontmatter の origin が不正です: ${fields.origin}`);
  }
  if (fields.origin === "law" && !fields.basis) {
    throw new Error(`${absPath}: origin: law には basis が必須です`);
  }
  if (!fields.summary) {
    throw new Error(`${absPath}: frontmatter に summary がありません`);
  }

  const expectedFilename = `${fields.key.split(".").join("-")}.${lang}.md`;
  if (filename !== expectedFilename) {
    throw new Error(`${absPath}: ファイル名がキー(${fields.key})と一致しません。期待値: ${expectedFilename}`);
  }

  return {
    key: fields.key,
    lang,
    entry: {
      key: fields.key,
      audience: fields.audience,
      origin: fields.origin,
      ...(fields.basis ? { basis: fields.basis } : {}),
      summary: fields.summary,
      body: bodyRaw.trim(),
      ...(fields.companyExample ? { companyExample: fields.companyExample } : {}),
    },
  };
}

/** content/ 配下の日本語(.ja.md)エントリを key でソートして集める。 */
export function collectEntries() {
  if (!existsSync(contentDir)) return [];
  const files = readdirSync(contentDir)
    .filter((f) => f.endsWith(".ja.md"))
    .sort((a, b) => a.localeCompare(b));

  const entries = files.map((f) => parseContentFile(path.join(contentDir, f)).entry);

  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.key)) throw new Error(`重複したキーがあります: ${e.key}`);
    seen.add(e.key);
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries;
}

/** entries から src/generated.ts のソース文字列を組み立てる。 */
export function renderGeneratedTs(entries) {
  const keyUnion = entries.map((e) => JSON.stringify(e.key)).join(" | ");

  const entryLiterals = entries
    .map((e) => {
      const lines = [
        `  ${JSON.stringify(e.key)}: {`,
        `    key: ${JSON.stringify(e.key)},`,
        `    audience: ${JSON.stringify(e.audience)},`,
        `    origin: ${JSON.stringify(e.origin)},`,
      ];
      if (e.basis) lines.push(`    basis: ${JSON.stringify(e.basis)},`);
      lines.push(`    summary: ${JSON.stringify(e.summary)},`);
      lines.push(`    body: ${JSON.stringify(e.body)},`);
      if (e.companyExample) lines.push(`    companyExample: ${JSON.stringify(e.companyExample)},`);
      lines.push(`  },`);
      return lines.join("\n");
    })
    .join("\n");

  return `/**
 * このファイルは生成物です。手で編集しないでください。
 *
 * 生成元: packages/help-content/content/*.ja.md
 * 生成コマンド: pnpm --filter @kizami/help-content build
 *   (scripts/generate.mjs — content/*.ja.md の frontmatter + 本文を読み取って書き出す)
 *
 * content/*.md を変更したら必ず再生成してコミットすること。生成物と content の不一致は
 * \`pnpm --filter @kizami/help-content test\` の drift チェックで検出される。
 */

/** ヘルプを見せる対象読者。 */
export type HelpAudience = "employee" | "admin";

/** 説明の出所。law=法令(変更不可・要根拠)、product=KIZAMIの仕様、company=導入企業の規定(DB管理・ここには含まれない)。 */
export type HelpOrigin = "law" | "product" | "company";

/** 参照キー(ドット区切り)の文字列リテラルunion。存在しないキーの参照はコンパイルエラーになる。 */
export type HelpKey = ${keyUnion};

/** 1件のヘルプエントリ(packages/help-content/README.md のfrontmatter仕様に対応)。 */
export interface HelpEntry {
  key: HelpKey;
  audience: HelpAudience[];
  origin: HelpOrigin;
  /** origin: "law" のときのみ存在する根拠条文。 */
  basis?: string;
  /** ツールチップ・インラインヒントに出す短い説明。 */
  summary: string;
  /** VitePress にそのまま掲載する本文(Markdown、frontmatterを除く)。 */
  body: string;
  /** 導入企業向けの社内規定・記入例のプレースホルダ。 */
  companyExample?: string;
}

/** キー→ヘルプエントリの辞書(日本語)。 */
export const HELP: Record<HelpKey, HelpEntry> = {
${entryLiterals}
};

/** HELP の全キー(定義順=キーのソート順)。 */
export const HELP_KEYS: HelpKey[] = Object.keys(HELP) as HelpKey[];
`;
}

function main() {
  const check = process.argv.includes("--check");
  const entries = collectEntries();
  const output = renderGeneratedTs(entries);

  if (check) {
    if (!existsSync(outFile)) {
      console.error(`[help-content] ${path.relative(packageRoot, outFile)} が存在しません。"pnpm --filter @kizami/help-content build" を実行してください。`);
      process.exit(1);
    }
    const current = readFileSync(outFile, "utf8");
    if (current !== output) {
      console.error(
        `[help-content] ${path.relative(packageRoot, outFile)} が content/*.ja.md と一致しません。` +
          ` "pnpm --filter @kizami/help-content build" を実行して再生成し、コミットしてください。`,
      );
      process.exit(1);
    }
    console.log(`[help-content] OK: ${entries.length} 件のヘルプキーが生成物と一致しています。`);
    process.exit(0);
  }

  writeFileSync(outFile, output, "utf8");
  console.log(`[help-content] ${path.relative(packageRoot, outFile)} を書き出しました(${entries.length} 件)。`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`[help-content] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
