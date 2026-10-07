/**
 * 外向きの接続の SSRF ガードの、**名前の解決をしない**版(ランタイム非依存、2026-10-07。Cloudflare Workers 用)。
 *
 * Node 版(lib/outbound-guard.ts)は「名前を1回だけ解決し、検査したその IP に接続する」ことで DNS rebinding まで
 * 防ぐ。Workers ではそれができない:
 *
 * - `fetch()` も `cloudflare:sockets` の `connect()` も、名前の解決を workerd(Cloudflare の網)の中で行い、
 *   解決した IP を差し込む口が無い。DNS-over-HTTPS で先に引いて検査しても、接続のときにもう一度引かれるので
 *   検査と接続の間で答えが変わりうる(TOCTOU)— 検査した気になるだけなので**やらない**(判断点)
 * - その代わり、**Workers の外向きの接続はプライベートアドレスへそもそも届かない**(RFC 1918・ループバック・
 *   リンクローカル・クラウドのメタデータは、Cloudflare の網の外のインターネットとして扱われる)。Node の
 *   `OUTBOUND_BLOCK_PRIVATE` が守りたい「api の居るクラスタの内側」は、Workers には存在しない
 *
 * そのうえで、運用者が `OUTBOUND_*` を設定した Workers の配備では、**名前と IP リテラルだけで決まる検査**を行う
 * (lib/outbound-policy.ts のポリシーをそのまま使う):
 *
 * | 設定 | Workers で効くもの | 効かないもの |
 * | --- | --- | --- |
 * | `OUTBOUND_BLOCK_PRIVATE=true` | `localhost`・`*.internal` などの名前、プライベートの IP リテラル(`http://10.0.0.1/`)を拒否 | 名前がプライベートの IP に解決されるもの(どのみち届かない) |
 * | `OUTBOUND_DENY_CIDRS` | 該当する **IP リテラル**を拒否 | 名前がその範囲に解決されるもの(解決を検査できない) |
 * | `OUTBOUND_ALLOW_HOSTS` | 上の名前の拒否の例外(Node と同じ) | — |
 *
 * 検査するのは Node 版と同じ場所: テナント・個人の Webhook とブラウザプッシュの送り先(fetch)、テナントの SMTP
 * (送信関数)、保存時の検査(`OutboundChecker`)。fetch は Node 版と同じく**リダイレクトを追わない**
 * (`redirect: "manual"` — 3xx は `!res.ok` として呼び出し側が失敗扱いにする。リダイレクト先の検査を不要にする)。
 */

import type { SmtpSendFn } from "@kizami/notify";
import { normalizeHost, parseIp, type OutboundCheckResult, type OutboundChecker, type OutboundPolicy } from "./outbound-policy.js";

/** 拒否した宛先(メッセージは Node 版の OutboundBlockedError と同じ形)。 */
export class OutboundHostBlockedError extends Error {
  readonly reason: "private" | "denied" | "invalid";
  constructor(host: string, reason: OutboundHostBlockedError["reason"]) {
    super(`outbound destination is not allowed (${reason}): ${host}`);
    this.name = "OutboundHostBlockedError";
    this.reason = reason;
  }
}

export interface HostnameOutboundGuard extends OutboundChecker {
  readonly policy: OutboundPolicy;
  /** 送り先のホストを検査してから送る fetch(リダイレクトは追わない) */
  readonly fetch: typeof fetch;
  /** SMTP の送信関数を、接続の前にホストを検査するものに包む */
  wrapSmtpSend(inner: SmtpSendFn): SmtpSendFn;
}

/**
 * ホスト名を、接続の側が解釈するのと同じ形にそろえる(null = 不正)。
 *
 * 判断点(2026-10-08 のレビュー): `2130706433`・`127.1`・`0x7f.0.0.1`・`010.0.0.1` のような点区切りの十進数以外の
 * IPv4 の書き方は、`parseIp` には IP に見えず名前として素通りするが、接続の側(workerd の名前の解釈)は IP として
 * 扱いうる。fetch の経路は `new URL()` がこれらを正規の形に直してから検査しているので、SMTP の経路も同じく
 * WHATWG URL のホストの解釈に通してそろえ、**検査した形と同じ値で接続する**(`wrapSmtpSend` が差し替える)。
 */
export function canonicalHost(host: string): string | null {
  const h = normalizeHost(host);
  if (h === "") return null;
  if (parseIp(h) !== null) return h;
  try {
    return normalizeHost(new URL(`http://${h.includes(":") ? `[${h}]` : h}/`).hostname);
  } catch {
    return null;
  }
}

/** 名前・IP リテラルだけで決まる検査(正規化したホストで判定する)。 */
function checkHostOnly(policy: OutboundPolicy, host: string): OutboundCheckResult {
  const h = canonicalHost(host);
  if (h === null) return { ok: false, reason: "invalid" };
  if (parseIp(h) !== null) return policy.checkAddress(h, h);
  return policy.checkHostname(h);
}

export function createHostnameOutboundGuard(policy: OutboundPolicy, options: { fetchImpl?: typeof fetch } = {}): HostnameOutboundGuard {
  const baseFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const checkHost = async (host: string): Promise<OutboundCheckResult> => checkHostOnly(policy, host);
  const checkUrl = async (url: string): Promise<OutboundCheckResult> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "invalid" };
    return checkHostOnly(policy, parsed.hostname);
  };

  const guardedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const verdict = await checkUrl(request.url);
    if (!verdict.ok) throw new OutboundHostBlockedError(new URL(request.url).hostname, verdict.reason);
    return baseFetch(new Request(request, { redirect: "manual" }));
  };

  return {
    policy,
    checkHost,
    checkUrl,
    fetch: guardedFetch,
    wrapSmtpSend(inner) {
      return async (config, msg) => {
        const verdict = checkHostOnly(policy, config.host);
        if (!verdict.ok) throw new OutboundHostBlockedError(normalizeHost(config.host), verdict.reason);
        // 検査したのと同じ正規化済みの値で接続する(checkHostOnly が ok なら null にはならない)
        return inner({ ...config, host: canonicalHost(config.host) ?? config.host }, msg);
      };
    },
  };
}
