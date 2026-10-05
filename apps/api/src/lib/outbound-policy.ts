/**
 * テナントが設定できる外向きの送り先への接続ポリシー(アプリ側の SSRF 対策、2026-10-05、
 * docs/design/saas.md「公開前のギャップ4」の手前の防御、docs/design/outbound-ssrf.md)。
 *
 * ## なぜ要るか
 *
 * テナントの管理者は Webhook の URL・SMTP のホスト・OIDC の issuer、メンバーはブラウザプッシュの
 * 購読先(endpoint)を自由に設定できる。KIZAMI Cloud ではこれがそのまま「api が入っているクラスタの内側
 * (k3s の Pod/Service、ノードのメタデータ、ループバック)への HTTP/SMTP 送出」の踏み台になる。
 * NetworkPolicy(deploy/k8s-cloud/cloud.yaml)が一次防御で、これは**アプリ側の二次防御**。
 *
 * ## 既定は無効(セルフホストの挙動を変えない)
 *
 * セルフホストでは社内 LAN の SMTP や Webhook を使うのが普通なので、環境変数で有効にしたときだけ働く:
 *
 * - `OUTBOUND_BLOCK_PRIVATE=true` — 下の「拒否する宛先」へ接続しない
 * - `OUTBOUND_DENY_CIDRS` — 追加で拒否する宛先(CIDR か IP のカンマ区切り。KIZAMI Cloud ではノードのグローバル IP)
 * - `OUTBOUND_ALLOW_HOSTS` — 拒否する宛先に解決されても許可するホスト名(カンマ区切り、`*.example.com` 可)
 *
 * 無効のとき(`OUTBOUND_BLOCK_PRIVATE` も `OUTBOUND_DENY_CIDRS` も無いとき)は `parseOutboundEnv` が
 * ポリシー自体を作らず、呼び出し側は従来どおりグローバルの fetch / nodemailer をそのまま使う。
 *
 * ## 拒否する宛先
 *
 * IPv4: 0.0.0.0/8(未指定)・10/8・172.16/12・192.168/16(プライベート)・100.64/10(CGNAT)・127/8(ループバック)・
 * 169.254/16(リンクローカル。クラウドのメタデータ 169.254.169.254 を含む)・192.0.0.0/24・198.18/15・
 * 224/4(マルチキャスト)・240/4(予約。255.255.255.255 を含む)。
 * IPv6: ::/128(未指定)・::1/128(ループバック)・fc00::/7(ULA)・fe80::/10(リンクローカル)・fec0::/10・
 * ff00::/8(マルチキャスト)・100::/64・2001::/32(Teredo)・64:ff9b:1::/48。
 * **IPv4 を内包する IPv6**(`::ffff:10.0.0.1` の IPv4 射影、`64:ff9b::/96` の NAT64、`2002::/16` の 6to4、
 * `::/96` の IPv4 互換)は、内包する IPv4 を取り出して上の IPv4 の規則で判定する
 * (`::ffff:127.0.0.1` で素通しにならないように)。
 *
 * ## 許可・追加の拒否の優先順位
 *
 * 1. `OUTBOUND_DENY_CIDRS` に一致したら**常に拒否**(許可ホストでも通さない。運用者が明示した拒否が最優先)
 * 2. `OUTBOUND_BLOCK_PRIVATE=true` で上の宛先に当たるとき、ホスト名が `OUTBOUND_ALLOW_HOSTS` に一致すれば許可
 *    (IP リテラルをそのまま許可したいときは、その IP 文字列を書く)
 * 3. それ以外は許可
 *
 * ## このファイルの範囲(ランタイム非依存)
 *
 * IP の解析と判定、環境変数の解析、保存時の検査の型だけを持つ。**node:* を import しない**(routes/ が
 * 型とこのチェッカーを参照するため、Workers のビルドに Node 専用モジュールを持ち込まない)。
 * 名前解決・接続を伴う実装(DNS rebinding 対策を含む)は Node 専用の lib/outbound-guard.ts にある。
 * Workers はプライベートアドレスに届かないので、Workers エントリはポリシーを渡さない(= 無効)。
 */

/** 解析済みのアドレス。v6 は 128 ビット、v4 は 32 ビットの整数。 */
export interface ParsedIp {
  family: 4 | 6;
  value: bigint;
}

const MAX_V4 = 0xffffffffn;

/** 厳格な IPv4 のドット十進(各 0〜255、先頭ゼロ無し、4 組ちょうど)。 */
export function parseIPv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

