import { describe, expect, it } from "vitest";
import { uuidv7 } from "../src/uuid.js";

describe("uuidv7 の同一ミリ秒内単調性(2026-08-23 追加)", () => {
  // closing_events の世代解決(ORDER BY occurred_at, id)が同一ミリ秒の close/amend で
  // 逆転しないための保証。src/uuid.ts の判断点コメント参照。
  it("同じ timestampMs で連続生成しても辞書順が生成順と一致する", () => {
    const ts = 1755900000000;
    const ids = Array.from({ length: 100 }, () => uuidv7(ts));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it("ミリ秒が進めばタイムスタンプ部で順序が保たれる", () => {
    const a = uuidv7(1755900000000);
    const b = uuidv7(1755900000001);
    expect(a < b).toBe(true);
  });
});
