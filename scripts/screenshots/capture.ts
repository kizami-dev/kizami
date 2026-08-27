/**
 * Playwright で SCREENS の全画面を ライト/ダーク × デスクトップ/モバイル で撮影する。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { OUTPUT_DIR, WEB_BASE_URL } from "./config.js";
import { SCREENS, type Screen } from "./screens.js";

export type Viewport = "desktop" | "mobile";
export type Theme = "light" | "dark";

const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

export interface CapturedShot {
  slug: string;
  title: string;
  caption: string;
  viewport: Viewport;
  theme: Theme;
  file: string;
}

function resolvePath(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

async function newAuthedContext(browser: Browser, sessionCookie: string, viewport: Viewport, theme: Theme): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
    // 一覧の既定言語を日本語に固定する。アプリの言語初期値は navigator.language を見るため、
    // 指定しないと Playwright 既定の en でUI全体が英語になってしまう(2026-08-23)。
    locale: "ja-JP",
  });
  const [name, value] = sessionCookie.split("=");
  if (name && value !== undefined) {
    await context.addCookies([
      {
        name,
        value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  return context;
}

const ADMIN_SESSION_KEY = "admin";

export interface CaptureParams {
  sessionCookie: string;
  vars: Record<string, string>;
  /**
   * テナント管理者以外のユーザーとして撮る画面(Screen.authAs)のための追加セッション。
   * キーは Screen.authAs の値と対応させる。
   */
  extraSessionCookies?: Record<string, string>;
}

export async function captureAll(params: CaptureParams): Promise<CapturedShot[]> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const shots: CapturedShot[] = [];

  try {
    for (const viewport of ["desktop", "mobile"] as const) {
      const screensForViewport = SCREENS.filter((s) => viewport === "desktop" || s.mobile);
      for (const theme of ["light", "dark"] as const) {
        // ログイン画面用に Cookie 無しのコンテキストも1つ用意する(同じ browser インスタンス内、
        // 新しい newContext は既定で Cookie を持たないため別プロセスを立てる必要は無い)。
        const anonContext = screensForViewport.some((s) => !s.requiresAuth)
          ? await browser.newContext({ viewport: VIEWPORTS[viewport], colorScheme: theme, locale: "ja-JP" })
          : null;

        // authAs ごとに authed context を作る(既定は "admin" = params.sessionCookie)。
        // 遅延生成にし、実際にその画面が撮られるときだけ Cookie を解決する。
        const authedContexts = new Map<string, BrowserContext>();
        async function getAuthedContext(authAs: string): Promise<BrowserContext> {
          const existing = authedContexts.get(authAs);
          if (existing) return existing;
          const cookie = authAs === ADMIN_SESSION_KEY ? params.sessionCookie : params.extraSessionCookies?.[authAs];
          if (!cookie) throw new Error(`capture.ts: no session cookie registered for authAs="${authAs}"`);
          const ctx = await newAuthedContext(browser, cookie, viewport, theme);
          authedContexts.set(authAs, ctx);
          return ctx;
        }

        for (const screen of screensForViewport) {
          const context = screen.requiresAuth ? await getAuthedContext(screen.authAs ?? ADMIN_SESSION_KEY) : anonContext;
          if (!context) continue;
          const shot = await captureOne(context, screen, viewport, theme, params.vars);
          shots.push(shot);
        }

        for (const ctx of authedContexts.values()) await ctx.close();
        await anonContext?.close();
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), JSON.stringify(shots, null, 2), "utf8");
  return shots;
}

