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
 * 多言語(2026-08-24 追加): UI が ja/en/ko/zh の4言語に対応したため、ヘルプ本文も
 * `content/<slug>.<lang>.md` の兄弟ファイルとして各言語を持つ。**日本語(ja)が単一の正**で、
 * 翻訳は ja に存在するキーの訳文としてのみ存在できる(ja に無いキーの訳文ファイルはエラー)。
 * 生成物は言語ごとの辞書(HELP_BY_LOCALE)と、言語ごとの欠落キー一覧(HELP_MISSING_KEYS)を
 * 併せて書き出す。欠落を型で消す(= 生成時に黙って ja を埋める)のではなく、
 * 「欠けているキーが誰から見ても分かる形で生成物に残り、テストで落ちる」形にしている。
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

/**
 * 対応ロケール。apps/web/src/lib/i18n/index.ts の `Locale` と同じ並び・同じ値にする
 * (web 側は文字列がそのまま一致することを前提に HelpLocale へ渡す)。
 */
const LOCALES = ["ja", "en", "ko", "zh"];

/** 単一の正となるロケール。翻訳が欠けているときのフォールバック先でもある。 */
const SOURCE_LOCALE = "ja";

/**
 * 翻訳の位置づけについての注記。**ファイルごとに免責を書かない**代わりに、ここで一度だけ定義し、
 * 生成物(HELP_TRANSLATION_NOTICE)経由で UI・ドキュメントから1箇所だけ表示する。
 *
 * 内容: 訳文は参照用であり、KIZAMI が実装している法令・その解釈の正文は日本語(および
 * 日本の法令そのもの)である、ということ。ja には注記を持たせない(空文字)— 日本語が正文なので
 * 「翻訳です」と断る対象が無い。
 */
const TRANSLATION_NOTICE = {
  ja: "",
  en: "This translation is provided for reference. The Japanese text and Japanese law are authoritative.",
  ko: "이 번역은 참고용입니다. 정본은 일본어 원문 및 일본 법령입니다.",
  zh: "本译文仅供参考。以日文原文及日本法律为准。",
};

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

/**
 * content/ 配下の指定ロケール(既定は日本語 .ja.md)のエントリを key でソートして集める。
 * 引数なしの呼び出しは従来どおり日本語エントリを返す(scripts/sync-help-docs.mjs が利用)。
 */
export function collectEntries(locale = SOURCE_LOCALE) {
  if (!existsSync(contentDir)) return [];
  const suffix = `.${locale}.md`;
  const files = readdirSync(contentDir)
    .filter((f) => f.endsWith(suffix))
    .sort((a, b) => a.localeCompare(b));

  const entries = files.map((f) => parseContentFile(path.join(contentDir, f)).entry);

  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.key)) throw new Error(`重複したキーがあります(${locale}): ${e.key}`);
    seen.add(e.key);
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries;
}

/**
 * 全ロケールのエントリを集め、翻訳側のメタデータが日本語(正)と食い違っていないか検証する。
 *
 * 戻り値: `{ locale: HelpEntry[] }`。ja は常に完全な一覧、他ロケールは訳文が存在するキーのみ。
 *
 * 検証する内容(いずれも訳文の作成ミスとして起こりやすいもの):
 * - ja に存在しないキーの訳文がある → 消し忘れ・キーのtypo。黙って無視すると気づけないのでエラー
 * - audience / origin が ja と違う → これらは翻訳対象ではない分類用の値。訳文側でズレると
 *   一覧のグループ分けや出所バッジが言語ごとに変わってしまう
 */
export function collectLocalizedEntries() {
  const byLocale = {};
  for (const locale of LOCALES) {
    byLocale[locale] = collectEntries(locale);
  }

  const sourceByKey = new Map(byLocale[SOURCE_LOCALE].map((e) => [e.key, e]));

  for (const locale of LOCALES) {
    if (locale === SOURCE_LOCALE) continue;
    for (const entry of byLocale[locale]) {
      const source = sourceByKey.get(entry.key);
      if (!source) {
        throw new Error(
          `content/${entry.key.split(".").join("-")}.${locale}.md: 対応する ${SOURCE_LOCALE} のエントリがありません(キー: ${entry.key})`,
        );
      }
      const sameAudience =
        source.audience.length === entry.audience.length && source.audience.every((a) => entry.audience.includes(a));
      if (!sameAudience) {
        throw new Error(
          `content/${entry.key.split(".").join("-")}.${locale}.md: audience が ${SOURCE_LOCALE} と一致しません(${JSON.stringify(entry.audience)} != ${JSON.stringify(source.audience)})`,
        );
      }
      if (source.origin !== entry.origin) {
        throw new Error(
          `content/${entry.key.split(".").join("-")}.${locale}.md: origin が ${SOURCE_LOCALE} と一致しません(${entry.origin} != ${source.origin})`,
        );
      }
    }
  }

  return byLocale;
}

