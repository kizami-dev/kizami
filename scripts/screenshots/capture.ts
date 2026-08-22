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
          ? await browser.newContext({ viewport: VIEWPORTS[viewport], colorScheme: theme })
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
  const url = `${WEB_BASE_URL}${resolvePath(screen.path, vars)}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  // ハイドレーション後の useEffect フェッチ・カードのフェードイン等が落ち着くのを軽く待つ。
  await page.waitForTimeout(400);

  const file = `${screen.slug}--${viewport}--${theme}.png`;
  await page.screenshot({ path: path.join(OUTPUT_DIR, file), fullPage: true });
  await page.close();

  return { slug: screen.slug, title: screen.title, caption: screen.caption, viewport, theme, file };
}
