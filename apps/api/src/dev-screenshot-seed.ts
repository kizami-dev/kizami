/**
 * スクリーンショット撮影用の追加シード(`scripts/screenshots/` からのみ呼ばれる)。
 *
 * `pnpm seed`(seed.ts)がテナント・管理者ユーザー・標準プリセット・標準フレックスまでを
 * 作った後に実行する前提。ここでは HTTP API 経由では作れないもの、具体的には:
 *
 * 1. 追加のデモユーザー(マネージャー・メンバー2名) — /members に招待APIが無いため
 *    users/auth_credentials/user_policy_assignments へ直接 INSERT する(seed.ts と同じ手順)
 * 2. アプリ内通知(打刻忘れ・有給失効間近・年5日義務) — 通知は reminders/leave-alerts/
 *    overtime-alerts の定期スキャン(BullMQ ワーカー経由)でしか作られず、HTTPでもCLIでも
 *    トリガーする手段が無いため、notifications テーブルへ直接 INSERT する
 *    (本文は各スキャンの実装(reminders.ts / leave-alerts.ts)の文言をそのまま踏襲する)
 * 3. 有給付与の「予告」(leave_grant_proposals) — 日次ワーカー
 *    (apps/api/src/leave-grant-proposals.ts)でしか作られず、HTTPでもCLIでもトリガーできないため
 *    直接 INSERT する(v0.7 フェーズ4、2026-08-24 追加)
 *
 * apps/api の既存機能(routes/*.ts 等)は一切変更しない。DATABASE_URL 以外の入力は
 * すべてこのファイル内の定数(スクリーンショット専用の固定デモデータ)。
 *
 * 標準出力に `{ users: [...] }`(作成した追加ユーザーの id/email)を JSON で1行出力する。
 */

import { eq } from "drizzle-orm";
import {
  authCredentials,
  departments as departmentsTable,
  leaveGrantProposals,
  memberships,
  notifications,
  allowanceDefinitions,
  allowanceDefinitionVersions,
  tenantSettingVersions,
  tenants,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  workPolicyVersions,
  type Database,
  migrateDb,
} from "@kizami/db";
import { hashPassword } from "./auth/password.js";

const MINUTES_PER_DAY = 1440;
const TZ_OFFSET_MINUTES_JST = 9 * 60;

