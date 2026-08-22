import { describe, expect, it } from "vitest";
import { createEncryptor } from "../src/encryptor.js";

function randomKeyBase64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
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
    const stored = await encryptor.encrypt("s3cr3t-webhook-url");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    await expect(encryptor.decrypt(stored)).resolves.toBe("s3cr3t-webhook-url");
  });

  it("produces a different ciphertext each time for the same plaintext (random IV)", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const a = await encryptor.encrypt("same-plaintext");
    const b = await encryptor.encrypt("same-plaintext");
    expect(a).not.toBe(b);
    await expect(encryptor.decrypt(a)).resolves.toBe("same-plaintext");
    await expect(encryptor.decrypt(b)).resolves.toBe("same-plaintext");
  });

  it("returns null (not a thrown error) when decrypting with a different key", async () => {
    const encryptorA = createEncryptor(randomKeyBase64());
    const encryptorB = createEncryptor(randomKeyBase64());
    const stored = await encryptorA.encrypt("secret");
    await expect(encryptorB.decrypt(stored)).resolves.toBeNull();
  });

  it("passes plaintext values through decrypt unchanged (backward compatibility)", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    await expect(encryptor.decrypt("https://hooks.slack.com/services/plain")).resolves.toBe(
      "https://hooks.slack.com/services/plain",
    );
  });

  it("returns null for a corrupted enc: value instead of throwing", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    await expect(encryptor.decrypt("enc:v1:not-base64!!:also-not-base64!!")).resolves.toBeNull();
    await expect(encryptor.decrypt("enc:v1:onlyOnePart")).resolves.toBeNull();
  });

  it("returns null for an unrecognized enc: version instead of treating it as plaintext", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    await expect(encryptor.decrypt("enc:v2:AAAA:BBBB")).resolves.toBeNull();
  });

  it("returns null when the ciphertext has been tampered with (GCM auth tag mismatch)", async () => {
    const encryptor = createEncryptor(randomKeyBase64());
    const stored = await encryptor.encrypt("secret");
    const parts = stored.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${(parts[3] as string).slice(0, -4)}AAAA`;
    await expect(encryptor.decrypt(tampered)).resolves.toBeNull();
  });
});
