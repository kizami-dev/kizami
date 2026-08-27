/**
 * work_policies / work_policy_versions(労働時間制の設定。フレックスタイム制/固定時間制。
 * effective-dated, 追記専用)に対する最小限のクエリ層。
 *
 * v0.1〜v0.2 のアプリは「テナント1つにつき work_policy 1件」で運用する(seed.ts が常に1件だけ
 * 作成し、複数の制度を切り替えるUIは無い)。このファイルもその前提に立ち、
 * `getOrCreateTenantWorkPolicy` で「無ければ作る」形にして、seed を経由していないテナント
 * (テスト DB 等)でも GET/POST /settings/work-policy が動く形にしている(判断点)。
 */

import { and, asc, eq, lte } from "drizzle-orm";
import type { Database, Transaction } from "../types.js";
import { userPolicyAssignments, workPolicies, workPolicyVersions } from "../schema/index.js";
import { uuidv7 } from "../uuid.js";

export type WorkPolicy = typeof workPolicies.$inferSelect;
export type WorkPolicyVersion = typeof workPolicyVersions.$inferSelect;

/** テナントの work_policy を1件返す(複数ある場合は createdAt が最も古いもの)。無ければ null。 */
export async function getTenantWorkPolicy(db: Database | Transaction, tenantId: string): Promise<WorkPolicy | null> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId)).orderBy(asc(workPolicies.createdAt)).limit(1);
  return rows[0] ?? null;
}

export interface GetOrCreateTenantWorkPolicyParams {
  tenantId: string;
  /** 新規作成時のみ使う名前 */
  name: string;
  /** 新規作成時のみ使う UTC エポック分 */
  createdAt: number;
}

/** テナントの work_policy を返す。無ければ新規作成する(通常運用では seed 済みで既に存在する)。 */
export async function getOrCreateTenantWorkPolicy(db: Database | Transaction, params: GetOrCreateTenantWorkPolicyParams): Promise<WorkPolicy> {
  const existing = await getTenantWorkPolicy(db, params.tenantId);
  if (existing) return existing;
  const [row] = await db
    .insert(workPolicies)
    .values({ id: uuidv7(), tenantId: params.tenantId, name: params.name, createdAt: params.createdAt })
    .returning();
  if (!row) {
    throw new Error("getOrCreateTenantWorkPolicy: insert returned no row");
  }
  return row;
}

/** work_policy の全版を effective_from 昇順で返す(版の履歴表示用)。 */
export async function listWorkPolicyVersions(
  db: Database | Transaction,
  params: { tenantId: string; workPolicyId: string },
): Promise<WorkPolicyVersion[]> {
  return db
    .select()
    .from(workPolicyVersions)
    .where(and(eq(workPolicyVersions.tenantId, params.tenantId), eq(workPolicyVersions.workPolicyId, params.workPolicyId)))
    .orderBy(asc(workPolicyVersions.effectiveFrom));
}

export interface InsertWorkPolicyVersionParams {
  tenantId: string;
  workPolicyId: string;
  /** ローカル日付 "YYYY-MM-DD"。この日から有効 */
  effectiveFrom: string;
  /** 労働時間制の種別: "flex"(フレックスタイム制) | "fixed"(固定時間制)。呼び出し側が明示する */
  kind: string;
  /** 清算期間。flex 専用("monthly" 固定)。kind = "fixed" のときは無視される */
  settlementPeriod: string;
  /**
   * コアタイム(labor law §32-3)。flex 専用。engine の `CoreTime` を JSON 文字列にしたもの
   * (`{"startMinutes":600,"endMinutes":900}`)。省略・null なら「コアタイムなし」。
   * 値の妥当性(0〜1440、start < end)の検証は呼び出し側(apps/api)の責務
   * — このクエリ層は effectiveFrom の過去日禁止・重複禁止と同じく検証を持たない。
   */
  core?: string | null;
  standardDayMinutes: number;
  /** UTC エポック分 */
  createdAt: number;
}

/**
 * 新しい版を1件追記する(UPDATE ではない)。過去日禁止・重複禁止のバリデーションは
 * 呼び出し側(apps/api/src/routes/settings.ts)が行う。
 */
export async function insertWorkPolicyVersion(db: Database | Transaction, params: InsertWorkPolicyVersionParams): Promise<WorkPolicyVersion> {
  const [row] = await db
    .insert(workPolicyVersions)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      workPolicyId: params.workPolicyId,
      effectiveFrom: params.effectiveFrom,
      kind: params.kind,
      settlementPeriod: params.settlementPeriod,
      core: params.core ?? null,
      standardDayMinutes: params.standardDayMinutes,
      createdAt: params.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertWorkPolicyVersion: insert returned no row");
  }
  return row;
}