function jstToday(): { y: number; m: number; d: number } {
  const localMinutes = Math.floor(Date.now() / 60_000) + TZ_OFFSET_MINUTES_JST;
  const epochDay = Math.floor(localMinutes / MINUTES_PER_DAY);
  const dt = new Date(epochDay * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * scripts/screenshots/time.ts の weekdaysBeforeTodayInCurrentMonth() と同じロジックを
 * 複製する(このファイルは apps/api 側にあり、リポジトリルートの scripts/ を import しない
 * 方針のため)。scripts/screenshots/seed-http.ts が missingClockOutDate を選ぶときと
 * 同じ「今月・今日より前の平日プールの末尾から2番目」を選び、この通知の subjectDate を
 * 実際に打刻忘れとして作られる日付と一致させる。変更する場合は両方を揃えること。
 */
function missingClockOutDemoDate(today: { y: number; m: number; d: number }): { y: number; m: number; d: number } {
  const pool: Array<{ y: number; m: number; d: number }> = [];
  for (let d = 1; d < today.d; d++) {
    const date = { y: today.y, m: today.m, d };
    const weekday = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) pool.push(date);
  }
  // seed-http.ts: recentDay = pool.pop(); missingClockOutDate = pool.pop() ?? recentDay;
  const recentDay = pool.pop();
  return pool.pop() ?? recentDay ?? today;
}

function addDays(base: { y: number; m: number; d: number }, delta: number): { y: number; m: number; d: number } {
  const epochDay = Math.floor(Date.UTC(base.y, base.m - 1, base.d) / 86_400_000) + delta;
  const dt = new Date(epochDay * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function fmt(date: { y: number; m: number; d: number }): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

interface DemoUserSpec {
  key: string;
  name: string;
  email: string;
  hireDate: string;
  department: "hq" | "sales" | "dev";
  /**
   * true の場合、テナント既定のフレックス work_policies ではなく params.fixedWorkPolicyId
   * (v0.5 固定時間制デモ用に別途作成する work_policies 行)を割り当てる。
   * user_policy_assignments は user 単位のため、この1人だけをテナント全体を変えずに
   * 固定時間制へ切り替えられる(依頼の判断点どおり)。
   */
  useFixedPolicy?: boolean;
  /**
   * true の場合、params.variableWorkPolicyId(v0.7 シフト制デモ用に別途作成する
   * work_policies 行、kind: "monthly_variable")を割り当てる。useFixedPolicy と同じ理由・
   * 同じ仕組み(user_policy_assignments は user 単位)。effectiveFrom は他のデモユーザーと同じ
   * "1970-01-01" にする — 暦月の初日から monthly_variable が効いていないと、月次の
   * workSystem 判定(月初日時点の版で月全体を判定する)が "flex" のままになってしまうため
   * (2026-08-24、シフトUIのE2E検証で判明した制約。HTTP の POST /members/:id/work-policy は
   * 当日以降の effectiveFrom しか受け付けないため、直接 INSERT する以外に選択肢が無い)。
   */
  useVariablePolicy?: boolean;
}

const DEMO_USERS: DemoUserSpec[] = [
  { key: "manager", name: "佐藤 直人", email: "manager@kizami.example", hireDate: "2021-04-01", department: "sales" },
  { key: "member1", name: "鈴木 愛", email: "member1@kizami.example", hireDate: "2023-07-01", department: "sales" },
  {
    key: "member2",
    name: "田中 拓海",
    email: "member2@kizami.example",
    hireDate: "2024-10-01",
    department: "dev",
    useFixedPolicy: true,
  },
  {
    key: "member3",
    name: "高橋 陽菜",
    email: "member3@kizami.example",
    hireDate: "2025-04-01",
    department: "sales",
    useVariablePolicy: true,
  },
];

const DEMO_PASSWORD = "kizami-demo-pass";

async function findWorkPolicyId(db: Database, tenantId: string): Promise<string> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("no work_policies row found for tenant (run `pnpm seed` first)");
  return row.id;
}

/**
 * v0.5 固定時間制デモ用の work_policies を新規作成する(テナント既定の「標準」フレックス
 * policy とは別行)。POST /settings/work-policy はテナントに1つしかない既定 policy
 * (getOrCreateTenantWorkPolicy)しか操作できず、ユーザー単位で別制度を割り当てる手段が
 * HTTP には無い(仕組みの確認結果)。そのためここでは packages/db のテーブルへ直接
 * INSERT する(apps/api の既存機能は変更していない — このファイル自体がその例外)。
 *
 * 所定労働時間は 7 時間(420分)にする: 8時間(法定)ちょうどの日を挟むだけでは
 * 「法定内残業」(所定超〜法定内)が絶対に出せない(所定=法定だと隙間が無い)ため、
 * 所定を法定より短くしておかないとデモしたい2つの表示(時間外/法定内残業の併記)を
 * 両方見せられない。
 */
async function createFixedWorkPolicy(db: Database, tenantId: string): Promise<string> {
  // 冪等(dev-screenshot-seed.ts の他の関数と同じ流儀): 同名の policy が既にあれば作り直さない。
  const existingRows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId));
  const existing = existingRows.find((p) => p.name === "固定時間制(デモ)");
  if (existing) return existing.id;

  const now = Math.floor(Date.now() / 60_000);
  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId, name: "固定時間制(デモ)", createdAt: now });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    kind: "fixed",
    settlementPeriod: "monthly", // fixed では無視される placeholder(packages/db/src/schema/settings.ts のコメント参照)
    core: null,
    standardDayMinutes: 420,
    createdAt: now,
  });
  return workPolicyId;
}

