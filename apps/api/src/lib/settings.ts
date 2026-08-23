/**
 * DB 上の effective-dated な設定行(tenant_setting_versions / work_policy_versions /
 * user_policy_assignments)を engine の SettingsSpan[] へ組み立てる。
 *
 * tenant_setting_versions は日界・法定休日・休憩ルール・GPS を持つが tzOffset は持たない
 * (docs/design/v01-data-model.md はテナントTZを Asia/Tokyo 前提と明記している)ため、
 * tzOffsetMinutes は本ファイルで固定値として扱う(判断点)。
 */

import { and, asc, eq } from "drizzle-orm";
import {
  getSettingsTimeline,
  getTenantById,
  userPolicyAssignments,
  workPolicyVersions,
  type Database,
  type Transaction,
  type TenantSettingVersion,
} from "@kizami/db";
import type { BreakRule, CalcSettings, LawTimelineSpan, LegalHolidayRule, SettingsSpan } from "@kizami/engine";
import { buildLawTimeline } from "@kizami/law";

/** Asia/Tokyo 固定(分)。テナントTZが設定可能になるのは v1.0 以降の想定。 */
export const TZ_OFFSET_MINUTES_JST = 540;

interface EffectiveDatedRow {
  effectiveFrom: string;
}

/** rows の中から effectiveFrom <= date の最新行を返す(rows の順序は問わない)。 */
function latestAtOrBefore<T extends EffectiveDatedRow>(rows: T[], date: string): T | null {
  let chosen: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom <= date && (chosen === null || row.effectiveFrom > chosen.effectiveFrom)) {
      chosen = row;
    }
  }
  return chosen;
}

/** workPolicyVersions から buildSettingsTimeline が使う列だけを取り出した行の形。 */
export type WorkPolicyVersionRow = {
  effectiveFrom: string;
  workPolicyId: string;
  kind: string;
  settlementPeriod: string;
  standardDayMinutes: number;
};

/**
 * テナント全体の work_policy_versions を取得する(userId に依存しないテナント単位のデータ)。
 * buildSettingsTimeline 自身のフォールバック(precomputedTenant 省略時)と、
 * apps/api/src/lib/closing-amend.ts の TenantMonthlyContext 構築の両方から使う共通クエリ
 * (同じ SELECT を2箇所に書かない)。
 */
export async function fetchWorkPolicyVersionRowsForTenant(db: Database | Transaction, tenantId: string): Promise<WorkPolicyVersionRow[]> {
  return db
    .select({
      effectiveFrom: workPolicyVersions.effectiveFrom,
      workPolicyId: workPolicyVersions.workPolicyId,
      kind: workPolicyVersions.kind,
      settlementPeriod: workPolicyVersions.settlementPeriod,
      standardDayMinutes: workPolicyVersions.standardDayMinutes,
    })
    .from(workPolicyVersions)
    .where(eq(workPolicyVersions.tenantId, tenantId))
    .orderBy(asc(workPolicyVersions.effectiveFrom));
}

export interface BuildSettingsTimelineParams {
  tenantId: string;
  userId: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間初日) */
  fromDate: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間末日) */
  toDate: string;
  /**
   * テナント単位の事前計算済みデータ(N+1解消、レビュー指摘)。同一テナント・同一期間について
   * 複数ユーザー分をまとめて計算する呼び出し元(apps/api/src/lib/closing-amend.ts の
   * TenantMonthlyContext)が、tenant_setting_versions・work_policy_versions の取得を
   * ユーザーごとに繰り返さないよう1回分の結果を渡せる。どちらも tenantId・fromDate・toDate
   * だけで決まり userId には依存しないため、テナント内の全ユーザーで共有できる値。
   * 省略時はこれまでどおり自前で取得する(後方互換)。
   */
  precomputedTenant?: {
    tenantTimeline: TenantSettingVersion[];
    workPolicyVersionRows: WorkPolicyVersionRow[];
  };
}

/**
 * [fromDate, toDate] をカバーする engine 用 SettingsSpan[] を組み立てる。
 *
 * 変更点(from 値)は「テナント設定の版」「ユーザーの制度割当」「割当先の制度の版」の
 * いずれかが変わりうる日の和集合とし、各変更点で3者を独立に(effectiveFrom <= date の
 * 最新行として)解決してマージする。
 *
 * `Database | Transaction` を受け取る(apps/api/src/lib/closing-amend.ts が締め後修正の
 * 反映と同一トランザクションで月次を再計算するために必要)。
 */
