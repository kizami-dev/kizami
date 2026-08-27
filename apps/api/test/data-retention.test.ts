/**
 * 保持期間の暦計算(apps/api/src/lib/data-retention.ts)の単体テスト。
 *
 * ここで守りたいのは「1日でも早く消せてしまわないこと」の一点に尽きる。誤差が出るなら
 * **長く保持する方向**でなければならない(短い方向へ外すと労基法109条の保存義務違反)。
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_RETENTION_YEARS,
  DEFAULT_RETENTION_YEARS,
  erasableFromDate,
  evaluateRetention,
  isAllowedRetentionYears,
  localDateFromEpochMinutes,
} from "../src/lib/data-retention.js";

const JST = 540;

describe("erasableFromDate", () => {
  it("退職日 + N年 の**翌日**から消去可能(境界日そのものはまだ保持期間内)", () => {
    expect(erasableFromDate("2020-04-01", 5)).toBe("2025-04-02");
    expect(erasableFromDate("2020-04-01", 3)).toBe("2023-04-02");
  });

  it("暦で加算する(365日 × N ではないので、閏日を含んでも1日早くならない)", () => {
    // 2020-03-01 〜 2023-03-01 は 1096 日(2020が閏年)。365×3 = 1095 で計算すると1日早く消せてしまう。
    expect(erasableFromDate("2020-03-01", 3)).toBe("2023-03-02");
  });

  it("2月29日退職は、存在しない記念日を手前(2月28日)へ丸めず翌日側へ送る", () => {
    // constrain の既定は 2023-02-28。それを採用すると1日早く消せる。
    expect(erasableFromDate("2020-02-29", 3)).toBe("2023-03-02");
    // 加算先も閏年なら、そのまま 2月29日 + 1日。
    expect(erasableFromDate("2020-02-29", 4)).toBe("2024-03-01");
  });

  it("年末・年またぎでも暦どおり", () => {
    expect(erasableFromDate("2020-12-31", 5)).toBe("2026-01-01");
  });
});

describe("evaluateRetention", () => {
  it("消去可能日の前日はまだ不可、当日から可能", () => {
    const params = { deactivatedDate: "2020-04-01", retentionYears: 5 };
    expect(evaluateRetention({ ...params, today: "2025-04-01" })).toEqual({
      deactivatedDate: "2020-04-01",
      erasableFrom: "2025-04-02",
      erasable: false,
      remainingDays: 1,
    });
    expect(evaluateRetention({ ...params, today: "2025-04-02" })).toEqual({
      deactivatedDate: "2020-04-01",
      erasableFrom: "2025-04-02",
      erasable: true,
      remainingDays: 0,
    });
  });

  it("だいぶ先の場合は残り日数を返す(UI の「あとN日」表示に使う)", () => {
    const status = evaluateRetention({ deactivatedDate: "2026-08-27", retentionYears: 5, today: "2026-08-27" });
    expect(status.erasable).toBe(false);
    expect(status.remainingDays).toBe(1827); // 2031-08-28 まで(2028/2032 の閏日を含む)
  });

  it("既に過ぎていても remainingDays は負にならない(0 に丸める)", () => {
    const status = evaluateRetention({ deactivatedDate: "2000-01-01", retentionYears: 5, today: "2026-08-27" });
    expect(status).toEqual({ deactivatedDate: "2000-01-01", erasableFrom: "2005-01-02", erasable: true, remainingDays: 0 });
  });

  it("退職日が不明(null)なら erasable は false — 起算日が分からないものを消してよいとは答えない", () => {
    expect(evaluateRetention({ deactivatedDate: null, retentionYears: 3, today: "2026-08-27" })).toEqual({
      deactivatedDate: null,
      erasableFrom: null,
      erasable: false,
      remainingDays: null,
    });
  });

  it("保持年数を5→3に下げると、その分だけ消去可能日が前倒しになる", () => {
    const five = evaluateRetention({ deactivatedDate: "2022-04-01", retentionYears: 5, today: "2026-08-27" });
    const three = evaluateRetention({ deactivatedDate: "2022-04-01", retentionYears: 3, today: "2026-08-27" });
    expect(five.erasable).toBe(false);
    expect(three.erasable).toBe(true);
  });
});

describe("設定値のガード", () => {
  it("受け付けるのは 3 と 5 だけ(任意の年数を許すと保存義務違反を製品が手伝うことになる)", () => {
    expect(ALLOWED_RETENTION_YEARS).toEqual([3, 5]);
    expect(isAllowedRetentionYears(3)).toBe(true);
    expect(isAllowedRetentionYears(5)).toBe(true);
    for (const bad of [0, 1, 2, 4, 6, 10, -3, 3.5, "3", null, undefined, {}]) {
      expect(isAllowedRetentionYears(bad)).toBe(false);
    }
  });

  it("既定は原則側の5年(経過措置が終わったときに一斉に違反側へ倒れないように)", () => {
    expect(DEFAULT_RETENTION_YEARS).toBe(5);
  });
});

describe("localDateFromEpochMinutes", () => {
  it("JST の日界で暦日に落とす(UTC の日付ではない)", () => {
    // 2026-08-27T15:30:00Z = JST 2026-08-28 00:30
    const utcMinutes = Math.floor(Date.UTC(2026, 7, 27, 15, 30) / 60_000);
    expect(localDateFromEpochMinutes(utcMinutes, JST)).toBe("2026-08-28");
    expect(localDateFromEpochMinutes(utcMinutes, 0)).toBe("2026-08-27");
  });
});