/**
 * v0.7 シフト制(monthly_variable)デモ用の work_policies を新規作成する
 * (createFixedWorkPolicy と同じ理由・同じ仕組み)。standardDayMinutes は monthly_variable では
 * 無意味な placeholder(apps/api/src/routes/settings/work-policy.ts のコメント参照)なので 0 にする。
 */
async function createVariableWorkPolicy(db: Database, tenantId: string): Promise<string> {
  const existingRows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId));
  const existing = existingRows.find((p) => p.name === "変形労働時間制(デモ)");
  if (existing) return existing.id;

  const now = Math.floor(Date.now() / 60_000);
  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId, name: "変形労働時間制(デモ)", createdAt: now });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    kind: "monthly_variable",
    settlementPeriod: "monthly", // monthly_variable では無視される placeholder
    core: null,
    standardDayMinutes: 0,
    createdAt: now,
  });
  return workPolicyId;
}

/**
 * 休憩ルールを "both"(併用)にするテナント設定版を、既存の初回版(pnpm seed が入れる
 * effectiveFrom "1970-01-01" / breakRule "punch")の直後から効かせる。
 *
 * POST /settings/attendance は effectiveFrom が今日より前だと 409 を返すため、HTTP 経由では
 * 過去日(先月締め・今月の既存デモ打刻日)に "both" を遡って効かせられない。ここで直接
 * INSERT することで、先月の集計(締め処理はこの後 seed-http.ts が実行)や今月の既存デモ日
 * すべてに "both" ルールが効いた状態で計算させる。dayBoundaryMinutes・legalHolidayRule・
 * gpsEnabled 等は初回版から変更しない(日界を動かすと打刻画面の「勤務中」表示が崩れる —
 * scripts/screenshots/seed-http.ts の同種コメント参照)。breakRule だけを変える。
 *
 * effectiveFrom は "1970-01-02"(初回版の翌日)にする。初回版と同日にすると
 * `latestAtOrBefore` の tie-break(effectiveFrom が同じ行は先に見つかった方が勝つ、
 * apps/api/src/lib/settings.ts)が配列の走査順に依存し不安定になるため、確実に
 * 上書きされる別日にする。
 */
/**
 * 手当定義を過去日から有効な形で直接投入する(v0.5 デモ用)。
 * HTTP の POST /settings/allowances は effectiveFrom の過去日を 409 で拒むため、
 * 締め済みの前月の集計・スナップショットに手当を反映させるには直接投入するしかない
 * (insertBothModeBreakRuleVersion と同じ理由)。夜間手当(22:00〜翌5:00)は
 * 前月・今月の深夜勤務日(13:00-23:00)に 1:00 の手当対象時間を生む。
 */
async function insertNightAllowanceDefinition(db: Database, tenantId: string): Promise<void> {
  const existing = await db.select().from(allowanceDefinitions).where(eq(allowanceDefinitions.tenantId, tenantId));
  if (existing.length > 0) return; // 冪等

  const now = Math.floor(Date.now() / 60_000);
  const definitionId = uuidv7();
  await db.insert(allowanceDefinitions).values({ id: definitionId, tenantId, createdAt: now });
  await db.insert(allowanceDefinitionVersions).values({
    id: uuidv7(),
    tenantId,
    definitionId,
    effectiveFrom: "1970-01-02",
    name: "夜間手当",
    conditions: JSON.stringify({ timeBand: { startMinutes: 22 * 60, endMinutes: 5 * 60 } }),
    createdAt: now,
  });
}

