/**
 * 労働時間制の版(work_policy_versions の1行)の入力検証と、レスポンスへの変換。
 *
 * 2026-10-05(名前付きの制度、時短勤務対応の第1段階)に routes/settings/work-policy.ts から
 * 切り出した。版を追加する経路が3つになったため(従来の POST /settings/work-policy、
 * 制度を作る POST /settings/work-policies、制度に版を足す POST /settings/work-policies/:id/versions)、
 * 検証を1箇所にまとめて経路ごとに規則がずれないようにする。中身の規則は切り出し前と同じで、
 * 固定時間制の所定労働時間の上限(480分)だけを追加した(下記 FIXED_MAX_STANDARD_DAY_MINUTES)。
 */

import type { WorkPolicyVersion } from "@kizami/db";
import { parseCoreTime } from "../../lib/settings.js";

/** 労働時間制の種別。engine の `WorkSystem["kind"]` と同じ3値 */
export type WorkPolicyKind = "flex" | "fixed" | "monthly_variable";

export function isWorkPolicyKind(value: unknown): value is WorkPolicyKind {
  return value === "flex" || value === "fixed" || value === "monthly_variable";
}

/**
 * kind = "fixed" / "monthly_variable" のとき、DB 列(settlement_period は NOT NULL)を埋めるため
 * だけに使うプレースホルダ。work_policy_versions.settlementPeriod は flex 専用の列であり
 * (packages/db/src/schema/settings.ts のコメント参照)、固定時間制では意味を持たず
 * リクエストの値も使わない。決め打ちの値をこの1箇所だけに集約し、コード中に
 * "monthly" 文字列リテラルが散らばらないようにする。
 */
export const FIXED_SETTLEMENT_PERIOD_PLACEHOLDER = "monthly";

/**
 * monthly_variable(シフト制)で standardDayMinutes が省略されたときの既定値
 * (1日8時間)。
 *
 * 意味の変遷(2026-08-24, v0.7 フェーズ4): 以前この定数は「NOT NULL 列を埋めるためだけの
 * プレースホルダ(値に意味は無い)」だった。フェーズ4で monthly_variable の
 * `standard_day_minutes` に **「1日あたりの基準所定時間(有給換算用)」** という明確な意味が
 * 与えられた(シフトの無い日に有給を取ったとき1日分を何分に換算するか。
 * apps/api/src/lib/leave-minutes.ts・docs/design/shift-work.md フェーズ4 参照)。
 * よってリクエストで指定できるようにし、この定数は「未指定時の既定」に降格する
 * (集計〔engine〕側がこの値を読まないことは従来どおり — 所定は ShiftDay が日ごとに決める)。
 */
export const VARIABLE_DEFAULT_STANDARD_DAY_MINUTES = 480;

/**
 * 固定時間制の所定労働時間(1日)の上限。8時間(労基法32条2項の1日の法定労働時間)。
 *
 * 判断点(2026-10-05): 固定時間制で所定を8時間超に設定すると、エンジン
 * (packages/engine/src/fixed.ts)は8時間を超えた分を日次の法定時間外として扱うため
 * 計算自体は壊れないが、「所定が9時間」という設定は1日8時間の法定労働時間を超える所定を
 * 就業規則で定めることになり、通常の固定時間制としては適法に成り立たない(変形労働時間制の
 * 協定が要る)。誤設定を早い段階で止めるため、受け付けない。フレックス(標準労働時間)と
 * 変形労働時間制(基準所定)は意味が違うため、従来どおり 1〜1440 のまま。
 */
export const FIXED_MAX_STANDARD_DAY_MINUTES = 480;

/** standardDayMinutes の上限(kind ごと)。下限はどの制度も1分 */
export function maxStandardDayMinutesFor(kind: WorkPolicyKind): number {
  return kind === "fixed" ? FIXED_MAX_STANDARD_DAY_MINUTES : 1440;
}

/** kind ごとの範囲で standardDayMinutes を検証する(整数・1以上・上限以下) */
export function isValidStandardDayMinutes(kind: WorkPolicyKind, value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maxStandardDayMinutesFor(kind);
}

/**
 * GET /settings/work-policy・GET /settings/work-policies のレスポンス要素(1版分)。
 *
 * `core`(コアタイム)は DB では JSON 文字列だが、レスポンスでは復元済みのオブジェクト
 * (または null)で返す — クライアントに JSON の二重パースをさせないため、
 * legal_holiday_rule / break_rule を返す GET /settings/attendance と同じ流儀。
 */
export function serializeWorkPolicyVersion(v: WorkPolicyVersion) {
  return {
    effectiveFrom: v.effectiveFrom,
    kind: v.kind,
    settlementPeriod: v.settlementPeriod,
    core: parseCoreTime(v.core),
    standardDayMinutes: v.standardDayMinutes,
    createdAt: v.createdAt,
  };
}

/**
 * リクエストの `core`(コアタイム、labor law §32-3)を検証して DB へ入れる JSON 文字列にする。
 *
 * 返り値: `{ core: string | null }` なら採用、`{ error }` なら 400 を返す。
 * 省略・null は「コアタイムなし」(スーパーフレックス)として扱う — コアタイムの設定自体が
 * 労使協定の任意事項であり、送らないことが正常な既定だから(docs/design/work-systems.md)。
 *
 * 検証(engine の `CoreTime` の契約と一致させる。packages/engine/src/types.ts 参照):
 * - startMinutes / endMinutes は 0〜1440 の整数
 * - startMinutes < endMinutes(**日跨ぎを許さない** — コアタイムは日中の帯という制度前提。
 *   ここで弾かないと、エンジン側が「帯なし」として黙って無視するため、設定したつもりの
 *   コアタイムが一切効かないという分かりにくい状態になる)
 * - weekdays(省略可)は 0〜6 の整数の配列。空配列は「全曜日で対象外」を意味してしまい
 *   設定ミスと区別できないため拒否する(指定しないこと = engine 既定の月〜金)
 */
