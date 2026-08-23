/**
 * apps/api を HTTP 経由で叩いて、スクリーンショット用のデモデータを投入する。
 *
 * 追加ユーザー・部署・アプリ内通知(HTTPで作れないもの)は先に apps/api/src/dev-screenshot-seed.ts
 * が直接 DB へ入れている前提で、その結果(ユーザーID・部署ID)を受け取って組み立てる。
 */
import { ApiClient } from "./api-client.js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./config.js";
import {
  addDays,
  addMonths,
  allDaysInMonth,
  fmtDate,
  fmtMonth,
  jstMinutes,
  jstToday,
  weekdayOf,
  weekdaysBeforeTodayInCurrentMonth,
  weekdaysInMonth,
  type CivilDate,
} from "./time.js";

export interface ExtraUser {
  key: string;
  id: string;
  email: string;
}

export interface SeedHttpParams {
  apiBaseUrl: string;
  extraUsers: ExtraUser[];
  departments: { hq: string; sales: string; dev: string };
}

export interface SeedHttpResult {
  sessionCookie: string;
  adminId: string;
  /** v0.5: 固定時間制メンバー(member2)としてログインしたセッション(monthly-fixed 画面用)。 */
  fixedMemberSessionCookie: string;
  /** v0.7: シフト制メンバー(member3)としてログインしたセッション(shifts-me・monthly-variable 画面用)。 */
  variableMemberSessionCookie: string;
  /** v0.7: シフト制メンバー(member3)のuserId。管理者の /shifts?userId= ディープリンク撮影用。 */
  variableMemberId: string;
  /** v0.7: 確定済みシフト表のID(将来の履歴画面撮影等で使う可能性を見込んで返しておく)。 */
  variableMemberShiftPlanId: string;
  /** v0.5: 招待受諾ページ(/invite/{token})の撮影用トークン(未受諾のまま残す)。 */
  inviteToken: string;
  /** Tier 0: パスワードリセット受諾ページ(/reset/{token})の撮影用トークン(未使用のまま残す)。 */
  resetToken: string;
}

/** 1日ぶんの勤務(既定 9:00-18:00, 休憩12:00-13:00)を打刻として積む。休憩は勤務時間内に収める。 */
async function punchNormalDay(
  client: ApiClient,
  date: CivilDate,
  opts?: { start?: number; end?: number; breakStart?: number; breakEnd?: number },
): Promise<void> {
  const start = opts?.start ?? 9;
  const end = opts?.end ?? 18;
  const breakStart = opts?.breakStart ?? 12;
  const breakEnd = opts?.breakEnd ?? 13;
  await client.punch("clock_in", jstMinutes(date, start, 0));
  await client.punch("break_start", jstMinutes(date, breakStart, 0));
  await client.punch("break_end", jstMinutes(date, breakEnd, 0));
  await client.punch("clock_out", jstMinutes(date, end, 0));
}

