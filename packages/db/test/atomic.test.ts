/**
 * src/atomic.ts(atomic plan)のテスト。**3レグ(SQLite / PostgreSQL / D1)すべてで走る** —
 * D1 で原子的な複数文書き込みを成り立たせるための土台なので、supportsTransactions で外さない。
 *
 * 固定していること:
 * - ガードが失敗したら、ガードより **前** の文も含めて何も書かれない(ロールバック)
 * - ガードが通れば全文が書かれ、結果は文ごとにコミット後に取り出せる
 * - UNIQUE 違反などの通常のエラーはそのまま投げられ、isUniqueConstraintError で判定できる
 * - SQLite / D1 のガードの前提である `changes()` の意味(batch の中で「直前に完了した書き込み文」
 *   の変更行数を返し、SELECT では上書きされない)— D1 の実装が変わったらここが落ちる
 */
import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AtomicPlan,
  chunkRowsForInsert,
  D1_MAX_BOUND_PARAMETERS,
  insertSelectWhere,
  runAtomic,
} from "../src/atomic.js";
import { isUniqueConstraintError } from "../src/errors.js";
import { closingSnapshots, tenants } from "../src/schema/index.js";
import { isPostgresTestRun, migrateDb, type Database } from "./support/db.js";

async function tenantNames(db: Database): Promise<Array<{ id: string; name: string }>> {
  return db.select({ id: tenants.id, name: tenants.name }).from(tenants).orderBy(asc(tenants.id));
}

