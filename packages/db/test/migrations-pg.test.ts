/**
 * migrations-pg/ の生成物に対するガード。
 *
 * drizzle-kit の素の出力は FK を `REFERENCES "public"."tenants"("id")` と public 決め打ちで
 * 吐くが、KIZAMI は scripts/generate-pg.mjs でこれを剥がして search_path 依存にしている
 * (理由はそのファイルの冒頭コメント)。`pnpm generate:pg` を通さずに drizzle-kit を直接
 * 叩くと剥がし忘れが起きるので、ここで検出する。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = new URL("../migrations-pg", import.meta.url).pathname;

describe("migrations-pg", () => {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));

  it("マイグレーションが1つ以上ある", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: スキーマ修飾(\"public\".)を含まない", (file) => {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    expect(sql).not.toContain('"public".');
  });
});
