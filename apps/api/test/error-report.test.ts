/**
 * エラー報告(Sentry プロトコル互換)のテスト。設計は docs/design/observability.md。
 *
 * **実ネットワークへは一切出さない** — 送信関数(fetchFn)は必ず偽物を注入する。
 * 筆者の自前 sentry-relay(relay.bktsk.com)にも GlitchTip にも当てない。
 */

import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  buildErrorReporterFromEnv,
  createErrorReporter,
  describeError,
  parseSentryDsn,
  parseStackFrames,
  type SentryEvent,
} from "../src/lib/error-report.js";
import { loginAndGetCookie, setupTestDb } from "./support/setup.js";
import type { Database } from "@kizami/db";

const DSN = "https://publickey123@sentry.example.test/42";

/** 送信内容を溜める偽 fetch。実装が期待どおりの URL / ヘッダ / ボディで呼んだかを見る。 */
function createFetchSpy(): { calls: { url: string; init: RequestInit }[]; fetchFn: typeof fetch } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

/** 偽 fetch に渡されたボディを SentryEvent としてパースする。 */
function parseBody(init: RequestInit): SentryEvent {
  return JSON.parse(String(init.body)) as SentryEvent;
}

describe("parseSentryDsn", () => {
  it("標準的な DSN を store エンドポイントに変換する", () => {
    expect(parseSentryDsn(DSN)).toEqual({
      storeUrl: "https://sentry.example.test/api/42/store/",
      publicKey: "publickey123",
      projectId: "42",
    });
  });

  it("サブパス配下のセルフホスト受け口でもプレフィクスを保つ", () => {
    expect(parseSentryDsn("https://key@relay.example.test/sentry/ingest/7")?.storeUrl).toBe(
      "https://relay.example.test/sentry/ingest/api/7/store/",
    );
  });

  it("ポート番号と http スキームを保つ", () => {
    expect(parseSentryDsn("http://key@localhost:8000/1")?.storeUrl).toBe("http://localhost:8000/api/1/store/");
  });

  it("旧形式の key:secret を分解する", () => {
    const parsed = parseSentryDsn("https://key:secret@sentry.example.test/9");
    expect(parsed?.publicKey).toBe("key");
    expect(parsed?.secretKey).toBe("secret");
  });

  it("公開キーが無い・URL でない・スキームが違うものは null", () => {
    expect(parseSentryDsn("https://sentry.example.test/42")).toBeNull();
    expect(parseSentryDsn("not a url")).toBeNull();
    expect(parseSentryDsn("ftp://key@sentry.example.test/42")).toBeNull();
  });
});

describe("parseStackFrames", () => {
  it("V8 のスタックを古い順(例外に近いフレームが末尾)に並べ替える", () => {
    const stack = [
      "Error: boom",
      "    at inner (/app/apps/api/src/routes/punches.ts:10:5)",
      "    at outer (/app/apps/api/src/app.ts:20:7)",
    ].join("\n");
    const frames = parseStackFrames(stack);
    expect(frames.map((f) => f.function)).toEqual(["outer", "inner"]);
    expect(frames.at(-1)).toMatchObject({ filename: "/app/apps/api/src/routes/punches.ts", lineno: 10, colno: 5, in_app: true });
  });

  it("node_modules / node: 内部フレームは in_app=false", () => {
    const stack = ["Error: boom", "    at f (/app/node_modules/hono/dist/index.js:1:1)", "    at node:internal/process:5:5"].join("\n");
    expect(parseStackFrames(stack).every((f) => f.in_app === false)).toBe(true);
  });

  it("stack が無ければ空配列", () => {
    expect(parseStackFrames(undefined)).toEqual([]);
  });
});

describe("describeError", () => {
  it("Error 以外が投げられても中身を JSON 化しない(ボディ混入を防ぐ)", () => {
    const described = describeError({ password: "hunter2", body: { note: "secret" } });
    expect(described.value).toBe("non-Error thrown: object");
    expect(JSON.stringify(described)).not.toContain("hunter2");
  });
});

