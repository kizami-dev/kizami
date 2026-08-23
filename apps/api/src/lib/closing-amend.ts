/**
 * 締め後修正(amend)のための月次再計算。
 *
 * 修正申請・休暇申請の承認が締め済み月に影響する場合、`assertAmendAllowed` の許可判定の後、
 * その月をロックしたまま(closed のまま)対象ユーザー1人分の集計だけを再計算し、新しい
 * スナップショット世代として保存する(apps/api/src/routes/corrections.ts・leave.ts が呼ぶ)。
 *
 * 判断点(reminders.ts の calculateMonthlyForUser を再利用しなかった理由): 既存の
 * calculateMonthlyForUser(apps/api/src/reminders.ts)は締め処理(POST /closings/:period/close)
 * が使う既存のヘルパーだが、`paidLeave` を常に空配列で calculate() に渡しており、承認済み
 * 休暇のフレックス反映を含まない(§5「集計との連動」)。amend は「有給1日追加でフレックス実績が
 * 増える」ケース(依頼のテスト6)を正しく再計算する必要があるため、GET /attendance/monthly
 * (apps/api/src/routes/attendance.ts)と同じ組み立て(打刻 + 設定タイムライン + 承認済み有給)を
 * ここに独立実装する。calculateMonthlyForUser 自体は締め処理の既存動作を変えないため未変更。
 *
 * 判断点(`Database | Transaction` を受け取る理由): 依頼は「反映後にスナップショットを
 * 再計算して新世代を保存 + closing_events に amend 追記」を**同一トランザクション**で行うことを
 * 求めている。これを満たすため、内部で使う読み取り関数(listValidPunches・
 * buildSettingsTimeline・listApprovedLeaveRequestsInRange)を `Database | Transaction` 対応に
 * widen した(各関数の定義側にコメントあり)。呼び出し側は承認処理と同じ tx をそのまま渡せる。
 * トランザクション内で使われる可能性があるため、読み取りは(同一コネクションでの並行実行を
 * 避けるため)`Promise.all` にせず逐次 await する。
 *
 * N+1解消(レビュー指摘、2026-08-23): law タイムライン・手当タイムライン・テナント設定版
 * (tenant_setting_versions・work_policy_versions)はいずれも tenantId と対象期間だけで決まり
 * userId には依存しないが、以前は computeMonthlyForUser の呼び出し1回ごとに再取得していた。
 * 締め処理・打刻忘れリマインド・36協定アラート・CSVエクスポートはいずれもテナント内の
 * 全ユーザーをループしてこの関数を呼ぶため、実質 N+1 クエリになっていた。
 * `TenantMonthlyContext` としてこの4つ(law・allowance・tenant設定版・work_policy版)を
 * 事前計算し、`computeMonthlyForUser` の**オプショナルな第3引数**として渡せるようにした
 * (省略時は従来どおり自前で取得する = 完全後方互換。apps/api/src/routes/corrections.ts・
 * leave.ts・auto-break-waivers.ts は対象ユーザー1人分のみを扱うため、この第3引数を渡さず
 * 変更前と同じ経路のまま — 挙動もクエリ回数も変わらない)。
 */

import {
  getSettingsTimeline,
  listApprovedLeaveRequestsInRange,
  listApprovedWaiverDatesInRange,
  listValidPunches,
  type Database,
  type TenantSettingVersion,
  type Transaction,
} from "@kizami/db";
import {
  calculate,
  type AllowanceTimelineSpan,
  type EngineInput,
  type EngineOutput,
  type LawTimelineSpan,
  type PaidLeaveEntry,
  type PunchKind,
  type ValidPunch,
} from "@kizami/engine";
import { resolveUsageMinutes, type LeaveUnit } from "@kizami/leave";
import { buildAllowanceTimeline } from "./allowances.js";
import {
  buildLawTimelineForTenant,
  buildSettingsTimeline,
  fetchWorkPolicyVersionRowsForTenant,
  standardDayMinutesForDate,
  TZ_OFFSET_MINUTES_JST,
  type WorkPolicyVersionRow,
} from "./settings.js";
import type { SettingsSpan } from "@kizami/engine";
import { dateFromEpochDay, daysInMonth, epochDayFromDate, formatDate, localMidnightUtcMinutes } from "./time.js";

export interface ComputeMonthlyOutputParams {
  tenantId: string;
  userId: string;
  year: number;
  month: number;
}

/**
 * テナント単位(userId に依存しない)の事前計算済みデータ。同一テナント・同一期間について
 * 複数ユーザー分を計算するループの直前に `buildTenantMonthlyContext` で1回だけ構築し、
 * `computeMonthlyForUser` の第3引数としてユーザーごとに渡す。
 */
