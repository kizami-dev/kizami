#!/usr/bin/env node
/**
 * KIZAMI ロゴマーク(トンボ+時計の針)から各サイズのアイコンを生成する。
 *
 * ソース・オブ・トゥルース: apps/web/public/icons/source/kizami-mark.svg
 * (docs/design/ui-direction.md「ロゴとアイコン」節で確定した形状。座標・色・針の角度は変更禁止)。
 *
 * 意味: 12時の腕がK(黒)、右回りに C(3時)→M(6時)→Y(9時)。針は1時・5時方向で、
 * これは「K」の字の開き方に由来する。中央円は時計の文字盤かつトンボの円。
 *
 * サイズ別に線の太さ・腕の長さを変える(小さいほど太く・外へ伸ばす):
 * - large  (192px以上の実寸で見る用途): stroke-width 3、腕の外端は中心から4unit内側
 *   (=確定ソースSVGそのもの)
 * - medium (44〜96px相当の実寸で見る用途。apple-touch-icon はファイルは180pxだが
 *   実際にホーム画面へ表示される物理サイズは小さいため、このバケットを使う=判断点):
 *   stroke-width 4
 * - small  (32px以下。favicon-32.png と favicon.svg): stroke-width 5、腕をさらに外へ
 *   伸ばす(中心から2unit内側まで)
 *
 * 実行方法: `node scripts/generate-icons.mjs`(要 rsvg-convert)。
 * 生成物を確認したら再度実行するだけで再生成できる(手で編集した出力ファイルは上書きされる)。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../apps/web/public");
const sourceDir = path.join(publicDir, "icons/source");
const iconsDir = path.join(publicDir, "icons");
const docsPublicDir = path.resolve(__dirname, "../docs/public");

const INK_LIGHT = "#1A1A1A";
const INK_DARK = "#F2F2EE";
const CYAN = "#00A3D9";
const MAGENTA = "#E5007E";
const YELLOW = "#FFD400";
const PAPER = "#FBFBF9";

/** サイズバケットごとの線幅と腕の外端座標(中心からの内側オフセット、単位はSVG座標系64基準)。 */
const BUCKETS = {
  large: { strokeWidth: 3, tip: 4 },
  medium: { strokeWidth: 4, tip: 4 },
  small: { strokeWidth: 5, tip: 2 },
};

/**
 * マークの <g> 群(64x64 viewBox 前提)を組み立てる。
 * ink には固定色 or "currentColor"/CSSクラス切り替え用のプレースホルダを渡せる。
 */
function markGroups(bucket, { ink = INK_LIGHT, inkAttr } = {}) {
  const { strokeWidth: sw, tip } = BUCKETS[bucket];
  const outer = 64 - tip;
  const inkStroke = inkAttr ? `class="${inkAttr}"` : `stroke="${ink}"`;
  return `  <g stroke-width="${sw}" fill="none" stroke-linecap="square">
    <line x1="32" y1="${tip}" x2="32" y2="18" ${inkStroke}/>
    <line x1="${outer}" y1="32" x2="46" y2="32" stroke="${CYAN}"/>
    <line x1="32" y1="${outer}" x2="32" y2="46" stroke="${MAGENTA}"/>
    <line x1="${tip}" y1="32" x2="18" y2="32" stroke="${YELLOW}"/>
    <circle cx="32" cy="32" r="16" ${inkStroke}/>
  </g>
  <g ${inkAttr ? `class="${inkAttr}"` : `stroke="${ink}"`} stroke-width="${sw}" stroke-linecap="round">
    <line x1="32" y1="32" x2="41.5" y2="26.5"/>
    <line x1="32" y1="32" x2="41.5" y2="37.5"/>
  </g>`;
}