/** ロケールごとの「日本語にはあるが訳文が無い」キー一覧(ja は常に空)。 */
export function missingKeysByLocale(byLocale) {
  const sourceKeys = byLocale[SOURCE_LOCALE].map((e) => e.key);
  const missing = {};
  for (const locale of LOCALES) {
    const present = new Set(byLocale[locale].map((e) => e.key));
    missing[locale] = sourceKeys.filter((k) => !present.has(k));
  }
  return missing;
}

/** 1件のエントリを TypeScript のオブジェクトリテラルへ("  " × indent のインデントを付ける)。 */
function renderEntryLiteral(entry, indent) {
  const pad = "  ".repeat(indent);
  const lines = [
    `${pad}${JSON.stringify(entry.key)}: {`,
    `${pad}  key: ${JSON.stringify(entry.key)},`,
    `${pad}  audience: ${JSON.stringify(entry.audience)},`,
    `${pad}  origin: ${JSON.stringify(entry.origin)},`,
  ];
  if (entry.basis) lines.push(`${pad}  basis: ${JSON.stringify(entry.basis)},`);
  lines.push(`${pad}  summary: ${JSON.stringify(entry.summary)},`);
  lines.push(`${pad}  body: ${JSON.stringify(entry.body)},`);
  if (entry.companyExample) lines.push(`${pad}  companyExample: ${JSON.stringify(entry.companyExample)},`);
  lines.push(`${pad}},`);
  return lines.join("\n");
}

/**
 * 全ロケールのエントリから src/generated.ts のソース文字列を組み立てる。
 *
 * 引数は collectLocalizedEntries() の戻り値。後方互換のため、日本語エントリの配列だけを
 * 渡す旧シグネチャ(`renderGeneratedTs(entries)`)も受け付ける。
 */