describe("atomic plan (runAtomic)", () => {
  let db: Database;

  beforeEach(async () => {
    ({ db } = await migrateDb());
    await db.insert(tenants).values({ id: "t1", name: "before", createdAt: 0 });
  });

  it("an empty plan is a no-op that succeeds", async () => {
    const result = await runAtomic(db, new AtomicPlan());
    expect(result.ok).toBe(true);
  });

  it("runs every statement and returns per-statement results after commit (guard results do not shift refs)", async () => {
    const plan = new AtomicPlan();
    const claim = plan.add((q) => q.update(tenants).set({ name: "claimed" }).where(eq(tenants.id, "t1")).returning());
    plan.guard("test.claim");
    const inserted = plan.add((q) => q.insert(tenants).values({ id: "t2", name: "dependent", createdAt: 0 }).returning());

    const result = await runAtomic(db, plan);
    if (!result.ok) throw new Error(`unexpected guard failure: ${result.failedGuard}`);
    expect(result.get(claim).map((r) => r.name)).toEqual(["claimed"]);
    expect(result.get(inserted).map((r) => r.id)).toEqual(["t2"]);
    expect(await tenantNames(db)).toEqual([
      { id: "t1", name: "claimed" },
      { id: "t2", name: "dependent" },
    ]);
  });

  it("a failed guard writes nothing — not even the statements before the guard", async () => {
    const plan = new AtomicPlan();
    // ガードより前の無条件の書き込み(ロールバックされるべき)
    plan.add((q) => q.insert(tenants).values({ id: "t0", name: "before-guard", createdAt: 0 }));
    // claim: 期待する状態(name = 'expected')ではないので 0 行
    plan.add((q) =>
      q.update(tenants).set({ name: "claimed" }).where(sql`${tenants.id} = 't1' and ${tenants.name} = 'expected'`).returning(),
    );
    plan.guard("test.claim");
    plan.add((q) => q.insert(tenants).values({ id: "t2", name: "dependent", createdAt: 0 }));
    plan.add((q) => q.update(tenants).set({ name: "dependent-update" }).where(eq(tenants.id, "t1")));

    const result = await runAtomic(db, plan);
    expect(result).toEqual({ ok: false, failedGuard: "test.claim" });
    expect(await tenantNames(db)).toEqual([{ id: "t1", name: "before" }]);
  });

  it("reports which guard failed when there are several", async () => {
    const plan = new AtomicPlan();
    plan.add((q) => q.update(tenants).set({ name: "first" }).where(eq(tenants.id, "t1")));
    plan.guard("test.first");
    plan.add((q) => q.update(tenants).set({ name: "second" }).where(eq(tenants.id, "missing")));
    plan.guard("test.second");

    expect(await runAtomic(db, plan)).toEqual({ ok: false, failedGuard: "test.second" });
    expect(await tenantNames(db)).toEqual([{ id: "t1", name: "before" }]);
  });

  it("a guard after a non-returning update uses the affected row count (passes when > 0)", async () => {
    const plan = new AtomicPlan();
    plan.add((q) => q.update(tenants).set({ name: "claimed" }).where(eq(tenants.id, "t1")));
    plan.guard("test.claim");
    plan.add((q) => q.insert(tenants).values({ id: "t2", name: "dependent", createdAt: 0 }));

    expect((await runAtomic(db, plan)).ok).toBe(true);
    expect((await tenantNames(db)).map((r) => r.id)).toEqual(["t1", "t2"]);
  });

  it("insertSelectWhere inserts only when the condition holds, and a guard turns 'no row' into a failed plan", async () => {
    const insertIfAbsent = (id: string) => {
      const plan = new AtomicPlan();
      const ref = plan.add((q) =>
        insertSelectWhere(
          q,
          tenants,
          { id, name: `n-${id}`, createdAt: 7 },
          sql`not exists (select 1 from ${tenants} where ${tenants.name} = ${`n-${id}`})`,
        ).returning(),
      );
      plan.guard("test.absent");
      plan.add((q) => q.update(tenants).set({ name: "touched" }).where(eq(tenants.id, "t1")));
      return { plan, ref };
    };

    const first = insertIfAbsent("t2");
    const ok = await runAtomic(db, first.plan);
    if (!ok.ok) throw new Error("expected the first insert to succeed");
    const [row] = ok.get(first.ref);
    // 既定値(isSmallOrMediumEnterprise 等)も values() と同じ規則で埋まる
    expect(row).toMatchObject({ id: "t2", name: "n-t2", createdAt: 7, isSmallOrMediumEnterprise: true, personalDataRetentionYears: 5 });

    // 同じ name の行がもう有るので条件が偽 → 0 行 → ガードで全体が失敗し、後続の update も書かれない
    await db.update(tenants).set({ name: "before" }).where(eq(tenants.id, "t1"));
    expect(await runAtomic(db, insertIfAbsent("t2").plan)).toEqual({ ok: false, failedGuard: "test.absent" });
    expect(await tenantNames(db)).toEqual([
      { id: "t1", name: "before" },
      { id: "t2", name: "n-t2" },
    ]);
  });

  it("a UNIQUE violation inside the plan rolls everything back and is recognised by isUniqueConstraintError", async () => {
    const plan = new AtomicPlan();
    plan.add((q) => q.update(tenants).set({ name: "claimed" }).where(eq(tenants.id, "t1")));
    plan.guard("test.claim");
    plan.add((q) => q.insert(tenants).values({ id: "t1", name: "duplicate pk", createdAt: 0 }));

    await expect(runAtomic(db, plan)).rejects.toSatisfy((err: unknown) => isUniqueConstraintError(err));
    expect(await tenantNames(db)).toEqual([{ id: "t1", name: "before" }]);
  });

  it("rejects a guard that does not directly follow a write statement", async () => {
    expect(() => new AtomicPlan().guard("test.nothing")).toThrow(/must directly follow/);
    const plan = new AtomicPlan();
    plan.add((q) => q.select().from(tenants));
    plan.guard("test.after-select");
    await expect(runAtomic(db, plan)).rejects.toThrow(/must follow an insert\/update\/delete/);
  });

  it("rejects guard labels that are not safe to embed in SQL", () => {
    const plan = new AtomicPlan();
    plan.add((q) => q.update(tenants).set({ name: "x" }).where(eq(tenants.id, "t1")));
    expect(() => plan.guard("bad'label")).toThrow(/label must match/);
  });

  it("serialize() is accepted on every dialect (advisory lock on PostgreSQL, no-op on SQLite/D1)", async () => {
    const plan = new AtomicPlan();
    plan.serialize("test:key");
    plan.add((q) => q.update(tenants).set({ name: "serialized" }).where(eq(tenants.id, "t1")));
    plan.guard("test.claim");
    expect((await runAtomic(db, plan)).ok).toBe(true);
    expect(await tenantNames(db)).toEqual([{ id: "t1", name: "serialized" }]);
  });

  it("concurrent claims of the same row: exactly one plan wins, the loser writes nothing", async () => {
    const attempt = (id: string) => {
      const plan = new AtomicPlan();
      plan.add((q) =>
        q.update(tenants).set({ name: `claimed-by-${id}` }).where(sql`${tenants.id} = 't1' and ${tenants.name} = 'before'`).returning(),
      );
      plan.guard("test.claim");
      plan.add((q) => q.insert(tenants).values({ id, name: "dependent", createdAt: 0 }));
      return runAtomic(db, plan);
    };

    const results = await Promise.all([attempt("ta"), attempt("tb")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, failedGuard: "test.claim" }]);
    const rows = await tenantNames(db);
    // 勝った側の claim と依存行だけが残る
    expect(rows).toHaveLength(2);
    const winner = rows.find((r) => r.id !== "t1");
    expect(rows.find((r) => r.id === "t1")?.name).toBe(`claimed-by-${winner?.id}`);
  });
});

