/**
 * Service Worker の判定ロジック(public/sw-lib.js)のテスト。
 * sw-lib.js は SW 内で importScripts されるクラシックスクリプトなので、ここでは
 * ソースを読んで、偽の self を渡して評価する。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface SwLib {
  safeNotificationUrl(url: unknown, origin: string): string;
  isCacheableUrl(url: string, origin: string): boolean;
  isCacheableResponse(response: unknown): boolean;
}

const source = readFileSync(new URL("../public/sw-lib.js", import.meta.url), "utf8");
const fakeSelf: { KizamiSwLib?: SwLib } = {};
new Function("self", source)(fakeSelf);
const lib = fakeSelf.KizamiSwLib as SwLib;

const ORIGIN = "https://kizami.example";

describe("safeNotificationUrl", () => {
  it("同一オリジンの相対・絶対 URL は通す", () => {
    expect(lib.safeNotificationUrl("/corrections?id=1#x", ORIGIN)).toBe("/corrections?id=1#x");
    expect(lib.safeNotificationUrl("https://kizami.example/punch", ORIGIN)).toBe("/punch");
  });
  it("別オリジン・スキーム違い・プロトコル相対は / に落とす", () => {
    expect(lib.safeNotificationUrl("https://evil.example/phish", ORIGIN)).toBe("/");
    expect(lib.safeNotificationUrl("//evil.example/x", ORIGIN)).toBe("/");
    expect(lib.safeNotificationUrl("http://kizami.example/x", ORIGIN)).toBe("/");
    expect(lib.safeNotificationUrl("javascript:alert(1)", ORIGIN)).toBe("/");
    expect(lib.safeNotificationUrl("data:text/html,x", ORIGIN)).toBe("/");
  });
  it("文字列でない値は / に落とす", () => {
    expect(lib.safeNotificationUrl(undefined, ORIGIN)).toBe("/");
    expect(lib.safeNotificationUrl(42, ORIGIN)).toBe("/");
  });
});

describe("isCacheableUrl", () => {
  it("通常のページ・静的アセットはキャッシュしてよい", () => {
    expect(lib.isCacheableUrl(`${ORIGIN}/`, ORIGIN)).toBe(true);
    expect(lib.isCacheableUrl(`${ORIGIN}/punch`, ORIGIN)).toBe(true);
    expect(lib.isCacheableUrl(`${ORIGIN}/assets/app-abc123.js`, ORIGIN)).toBe(true);
    expect(lib.isCacheableUrl("https://fonts.gstatic.com/s/x.woff2", ORIGIN)).toBe(true);
  });
  it("トークン付きのページ(再設定・招待・サインアップ確認)は除外する", () => {
    expect(lib.isCacheableUrl(`${ORIGIN}/reset/abc`, ORIGIN)).toBe(false);
    expect(lib.isCacheableUrl(`${ORIGIN}/invite/abc`, ORIGIN)).toBe(false);
    expect(lib.isCacheableUrl(`${ORIGIN}/signup/verify`, ORIGIN)).toBe(false);
    expect(lib.isCacheableUrl(`${ORIGIN}/forgot-password`, ORIGIN)).toBe(false);
  });
  it("API・認証のパスは除外する", () => {
    expect(lib.isCacheableUrl(`${ORIGIN}/api/auth/session`, ORIGIN)).toBe(false);
    expect(lib.isCacheableUrl(`${ORIGIN}/auth/callback`, ORIGIN)).toBe(false);
  });
  it("token 系のクエリが付いた URL は除外する", () => {
    expect(lib.isCacheableUrl(`${ORIGIN}/login?token=x`, ORIGIN)).toBe(false);
    expect(lib.isCacheableUrl(`${ORIGIN}/login?Code=x&state=y`, ORIGIN)).toBe(false);
    expect(lib.isCacheableUrl(`${ORIGIN}/punch?tab=1`, ORIGIN)).toBe(true);
  });
  it("前方一致の取り違えをしない(/resetting は別パス)", () => {
    expect(lib.isCacheableUrl(`${ORIGIN}/resetting`, ORIGIN)).toBe(true);
  });
});

describe("isCacheableResponse", () => {
  const res = (init: { ok?: boolean; type?: string; cc?: string }) => ({
    ok: init.ok ?? true,
    type: init.type ?? "basic",
    headers: { get: (k: string) => (k === "cache-control" ? (init.cc ?? null) : null) },
  });
  it("成功レスポンスは通す", () => expect(lib.isCacheableResponse(res({}))).toBe(true));
  it("opaque は通す", () => expect(lib.isCacheableResponse(res({ ok: false, type: "opaque" }))).toBe(true));
  it("失敗・no-store・private は通さない", () => {
    expect(lib.isCacheableResponse(res({ ok: false }))).toBe(false);
    expect(lib.isCacheableResponse(res({ cc: "no-store" }))).toBe(false);
    expect(lib.isCacheableResponse(res({ cc: "private, max-age=0" }))).toBe(false);
  });
  it("空は通さない", () => expect(lib.isCacheableResponse(undefined)).toBe(false));
});
