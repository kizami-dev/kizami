/**
 * 外向きの接続の SSRF ガード(Node 専用の実装、2026-10-05)。ポリシーと判断の背景は
 * lib/outbound-policy.ts(ランタイム非依存)。ここは名前解決と接続を担う。
 *
 * ## DNS rebinding 対策: 「検査した IP にそのまま接続する」
 *
 * 名前を解決して検査したあと、接続のためにもう一度名前解決させると、2回目だけ内部の IP を返す DNS で
 * 検査をすり抜けられる(TOCTOU)。そこで**名前解決は1回だけ**行い、その結果の IP を検査し、**検査を通した
 * その IP に接続する**(接続のための再解決をしない)。
 *
 * - **fetch**(Webhook・Slack 互換 Webhook・OIDC の discovery/トークン/JWKS・Web Push): グローバルの fetch
 *   (undici)は接続時に自前で名前解決するので差し込めない。そのため `node:http` / `node:https` で
 *   `host: <検査済みの IP>` に直接接続し、`Host` ヘッダと TLS の `servername`(SNI・証明書の検証)に元のホスト名を
 *   使う。**リダイレクトは追わない**(3xx はそのまま返し、呼び出し側は `!res.ok` として失敗扱いにする)。
 *   リダイレクト先を検査し直す必要自体を無くすための判断で、Webhook・Web Push・OIDC のどれもリダイレクトを
 *   前提にしない。
 * - **SMTP**(テナントの SMTP): nodemailer の接続に渡す `host` を検査済みの IP にし、`servername` に元のホスト名を
 *   渡す(STARTTLS・465 の暗黙 TLS の証明書検証が元のホスト名で行われる)。
 *
 * 解決結果が複数あるときは、**1つでも拒否対象があれば全体を拒否**する(拒否対象と公開 IP を混ぜて返す
 * DNS での取りこぼしを残さないため)。IP リテラルは名前解決が走らないので、接続の前にここで検査する。
 * 接続に失敗したら、検査済みの次の IP を順に試す(IPv6 に届かない環境でも、従来の fetch と同様に IPv4 で通る)。
 *
 * このファイルは Node 専用(node:dns / node:http / node:net)。app.ts・routes/・workers.ts は import しない
 * (Workers のビルドに持ち込まない)。routes/ が使うのは lib/outbound-policy.ts の型だけ。
 */

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { SmtpSendFn } from "@kizami/notify";
import {
  normalizeHost,
  parseOutboundEnv,
  type OutboundCheckResult,
  type OutboundChecker,
  type OutboundPolicy,
} from "./outbound-policy.js";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** 名前解決の関数。テストが「検査後に別の IP を返す」リゾルバを差し込むための注入点。 */
export type OutboundResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface OutboundGuardOptions {
  /** 名前解決。既定は `dns.lookup(all: true)`(OS のリゾルバ。/etc/hosts も見る) */
  resolve?: OutboundResolver;
  /** リクエスト全体の上限(ミリ秒)。既定 15 秒 */
  timeoutMs?: number;
  /** レスポンスボディの上限(バイト)。既定 5 MiB。超えたら失敗 */
  maxResponseBytes?: number;
  /** 保存時の検査で名前解決を待つ上限(ミリ秒)。既定 3 秒。超えたら拒否しない */
  checkTimeoutMs?: number;
}

export interface OutboundGuard extends OutboundChecker {
  readonly policy: OutboundPolicy;
  /** 検査済みの IP にだけ接続する fetch(リダイレクトは追わない) */
  readonly fetch: typeof fetch;
  /** SMTP の送信関数を、検査済みの IP に接続するものに包む */
  wrapSmtpSend(inner: SmtpSendFn): SmtpSendFn;
  /** 名前を解決して検査する。1つでも拒否対象があれば `OutboundBlockedError`。通れば接続してよい IP の一覧 */
  resolveChecked(host: string): Promise<ResolvedAddress[]>;
}

/** 拒否した宛先。メッセージには解決された IP を含めない(テナントの管理者に内部の名前の解決結果を見せないため)。 */
export class OutboundBlockedError extends Error {
  readonly reason: "private" | "denied" | "invalid" | "unresolved";
  constructor(host: string, reason: OutboundBlockedError["reason"]) {
    super(`outbound destination is not allowed (${reason}): ${host}`);
    this.name = "OutboundBlockedError";
    this.reason = reason;
  }
}