async function insertBothModeBreakRuleVersion(db: Database, tenantId: string): Promise<void> {
  // 冪等: この日付の版が既にあれば何もしない(重複挿入すると latestAtOrBefore の
  // tie-break が不安定になる、この関数自体のコメント参照)。
  const existingRows = await db.select().from(tenantSettingVersions).where(eq(tenantSettingVersions.tenantId, tenantId));
  if (existingRows.some((v) => v.effectiveFrom === "1970-01-02")) return;

  const now = Math.floor(Date.now() / 60_000);
  await db.insert(tenantSettingVersions).values({
    id: uuidv7(),
    tenantId,
    effectiveFrom: "1970-01-02",
    dayBoundaryMinutes: 0,
    legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
    breakRule: JSON.stringify({
      mode: "both",
      rules: [
        { overMinutes: 360, deductMinutes: 45 },
        { overMinutes: 480, deductMinutes: 60 },
      ],
    }),
    gpsEnabled: false,
    gpsRetentionDays: null,
    weekStartWeekday: 0,
    createdAt: now,
  });
}

async function insertDemoUsers(
  db: Database,
  params: {
    tenantId: string;
    workPolicyId: string;
    fixedWorkPolicyId: string;
    variableWorkPolicyId: string;
    departmentIdByKey: Record<"hq" | "sales" | "dev", string>;
  },
): Promise<Array<{ key: string; id: string; email: string }>> {
  const now = Math.floor(Date.now() / 60_000);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const created: Array<{ key: string; id: string; email: string }> = [];

  for (const spec of DEMO_USERS) {
    const existing = await db.select().from(users).where(eq(users.email, spec.email)).limit(1);
    if (existing[0]) {
      created.push({ key: spec.key, id: existing[0].id, email: spec.email });
      continue;
    }

    const userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      tenantId: params.tenantId,
      email: spec.email,
      name: spec.name,
      isActive: true,
      hireDate: spec.hireDate,
      createdAt: now,
    });
    await db.insert(authCredentials).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      userId,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(userPolicyAssignments).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      userId,
      workPolicyId: spec.useFixedPolicy
        ? params.fixedWorkPolicyId
        : spec.useVariablePolicy
          ? params.variableWorkPolicyId
          : params.workPolicyId,
      effectiveFrom: "1970-01-01",
      createdAt: now,
    });
    await db.insert(memberships).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      userId,
      departmentId: params.departmentIdByKey[spec.department],
      createdAt: now,
    });

    created.push({ key: spec.key, id: userId, email: spec.email });
  }

  return created;
}

/**
 * 有給付与の「予告」(leave_grant_proposals)を投入する(v0.7 フェーズ4、2026-08-24 追加)。
 *
 * 予告行は日次ワーカー(apps/api/src/leave-grant-proposals.ts)が作るもので、HTTP でも CLI でも
 * 手動でトリガーする手段が無い(notifications と同じ事情)。/settings/leave の「付与の予告」
 * セクションをスクリーンショットに写すため、ここでテーブルへ直接 INSERT する。
 *
 * 2件入れる:
 * 1. シフト制のデモメンバー(member3)— basis "shift" で「シフト基準」ラベルを見せる
 * 2. もう1人 — basis "calendar_estimate" かつ出勤率8割未満で、注意チップも一緒に見せる
 *
 * 決裁(承認/却下)は行わないので status は "proposed" のまま。テナントは管理者と同じなので、
 * デモ管理者のスコープ(department_and_descendants)で必ず見える。
 */