export function buildCoreTimeJson(value: unknown): { core: string | null } | { error: string } {
  if (value === undefined || value === null) return { core: null };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "invalid_core_time" };

  const { startMinutes, endMinutes, weekdays } = value as Record<string, unknown>;
  const isMinutesOfDay = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1440;
  if (!isMinutesOfDay(startMinutes) || !isMinutesOfDay(endMinutes) || startMinutes >= endMinutes) {
    return { error: "invalid_core_time" };
  }

  const core: { startMinutes: number; endMinutes: number; weekdays?: number[] } = { startMinutes, endMinutes };
  if (weekdays !== undefined) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) return { error: "invalid_core_time_weekdays" };
    if (!weekdays.every((w) => Number.isInteger(w) && w >= 0 && w <= 6)) return { error: "invalid_core_time_weekdays" };
    core.weekdays = [...new Set(weekdays as number[])].sort((a, b) => a - b);
  }
  return { core: JSON.stringify(core) };
}

/** 検証済みの版の中身(effectiveFrom を除く)。insertWorkPolicyVersion にそのまま渡せる形 */
export interface WorkPolicyVersionFields {
  kind: WorkPolicyKind;
  settlementPeriod: string;
  core: string | null;
  standardDayMinutes: number;
}

/**
 * リクエストの本文から版の中身(kind・settlementPeriod・core・standardDayMinutes)を検証して取り出す。
 * effectiveFrom の検証(書式・過去日・重複)は経路ごとに規則が違うため、呼び出し側が行う。
 *
 * エラー名は切り出し前の POST /settings/work-policy と同じ:
 * invalid_work_system_kind / invalid_settlement_period / invalid_core_time /
 * invalid_core_time_weekdays / invalid_standard_day_minutes
 */
export function parseWorkPolicyVersionFields(body: Record<string, unknown>): WorkPolicyVersionFields | { error: string } {
  // 2026-08-23 shift-work.md 決定事項5: WorkSystem の3値目 "monthly_variable"(1ヶ月単位の
  // 変形労働時間制)を受け付ける。periodStartDay はこのポリシー版ではなくテナント設定
  // (tenant_setting_versions.variable_period_start_day、POST /settings/attendance)側が持つ。
  if (!isWorkPolicyKind(body.kind)) {
    return { error: "invalid_work_system_kind" };
  }
  const kind = body.kind;

  // settlementPeriod はフレックス専用の列。固定時間制・monthly_variable ではリクエストの値を
  // 見ず(検証もせず)、上記プレースホルダで DB 列を埋める。v0.1 はフレックスの清算期間
  // "monthly" のみ対応(packages/engine の FlexSettings.settlement)。
  let settlementPeriod: string;
  if (kind === "flex") {
    if (body.settlementPeriod !== "monthly") {
      return { error: "invalid_settlement_period" };
    }
    settlementPeriod = body.settlementPeriod;
  } else {
    settlementPeriod = FIXED_SETTLEMENT_PERIOD_PLACEHOLDER;
  }

  // コアタイム(labor law §32-3、2026-08-24 追加)は flex 専用。fixed・monthly_variable では
  // settlementPeriod と同じくリクエストの値を見ず null で埋める(列の意味が無いため)。
  let core: string | null = null;
  if (kind === "flex") {
    const result = buildCoreTimeJson(body.core);
    if ("error" in result) return { error: result.error };
    core = result.core;
  }

  // standardDayMinutes: flex は「標準労働時間(有給の枠算入に使う)」、fixed は「所定労働時間」
  // (1〜480分、FIXED_MAX_STANDARD_DAY_MINUTES 参照)、monthly_variable は「基準所定(有給換算用)」。
  // monthly_variable でのみ省略を許し、その場合は既定値を使う(後方互換 — フェーズ4以前の
  // クライアントはこの制度で standardDayMinutes を送っていなかった)。
  let standardDayMinutes: number;
  if (kind === "monthly_variable" && body.standardDayMinutes === undefined) {
    standardDayMinutes = VARIABLE_DEFAULT_STANDARD_DAY_MINUTES;
  } else {
    if (!isValidStandardDayMinutes(kind, body.standardDayMinutes)) {
      return { error: "invalid_standard_day_minutes" };
    }
    standardDayMinutes = body.standardDayMinutes;
  }

  return { kind, settlementPeriod, core, standardDayMinutes };
}

/**
 * 版の列から「date 以下で最大の effectiveFrom」の版を返す(無ければ null)。並び順は問わない。
 * buildSettingsTimeline(apps/api/src/lib/settings.ts)と同じ解決規則。
 *
 * 割当の前の検査に使う: 制度の最初の版より前の日付から割り当てると、その間の月次・有給で
 * 版を解決できず 500 になるため、API の入口で 409 work_policy_not_effective_yet として止める。
 */
export function versionEffectiveOn<T extends { effectiveFrom: string }>(versions: readonly T[], date: string): T | null {
  let chosen: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (chosen === null || v.effectiveFrom > chosen.effectiveFrom)) {
      chosen = v;
    }
  }
  return chosen;
}