async function captureOne(
  context: BrowserContext,
  screen: Screen,
  viewport: Viewport,
  theme: Theme,
  vars: Record<string, string>,
): Promise<CapturedShot> {
  const page = await context.newPage();
  // 画面単位の言語上書き(多言語UIのデモ用)。localStorage を初期スクリプトで仕込む —
  // アプリは kizami-locale を navigator.language より優先するため確実に効く。
  if (screen.locale) {
    await page.addInitScript((loc) => localStorage.setItem("kizami-locale", loc), screen.locale);
  }
  /*
   * 使い方ツアー(2026-08-27 追加)の抑止/解禁。
   *
   * ツアーは「完了記録が無ければ初回ログインとみなして自動で始まる」ため、素のままだと
   * 全画面に暗幕がかかってしまう。既定では完了フラグを立てた状態で開き(= 出さない)、
   * Screen.tour を立てた画面でだけフラグを消して自動開始させる。
   * localStorage はブラウザコンテキスト単位で残るため(言語上書きと同じ事情)、
   * 「消す」側も毎ページ明示的に行う — 直前の画面が書いた値が残っていると、
   * ツアー画面なのに始まらない/その逆が起きる。
   * 進捗(sessionStorage)も同時に消し、常に1手順目から始まる状態で撮る。
   */
  await page.addInitScript((showTour: boolean) => {
    try {
      if (showTour) localStorage.removeItem("kizami.tour.v1.done");
      else localStorage.setItem("kizami.tour.v1.done", "1");
      sessionStorage.removeItem("kizami.tour.v1.step");
    } catch {
      // ストレージが使えない環境は想定しない(Playwright の通常コンテキスト)。
    }
  }, screen.tour === true);
  if (screen.tour) {
    // ツアーは対象要素が画面外なら中央へスクロールする(既定は smooth)。撮影位置を決定的に
    // するため、この画面だけ「動きを減らす」設定にして瞬時にスクロールを終わらせる
    // (colorScheme は emulateMedia の省略時に維持されるため、ライト/ダークの指定は壊れない)。
    await page.emulateMedia({ reducedMotion: "reduce" });
  }
  const url = `${WEB_BASE_URL}${resolvePath(screen.path, vars)}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  // ハイドレーション後の useEffect フェッチ・カードのフェードイン等が落ち着くのを軽く待つ。
  await page.waitForTimeout(400);

  if (screen.tour) {
    // 実効権限の取得 → 対象要素の出現待ち → 実寸を測っての吹き出し配置、と数段構えのため、
    // 吹き出しが実際に見える状態になるまで待ってから撮る。
    await page.waitForSelector(".tour__card", { state: "visible", timeout: 15_000 });
    await page.waitForTimeout(400);
  }

  // モバイルの下部タブバー(.k-tabbar)は position: fixed のため、fullPage 撮影では
  // 「ビューポート基準の位置」がページ全体の途中に写り込んでしまう(Playwright の既知の挙動)。
  // 撮影時だけ absolute + ページ末尾に付け替え、実ブラウザでの見た目(常に画面下部)に
  // 最も近い「ページの一番下に1回だけ写る」形にする。実アプリの CSS は変更しない。
  // viewportOnly の画面はビューポート1枚をそのまま撮るため、この付け替えは不要
  // (むしろ実際の見た目=画面下部固定 から遠ざかる)。
  if (viewport === "mobile" && screen.viewportOnly !== true) {
    await page.addStyleTag({ content: ".k-tabbar { position: absolute !important; bottom: 0 !important; }" });
  }

  const file = `${screen.slug}--${viewport}--${theme}.png`;
  await page.screenshot({ path: path.join(OUTPUT_DIR, file), fullPage: screen.viewportOnly !== true });
  // 言語上書きは localStorage 経由のため、消さずに page を閉じると同一コンテキストの
  // 後続画面すべてがその言語で撮れてしまう(localStorage はコンテキスト単位で永続。
  // 実際に settings 系が英語で撮れた — 2026-08-23)。撮影後に必ず既定へ戻す。
  if (screen.locale) {
    await page.evaluate(() => localStorage.removeItem("kizami-locale"));
  }
  if (screen.tour) {
    // ツアー画面は完了フラグを消して開いている。同じコンテキストの後続画面に持ち越さない
    // よう、閉じる前に戻す(上の addInitScript でも毎ページ立て直すが、二重の安全策)。
    await page.evaluate(() => {
      localStorage.setItem("kizami.tour.v1.done", "1");
      sessionStorage.removeItem("kizami.tour.v1.step");
    });
  }
  await page.close();

  return { slug: screen.slug, title: screen.title, caption: screen.caption, viewport, theme, file };
}
