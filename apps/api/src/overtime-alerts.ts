/**
 * 36協定アラート(完全版, v0.3)の定期スキャン本体。
 *
 * 参照: docs/requirements.md §5「36協定アラート(早期導入)」
 * - v0.2 は月45時間の時間外(実績・見込み)のみを扱っていた。v0.3(本ファイル)はそれに加えて
 *   年360h(実績・見込み)・特別条項時の各上限(月100時間未満・複数月平均80時間・年720時間・
 *   月45時間超は年6回まで)を扱う「完全版」にする。
 * - すべての閾値は `@kizami/law` の `LawRules.agreement36` から取得する(ハードコード禁止)。
 *   評価対象月の1日(ローカル日付)に有効な法令版を `resolveLawRules` で解決して使う
 *   (テナントの法令プロファイル `is_small_or_medium_enterprise`/`is_special_provision_workplace`
 *   は tenants テーブルから読む。apps/api/src/lib/settings.ts の buildLawTimelineForTenant と
 *   同じ考え方だが、こちらは月次スキャンの1点評価なので `resolveLawRules` を直接使う)。
 *
 * 通知種別(8種、すべて notifications テーブル・UNIQUE(tenant_id, user_id, type, subject_date)
 * による重複防止に乗せる):
 * - `overtime_45h_reached` / `overtime_45h_projected`(既存, v0.2): 月45時間の実績・見込み。
 *   subject_date は対象月の1日
 * - `overtime_annual_limit_reached` / `overtime_annual_limit_projected`(新規): 年度(4月始まり)の
 *   時間外累計が年360時間に達した/達する見込み。subject_date は年度開始日("YYYY-04-01")
 * - `overtime_special_monthly_cap`(新規、特別条項有効時のみ): 単月の時間外+休日労働が
 *   100時間以上(=特別条項下でも許容されない)。subject_date は対象月の1日
 * - `overtime_special_average`(新規、特別条項有効時のみ): 対象月を含む直近2〜6ヶ月のいずれかの
 *   時間外+休日労働の平均が80時間を超えた。subject_date は対象月の1日
 * - `overtime_special_annual`(新規、特別条項有効時のみ): 年度の時間外累計が720時間を超えた。
 *   subject_date は年度開始日
 * - `overtime_special_month_count`(新規、特別条項有効時のみ): 年度中に月45時間を超えた月が
 *   6回を超えた。subject_date は年度開始日
 *
 * 判断点(独自判断、要件に明記が無い箇所):
 * - 時間外+休日労働の合算対象: 実際の労基法上、月45h/年360h(基本の36協定上限)は
 *   「時間外労働」のみを対象にするが、特別条項の月100時間未満・複数月平均80時間の2つは
 *   「時間外労働+休日労働」の合計を対象にする(労基法36条6項2号・3号)。年720時間は
 *   時間外労働のみが対象(同項1号)。本実装はこの区別を反映している
 *   (`totals.overtime` のみを使う基本枠 vs `totals.overtime + totals.statutoryHoliday` を使う
 *   特別条項の2上限)。
 * - 特別条項系4種は `specialClauseEnabled`(テナント設定、既定 false)が true のときだけ評価する。
 *   特別条項を締結していないテナントにとってこれらの上限は意味を持たない(そもそも月45h/年360hを
 *   超えられない)ため。
 * - 特別条項系4種に「見込み」判定は設けていない(要件が列挙した通知種別名にも `_projected` が
 *   無い)。月100h・複数月平均80h・年720h・年6回はいずれも「既に確定した実績」に対する判定とし、
 *   月45h/年360hの2種のみ見込み判定(保守的な日割り projection)を持つ。
 * - 複数月平均80h(2〜6ヶ月)の算出で、データが存在しない月(在籍前など)は 0 分として扱う
 *   (calculateMonthlyForUser が失敗する月を除外するのではなく0埋めする)。除外すると平均の
 *   分母が動いてしまい直感に反するため、また0埋めは平均を押し下げる方向(=見逃しにくくはならないが
 *   誤検知は増えない)なので、warnings と同じ「保守的解釈」の方針に合わせた。
 * - 年360h/年720hの「見込み」は、年度内で既に確定している月(当月より前)の実績合計 +
 *   当月分だけを日割りで伸ばした見込みの和とする(将来の月については伸ばさない、確定情報が
 *   無いため)。
 * - ユーザー単位の失敗は握りつぶして他のユーザーの処理を止めない(reminders.ts と同じ方針)
 * - 外部チャネル送信は「新規に作成できた通知」だけに行う(reminders.ts と同じ)
 *
 * BullMQ/Valkey には一切依存しない(node:* も使わない)。
 */

