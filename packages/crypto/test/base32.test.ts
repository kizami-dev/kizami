import { describe, expect, it } from "vitest";
import { decodeBase32, encodeBase32 } from "../src/base32.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * RFC 4648 §10 のテストベクタ。KIZAMI はパディングを付けない方針(src/base32.ts 冒頭)なので、
 * 期待値は RFC の値から末尾の `=` を落としたもの。
 */
const RFC4648_VECTORS: [string, string][] = [
  ["", ""],
  ["f", "MY"],
  ["fo", "MZXQ"],
  ["foo", "MZXW6"],
  ["foob", "MZXW6YQ"],
  ["fooba", "MZXW6YTB"],
  ["foobar", "MZXW6YTBOI"],
];

describe("encodeBase32 / decodeBase32", () => {
  for (const [plain, encoded] of RFC4648_VECTORS) {
    it(`encodes "${plain}" as "${encoded}" (RFC 4648 §10)`, () => {
      expect(encodeBase32(encoder.encode(plain))).toBe(encoded);
    });

    it(`decodes "${encoded}" back to "${plain}"`, () => {
      expect(decoder.decode(decodeBase32(encoded))).toBe(plain);
    });
  }

  it("accepts padded input (RFC 4648 の元の表記そのまま)", () => {
    expect(decoder.decode(decodeBase32("MZXW6YTBOI======"))).toBe("foobar");
  });

  it("accepts lower case and separators (利用者が手入力・貼り付けする経路のため)", () => {
    expect(decoder.decode(decodeBase32("mzxw 6ytb-oi"))).toBe("foobar");
  });

  it("rejects characters outside the alphabet", () => {
    // 0/1/8/9 は RFC 4648 の base32 アルファベットに含まれない
    expect(() => decodeBase32("MZXW0")).toThrow();
  });

  it("round-trips random byte strings", () => {
    for (let length = 0; length < 40; length++) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      expect([...decodeBase32(encodeBase32(bytes))]).toEqual([...bytes]);
    }
  });
});
