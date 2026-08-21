import { describe, expect, it, vi } from "vitest";
import { createSmtpChannel } from "../src/smtp.js";
import type { NotificationMessage } from "../src/types.js";

describe("createSmtpChannel", () => {
  it("has name 'smtp'", () => {
    const channel = createSmtpChannel({ host: "h", port: 25, from: "f@example.com" }, vi.fn());
    expect(channel.name).toBe("smtp");
  });

  it("delegates send() to the injected sendFn with the fixed config and the message", async () => {
    const sendFn = vi.fn(async () => {});
    const config = { host: "smtp.example.com", port: 587, from: "kizami@example.com" };
    const channel = createSmtpChannel(config, sendFn);

    const msg: NotificationMessage = { to: { email: "a@example.com" }, title: "t", body: "b" };
    await channel.send(msg);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith(config, msg);
  });

  it("propagates a rejection from sendFn (no real network I/O happens here — sendFn is always injected)", async () => {
    const sendFn = vi.fn(async () => {
      throw new Error("smtp down");
    });
    const channel = createSmtpChannel({ host: "h", port: 25, from: "f@example.com" }, sendFn);

    await expect(channel.send({ to: { email: "a@example.com" }, title: "t", body: "b" })).rejects.toThrow("smtp down");
  });
});
