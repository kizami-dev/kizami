/**
 * テナントの物理削除・全データのエクスポートのテスト用に、**テナントに属する全テーブルへ少なくとも1行**
 * 入れたテナントを作る(test/tenant-purge.test.ts・test/tenant-export.test.ts)。
 *
 * テーブルを足したらここにも1行足すこと。足し忘れは tenant-purge.test.ts の
 * 「fixture が全テーブルを埋めている」テストが落とす(削除・エクスポートのテストが新しいテーブルを
 * 素通りしないようにするため)。
 *
 * 秘密の列(パスワードハッシュ・トークンのハッシュ・暗号化した秘密など)には `SECRET-` で始まる値を
 * 入れる。エクスポートのテストは、出力のどこにもこの文字列が無いことを確かめる。
 */

import {
  allowanceDefinitions,
  allowanceDefinitionVersions,
  apiKeys,
  approvalFlowSettings,
  auditLogs,
  authCredentials,
  autoBreakWaivers,
  closingEvents,
  closingSnapshots,
  correctionRequests,
  departments,
  helpOverrides,
  invitations,
  leaveGrantProposals,
  leaveGrants,
  leaveRequests,
  memberships,
  notifications,
  passwordResetTokens,
  pendingSignups,
  permissionPresets,
  presetAssignments,
  punchEvents,
  pushSubscriptions,
  scheduledHolidayCalendarVersions,
  sessions,
  shiftDays,
  shiftPatterns,
  shiftPlans,
  slackLinkTokens,
  slackUserLinks,
  tenantLeaveSettings,
  tenantNotificationSettings,
  tenantOidcSettings,
  tenants,
  tenantSettingVersions,
  tenantSlackSettings,
  userNotificationSettings,
  userPolicyAssignments,
  users,
  userTotp,
  userTotpRecoveryCodes,
  workPolicies,
  workPolicyVersions,
} from "../../src/schema/index.js";
import { uuidv7 } from "../../src/uuid.js";
import type { Database } from "./db.js";

/** 秘密の列に入れる値の接頭辞。エクスポートの出力に現れてはならない。 */
export const SECRET_MARKER = "SECRET-";

export interface FullTenant {
  tenantId: string;
  tenantName: string;
  adminId: string;
  adminEmail: string;
  memberId: string;
  memberEmail: string;
}

/**
 * 全テーブルに行を持つテナントを1つ作る。`label` は一意制約のある値(メール・ハッシュ・Slack の
 * チーム id など)を他のテナントとぶつけないための文字列。
 */
