/**
 * 外向きの接続の SSRF ガード(lib/outbound-guard.ts)のテスト。実際にローカルの HTTP サーバーへ接続して、
 * 「検査した IP にそのまま接続する」(DNS rebinding 対策)・リダイレクトを追わない・無効時は素通しを確認する。
 *
 * ローカルのサーバーは 127.0.0.1 で待ち受ける。ループバックは OUTBOUND_BLOCK_PRIVATE の拒否対象なので、
 * 「到達してよい IP」を作るテストでは blockPrivate=false + 拒否 CIDR(169.254/16)のポリシーを使い、
 * 「拒否される」テストでは blockPrivate=true を使う。
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmtpSendFn } from "@kizami/notify";
import {
  buildNotifyOutboundDeps,
  buildOutboundGuardFromEnv,
  createOutboundGuard,
  OutboundBlockedError,
  type OutboundResolver,
} from "../src/lib/outbound-guard.js";
import { createOutboundPolicy, parseCidr } from "../src/lib/outbound-policy.js";

interface Seen {
  host: string | undefined;
  method: string | undefined;
  url: string | undefined;
  body: string;
}

const servers: http.Server[] = [];

async function startServer(handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ host: req.headers.host, method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
      if (handler) return handler(req, res);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, seen };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

/** ループバックには届くが、メタデータ(169.254/16)は拒否するポリシー。 */
const reachableLoopback = createOutboundPolicy({ blockPrivate: false, denyCidrs: [parseCidr("169.254.0.0/16")!] });
const blockPrivate = createOutboundPolicy({ blockPrivate: true });

function resolverTo(...addresses: string[]): OutboundResolver {
  return vi.fn(async () => addresses.map((address) => ({ address, family: address.includes(":") ? (6 as const) : (4 as const) })));
}