export async function buildSettingsTimeline(
  db: Database | Transaction,
  params: BuildSettingsTimelineParams,
): Promise<SettingsSpan[]> {
  const { tenantId, userId, fromDate, toDate, precomputedTenant } = params;

  const tenantTimeline = precomputedTenant ? precomputedTenant.tenantTimeline : await getSettingsTimeline(db, { tenantId, fromDate, toDate });
  if (tenantTimeline.length === 0) {
    throw new Error(`no tenant settings version effective on or before ${fromDate}`);
  }

  const assignments = await db
    .select({
      effectiveFrom: userPolicyAssignments.effectiveFrom,
      workPolicyId: userPolicyAssignments.workPolicyId,
    })
    .from(userPolicyAssignments)
    .where(and(eq(userPolicyAssignments.tenantId, tenantId), eq(userPolicyAssignments.userId, userId)))
    .orderBy(asc(userPolicyAssignments.effectiveFrom));

  if (latestAtOrBefore(assignments, fromDate) === null) {
    throw new Error(`no work policy assigned to user ${userId} on or before ${fromDate}`);
  }

  const versions = precomputedTenant ? precomputedTenant.workPolicyVersionRows : await fetchWorkPolicyVersionRowsForTenant(db, tenantId);

  // 判断点(バグ修正, 2026-08-22): 変更点(changePoints)には元々「assignments/versions の
  // effectiveFrom <= toDate」を無条件に含めていたが、これは fromDate より前の変更点も
  // (テナントの版が複数あり、その中の1つが fromDate より後に始まっていた場合)含んでしまい、
  // 該当日を「tenantTimeline(fromDate 以前の最新版1件 + 期間内の版)」で解決できず例外に
  // なるケースがあった(例: テナント設定を fromDate より後の日付に1回変更しただけの、ごく
  // 普通の運用でも発生する — テナント側は「fromDate 以前の最新版」だけが残るのに対し、
  // assignment/version 側は無フィルタの全履歴を保持しているため、両者の「変更点集合」の
  // 前提がズレていた)。fromDate より前の変更点は、どのみち「fromDate 時点で有効な最新値」
  // (`latestAtOrBefore` が全履歴から正しく引ける)に吸収されるため、個別の span としては
  // 不要 — `>= fromDate` に絞ることで、tenantTimeline の実際のカバー範囲と整合させる。
  const changePoints = new Set<string>();
  for (const v of tenantTimeline) changePoints.add(v.effectiveFrom);
  for (const a of assignments) if (a.effectiveFrom >= fromDate && a.effectiveFrom <= toDate) changePoints.add(a.effectiveFrom);
  for (const v of versions) if (v.effectiveFrom >= fromDate && v.effectiveFrom <= toDate) changePoints.add(v.effectiveFrom);

  const sortedDates = [...changePoints].sort();

  return sortedDates.map((date): SettingsSpan => {
    // 判断点(バグ修正, 2026-08-23): 各要素(tenantVersion/assignment/version)は本来 `date`
    // (このspanの開始点)で解決すべきだが、`date` が `fromDate` より前になりうる
    // (tenantTimeline は「fromDate 以前の最新版1件」を必ず含むため、その版の effectiveFrom が
    // 唯一の changePoint になっているケースがある)。このとき assignment/version は
    // `>= fromDate` でしか changePoints に採用しないため、`fromDate` より前かつ tenantVersion の
    // effectiveFrom より後で work policy だけが切り替わっていた場合、その切り替えが
    // どの changePoint にも現れず、解決に使う日付が古いまま(切り替え前の版)になってしまう
    // (上のバグ修正コメントが前提としていた「fromDate 時点の最新値に吸収される」が実際には
    // 成立していなかった — `latestAtOrBefore` に渡していたのが `fromDate` ではなく `date` その
    // ものだったため)。`date` が `fromDate` より前のときだけ `fromDate` に引き上げて解決する
    // ことで、この2つの日付のずれを解消する(`date` 自体は span の `from` として使うため
    // そのまま残す — engine 側は「この日付以下で最大の from を持つ span」を選ぶだけなので、
    // fromDate より前の span が結果的に「実際には fromDate 時点の値」を持っていても、
    // fromDate 以降の日付を解決する際の結果は変わらない)。
    const resolveDate = date < fromDate ? fromDate : date;

    const tenantVersion = latestAtOrBefore(tenantTimeline, resolveDate);
    if (!tenantVersion) {
      throw new Error(`no tenant settings resolvable at ${date}`);
    }
    const assignment = latestAtOrBefore(assignments, resolveDate);
    if (!assignment) {
      throw new Error(`no work policy assigned at ${date}`);
    }
    const version = latestAtOrBefore(
      versions.filter((v) => v.workPolicyId === assignment.workPolicyId),
      resolveDate,
    );
    if (!version) {
      throw new Error(`no work policy version resolvable for policy ${assignment.workPolicyId} at ${date}`);
    }

    const settings: CalcSettings = {
      tzOffsetMinutes: TZ_OFFSET_MINUTES_JST,
      dayBoundaryMinutes: tenantVersion.dayBoundaryMinutes,
      weekStartWeekday: toWeekday(tenantVersion.weekStartWeekday),
      legalHoliday: JSON.parse(tenantVersion.legalHolidayRule) as LegalHolidayRule,
      workSystem:
        version.kind === "fixed"
          ? { kind: "fixed", standardDayMinutes: version.standardDayMinutes }
          : { kind: "flex", settlement: version.settlementPeriod as "monthly", core: null, standardDayMinutes: version.standardDayMinutes },
      breakRule: JSON.parse(tenantVersion.breakRule) as BreakRule,
    };

    return { from: date, settings };
  });
}

