/**
 * 撮影結果(manifest)から一覧ページ(docs/public/screenshots/index.html)を生成する。
 * docs/design/ui-direction.md の規律(K主体・静か・CMYKは小さなマークのみ)に従う、
 * 依存の無い単体HTML。VitePress からは静的ファイルとしてそのまま配信される。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { OUTPUT_DIR } from "./config.js";
import type { CapturedShot } from "./capture.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

interface CardData {
  slug: string;
  title: string;
  caption: string;
  light: string | null;
  dark: string | null;
}

function groupByScreen(shots: CapturedShot[], viewport: "desktop" | "mobile"): CardData[] {
  const bySlug = new Map<string, CardData>();
  for (const shot of shots) {
    if (shot.viewport !== viewport) continue;
    const entry = bySlug.get(shot.slug) ?? { slug: shot.slug, title: shot.title, caption: shot.caption, light: null, dark: null };
    if (shot.theme === "light") entry.light = shot.file;
    else entry.dark = shot.file;
    bySlug.set(shot.slug, entry);
  }
  return [...bySlug.values()];
}

function renderCard(card: CardData): string {
  return `
  <figure class="k-card">
    <figcaption class="k-card__head">
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.caption)}</p>
    </figcaption>
    <div class="k-card__pair">
      ${renderThumb(card.light, "ライト")}
      ${renderThumb(card.dark, "ダーク")}
    </div>
  </figure>`;
}

function renderThumb(file: string | null, label: string): string {
  if (!file) {
    return `<div class="k-thumb k-thumb--missing"><span>${escapeHtml(label)}: 未撮影</span></div>`;
  }
  return `
      <a class="k-thumb" href="${escapeHtml(file)}" data-lightbox data-label="${escapeHtml(label)}">
        <img src="${escapeHtml(file)}" alt="${escapeHtml(label)}" loading="lazy" />
        <span class="k-thumb__label">${escapeHtml(label)}</span>
      </a>`;
}

export function generateGallery(shots: CapturedShot[]): void {
  const desktopCards = groupByScreen(shots, "desktop");
  const mobileCards = groupByScreen(shots, "mobile");
  const generatedAt = new Date().toISOString();

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>KIZAMI スクリーンショット一覧</title>
<link rel="icon" href="/kizami-mark.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@500&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />
<style>
${CSS}
</style>
</head>
<body>
  <header class="k-topbar">
    <div class="k-topbar__brand">
      <span class="k-logo">KIZAMI</span>
      <span class="k-topbar__sub">スクリーンショット一覧</span>
    </div>
    <div class="k-topbar__controls">
      <div class="k-tabs" role="tablist" aria-label="表示切り替え">
        <button type="button" class="k-tab" data-viewport-btn="desktop" aria-pressed="true">デスクトップ</button>
        <button type="button" class="k-tab" data-viewport-btn="mobile" aria-pressed="false">モバイル</button>
      </div>
      <button type="button" class="k-theme-toggle" data-theme-toggle aria-label="配色を切り替え">
        <span data-theme-toggle-label>OS設定</span>
      </button>
    </div>
  </header>

  <main>
    <p class="k-lede">
      <code>pnpm screenshots</code> が一時環境にデモデータを投入し、Playwright で撮り直すたびに更新される一覧です。
      画面ごとにライト/ダークを並べています。画像をクリックすると拡大表示します。
    </p>

    <section class="k-grid" data-grid="desktop">
      ${desktopCards.map(renderCard).join("\n")}
    </section>
    <section class="k-grid" data-grid="mobile" hidden>
      ${mobileCards.map(renderCard).join("\n")}
    </section>
  </main>

  <footer class="k-footer">
    <p>生成日時: <span class="k-mono">${escapeHtml(generatedAt)}</span> ・ 撮影数: <span class="k-mono">${shots.length}</span></p>
  </footer>

  <div class="k-lightbox" data-lightbox-overlay hidden>
    <button type="button" class="k-lightbox__close" data-lightbox-close aria-label="閉じる">×</button>
    <img data-lightbox-image alt="" />
  </div>

<script>
${JS}
</script>
</body>
</html>
`;

  writeFileSync(path.join(OUTPUT_DIR, "index.html"), html, "utf8");
}

const CSS = `
:root {
  --k-paper: #fbfbf9;
  --k-key: #1a1a1a;
  --k-ink-soft: #55565a;
  --k-cyan: #00a3d9;
  --k-magenta: #e5007e;
  --k-yellow: #ffd400;
  --k-surface: #ffffff;
  --border-hair: 1px solid color-mix(in srgb, var(--k-key) 14%, transparent);
  --shadow-card: 0 1px 2px rgba(26,26,26,.08), 0 8px 24px rgba(26,26,26,.06);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --k-paper: #141618;
    --k-key: #f2f2ee;
    --k-ink-soft: #a9aba8;
    --k-surface: #1d2023;
    --shadow-card: 0 0 0 1px color-mix(in srgb, var(--k-key) 8%, transparent), 0 8px 24px rgba(0,0,0,.55);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --k-paper: #141618;
  --k-key: #f2f2ee;
  --k-ink-soft: #a9aba8;
  --k-surface: #1d2023;
  --shadow-card: 0 0 0 1px color-mix(in srgb, var(--k-key) 8%, transparent), 0 8px 24px rgba(0,0,0,.55);
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--k-paper);
  color: var(--k-key);
  font-family: "Zen Kaku Gothic New", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.k-mono { font-family: "IBM Plex Mono", ui-monospace, monospace; }
.k-topbar {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  padding: 16px 24px;
  background: var(--k-paper);
  border-bottom: var(--border-hair);
}
.k-topbar__brand { display: flex; align-items: baseline; gap: 12px; }
.k-logo { font-family: "Jost", "Futura", sans-serif; font-weight: 500; letter-spacing: .18em; font-size: 1.25rem; }
.k-topbar__sub { color: var(--k-ink-soft); font-size: .9rem; }
.k-topbar__controls { display: flex; align-items: center; gap: 12px; }
.k-tabs { display: inline-flex; border: var(--border-hair); border-radius: 999px; padding: 3px; gap: 2px; }
.k-tab {
  border: none; background: transparent; color: var(--k-ink-soft);
  padding: 6px 16px; border-radius: 999px; font: inherit; font-size: .85rem; cursor: pointer;
}
.k-tab[aria-pressed="true"] { background: var(--k-key); color: var(--k-paper); }
.k-theme-toggle {
  border: var(--border-hair); background: var(--k-surface); color: var(--k-key);
  border-radius: 999px; padding: 6px 14px; font: inherit; font-size: .85rem; cursor: pointer;
}
main { max-width: 1280px; margin: 0 auto; padding: 24px; }
.k-lede { color: var(--k-ink-soft); font-size: .9rem; max-width: 68ch; line-height: 1.7; }
.k-grid[hidden] { display: none; }
.k-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 20px; margin-top: 20px;
}
.k-grid[data-grid="mobile"] { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.k-card {
  margin: 0; border: var(--border-hair); border-radius: 12px; background: var(--k-surface);
  box-shadow: var(--shadow-card); overflow: hidden;
}
.k-card__head { padding: 14px 16px 4px; }
.k-card__head h3 { margin: 0 0 4px; font-size: 1rem; font-weight: 700; }
.k-card__head p { margin: 0; color: var(--k-ink-soft); font-size: .82rem; line-height: 1.6; }
.k-card__pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border-hair); margin-top: 12px; }
.k-thumb {
  position: relative; display: block; background: var(--k-paper); aspect-ratio: 4 / 3;
  overflow: hidden; text-decoration: none;
}
/* モバイル画面(390x844)は縦長なので、4:3 の横長枠だと中身がほぼ写らない。
   縦長の枠にして object-position を上寄せにし、ヘッダー〜主要コンテンツが見えるようにする。 */