export interface GetOrCreateTenantWorkPolicyByKindParams {
  tenantId: string;
  /** 労働時間制の種別: "flex" | "fixed"。呼び出し側が検証済みの値を渡すこと */
  kind: string;
  /** 新規作成時のみ使う work_policies.name */
  name: string;
  /** UTC エポック分。新規作成時のみ使う */
  createdAt: number;
  /** 新規作成時のみ使う初版のパラメータ */
  defaultVersion: {
    /** flex 専用の値。kind = "fixed" のときはプレースホルダを渡すこと(呼び出し側の責務) */
    settlementPeriod: string;
    standardDayMinutes: number;
  };
}

/**
 * テナントの work_policy を「kind(制度種別)」で検索し、無ければ新規作成する
 * (メンバー個別の労働時間制割当、2026-08-23 追加)。
 *
 * `getOrCreateTenantWorkPolicy`(上記、名前ベース)との関係: v0.1〜v0.2 は「テナントに
 * ポリシー CRUD UI を持たせない」方針のため、個別割当も専用 UI を新設せず「kind ごとに
 * 高々1本の共有ポリシーを get-or-create し、割当は kind の選択として表現する」設計にした
 * (docs 上の判断点)。名前ベースの既存関数は GET/POST /settings/work-policy 専用のまま残し
 * (そちらは「テナントに work_policy が1件」という前提を崩さない)、本関数はそれとは別に
 * 「kind ごとに1件」という新しい前提を持つ。両者が同じ work_policies 行を指す運用も起こり
 * うる(例: flex は既存の "標準" ポリシーの最新版がたまたま flex ならそのまま再利用される)。
 * これは意図的な仕様であり、"標準" ポリシーの kind を GET/POST /settings/work-policy 側で
 * 後から切り替えると、本関数経由で flex 割当されたユーザーにも影響する
 * (work_policy_versions.kind は版であり、ポリシーIDに紐づく全ユーザー共通のため)。
 *
 * 「どの work_policy が指定 kind に対応するか」の判定は、work_policy ごとの**最新版**
 * (`effectiveFrom` が最大の行)の kind で行う(現在の実効値ではなく最新版 — 将来日の版が
 * 既にあればそれを指すのが自然なため。買い切り関数なので日付境界の解決は不要)。
 *
 * 無ければ work_policies 行 + 初版(work_policy_versions、`effectiveFrom = "1970-01-01"` の
 * 起点版)を作る。`getOrCreateTenantWorkPolicy` と異なり初版までこの関数が作る理由:
 * 呼び出し側(POST /members/:id/work-policy)は「割当は必ずどこかの日付から有効」を前提に
 * 即座に `assignUserWorkPolicy` を呼ぶため、版が無いまま返すと `buildSettingsTimeline` が
 * 解決不能で例外になる(既存の `getOrCreateTenantWorkPolicy` はその後に呼び出し側が明示的に
 * `insertWorkPolicyVersion` を呼ぶ前提の薄い get-or-create だが、本関数は「割当可能な状態」まで
 * 一括で保証する)。起点日を "1970-01-01" にするのは、既存のシード・テストが使う起点日と同じ
 * 規約に合わせるため(どんな過去日の照会が来ても必ず解決できる)。
 */
export async function getOrCreateTenantWorkPolicyByKind(
  db: Database | Transaction,
  params: GetOrCreateTenantWorkPolicyByKindParams,
): Promise<WorkPolicy> {
  // work_policy_versions を全件取得し、work_policy_id ごとの最新版(effectiveFrom 最大)の kind を
  // 求める。テナントあたりのポリシー数は極小(v0.1〜v0.2 は kind ごとに高々1本の前提)なので、
  // ポリシーごとに個別クエリを投げるより1回の全件取得+アプリ側解決の方が単純かつ十分速い。
  const allVersions = await db
    .select({ workPolicyId: workPolicyVersions.workPolicyId, effectiveFrom: workPolicyVersions.effectiveFrom, kind: workPolicyVersions.kind })
    .from(workPolicyVersions)
    .where(eq(workPolicyVersions.tenantId, params.tenantId))
    .orderBy(asc(workPolicyVersions.effectiveFrom));

  const latestKindByPolicy = new Map<string, string>();
  for (const v of allVersions) {
    // asc 順で辿って毎回上書きするので、ループが終わった時点で残るのは各 policy の最新版の kind。
    latestKindByPolicy.set(v.workPolicyId, v.kind);
  }

  const matchedPolicyId = [...latestKindByPolicy.entries()].find(([, kind]) => kind === params.kind)?.[0];
  if (matchedPolicyId !== undefined) {
    const rows = await db
      .select()
      .from(workPolicies)
      .where(and(eq(workPolicies.tenantId, params.tenantId), eq(workPolicies.id, matchedPolicyId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      // work_policy_versions にあるのに work_policies 行が無い状態は通常起こり得ない不整合。
      throw new Error(`getOrCreateTenantWorkPolicyByKind: work_policy ${matchedPolicyId} not found`);
    }
    return row;
  }

  const [policyRow] = await db
    .insert(workPolicies)
    .values({ id: uuidv7(), tenantId: params.tenantId, name: params.name, createdAt: params.createdAt })
    .returning();
  if (!policyRow) {
    throw new Error("getOrCreateTenantWorkPolicyByKind: policy insert returned no row");
  }
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    workPolicyId: policyRow.id,
    effectiveFrom: "1970-01-01",
    kind: params.kind,
    settlementPeriod: params.defaultVersion.settlementPeriod,
    core: null,
    standardDayMinutes: params.defaultVersion.standardDayMinutes,
    createdAt: params.createdAt,
  });
  return policyRow;
}