import { createNotificationIfAbsent, findNotificationByTypeAndDate, getTenantById, type Database, type Notification, type Tenant } from "@kizami/db";
import { resolveLawRules, type LawRules } from "@kizami/law";
import { dispatch, type DispatchResult, type NotificationChannel } from "@kizami/notify";
import { calculateMonthlyForUser, listActiveUsers, type ActiveUserRow } from "./reminders.js";
import { dateFromEpochDay, daysInMonth, formatDate } from "./lib/time.js";

const MINUTES_PER_DAY = 1440;
/** Asia/Tokyo 固定(分)。apps/api/src/lib/settings.ts の TZ_OFFSET_MINUTES_JST と同じ値。 */
const TZ_OFFSET_MINUTES_JST = 540;

const NOTIFICATION_TYPE_OVERTIME_45H_REACHED = "overtime_45h_reached";
const NOTIFICATION_TYPE_OVERTIME_45H_PROJECTED = "overtime_45h_projected";
const NOTIFICATION_TYPE_ANNUAL_REACHED = "overtime_annual_limit_reached";
const NOTIFICATION_TYPE_ANNUAL_PROJECTED = "overtime_annual_limit_projected";
const NOTIFICATION_TYPE_SPECIAL_MONTHLY_CAP = "overtime_special_monthly_cap";
const NOTIFICATION_TYPE_SPECIAL_AVERAGE = "overtime_special_average";
const NOTIFICATION_TYPE_SPECIAL_ANNUAL = "overtime_special_annual";
const NOTIFICATION_TYPE_SPECIAL_MONTH_COUNT = "overtime_special_month_count";

/** この日数未満しか当月が経過していない場合、見込み通知(projected)は出さない。 */
const MIN_ELAPSED_DAYS_FOR_PROJECTION = 7;

/** 複数月平均80h判定の対象になる窓の幅(月数)。労基法36条6項3号「2箇月から6箇月まで」。 */
const AVERAGE_WINDOW_MIN_MONTHS = 2;
const AVERAGE_WINDOW_MAX_MONTHS = 6;

export interface RunOvertimeAlertScanOptions {
  /** 現在時刻(UTC エポック分)。テストで固定できるよう明示的に渡す */
  nowMinutes: number;
  /**
   * テナントID・ユーザーID・通知種別を受け取り、**本人の**外部チャネル(新規作成できた通知
   * だけに送る)を返す。省略時はアプリ内通知のみ(既定挙動、どの通知も外部送信しない)。
   * reminders.ts の runReminderScan と同じ契約(呼び出し側でユーザーIDをキーにメモ化してよい。
   * テナントの SMTP 接続情報はテナント単位でメモ化してよい)。
   */
  resolveChannels?: (tenantId: string, userId: string, notificationType: string) => Promise<NotificationChannel[]>;
}

export interface CreatedOvertimeAlert {
  notification: Notification;
  dispatchResults: DispatchResult[];
}

export interface RunOvertimeAlertScanResult {
  /** スキャン対象にした(is_active な)ユーザー数 */
  scannedUserCount: number;
  /** 新規作成された通知(重複でスキップされたもの・reached 優先で抑止された projected は含まない) */
  created: CreatedOvertimeAlert[];
}

interface LocalToday {
  year: number;
  month: number;
  /** 当月内の日(1始まり)。「当月1日から今日まで(今日を含む)」の経過日数と同じ値 */
  day: number;
}

/**
 * 現在時刻(UTC エポック分)から、固定 JST オフセットでの「今日」を求める。
 * reminders.ts の resolveTargetMonths と同じ考え方(テナント別 TZ は v1.0 以降)。
 */
function resolveLocalToday(nowMinutes: number): LocalToday {
  const localMinutes = nowMinutes + TZ_OFFSET_MINUTES_JST;
  const todayEpochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const today = dateFromEpochDay(todayEpochDay);
  const parts = today.split("-").map(Number);
  return { year: parts[0] ?? 1970, month: parts[1] ?? 1, day: parts[2] ?? 1 };
}

