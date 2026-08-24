/**
 * webPushChannel(packages/notify/src/web-push.ts)のテスト。
 *
 * 実際のプッシュサービスへは一切送らない(fetch を偽実装に差し替える)。確認するのは:
 * - RFC 8188 aes128gcm のボディ構造(salt/rs/idlen/一時公開鍵/暗号文)と、**購読側の鍵で
 *   実際に復号できること**(= RFC 8291 の鍵導出が正しいこと)。ここを自前実装している以上、
 *   「送れた」だけでなく「相手が読める」ところまで検証しないと意味が無い。
 * - VAPID の Authorization ヘッダが `vapid t=<JWT>, k=<公開鍵>` であり、JWT の署名が
 *   VAPID 公開鍵で検証できること・aud がエンドポイントの origin であること。
 * - 404/410 が WebPushGoneError になり、それ以外の失敗は通常の Error になること。
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  webPushChannel,
  WebPushGoneError,
  type VapidKeys,
  type WebPushSubscription,
} from "../src/web-push.js";

const ENDPOINT = "https://push.example.com/send/abcdef";

let vapid: VapidKeys;
let subscription: WebPushSubscription;
/** 購読側(ブラウザ役)の秘密鍵。テスト内で復号を再現するために保持する。 */
let uaPrivateKey: CryptoKey;
let authSecret: Uint8Array;

/** テスト用の VAPID 鍵ペアを1組作る(scripts/generate-vapid.mjs と同じ手順)。 */
async function generateVapid(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: jwk.d as string, subject: "mailto:ops@example.com" };
}

/** ブラウザ役の購読(ECDH 鍵ペア + 16 バイトの auth シークレット)を作る。 */
async function generateSubscription(): Promise<WebPushSubscription> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  uaPrivateKey = pair.privateKey;
  authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: ENDPOINT,
    p256dh: base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    auth: base64UrlEncode(authSecret),
  };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
      key,
      len * 8,
    ),
  );
}

function info(label: string, ...suffix: Uint8Array[]): Uint8Array {
  return concat(new TextEncoder().encode(label), new Uint8Array([0]), ...suffix);
}

/** ブラウザ側になりきって aes128gcm ボディを復号する(RFC 8291 の受信側手順)。 */
async function decryptAsBrowser(body: Uint8Array): Promise<string> {
  const salt = body.subarray(0, 16);
  const idlen = body[16 + 4] as number;
  const asPublicBytes = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const asPublicKey = await crypto.subtle.importKey(
    "raw",
    asPublicBytes as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asPublicKey }, uaPrivateKey, 256));
  const uaPublicBytes = base64UrlDecode(subscription.p256dh);

  const ikm = await hkdf(authSecret, shared, info("WebPush: info", uaPublicBytes, asPublicBytes), 32);
  const cek = await hkdf(salt, ikm, info("Content-Encoding: aes128gcm"), 16);
  const nonce = await hkdf(salt, ikm, info("Content-Encoding: nonce"), 12);

  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, ciphertext as BufferSource),
  );
  // 末尾はパディング区切り(最終レコードなので 0x02)。
  expect(plain[plain.length - 1]).toBe(0x02);
  return new TextDecoder().decode(plain.subarray(0, plain.length - 1));
}

/** 呼び出しを記録しつつ指定のステータスを返す fetch。 */
function stubFetch(status: number, sink?: { init?: RequestInit; url?: string }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (sink) {
      sink.url = typeof input === "string" ? input : input.toString();
      if (init) sink.init = init;
    }
    return new Response(null, { status });
  }) as typeof fetch;
}

beforeAll(async () => {
  vapid = await generateVapid();
  subscription = await generateSubscription();
});

describe("webPushChannel", () => {
  it("送ったペイロードを購読側の鍵で復号できる(RFC 8291 の鍵導出が正しい)", async () => {
    const sink: { init?: RequestInit; url?: string } = {};
    const channel = webPushChannel(subscription, vapid, { fetchImpl: stubFetch(201, sink) });

    await channel.send({ to: {}, title: "退勤打刻の記録がありません", body: "2026-08-23 の退勤打刻がありません。", url: "/notifications" });

    expect(sink.url).toBe(ENDPOINT);
    const headers = sink.init?.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers["content-type"]).toBe("application/octet-stream");

    const body = new Uint8Array(sink.init?.body as Uint8Array);
    // salt(16) + rs(4) + idlen(1) + 一時公開鍵(65) + 暗号文
    expect(body.length).toBeGreaterThan(16 + 4 + 1 + 65);
    expect(body[16 + 4]).toBe(65);

    const decrypted = JSON.parse(await decryptAsBrowser(body));
    expect(decrypted).toEqual({
      title: "退勤打刻の記録がありません",
      body: "2026-08-23 の退勤打刻がありません。",
      url: "/notifications",
    });
  });

  it("url を省略すると既定の '/' が入る", async () => {
    const sink: { init?: RequestInit } = {};
    const channel = webPushChannel(subscription, vapid, { fetchImpl: stubFetch(201, sink) });
    await channel.send({ to: {}, title: "t", body: "b" });
    const decrypted = JSON.parse(await decryptAsBrowser(new Uint8Array(sink.init?.body as Uint8Array)));
    expect(decrypted.url).toBe("/");
  });

  it("Authorization は vapid t=<JWT>, k=<公開鍵> で、署名が VAPID 公開鍵で検証できる", async () => {
    const sink: { init?: RequestInit } = {};
    const channel = webPushChannel(subscription, vapid, { fetchImpl: stubFetch(201, sink) });
    await channel.send({ to: {}, title: "t", body: "b" });

    const authorization = (sink.init?.headers as Record<string, string>)["authorization"] as string;
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
    expect(match).not.toBeNull();
    const [, jwt, k] = match as RegExpExecArray;
    expect(k).toBe(vapid.publicKey);

    const [header, payload, signature] = (jwt as string).split(".") as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(header)))).toEqual({ typ: "JWT", alg: "ES256" });

    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    expect(claims.aud).toBe("https://push.example.com");
    expect(claims.sub).toBe("mailto:ops@example.com");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const verifyKey = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(vapid.publicKey) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      base64UrlDecode(signature) as BufferSource,
      new TextEncoder().encode(`${header}.${payload}`) as BufferSource,
    );
    expect(ok).toBe(true);
  });

  it.each([404, 410])("%i は WebPushGoneError(購読失効)として投げる", async (status) => {
    const channel = webPushChannel(subscription, vapid, { fetchImpl: stubFetch(status) });
    await expect(channel.send({ to: {}, title: "t", body: "b" })).rejects.toBeInstanceOf(WebPushGoneError);
  });

  it("それ以外の失敗(500)は通常の Error(一時的失敗として扱う)", async () => {
    const channel = webPushChannel(subscription, vapid, { fetchImpl: stubFetch(500) });
    const error = await channel.send({ to: {}, title: "t", body: "b" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(WebPushGoneError);
  });
});
