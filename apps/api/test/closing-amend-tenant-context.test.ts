/**
 * N+1解消(レビュー指摘6)の単体テスト。
 *
 * computeMonthlyForUser からテナント単位の取得(law タイムライン・手当タイムライン・
 * テナント設定版)を分離した TenantMonthlyContext が、渡しても渡さなくても同じ計算結果に
 * なること(挙動不変)、および getOrBuildTenantMonthlyContext がテナント単位で1回しか
 * 構築しないこと(キャッシュとして機能すること)を確認する。
 *
 * apps/api/src/routes/corrections.ts・leave.ts・settings.ts は別エージェントが並行作業中のため、
 * このテストは HTTP 経由ではなく apps/api/src/lib/closing-amend.ts の関数を直接呼ぶ形にして
 * 依存を避けている。
 */

import { describe, expect, it } from "vitest";
import {
  buildTenantMonthlyContext,
  computeMonthlyForUser,
  getOrBuildTenantMonthlyContext,
  type TenantMonthlyContextCache,
} from "../src/lib/closing-amend.js";
import { jstMinutes, setupTestDb } from "./support/setup.js";
import { authCredentials, punchEvents, uuidv7, users, userPolicyAssignments, workPolicyVersions } from "@kizami/db";

describe("TenantMonthlyContext (N+1解消)", () => {
  it("passing a precomputed tenantContext yields the same output as omitting it", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 04/01 09:00-18:00 JST(休憩なし、9時間)
    await db.insert(punchEvents).values([
      {
        id: uuidv7(),
        tenantId,
        userId,
        kind: "clock_in",
        occurredAt: jstMinutes(2026, 4, 1, 9, 0),
        recordedAt: jstMinutes(2026, 4, 1, 9, 0),
        source: "web",
        actorId: userId,
      },
      {
        id: uuidv7(),
        tenantId,
        userId,
        kind: "clock_out",
        occurredAt: jstMinutes(2026, 4, 1, 18, 0),
        recordedAt: jstMinutes(2026, 4, 1, 18, 0),
        source: "web",
        actorId: userId,
      },
    ]);

    const withoutContext = await computeMonthlyForUser(db, { tenantId, userId, year: 2026, month: 4 });

    const tenantContext = await buildTenantMonthlyContext(db, { tenantId, year: 2026, month: 4 });
    const withContext = await computeMonthlyForUser(db, { tenantId, userId, year: 2026, month: 4 }, tenantContext);

    expect(withContext.output.totals).toEqual(withoutContext.output.totals);
    expect(withContext.output.flexBalance).toEqual(withoutContext.output.flexBalance);
    expect(withContext.output.days).toEqual(withoutContext.output.days);
  });

  it("getOrBuildTenantMonthlyContext builds the context once per (tenantId, year, month) and reuses it across users", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // 同一テナントに2人目のユーザーを、1人目と同じ work_policy 割当で追加する
    // (setupSecondUser は work_policy を割り当てないため、ここでは自前で作る)。
    const secondUserId = uuidv7();
    await db.insert(users).values({ id: secondUserId, tenantId, email: "second@example.com", name: "Second", isActive: true, createdAt: 0 });
    await db.insert(authCredentials).values({
      id: uuidv7(),
      tenantId,
      userId: secondUserId,
      passwordHash: "irrelevant",
      createdAt: 0,
      updatedAt: 0,
    });
    const wpRows = await db.select().from(workPolicyVersions);
    const workPolicyId = wpRows[0]?.workPolicyId;
    if (!workPolicyId) throw new Error("expected a seeded work policy version");
    await db.insert(userPolicyAssignments).values({
      id: uuidv7(),
      tenantId,
      userId: secondUserId,
      workPolicyId,
      effectiveFrom: "1970-01-01",
      createdAt: 0,
    });

    const cache: TenantMonthlyContextCache = new Map();
    const first = await getOrBuildTenantMonthlyContext(cache, db, { tenantId, year: 2026, month: 4 });
    const second = await getOrBuildTenantMonthlyContext(cache, db, { tenantId, year: 2026, month: 4 });
    // 同一 (tenantId, year, month) は同じ Promise(= 同じ構築結果オブジェクト)を返す(再構築しない)。
    expect(second).toBe(first);

    // 2人ともこのキャッシュ経由で問題なく計算できる(挙動を壊していないことの確認)。
    const outputA = await computeMonthlyForUser(db, { tenantId, userId, year: 2026, month: 4 }, first);
    const outputB = await computeMonthlyForUser(db, { tenantId, userId: secondUserId, year: 2026, month: 4 }, first);
    expect(outputA.output.workSystem).toBe("flex");
    expect(outputB.output.workSystem).toBe("flex");

    // 別の月を引けば新しいキャッシュエントリになる(構築結果は使い回されない)。
    const differentMonth = await getOrBuildTenantMonthlyContext(cache, db, { tenantId, year: 2026, month: 5 });
    expect(differentMonth).not.toBe(first);
  });
});