/** 分を「◯時間◯分」形式にする(表示用。四捨五入して整数分にしてから変換する)。 */
function formatHoursAndMinutes(rawMinutes: number): string {
  const minutes = Math.round(rawMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}時間${remainder}分`;
}

/** 特別条項が無効なテナント向けの注記(既に上限に達した通知の本文に追加する)。 */
function specialClauseNoteIfDisabled(specialClauseEnabled: boolean): string {
  return specialClauseEnabled
    ? ""
    : " 特別条項付き36協定を締結していない場合、これ以上の時間外労働はできません。時間外労働をこれ以上発生させないか、特別条項の締結を検討してください。";
}

interface TargetMonth {
  year: number;
  month: number;
}

/** 年度(4月始まり)の開始年月を返す。1〜3月は前年4月、4〜12月は同年4月。 */
function fiscalYearStart(year: number, month: number): TargetMonth {
  return month >= 4 ? { year, month: 4 } : { year: year - 1, month: 4 };
}

/** from(含む)〜to(含む)の年月を昇順で列挙する(from <= to 前提)。 */
function monthsFromTo(from: TargetMonth, to: TargetMonth): TargetMonth[] {
  const months: TargetMonth[] = [];
  let y = from.year;
  let m = from.month;
  while (y < to.year || (y === to.year && m <= to.month)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/** to(含む)を末尾とする直近 k ヶ月を昇順で返す。 */
function lastKMonths(to: TargetMonth, k: number): TargetMonth[] {
  let y = to.year;
  let m = to.month;
  const months: TargetMonth[] = [];
  for (let i = 0; i < k; i++) {
    months.unshift({ year: y, month: m });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return months;
}

/**
 * 1人・1ヶ月分の時間外関連の数値。フレックス/固定時間制で持つ値が違う(判別可能ユニオン)。
 *
 * `overtimeMinutes`/`holidayMinutes` は両方の branch に共通(engine の totals.overtime /
 * totals.statutoryHoliday をそのまま使う。フレックスの月45h/年360h判定、特別条項の
 * 月100h/複数月平均80hはどちらもこの2値だけで足りる)。フレックスの `actualMinutes`/
 * `frameMinutes`(月枠との比較に使う)は固定時間制には存在しない概念のため fixed branch には無い
 * — projectedOvertimeForMonth が制度ごとに別の式を使う理由と対応している(同関数のJSDoc参照)。
 */
type MonthlyFigures =
  | {
      workSystem: "flex";
      overtimeMinutes: number;
      holidayMinutes: number;
      actualMinutes: number;
      frameMinutes: number;
    }
  | {
      workSystem: "fixed";
      overtimeMinutes: number;
      holidayMinutes: number;
    };

/**
 * 1人・1ヶ月分の時間外関連の数値を取得する。テナント設定・制度割当が揃っていない月は
 * null を返す(reminders.ts / v0.2 の overtime-alerts.ts と同じ「静かにスキップ」方針)。
 */
async function monthlyFigures(
  db: Database,
  params: { tenantId: string; userId: string; year: number; month: number },
): Promise<MonthlyFigures | null> {
  try {
    const { output } = await calculateMonthlyForUser(db, params);
    if (output.workSystem === "fixed") {
      return { workSystem: "fixed", overtimeMinutes: output.totals.overtime, holidayMinutes: output.totals.statutoryHoliday };
    }
    if (output.flexBalance === null) {
      // 契約上ありえない(workSystem: "flex" は必ず flexBalance を伴う。EngineOutput の
      // JSDoc 参照)が、型上 flexBalance は独立した nullable フィールドなので防御的に扱う。
      return null;
    }
    return {
      workSystem: "flex",
      overtimeMinutes: output.totals.overtime,
      holidayMinutes: output.totals.statutoryHoliday,
      actualMinutes: output.flexBalance.actualMinutes,
      frameMinutes: output.flexBalance.frameMinutes,
    };
  } catch {
    return null;
  }
}

/**
 * 見込み時間外(月末までのペースで日割りして伸ばした値)を計算する。
 * 経過日数が MIN_ELAPSED_DAYS_FOR_PROJECTION 未満なら null(見込み判定の対象外)。
 *
 * フレックスと固定時間制で式が違う理由(docs/design/work-systems.md 参照): フレックスは
 * 時間外を「清算期間全体の総枠との過不足」でしか判定しないため、月の途中の
 * totals.overtime は構造的に常に0になる(engine の flex.ts: overtime = max(0, actual - frame)
 * で、月の途中は actual が frame に届かないことがほとんど)。そのため実労働(actualMinutes)を
 * 月末までのペースで伸ばし、総枠(frameMinutes)との差を見込みとする必要がある(v0.2 からの
 * 既存ロジック)。
 * 固定時間制は日次・週次の積み上げで初日から totals.overtime に実績がそのまま乗る
 * (総枠という概念が無い)ため、その overtimeMinutes 自体を同じペースで伸ばせば見込みになる。
 */
function projectedOvertimeForMonth(figures: MonthlyFigures, year: number, month: number, day: number): number | null {
  if (day < MIN_ELAPSED_DAYS_FOR_PROJECTION) return null;
  const paceRatio = daysInMonth(year, month) / day;
  if (figures.workSystem === "fixed") {
    return Math.max(0, figures.overtimeMinutes * paceRatio);
  }
  const projectedActualMinutes = figures.actualMinutes * paceRatio;
  return Math.max(0, projectedActualMinutes - figures.frameMinutes);
}

function monthlyReachedContent(params: { year: number; month: number; overtimeMinutes: number; specialClauseEnabled: boolean }): {
  title: string;
  body: string;
} {
  const { year, month, overtimeMinutes, specialClauseEnabled } = params;
  return {
    title: "月45時間の時間外労働に達しました",
    body: `${year}年${month}月の時間外労働の実績が${formatHoursAndMinutes(overtimeMinutes)}となり、36協定の月45時間ラインに達しました。${specialClauseNoteIfDisabled(specialClauseEnabled)}`,
  };
}

function monthlyProjectedContent(params: {
  year: number;
  month: number;
  day: number;
  overtimeMinutes: number;
  projectedMinutes: number;
  specialClauseEnabled: boolean;
}): { title: string; body: string } {
  const { year, month, day, overtimeMinutes, projectedMinutes, specialClauseEnabled } = params;
  return {
    title: "月45時間の時間外労働を超える見込みです",
    body: `${year}年${month}月${day}日時点の時間外労働の実績は${formatHoursAndMinutes(overtimeMinutes)}です。このままのペースだと月末までに${formatHoursAndMinutes(projectedMinutes)}に達し、36協定の月45時間ラインを超える見込みです。${specialClauseNoteIfDisabled(specialClauseEnabled)}`,
  };
}

function annualReachedContent(params: { fiscalYearStartYear: number; overtimeMinutes: number; specialClauseEnabled: boolean }): {
  title: string;
  body: string;
} {
  const { fiscalYearStartYear, overtimeMinutes, specialClauseEnabled } = params;
  return {
    title: "年360時間の時間外労働に達しました",
    body: `${fiscalYearStartYear}年度(4月始まり)の時間外労働の累計が${formatHoursAndMinutes(overtimeMinutes)}となり、36協定の年360時間ラインに達しました。${specialClauseNoteIfDisabled(specialClauseEnabled)}`,
  };
}

function annualProjectedContent(params: {
  fiscalYearStartYear: number;
  overtimeMinutes: number;
  projectedMinutes: number;
  specialClauseEnabled: boolean;
}): { title: string; body: string } {
  const { fiscalYearStartYear, overtimeMinutes, projectedMinutes, specialClauseEnabled } = params;
  return {
    title: "年360時間の時間外労働を超える見込みです",
    body: `${fiscalYearStartYear}年度(4月始まり)の時間外労働の累計は現時点で${formatHoursAndMinutes(overtimeMinutes)}です。このままのペースだと年度末までに${formatHoursAndMinutes(projectedMinutes)}に達し、36協定の年360時間ラインを超える見込みです。${specialClauseNoteIfDisabled(specialClauseEnabled)}`,
  };
}

function specialMonthlyCapContent(params: { year: number; month: number; combinedMinutes: number }): { title: string; body: string } {
  const { year, month, combinedMinutes } = params;
  return {
    title: "特別条項の月100時間上限に抵触しています",
    body: `${year}年${month}月の時間外労働と休日労働の合計が${formatHoursAndMinutes(combinedMinutes)}となり、特別条項下でも許容されない「月100時間未満」の上限に達しました。`,
  };
}

function specialAverageContent(params: { year: number; month: number; worstAverageMinutes: number; windowMonths: number }): {
  title: string;
  body: string;
} {
  const { year, month, worstAverageMinutes, windowMonths } = params;
  return {
    title: "特別条項の複数月平均80時間上限に抵触しています",
    body: `${year}年${month}月を含む直近${windowMonths}ヶ月の時間外労働と休日労働の平均が${formatHoursAndMinutes(worstAverageMinutes)}となり、特別条項下の複数月平均80時間の上限を超えました。`,
  };
}

function specialAnnualContent(params: { fiscalYearStartYear: number; overtimeMinutes: number }): { title: string; body: string } {
  const { fiscalYearStartYear, overtimeMinutes } = params;
  return {
    title: "特別条項の年720時間上限に抵触しています",
    body: `${fiscalYearStartYear}年度(4月始まり)の時間外労働の累計が${formatHoursAndMinutes(overtimeMinutes)}となり、特別条項下の年720時間の上限を超えました。`,
  };
}

function specialMonthCountContent(params: { fiscalYearStartYear: number; count: number; limit: number }): { title: string; body: string } {
  const { fiscalYearStartYear, count, limit } = params;
  return {
    title: "月45時間超の特別条項適用が年6回を超えました",
    body: `${fiscalYearStartYear}年度中に月45時間を超えた月が${count}回となり、特別条項で認められる年${limit}回を超えました。`,
  };
}

/**
 * notifications へ新規作成できた場合だけ、本人の個人チャネル(resolveChannels(tenantId,
 * userId, type))へ dispatch し、CreatedOvertimeAlert を返す(重複時は null)。
 * このファイルが作る通知はすべて overtime_* — 本人宛のアラートなので、必ず resolveChannels
 * 経由で本人の個人チャネルを解決する(テナント共有 Webhook には送らない)。
 */
async function tryCreateAndDispatch(
  db: Database,
  params: { tenantId: string; userId: string; type: string; subjectDate: string; title: string; body: string; createdAt: number },
  resolveChannels: RunOvertimeAlertScanOptions["resolveChannels"],
  email: string,
): Promise<CreatedOvertimeAlert | null> {
  const notification = await createNotificationIfAbsent(db, params);
  if (notification === null) return null;
  const channels = resolveChannels ? await resolveChannels(params.tenantId, params.userId, params.type) : [];
  const dispatchResults =
    channels.length > 0 ? await dispatch(channels, { to: { email }, title: params.title, body: params.body }) : [];
  return { notification, dispatchResults };
}

/** 1人分の36協定アラート判定を行い、新規作成できた通知を created に積む。 */
async function scanUser(
  db: Database,
  user: ActiveUserRow,
  tenant: Tenant,
  agreement36: LawRules["agreement36"],
  today: LocalToday,
  nowMinutesValue: number,
  resolveChannels: RunOvertimeAlertScanOptions["resolveChannels"],
  created: CreatedOvertimeAlert[],
): Promise<void> {
  const { year, month, day } = today;

  const monthCache = new Map<string, MonthlyFigures | null>();
  const getFigures = async (y: number, m: number): Promise<MonthlyFigures | null> => {
    const key = `${y}-${m}`;
    if (!monthCache.has(key)) {
      monthCache.set(key, await monthlyFigures(db, { tenantId: user.tenantId, userId: user.id, year: y, month: m }));
    }
    return monthCache.get(key) ?? null;
  };

  const current = await getFigures(year, month);
  if (current === null) {
    // テナント設定・制度割当がまだ揃っていないユーザー/月はスキャン対象外として静かにスキップする
    return;
  }

  const monthStartDate = formatDate(year, month, 1);
  const push = async (params: { type: string; subjectDate: string; title: string; body: string }) => {
    const result = await tryCreateAndDispatch(
      db,
      { tenantId: user.tenantId, userId: user.id, ...params, createdAt: nowMinutesValue },
      resolveChannels,
      user.email,
    );
    if (result !== null) created.push(result);
  };

  // ---- 月45h(実績・見込み。v0.2から継続) ----
  const monthlyReached = current.overtimeMinutes >= agreement36.monthlyLimitMinutes;
  if (monthlyReached) {
    const { title, body } = monthlyReachedContent({
      year,
      month,
      overtimeMinutes: current.overtimeMinutes,
      specialClauseEnabled: tenant.specialClauseEnabled,
    });
    await push({ type: NOTIFICATION_TYPE_OVERTIME_45H_REACHED, subjectDate: monthStartDate, title, body });
  } else {
    const projected = projectedOvertimeForMonth(current, year, month, day);
    if (projected !== null && projected > agreement36.monthlyLimitMinutes) {
      const existingReached = await findNotificationByTypeAndDate(db, {
        tenantId: user.tenantId,
        userId: user.id,
        type: NOTIFICATION_TYPE_OVERTIME_45H_REACHED,
        subjectDate: monthStartDate,
      });
      if (existingReached === null) {
        const { title, body } = monthlyProjectedContent({
          year,
          month,
          day,
          overtimeMinutes: current.overtimeMinutes,
          projectedMinutes: projected,
          specialClauseEnabled: tenant.specialClauseEnabled,
        });
        await push({ type: NOTIFICATION_TYPE_OVERTIME_45H_PROJECTED, subjectDate: monthStartDate, title, body });
      }
    }
  }

  // ---- 年度集計(年360h・特別条項の年720h・月45h超の年6回判定で共有する) ----
  const fyStart = fiscalYearStart(year, month);
  const fyStartDate = formatDate(fyStart.year, fyStart.month, 1);
  const fyMonths = monthsFromTo(fyStart, { year, month });

  let yearToDateOvertimeMinutes = 0;
  let completedMonthsOvertimeMinutes = 0; // 当月を除く、年度内の確定済み月の合計
  let monthlyExceedCount = 0;
  for (const m of fyMonths) {
    const f = await getFigures(m.year, m.month);
    const overtimeMinutes = f?.overtimeMinutes ?? 0;
    yearToDateOvertimeMinutes += overtimeMinutes;
    if (!(m.year === year && m.month === month)) {
      completedMonthsOvertimeMinutes += overtimeMinutes;
    }
    if (overtimeMinutes >= agreement36.monthlyLimitMinutes) {
      monthlyExceedCount += 1;
    }
  }

  // ---- 年360h(実績・見込み) ----
  const annualReached = yearToDateOvertimeMinutes >= agreement36.annualLimitMinutes;
  if (annualReached) {
    const { title, body } = annualReachedContent({
      fiscalYearStartYear: fyStart.year,
      overtimeMinutes: yearToDateOvertimeMinutes,
      specialClauseEnabled: tenant.specialClauseEnabled,
    });
    await push({ type: NOTIFICATION_TYPE_ANNUAL_REACHED, subjectDate: fyStartDate, title, body });
  } else {
    const currentMonthProjected = projectedOvertimeForMonth(current, year, month, day);
    if (currentMonthProjected !== null) {
      const projectedAnnualMinutes = completedMonthsOvertimeMinutes + currentMonthProjected;
      if (projectedAnnualMinutes > agreement36.annualLimitMinutes) {
        const existingReached = await findNotificationByTypeAndDate(db, {
          tenantId: user.tenantId,
          userId: user.id,
          type: NOTIFICATION_TYPE_ANNUAL_REACHED,
          subjectDate: fyStartDate,
        });
        if (existingReached === null) {
          const { title, body } = annualProjectedContent({
            fiscalYearStartYear: fyStart.year,
            overtimeMinutes: yearToDateOvertimeMinutes,
            projectedMinutes: projectedAnnualMinutes,
            specialClauseEnabled: tenant.specialClauseEnabled,
          });
          await push({ type: NOTIFICATION_TYPE_ANNUAL_PROJECTED, subjectDate: fyStartDate, title, body });
        }
      }
    }
  }

  if (!tenant.specialClauseEnabled) {
    // 特別条項未締結のテナントは、以下4種(特別条項固有の上限)を評価する意味がない
    // (そもそも月45h/年360hを超えられない)。
    return;
  }

  // ---- 特別条項: 月100時間未満(時間外+休日労働の合計) ----
  const combinedCurrentMinutes = current.overtimeMinutes + current.holidayMinutes;
  if (combinedCurrentMinutes >= agreement36.specialMonthlyCapMinutes) {
    const { title, body } = specialMonthlyCapContent({ year, month, combinedMinutes: combinedCurrentMinutes });
    await push({ type: NOTIFICATION_TYPE_SPECIAL_MONTHLY_CAP, subjectDate: monthStartDate, title, body });
  }

  // ---- 特別条項: 複数月平均80時間(直近2〜6ヶ月、時間外+休日労働の合計) ----
  let worstAverageMinutes = 0;
  let worstWindowMonths = 0;
  for (let k = AVERAGE_WINDOW_MIN_MONTHS; k <= AVERAGE_WINDOW_MAX_MONTHS; k++) {
    const windowMonths = lastKMonths({ year, month }, k);
    let sum = 0;
    for (const wm of windowMonths) {
      const f = await getFigures(wm.year, wm.month);
      sum += (f?.overtimeMinutes ?? 0) + (f?.holidayMinutes ?? 0);
    }
    const average = sum / k;
    if (average > worstAverageMinutes) {
      worstAverageMinutes = average;
      worstWindowMonths = k;
    }
  }
  if (worstAverageMinutes > agreement36.specialMultiMonthAverageMinutes) {
    const { title, body } = specialAverageContent({ year, month, worstAverageMinutes, windowMonths: worstWindowMonths });
    await push({ type: NOTIFICATION_TYPE_SPECIAL_AVERAGE, subjectDate: monthStartDate, title, body });
  }

  // ---- 特別条項: 年720時間(時間外のみ、年360hと同じ年度集計を再利用) ----
  if (yearToDateOvertimeMinutes >= agreement36.specialAnnualLimitMinutes) {
    const { title, body } = specialAnnualContent({ fiscalYearStartYear: fyStart.year, overtimeMinutes: yearToDateOvertimeMinutes });
    await push({ type: NOTIFICATION_TYPE_SPECIAL_ANNUAL, subjectDate: fyStartDate, title, body });
  }

  // ---- 特別条項: 月45時間超は年6回まで ----
  if (monthlyExceedCount > agreement36.specialMonthlyExceedCountLimit) {
    const { title, body } = specialMonthCountContent({
      fiscalYearStartYear: fyStart.year,
      count: monthlyExceedCount,
      limit: agreement36.specialMonthlyExceedCountLimit,
    });
    await push({ type: NOTIFICATION_TYPE_SPECIAL_MONTH_COUNT, subjectDate: fyStartDate, title, body });
  }
}

/**
 * 36協定アラート(完全版)の定期スキャンを1回実行する。
 *
 * 全テナントの is_active なユーザーについて、当月時点で評価可能な36協定の各閾値
 * (月45h・年360h・特別条項有効時は月100h未満・複数月平均80h・年720h・月45h超年6回まで)を
 * `@kizami/law` の `agreement36`(テナントの法令プロファイルで解決)から取得して判定する。
 * createNotificationIfAbsent で通知を作成する(重複は UNIQUE 制約で自動的にスキップされる、冪等)。
 *
 * BullMQ/Valkey などスケジューラの実体には一切依存しない。
 */
export async function runOvertimeAlertScan(
  db: Database,
  options: RunOvertimeAlertScanOptions,
): Promise<RunOvertimeAlertScanResult> {
  const { nowMinutes: nowMinutesValue, resolveChannels } = options;
  const today = resolveLocalToday(nowMinutesValue);
  const activeUsers = await listActiveUsers(db);

  const created: CreatedOvertimeAlert[] = [];
  const tenantCache = new Map<string, Tenant | null>();

  for (const user of activeUsers) {
    try {
      let tenant = tenantCache.get(user.tenantId);
      if (tenant === undefined) {
        tenant = await getTenantById(db, user.tenantId);
        tenantCache.set(user.tenantId, tenant);
      }
      if (tenant === null) {
        // データ不整合(ユーザーは存在するがテナント行がない)。想定外なので静かにスキップする。
        continue;
      }

      const lawRules = resolveLawRules(formatDate(today.year, today.month, 1), {
        isSmallOrMediumEnterprise: tenant.isSmallOrMediumEnterprise,
        isSpecialProvisionWorkplace: tenant.isSpecialProvisionWorkplace,
      });

      await scanUser(db, user, tenant, lawRules.agreement36, today, nowMinutesValue, resolveChannels, created);
    } catch {
      // ユーザー単位の予期しない失敗(DB エラー等)で他のユーザーの処理を止めない
      // (reminders.ts と同じ方針)
      continue;
    }
  }

  return { scannedUserCount: activeUsers.length, created };
}
