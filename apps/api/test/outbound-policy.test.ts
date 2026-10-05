/**
 * 外向きの接続ポリシー(lib/outbound-policy.ts、アプリ側の SSRF 対策)の判定のテスト。
 * 名前解決・接続を伴う部分は outbound-guard.test.ts。
 */

import { describe, expect, it } from "vitest";
import { createOutboundPolicy, parseCidr, parseIp, parseOutboundEnv } from "../src/lib/outbound-policy.js";

const blockAll = createOutboundPolicy({ blockPrivate: true });

function verdict(address: string, policy = blockAll, host = address) {
  return policy.checkAddress(host, address);
}

describe("parseIp / parseCidr", () => {
  it("IPv4 は厳格な 4 組のドット十進だけを受け付ける", () => {
    expect(parseIp("10.0.0.1")).toEqual({ family: 4, value: 0x0a000001n });
    for (const bad of ["10.0.0", "10.0.0.256", "010.0.0.1", "1.2.3.4.5", "a.b.c.d", "10.0.0.1/8"]) {
      expect(parseIp(bad)).toBeNull();
    }
  });

  it("IPv6 は :: 省略・末尾の IPv4・角括弧・ゾーン ID を扱う", () => {
    expect(parseIp("::1")?.value).toBe(1n);
    expect(parseIp("[::1]")?.value).toBe(1n);
    expect(parseIp("fe80::1%eth0")?.family).toBe(6);
    expect(parseIp("::ffff:10.0.0.1")?.value).toBe(0xffff0a000001n);
    expect(parseIp("2001:db8::")?.family).toBe(6);
    for (const bad of ["::1::2", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "gggg::1", ":"]) {
      expect(parseIp(bad)).toBeNull();
    }
  });

  it("CIDR はホスト部を落とし、プレフィックス無しは単一アドレス", () => {
    expect(parseCidr("10.1.2.3/8")).toEqual({ family: 4, network: 0x0a000000n, prefix: 8 });
    expect(parseCidr("161.33.2.65")).toEqual({ family: 4, network: 0xa1210241n, prefix: 32 });
    expect(parseCidr("fc00::/7")?.prefix).toBe(7);
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("nonsense/8")).toBeNull();
  });
});

describe("OUTBOUND_BLOCK_PRIVATE の拒否範囲", () => {
  const blocked: Array<[string, string]> = [
    ["127.0.0.1", "ループバック"],
    ["127.255.255.254", "ループバック(127/8 の端)"],
    ["10.0.0.1", "10/8"],
    ["10.255.255.255", "10/8 の端"],
    ["172.16.0.1", "172.16/12"],
    ["172.31.255.255", "172.16/12 の端"],
    ["192.168.1.1", "192.168/16"],
    ["169.254.169.254", "リンクローカル(メタデータ)"],
    ["169.254.0.1", "リンクローカル"],
    ["100.64.0.1", "CGNAT"],
    ["100.127.255.255", "CGNAT の端"],
    ["0.0.0.0", "未指定"],
    ["0.1.2.3", "0/8"],
    ["224.0.0.1", "マルチキャスト"],
    ["239.255.255.250", "マルチキャスト"],
    ["255.255.255.255", "ブロードキャスト(予約)"],
    ["::", "IPv6 未指定"],
    ["::1", "IPv6 ループバック"],
    ["fc00::1", "ULA"],
    ["fd12:3456:789a::1", "ULA(fd)"],
    ["fe80::1", "IPv6 リンクローカル"],
    ["febf::1", "fe80::/10 の端"],
    ["ff02::1", "IPv6 マルチキャスト"],
    ["::ffff:127.0.0.1", "IPv4 射影(ループバック)"],
    ["::ffff:10.1.2.3", "IPv4 射影(プライベート)"],
    ["::ffff:169.254.169.254", "IPv4 射影(メタデータ)"],
    ["::ffff:7f00:1", "IPv4 射影の 16 進表記"],
    ["64:ff9b::a00:1", "NAT64 経由の 10.0.0.1"],
    ["2002:7f00:1::", "6to4 経由の 127.0.0.1"],
    ["::127.0.0.1", "IPv4 互換"],
  ];
  for (const [address, label] of blocked) {
    it(`${address}(${label})は拒否`, () => {
      expect(verdict(address)).toEqual({ ok: false, reason: "private" });
    });
  }

  const allowed = [
    "8.8.8.8",
    "93.184.216.34",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.0.1",
    "192.169.0.1",
    "223.255.255.255",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::",
  ];
  for (const address of allowed) {
    it(`${address} は許可`, () => {
      expect(verdict(address)).toEqual({ ok: true });
    });
  }

  it("解析できないアドレス文字列は fail closed", () => {
    expect(verdict("not-an-ip")).toEqual({ ok: false, reason: "invalid" });
  });

  it("名前だけで内部と分かるホスト(localhost・.local・.internal)は保存時に即拒否できる", () => {
    for (const host of ["localhost", "LOCALHOST.", "foo.localhost", "printer.local", "db.internal", "svc.home.arpa"]) {
      expect(blockAll.checkHostname(host)).toEqual({ ok: false, reason: "private" });
    }
    expect(blockAll.checkHostname("hooks.slack.com")).toEqual({ ok: true });
  });
});