/**
 * DB の week_start_weekday(素の integer)を engine の `0|1|...|6` 型へ narrowing する。
 *
 * 判断点: 範囲外の値(DBを直接操作した、マイグレーション漏れ等)を例外にするか 0 に丸めるかは
 * このファイルの既存の流儀(buildSettingsTimeline 冒頭の tenantTimeline が空なら Error を
 * 投げる、standardDayMinutesForDate も解決できなければ Error を投げる)に合わせ、**例外**を選ぶ。
 * 0 に丸めて処理を続けると「週の起算曜日を取り違えたまま週次法定時間外を計算する」という
 * 誤った集計値をサイレントに返してしまい、賃金計算に直結する固定時間制の集計では
 * 検出しにくい実害が大きい。DB 側は NOT NULL 制約はあるが 0〜6 の範囲チェックは持たない
 * (SQLite に CHECK 制約を追加する変更は本タスクのスコープ外の packages/db に及ぶ)ため、
 * アプリ層のこの境界で検証する。
 */
function toWeekday(value: number): CalcSettings["weekStartWeekday"] {
  if (Number.isInteger(value) && value >= 0 && value <= 6) {
    return value as CalcSettings["weekStartWeekday"];
  }
  throw new Error(`invalid week_start_weekday in tenant_setting_versions: ${value}`);
}

export interface BuildLawTimelineForTenantParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間初日) */
  fromDate: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間末日) */
  toDate: string;
}

/**
 * [fromDate, toDate] をカバーする engine 用 LawTimelineSpan[] を組み立てる。
 *
 * テナントの法令プロファイル(is_small_or_medium_enterprise / is_special_provision_workplace、
 * tenants テーブルに直接持つ現在値。packages/db/src/schema/tenants.ts 参照)を
 * `@kizami/law` の `buildLawTimeline` にそのまま渡す。法令プロファイル自体は effective-dated
 * ではない(現在値のみ)ため、buildSettingsTimeline のような「変更点の和集合」計算は不要 —
 * `@kizami/law` 側が法改正の施行日を自動的に処理する。
 *
 * `Database | Transaction` を受け取る(buildSettingsTimeline と同じ理由。
 * apps/api/src/lib/closing-amend.ts が同一トランザクションで使う)。
 */
export async function buildLawTimelineForTenant(
  db: Database | Transaction,
  params: BuildLawTimelineForTenantParams,
): Promise<LawTimelineSpan[]> {
  const { tenantId, fromDate, toDate } = params;
  const tenant = await getTenantById(db, tenantId);
  if (!tenant) {
    throw new Error(`buildLawTimelineForTenant: tenant not found: ${tenantId}`);
  }
  return buildLawTimeline(fromDate, toDate, {
    isSmallOrMediumEnterprise: tenant.isSmallOrMediumEnterprise,
    isSpecialProvisionWorkplace: tenant.isSpecialProvisionWorkplace,
  });
}

/**
 * 指定日に有効な標準労働時間(分)を settingsTimeline から解決する。
 * 有給休暇(§5)の全休・半休の分数換算に使う(routes/leave.ts)。
 *
 * 制度によって `standardDayMinutes` の意味は異なる(`WorkSystem` 型の JSDoc 参照): フレックスでは
 * 「有給日の枠算入に使う標準労働時間」、固定時間制では「所定労働時間そのもの」。しかし
 * どちらも「1日分の有給が何分に換算されるか」としては正しい値であり、この関数はその
 * 共通の役割だけを使うため制度によらず素通しでよい(意味の違いは呼び出し側では意識不要)。
 *
 * buildSettingsTimeline() が返す SettingsSpan[] は effective-dated(from 昇順、期間初日以前に
 * 有効な版を必ず1つ含む)前提のため、engine 側の findSettingsForDate と同じ「date 以下で
 * 最大の from」を選ぶロジックをここでも再実装する(engine パッケージの内部モジュールは
 * 公開 API に含まれないため import できない — buildSettingsTimeline 自体の判断点コメント参照)。
 */
export function standardDayMinutesForDate(settingsTimeline: SettingsSpan[], date: string): number {
  let chosen: SettingsSpan | null = null;
  for (const span of settingsTimeline) {
    if (span.from <= date && (chosen === null || span.from > chosen.from)) {
      chosen = span;
    }
  }
  if (!chosen) {
    throw new Error(`no settings resolvable for ${date}`);
  }
  return chosen.settings.workSystem.standardDayMinutes;
}