export async function seedHttp(params: SeedHttpParams): Promise<SeedHttpResult> {
  const client = new ApiClient(params.apiBaseUrl);
  const login = await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminId = login.user.id;

  const byKey = new Map(params.extraUsers.map((u) => [u.key, u.id] as const));
  const emailByKey = new Map(params.extraUsers.map((u) => [u.key, u.email] as const));
  const managerId = byKey.get("manager");
  const member1Id = byKey.get("member1");
  const member2Id = byKey.get("member2");
  const member3Id = byKey.get("member3");
  const member1Email = emailByKey.get("member1");
  const member2Email = emailByKey.get("member2");
  const member3Email = emailByKey.get("member3");
  if (!managerId || !member1Id || !member2Id || !member3Id || !member1Email || !member2Email || !member3Email) {
    throw new Error("extra demo users were not created (dev-screenshot-seed.ts)");
  }

  // --- 部署・メンバー・権限プリセット -------------------------------------------------
  const presetsRes = await client.listPresets();
  const managerPreset = presetsRes.presets.find((p) => p.name === "マネージャー");
  const memberPreset = presetsRes.presets.find((p) => p.name === "メンバー");
  if (!managerPreset || !memberPreset) throw new Error("system presets (from `pnpm seed`) not found");

  const accountingPreset = await client.createPreset({
    name: "経理担当",
    description: "自部署の勤怠を確認し、CSVを出力できるカスタムプリセット(デモ用)",
    grants: [
      { key: "attendance.record.view", scope: "department" },
      { key: "export.attendance.run", scope: "department" },
    ],
  });

  await client.updateMember(managerId, { departmentId: params.departments.sales });
  await client.updateMember(member1Id, { departmentId: params.departments.sales });
  await client.updateMember(member2Id, { departmentId: params.departments.dev });
  await client.updateMember(member3Id, { departmentId: params.departments.sales });

  await client.assignMemberPresets(managerId, [managerPreset.id]);
  await client.assignMemberPresets(member1Id, [memberPreset.id, accountingPreset.preset.id]);
  await client.assignMemberPresets(member2Id, [memberPreset.id]);
  await client.assignMemberPresets(member3Id, [memberPreset.id]);

  // 入社日を設定(法定付与の自動計算に必要)。管理者は約7年前入社にして複数回ぶんの
  // 付与履歴(6ヶ月・1.5年・2.5年…)が一度に生成されるようにする(有給休暇画面を賑やかにする独自判断)。
  await client.updateMember(adminId, { hireDate: "2019-04-01" });

  // --- 有給休暇: テナント設定 → 法定付与(自動)→ 失効分の積立振替 -------------------------
  await client.updateLeaveSettings({
    grantMethod: "statutory",
    hourlyLeaveEnabled: true,
    hourlyLeaveMaxDays: 5,
    halfDayLeaveEnabled: true,
    stockConversionEnabled: true,
    stockMaxDays: 40,
    stockExpiresMonths: null,
  });
  await client.autoGrantLeave(adminId);
  await client.convertExpiredLeave(adminId);

  const today = jstToday();

  // 全休(承認済み)
  const fullDayDate = fmtDate(addDays(today, -16));
  const fullDayReq = await client.createLeaveRequest({
    leaveDate: fullDayDate,
    leaveType: "annual",
    reason: "私用のため",
  });
  await client.approveLeaveRequest(fullDayReq.request.id);

  // 半休(申請中のまま — 承認待ちの見た目を残す)
  const halfDayDate = fmtDate(addDays(today, 4));
  await client.createLeaveRequest({
    leaveDate: halfDayDate,
    unit: "half_day_am",
    leaveType: "annual",
    reason: "通院のため",
  });

  // 時間単位(承認済み)
  const hourlyDate = fmtDate(addDays(today, -9));
  const hourlyReq = await client.createLeaveRequest({
    leaveDate: hourlyDate,
    unit: "hourly",
    minutes: 120,
    leaveType: "annual",
    reason: "家族の用事のため(2時間)",
  });
  await client.approveLeaveRequest(hourlyReq.request.id);

  // --- 打刻: 先月ぶん(締める用)→ 今月ぶん(通常・深夜・打刻忘れ・本日勤務中) -------------
  // 先月は暦月まるごと過去なので、月末に近い平日を最大10日ぶん使う(締め後の月次表示を賑やかにする)。
  const prevMonth = addMonths(today, -1);
  const prevMonthAllWeekdays = weekdaysInMonth(prevMonth.y, prevMonth.m);
  const prevMonthWeekdays = prevMonthAllWeekdays.slice(-10);
  // このうち最後の1日(月末に最も近い平日)だけは休憩打刻なしの9時間拘束にする。
  // テナントの休憩ルールは "both"(併用)で、これは apps/api/src/dev-screenshot-seed.ts が
  // 先月分より前から効くように直接投入済み(HTTP の POST /settings/attendance は
  // effectiveFrom を過去日にできないため、過去月の集計に反映させるには直接投入するしかない)。
  // 休憩打刻が無いこの日だけ、9:00-18:00(9時間)の自動控除ルール(8時間超で60分)が働き、
  // 月次の「自動 1:00」表示のデモになる(他の9日は打刻休憩60分があるため何も変わらない)。
  const autoBreakDemoDate = prevMonthWeekdays[prevMonthWeekdays.length - 1];
  // 月次(締め済みの前月を写す)に警告行の実例を残すための日。6時間20分・休憩打刻なし:
  // both の自動控除は控除後(380-45=335 < 360)に閾値を割るため適用されず、
  // insufficient_break 警告(必要0:45・実際0:00)がそのまま残る。締めても警告は消えない
  // (集計値はスナップショット保護だが warnings は都度再計算)ことのデモを兼ねる。
  const insufficientBreakDemoDate = prevMonthWeekdays[prevMonthWeekdays.length - 2];
  const prevMonthLateNightDate = prevMonthWeekdays[prevMonthWeekdays.length - 3];
  for (const date of prevMonthWeekdays) {
    if (autoBreakDemoDate && fmtDate(date) === fmtDate(autoBreakDemoDate)) {
      await client.punch("clock_in", jstMinutes(date, 9, 0));
      await client.punch("clock_out", jstMinutes(date, 18, 0));
    } else if (insufficientBreakDemoDate && fmtDate(date) === fmtDate(insufficientBreakDemoDate)) {
      await client.punch("clock_in", jstMinutes(date, 9, 0));
      await client.punch("clock_out", jstMinutes(date, 15, 20));
    } else if (prevMonthLateNightDate && fmtDate(date) === fmtDate(prevMonthLateNightDate)) {
      // 深夜勤務の日(13:00-23:00): 深夜区分 1:00 と夜間手当(22:00〜翌5:00)1:00 が
      // 締め済み月の月次・スナップショットに写る(手当のデモ、2026-08-23)
      await punchNormalDay(client, date, { start: 13, end: 23, breakStart: 17, breakEnd: 18 });
    } else {
      await punchNormalDay(client, date);
    }
  }
  // 前月の頭に承認済みの全休を1件(締めの前に)。月次(締め済みの前月を写す)の日付セルに
  // 有給バッジ「全休」が写るようにする(2026-08-23。有給の枠算入がスナップショットにも入る)。
  const prevMonthLeaveDate = prevMonthAllWeekdays[0];
  if (prevMonthLeaveDate) {
    const prevLeaveReq = await client.createLeaveRequest({
      leaveDate: fmtDate(prevMonthLeaveDate),
      leaveType: "annual",
      reason: "私用のため",
    });
    await client.approveLeaveRequest(prevLeaveReq.request.id);
  }

  const prevMonthPeriod = fmtMonth(prevMonth);
  await client.closeMonth(prevMonthPeriod, "先月分を確認のうえ締めます");

  // 今月・今日より前の平日プール(昇順)。末尾から役割を割り当てる — 締め済みの先月へは
  // 絶対に越境しない(月初に撮影した場合はプールが短くなり、一部の役割が欠けるだけ)。
  const pool = weekdaysBeforeTodayInCurrentMonth();
  const recentDay = pool.pop(); // 直近の勤務日(修正申請の対象にする)
  const missingClockOutDate = pool.pop() ?? recentDay; // 打刻忘れの日(無ければ直近日と兼用)
  const lateNightDay = pool.pop();
  const insufficientBreakDay = pool.pop(); // 休憩不足警告の日(下記コメント参照)
  const normalDay2 = pool.pop();
  const normalDay1 = pool.pop();

  if (normalDay1) await punchNormalDay(client, normalDay1);
  if (normalDay2) await punchNormalDay(client, normalDay2);

  // 警告行(行背景+文言)のデモ: 6時間20分勤務・休憩打刻なし。
  // - 退勤なし(missing_clock_out)を放置すると後続日の打刻が壊れるため使えない
  //   (上の missingClockOutDate は「修正申請で直した」ストーリーで警告が消える)
  // - 休憩ルールは "both" だが、6h超45分ルールは控除後(380-45=335 < 360)に自身の閾値を
  //   割るため適用されず(packages/engine/src/auto-break.ts の自己無矛盾チェック)、
  //   自動控除に隠されず insufficient_break 警告(必要0:45・実際0:00)がそのまま残る。
  //   1日で完結しデータも壊れないため、警告表現の常設デモに最適
  if (insufficientBreakDay) {
    await client.punch("clock_in", jstMinutes(insufficientBreakDay, 9, 0));
    await client.punch("clock_out", jstMinutes(insufficientBreakDay, 15, 20));
  }
  // 22:00-23:00 が深夜労働になる。休憩は 17-18 時(9-23時の勤務時間内)に収める
  // (休憩が勤務時間の外にあると "break_outside_work" 警告になってしまうため)。
  if (lateNightDay) await punchNormalDay(client, lateNightDay, { start: 13, end: 23, breakStart: 17, breakEnd: 18 });

  // 打刻忘れの日: clock_out を打たないまま放置すると、エンジンは「まだ勤務中」の状態が
  // 後続の日の clock_in まで続くとみなし(duplicate_clock_in)、以降の日の実労働まで
  // おかしくなる(実装時に手元で確認した挙動)。そのため、この日の追加申請は
  // その場で承認まで行い、セッションを閉じてから後続日の打刻に進む。
  // 通知(dev-screenshot-seed.ts が直接投入)には「打刻忘れがあった」事実がそのまま残るため、
  // 「気づいて直した」という一貫したストーリーになる。
  if (missingClockOutDate) {
    await client.punch("clock_in", jstMinutes(missingClockOutDate, 9, 0));
    await client.punch("break_start", jstMinutes(missingClockOutDate, 12, 0));
    await client.punch("break_end", jstMinutes(missingClockOutDate, 13, 0));
    // clock_out はあえて打たない(打刻忘れ)→ この直後に追加申請で復旧する

    const missingCorrection = await client.createCorrection({
      proposedKind: "clock_out",
      proposedOccurredAt: jstMinutes(missingClockOutDate, 19, 0),
      reason: "退勤打刻を忘れていました。実際は19:00に退勤しています。",
    });
    await client.approveCorrection(missingCorrection.request.id, "確認しました。承認します。");
  }

  // pool が1件しか無かった場合、missingClockOutDate は recentDay と同じ日を指す(上の ?? フォールバック)。
  // その場合は同じ日に2重で打刻しない。
  if (recentDay && (!missingClockOutDate || fmtDate(recentDay) !== fmtDate(missingClockOutDate))) {
    await punchNormalDay(client, recentDay);
    // こちらは完結した1日に対する時刻の微修正で、セッションを分断しない。承認せず
    // 「申請中」のまま残し、修正申請一覧で pending/approved の両方を見せる。
    const recentDayPunches = await client.listPunches(jstMinutes(recentDay, 0, 0), jstMinutes(recentDay, 23, 59));
    const recentClockIn = recentDayPunches.punches.find((p) => p.kind === "clock_in");
    if (recentClockIn) {
      await client.createCorrection({
        targetEventId: recentClockIn.id,
        proposedKind: "clock_in",
        proposedOccurredAt: jstMinutes(recentDay, 9, 15),
        reason: "打刻漏れがあったため、実際の出勤時刻(9:15)に補正します。",
      });
    }
  }

  // 本日: 出勤のみ(打刻画面が「勤務中」スタンプで撮れるようにする)。
  // 撮影する時刻帯によって朝9時が未来になり得るため、固定時刻ではなく「実行時刻の少し前」を使う
  // (occurredAt は現在時刻より未来にできない、apps/api/src/routes/punches.ts)。
  const nowMinutes = Math.floor(Date.now() / 60_000);
  await client.punch("clock_in", nowMinutes - 30);

  // --- v0.5: 休憩自動控除の打ち消し申請(member1 が本人として申請する) --------------------
  // corrections 画面の承認キューは「自分以外の申請が一覧に含まれるか」で表示可否を決める
  // (apps/web/src/components/CorrectionsView.tsx の hasApprovePermission)。管理者(client)
  // 自身の申請だけでは承認キューが出ないため、あえて member1 を申請者にする。
  const member1Client = new ApiClient(params.apiBaseUrl);
  // 全デモアカウントは apps/api/src/dev-screenshot-seed.ts の DEMO_PASSWORD で共通
  // (= config.ts の ADMIN_PASSWORD と同じ文字列)。
  await member1Client.login(member1Email, ADMIN_PASSWORD);
  const member1Pool = weekdaysBeforeTodayInCurrentMonth();
  const waiverDemoDate = member1Pool.pop();
  if (waiverDemoDate) {
    // 休憩打刻なしの9時間拘束 → 自動控除(1時間)が発生する日を作り、それに対して
    // 打ち消しを申請する、という一貫したストーリーにする。
    await member1Client.punch("clock_in", jstMinutes(waiverDemoDate, 9, 0));
    await member1Client.punch("clock_out", jstMinutes(waiverDemoDate, 18, 0));
    await member1Client.createAutoBreakWaiver({
      waiveDate: fmtDate(waiverDemoDate),
      reason: "来客対応が続き、休憩を取れませんでした。",
    });
  }

  // --- v0.5: 固定時間制メンバー(member2)の打刻 --------------------------------------------
  // work_policy は apps/api/src/dev-screenshot-seed.ts が member2 だけに直接割り当て済み
  // (所定労働時間 7時間)。ここでは本人としてログインし、月次画面の「時間外」「法定内残業」
  // 「36協定バー」が一通り出るよう3日ぶん打刻する(いずれも昼休憩60分を打刻するため、
  // 上の "both" 自動控除ルールとは無関係 — 実労働時間はそのまま拘束時間から60分を引いた値)。
  const fixedMemberClient = new ApiClient(params.apiBaseUrl);
  await fixedMemberClient.login(member2Email, ADMIN_PASSWORD);
  const fixedMemberPool = weekdaysBeforeTodayInCurrentMonth();
  const fixedStandardDay = fixedMemberPool.pop(); // 所定どおり7時間(比較用のベースライン)
  const fixedWithinStatutoryDay = fixedMemberPool.pop(); // 実労働7.5時間 → 法定内残業30分のみ
  const fixedOvertimeDay = fixedMemberPool.pop(); // 実労働9時間 → 法定内残業1時間 + 時間外1時間
  // punchNormalDay は時刻を整数時のみ扱うため、17:30 のような半端な時刻は個別に打刻する。
  if (fixedStandardDay) {
    await punchNormalDay(fixedMemberClient, fixedStandardDay, { start: 9, end: 17, breakStart: 12, breakEnd: 13 });
  }
  if (fixedWithinStatutoryDay) {
    await fixedMemberClient.punch("clock_in", jstMinutes(fixedWithinStatutoryDay, 9, 0));
    await fixedMemberClient.punch("break_start", jstMinutes(fixedWithinStatutoryDay, 12, 0));
    await fixedMemberClient.punch("break_end", jstMinutes(fixedWithinStatutoryDay, 13, 0));
    await fixedMemberClient.punch("clock_out", jstMinutes(fixedWithinStatutoryDay, 17, 30));
  }
  if (fixedOvertimeDay) {
    await punchNormalDay(fixedMemberClient, fixedOvertimeDay, { start: 9, end: 19, breakStart: 12, breakEnd: 13 });
  }
  const fixedMemberSessionCookie = fixedMemberClient.getSessionCookie();

  // --- v0.7: シフト制メンバー(member3)のシフトパターン・シフト表・打刻 --------------------
  // work_policy(monthly_variable)は apps/api/src/dev-screenshot-seed.ts が member3 だけに
  // 1970-01-01 から直接割り当て済み(暦月の初日から monthly_variable でないと、月次の
  // workSystem 判定(月初日時点の版で月全体を判定する、apps/api/src/lib/monthly-shifts.ts)が
  // "flex" のままになってしまうため — HTTP の POST /members/:id/work-policy は当日以降の
  // effectiveFrom しか受け付けられずこれができない、2026-08-24 のシフトUI E2E検証で判明)。
  // ここから先(パターン定義・シフト表の一括割当・確定)はすべて既存の HTTP API 経由で行う。
  const earlyPattern = await client.createShiftPattern({ name: "早番", dayType: "work", startMinutes: 8 * 60, endMinutes: 17 * 60, breakMinutes: 60 });
  const latePattern = await client.createShiftPattern({ name: "遅番", dayType: "work", startMinutes: 13 * 60, endMinutes: 22 * 60, breakMinutes: 60 });
  const dayOffPattern = await client.createShiftPattern({ name: "公休", dayType: "legal_holiday" });
  // 2026-08-24 修正: 土曜も勤務にすると所定合計が法定総枠を超え(208:00 > 177:08)、
  // デモとして不自然な「総枠を超過しています」警告が確定シフトに常設されてしまっていた。
  // 「公休」(法定休日、週1日要件の充足に使う)とは別に、土曜用の non_working パターンを追加する
  // (法定休日ではない単なる所定休日 — 週1日要件は日曜の公休だけで満たすため、土曜は
  // non_working で構わない)。月〜金の5日勤務に絞ることで所定合計は約168:00に収まる。
  const restPattern = await client.createShiftPattern({ name: "休み", dayType: "non_working" });

  // テナントの変形期間開始日は既定の1日(下の createAttendanceSettingVersion 呼び出しでも
  // 明示的に1を指定して揃える)なので、今月の1日を起点にシフト表を作る。
  const shiftPeriodStart = fmtDate({ y: today.y, m: today.m, d: 1 });
  const shiftPlan = await client.createShiftPlan({ userId: member3Id, periodStart: shiftPeriodStart });

  // まとめて割当のデモ: 日曜=公休(法定休日)、土曜=休み(non_working)、木・金=遅番、
  // 月〜水=早番(単調にならない見栄えの独自判断)。週1日(日曜)が必ず公休になるため、
  // 法定休日の週1日要件を満たして確定できる。
  const shiftDays = allDaysInMonth(today.y, today.m).map((d) => {
    const w = weekdayOf(d);
    if (w === 0) return { date: fmtDate(d), patternId: dayOffPattern.pattern.id };
    if (w === 6) return { date: fmtDate(d), patternId: restPattern.pattern.id };
    if (w >= 4) return { date: fmtDate(d), patternId: latePattern.pattern.id };
    return { date: fmtDate(d), patternId: earlyPattern.pattern.id };
  });
  await client.updateShiftPlanDays(shiftPlan.plan.id, shiftDays);
  await client.publishShiftPlan(shiftPlan.plan.id);

  // 本人としてシフトどおりの打刻を入れる(月次画面の3段表示に実データを乗せる)。
  // 2026-08-24 修正: 過去分が1件も無いと月次の全行が「実労働がありません」警告になり不自然
  // だったため、他メンバー(punchNormalDay)と同じように当月の過去の勤務日を実際に打刻する。
  // シフトどおり(早番=月〜水 8:00-17:00、遅番=木・金 13:00-22:00、いずれも休憩1h)に揃え、
  // 直近1日だけは1時間遅刻させて shift_late_arrival 警告の見本にする。未来日は打刻しない
  // (未来日の欠勤警告はエンジン側で出さないよう対応済みとのこと)。
  const variableMemberClient = new ApiClient(params.apiBaseUrl);
  await variableMemberClient.login(member3Email, ADMIN_PASSWORD);

  const variableMemberPastWeekdays = weekdaysBeforeTodayInCurrentMonth();
  const lateArrivalDay = variableMemberPastWeekdays.pop(); // 直近の勤務日を遅刻デモにする
  for (const d of variableMemberPastWeekdays) {
    if (weekdayOf(d) >= 4) {
      await punchNormalDay(variableMemberClient, d, { start: 13, end: 22, breakStart: 17, breakEnd: 18 });
    } else {
      await punchNormalDay(variableMemberClient, d, { start: 8, end: 17, breakStart: 12, breakEnd: 13 });
    }
  }
  if (lateArrivalDay) {
    if (weekdayOf(lateArrivalDay) >= 4) {
      // 遅番(13:00開始)を1時間遅れて出勤。
      await variableMemberClient.punch("clock_in", jstMinutes(lateArrivalDay, 14, 0));
      await variableMemberClient.punch("break_start", jstMinutes(lateArrivalDay, 18, 0));
      await variableMemberClient.punch("break_end", jstMinutes(lateArrivalDay, 19, 0));
      await variableMemberClient.punch("clock_out", jstMinutes(lateArrivalDay, 22, 0));
    } else {
      // 早番(8:00開始)を1時間遅れて出勤。
      await variableMemberClient.punch("clock_in", jstMinutes(lateArrivalDay, 9, 0));
      await variableMemberClient.punch("break_start", jstMinutes(lateArrivalDay, 12, 0));
      await variableMemberClient.punch("break_end", jstMinutes(lateArrivalDay, 13, 0));
      await variableMemberClient.punch("clock_out", jstMinutes(lateArrivalDay, 17, 0));
    }
  }

  // 本日ぶんは他のデモアカウントの「本日打刻」と同じ安全な作法(occurredAt は現在時刻より
  // 未来にできないため、固定時刻ではなく「実行時刻の少し前」を使う)で出勤のみ打刻する
  // (打刻画面の「勤務中」表示のデモを兼ねる)。
  const variableNowMinutes = Math.floor(Date.now() / 60_000);
  await variableMemberClient.punch("clock_in", variableNowMinutes - 30);
  const variableMemberSessionCookie = variableMemberClient.getSessionCookie();

  // --- テナント設定・個人設定・連携設定 --------------------------------------------------
  await client.updateTenantProfile({
    isSmallOrMediumEnterprise: true,
    isSpecialProvisionWorkplace: false,
    specialClauseEnabled: false,
  });

  await client.updateNotificationSettings({
    webhookEnabled: true,
    webhookUrl: "https://hooks.example.com/kizami-demo",
    smtpEnabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpUser: "kizami@example.com",
    smtpFrom: "kizami@example.com",
    smtpPassword: "demo-smtp-password",
  });

  await client.updatePersonalNotificationSettings({
    categories: {
      missing_clock_out: { email: true, webhook: false },
      overtime_alert: { email: true, webhook: true },
      leave_alert: { email: false, webhook: true },
      // v0.5 追加: 修正系申請(休憩自動控除の打ち消しなど)の承認・却下通知。
      correction_alert: { email: true, webhook: false },
    },
    emailAddress: "admin-personal@example.com",
    webhookUrl: "https://hooks.example.com/personal-demo",
  });

  await client.updateSlackSettings({
    enabled: true,
    teamId: "T0123DEMO",
    signingSecret: "demo-signing-secret-0123456789",
  });

  await client.updatePrivacyContact({
    recordRetentionDescription: "打刻記録・IPアドレス・GPS座標は退職後5年間保存します。",
    privacyContactPoint: "人事労務部(privacy@example.com)",
  });
  await client.updateWorkRulesUrl("https://example.com/work-rules");

  // dayBoundaryMinutes は 0(変更なし)に固定する: ここを動かすと、撮影時刻が早朝(境界の前)
  // だった場合に「本日の出勤」打刻が前日扱いに再計算されてしまい、打刻画面の「勤務中」表示が
  // 崩れる(実装時に手元で確認した挙動 — 属する勤怠日は挿入時ではなく参照時に都度再計算される)。
  // breakRule は apps/api/src/dev-screenshot-seed.ts が既に "both"(併用)へ直接書き換え済み
  // (先月・今月の過去日にも遡って効かせるため、HTTP 経由〔effectiveFrom は今日以降しか
  // 許されない〕ではなく直接 INSERT している)。ここではその値を変えず維持し、
  // GPS・法定休日ルールなど他のフィールドだけで「新しい版が追加された」ことを示す。
  await client.createAttendanceSettingVersion({
    effectiveFrom: fmtDate(today),
    dayBoundaryMinutes: 0,
    legalHolidayRule: { kind: "weekday", weekday: 0 },
    breakRule: {
      mode: "both",
      rules: [
        { overMinutes: 360, deductMinutes: 45 },
        { overMinutes: 480, deductMinutes: 60 },
      ],
    },
    gpsEnabled: true,
    gpsRetentionDays: 90,
    // 週の起算曜日。固定時間制の「週40時間超」の判定に使う(就業規則に定めが無ければ
    // 日曜起算が原則 — 昭和63年基発第1号)。デモは既定のまま日曜にする。
    weekStartWeekday: 0,
    // 変形期間の開始日(v0.7 シフト制、2026-08-24 追加。POST /settings/attendance が必須で
    // 要求するようになったフィールド — 省略すると 400 invalid_variable_period_start_day)。
    // 上のシフト表(member3)の periodStart(今月1日)と一致させ続けるため既定の1を維持する。
    variablePeriodStartDay: 1,
  });
  await client.createWorkPolicyVersion({
    effectiveFrom: fmtDate(today),
    kind: "flex",
    settlementPeriod: "monthly",
    standardDayMinutes: 480,
  });

  await client.createApiKey({ name: "勤怠システム連携(読み取り専用)", scopes: ["read"], expiresAt: null });
  await client.createApiKey({
    name: "打刻端末A",
    scopes: ["punch"],
    expiresAt: jstMinutes(addDays(today, 180), 0, 0),
  });

  // 招待中メンバー(v0.5): メンバー一覧の「招待中」バッジと受諾ページの撮影用。
  // 受諾はしない(バッジが残り、トークンが有効なままである必要がある)。
  const invited = await client.createMemberWithInvitation({
    email: "mirai.hoshino@example.com",
    name: "星野 未来",
    departmentId: params.departments.dev,
  });

  // パスワードリセット(Tier 0): 受諾済みメンバー(member1)へ発行し、受諾ページの撮影に使う。
  // 使用はしない(トークンが有効なまま残り、メンバー一覧の「リセット発行中」バッジも写る)。
  const reset = await client.issuePasswordReset(member1Id);

  return {
    sessionCookie: client.getSessionCookie(),
    adminId,
    fixedMemberSessionCookie,
    variableMemberSessionCookie,
    variableMemberId: member3Id,
    variableMemberShiftPlanId: shiftPlan.plan.id,
    inviteToken: invited.invitation.token,
    resetToken: reset.passwordReset.token,
  };
}