export interface TenantMonthlyContext {
  lawTimeline: LawTimelineSpan[];
  allowanceTimeline: AllowanceTimelineSpan[];
  tenantSettingsTimeline: TenantSettingVersion[];
  workPolicyVersionRows: WorkPolicyVersionRow[];
}

/**
 * `TenantMonthlyContext` を構築する(tenantId・year・month だけで決まる4つのテナント単位
 * データをまとめて取得する)。
 */
export async function buildTenantMonthlyContext(
  db: Database | Transaction,
  params: { tenantId: string; year: number; month: number },
): Promise<TenantMonthlyContext> {
  const { tenantId, year, month } = params;
  const monthStartDate = formatDate(year, month, 1);
  const monthEndDate = dateFromEpochDay(epochDayFromDate(monthStartDate) + daysInMonth(year, month) - 1);

  // このファイル冒頭の判断点と同じ理由で、トランザクション内で使われる可能性があるため
  // 逐次 await する。
  const lawTimeline = await buildLawTimelineForTenant(db, { tenantId, fromDate: monthStartDate, toDate: monthEndDate });
  const allowanceTimeline = await buildAllowanceTimeline(db, { tenantId, fromDate: monthStartDate, toDate: monthEndDate });
  const tenantSettingsTimeline = await getSettingsTimeline(db, { tenantId, fromDate: monthStartDate, toDate: monthEndDate });
  const workPolicyVersionRows = await fetchWorkPolicyVersionRowsForTenant(db, tenantId);

  return { lawTimeline, allowanceTimeline, tenantSettingsTimeline, workPolicyVersionRows };
}

/**
 * `buildTenantMonthlyContext` の結果を (tenantId, year, month) キーでキャッシュする薄いヘルパー。
 * overtime-alerts.ts・reminders.ts のように「全テナントの全ユーザー」を1回のスキャンでループする
 * 呼び出し元向け: 同じテナント・同じ月は複数ユーザーから何度も参照されるため、Promise自体を
 * キャッシュに積んでおくことで二重構築(同時に2回buildを走らせてしまうこと)も防ぐ。
 * exports.ts・closings.ts のように対象が単一の (tenantId, year, month) しかない呼び出し元は
 * このキャッシュを使わず `buildTenantMonthlyContext` を直接1回呼べば足りる。
 */
export type TenantMonthlyContextCache = Map<string, Promise<TenantMonthlyContext>>;

