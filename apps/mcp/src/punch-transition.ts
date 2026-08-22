/**
 * 打刻の状態遷移ルール(依頼: 「現在の状態を確認してから実行し、無効な遷移は実行前にエラーを
 * 返す」)。apps/api/src/routes/attendance.ts の deriveStatus と同じ遷移規則を、逆向き
 * (「この状態でこの kind は打てるか」)に持つ。
 *
 * 「休憩中の clock_out」は deriveStatus 側で有効な遷移(休憩を終えて退勤)として扱われている
 * ため、ここでも許可する(docs/design/v01-data-model.md「不正打刻列の解釈ルール」参照)。
 *
 * 注意: ここでの判定はあくまで「MCPが直前に取得した状態」に基づく事前チェックであり、
 * サーバー側の最終的な整合性チェックを代替しない(他クライアントからほぼ同時に打刻された
 * 場合のレースはあり得る)。それでも、明らかに無効な遷移(例: 勤務外の退勤)をAPI呼び出し前に
 * 弾くことで、無意味な打刻レコードの作成やAPIエラーの生のJSONをそのままAIに見せることを防ぐ。
 */

import type { AttendanceState, PunchKind } from "./types.js";
import { punchKindLabel, stateLabel } from "./format.js";

const VALID_TRANSITIONS: Readonly<Record<AttendanceState, readonly PunchKind[]>> = {
  out: ["clock_in"],
  working: ["clock_out", "break_start"],
  onBreak: ["break_end", "clock_out"],
};

export function isValidPunchTransition(state: AttendanceState, kind: PunchKind): boolean {
  return VALID_TRANSITIONS[state].includes(kind);
}

/** 無効な遷移を人間に分かる理由で説明する(依頼: 「人間に分かる説明にする」)。 */
export function describeInvalidPunchTransition(state: AttendanceState, kind: PunchKind): string {
  const allowed = VALID_TRANSITIONS[state].map(punchKindLabel).join(" または ");
  const allowedSuffix = allowed.length > 0 ? `この状態で打刻できるのは ${allowed} です。` : "この状態では打刻できません。";
  return `現在の状態は「${stateLabel(state)}」のため、「${punchKindLabel(kind)}」は打刻できません。${allowedSuffix}`;
}
