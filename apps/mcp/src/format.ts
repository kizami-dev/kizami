/**
 * ツール出力を人間が読める形式に整形するためのヘルパー(依頼: 「ツールの出力は人間が読める
 * 形式にする(生のJSONではなく、時刻や時間を読みやすく整形する)」)。
 *
 * KIZAMI 内部の時刻表現(UTC エポック分)は API のレスポンスでもそのまま返るため、ここで
 * 人間向けの日時文字列に変換する。KIZAMI は日本国内の勤怠管理を主目的とするため(要件定義書)、
 * 表示は Asia/Tokyo 固定とする(apps/api 側の集計も TZ_OFFSET_MINUTES_JST 固定を前提にしている)。
 */

import type { AttendanceState } from "./types.js";

const timestampFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** UTC エポック分 → "2026-08-22 09:00"(JST)。 */
export function formatTimestamp(epochMinutes: number): string {
  const parts = timestampFormatter.formatToParts(new Date(epochMinutes * 60_000));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 分数 → "7時間30分" のような読みやすい表記。負数は "-1時間15分" のように符号を残す。 */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0 && m === 0) return "0分";
  if (h === 0) return `${sign}${m}分`;
  if (m === 0) return `${sign}${h}時間`;
  return `${sign}${h}時間${m}分`;
}

export const PUNCH_KIND_LABEL: Readonly<Record<string, string>> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
  void: "取消",
};

export function punchKindLabel(kind: string): string {
  return PUNCH_KIND_LABEL[kind] ?? kind;
}

export const STATE_LABEL: Readonly<Record<AttendanceState, string>> = {
  out: "勤務外",
  working: "勤務中",
  onBreak: "休憩中",
};

export function stateLabel(state: AttendanceState): string {
  return STATE_LABEL[state] ?? state;
}

export const CORRECTION_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取り下げ",
};

export function correctionStatusLabel(status: string): string {
  return CORRECTION_STATUS_LABEL[status] ?? status;
}

const WARNING_LABEL: Readonly<Record<string, string>> = {
  missing_clock_out: "退勤打刻が無いまま終わっている区間があります(その区間は集計から除外されています)",
  duplicate_clock_in: "勤務中に重複した出勤打刻があり、無効化されています",
  clock_out_without_in: "出勤していない状態での退勤打刻があり、無効化されています",
  break_outside_work: "勤務外の休憩打刻があり、無効化されています",
  duplicate_break_start: "休憩中に重複した休憩開始打刻があり、無効化されています",
  unmatched_break_end: "休憩中でない状態での休憩終了打刻があり、無効化されています",
  clock_out_during_break: "休憩中に退勤打刻があり、休憩を終えて退勤したものとして扱われています",
};

export function warningLabel(kind: string): string {
  return WARNING_LABEL[kind] ?? kind;
}