describe("DNS rebinding 対策: 検査した IP にそのまま接続する", () => {
  it("名前解決は1回だけ。1回目に検査を通した IP へ接続し、2回目以降に別の IP を返すリゾルバでも影響されない", async () => {
    const { port, seen } = await startServer();
    // 1回目: 到達できて検査を通る IP / 2回目以降: メタデータの IP(rebinding の想定)
    let calls = 0;
    const resolve: OutboundResolver = vi.fn(async () => {
      calls += 1;
      return [{ address: calls === 1 ? "127.0.0.1" : "169.254.169.254", family: 4 as const }];
    });
    const guard = createOutboundGuard(reachableLoopback, { resolve });

    const res = await guard.fetch(`http://rebind.example:${port}/hook`, { method: "POST", body: "payload" });

    expect(res.status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    // 検査した IP(127.0.0.1)に接続し、Host ヘッダには元のホスト名が入る
    expect(seen).toEqual([{ host: `rebind.example:${port}`, method: "POST", url: "/hook", body: "payload" }]);
  });

  it("1回目の解決で拒否対象なら接続しない(サーバーには何も届かない)", async () => {
    const { port, seen } = await startServer();
    const guard = createOutboundGuard(blockPrivate, { resolve: resolverTo("127.0.0.1") });

    await expect(guard.fetch(`http://internal.example:${port}/`)).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(seen).toEqual([]);
  });

  it("公開 IP と拒否対象が混ざって返ってきたら、全体を拒否する", async () => {
    const { port, seen } = await startServer();
    const guard = createOutboundGuard(blockPrivate, { resolve: resolverTo("93.184.216.34", "127.0.0.1") });

    await expect(guard.fetch(`http://mixed.example:${port}/`)).rejects.toThrow(/not allowed \(private\)/);
    expect(seen).toEqual([]);
  });

  it("IP リテラルは名前解決が走らないので、接続の前に検査する", async () => {
    const { port, seen } = await startServer();
    const resolve = resolverTo("93.184.216.34");
    const guard = createOutboundGuard(blockPrivate, { resolve });

    for (const url of [`http://127.0.0.1:${port}/`, `http://[::1]:${port}/`, `http://169.254.169.254/latest/meta-data`, `http://[::ffff:10.0.0.1]/`, `http://2130706433:${port}/`]) {
      await expect(guard.fetch(url)).rejects.toBeInstanceOf(OutboundBlockedError);
    }
    expect(seen).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("名前だけで内部と分かるホスト(localhost)は解決の前に拒否する", async () => {
    const resolve = resolverTo("93.184.216.34");
    const guard = createOutboundGuard(blockPrivate, { resolve });
    await expect(guard.fetch("http://localhost:9/")).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("OUTBOUND_ALLOW_HOSTS に載せたホストは、プライベートな IP に解決されても接続できる", async () => {
    const { port, seen } = await startServer();
    const policy = createOutboundPolicy({ blockPrivate: true, allowHosts: ["hooks.corp.example"] });
    const guard = createOutboundGuard(policy, { resolve: resolverTo("127.0.0.1") });

    const res = await guard.fetch(`http://hooks.corp.example:${port}/x`);
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    // 別のホスト名が同じ IP に解決されても通らない
    await expect(createOutboundGuard(policy, { resolve: resolverTo("127.0.0.1") }).fetch(`http://other.example:${port}/`)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
  });

  it("OUTBOUND_DENY_CIDRS に当たる公開 IP は拒否する(KIZAMI Cloud のノードのグローバル IP)", async () => {
    const policy = createOutboundPolicy({ blockPrivate: true, denyCidrs: [parseCidr("161.33.2.65/32")!] });
    const guard = createOutboundGuard(policy, { resolve: resolverTo("161.33.2.65") });
    await expect(guard.fetch("https://node.example/")).rejects.toThrow(/denied/);
  });

  it("名前解決の結果が空なら拒否する", async () => {
    const guard = createOutboundGuard(blockPrivate, { resolve: async () => [] });
    await expect(guard.fetch("http://nothing.example/")).rejects.toThrow(/unresolved/);
  });

  it("拒否のエラーメッセージには解決された IP を含めない", async () => {
    const guard = createOutboundGuard(blockPrivate, { resolve: resolverTo("10.20.30.40") });
    const err = await guard.fetch("http://secret-internal.example/").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toContain("secret-internal.example");
    expect(err?.message).not.toContain("10.20.30.40");
  });
});

describe("リダイレクトは追わない", () => {
  it("3xx はそのまま返し、Location の先(内部の宛先)へは接続しない", async () => {
    const internal = await startServer();
    const origin = await startServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/secret` });
      res.end();
    });
    const guard = createOutboundGuard(reachableLoopback, { resolve: resolverTo("127.0.0.1") });

    const res = await guard.fetch(`http://redirector.example:${origin.port}/`);

    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
    expect(res.headers.get("location")).toBe(`http://127.0.0.1:${internal.port}/secret`);
    expect(internal.seen).toEqual([]);
  });
});

describe("fetch の互換性(Webhook・OIDC・Web Push が使う形)", () => {
  it("GET の JSON・POST の文字列/バイナリ本文・ヘッダーが通る", async () => {
    const { port, seen } = await startServer((req, res) => {
      res.writeHead(201, { "content-type": "application/json", "x-echo-auth": String(req.headers.authorization ?? "") });
      res.end(JSON.stringify({ hello: "world" }));
    });
    const guard = createOutboundGuard(reachableLoopback, { resolve: resolverTo("127.0.0.1") });

    const get = await guard.fetch(`http://idp.example:${port}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
    expect(get.status).toBe(201);
    expect(await get.json()).toEqual({ hello: "world" });

    const post = await guard.fetch(`http://push.example:${port}/send?x=1`, {
      method: "POST",
      headers: { authorization: "vapid t=abc", "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(post.headers.get("x-echo-auth")).toBe("vapid t=abc");
    expect(seen[1]).toMatchObject({ method: "POST", url: "/send?x=1" });
    expect(seen[1]?.body.length).toBe(4);
  });

  it("http/https 以外のスキームは拒否する", async () => {
    const guard = createOutboundGuard(blockPrivate, { resolve: resolverTo("93.184.216.34") });
    await expect(guard.fetch("file:///etc/passwd")).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(guard.fetch("ftp://example.com/")).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});

describe("SMTP: 検査した IP に接続する", () => {
  it("host を検査済みの IP に差し替え、TLS の検証用に元のホスト名を servername で渡す", async () => {
    const inner = vi.fn<SmtpSendFn>(async () => {});
    const guard = createOutboundGuard(blockPrivate, { resolve: resolverTo("93.184.216.34") });
    const send = guard.wrapSmtpSend(inner);

    await send({ host: "smtp.example.com", port: 587, from: "kizami@example.com" }, { to: { email: "a@example.com" }, title: "t", body: "b" });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.mock.calls[0]?.[0]).toEqual({ host: "93.184.216.34", port: 587, from: "kizami@example.com", servername: "smtp.example.com" });
  });

  it("拒否対象に解決されるホスト・プライベートな IP リテラルでは送信関数を呼ばない", async () => {
    const inner = vi.fn<SmtpSendFn>(async () => {});
    const send = createOutboundGuard(blockPrivate, { resolve: resolverTo("10.0.0.25") }).wrapSmtpSend(inner);
    const msg = { to: { email: "a@example.com" }, title: "t", body: "b" };

    await expect(send({ host: "mail.internal-ish.example", port: 25, from: "f@example.com" }, msg)).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(send({ host: "192.168.1.10", port: 25, from: "f@example.com" }, msg)).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("IP リテラルの公開アドレスは servername を付けずそのまま渡す", async () => {
    const inner = vi.fn<SmtpSendFn>(async () => {});
    const send = createOutboundGuard(blockPrivate).wrapSmtpSend(inner);
    await send({ host: "93.184.216.34", port: 25, from: "f@example.com" }, { to: { email: "a@example.com" }, title: "t", body: "b" });
    expect(inner.mock.calls[0]?.[0]).toEqual({ host: "93.184.216.34", port: 25, from: "f@example.com" });
  });
});

describe("保存時の検査(checkUrl / checkHost)", () => {
  it("拒否対象の IP リテラル・名前・拒否対象に解決される名前を拒否する", async () => {
    const guard = createOutboundGuard(blockPrivate, {
      resolve: async (host) => [{ address: host === "corp.example" ? "10.0.0.7" : "93.184.216.34", family: 4 as const }],
    });
    expect(await guard.checkUrl("http://169.254.169.254/latest/meta-data/")).toEqual({ ok: false, reason: "private" });
    expect(await guard.checkUrl("https://localhost/hook")).toEqual({ ok: false, reason: "private" });
    expect(await guard.checkUrl("https://corp.example/hook")).toEqual({ ok: false, reason: "private" });
    expect(await guard.checkHost("10.1.2.3")).toEqual({ ok: false, reason: "private" });
    expect(await guard.checkUrl("not a url")).toEqual({ ok: false, reason: "invalid" });
    expect(await guard.checkUrl("https://hooks.slack.com/services/T/B/x")).toEqual({ ok: true });
    expect(await guard.checkHost("smtp.example.com")).toEqual({ ok: true });
  });

  it("名前解決に失敗・時間切れでも保存は拒否しない(接続のたびの検査が本体)", async () => {
    const failing = createOutboundGuard(blockPrivate, {
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(await failing.checkHost("typo.example")).toEqual({ ok: true });

    const slow = createOutboundGuard(blockPrivate, { resolve: () => new Promise(() => {}), checkTimeoutMs: 20 });
    expect(await slow.checkHost("slow.example")).toEqual({ ok: true });
  });

  it("保存時に通っても、接続時に別の IP へ解決されれば接続時の検査で拒否される(保存時の検査だけに頼らない)", async () => {
    let internal = false;
    const guard = createOutboundGuard(blockPrivate, {
      resolve: async () => [{ address: internal ? "10.0.0.9" : "93.184.216.34", family: 4 as const }],
    });
    expect(await guard.checkUrl("https://later-changes.example/hook")).toEqual({ ok: true });
    internal = true;
    await expect(guard.fetch("https://later-changes.example/hook")).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});

describe("無効のとき(既定)は従来どおり素通し", () => {
  it("環境変数が無ければガードを作らず、通知の依存は nodemailer をそのまま・fetch は差し替えない", () => {
    const { guard, errors } = buildOutboundGuardFromEnv({});
    expect(guard).toBeNull();
    expect(errors).toEqual([]);

    const smtp: SmtpSendFn = async () => {};
    const deps = buildNotifyOutboundDeps(guard, smtp);
    expect(deps).toEqual({ smtpSendFn: smtp });
    expect(deps.smtpSendFn).toBe(smtp);
  });

  it("有効なときは SMTP を包み、テナントの送り先用の fetch と保存時のチェッカーを足す", () => {
    const { guard } = buildOutboundGuardFromEnv({ OUTBOUND_BLOCK_PRIVATE: "true" });
    expect(guard).not.toBeNull();
    const smtp: SmtpSendFn = async () => {};
    const deps = buildNotifyOutboundDeps(guard, smtp);
    expect(deps.smtpSendFn).not.toBe(smtp);
    expect(deps.tenantFetchImpl).toBe(guard!.fetch);
    expect(deps.outbound).toBe(guard);
  });
});
