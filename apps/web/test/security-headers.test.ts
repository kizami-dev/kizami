import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apiOrigin, buildWebCsp, inlineScriptHashes, inlineScripts, withSecurityHeaders } from "../src/lib/security-headers";

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

const HTML = [
  "<!DOCTYPE html><html><head>",
  '<script type="module" async src="/assets/client.js"></script>',
  "<script>window.a = 1;</script>",
  '<script id="_R_">self.__FLIGHT_DATA = ["日本語"];</script>',
  "<script></script>",
  "</head><body></body></html>",
].join("");

function directive(csp: string, name: string): string[] {
  const found = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("inlineScripts / inlineScriptHashes", () => {
  it("src 付きと空のスクリプトを除いたインラインスクリプトだけを、UTF-8 の SHA-256 にする", async () => {
    expect(inlineScripts(HTML)).toEqual(["window.a = 1;", 'self.__FLIGHT_DATA = ["日本語"];']);
    expect(await inlineScriptHashes(HTML)).toEqual([sha("window.a = 1;"), sha('self.__FLIGHT_DATA = ["日本語"];')]);
  });
});

describe("buildWebCsp", () => {
  it("unsafe-inline / unsafe-eval を含まず、埋め込み・base・form・object を絞る", () => {
    const csp = buildWebCsp({ scriptHashes: ["'sha256-x'"] });
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(directive(csp, "script-src")).toEqual(["'self'", "'sha256-x'", "https://challenges.cloudflare.com"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
  });

  it("API が別オリジンなら connect-src に足す。相対パス(/api)なら 'self' だけで足りる", () => {
    expect(apiOrigin("/api")).toBeNull();
    expect(apiOrigin(undefined)).toBeNull();
    expect(apiOrigin("https://api.example.com/v1")).toBe("https://api.example.com");
    expect(directive(buildWebCsp({ apiOrigin: "https://api.example.com" }), "connect-src")).toContain("https://api.example.com");
  });
});

describe("withSecurityHeaders", () => {
  it("HTML にはインラインスクリプトのハッシュ入りの CSP と固定のヘッダを付け、本文は変えない", async () => {
    const res = await withSecurityHeaders(
      new Request("http://localhost/login"),
      new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "content-length": "1" } }),
    );
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(directive(csp, "script-src")).toContain(sha("window.a = 1;"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("permissions-policy")).toContain("geolocation=(self)");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(await res.text()).toBe(HTML);
  });

  it("HTTPS(X-Forwarded-Proto / CF-Visitor)なら includeSubDomains 無しの HSTS を付ける", async () => {
    for (const headers of [{ "x-forwarded-proto": "https" }, { "cf-visitor": '{"scheme":"https"}' }]) {
      const res = await withSecurityHeaders(new Request("http://localhost/", { headers }), new Response("x"));
      expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
    }
  });

  it("304 には CSP を付けない(キャッシュ済み HTML の CSP を上書きしないため)", async () => {
    const res = await withSecurityHeaders(new Request("http://localhost/"), new Response(null, { status: 304 }));
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("csp: false(開発サーバー)では CSP だけ付けない", async () => {
    const res = await withSecurityHeaders(
      new Request("http://localhost/"),
      new Response(HTML, { headers: { "content-type": "text/html" } }),
      { csp: false },
    );
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});
