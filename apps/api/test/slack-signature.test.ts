import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "../src/lib/slack-signature.js";

/** テスト用: WebCrypto HMAC-SHA256 で正しい "v0=..." 署名を計算する(検証対象実装とは独立に組み立てる)。 */
async function sign(signingSecret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`) as BufferSource,
  );
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v0=${hex}`;
}

describe("verifySlackSignature", () => {
  const signingSecret = "test-signing-secret";
  const body = "command=%2Fpunch&text=in&team_id=T0000001&user_id=U0000001";
  const nowSeconds = 1_700_000_000;

  it("accepts a correctly signed request", async () => {
    const timestamp = String(nowSeconds - 10);
    const signature = await sign(signingSecret, timestamp, body);

    const ok = await verifySlackSignature({
      signingSecret,
      signatureHeader: signature,
      timestampHeader: timestamp,
      rawBody: body,
      nowSeconds,
    });
    expect(ok).toBe(true);
  });

  it("rejects when the body was tampered with after signing", async () => {
    const timestamp = String(nowSeconds - 10);
    const signature = await sign(signingSecret, timestamp, body);

    const ok = await verifySlackSignature({
      signingSecret,
      signatureHeader: signature,
      timestampHeader: timestamp,
      rawBody: `${body}&extra=1`,
      nowSeconds,
    });
    expect(ok).toBe(false);
  });

  it("rejects when the signature itself is wrong", async () => {
    const timestamp = String(nowSeconds - 10);

    const ok = await verifySlackSignature({
      signingSecret,
      signatureHeader: "v0=0000000000000000000000000000000000000000000000000000000000000000",
      timestampHeader: timestamp,
      rawBody: body,
      nowSeconds,
    });
    expect(ok).toBe(false);
  });

  it("rejects a timestamp older than 5 minutes (replay protection)", async () => {
    const timestamp = String(nowSeconds - 5 * 60 - 1);
    const signature = await sign(signingSecret, timestamp, body);

    const ok = await verifySlackSignature({
      signingSecret,
      signatureHeader: signature,
      timestampHeader: timestamp,
      rawBody: body,
      nowSeconds,
    });
    expect(ok).toBe(false);
  });

  it("rejects a timestamp far in the future (clock skew abuse)", async () => {
    const timestamp = String(nowSeconds + 5 * 60 + 1);
    const signature = await sign(signingSecret, timestamp, body);

    const ok = await verifySlackSignature({
      signingSecret,
      signatureHeader: signature,
      timestampHeader: timestamp,
      rawBody: body,
      nowSeconds,
    });
    expect(ok).toBe(false);
  });

  it("accepts a timestamp exactly at the 5 minute boundary", async () => {
    const timestamp = String(nowSeconds - 5 * 60);
    const signature = await sign(signingSecret, timestamp, body);

    const ok = await verifySlackSignature({
      signingSecret,
      signatureHeader: signature,
      timestampHeader: timestamp,
      rawBody: body,
      nowSeconds,
    });
    expect(ok).toBe(true);
  });

  it("always rejects when signingSecret is not configured (null)", async () => {
    const timestamp = String(nowSeconds - 10);
    const signature = await sign(signingSecret, timestamp, body);

    const ok = await verifySlackSignature({
      signingSecret: null,
      signatureHeader: signature,
      timestampHeader: timestamp,
      rawBody: body,
      nowSeconds,
    });
    expect(ok).toBe(false);
  });

  it("rejects when the signature or timestamp header is missing", async () => {
    const timestamp = String(nowSeconds - 10);
    const signature = await sign(signingSecret, timestamp, body);

    expect(
      await verifySlackSignature({
        signingSecret,
        signatureHeader: null,
        timestampHeader: timestamp,
        rawBody: body,
        nowSeconds,
      }),
    ).toBe(false);
    expect(
      await verifySlackSignature({
        signingSecret,
        signatureHeader: signature,
        timestampHeader: null,
        rawBody: body,
        nowSeconds,
      }),
    ).toBe(false);
  });

  it("rejects a non-numeric timestamp header", async () => {
    const ok = await verifySlackSignature({
      signingSecret,
      signatureHeader: "v0=deadbeef",
      timestampHeader: "not-a-number",
      rawBody: body,
      nowSeconds,
    });
    expect(ok).toBe(false);
  });
});
