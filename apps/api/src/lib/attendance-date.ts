/**
 * UTC エポック分(打刻の occurredAt)を「その時刻が属する勤怠日(ローカル日付)」へ解決する。
 *
 * apps/api/src/routes/attendance.ts の `resolveTodayWindow` と同じ「最新版で仮日付→その日の
 * 実際の版で再解決」の2パス方式(docs/design/v01-data-model.md 実装時の追加決定)の第1パスのみ
 * を切り出したもの。日付の帰属は roughVersion の dayBoundaryMinutes だけで確定するため
 * (dayStart/dayEnd の窓を UTC 分で組み立てる resolveTodayWindow と違い、こちらは
 * "YYYY-MM-DD" を返すだけでよい)、resolveTodayWindow にある「実際の勤怠日で version を
 * 引き直す」第2パスは不要 — 版が日をまたいで切り替わっていても、日付自体はここで確定した
 * attendanceDayIndex から変わらない。
 *
 * 判断点: `resolveTodayWindow` 自体を共通化・リファクタリングする案もあったが、既存
 * エンドポイント(GET /attendance/status)の挙動を変えないという依頼の制約下では安全側に倒し、
 * reminders.ts が settingsForDate 等を独自に複製しているのと同じ既存の慣行(engine 内部
 * モジュールを import できないための最小限の複製)に倣って新規ファイルとして切り出した。
 * 締め済みガード(closing-guard.ts)・修正申請(corrections.ts)・打刻(punches.ts)の3箇所から
 * 共通で使う。
 */

import { getEffectiveSettingsVersion, type Database } from "@kizami/db";
import { dateFromEpochDay } from "./time.js";
import { TZ_OFFSET_MINUTES_JST } from "./settings.js";

const MINUTES_PER_DAY = 1440;

/**
 * occurredAt(UTC エポック分)が属する勤怠日(ローカル "YYYY-MM-DD")を解決する。
 * その時点で有効なテナント設定バージョンが1つも無ければ例外を投げる
 * (buildSettingsTimeline / resolveTodayWindow と同じ扱い)。
 *
 * 判断点: `getEffectiveSettingsVersion` は `Database` のみを受け付ける(`Transaction` 非対応)
 * ため、本関数も `Database` のみを受け取る。呼び出し側(punches.ts・corrections.ts)は
 * いずれもトランザクション開始前(読み取り専用の検証フェーズ)で呼ぶため実害はない。
 */
export async function resolveAttendanceDate(
  db: Database,
  params: { tenantId: string; occurredAt: number },
): Promise<string> {
  const { tenantId, occurredAt } = params;
  const tz = TZ_OFFSET_MINUTES_JST;
  const localMinutes = occurredAt + tz;
  const roughEpochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const minuteOfDay = localMinutes - roughEpochDay * MINUTES_PER_DAY;

  const roughDate = dateFromEpochDay(roughEpochDay);
  const roughVersion = await getEffectiveSettingsVersion(db, { tenantId, onDate: roughDate });
  if (!roughVersion) {
    throw new Error(`no tenant settings version effective on or before ${roughDate}`);
  }

  const attendanceDayIndex = minuteOfDay >= roughVersion.dayBoundaryMinutes ? roughEpochDay : roughEpochDay - 1;
  const attendanceDate = dateFromEpochDay(attendanceDayIndex);

  return attendanceDate;
}

/** "YYYY-MM-DD" → "YYYY-MM" */
export function periodFromDate(date: string): string {
  return date.slice(0, 7);
}
