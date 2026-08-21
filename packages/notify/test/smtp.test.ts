import { describe, expect, it } from "vitest";
import { smtpChannel } from "../src/smtp.js";

describe("smtpChannel", () => {
  it("is a stub: has name 'smtp' but send() always rejects (not implemented in v0.2)", async () => {
    const channel = smtpChannel({ host: "smtp.example.com", port: 587, from: "kizami@example.com" });
    expect(channel.name).toBe("smtp");
    await expect(channel.send({ to: { email: "a@example.com" }, title: "t", body: "b" })).rejects.toThrow(/not implemented/);
  });
});