describe("createErrorReporter", () => {
  it("DSN 未設定なら完全な no-op(送信関数は一度も呼ばれない)", async () => {
    const { calls, fetchFn } = createFetchSpy();
    const reporter = createErrorReporter({ dsn: undefined, fetchFn });
    reporter.capture(new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(0);
  });

  it("DSN が不正でも例外を投げず no-op になる", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, fetchFn } = createFetchSpy();
    const reporter = createErrorReporter({ dsn: "://broken", fetchFn });
    reporter.capture(new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(0);
    warn.mockRestore();
  });

  it("store API の URL・認証ヘッダ・イベント形状を組み立てる", async () => {
    const { calls, fetchFn } = createFetchSpy();
    const reporter = createErrorReporter({
      dsn: DSN,
      fetchFn,
      release: "0.7.0",
      serverName: "kizami-abc123",
      environment: "production",
      now: () => 1_800_000_000_000,
    });

    reporter.capture(new TypeError("そんなことはない"), { method: "POST", route: "/punches", tenantId: "tenant-1" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const call = calls[0];
    expect(call?.url).toBe("https://sentry.example.test/api/42/store/");
    expect(call?.init.method).toBe("POST");

    const headers = call?.init.headers as Record<string, string>;
    expect(headers["X-Sentry-Auth"]).toBe("Sentry sentry_version=7, sentry_client=kizami/0.7.0, sentry_key=publickey123");
    expect(headers["Content-Type"]).toBe("application/json");
    // gzip しない(筆者の relay が gzip を取りこぼした実績があるため。lib/error-report.ts 冒頭)
    expect(headers["Content-Encoding"]).toBe("identity");

    const event = parseBody(call?.init ?? {});
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(event.timestamp).toBe(1_800_000_000);
    expect(event.level).toBe("error");
    expect(event.server_name).toBe("kizami-abc123");
    expect(event.environment).toBe("production");
    expect(event.release).toBe("0.7.0");
    expect(event.transaction).toBe("POST /punches");
    expect(event.tags).toMatchObject({ runtime: "node", release: "0.7.0", route: "/punches" });
    expect(event.exception.values[0]?.type).toBe("TypeError");
    expect(event.exception.values[0]?.value).toBe("そんなことはない");
    expect(event.exception.values[0]?.stacktrace?.frames.length).toBeGreaterThan(0);

    // テナントIDは生のまま載せない — SHA-256 の先頭8桁だけ
    expect(event.tags.tenant).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(event)).not.toContain("tenant-1");
  });

  it("ワーカーのスキャン失敗は transaction/tags に job を載せる", async () => {
    const { calls, fetchFn } = createFetchSpy();
    const reporter = createErrorReporter({ dsn: DSN, fetchFn, release: "0.7.0" });
    reporter.capture(new Error("scan exploded"), { job: "overtime-alert" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const event = parseBody(calls[0]?.init ?? {});
    expect(event.transaction).toBe("scan overtime-alert");
    expect(event.tags.job).toBe("overtime-alert");
    expect(event.exception.values[0]?.value).toBe("scan exploded");
  });

  it("同じ type+message+最上位フレームは窓の間 1件しか送らず、窓が明けたら再び送る", async () => {
    let currentMs = 1_000_000;
    const { calls, fetchFn } = createFetchSpy();
    const reporter = createErrorReporter({ dsn: DSN, fetchFn, now: () => currentMs, dedupeWindowMs: 60_000 });

    const boom = (): Error => new Error("同じエラー");
    reporter.capture(boom());
    reporter.capture(boom());
    reporter.capture(boom());
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    currentMs += 59_000;
    reporter.capture(boom());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(1);

    currentMs += 2_000;
    reporter.capture(boom());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });

  it("異なるエラーが大量に出ても窓あたりの上限で頭を押さえる", async () => {
    const { calls, fetchFn } = createFetchSpy();
    const reporter = createErrorReporter({ dsn: DSN, fetchFn, now: () => 1_000_000, maxEventsPerWindow: 3 });
    for (let i = 0; i < 20; i += 1) reporter.capture(new Error(`別のエラー ${i}`));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(3);
  });

  it("送信が失敗しても capture() は例外を投げない(撃ちっ放し)", async () => {
    const rejecting = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const reporter = createErrorReporter({ dsn: DSN, fetchFn: rejecting });
    expect(() => reporter.capture(new Error("boom"))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

describe("buildErrorReporterFromEnv", () => {
  it("SENTRY_DSN が無ければ no-op", async () => {
    const reporter = buildErrorReporterFromEnv({});
    expect(() => reporter.capture(new Error("boom"))).not.toThrow();
  });
});

describe("onError との統合", () => {
  /** `insert` だけを失敗させる db(打刻の書き込み時に 500 を起こす)。 */
  function failingInsertDb(db: Database): Database {
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "insert") {
          return () => {
            throw new Error("simulated insert failure");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as Database;
  }

  it("500 の応答は従来どおりで、リクエストボディ・ヘッダはイベントに載らない", async () => {
    const { db, email, password } = await setupTestDb();
    const cookie = await loginAndGetCookie(createApp({ db }), email, password);

    const { calls, fetchFn } = createFetchSpy();
    const errorReporter = createErrorReporter({ dsn: DSN, fetchFn, release: "0.7.0" });
    const app = createApp({ db: failingInsertDb(db), errorReporter });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await app.request("/punches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        // ヘッダに紛れた秘密もイベントへ出てはならない
        "user-agent": "SECRET-UA-MARKER",
      },
      body: JSON.stringify({ kind: "clock_in", occurredAt: 100, note: "SECRET-BODY-MARKER" }),
    });
    error.mockRestore();

    // onError の応答は変わらない
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const raw = String(calls[0]?.init.body);
    expect(raw).not.toContain("SECRET-BODY-MARKER");
    expect(raw).not.toContain("SECRET-UA-MARKER");
    expect(raw).not.toContain(email);

    const event = parseBody(calls[0]?.init ?? {});
    // ルートパターンのみ(生パスは載らない)
    expect(event.transaction).toBe("POST /punches");
    expect(event.tags.tenant).toMatch(/^[0-9a-f]{8}$/);
  });

  it("errorReporter を渡さなくても 500 応答は変わらない(既定は no-op)", async () => {
    const { db, email, password } = await setupTestDb();
    const cookie = await loginAndGetCookie(createApp({ db }), email, password);
    const app = createApp({ db: failingInsertDb(db) });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await app.request("/punches", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ kind: "clock_in", occurredAt: 100 }),
    });
    error.mockRestore();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});