/** IPv6(`::` 省略・末尾の IPv4 表記・ゾーン ID に対応)。 */
export function parseIPv6(text: string): bigint | null {
  let s = text;
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (s === "" || !/^[0-9a-fA-F:.]+$/.test(s)) return null;

  // 末尾の IPv4(::ffff:1.2.3.4)は 16 ビット 2 組に直す
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = parseGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  if (head === null || rest === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null; // `::` は 1 組以上を表す
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(g);
  return value;
}

/** IP のテキスト(IPv4 / IPv6、ゾーン ID・角括弧は許容)を解析する。IP でなければ null。 */
export function parseIp(text: string): ParsedIp | null {
  let s = text.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (s.includes(":")) {
    const value = parseIPv6(s);
    return value === null ? null : { family: 6, value };
  }
  const value = parseIPv4(s);
  return value === null ? null : { family: 4, value };
}

/** CIDR(`10.0.0.0/8`・`fc00::/7`)。プレフィックス無しの IP は単一アドレス(/32・/128)。 */
export interface Cidr {
  family: 4 | 6;
  /** ホスト部を 0 にした網アドレス */
  network: bigint;
  prefix: number;
}

export function parseCidr(text: string): Cidr | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  const ipText = slash < 0 ? trimmed : trimmed.slice(0, slash);
  const ip = parseIp(ipText);
  if (ip === null) return null;
  const bits = ip.family === 4 ? 32 : 128;
  let prefix = bits;
  if (slash >= 0) {
    const prefixText = trimmed.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > bits) return null;
  }
  const hostBits = BigInt(bits - prefix);
  const network = (ip.value >> hostBits) << hostBits;
  return { family: ip.family, network, prefix };
}

function cidrContains(cidr: Cidr, ip: ParsedIp): boolean {
  if (cidr.family !== ip.family) return false;
  const bits = cidr.family === 4 ? 32 : 128;
  const hostBits = BigInt(bits - cidr.prefix);
  return (ip.value >> hostBits) << hostBits === cidr.network;
}

function cidrs(list: readonly string[]): Cidr[] {
  return list.map((text) => {
    const cidr = parseCidr(text);
    if (cidr === null) throw new Error(`outbound-policy: invalid built-in CIDR ${text}`);
    return cidr;
  });
}

/** `OUTBOUND_BLOCK_PRIVATE` が拒否する IPv4。このファイル冒頭の一覧と同じ。 */
const PRIVATE_V4 = cidrs([
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
]);

/** `OUTBOUND_BLOCK_PRIVATE` が拒否する IPv6(IPv4 を内包するものは別途 IPv4 に直して判定する)。 */
const PRIVATE_V6 = cidrs(["::/128", "::1/128", "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8", "100::/64", "2001::/32", "64:ff9b:1::/48"]);

const MAPPED_V4 = cidrs(["::ffff:0:0/96"])[0]!;
const NAT64 = cidrs(["64:ff9b::/96"])[0]!;
const SIX_TO_FOUR = cidrs(["2002::/16"])[0]!;
const V4_COMPAT = cidrs(["::/96"])[0]!;

/**
 * IPv6 が IPv4 を内包するもの(IPv4 射影・NAT64・6to4・IPv4 互換)なら、その IPv4 を返す。
 * そうでなければ null。
 */
export function embeddedIPv4(ip: ParsedIp): ParsedIp | null {
  if (ip.family !== 6) return null;
  if (cidrContains(MAPPED_V4, ip) || cidrContains(NAT64, ip) || cidrContains(V4_COMPAT, ip)) {
    return { family: 4, value: ip.value & MAX_V4 };
  }
  if (cidrContains(SIX_TO_FOUR, ip)) {
    return { family: 4, value: (ip.value >> 80n) & MAX_V4 };
  }
  return null;
}

/** プライベート相当(OUTBOUND_BLOCK_PRIVATE の対象)か。IPv4 を内包する IPv6 は内包する IPv4 で判定する。 */
export function isPrivateAddress(ip: ParsedIp): boolean {
  const embedded = embeddedIPv4(ip);
  const target = embedded ?? ip;
  const list = target.family === 4 ? PRIVATE_V4 : PRIVATE_V6;
  return list.some((cidr) => cidrContains(cidr, target));
}

/** 判定の結果。`private` は組み込みの範囲、`denied` は `OUTBOUND_DENY_CIDRS` に一致した。 */
export type OutboundBlockReason = "private" | "denied" | "invalid";

export type OutboundCheckResult = { ok: true } | { ok: false; reason: OutboundBlockReason };

/**
 * 保存時に routes/ が使うチェッカー。実装(名前解決を含む)は Node 専用の lib/outbound-guard.ts。
 * 名前解決が失敗した場合は**拒否しない**(DNS は後で変わりうるし、一時的な失敗で設定を保存できなくなるのは
 * 過剰。接続のたびの検査が本体なので、保存時の検査はあくまで「分かりやすいエラーのための先回り」)。
 */
export interface OutboundChecker {
  /** URL(http/https)の宛先のホストを検査する。URL として読めない場合は `invalid`。 */
  checkUrl(url: string): Promise<OutboundCheckResult>;
  /** ホスト名(または IP リテラル)を検査する。 */
  checkHost(host: string): Promise<OutboundCheckResult>;
}