export function renderGeneratedTs(byLocaleOrEntries) {
  const byLocale = Array.isArray(byLocaleOrEntries)
    ? { ja: byLocaleOrEntries, en: [], ko: [], zh: [] }
    : byLocaleOrEntries;

  const entries = byLocale[SOURCE_LOCALE];
  const keyUnion = entries.map((e) => JSON.stringify(e.key)).join(" | ");
  const entryLiterals = entries.map((e) => renderEntryLiteral(e, 1)).join("\n");
  const missing = missingKeysByLocale(byLocale);

  const translatedLocales = LOCALES.filter((l) => l !== SOURCE_LOCALE);

  const translatedDicts = translatedLocales
    .map((locale) => {
      const body = byLocale[locale].map((e) => renderEntryLiteral(e, 2)).join("\n");
      return `  ${locale}: {\n${body}\n  },`;
    })
    .join("\n");

  const missingLiteral = LOCALES.map((locale) => `  ${locale}: ${JSON.stringify(missing[locale])},`).join("\n");

  const noticeLiteral = LOCALES.map((locale) => `  ${locale}: ${JSON.stringify(TRANSLATION_NOTICE[locale])},`).join("\n");

  const localeUnion = LOCALES.map((l) => JSON.stringify(l)).join(" | ");

  return `/**
 * このファイルは生成物です。手で編集しないでください。
 *
 * 生成元: packages/help-content/content/*.{${LOCALES.join(",")}}.md
 * 生成コマンド: pnpm --filter @kizami/help-content build
 *   (scripts/generate.mjs — content/*.md の frontmatter + 本文を読み取って書き出す)
 *
 * content/*.md を変更したら必ず再生成してコミットすること。生成物と content の不一致は
 * \`pnpm --filter @kizami/help-content test\` の drift チェックで検出される。
 */

/** ヘルプを見せる対象読者。 */
export type HelpAudience = "employee" | "admin";

/** 説明の出所。law=法令(変更不可・要根拠)、product=KIZAMIの仕様、company=導入企業の規定(DB管理・ここには含まれない)。 */
export type HelpOrigin = "law" | "product" | "company";

/** ヘルプ本文のロケール。apps/web/src/lib/i18n の \`Locale\` と同じ値。 */
export type HelpLocale = ${localeUnion};

/** 単一の正となるロケール。訳文が無いキーはこのロケールへフォールバックする。 */
export const HELP_SOURCE_LOCALE = ${JSON.stringify(SOURCE_LOCALE)} as const;

/** 対応ロケールの一覧(表示順)。 */
export const HELP_LOCALES: readonly HelpLocale[] = ${JSON.stringify(LOCALES)};

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

/** キー→ヘルプエントリの辞書(日本語)。日本語は常に全キーが揃っている。 */
export const HELP: Record<HelpKey, HelpEntry> = {
${entryLiterals}
};

/**
 * ロケール → キー → ヘルプエントリ。
 *
 * 訳文ロケールの値の型が \`Partial<...>\` なのは意図的で、翻訳が1件でも欠ければ
 * 参照側は必ず undefined を扱う(= フォールバックを書く)ことになる。
 * 「生成時に黙って日本語で埋める」設計にすると、訳文が無いことが型からも実行時からも
 * 見えなくなり、翻訳漏れが永久に発見されない。欠落キーは HELP_MISSING_KEYS と
 * \`pnpm --filter @kizami/help-content test\` の完全性テストで可視化する。
 *
 * 参照するときは src/index.ts の \`helpEntryFor(key, locale)\` を使うこと(フォールバック込み)。
 */
export const HELP_BY_LOCALE: Record<HelpLocale, Partial<Record<HelpKey, HelpEntry>>> = {
  ${SOURCE_LOCALE}: HELP,
${translatedDicts}
};

/**
 * ロケールごとの「日本語にはあるが訳文が無い」キー一覧(生成時点のスナップショット)。
 * すべて空配列であることをテストで保証する。空でない = その言語のヘルプは日本語のまま出る。
 */
export const HELP_MISSING_KEYS: Record<HelpLocale, HelpKey[]> = {
${missingLiteral}
};

/**
 * 訳文の位置づけについての注記(1箇所のみ・ファイルごとの免責は書かない方針)。
 * 日本語(HELP_SOURCE_LOCALE)は空文字 — 正文そのものなので断り書きの対象にならない。
 */
export const HELP_TRANSLATION_NOTICE: Record<HelpLocale, string> = {
${noticeLiteral}
};

/** HELP の全キー(定義順=キーのソート順)。 */
export const HELP_KEYS: HelpKey[] = Object.keys(HELP) as HelpKey[];
`;
}

function main() {
  const check = process.argv.includes("--check");
  const byLocale = collectLocalizedEntries();
  const entries = byLocale[SOURCE_LOCALE];
  const output = renderGeneratedTs(byLocale);

  const missing = missingKeysByLocale(byLocale);
  for (const locale of LOCALES) {
    if (missing[locale].length > 0) {
      console.warn(`[help-content] 警告: ${locale} の訳文が ${missing[locale].length} 件欠けています: ${missing[locale].join(", ")}`);
    }
  }

  if (check) {
    if (!existsSync(outFile)) {
      console.error(`[help-content] ${path.relative(packageRoot, outFile)} が存在しません。"pnpm --filter @kizami/help-content build" を実行してください。`);
      process.exit(1);
    }
    const current = readFileSync(outFile, "utf8");
    if (current !== output) {
      console.error(
        `[help-content] ${path.relative(packageRoot, outFile)} が content/*.md と一致しません。` +
          ` "pnpm --filter @kizami/help-content build" を実行して再生成し、コミットしてください。`,
      );
      process.exit(1);
    }
    console.log(`[help-content] OK: ${entries.length} 件のヘルプキーが生成物と一致しています。`);
    process.exit(0);
  }

  writeFileSync(outFile, output, "utf8");
  const counts = LOCALES.map((l) => `${l}=${byLocale[l].length}`).join(" ");
  console.log(`[help-content] ${path.relative(packageRoot, outFile)} を書き出しました(${counts})。`);
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