export async function seedFullTenant(db: Database, label: string): Promise<FullTenant> {
  const tenantId = uuidv7();
  const tenantName = `${label} 株式会社`;
  const adminId = uuidv7();
  const memberId = uuidv7();
  const adminEmail = `admin-${label}@example.com`;
  const memberEmail = `member-${label}@example.com`;
  const secret = (what: string) => `${SECRET_MARKER}${label}-${what}`;

  await db.insert(tenants).values({ id: tenantId, name: tenantName, createdAt: 1 });
  await db.insert(users).values([
    { id: adminId, tenantId, email: adminEmail, name: `${label} 管理者`, createdAt: 1 },
    { id: memberId, tenantId, email: memberEmail, name: `${label} 従業員`, createdAt: 1, hireDate: "2024-04-01" },
  ]);

  // ---- 設定・制度 ----
  await db.insert(tenantSettingVersions).values({
    id: uuidv7(),
    tenantId,
    effectiveFrom: "1970-01-01",
    dayBoundaryMinutes: 0,
    legalHolidayRule: JSON.stringify({ kind: "weekday", weekday: 0 }),
    breakRule: JSON.stringify({ mode: "punch" }),
    gpsEnabled: false,
    createdAt: 1,
  });
  await db.insert(scheduledHolidayCalendarVersions).values({
    id: uuidv7(),
    tenantId,
    effectiveFrom: "1970-01-01",
    weekdays: "[0,6]",
    nationalHolidays: true,
    extraHolidays: "[]",
    extraWorkdays: "[]",
    createdAt: 1,
  });
  const workPolicyId = uuidv7();
  await db.insert(workPolicies).values({ id: workPolicyId, tenantId, name: "標準", createdAt: 1 });
  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId,
    workPolicyId,
    effectiveFrom: "1970-01-01",
    kind: "flex",
    settlementPeriod: "monthly",
    standardDayMinutes: 480,
    createdAt: 1,
  });
  await db.insert(userPolicyAssignments).values({ id: uuidv7(), tenantId, userId: memberId, workPolicyId, effectiveFrom: "1970-01-01", createdAt: 1 });
  const allowanceId = uuidv7();
  await db.insert(allowanceDefinitions).values({ id: allowanceId, tenantId, createdAt: 1 });
  await db.insert(allowanceDefinitionVersions).values({
    id: uuidv7(),
    tenantId,
    definitionId: allowanceId,
    effectiveFrom: "1970-01-01",
    name: "早朝",
    conditions: "{}",
    createdAt: 1,
  });
  await db.insert(approvalFlowSettings).values({ tenantId, updatedAt: 1, updatedBy: adminId });
  await db.insert(tenantLeaveSettings).values({ tenantId, grantMethod: "hire_date", updatedAt: 1, updatedBy: adminId });
  await db.insert(tenantNotificationSettings).values({
    tenantId,
    webhookUrl: secret("tenant-webhook"),
    smtpHost: "smtp.example.com",
    smtpPassword: secret("smtp-password"),
    updatedAt: 1,
    updatedBy: adminId,
  });
  await db.insert(tenantOidcSettings).values({ tenantId, issuer: "https://idp.example.com", clientId: "client", clientSecret: secret("oidc"), updatedAt: 1, updatedBy: adminId });
  await db.insert(tenantSlackSettings).values({ tenantId, teamId: `T-${label}`, signingSecret: secret("slack-signing"), updatedAt: 1, updatedBy: adminId });
  await db.insert(helpOverrides).values({ tenantId, helpKey: "overtime.60h", bodyMd: "社内の補足", updatedBy: adminId, updatedAt: 1 });

  // ---- 組織・権限 ----
  const departmentId = uuidv7();
  const childDepartmentId = uuidv7();
  await db.insert(departments).values({ id: departmentId, tenantId, name: "本社", createdAt: 1 });
  await db.insert(departments).values({ id: childDepartmentId, tenantId, parentId: departmentId, name: "営業部", createdAt: 1 });
  await db.insert(memberships).values({ id: uuidv7(), tenantId, userId: memberId, departmentId: childDepartmentId, createdAt: 1 });
  const presetId = uuidv7();
  await db.insert(permissionPresets).values({ id: presetId, tenantId, name: "管理者", grants: "[]", isSystem: true, createdAt: 1 });
  await db.insert(presetAssignments).values({ id: uuidv7(), tenantId, userId: adminId, presetId, createdAt: 1 });

  // ---- 認証・端末・連携 ----
  await db.insert(authCredentials).values({ id: uuidv7(), tenantId, userId: adminId, passwordHash: secret("password-hash"), createdAt: 1, updatedAt: 1 });
  await db.insert(sessions).values({ id: secret("session-hash"), tenantId, userId: adminId, createdAt: 1, expiresAt: 99_999_999 });
  await db.insert(userTotp).values({ userId: adminId, tenantId, secretEncrypted: secret("totp"), lastUsedCounter: 12345, createdAt: 1 });
  await db.insert(userTotpRecoveryCodes).values({ id: uuidv7(), tenantId, userId: adminId, codeHash: secret("recovery"), createdAt: 1 });
  await db.insert(apiKeys).values({ id: uuidv7(), tenantId, userId: memberId, name: "IC カード", keyHash: secret("api-key"), scopes: '["punch"]', createdBy: adminId, createdAt: 1 });
  await db.insert(invitations).values({ id: uuidv7(), tenantId, userId: memberId, tokenHash: secret("invitation"), expiresAt: 10, createdBy: adminId, createdAt: 1 });
  await db.insert(passwordResetTokens).values({ id: uuidv7(), tenantId, userId: memberId, tokenHash: secret("reset"), expiresAt: 10, createdBy: adminId, createdAt: 1 });
  await db.insert(pushSubscriptions).values({
    id: uuidv7(),
    tenantId,
    userId: memberId,
    endpoint: `https://push.example.com/${secret("endpoint")}`,
    keysP256dh: secret("p256dh"),
    keysAuth: secret("auth"),
    userAgent: "Mozilla/5.0",
    createdAt: 1,
  });
  await db.insert(userNotificationSettings).values({ tenantId, userId: memberId, emailAddress: "private@example.com", webhookUrl: secret("personal-webhook"), updatedAt: 1 });
  await db.insert(slackUserLinks).values({ tenantId, slackUserId: `U-${label}`, userId: memberId, linkedAt: 1 });
  await db.insert(slackLinkTokens).values({ id: uuidv7(), tenantId, slackUserId: `U-${label}`, tokenHash: secret("slack-link"), expiresAt: 10, createdAt: 1 });
  await db.insert(notifications).values({ id: uuidv7(), tenantId, userId: memberId, type: "missing_clock_out", subjectDate: "2026-04-01", title: "退勤打刻がありません", body: "本文", createdAt: 1 });
  await db.insert(auditLogs).values({ id: uuidv7(), tenantId, actorId: adminId, action: "member.invite", target: `user:${memberId}`, occurredAt: 1 });

  // ---- 打刻・申請(自己参照と、申請 → 打刻の参照を含める) ----
  const punchId = uuidv7();
  const supersedingPunchId = uuidv7();
  await db.insert(punchEvents).values({
    id: punchId,
    tenantId,
    userId: memberId,
    kind: "clock_in",
    occurredAt: 29_000_000,
    recordedAt: 29_000_000,
    source: "web",
    actorId: memberId,
    metaIp: "203.0.113.1",
  });
  const correctionId = uuidv7();
  await db.insert(correctionRequests).values({
    id: correctionId,
    tenantId,
    userId: memberId,
    requestedBy: memberId,
    status: "approved",
    targetEventId: punchId,
    proposedKind: "clock_in",
    proposedOccurredAt: 29_000_010,
    reason: "打刻の修正",
    decidedBy: adminId,
    createdAt: 1,
  });
  await db.insert(punchEvents).values({
    id: supersedingPunchId,
    tenantId,
    userId: memberId,
    kind: "clock_in",
    occurredAt: 29_000_010,
    recordedAt: 29_000_020,
    source: "correction",
    actorId: adminId,
    supersedesId: punchId,
    correctionRequestId: correctionId,
  });
  const leaveRequestId = uuidv7();
  await db.insert(leaveRequests).values({
    id: leaveRequestId,
    tenantId,
    userId: memberId,
    requestedBy: memberId,
    status: "approved",
    leaveDate: "2026-04-10",
    unit: "full_day",
    leaveType: "annual",
    reason: "私用",
    createdAt: 1,
  });
  const grantId = uuidv7();
  await db.insert(leaveGrants).values({ id: grantId, tenantId, userId: memberId, leaveType: "annual", grantedOn: "2024-10-01", days: 10, expiresOn: "2026-09-30", source: "auto", createdAt: 1 });
  await db.insert(leaveGrantProposals).values({
    id: uuidv7(),
    tenantId,
    userId: memberId,
    leaveType: "annual",
    grantedOn: "2025-10-01",
    days: 11,
    expiresOn: "2027-09-30",
    attendanceRate: "1",
    status: "approved",
    proposedAt: 1,
    grantId,
    createdAt: 1,
  });
  await db.insert(autoBreakWaivers).values({ id: uuidv7(), tenantId, userId: memberId, requestedBy: memberId, status: "pending", waiveDate: "2026-04-02", reason: "休憩なし", createdAt: 1 });

  // ---- シフト(自己参照を含める) ----
  const patternId = uuidv7();
  await db.insert(shiftPatterns).values({ id: patternId, tenantId, name: "日勤", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, createdAt: 1 });
  const planId = uuidv7();
  await db.insert(shiftPlans).values({ id: planId, tenantId, userId: memberId, periodStart: "2026-04-01", periodEnd: "2026-04-30", createdAt: 1 });
  const shiftDayId = uuidv7();
  await db.insert(shiftDays).values({ id: shiftDayId, tenantId, userId: memberId, date: "2026-04-01", dayType: "work", startMinutes: 540, endMinutes: 1080, breakMinutes: 60, patternId, planId, createdBy: adminId, createdAt: 1 });
  await db.insert(shiftDays).values({ id: uuidv7(), tenantId, userId: memberId, date: "2026-04-01", dayType: "work", startMinutes: 600, endMinutes: 1080, breakMinutes: 60, planId, supersedesId: shiftDayId, createdBy: adminId, createdAt: 2 });

  // ---- 締め(締め → 申請の参照を含める) ----
  const closingEventId = uuidv7();
  await db.insert(closingEvents).values({ id: closingEventId, tenantId, period: "2026-04", event: "close", actorId: adminId, occurredAt: 1 });
  await db.insert(closingEvents).values({ id: uuidv7(), tenantId, period: "2026-04", event: "amend", actorId: adminId, correctionRequestId: correctionId, leaveRequestId, occurredAt: 2 });
  await db.insert(closingSnapshots).values({ id: uuidv7(), tenantId, closingEventId, userId: memberId, category: "statutory", minutes: 480 });

  // ---- システム表のうちテナントを参照するもの(確認済みのサインアップの記録) ----
  await db.insert(pendingSignups).values({
    id: uuidv7(),
    email: adminEmail,
    emailKey: adminEmail.toLowerCase(),
    organizationName: tenantName,
    adminName: `${label} 管理者`,
    tokenHash: secret("signup-token"),
    expiresAt: 10,
    consumedAt: 2,
    tenantId,
    createdAt: 1,
  });

  return { tenantId, tenantName, adminId, adminEmail, memberId, memberEmail };
}