export interface AssignUserWorkPolicyParams {
  tenantId: string;
  userId: string;
  workPolicyId: string;
  /** ローカル日付 "YYYY-MM-DD"。この日から適用 */
  effectiveFrom: string;
  createdAt: number;
}

/**
 * user × work_policy の適用開始日を追記する(effective-dated、追記専用)。
 *
 * 2026-08-23 追加: 招待式メンバー作成(apps/api/src/routes/members.ts POST /)が
 * テナント既定の work policy を自動割当するために使う。これが無いと、招待で作られた
 * メンバーは制度未割当のまま(buildSettingsTimeline が解決できず有給・月次が 500)になる —
 * 従来はシードスクリプトが直接 insert しており、製品経路に割当手段が存在しなかった。
 */
export async function assignUserWorkPolicy(
  db: Database | Transaction,
  params: AssignUserWorkPolicyParams,
): Promise<void> {
  await db.insert(userPolicyAssignments).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    userId: params.userId,
    workPolicyId: params.workPolicyId,
    effectiveFrom: params.effectiveFrom,
    createdAt: params.createdAt,
  });
}

export interface UserPolicyAssignmentHistoryRow {
  /** ローカル日付 "YYYY-MM-DD"。この日からこの work_policy が適用される */
  effectiveFrom: string;
  workPolicyId: string;
  workPolicyName: string;
  /**
   * この割当の effectiveFrom 時点で有効だった work_policy_versions の kind ("flex" | "fixed")。
   * ポリシー自体は複数版を持ち得(GET/POST /settings/work-policy が kind を含め切り替え可能)、
   * 「今の最新版の kind」をそのまま出すと、後から他画面でポリシーの kind が変わった場合に
   * 過去の割当が実際とは異なる制度として表示されてしまう。そのため割当ごとに、その
   * effectiveFrom 時点で有効だった版を解決して kind を出す(buildSettingsTimeline と同じ
   * 「日付以下で最大の effectiveFrom」の解決規則)。解決できない(通常起こり得ない不整合)場合は
   * null にする — 履歴表示専用のクエリで例外を投げて画面全体を壊すより安全側に倒す判断。
   */
  kind: string | null;
  standardDayMinutes: number | null;
  createdAt: number;
}

/** rows の中から effectiveFrom <= date かつ workPolicyId 一致の最新行を返す(無ければ null)。 */
function latestVersionAtOrBefore(
  versions: { workPolicyId: string; effectiveFrom: string; kind: string; standardDayMinutes: number }[],
  workPolicyId: string,
  date: string,
): { kind: string; standardDayMinutes: number } | null {
  let chosen: { effectiveFrom: string; kind: string; standardDayMinutes: number } | null = null;
  for (const v of versions) {
    if (v.workPolicyId !== workPolicyId || v.effectiveFrom > date) continue;
    if (chosen === null || v.effectiveFrom > chosen.effectiveFrom) chosen = v;
  }
  return chosen ? { kind: chosen.kind, standardDayMinutes: chosen.standardDayMinutes } : null;
}

/**
 * 指定ユーザーの work_policy 割当履歴を、ポリシー名・その時点の kind・standardDayMinutes 込みで
 * effectiveFrom 昇順に返す(メンバー個別の労働時間制割当、2026-08-23 追加、
 * GET /members/:id/work-policy の履歴表示用)。
 *
 * assignments と versions をそれぞれ1回ずつ取得し(N+1 回避)、アプリ側で
 * `latestVersionAtOrBefore` により各割当の kind/standardDayMinutes を解決する
 * (1ユーザー分の履歴表示なので件数は小さく、per-assignment のループで十分)。
 */
