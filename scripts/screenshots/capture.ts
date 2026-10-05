/**
 * Playwright で SCREENS の全画面を ライト/ダーク × デスクトップ/モバイル で撮影する。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
    // 画面の時刻は JST 表示。撮影する端末の時刻帯に左右されないよう固定する。
    timezoneId: "Asia/Tokyo",
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

/**
 * Turnstile のスクリプトの代わり。外部(challenges.cloudflare.com)へ出さず、撮影で空白に
 * ならないよう、枠だけのプレースホルダを描く。
 */
const TURNSTILE_STUB = `window.turnstile = {
  render(el) {
    el.innerHTML = '<div style="box-sizing:border-box;width:300px;height:65px;border:1px dashed #76777b;display:flex;align-items:center;justify-content:center;font:12px sans-serif;color:#76777b">Turnstile</div>';
    return "stub";
  },
  remove() {},
};`;

/** 公開 API の設定応答を「システムメールもサインアップも無い配備(セルフホスト)」に差し替える。 */
async function stubSelfHosted(page: Page): Promise<void> {
  const headers = { "access-control-allow-origin": WEB_BASE_URL, "access-control-allow-credentials": "true" };
  await page.route("**/signup/config", (route) => route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify({ mode: "off" }) }));
  await page.route("**/password-resets/config", (route) =>
    route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify({ selfService: false }) }),
  );
}

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

  // ネイティブの日付・時刻入力の表記(yyyy/mm/dd・24時間)は context の locale ではなく起動言語に従うため --lang も合わせる
  const browser = await chromium.launch({ args: ["--lang=ja-JP"] });
  const shots: CapturedShot[] = [];

  try {
    for (const viewport of ["desktop", "mobile"] as const) {
      // SCREENSHOT_ONLY=slug,slug で一部の画面だけ撮り直せる(確認用)。
      const only = process.env.SCREENSHOT_ONLY?.split(",");
      const screensForViewport = SCREENS.filter((s) => (viewport === "desktop" || s.mobile) && (!only || only.includes(s.slug)));
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
  await page.route("**/challenges.cloudflare.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
  if (screen.selfHosted) await stubSelfHosted(page);
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
  // Turnstile の代役(登録・再設定フォーム)が描かれるのを待つ。無い画面では何もしない。
  await page.locator(".signup-turnstile > div").first().waitFor({ timeout: 1500 }).catch(() => undefined);

  if (screen.clickBeforeCapture) {
    // 行を開いて出る詳細など、URL だけでは開けない状態を撮る(2026-10-05 追加)。
    await page.locator(screen.clickBeforeCapture.selector).first().click();
    if (screen.clickBeforeCapture.waitFor) {
      await page.waitForSelector(screen.clickBeforeCapture.waitFor, { state: "visible", timeout: 15_000 });
    }
    // クリックのために横スクロールした表(スマホの幅の広い表)を左端へ戻し、撮る範囲を他の画面と揃える。
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        if (el.scrollLeft !== 0) el.scrollLeft = 0;
      }
    });
    await page.waitForTimeout(400);
  }

  if (screen.tour) {
    // 実効権限の取得 → 対象要素の出現待ち → 実寸を測っての吹き出し配置、と数段構えのため、
    // 吹き出しが実際に見える状態になるまで待ってから撮る。
    await page.waitForSelector(".tour__card", { state: "visible", timeout: 15_000 });
    await page.waitForTimeout(400);
  }

  // モバイルの下部タブバー(.k-tabbar)は position: fixed のため、fullPage 撮影では
  // 「ビューポート基準の位置」がページ全体の途中に写り込んでしまう(Playwright の既知の挙動)。
  // 以前の「absolute + bottom: 0」は、位置の基準がビューポート1枚分の初期包含ブロックになり、
  // 長いページでは途中(1画面目の下端)に残っていた。撮影時だけ、ページ全体の高さから
  // タブバーの高さを引いた位置(top)に絶対配置し、ページの一番下に1回だけ写るようにする。
  // 実アプリの CSS は変更しない。viewportOnly の画面はビューポート1枚をそのまま撮るため不要
  // (むしろ実際の見た目=画面下部固定 から遠ざかる)。
  if (viewport === "mobile" && screen.viewportOnly !== true) {
    await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".k-tabbar");
      if (!bar) return;
      bar.style.setProperty("position", "absolute", "important");
      bar.style.setProperty("bottom", "auto", "important");
      bar.style.setProperty("top", `${document.documentElement.scrollHeight - bar.offsetHeight}px`, "important");
    });
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