describe("OUTBOUND_DENY_CIDRS(追加で拒否)と OUTBOUND_ALLOW_HOSTS(許可)", () => {
  const policy = createOutboundPolicy({
    blockPrivate: true,
    denyCidrs: [parseCidr("161.33.2.65/32")!, parseCidr("133.242.209.0/24")!, parseCidr("2001:db8:1::/48")!],
    allowHosts: ["smtp.corp.example", "*.lan.example.com", "10.9.9.9"],
  });

  it("追加の拒否先は公開 IP でも拒否する(ノードのグローバル IP を想定)", () => {
    expect(verdict("161.33.2.65", policy)).toEqual({ ok: false, reason: "denied" });
    expect(verdict("133.242.209.71", policy)).toEqual({ ok: false, reason: "denied" });
    expect(verdict("161.33.2.66", policy)).toEqual({ ok: true });
    expect(verdict("2001:db8:1::5", policy)).toEqual({ ok: false, reason: "denied" });
  });

  it("IPv4 射影でも追加の拒否先に当たる", () => {
    expect(verdict("::ffff:161.33.2.65", policy)).toEqual({ ok: false, reason: "denied" });
  });

  it("許可ホストはプライベート範囲に解決されても通る(完全一致とワイルドカード・IP リテラル)", () => {
    expect(verdict("10.1.1.1", policy, "smtp.corp.example")).toEqual({ ok: true });
    expect(verdict("192.168.0.5", policy, "mail.lan.example.com")).toEqual({ ok: true });
    expect(verdict("10.9.9.9", policy, "10.9.9.9")).toEqual({ ok: true });
    // ワイルドカードは apex 自体を含まず、別のホストにも効かない
    expect(verdict("192.168.0.5", policy, "lan.example.com")).toEqual({ ok: false, reason: "private" });
    expect(verdict("10.1.1.1", policy, "evil.example")).toEqual({ ok: false, reason: "private" });
  });

  it("追加の拒否は許可ホストでも覆らない(運用者が明示した拒否が最優先)", () => {
    expect(verdict("161.33.2.65", policy, "smtp.corp.example")).toEqual({ ok: false, reason: "denied" });
  });
});

describe("parseOutboundEnv", () => {
  it("何も設定されていなければ無効(ポリシーを作らない = 既存の挙動のまま)", () => {
    expect(parseOutboundEnv({})).toEqual({ policy: null, errors: [] });
    expect(parseOutboundEnv({ OUTBOUND_BLOCK_PRIVATE: "false", OUTBOUND_ALLOW_HOSTS: "a.example" })).toEqual({ policy: null, errors: [] });
    expect(parseOutboundEnv({ OUTBOUND_BLOCK_PRIVATE: "" }).policy).toBeNull();
  });

  it("OUTBOUND_BLOCK_PRIVATE=true で有効になり、deny / allow を読む", () => {
    const { policy, errors } = parseOutboundEnv({
      OUTBOUND_BLOCK_PRIVATE: "true",
      OUTBOUND_DENY_CIDRS: "161.33.2.65/32, 161.33.46.89/32\n133.242.209.71/32",
      OUTBOUND_ALLOW_HOSTS: "smtp.corp.example,*.lan.example.com",
    });
    expect(errors).toEqual([]);
    expect(policy?.blockPrivate).toBe(true);
    expect(policy?.checkAddress("x", "161.33.46.89")).toEqual({ ok: false, reason: "denied" });
    expect(policy?.checkAddress("smtp.corp.example", "10.0.0.5")).toEqual({ ok: true });
  });

  it("OUTBOUND_DENY_CIDRS だけのときは、その CIDR だけを拒否する(組み込みのプライベート範囲は拒否しない)", () => {
    const { policy } = parseOutboundEnv({ OUTBOUND_DENY_CIDRS: "203.0.113.0/24" });
    expect(policy?.blockPrivate).toBe(false);
    expect(policy?.checkAddress("x", "203.0.113.9")).toEqual({ ok: false, reason: "denied" });
    expect(policy?.checkAddress("x", "10.0.0.1")).toEqual({ ok: true });
  });

  it("形式が不正な値は errors に入れる(起動時に落とす)", () => {
    const { policy, errors } = parseOutboundEnv({
      OUTBOUND_BLOCK_PRIVATE: "true",
      OUTBOUND_DENY_CIDRS: "10.0.0.0/99,nonsense",
      OUTBOUND_ALLOW_HOSTS: "bad host!",
    });
    expect(policy).toBeNull();
    expect(errors).toHaveLength(3);
  });
});
