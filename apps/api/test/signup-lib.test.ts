/**
 * サインアップ周辺の小さな部品: Turnstile の siteverify(lib/turnstile.ts)と
 * 招待コードの生成・正規化(lib/signup-invite-code.ts)、パスワードポリシー(auth/password-policy.ts)。
 */

import { describe, expect, it } from "vitest";
import { isAcceptablePassword, MIN_PASSWORD_LENGTH } from "../src/auth/password-policy.js";
import { generateSignupInviteCode, hashSignupInviteCode, normalizeSignupInviteCode } from "../src/lib/signup-invite-code.js";
import { verifyTurnstile } from "../src/lib/turnstile.js";

describe("verifyTurnstile", () => {
  const ok = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;

  it("success: true なら ok", async () => {
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchFn: ok({ success: true }) })).toEqual({ ok: true });
  });

  it("success: false は failed", async () => {
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchFn: ok({ success: false, "error-codes": ["invalid-input-response"] }) })).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("通信失敗・HTTP エラー・JSON でない応答は unavailable(失敗とは区別する)", async () => {
    const throwing = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const notJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    for (const fetchFn of [throwing, ok({}, 500), notJson]) {
      expect(await verifyTurnstile({ secret: "s", token: "t", fetchFn })).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("secret / response / remoteip をフォームで送る。remoteip が unknown・未指定なら付けない", async () => {
    const seen: URLSearchParams[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      seen.push(new URLSearchParams(String(init?.body)));
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    await verifyTurnstile({ secret: "S", token: "T", remoteIp: "198.51.100.4", fetchFn });
    await verifyTurnstile({ secret: "S", token: "T", remoteIp: "unknown", fetchFn });
    await verifyTurnstile({ secret: "S", token: "T", fetchFn });
    expect(Object.fromEntries(seen[0]!)).toEqual({ secret: "S", response: "T", remoteip: "198.51.100.4" });
    expect(seen[1]!.has("remoteip")).toBe(false);
    expect(seen[2]!.has("remoteip")).toBe(false);
  });
});

describe("招待コード", () => {
  it("人が打てる形式(紛らわしい文字を除いた 4文字×4 のハイフン区切り)で、毎回異なる", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = generateSignupInviteCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
      codes.add(code);
    }
    expect(codes.size).toBe(200);
  });

  it("正規化: 大文字化・ハイフン/空白の除去。表記ゆれがあっても同じハッシュになる", async () => {
    expect(normalizeSignupInviteCode(" abcd-efgh jkmn-pqrs ")).toBe("ABCDEFGHJKMNPQRS");
    const a = await hashSignupInviteCode("ABCD-EFGH-JKMN-PQRS");
    expect(await hashSignupInviteCode("abcdefghjkmnpqrs")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSignupInviteCode("ABCD-EFGH-JKMN-PQRT")).not.toBe(a);
  });
});

describe("パスワードポリシー", () => {
  it("12文字以上の文字列だけを受け付ける", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(isAcceptablePassword("a".repeat(12))).toBe(true);
    expect(isAcceptablePassword("a".repeat(11))).toBe(false);
    expect(isAcceptablePassword(undefined)).toBe(false);
    expect(isAcceptablePassword(123456789012)).toBe(false);
  });
});
