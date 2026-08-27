#!/usr/bin/env node
// リリースの3点(タグ名 / package.json の version / CHANGELOG.md の先頭エントリ)が
// 一致していることを検証する。release ワークフローの最初のジョブで走らせ、
// ズレたまま版タグを打ってしまう事故(= イミュータブルな版タグの打ち直し)を防ぐ。
//
// 使い方:
//   node scripts/release-check.mjs                     # セルフチェック(タグ不要)
//   node scripts/release-check.mjs --tag v0.7.0        # フル検証
//   RELEASE_TAG=v0.7.0 node scripts/release-check.mjs  # 環境変数でも可(CI は GITHUB_REF_NAME)
//   node scripts/release-check.mjs --body [--out FILE] # 該当版の本文を抽出(GitHub Release 用)
//   node scripts/release-check.mjs --self-test         # パーサの自己テスト(リポジトリ非依存)
//
// 終了コード: 0 = OK / 1 = 不一致・書式違反 / 2 = 使い方の誤り

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** SemVer(0.x を含む。プレリリース・ビルドメタも一応許容する) */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

/**
 * `v0.7.0` → `0.7.0`。`v` は必須にする(タグの書式を一意にしておかないと
 * `0.7.0` と `v0.7.0` の2種類のタグが並ぶ余地が残るため)。
 */
export function parseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error(`タグは v から始まる必要があります: ${JSON.stringify(tag)}`);
  }
  const version = tag.slice(1);
  if (!SEMVER.test(version)) {
    throw new Error(`タグのバージョンが SemVer ではありません: ${tag}`);
  }
  return version;
}

/**
 * CHANGELOG.md から最初のリリース節(= [Unreleased] を除く最上位の `## [x.y.z] - YYYY-MM-DD`)を
 * 抜き出す。戻り値の body は次の `## ` 見出しまで(リンク参照ブロックは含まない)。
 */
export function parseChangelog(text) {
  const lines = text.split("\n");
  const headings = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // コードフェンス内の `## ...` を見出しと誤認しない
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.startsWith("## ")) headings.push({ index: i, text: line.slice(3).trim() });
  }

  const releases = [];
  for (let h = 0; h < headings.length; h++) {
    const { index, text: heading } = headings[h];
    if (/^\[?Unreleased\]?$/i.test(heading)) continue;

    const m = /^\[([^\]]+)\]\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(heading);
    if (!m) {
      throw new Error(
        `CHANGELOG の見出しが Keep a Changelog の書式ではありません(${index + 1}行目): ## ${heading}\n` +
          `期待する形: ## [0.7.0] - 2026-08-27`,
      );
    }
    const [, version, date] = m;
    if (!SEMVER.test(version)) {
      throw new Error(`CHANGELOG のバージョンが SemVer ではありません: ${version}`);
    }
    const end = headings[h + 1]?.index ?? lines.length;
    releases.push({
      version,
      date,
      heading: `## ${heading}`,
      body: lines.slice(index + 1, end).join("\n").trim(),
    });
  }

  if (releases.length === 0) throw new Error("CHANGELOG にリリース節が1つもありません");
  return { releases, latest: releases[0], hasUnreleased: headings.some((x) => /^\[?Unreleased\]?$/i.test(x.text)) };
}

function readRepo() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const changelog = parseChangelog(readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8"));
  return { pkgVersion: pkg.version, changelog };
}

// --- 自己テスト(タグもリポジトリの状態も要らない。パーサの回帰用) ------------------

