/**
 * apps/api が PostgreSQL でも起動し、マイグレーション適用 → 認証 → 打刻 → 集計まで通ることの
 * スモークテスト(要件: DB は SQLite 既定 + PostgreSQL 選択式)。
 *
 * apps/api の本体テスト群は従来どおり SQLite(一時ファイル)で走らせる — API 層の分岐は
 * ダイアレクトに一切依存せず(依存するのは packages/db だけ)、そちらは packages/db 側で
 * 全テストが両ダイアレクトで走っているため、ここは「apps/api の起動経路が PostgreSQL でも
 * 動く」ことだけを見れば足りる(判断点 2026-08-24、docs/design/db-dialects.md)。
 *
 * 実行方法:
 *   docker run --rm -d -p 15432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kizami postgres:17-alpine
 *   TEST_PG_URL=postgres://postgres:test@localhost:15432/kizami pnpm --filter @kizami/api test
 * TEST_PG_URL 未設定なら skip する(Docker が無い環境でも緑になる)。
 */

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDb, resolveDialect } from "@kizami/db";
import { createApp } from "../src/app.js";
import { loginAndGetCookie, setupTestDb } from "./support/setup.js";

const pgUrl = process.env.TEST_PG_URL;
const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z"); // JST 正午

if (pgUrl === undefined) {
  console.log(
    "[@kizami/api] TEST_PG_URL is not set — skipping the PostgreSQL boot smoke test.\n" +
      "              docker run --rm -d -p 15432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kizami postgres:17-alpine\n" +
      "              TEST_PG_URL=postgres://postgres:test@localhost:15432/kizami pnpm --filter @kizami/api test",
  );
}

describe.skipIf(pgUrl === undefined)("apps/api boots against PostgreSQL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("マイグレーション適用 → ログイン → 打刻 → 勤務状態の取得まで通る", async () => {
    expect(resolveDialect(pgUrl)).toBe("postgres");

    // node.ts / worker.ts と同じ起動経路(DATABASE_URL を渡して migrateDb)。
    // スキーマだけはテスト同士がぶつからないよう分ける
    const schema = `kizami_apitest_${randomUUID().replaceAll("-", "")}`.slice(0, 40);
    const { db, dialect, client } = await migrateDb({ url: pgUrl!, pgSchema: schema, pgPoolMax: 2 });
    expect(dialect).toBe("postgres");

    try {
      // マイグレーションで全テーブルが出来ていること。期待数は migrations-pg/*.sql の
      // CREATE TABLE 数から導出する(固定数だとスキーマ追加のたびにここが落ちる —
      // しかもローカルは TEST_PG_URL 無しで PG レグがスキップされるため CI でしか発覚しない、
      // という形で 2026-08-24 に実際に踏んだ。動的導出なら drift は packages/db の
      // schema-drift テストと migrate.test.ts のテーブル一覧が守る)
      const migrationsPgDir = fileURLToPath(new URL("../../../packages/db/migrations-pg/", import.meta.url));
      const expectedTableCount = readdirSync(migrationsPgDir)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => readFileSync(join(migrationsPgDir, f), "utf8"))
        .join("\n")
        .match(/CREATE TABLE /g)!.length;
      const tables = await client.execute(
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename != '__drizzle_migrations'",
      );
      expect(tables.rows.length).toBe(expectedTableCount);

      const { email, password } = await setupTestDb(db);
      const app = createApp({ db });
      const cookie = await loginAndGetCookie(app, email, password);

      const clockIn = await app.request("/punches", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind: "clock_in", occurredAt: Math.floor(FIXED_NOW.getTime() / 60_000) - 60 }),
      });
      expect(clockIn.status).toBe(201);

      const status = await app.request("/attendance/status", { headers: { cookie } });
      expect(status.status).toBe(200);
      expect(((await status.json()) as { state: string }).state).toBe("working");

      const monthly = await app.request("/attendance/monthly?month=2026-06", { headers: { cookie } });
      expect(monthly.status).toBe(200);
    } finally {
      // テスト用スキーマは残さない(同じ DB を packages/db のテストと共用できるように)
      await client.execute(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.close();
    }
  });
});