describe("chunkRowsForInsert", () => {
  it("splits rows so that one statement binds at most 100 parameters (all table columns per row)", () => {
    // closing_snapshots は6列 → 1文 16 行
    const rows = Array.from({ length: 40 }, (_, i) => i);
    const chunks = chunkRowsForInsert(closingSnapshots, rows);
    expect(chunks.map((c) => c.length)).toEqual([16, 16, 8]);
    expect(Math.max(...chunks.map((c) => c.length)) * 6).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    expect(chunkRowsForInsert(closingSnapshots, [])).toEqual([]);
  });

  it("a many-row insert split this way succeeds inside one plan on every dialect", async () => {
    const { db } = await migrateDb();
    const rows = Array.from({ length: 45 }, (_, i) => ({ id: `t${String(i).padStart(3, "0")}`, name: `n${i}`, createdAt: i }));
    const plan = new AtomicPlan();
    for (const chunk of chunkRowsForInsert(tenants, rows)) plan.add((q) => q.insert(tenants).values(chunk));
    expect(plan.size).toBeGreaterThan(1);
    expect((await runAtomic(db, plan)).ok).toBe(true);
    expect(await db.select({ id: tenants.id }).from(tenants)).toHaveLength(45);
  });
});

// SQLite / D1 のガードの前提(spike の結果を固定する)。PostgreSQL に changes() は無い
describe.skipIf(isPostgresTestRun)("changes() inside a batch (SQLite / D1 guard premise)", () => {
  it("refers to the most recent completed write, is not reset by a SELECT, and is 0 after a no-op update", async () => {
    const { db } = await migrateDb();
    await db.insert(tenants).values({ id: "t1", name: "a", createdAt: 0 });
    const read = (label: string) => db.run(sql.raw(`SELECT changes() AS ${label}`));
    const results = (await db.batch([
      db.update(tenants).set({ name: "b" }).where(eq(tenants.id, "t1")).returning(),
      read("c1"),
      db.select().from(tenants),
      read("c2"),
      db.insert(tenants).values([
        { id: "t2", name: "x", createdAt: 0 },
        { id: "t3", name: "y", createdAt: 0 },
      ]),
      read("c3"),
      db.update(tenants).set({ name: "z" }).where(eq(tenants.id, "missing")),
      read("c4"),
    ])) as unknown[];
    // libSQL は ResultSet(rows[0][0])、D1 は D1Result(results[0].cN)で返る
    const value = (r: unknown): number => {
      const raw = r as { rows?: unknown[][]; results?: Record<string, unknown>[] };
      return Number(raw.results !== undefined ? Object.values(raw.results[0] ?? {})[0] : raw.rows?.[0]?.[0]);
    };
    expect([results[1], results[3], results[5], results[7]].map(value)).toEqual([1, 1, 2, 0]);
  });
});
