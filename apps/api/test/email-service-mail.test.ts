/**
 * システムメールの Workers 実装(src/lib/email-service-mail.ts — Cloudflare Email Service の `send_email` バインディング)を、
 * 偽のバインディングで検査する。workerd のローカルのシミュレーションを通す確認は test/workers/mail.test.ts。
 */

import { describe, expect, it } from "vitest";
import { createEmailServiceMailSender, EmailServiceSendError, parseEmailServiceMailEnv, type EmailSendBinding } from "../src/lib/email-service-mail.js";

function fakeBinding(behavior: "ok" | { code: string; message: string } = "ok") {
  const sent: Array<Parameters<EmailSendBinding["send"]>[0]> = [];
  const binding: EmailSendBinding = {
    async send(message) {
      sent.push(message);
      if (behavior !== "ok") throw Object.assign(new Error(behavior.message), { code: behavior.code });
      return { messageId: "m-1" };
    },
  };
  return { binding, sent };
}

describe("createEmailServiceMailSender", () => {
  it("構造化の send() に宛先・差出人(表示名つき)・件名・平文を渡す", async () => {
    const { binding, sent } = fakeBinding();
    const send = createEmailServiceMailSender({ binding, from: { name: "KIZAMI", address: "noreply@example.com" } });
    await send({ to: "admin@example.org", subject: "【KIZAMI】退会の申請を受け付けました", text: "本文" });
    expect(sent).toEqual([
      { to: "admin@example.org", from: { email: "noreply@example.com", name: "KIZAMI" }, subject: "【KIZAMI】退会の申請を受け付けました", text: "本文" },
    ]);
  });

  it("表示名が無ければ差出人は文字列で渡す", async () => {
    const { binding, sent } = fakeBinding();
    await createEmailServiceMailSender({ binding, from: { address: "noreply@example.com" } })({ to: "a@example.org", subject: "s", text: "t" });
    expect(sent[0]?.from).toBe("noreply@example.com");
  });

  it("バインディングの失敗は code を残して投げる(呼び出し側が握る)", async () => {
    const { binding } = fakeBinding({ code: "E_SENDER_NOT_VERIFIED", message: "Sender domain not verified" });
    const err = await createEmailServiceMailSender({ binding, from: { address: "noreply@example.com" } })({ to: "a@example.org", subject: "s", text: "t" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EmailServiceSendError);
    expect(err).toMatchObject({ code: "E_SENDER_NOT_VERIFIED" });
    expect((err as Error).message).toContain("E_SENDER_NOT_VERIFIED");
  });
});

describe("parseEmailServiceMailEnv", () => {
  it("バインディング・SYSTEM_MAIL_FROM・APP_BASE_URL が揃えば有効(末尾のスラッシュは落とす)", async () => {
    const { binding, sent } = fakeBinding();
    const result = parseEmailServiceMailEnv({ EMAIL: binding, SYSTEM_MAIL_FROM: " KIZAMI <noreply@example.com> ", APP_BASE_URL: "https://kizami.example.com/" });
    expect(result.missing).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.config?.appBaseUrl).toBe("https://kizami.example.com");
    await result.config?.sendMail({ to: "a@example.org", subject: "s", text: "t" });
    expect(sent[0]?.from).toEqual({ email: "noreply@example.com", name: "KIZAMI" });
  });

  it("欠けているものを返す(バインディングは EMAIL)", () => {
    expect(parseEmailServiceMailEnv({})).toEqual({ config: null, missing: ["EMAIL", "SYSTEM_MAIL_FROM", "APP_BASE_URL"], errors: [] });
    // send を持たないものはバインディングとみなさない
    expect(parseEmailServiceMailEnv({ EMAIL: "x", SYSTEM_MAIL_FROM: "a@example.com", APP_BASE_URL: "https://k.example.com" }).missing).toEqual(["EMAIL"]);
  });

  it("形式が不正なら errors に入れて無効", () => {
    const { binding } = fakeBinding();
    const result = parseEmailServiceMailEnv({ EMAIL: binding, SYSTEM_MAIL_FROM: "not an address", APP_BASE_URL: "kizami.example.com" });
    expect(result.config).toBeNull();
    expect(result.errors).toHaveLength(2);
  });
});