async function insertLeaveGrantProposals(
  db: Database,
  params: { tenantId: string; shiftUserId: string; calendarUserId: string },
): Promise<void> {
  const today = jstToday();
  const now = Math.floor(Date.now() / 60_000);

  const specs = [
    {
      userId: params.shiftUserId,
      // 基準日は少し先の未来にする(「予告」= まだ来ていない付与を事前に承認できることが要点)。
      grantedOn: fmt(addDays(today, 30)),
      expiresOn: fmt(addDays(today, 30 + 730)),
      days: 11,
      attendanceRate: {
        periodFrom: fmt(addDays(today, 30 - 365)),
        periodTo: fmt(addDays(today, 29)),
        workingDays: 245,
        attendedDays: 232,
        rate: 232 / 245,
        basis: "shift" as const,
      },
    },
    {
      userId: params.calendarUserId,
      grantedOn: fmt(addDays(today, 45)),
      expiresOn: fmt(addDays(today, 45 + 730)),
      days: 14,
      attendanceRate: {
        periodFrom: fmt(addDays(today, 45 - 365)),
        periodTo: fmt(addDays(today, 44)),
        workingDays: 245,
        // 190/245 ≒ 77.6% で8割を下回る(UI の「8割未満の可能性」チップを写すため)。
        attendedDays: 190,
        rate: 190 / 245,
        basis: "calendar_estimate" as const,
      },
    },
  ];

  // 冪等(このファイルの他の関数と同じ流儀): 同じ (user_id, granted_on) の予告が既にあれば作らない。
  const existing = await db.select().from(leaveGrantProposals).where(eq(leaveGrantProposals.tenantId, params.tenantId));

  for (const spec of specs) {
    if (existing.some((row) => row.userId === spec.userId && row.grantedOn === spec.grantedOn)) continue;
    await db.insert(leaveGrantProposals).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      userId: spec.userId,
      leaveType: "annual",
      grantedOn: spec.grantedOn,
      days: spec.days,
      expiresOn: spec.expiresOn,
      // attendance_rate は @kizami/leave の AttendanceRateReference を JSON 文字列で持つ列。
      attendanceRate: JSON.stringify(spec.attendanceRate),
      status: "proposed",
      proposedAt: now,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      grantId: null,
      createdAt: now,
    });
  }
}

