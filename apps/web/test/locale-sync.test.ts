/**
 * 表示言語とサーバー(users.locale)の同期の判断(lib/i18n/sync.ts の decideLocaleSync、純粋関数)。
 */
import { describe, expect, it } from "vitest";
import type { Locale } from "../src/lib/i18n";
import { decideLocaleSync } from "../src/lib/i18n/sync";

describe("decideLocaleSync", () => {
  it("端末に明示的な選択が無く、サーバーに値があれば、サーバーの値を採用する(端末間の引き継ぎ)", () => {
    expect(decideLocaleSync({ stored: null, server: "en" })).toEqual({ adopt: "en", push: null });
  });

  it("端末にもサーバーにも無ければ何もしない(ブラウザ推定の言語は保存しない)", () => {
    expect(decideLocaleSync({ stored: null, server: null })).toEqual({ adopt: null, push: null });
  });

  it("端末の明示的な選択がサーバーと違えば、端末の選択をサーバーへ保存する(サーバーの値で上書きしない)", () => {
    expect(decideLocaleSync({ stored: "ko", server: "en" })).toEqual({ adopt: null, push: "ko" });
  });

  it("端末に選択があり、サーバーが未設定なら保存する", () => {
    expect(decideLocaleSync({ stored: "zh-Hant", server: null })).toEqual({ adopt: null, push: "zh-Hant" });
  });

  it("一致していれば何もしない(採用・保存の後はここに落ちるので、ループしない)", () => {
    expect(decideLocaleSync({ stored: "ja", server: "ja" })).toEqual({ adopt: null, push: null });
  });

  it("採用の後・保存の後の状態を入力に戻すと、必ず何もしない状態になる(全組み合わせ)", () => {
    const values: Array<Locale | null> = [null, "ja", "en", "ko", "zh", "zh-Hant"];
    for (const stored of values) {
      for (const server of values) {
        const d = decideLocaleSync({ stored, server });
        const next = decideLocaleSync({ stored: d.adopt ?? stored, server: d.push ?? server });
        expect(next).toEqual({ adopt: null, push: null });
      }
    }
  });
});