export function getOrBuildTenantMonthlyContext(
  cache: TenantMonthlyContextCache,
  db: Database | Transaction,
  params: { tenantId: string; year: number; month: number },
): Promise<TenantMonthlyContext> {
  const key = `${params.tenantId}:${params.year}:${params.month}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const built = buildTenantMonthlyContext(db, params);
  // 失敗しうる Promise をそのままキャッシュに積むため、生成した直後にこの場で
  // no-op の catch を付けて「処理済み」にしておく(Node の unhandledRejection 検出は
  // 同一マイクロタスク内でハンドラが付いているかを見るため、実際にこの Promise を待つ
  // 呼び出し元 — 複数ユーザー分ありうる — が非同期に後から await するだけでは間に合わない
  // ことがある)。呼び出し元は返り値の Promise を自分で await/catch するため、ここでの
  // no-op はエラーを握りつぶさない(呼び出し元に伝播する rejection とは別の、警告抑制専用)。
  built.catch(() => {});
  cache.set(key, built);
  return built;
}

/**
 * 1ユーザー・1ヶ月分の EngineOutput(totals・flexBalance を含む)を、承認済み有給を含めて
 * 再計算する。GET /attendance/monthly と同じ余裕幅(月初日界の前後1日)で打刻を取得する。
 */
export interface MonthlyComputation {
  output: EngineOutput;
  settingsTimeline: SettingsSpan[];
}

/**
 * 1ユーザー・1ヶ月分を承認済み有給込みで計算し、集計結果と設定タイムラインの両方を返す。
 * 締め・打刻忘れリマインド・36協定アラート・締め後修正のすべてがこの1本を使う
 * (2026-08-22: それぞれが別実装を持ち、締め処理と各アラートが有給を無視していたため統合)。
 *
 * `tenantContext` は省略可能(N+1解消、上記ファイル冒頭コメント参照)。渡された場合、
 * law タイムライン・手当タイムライン・テナント設定版の取得をスキップしてそのまま使う。
 * 省略時は従来どおりこの呼び出しの中で自前に取得する(挙動・クエリ回数とも変更前と同一)。
 */
export async function computeMonthlyForUser(
  db: Database | Transaction,
  params: ComputeMonthlyOutputParams,
  tenantContext?: TenantMonthlyContext,
): Promise<MonthlyComputation> {
  const { tenantId, userId, year, month } = params;
  const tz = TZ_OFFSET_MINUTES_JST;

  const monthStartEpochDay = epochDayFromDate(formatDate(year, month, 1));
  const monthEndEpochDay = monthStartEpochDay + daysInMonth(year, month) - 1;
  const monthStartDate = dateFromEpochDay(monthStartEpochDay);
  const monthEndDate = dateFromEpochDay(monthEndEpochDay);

  const fromMinutes = localMidnightUtcMinutes(monthStartEpochDay - 1, tz);
  const toMinutes = localMidnightUtcMinutes(monthEndEpochDay + 2, tz) - 1;

  const punchRows = await listValidPunches(db, { tenantId, userId, fromMinutes, toMinutes });
  const settingsTimeline = await buildSettingsTimeline(db, {
    tenantId,
    userId,
    fromDate: monthStartDate,
    toDate: monthEndDate,
    ...(tenantContext
      ? {
          precomputedTenant: {
            tenantTimeline: tenantContext.tenantSettingsTimeline,
            workPolicyVersionRows: tenantContext.workPolicyVersionRows,
          },
        }
      : {}),
  });
  const lawTimeline = tenantContext
    ? tenantContext.lawTimeline
    : await buildLawTimelineForTenant(db, { tenantId, fromDate: monthStartDate, toDate: monthEndDate });
  const approvedLeaveRequests = await listApprovedLeaveRequestsInRange(db, {
    tenantId,
    userId,
    fromDate: monthStartDate,
    toDate: monthEndDate,
  });
  // 判断点(完了報告に明記): 打刻取得(punchRows)は日界またぎの区間を正しく構成するために
  // 前後1日はみ出して取得するが、waiver の対象期間は同じ幅にする必要が無い。waiveDate は
  // WorkStretch の帰属日(resolveAttendanceDate 後の値、暦日ではなく勤怠日)であり、かつ
  // packages/engine/src/daily.ts の isInPeriod フィルタにより「[monthStartDate,
  // monthEndDate] の外に帰属する区間はそもそもこの月の DailyBreakdown に現れない」。
  // つまり月境界をまたいで隣接月に帰属する区間の waiver は、その隣接月自身の計算でしか
  // 意味を持たない(その月の computeMonthlyForUser 呼び出しが自分の fromDate/toDate で
  // 拾う)。よってここは打刻取得と同じ ±1 日の余裕を持たせる必要が無く、月そのものの範囲で
  // 十分(範囲を広げても実害は無いが、意味の無い余裕を持たせて分かりにくくする理由も無い)。
  const autoBreakWaivedDates = await listApprovedWaiverDatesInRange(db, {
    tenantId,
    userId,
    fromDate: monthStartDate,
    toDate: monthEndDate,
  });
  // 手当(docs/design/allowances.md)。テナント単位の定義であり user には依存しないが、
  // 取得のインターフェースは他の effective-dated タイムラインと揃えて [fromDate, toDate] で渡す。
  const allowances = tenantContext
    ? tenantContext.allowanceTimeline
    : await buildAllowanceTimeline(db, { tenantId, fromDate: monthStartDate, toDate: monthEndDate });

  const punches: ValidPunch[] = punchRows.map((p) => ({ kind: p.kind as PunchKind, occurredAt: p.occurredAt }));
  const paidLeave: PaidLeaveEntry[] = approvedLeaveRequests.map((r) => ({
    date: r.leaveDate,
    minutes: resolveUsageMinutes(r.unit as LeaveUnit, standardDayMinutesForDate(settingsTimeline, r.leaveDate), r.minutes ?? undefined),
  }));

  const input: EngineInput = {
    punches,
    settingsTimeline,
    lawTimeline,
    period: { year, month },
    paidLeave,
    autoBreakWaivedDates,
    allowances,
  };

  return { output: calculate(input), settingsTimeline };
}

/** 集計結果だけが必要な呼び出し向けの薄いラッパー。 */
export async function computeMonthlyOutputForUser(
  db: Database | Transaction,
  params: ComputeMonthlyOutputParams,
  tenantContext?: TenantMonthlyContext,
): Promise<EngineOutput> {
  return (await computeMonthlyForUser(db, params, tenantContext)).output;
}
