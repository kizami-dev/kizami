/**
 * buildSettingsTimeline の解決日ズレに対する回帰テスト(2026-08-23)。
 *
 * バグの内容: 各 SettingsSpan を組み立てる際、work policy の版と割当を span の開始点
 * (changePoint)で解決していた。changePoint には「fromDate 以前の tenant 設定版」が
 * 含まれる一方、work policy 側は `>= fromDate` の変更点しか採用しない。このため
 * 「テナント設定は昔のまま変えていないが、work policy だけを対象月より前に変更した」
 * という**ごく普通の運用**で、変更前の版が解決され続けていた。
 *
 * 影響は集計値そのもの(所定労働時間・労働時間制)なので賃金計算に直結する。
 * 固定時間制の追加で表面化したが、フレックスのみの構成でも起きていた既存バグ。
 */

import { describe, expect, it } from "vitest";
import { uuidv7, workPolicies, workPolicyVersions, type Database } from "@kizami/db";
import { eq } from "drizzle-orm";
import { buildSettingsTimeline } from "../src/lib/settings.js";
import { setupTestDb } from "./support/setup.js";

/** setupTestDb() が作った work_policy に新しい版を追記する(原則6どおり追記専用)。 */
async function appendWorkPolicyVersion(
  db: Database,
  params: { tenantId: string; effectiveFrom: string; kind: "flex" | "fixed"; standardDayMinutes: number },
): Promise<void> {
  const rows = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, params.tenantId)).limit(1);
  const workPolicyId = rows[0]?.id;
  if (!workPolicyId) throw new Error("no work_policies row for tenant");

  await db.insert(workPolicyVersions).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    workPolicyId,
    effectiveFrom: params.effectiveFrom,
    kind: params.kind,
    settlementPeriod: "monthly",
    core: null,
    standardDayMinutes: params.standardDayMinutes,
    createdAt: 0,
  });
}

describe("buildSettingsTimeline: 対象期間より前の制度変更の解決", () => {
  it("対象月より前に切り替えた固定時間制が、テナント設定を触っていなくても反映される", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    // setupTestDb() のテナント設定版は "1970-01-01" の1件だけ。ここは触らない。
    // work policy だけを 2026-06-01 に固定時間制へ切り替える。
    await appendWorkPolicyVersion(db, {
      tenantId,
      effectiveFrom: "2026-06-01",
      kind: "fixed",
      standardDayMinutes: 420,
    });

    // 切り替えより後の月を引く。この月の changePoint は "1970-01-01"(テナント設定版)しか
    // 無く、2026-06-01 の work policy 版は `>= fromDate` の条件から漏れる — 修正前は
    // "1970-01-01" 時点の版(フレックス・480分)が解決されていた。
    const timeline = await buildSettingsTimeline(db, {
      tenantId,
      userId,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.settings.workSystem.kind).toBe("fixed");
    expect(timeline[0]?.settings.workSystem.standardDayMinutes).toBe(420);
  });

  it("フレックスのままでも、対象月より前の所定労働時間の変更が反映される", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await appendWorkPolicyVersion(db, {
      tenantId,
      effectiveFrom: "2026-06-01",
      kind: "flex",
      standardDayMinutes: 450,
    });

    const timeline = await buildSettingsTimeline(db, {
      tenantId,
      userId,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });

    // 制度は変わらず所定労働時間だけが変わるケース。有給の分数換算に効くため、
    // 見落とすと有給1日の枠算入が旧値のままになる。
    expect(timeline[0]?.settings.workSystem.standardDayMinutes).toBe(450);
  });

  it("対象期間の途中で切り替わる場合は、切り替え日で span が分かれる", async () => {
    const { db, tenantId, userId } = await setupTestDb();

    await appendWorkPolicyVersion(db, {
      tenantId,
      effectiveFrom: "2026-08-16",
      kind: "fixed",
      standardDayMinutes: 480,
    });

    const timeline = await buildSettingsTimeline(db, {
      tenantId,
      userId,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });

    expect(timeline.map((s) => s.from)).toEqual(["1970-01-01", "2026-08-16"]);
    expect(timeline[0]?.settings.workSystem.kind).toBe("flex");
    expect(timeline[1]?.settings.workSystem.kind).toBe("fixed");
  });
});