[data-grid="mobile"] .k-thumb { aspect-ratio: 9 / 16; }
.k-thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.k-thumb__label {
  position: absolute; left: 8px; bottom: 8px; font-size: .7rem; color: var(--k-ink-soft);
  background: color-mix(in srgb, var(--k-surface) 85%, transparent); padding: 2px 8px; border-radius: 999px;
  border: var(--border-hair);
}
.k-thumb--missing { display: flex; align-items: center; justify-content: center; color: var(--k-ink-soft); font-size: .8rem; }
.k-footer { max-width: 1280px; margin: 0 auto; padding: 8px 24px 40px; color: var(--k-ink-soft); font-size: .78rem; }
.k-lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,.72); display: flex; align-items: center; justify-content: center;
  padding: 40px; z-index: 20;
}
.k-lightbox[hidden] { display: none; }
.k-lightbox img { max-width: 100%; max-height: 100%; border-radius: 4px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.k-lightbox__close {
  position: absolute; top: 20px; right: 24px; background: transparent; border: none; color: #fff;
  font-size: 2rem; line-height: 1; cursor: pointer;
}
`;

const JS = `
(function () {
  var THEME_KEY = "kizami-gallery-theme";
  function applyTheme(pref) {
    if (pref === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", pref);
    document.querySelector("[data-theme-toggle-label]").textContent =
      pref === "system" ? "OS設定" : pref === "dark" ? "ダーク" : "ライト";
  }
  var stored = localStorage.getItem(THEME_KEY) || "system";
  applyTheme(stored);
  document.querySelector("[data-theme-toggle]").addEventListener("click", function () {
    var order = ["system", "light", "dark"];
    var current = localStorage.getItem(THEME_KEY) || "system";
    var next = order[(order.indexOf(current) + 1) % order.length];
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  var VIEWPORT_KEY = "kizami-gallery-viewport";
  function applyViewport(viewport) {
    document.querySelectorAll("[data-grid]").forEach(function (el) {
      el.hidden = el.getAttribute("data-grid") !== viewport;
    });
    document.querySelectorAll("[data-viewport-btn]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-viewport-btn") === viewport));
    });
  }
  var storedViewport = localStorage.getItem(VIEWPORT_KEY) || "desktop";
  applyViewport(storedViewport);
  document.querySelectorAll("[data-viewport-btn]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var v = btn.getAttribute("data-viewport-btn");
      localStorage.setItem(VIEWPORT_KEY, v);
      applyViewport(v);
    });
  });

  var overlay = document.querySelector("[data-lightbox-overlay]");
  var overlayImg = document.querySelector("[data-lightbox-image]");
  function openLightbox(src, label) {
    overlayImg.src = src;
    overlayImg.alt = label;
    overlay.hidden = false;
  }
  function closeLightbox() {
    overlay.hidden = true;
    overlayImg.src = "";
  }
  document.querySelectorAll("[data-lightbox]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      openLightbox(a.getAttribute("href"), a.getAttribute("data-label") || "");
    });
  });
  document.querySelector("[data-lightbox-close]").addEventListener("click", closeLightbox);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeLightbox();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLightbox();
  });
})();
`;
