/**
 * PostgreSQL 用マイグレーション(migrations-pg/)の生成。
 *
 * drizzle-kit generate をそのまま使うと FK 句が `REFERENCES "public"."tenants"("id")` と
 * **public スキーマ決め打ち**で出力される。KIZAMI では次の2つの理由でこれを剥がす
 * (判断点 2026-08-24、詳細は docs/design/db-dialects.md):
 *
 * 1. 配備側の都合: PostgreSQL 運用では「KIZAMI 専用スキーマに入れて search_path で切り替える」
 *    のが普通で、public 決め打ちだとそれができない。非修飾にすれば search_path に従う
 * 2. テストの都合: packages/db のテストは1件ごとに専用スキーマを切って並列に走る
 *    (test/support/db.ts)。public 決め打ちだと全テストが同じ public を見てしまう
 *
 * drizzle-kit のスナップショット(migrations-pg/meta/)は触らないので、次回の差分生成は
 * これまでどおり動く。剥がし忘れは test/migrations-pg.test.ts が検出する。
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url).pathname;
const migrationsDir = join(packageRoot, "migrations-pg");

execFileSync("drizzle-kit", ["generate", "--config=drizzle.config.pg.ts"], { cwd: packageRoot, stdio: "inherit" });

for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
  const path = join(migrationsDir, file);
  const before = readFileSync(path, "utf8");
  const after = before.replaceAll('REFERENCES "public".', "REFERENCES ");
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`[generate:pg] unqualified public schema references in ${file}`);
  }
}