async function insertNotifications(db: Database, params: { tenantId: string; userId: string }): Promise<void> {
  const now = Math.floor(Date.now() / 60_000);
  const today = jstToday();
  const missingClockOutDate = fmt(missingClockOutDemoDate(today));
  const leaveExpiresOn = fmt(addDays(today, 18));
  const mandatoryDeadline = fmt(addDays(today, 25));
  const todayDate = fmt(today);

  // 文言は apps/api/src/reminders.ts / leave-alerts.ts の生成関数と揃える(独自の言い回しを増やさない)。
  const rows: Array<{ type: string; subjectDate: string | null; title: string; body: string; readAt: number | null; createdAt: number }> = [
    {
      type: "missing_clock_out",
      subjectDate: missingClockOutDate,
      title: "退勤打刻の記録がありません",
      body: `${missingClockOutDate} の退勤打刻が記録されていません。心当たりがない場合は修正申請から追加してください。`,
      readAt: null,
      // createdAt/readAt は分単位のUTCエポック(now もこの単位)。"60 * 20" のような
      // 秒基準の書き方は20時間ずれる誤りになるため、分そのものを直接引く。
      createdAt: now - 20, // 20分前
    },
    {
      type: "leave_expiring_30d",
      subjectDate: todayDate,
      title: "年次有給休暇が失効間近です",
      body: `年次有給休暇の1200分が${leaveExpiresOn}に失効します。取得計画をご確認ください。`,
      readAt: null,
      createdAt: now - 5, // 5分前
    },
    {
      type: "leave_mandatory5_30d",
      subjectDate: todayDate,
      title: "年5日の年次有給休暇取得義務の期限が近づいています",
      body: `年5日の年次有給休暇取得義務まであと${mandatoryDeadline}(期限)です。現在の取得日数は3日、必要日数は5日です。半休は0.5日として数えられますが、時間単位の取得は含められません。`,
      readAt: now - 2 * 24 * 60 + 10, // 2日前に作成され、その少し後に既読にした
      createdAt: now - 2 * 24 * 60, // 2日前
    },
  ];

  for (const row of rows) {
    // UNIQUE(tenant_id, user_id, type, subject_date) を尊重し、既存なら何もしない(冪等)。
    const existing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, params.tenantId));
    const dup = existing.find((n) => n.userId === params.userId && n.type === row.type && n.subjectDate === row.subjectDate);
    if (dup) continue;

    await db.insert(notifications).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      userId: params.userId,
      type: row.type,
      subjectDate: row.subjectDate,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      readAt: row.readAt,
    });
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!databaseUrl || !adminEmail) {
    console.error("DATABASE_URL and ADMIN_EMAIL environment variables are required");
    process.exitCode = 1;
    return;
  }

  const { db } = await migrateDb({ url: databaseUrl });

  const adminRows = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  const admin = adminRows[0];
  if (!admin) {
    console.error(`admin user ${adminEmail} not found — run \`pnpm seed\` first`);
    process.exitCode = 1;
    return;
  }
  const tenantId = admin.tenantId;

  const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenantRows[0]) throw new Error(`tenant ${tenantId} not found`);

  const workPolicyId = await findWorkPolicyId(db, tenantId);

  // v0.5: 休憩ルールを "both" にする版を先月・今月の既存デモ打刻日より前から効かせておく
  // (HTTP 経由だと過去日に遡れないため、ここで直接 INSERT する)。
  await insertBothModeBreakRuleVersion(db, tenantId);
  await insertNightAllowanceDefinition(db, tenantId);
  // v0.5: 固定時間制メンバー用の別 work_policies を用意する(テナント既定は変えない)。
  const fixedWorkPolicyId = await createFixedWorkPolicy(db, tenantId);
  // v0.7: シフト制(monthly_variable)メンバー用の別 work_policies を用意する。
  const variableWorkPolicyId = await createVariableWorkPolicy(db, tenantId);

  // 部署(本社をルート、営業部・開発部を配下に)。既存なら流用する(冪等)。
  const now = Math.floor(Date.now() / 60_000);
  async function ensureDepartment(name: string, parentId: string | null): Promise<string> {
    const existingRows = await db.select().from(departmentsTable).where(eq(departmentsTable.tenantId, tenantId));
    const found = existingRows.find((d) => d.name === name && d.parentId === parentId);
    if (found) return found.id;
    const id = uuidv7();
    await db.insert(departmentsTable).values({ id, tenantId, parentId, name, createdAt: now });
    return id;
  }
  const hqId = await ensureDepartment("本社", null);
  const salesId = await ensureDepartment("営業部", hqId);
  const devId = await ensureDepartment("開発部", hqId);

  // 管理者自身も本社に所属させる(未所属だとメンバー一覧で部署が空欄になるため)。
  const adminMembership = await db.select().from(memberships).where(eq(memberships.userId, admin.id));
  if (adminMembership.length === 0) {
    await db.insert(memberships).values({ id: uuidv7(), tenantId, userId: admin.id, departmentId: hqId, createdAt: now });
  }

  const createdUsers = await insertDemoUsers(db, {
    tenantId,
    workPolicyId,
    fixedWorkPolicyId,
    variableWorkPolicyId,
    departmentIdByKey: { hq: hqId, sales: salesId, dev: devId },
  });

  await insertNotifications(db, { tenantId, userId: admin.id });

  // v0.7 フェーズ4: /settings/leave の「付与の予告」セクション用の予告を2件入れる。
  const shiftProposalUserId = createdUsers.find((u) => u.key === "member3")?.id;
  const calendarProposalUserId = createdUsers.find((u) => u.key === "member1")?.id;
  if (shiftProposalUserId && calendarProposalUserId) {
    await insertLeaveGrantProposals(db, { tenantId, shiftUserId: shiftProposalUserId, calendarUserId: calendarProposalUserId });
  }

  console.log(JSON.stringify({ users: createdUsers, departments: { hq: hqId, sales: salesId, dev: devId } }));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
