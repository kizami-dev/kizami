/**
 * 使い方ツアーの純粋ロジック(src/lib/tour.ts)のテスト。
 *
 * apps/web にはこれまでテストランナーが無かったため、ツアーの実装では「DOM が要る部分」と
 * 「要らない部分」を意図的に分けてある(lib/tour.ts 冒頭の判断点参照)。ここでテストするのは
 * 後者だけ — 要素の有無・画面サイズ・ストレージはすべて引数として渡すため、jsdom は要らない。
 */
import { describe, expect, it } from "vitest";
import {
  TOUR_DONE_KEY,
  TOUR_PROGRESS_KEY,
  TOUR_STEPS,
  audienceFor,
  cutoutRect,
  isTourablePath,
  keyToMove,
  moveIndex,
  needsScrollIntoView,
  placeTooltip,
  readTourDone,
  readTourProgress,
  stepNumber,
  stepsFor,
  writeTourDone,
  writeTourProgress,
  type TourStorage,
} from "../src/lib/tour";

/** localStorage / sessionStorage の代役。 */
function fakeStorage(initial: Record<string, string> = {}): TourStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

/** プライベートブラウズ等で例外を投げるストレージ。 */
const throwingStorage: TourStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("手順の定義", () => {
  it("id が重複していない(i18n のキーと1対1で対応するため)", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("メンバーには管理者向けの手順を渡さない", () => {
    const steps = stepsFor("member");
    expect(steps.every((s) => s.audience === "member")).toBe(true);
    expect(steps).toHaveLength(6);
  });

  it("管理者はメンバー向けの手順に管理者向けが積み上がる", () => {
    const member = stepsFor("member");
    const admin = stepsFor("admin");
    expect(admin).toHaveLength(TOUR_STEPS.length);
    // 先頭6つはメンバー向けと同じ並び(管理者にも打刻・月次・申請の説明は必要)。
    expect(admin.slice(0, member.length).map((s) => s.id)).toEqual(member.map((s) => s.id));
  });

  it("member.invite を持つ人だけが管理者向けの並びになる", () => {
    expect(audienceFor(true)).toBe("admin");
    expect(audienceFor(false)).toBe("member");
  });

  it("ログイン前の画面ではツアーを動かさない", () => {
    expect(isTourablePath("/login")).toBe(false);
    expect(isTourablePath("/invite/abc123")).toBe(false);
    expect(isTourablePath("/reset/abc123")).toBe(false);
    expect(isTourablePath("/")).toBe(true);
    expect(isTourablePath("/monthly")).toBe(true);
    expect(isTourablePath("/settings/members")).toBe(true);
  });
});

describe("進む/戻るの状態遷移", () => {
  it("最後の手順から進むと終了(null)", () => {
    expect(moveIndex(0, 3, 1)).toBe(1);
    expect(moveIndex(1, 3, 1)).toBe(2);
    expect(moveIndex(2, 3, 1)).toBeNull();
  });

  it("最初の手順から戻ってもツアーは閉じず 0 に留まる", () => {
    expect(moveIndex(2, 3, -1)).toBe(1);
    expect(moveIndex(0, 3, -1)).toBe(0);
  });

  it("手順が1つしかなければ進むと即終了", () => {
    expect(moveIndex(0, 1, 1)).toBeNull();
  });

  it("キー割り当ては Esc=スキップ・←→=戻る/進む、他は無視", () => {
    expect(keyToMove("Escape")).toBe("skip");
    expect(keyToMove("ArrowRight")).toBe("next");
    expect(keyToMove("ArrowLeft")).toBe("prev");
    expect(keyToMove("Enter")).toBeNull();
    expect(keyToMove("a")).toBeNull();
  });

  it("進捗表示は1始まり", () => {
    expect(stepNumber(0)).toBe(1);
    expect(stepNumber(9)).toBe(10);
  });
});

describe("保存(端末ごと。サーバーには送らない)", () => {
  it("完了記録の書き込みと読み出し", () => {
    const store = fakeStorage();
    expect(readTourDone(store)).toBe(false);
    writeTourDone(store, true);
    expect(store.data[TOUR_DONE_KEY]).toBe("1");
    expect(readTourDone(store)).toBe(true);
    writeTourDone(store, false);
    expect(TOUR_DONE_KEY in store.data).toBe(false);
    expect(readTourDone(store)).toBe(false);
  });

  it("ストレージが無い/例外を投げても落ちず「まだ見ていない」扱いになる", () => {
    expect(readTourDone(null)).toBe(false);
    expect(readTourDone(undefined)).toBe(false);
    expect(readTourDone(throwingStorage)).toBe(false);
    expect(() => writeTourDone(throwingStorage, true)).not.toThrow();
    expect(() => writeTourDone(null, true)).not.toThrow();
  });

  it("進捗は手順の id で保存し、位置として読み戻す", () => {
    const steps = stepsFor("admin");
    const store = fakeStorage();
    const third = steps[2];
    if (!third) throw new Error("手順が足りない");
    writeTourProgress(store, third);
    expect(store.data[TOUR_PROGRESS_KEY]).toBe(third.id);
    expect(readTourProgress(store, steps)).toBe(2);
    writeTourProgress(store, null);
    expect(readTourProgress(store, steps)).toBeNull();
  });

  it("権限が変わって手順から消えた id は復元しない", () => {
    // 管理者として settingsHub まで進んだ記録が残っていても、メンバーの並びには無いので無視する。
    const store = fakeStorage({ [TOUR_PROGRESS_KEY]: "settingsHub" });
    expect(readTourProgress(store, stepsFor("admin"))).toBe(6);
    expect(readTourProgress(store, stepsFor("member"))).toBeNull();
  });

  it("進捗の読み書きもストレージの例外を握りつぶす", () => {
    expect(readTourProgress(throwingStorage, stepsFor("member"))).toBeNull();
    expect(readTourProgress(null, stepsFor("member"))).toBeNull();
    const first = stepsFor("member")[0];
    if (!first) throw new Error("手順が足りない");
    expect(() => writeTourProgress(throwingStorage, first)).not.toThrow();
  });
});

describe("位置計算", () => {
  const viewport = { width: 1280, height: 900 };

  it("切り抜きは対象の周りに余白を足し、画面からはみ出さない", () => {
    expect(cutoutRect({ top: 100, left: 200, width: 300, height: 50 }, viewport)).toEqual({
      top: 92,
      left: 192,
      width: 316,
      height: 66,
    });
    // 画面の左上端に張り付いた対象でも負の座標にならない。
    expect(cutoutRect({ top: 0, left: 0, width: 100, height: 40 }, viewport)).toEqual({
      top: 0,
      left: 0,
      width: 108,
      height: 48,
    });
  });

  it("既定の向きに置ければそのまま下に出す", () => {
    const pos = placeTooltip({ top: 100, left: 500, width: 200, height: 60 }, { width: 320, height: 180 }, viewport, "bottom");
    expect(pos.placement).toBe("bottom");
    expect(pos.top).toBe(172); // 100 + 60 + gap(12)
    expect(pos.left).toBe(440); // 対象の中央 600 - 320/2
  });

  it("下に入らなければ上へ反転する", () => {
    const pos = placeTooltip({ top: 800, left: 500, width: 200, height: 60 }, { width: 320, height: 180 }, viewport, "bottom");
    expect(pos.placement).toBe("top");
    expect(pos.top).toBe(608); // 800 - 180 - gap(12)
  });

  it("上に入らなければ下へ反転する", () => {
    const pos = placeTooltip({ top: 10, left: 500, width: 200, height: 60 }, { width: 320, height: 180 }, viewport, "top");
    expect(pos.placement).toBe("bottom");
    expect(pos.top).toBe(82);
  });

  it("狭い画面では左右にはみ出さないよう寄せる(スマホ)", () => {
    const mobile = { width: 390, height: 844 };
    const left = placeTooltip({ top: 100, left: 0, width: 40, height: 40 }, { width: 360, height: 200 }, mobile, "bottom");
    expect(left.left).toBe(12); // margin まで戻す
    const right = placeTooltip({ top: 100, left: 350, width: 40, height: 40 }, { width: 360, height: 200 }, mobile, "bottom");
    expect(right.left).toBe(18); // 390 - 360 - 12
  });

  it("上下どちらにも入らない場合でも画面内に収める", () => {
    const tiny = { width: 390, height: 300 };
    const pos = placeTooltip({ top: 120, left: 100, width: 100, height: 60 }, { width: 360, height: 260 }, tiny, "bottom");
    expect(pos.top).toBeGreaterThanOrEqual(12);
    expect(pos.top).toBeLessThanOrEqual(300 - 260 - 12 + 1);
  });

  it("画面外の対象はスクロールして見せる", () => {
    expect(needsScrollIntoView({ top: -50, left: 0, width: 100, height: 40 }, viewport)).toBe(true);
    expect(needsScrollIntoView({ top: 880, left: 0, width: 100, height: 40 }, viewport)).toBe(true);
    expect(needsScrollIntoView({ top: 400, left: 0, width: 100, height: 40 }, viewport)).toBe(false);
  });

  it("画面より背の高い対象は、十分見えていればスクロールしない(無限スクロール防止)", () => {
    // 上から下まで画面を埋めている縦長のカード: 上端も下端も画面内に無いが、これで十分。
    expect(needsScrollIntoView({ top: -200, left: 0, width: 400, height: 1500 }, viewport)).toBe(false);
    // 下端がわずかに覗いているだけなら、まだ見せる必要がある。
    expect(needsScrollIntoView({ top: 870, left: 0, width: 400, height: 1500 }, viewport)).toBe(true);
  });
});