export interface OutboundPolicy {
  /** `OUTBOUND_BLOCK_PRIVATE` が有効か(テストと表示用) */
  readonly blockPrivate: boolean;
  /**
   * 解決済みの IP を、そのホスト名(IP リテラルならその文字列)の接続先として検査する。
   * 解析できない文字列は fail closed(`invalid` で拒否)。
   */
  checkAddress(host: string, address: string): OutboundCheckResult;
  /** 名前だけで即座に拒否できるか(`localhost` など。IP の解決を待たずに保存時の検査で使う)。 */
  checkHostname(host: string): OutboundCheckResult;
}

export interface OutboundPolicyOptions {
  blockPrivate: boolean;
  denyCidrs?: readonly Cidr[];
  /** 小文字のホスト名。`*.example.com` は `example.com` 自体を含まないサブドメインだけに一致する */
  allowHosts?: readonly string[];
}

/** ホスト名(または IP リテラル)を比較用に正規化する(小文字・末尾ドット・角括弧を落とす)。 */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h.replace(/\.+$/, "");
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  return pattern === host;
}

/** 名前だけで「内部向け」と分かるホスト。DNS を引かなくても保存時に弾ける(接続時は IP で必ず検査される)。 */
const INTERNAL_NAME_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home.arpa"] as const;

export function createOutboundPolicy(options: OutboundPolicyOptions): OutboundPolicy {
  const deny = options.denyCidrs ?? [];
  const allowHosts = (options.allowHosts ?? []).map(normalizeHost);
  const isAllowedHost = (host: string): boolean => allowHosts.some((pattern) => hostMatches(pattern, host));

  return {
    blockPrivate: options.blockPrivate,
    checkAddress(host, address) {
      const ip = parseIp(address);
      if (ip === null) return { ok: false, reason: "invalid" };
      // IPv4 を内包する IPv6 は、内包する IPv4 に対する拒否 CIDR にも当てる
      const embedded = embeddedIPv4(ip);
      if (deny.some((cidr) => cidrContains(cidr, ip) || (embedded !== null && cidrContains(cidr, embedded)))) {
        return { ok: false, reason: "denied" };
      }
      if (options.blockPrivate && isPrivateAddress(ip) && !isAllowedHost(normalizeHost(host))) {
        return { ok: false, reason: "private" };
      }
      return { ok: true };
    },
    checkHostname(host) {
      const h = normalizeHost(host);
      if (!options.blockPrivate || isAllowedHost(h)) return { ok: true };
      if (h === "localhost" || h === "ip6-localhost" || INTERNAL_NAME_SUFFIXES.some((suffix) => h.endsWith(suffix))) {
        return { ok: false, reason: "private" };
      }
      return { ok: true };
    },
  };
}

export interface OutboundEnvResult {
  /** 無効(`OUTBOUND_BLOCK_PRIVATE` も `OUTBOUND_DENY_CIDRS` も無い)なら null */
  policy: OutboundPolicy | null;
  /** 値の形式が不正な変数の説明。node.ts は起動を止める(設定したつもりで素通し、を避けるため) */
  errors: string[];
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/**
 * 環境変数からポリシーを作る(env を引数に取る純関数)。
 * `OUTBOUND_BLOCK_PRIVATE` は `true` / `1` で有効(それ以外・未設定は無効)。
 * `OUTBOUND_DENY_CIDRS` だけが設定されているときは、組み込みのプライベート範囲は拒否せず、その CIDR だけを拒否する。
 * `OUTBOUND_ALLOW_HOSTS` は組み込みのプライベート範囲に対する例外なので、`OUTBOUND_BLOCK_PRIVATE` が無ければ意味を持たない。
 */
export function parseOutboundEnv(env: Record<string, string | undefined>): OutboundEnvResult {
  const flag = env.OUTBOUND_BLOCK_PRIVATE?.trim().toLowerCase();
  const blockPrivate = flag === "true" || flag === "1";
  const errors: string[] = [];

  const denyCidrs: Cidr[] = [];
  for (const entry of splitList(env.OUTBOUND_DENY_CIDRS)) {
    const cidr = parseCidr(entry);
    if (cidr === null) errors.push(`OUTBOUND_DENY_CIDRS has an invalid CIDR: ${entry}`);
    else denyCidrs.push(cidr);
  }

  const allowHosts = splitList(env.OUTBOUND_ALLOW_HOSTS).map(normalizeHost);
  for (const host of allowHosts) {
    if (!/^(\*\.)?[a-z0-9._:-]+$/.test(host)) errors.push(`OUTBOUND_ALLOW_HOSTS has an invalid host: ${host}`);
  }

  if (errors.length > 0) return { policy: null, errors };
  if (!blockPrivate && denyCidrs.length === 0) return { policy: null, errors };
  return { policy: createOutboundPolicy({ blockPrivate, denyCidrs, allowHosts }), errors };
}