const DEFAULT_RESOLVE: OutboundResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/** 接続自体に失敗したときだけ次の IP を試す(HTTP の応答を受けたあとは試さない)。 */
const CONNECT_ERROR_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL", "ECONNRESET"]);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function createOutboundGuard(policy: OutboundPolicy, options: OutboundGuardOptions = {}): OutboundGuard {
  const resolve = options.resolve ?? DEFAULT_RESOLVE;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxResponseBytes = options.maxResponseBytes ?? 5 * 1024 * 1024;
  const checkTimeoutMs = options.checkTimeoutMs ?? 3_000;

  async function resolveChecked(host: string): Promise<ResolvedAddress[]> {
    const h = normalizeHost(host);
    const family = isIP(h);
    let addresses: ResolvedAddress[];
    if (family !== 0) {
      // IP リテラルは名前解決が走らないので、接続の前にここで検査する
      addresses = [{ address: h, family: family === 6 ? 6 : 4 }];
    } else {
      const byName = policy.checkHostname(h);
      if (!byName.ok) throw new OutboundBlockedError(h, byName.reason);
      addresses = await resolve(h);
      if (addresses.length === 0) throw new OutboundBlockedError(h, "unresolved");
    }
    for (const { address } of addresses) {
      const verdict = policy.checkAddress(h, address);
      if (!verdict.ok) throw new OutboundBlockedError(h, verdict.reason);
    }
    return addresses;
  }

  async function checkHost(host: string): Promise<OutboundCheckResult> {
    const h = normalizeHost(host);
    if (h === "") return { ok: false, reason: "invalid" };
    const byName = policy.checkHostname(h);
    if (!byName.ok) return byName;
    const literal = isIP(h) !== 0;
    let addresses: ResolvedAddress[];
    if (literal) {
      addresses = [{ address: h, family: isIP(h) === 6 ? 6 : 4 }];
    } else {
      try {
        addresses = await withTimeout(resolve(h), checkTimeoutMs);
      } catch {
        // 解決できない・時間切れは拒否しない(この関数の趣旨は outbound-policy.ts の OutboundChecker を参照)
        return { ok: true };
      }
    }
    for (const { address } of addresses) {
      const verdict = policy.checkAddress(h, address);
      if (!verdict.ok) return verdict;
    }
    return { ok: true };
  }

  async function checkUrl(url: string): Promise<OutboundCheckResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    return checkHost(parsed.hostname);
  }

  /** 1つの IP へ1回リクエストする。応答ヘッダを受けた時点で Response を返す(ボディは上限つきで読み切る)。 */
  function requestOnce(
    url: URL,
    target: ResolvedAddress,
    method: string,
    headers: Record<string, string>,
    body: Uint8Array | null,
    signal: AbortSignal,
  ): Promise<Response> {
    return new Promise<Response>((resolveResponse, reject) => {
      const isHttps = url.protocol === "https:";
      const hostname = normalizeHost(url.hostname);
      const requestFn = isHttps ? https.request : http.request;
      const req = requestFn(
        {
          // **検査した IP にそのまま接続する**(ここで再度の名前解決は起きない)
          host: target.address,
          family: target.family,
          port: url.port !== "" ? Number(url.port) : isHttps ? 443 : 80,
          path: `${url.pathname}${url.search}`,
          method,
          headers: { ...headers, host: url.host, ...(body !== null ? { "content-length": String(body.byteLength) } : {}) },
          // 元のホスト名で SNI を送り、証明書も元のホスト名で検証する(IP リテラルの宛先には付けない)
          ...(isHttps && isIP(hostname) === 0 ? { servername: hostname } : {}),
          // コネクションを使い回さない(別のホスト向けに検査した IP のソケットを共有しないため)
          agent: false,
          signal,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxResponseBytes) {
              req.destroy(new Error("outbound response is too large"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const responseHeaders = new Headers();
            for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
              try {
                responseHeaders.append(res.rawHeaders[i] as string, res.rawHeaders[i + 1] as string);
              } catch {
                // Headers が受け付けない値は落とす(本文の扱いには影響しない)
              }
            }
            const status = res.statusCode ?? 502;
            const noBody = status === 101 || status === 204 || status === 205 || status === 304;
            resolveResponse(
              new Response(noBody ? null : Buffer.concat(chunks), {
                status,
                statusText: res.statusMessage ?? "",
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      if (body !== null) req.write(body);
      req.end();
    });
  }

  const guardedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new OutboundBlockedError(url.hostname, "invalid");
    }

    const addresses = await resolveChecked(url.hostname);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = request.body === null ? null : new Uint8Array(await request.arrayBuffer());
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);

    let lastError: unknown;
    for (const target of addresses) {
      try {
        return await requestOnce(url, target, request.method, headers, body, signal);
      } catch (err) {
        lastError = err;
        const code = (err as { code?: string }).code;
        if (signal.aborted || code === undefined || !CONNECT_ERROR_CODES.has(code)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  return {
    policy,
    fetch: guardedFetch,
    resolveChecked,
    checkHost,
    checkUrl,
    wrapSmtpSend(inner) {
      return async (config, msg) => {
        const addresses = await resolveChecked(config.host);
        const target = addresses[0] as ResolvedAddress;
        const hostname = normalizeHost(config.host);
        // nodemailer は IP リテラルの host を再解決しない。TLS の検証は元のホスト名(servername)で行う
        return inner({ ...config, host: target.address, ...(isIP(hostname) === 0 ? { servername: hostname } : {}) }, msg);
      };
    },
  };
}

export interface OutboundGuardEnvResult {
  /** 無効なら null */
  guard: OutboundGuard | null;
  errors: string[];
}

/** 環境変数(OUTBOUND_BLOCK_PRIVATE / OUTBOUND_DENY_CIDRS / OUTBOUND_ALLOW_HOSTS)からガードを作る。 */
export function buildOutboundGuardFromEnv(env: Record<string, string | undefined> = process.env): OutboundGuardEnvResult {
  const { policy, errors } = parseOutboundEnv(env);
  return { guard: policy === null ? null : createOutboundGuard(policy), errors };
}

/**
 * node.ts(API)と worker.ts(定期スキャン)が `notify` に渡す、通知まわりの送信依存。
 * ガード無効(null)のときは従来どおり nodemailer をそのまま使い、fetch は差し替えない(挙動は変わらない)。
 * 有効なときは、テナントの SMTP を検査済みの IP に接続するものに包み、テナントが設定した送り先
 * (Webhook・プッシュ)への fetch と保存時のチェッカーを足す。
 */
export function buildNotifyOutboundDeps(
  guard: OutboundGuard | null,
  smtpSendFn: SmtpSendFn,
): { smtpSendFn: SmtpSendFn; tenantFetchImpl?: typeof fetch; outbound?: OutboundChecker } {
  if (guard === null) return { smtpSendFn };
  return { smtpSendFn: guard.wrapSmtpSend(smtpSendFn), tenantFetchImpl: guard.fetch, outbound: guard };
}