function selfTest() {
  const failures = [];
  const check = (name, fn) => {
    try {
      fn();
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  };
  const eq = (actual, expected, what) => {
    if (actual !== expected) throw new Error(`${what}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  };
  const throws = (fn, what) => {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`${what} は例外を投げるべき`);
  };

  check("parseTag", () => {
    eq(parseTag("v0.7.0"), "0.7.0", "通常のタグ");
    eq(parseTag("v1.0.0-rc.1"), "1.0.0-rc.1", "プレリリース");
    throws(() => parseTag("0.7.0"), "v なし");
    throws(() => parseTag("v0.7"), "パッチ欠落");
    throws(() => parseTag("v0.07.0"), "先頭ゼロ");
    throws(() => parseTag(undefined), "undefined");
  });

  check("parseChangelog: 基本", () => {
    const doc = [
      "# 変更履歴",
      "",
      "## [Unreleased]",
      "",
      "## [0.7.0] - 2026-08-27",
      "",
      "### Added",
      "",
      "- なにか",
      "",
      "## [0.6.0] - 2026-08-23",
      "",
      "- 旧版",
      "",
      "[0.7.0]: https://example.invalid/compare",
    ].join("\n");
    const { latest, releases, hasUnreleased } = parseChangelog(doc);
    eq(latest.version, "0.7.0", "最新版");
    eq(latest.date, "2026-08-27", "日付");
    eq(latest.body, "### Added\n\n- なにか", "本文");
    eq(releases.length, 2, "リリース数");
    eq(hasUnreleased, true, "Unreleased 節");
  });

  check("parseChangelog: コードフェンス内の ## を見出しにしない", () => {
    const doc = [
      "## [0.7.0] - 2026-08-27",
      "",
      "```md",
      "## [9.9.9] - 1999-01-01",
      "```",
      "",
      "- 本文",
    ].join("\n");
    const { releases, latest } = parseChangelog(doc);
    eq(releases.length, 1, "リリース数");
    eq(latest.body.includes("9.9.9"), true, "フェンスの中身は本文として残る");
  });

  check("parseChangelog: 書式違反を検出", () => {
    throws(() => parseChangelog("## [0.7.0]\n\n- 日付なし"), "日付なしの見出し");
    throws(() => parseChangelog("# 変更履歴\n\n本文だけ"), "リリース節なし");
  });

  if (failures.length > 0) {
    console.error("release-check セルフテスト失敗:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("release-check セルフテスト OK");
}

// --- CLI ------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const has = (flag) => args.includes(flag);
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  if (has("--help") || has("-h")) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 16).join("\n"));
    return;
  }

  if (has("--self-test")) return selfTest();

  const { pkgVersion, changelog } = readRepo();
  const { latest } = changelog;

  if (has("--body")) {
    // GitHub Release の本文。--tag があればその版、なければ CHANGELOG 先頭。
    const rawTag = valueOf("--tag") ?? process.env.RELEASE_TAG;
    const wanted = rawTag ? parseTag(rawTag) : latest.version;
    const entry = changelog.releases.find((r) => r.version === wanted);
    if (!entry) {
      console.error(`CHANGELOG に ${wanted} の節がありません`);
      process.exit(1);
    }
    const out = valueOf("--out");
    if (out) writeFileSync(out, `${entry.body}\n`);
    else process.stdout.write(`${entry.body}\n`);
    return;
  }

  // タグは引数 > RELEASE_TAG > GITHUB_REF_NAME(tag push の workflow で入る)の順。
  const rawTag = valueOf("--tag") ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;

  if (!rawTag) {
    // セルフチェック: タグが無くても package.json と CHANGELOG の整合だけは見る。
    if (pkgVersion !== latest.version) {
      console.error(
        `NG: package.json の version(${pkgVersion})と CHANGELOG 先頭(${latest.version})が一致しません`,
      );
      process.exit(1);
    }
    console.log(`OK(セルフチェック): version=${pkgVersion} / CHANGELOG=[${latest.version}] - ${latest.date}`);
    console.log("  タグまで検証するには --tag v<version> か RELEASE_TAG を渡してください");
    return;
  }

  let tagVersion;
  try {
    tagVersion = parseTag(rawTag);
  } catch (err) {
    console.error(`NG: ${err.message}`);
    process.exit(1);
  }

  const problems = [];
  if (tagVersion !== pkgVersion) {
    problems.push(`タグ(${rawTag} → ${tagVersion})と package.json の version(${pkgVersion})が不一致`);
  }
  if (tagVersion !== latest.version) {
    problems.push(`タグ(${tagVersion})と CHANGELOG 先頭のエントリ(${latest.version})が不一致`);
  }
  if (!changelog.hasUnreleased) {
    problems.push("CHANGELOG に [Unreleased] 節がありません");
  }

  if (problems.length > 0) {
    console.error("NG: リリース情報が揃っていません");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("");
    console.error("  版タグはイミュータブルです。打ち直さず、次のパッチ版として仕切り直してください。");
    console.error("  手順: docs/design/release-process.md");
    process.exit(1);
  }

  console.log(`OK: ${rawTag} = package.json ${pkgVersion} = CHANGELOG [${latest.version}] - ${latest.date}`);
}

// 直接実行されたときだけ CLI として動く(テストから import しても副作用が無いように)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv);
}