/** 確定ソースSVG(large バケット、ライトink固定)。apps/web/public/icons/source/ に残す。 */
function buildSourceSvg() {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
${markGroups("large", { ink: INK_LIGHT })}
</svg>
`;
}

/** favicon.svg: small バケット + ダーク対応(prefers-color-scheme で K/円/針の色を切り替え)。 */
function buildFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="KIZAMI">
  <!-- KIZAMIロゴマーク(トンボ+時計の針)。確定ソース: icons/source/kizami-mark.svg
       12時=K(黒/ダーク対応)、右回りにC(3時)→M(6時)→Y(9時)。詳細: docs/design/ui-direction.md -->
  <style>
    .k-ink { stroke: ${INK_LIGHT}; }
    @media (prefers-color-scheme: dark) {
      .k-ink { stroke: ${INK_DARK}; }
    }
  </style>
${markGroups("small", { inkAttr: "k-ink" })}
</svg>
`;
}

/** ラスタライズ用の正方形キャンバスSVG(背景色つき、中央配置)。maskable は scale で安全領域に収める。 */
function buildCanvasSvg(bucket, { canvas, background, scale = 1 } = {}) {
  const factor = (canvas / 64) * scale;
  const offset = (canvas - 64 * factor) / 2;
  const bg = background ? `<rect width="${canvas}" height="${canvas}" fill="${background}"/>\n  ` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}">
  ${bg}<g transform="translate(${offset},${offset}) scale(${factor})">
${markGroups(bucket, { ink: INK_LIGHT })}
  </g>
</svg>
`;
}

function rasterize(svgString, outPath, size) {
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", outPath, "-"], {
    input: svgString,
  });
}

function main() {
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(iconsDir, { recursive: true });
  mkdirSync(docsPublicDir, { recursive: true });

  // 1. 確定ソースSVG(再生成の起点として repo に残す)
  const sourceSvg = buildSourceSvg();
  writeFileSync(path.join(sourceDir, "kizami-mark.svg"), sourceSvg);
  // ダーク版は「#1A1A1A を #F2F2EE に置き換えるだけ」なので参照用に併置する
  writeFileSync(
    path.join(sourceDir, "kizami-mark-dark.svg"),
    `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
${markGroups("large", { ink: INK_DARK })}
</svg>
`,
  );

  // 2. favicon.svg(public 直下、ダーク対応・背景なし)
  const faviconSvg = buildFaviconSvg();
  writeFileSync(path.join(publicDir, "favicon.svg"), faviconSvg);

  // 2b. VitePress の themeConfig.logo 用(docs/public/。favicon.svg と同一内容)
  writeFileSync(path.join(docsPublicDir, "kizami-mark.svg"), faviconSvg);

  // 3. favicon-32.png(small バケット、背景なし=透過)
  rasterize(buildCanvasSvg("small", { canvas: 32 }), path.join(publicDir, "favicon-32.png"), 32);

  // 4. apple-touch-icon.png(180px。物理表示サイズは小さいため medium バケット、紙白背景)
  rasterize(
    buildCanvasSvg("medium", { canvas: 180, background: PAPER }),
    path.join(publicDir, "apple-touch-icon.png"),
    180,
  );

  // 5. icon-192 / icon-512(large バケット、紙白背景。manifest purpose "any")
  rasterize(buildCanvasSvg("large", { canvas: 192, background: PAPER }), path.join(iconsDir, "icon-192.png"), 192);
  rasterize(buildCanvasSvg("large", { canvas: 512, background: PAPER }), path.join(iconsDir, "icon-512.png"), 512);

  // 6. icon-maskable-512(安全領域80%に縮小、紙白背景。manifest purpose "maskable")
  rasterize(
    buildCanvasSvg("large", { canvas: 512, background: PAPER, scale: 0.8 }),
    path.join(iconsDir, "icon-maskable-512.png"),
    512,
  );

  console.log("Generated icons:");
  console.log("  apps/web/public/icons/source/kizami-mark.svg (+ -dark.svg)");
  console.log("  apps/web/public/favicon.svg");
  console.log("  apps/web/public/favicon-32.png");
  console.log("  apps/web/public/apple-touch-icon.png");
  console.log("  apps/web/public/icons/icon-192.png");
  console.log("  apps/web/public/icons/icon-512.png");
  console.log("  apps/web/public/icons/icon-maskable-512.png");
  console.log("  docs/public/kizami-mark.svg");
}

main();
