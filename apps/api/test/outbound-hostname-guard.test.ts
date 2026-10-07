/**
 * Workers の SSRF ガード(src/lib/outbound-hostname-guard.ts — 名前と IP リテラルだけの検査)。
 * Node 版(outbound-guard.test.ts)と違って名前を解決しないので、「名前が内部の IP に解決される」場合は通る
 * (Workers はプライベートアドレスへ届かない — ファイル冒頭)。ここではそれ以外の拒否と、拒否したら送らないことを見る。
 */

import { describe, expect, it } from "vitest";
import type { NotificationMessage, SmtpChannelConfig } from "@kizami/notify";
import { createHostnameOutboundGuard, OutboundHostBlockedError } from "../src/lib/outbound-hostname-guard.js";
import { parseOutboundEnv } from "../src/lib/outbound-policy.js";

function guardFrom(env: Record<string, string>) {
  const { policy, errors } = parseOutboundEnv(env);
  expect(errors).toEqual([]);
  const calls: Request[] = [];
  const guard = createHostnameOutboundGuard(policy!, {
    fetchImpl: async (input) => {
      calls.push(input as Request);
      return new Response("ok");
    },
  });
  return { guard, calls };
}

describe("createHostnameOutboundGuard", () => {
  it("OUTBOUND_BLOCK_PRIVATE: 内部向けの名前とプライベートの IP リテラルを拒否し、公開の名前は通す", async () => {
    const { guard } = guardFrom({ OUTBOUND_BLOCK_PRIVATE: "true" });
    for (const url of ["http://localhost/", "http://metadata.internal/", "http://10.0.0.1/", "http://169.254.169.254/latest", "http://[::1]/", "http://[::ffff:127.0.0.1]/"]) {
      expect((await guard.checkUrl(url)).ok, url).toBe(false);
    }
    expect(await guard.checkUrl("https://hooks.example.com/x")).toEqual({ ok: true });
    // 名前の解決はしない(内部の IP に解決される名前でも、名前だけでは分からないので通る)
    expect(await guard.checkHost("internal-alias.example.com")).toEqual({ ok: true });
    expect((await guard.checkUrl("ftp://example.com/")).ok).toBe(false);
  });

  it("OUTBOUND_ALLOW_HOSTS は名前の拒否の例外になる", async () => {
    const { guard } = guardFrom({ OUTBOUND_BLOCK_PRIVATE: "true", OUTBOUND_ALLOW_HOSTS: "smtp.corp.internal" });
    expect(await guard.checkHost("smtp.corp.internal")).toEqual({ ok: true });
    expect((await guard.checkHost("other.corp.internal")).ok).toBe(false);
  });

  it("OUTBOUND_DENY_CIDRS は IP リテラルにだけ効く", async () => {
    const { guard } = guardFrom({ OUTBOUND_DENY_CIDRS: "203.0.113.0/24" });
    expect(await guard.checkUrl("https://203.0.113.7/hook")).toEqual({ ok: false, reason: "denied" });
    expect(await guard.checkUrl("https://hooks.example.com/hook")).toEqual({ ok: true });
  });

  it("fetch: 拒否した宛先へは送らず、通した宛先へはリダイレクトを追わずに送る", async () => {
    const { guard, calls } = guardFrom({ OUTBOUND_BLOCK_PRIVATE: "true" });
    await expect(guard.fetch("http://10.1.2.3/hook", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(OutboundHostBlockedError);
    expect(calls).toHaveLength(0);
    const res = await guard.fetch("https://hooks.example.com/hook", { method: "POST", body: "{}" });
    expect(res.ok).toBe(true);
    expect(calls[0]?.redirect).toBe("manual");
    expect(calls[0]?.method).toBe("POST");
    expect(await calls[0]?.text()).toBe("{}");
  });

  it("SMTP: 拒否したホストへは送信関数を呼ばない", async () => {
    const { guard } = guardFrom({ OUTBOUND_BLOCK_PRIVATE: "true" });
    const sent: SmtpChannelConfig[] = [];
    const send = guard.wrapSmtpSend(async (config) => {
      sent.push(config);
    });
    const msg: NotificationMessage = { to: { email: "a@example.org" }, title: "t", body: "b" };
    await expect(send({ host: "127.0.0.1", port: 587, from: "a@example.com" }, msg)).rejects.toBeInstanceOf(OutboundHostBlockedError);
    await expect(send({ host: "mail.localhost", port: 587, from: "a@example.com" }, msg)).rejects.toBeInstanceOf(OutboundHostBlockedError);
    await send({ host: "smtp.example.com", port: 587, from: "a@example.com" }, msg);
    expect(sent.map((c) => c.host)).toEqual(["smtp.example.com"]);
  });

  it("SMTP: 点区切りの十進数以外の IPv4 の書き方も正規化してから検査し、正規化した値で接続する(2026-10-08 のレビュー)", async () => {
    // 203.0.113.10 = 3405803786 = 0xcb.0x0.0x71.0xa、127.0.0.1 = 2130706433 = 127.1 = 0x7f.0.0.1
    const { guard } = guardFrom({ OUTBOUND_BLOCK_PRIVATE: "true", OUTBOUND_DENY_CIDRS: "203.0.113.10/32" });
    const sent: SmtpChannelConfig[] = [];
    const send = guard.wrapSmtpSend(async (config) => {
      sent.push(config);
    });
    const msg: NotificationMessage = { to: { email: "a@example.org" }, title: "t", body: "b" };
    for (const host of ["2130706433", "127.1", "0x7f.0.0.1", "0x7F000001", "3405803786", "0xcb.0x0.0x71.0xa", "203.0.113.10."]) {
      await expect(send({ host, port: 587, from: "a@example.com" }, msg), host).rejects.toBeInstanceOf(OutboundHostBlockedError);
      expect((await guard.checkHost(host)).ok, host).toBe(false);
    }
    expect(sent).toHaveLength(0);
    // 先頭が 0 の各部は 8 進(010.0.0.1 = 8.0.0.1)— 拒否の対象外なので通るが、接続するのは正規化した値
    await send({ host: "010.0.0.1", port: 587, from: "a@example.com" }, msg);
    await send({ host: "SMTP.Example.COM.", port: 587, from: "a@example.com" }, msg);
    expect(sent.map((c) => c.host)).toEqual(["8.0.0.1", "smtp.example.com"]);
  });
});