export async function listUserPolicyAssignments(
  db: Database | Transaction,
  params: { tenantId: string; userId: string },
): Promise<UserPolicyAssignmentHistoryRow[]> {
  const assignments = await db
    .select({
      effectiveFrom: userPolicyAssignments.effectiveFrom,
      workPolicyId: userPolicyAssignments.workPolicyId,
      workPolicyName: workPolicies.name,
      createdAt: userPolicyAssignments.createdAt,
    })
    .from(userPolicyAssignments)
    .innerJoin(workPolicies, eq(userPolicyAssignments.workPolicyId, workPolicies.id))
    .where(and(eq(userPolicyAssignments.tenantId, params.tenantId), eq(userPolicyAssignments.userId, params.userId)))
    .orderBy(asc(userPolicyAssignments.effectiveFrom));

  if (assignments.length === 0) return [];

  const versions = await db
    .select({
      workPolicyId: workPolicyVersions.workPolicyId,
      effectiveFrom: workPolicyVersions.effectiveFrom,
      kind: workPolicyVersions.kind,
      standardDayMinutes: workPolicyVersions.standardDayMinutes,
    })
    .from(workPolicyVersions)
    .where(eq(workPolicyVersions.tenantId, params.tenantId))
    .orderBy(asc(workPolicyVersions.effectiveFrom));

  return assignments.map((a) => {
    const resolved = latestVersionAtOrBefore(versions, a.workPolicyId, a.effectiveFrom);
    return {
      effectiveFrom: a.effectiveFrom,
      workPolicyId: a.workPolicyId,
      workPolicyName: a.workPolicyName,
      kind: resolved?.kind ?? null,
      standardDayMinutes: resolved?.standardDayMinutes ?? null,
      createdAt: a.createdAt,
    };
  });
}

/**
 * テナント内の全ユーザーについて、指定日(通常は "今日")時点で実効の work_policy_versions.kind を
 * 一括解決して返す(メンバー個別の労働時間制割当、2026-08-23 追加。GET /members 一覧の
 * UI バッジ用)。
 *
 * user_policy_assignments・work_policy_versions をそれぞれテナント全体で1回ずつ取得し
 * (2クエリ、ユーザー数に比例しない)、アプリ側で「asOfDate 以下で最大の effectiveFrom」を
 * ユーザーごと・ポリシーごとに解決する(`listUserPolicyAssignments` と同じ解決規則だが、
 * こちらは「テナント全体・特定1日」に特化した形にすることで SQL の絞り込み(`lte`)を効かせ、
 * 履歴全件を持ち回らずに済むようにしている — 依頼の「1クエリで解決、N+1にしない」への対応)。
 *
 * 割当は存在するが解決不能(通常起こり得ない不整合)なユーザーの kind は null になる
 * (`listUserPolicyAssignments` と同じ安全側フォールバック)。割当自体が無いユーザーは
 * 戻り値の Map に含まれない(呼び出し側は `.get(userId) ?? null` で扱うこと)。
 */
export async function listCurrentWorkPolicyKindsForTenant(
  db: Database | Transaction,
  params: { tenantId: string; asOfDate: string },
): Promise<Map<string, string | null>> {
  const assignments = await db
    .select({
      userId: userPolicyAssignments.userId,
      workPolicyId: userPolicyAssignments.workPolicyId,
      effectiveFrom: userPolicyAssignments.effectiveFrom,
    })
    .from(userPolicyAssignments)
    .where(and(eq(userPolicyAssignments.tenantId, params.tenantId), lte(userPolicyAssignments.effectiveFrom, params.asOfDate)))
    .orderBy(asc(userPolicyAssignments.effectiveFrom));

  // asc 順で辿って毎回上書きするので、ループが終わった時点で残るのは各ユーザーの
  // asOfDate 時点で最新の割当。
  const latestAssignmentByUser = new Map<string, { workPolicyId: string }>();
  for (const a of assignments) {
    latestAssignmentByUser.set(a.userId, { workPolicyId: a.workPolicyId });
  }

  const versions = await db
    .select({ workPolicyId: workPolicyVersions.workPolicyId, effectiveFrom: workPolicyVersions.effectiveFrom, kind: workPolicyVersions.kind })
    .from(workPolicyVersions)
    .where(and(eq(workPolicyVersions.tenantId, params.tenantId), lte(workPolicyVersions.effectiveFrom, params.asOfDate)))
    .orderBy(asc(workPolicyVersions.effectiveFrom));

  const latestVersionKindByPolicy = new Map<string, string>();
  for (const v of versions) {
    latestVersionKindByPolicy.set(v.workPolicyId, v.kind);
  }

  const result = new Map<string, string | null>();
  for (const [userId, assignment] of latestAssignmentByUser) {
    result.set(userId, latestVersionKindByPolicy.get(assignment.workPolicyId) ?? null);
  }
  return result;
}
