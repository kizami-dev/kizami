import { describe, expect, it } from "vitest";
import { createEncryptor, type EncryptionContext } from "../src/encryptor.js";

function randomKeyBase64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const AT_REST: EncryptionContext = { purpose: "at-rest", label: "tenant_notification_settings.webhook_url:tenant-a" };
const COOKIE: EncryptionContext = { purpose: "cookie", label: "kizami_totp_tx" };

/** 旧アルゴリズム(v1: マスター鍵を直接使い、AAD なし)で値を作る。後方互換テスト用。 */
async function legacyV1Encrypt(keyBase64: string, plain: string): Promise<string> {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt"]);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plain)));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return `enc:v1:${b64(iv)}:${b64(ct)}`;
}

describe("createEncryptor", () => {
  it("throws for a key that is not valid base64", () => {
    expect(() => createEncryptor("not-valid-base64!!!")).toThrow();
  });

  it("throws for a key that decodes to the wrong byte length", () => {
    // "AAAA" は base64 として有効だが 3 バイトしかない(32バイト必要)
    expect(() => createEncryptor("AAAA")).toThrow();
  });

  it("accepts a properly formed 32-byte base64 key", () => {
    expect(() => createEncryptor(randomKeyBase64())).not.toThrow();
  });

  it("round-trips a plaintext value through encrypt/decrypt", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const stored = await encryptor.encrypt("s3cr3t-webhook-url", AT_REST);
    expect(stored.startsWith("enc:v2:")).toBe(true);
    await expect(encryptor.decrypt(stored, AT_REST)).resolves.toBe("s3cr3t-webhook-url");
  });

  it("produces a different ciphertext each time for the same plaintext (random IV)", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const a = await encryptor.encrypt("same-plaintext", AT_REST);
    const b = await encryptor.encrypt("same-plaintext", AT_REST);
    expect(a).not.toBe(b);
    await expect(encryptor.decrypt(a, AT_REST)).resolves.toBe("same-plaintext");
    await expect(encryptor.decrypt(b, AT_REST)).resolves.toBe("same-plaintext");
  });

  it("returns null (not a thrown error) when decrypting with a different key", async () => {
    const encryptorA = createEncryptor(randomKeyBase64());
    const encryptorB = createEncryptor(randomKeyBase64());
    const stored = await encryptorA.encrypt("secret", AT_REST);
    await expect(encryptorB.decrypt(stored, AT_REST)).resolves.toBeNull();
  });

  it("passes plaintext values through decrypt unchanged (backward compatibility)", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    await expect(encryptor.decrypt("https://hooks.slack.com/services/plain", AT_REST)).resolves.toBe(
      "https://hooks.slack.com/services/plain",
    );
  });

  it("returns null for a corrupted enc: value instead of throwing", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    await expect(encryptor.decrypt("enc:v1:not-base64!!:also-not-base64!!", AT_REST)).resolves.toBeNull();
    await expect(encryptor.decrypt("enc:v1:onlyOnePart", AT_REST)).resolves.toBeNull();
  });

  it("returns null for an unrecognized enc: version instead of treating it as plaintext", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    await expect(encryptor.decrypt("enc:v3:AAAA:BBBB", AT_REST)).resolves.toBeNull();
  });

  it("returns null when the ciphertext has been tampered with (GCM auth tag mismatch)", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const stored = await encryptor.encrypt("secret", AT_REST);
    const parts = stored.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${(parts[3] as string).slice(0, -4)}AAAA`;
    await expect(encryptor.decrypt(tampered, AT_REST)).resolves.toBeNull();
  });

  it("returns null when the label differs (AAD mismatch, e.g. moved to another tenant's row)", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const stored = await encryptor.encrypt("secret", AT_REST);
    await expect(encryptor.decrypt(stored, { ...AT_REST, label: "tenant_notification_settings.webhook_url:tenant-b" })).resolves.toBeNull();
    await expect(encryptor.decrypt(stored, AT_REST)).resolves.toBe("secret");
  });

  it("keeps at-rest and cookie ciphertexts separate (subkeys + AAD), in both directions", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const atRest = await encryptor.encrypt("x", AT_REST);
    const cookie = await encryptor.encrypt("y", COOKIE);
    await expect(encryptor.decrypt(atRest, { purpose: "cookie", label: AT_REST.label })).resolves.toBeNull();
    await expect(encryptor.decrypt(cookie, { purpose: "at-rest", label: COOKIE.label })).resolves.toBeNull();
    await expect(encryptor.decrypt(cookie, COOKIE)).resolves.toBe("y");
  });

  it("still decrypts legacy enc:v1: values (master key, no AAD) regardless of context", async () => {
    const key = randomKeyBase64();
    const encryptor = createEncryptor(key);
    const legacy = await legacyV1Encrypt(key, "legacy-secret");
    await expect(encryptor.decrypt(legacy, AT_REST)).resolves.toBe("legacy-secret");
    await expect(encryptor.decrypt(legacy, COOKIE)).resolves.toBe("legacy-secret");
    // 別の鍵では読めない
    await expect(createEncryptor(randomKeyBase64()).decrypt(legacy, AT_REST)).resolves.toBeNull();
  });

  it("never throws, including for a bogus purpose or malformed v2 values", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const bogus = { purpose: "nope", label: "x" } as unknown as EncryptionContext;
    await expect(encryptor.decrypt("enc:v2:AAAA:BBBB", bogus)).resolves.toBeNull();
    await expect(encryptor.decrypt("enc:v2:onlyOnePart", AT_REST)).resolves.toBeNull();
    await expect(encryptor.decrypt("enc:v2:!!:!!", AT_REST)).resolves.toBeNull();
    await expect(encryptor.decrypt("enc:", AT_REST)).resolves.toBeNull();
  });
});

describe("鍵のローテーション(previous)", () => {
  it("旧鍵で暗号化した v2 を、現行鍵 + previous の Encryptor で読める。書き込みは現行鍵", async () => {
    const oldKey = randomKeyBase64();
    const newKey = randomKeyBase64();
    const stored = await createEncryptor(oldKey).encrypt("secret", AT_REST);

    const rotated = createEncryptor(newKey, { previous: [oldKey] });
    await expect(rotated.decrypt(stored, AT_REST)).resolves.toBe("secret");

    // 新しく書いた値は現行鍵だけで読める(旧鍵だけの Encryptor では読めない)
    const fresh = await rotated.encrypt("secret2", AT_REST);
    await expect(createEncryptor(newKey).decrypt(fresh, AT_REST)).resolves.toBe("secret2");
    await expect(createEncryptor(oldKey).decrypt(fresh, AT_REST)).resolves.toBeNull();
  });

  it("v1 と Cookie(cookie 用サブ鍵)も旧鍵で読める", async () => {
    const oldKey = randomKeyBase64();
    const rotated = createEncryptor(randomKeyBase64(), { previous: [oldKey] });
    await expect(rotated.decrypt(await legacyV1Encrypt(oldKey, "v1-secret"), AT_REST)).resolves.toBe("v1-secret");
    const cookie = await createEncryptor(oldKey).encrypt("{}", COOKIE);
    await expect(rotated.decrypt(cookie, COOKIE)).resolves.toBe("{}");
  });

  it("旧鍵でも文脈は検証される(別ラベル・別用途では読めない)", async () => {
    const oldKey = randomKeyBase64();
    const stored = await createEncryptor(oldKey).encrypt("x", AT_REST);
    const rotated = createEncryptor(randomKeyBase64(), { previous: [oldKey] });
    await expect(rotated.decrypt(stored, { ...AT_REST, label: "other" })).resolves.toBeNull();
    await expect(rotated.decrypt(stored, COOKIE)).resolves.toBeNull();
  });

  it("previous は渡した順に試し、どれでも読めなければ null。現行鍵で読めた値は書き直し不要", async () => {
    const k1 = randomKeyBase64();
    const k2 = randomKeyBase64();
    const current = randomKeyBase64();
    const rotated = createEncryptor(current, { previous: [k1, k2] });
    const viaK2 = await createEncryptor(k2).encrypt("from-k2", AT_REST);
    await expect(rotated.decrypt(viaK2, AT_REST)).resolves.toBe("from-k2");
    const unknown = await createEncryptor(randomKeyBase64()).encrypt("x", AT_REST);
    await expect(rotated.decrypt(unknown, AT_REST)).resolves.toBeNull();

    const viaCurrent = await createEncryptor(current).encrypt("c", AT_REST);
    await expect(rotated.decryptWithInfo(viaCurrent, AT_REST)).resolves.toEqual({ plain: "c", needsRewrite: false });
    await expect(rotated.decryptWithInfo(viaK2, AT_REST)).resolves.toEqual({ plain: "from-k2", needsRewrite: true });
  });

  it("同じ平文を現行鍵と旧鍵の両方で暗号化しても、それぞれ読める(現行鍵が先)", async () => {
    const oldKey = randomKeyBase64();
    const newKey = randomKeyBase64();
    const rotated = createEncryptor(newKey, { previous: [oldKey] });
    const a = await createEncryptor(newKey).encrypt("same", AT_REST);
    const b = await createEncryptor(oldKey).encrypt("same", AT_REST);
    await expect(rotated.decryptWithInfo(a, AT_REST)).resolves.toEqual({ plain: "same", needsRewrite: false });
    await expect(rotated.decryptWithInfo(b, AT_REST)).resolves.toEqual({ plain: "same", needsRewrite: true });
  });

  it("decryptWithInfo: 平文・v1 は needsRewrite:true、読めない値は plain:null / needsRewrite:false", async () => {
    const key = randomKeyBase64();
    const encryptor = createEncryptor(key);
    await expect(encryptor.decryptWithInfo("plain-text", AT_REST)).resolves.toEqual({ plain: "plain-text", needsRewrite: true });
    await expect(encryptor.decryptWithInfo(await legacyV1Encrypt(key, "old"), AT_REST)).resolves.toEqual({ plain: "old", needsRewrite: true });
    await expect(encryptor.decryptWithInfo("enc:v9:a:b", AT_REST)).resolves.toEqual({ plain: null, needsRewrite: false });
    const foreign = await createEncryptor(randomKeyBase64()).encrypt("z", AT_REST);
    await expect(encryptor.decryptWithInfo(foreign, AT_REST)).resolves.toEqual({ plain: null, needsRewrite: false });
  });

  it("不正な旧鍵は createEncryptor が例外にする(位置つき。鍵の値は含めない)", () => {
    const bad = "not-valid-base64!!!";
    let message = "";
    try {
      createEncryptor(randomKeyBase64(), { previous: [randomKeyBase64(), bad] });
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/previous\[1\]/);
    expect(message).not.toContain(bad);
  });
});
