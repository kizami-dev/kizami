/**
 * 全データのエクスポートを流しながら返す部分(lib/tenant-export-archive.ts、2026-10-06)。
 * zip の中身の大筋・秘密を含まない・監査ログは tenant-withdrawal.test.ts が見る。ここでは次を守る:
 *
 * 1. 中身が従来の「全部読んでから zipSync」と同じ意味であること — 全テーブルの JSON が
 *    `JSON.stringify(exportTenantData の行, null, 2)` と1バイトも違わず、manifest の行数が実際の行数と
 *    一致し、月ごとの集計が汎用CSVと同じ。README が先頭、manifest が末尾
 * 2. ページの大きさを行数より小さくしても(batchSize 3)、同じバイト列になる
 * 3. 同時に走る本数: 同じテナントは1本、プロセス全体で2本まで(超えたら 429 `export_busy`、Retry-After: 30)。
 *    読み終える・相手が切る・読まれないまま時間切れ・全体の期限・途中で失敗する・ストリームを作る前の
 *    失敗、のいずれでも枠が返る
 */

import { strFromU8, unzipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  exportTenantData,
  insertPunchEvent,
  listTenantExportTables,
  listTenantUsers,
  TENANT_PURGE_ORDER,
  userPolicyAssignments,
  users,
  uuidv7,
  workPolicies,
  type Database,
} from "@kizami/db";
import { createApp } from "../src/app.js";
import { createTenantExportStream, tryAcquireTenantExportSlot } from "../src/lib/tenant-export-archive.js";
import { bootstrapTenant } from "../src/lib/tenant-bootstrap.js";
import { buildGenericAttendanceCsv } from "../src/routes/exports.js";
import { grantPermission, jstMinutes, loginAndGetCookie, setupSecondUser, setupTestDb } from "./support/setup.js";

const FIXED_NOW = new Date("2026-06-15T03:00:00.000Z");
const NOW_MINUTES = Math.floor(FIXED_NOW.getTime() / 60_000);

interface Harness {
  db: Database;
  app: ReturnType<typeof createApp>;
  tenantId: string;
  cookie: string;
}

/** 管理者(tenant.withdraw を持つ)と、5月・6月に打刻のある従業員のいるテナント。 */
async function harness(): Promise<Harness> {
  const seeded = await setupTestDb();
  const { db, tenantId } = seeded;
  await grantPermission(db, { tenantId, userId: seeded.userId, permission: "tenant.withdraw", scope: "tenant" });
  const member = await setupSecondUser(db, tenantId);
  const [policy] = await db.select().from(workPolicies).where(eq(workPolicies.tenantId, tenantId)).limit(1);
  await db.insert(userPolicyAssignments).values({ id: uuidv7(), tenantId, userId: member.userId, workPolicyId: policy!.id, effectiveFrom: "1970-01-01", createdAt: 0 });
  await db.update(users).set({ hireDate: "2025-12-15" }).where(eq(users.tenantId, tenantId));
  // 打刻は 8日分 × 4件 = 32件(batchSize 3 で何ページにも分かれる)
  for (const [month, day] of [
    [5, 1],
    [5, 12],
    [5, 13],
    [5, 14],
    [6, 1],
    [6, 2],
    [6, 3],
    [6, 4],
  ] as const) {
    for (const [kind, hour] of [
      ["clock_in", 9],
      ["break_start", 12],
      ["break_end", 13],
      ["clock_out", 18],
    ] as const) {
      const at = jstMinutes(2026, month, day, hour, 0);
      await insertPunchEvent(db, { id: uuidv7(), tenantId, userId: member.userId, kind, occurredAt: at, recordedAt: at, source: "web", actorId: member.userId });
    }
  }
  const app = createApp({ db });
  const cookie = await loginAndGetCookie(app, seeded.email, seeded.password);
  return { db, app, tenantId, cookie };
}

/** 同じ DB に別のテナント(tenant.withdraw を持つ管理者)を作ってログインする。 */
async function otherTenant(h: Harness, label: string): Promise<{ tenantId: string; cookie: string }> {
  const email = `${label}-admin@example.com`;
  const password = `${label} horse battery staple`;
  const created = await bootstrapTenant(h.db, { tenantName: `${label} 株式会社`, adminEmail: email, adminPassword: password, now: 0 });
  await grantPermission(h.db, { tenantId: created.tenantId, userId: created.userId, permission: "tenant.withdraw", scope: "tenant" });
  return { tenantId: created.tenantId, cookie: await loginAndGetCookie(h.app, email, password) };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("全データのエクスポート(ストリーミング)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("全テーブルの JSON が従来の JSON.stringify と1バイトも違わず、manifest の行数・月ごとの集計も一致する。README が先頭、manifest が末尾", async () => {
    const h = await harness();
    const res = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBeNull();
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files);
    expect(names[0]).toBe("README.txt");
    expect(names[names.length - 1]).toBe("manifest.json");

    // 流し始める前に監査ログを書くので、data/audit_logs.json にもその行が入っている(読み直した結果と同じ)
    const whole = (await exportTenantData(h.db, h.tenantId))!;
    const { tables } = listTenantExportTables();
    // 削除の対象の全テーブル(出さないものを除く)+ tenants
    expect(tables).toHaveLength(TENANT_PURGE_ORDER.length + 1 - whole.excludedTables.length);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as {
      tables: Array<{ name: string; rows: number; file: string }>;
      excludedTables: Array<{ name: string; reason: string }>;
      attendance: { months: string[]; monthlyCsvCount: number; dailyCsvCount: number };
    };
    expect(manifest.excludedTables).toEqual(whole.excludedTables);
    for (const table of whole.tables) {
      const file = files[`data/${table.name}.json`];
      expect(file, table.name).toBeDefined();
      expect(strFromU8(file!), table.name).toBe(JSON.stringify(table.rows, null, 2));
      expect(manifest.tables.find((t) => t.name === table.name)?.rows, table.name).toBe(table.rows.length);
    }
    expect(manifest.tables.map((t) => t.name)).toEqual(whole.tables.map((t) => t.name));
    expect(whole.tables.find((t) => t.name === "punch_events")!.rows).toHaveLength(32);

    // 月ごとの集計は汎用CSVと同じ。最初の打刻(5/1 9:00)の1日前の月(4月)から今月(6月)まで途切れなく
    expect(manifest.attendance.months).toEqual(["2026-04", "2026-05", "2026-06"]);
    const members = await listTenantUsers(h.db, h.tenantId);
    for (const ym of manifest.attendance.months) {
      const [year, month] = ym.split("-").map(Number) as [number, number];
      const expected = await buildGenericAttendanceCsv(h.db, { tenantId: h.tenantId, year, month, targetUsers: members });
      // バイト列で比べる(strFromU8 は TextDecoder なので先頭の BOM を落とす)
      expect(Buffer.from(files[`attendance/monthly/${ym}.csv`]!).equals(Buffer.from(expected.body, "utf8")), ym).toBe(true);
    }
    expect(manifest.attendance.monthlyCsvCount).toBe(3);
    expect(names.filter((n) => n.startsWith("attendance/daily/"))).toHaveLength(manifest.attendance.dailyCsvCount);
    const daily = strFromU8(files[names.find((n) => n.startsWith("attendance/daily/2026-05/Second User_"))!]!);
    expect(daily).toContain("2026-05-12,2026-05-12 09:00,2026-05-12 18:00");

    // 監査ログは流し始める前に1件(数は入れない。中身も入れない)
    const logs = await h.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, h.tenantId), eq(auditLogs.action, "tenant.export")));
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!.afterDigest!)).toEqual({ format: "kizami-tenant-export", formatVersion: 1, recordedAt: "start" });
  });

  it("1ページの行数を行数より小さくしても(batchSize 3)、既定のページの大きさと同じ zip の中身になる", async () => {
    const h = await harness();
    const releases = { small: 0, normal: 0 };
    const small = unzipSync(
      await readAll(createTenantExportStream(h.db, { tenantId: h.tenantId, now: NOW_MINUTES, batchSize: 3, release: () => (releases.small += 1) }).stream),
    );
    const normal = unzipSync(await readAll(createTenantExportStream(h.db, { tenantId: h.tenantId, now: NOW_MINUTES, release: () => (releases.normal += 1) }).stream));
    expect(Object.keys(small)).toEqual(Object.keys(normal));
    for (const name of Object.keys(normal)) expect(strFromU8(small[name]!), name).toBe(strFromU8(normal[name]!));
    expect(releases).toEqual({ small: 1, normal: 1 });
  });

  it("同じテナントの2本目は 429 export_busy(Retry-After: 30)。別のテナントは同時に1本使え、3本目(プロセスの上限)は 429。読み終えれば次が通る", async () => {
    const h = await harness();
    const other = await otherTenant(h, "other");
    const third = await otherTenant(h, "third");
    const first = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(first.status).toBe(200);

    const sameTenant = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(sameTenant.status).toBe(429);
    expect(sameTenant.headers.get("retry-after")).toBe("30");
    expect(await sameTenant.json()).toEqual({ error: "export_busy" });

    // 別のテナントは、1本目が枠を握っていても使える(プロセス全体で2本まで)
    const otherRes = await h.app.request("/tenant/export", { headers: { cookie: other.cookie } });
    expect(otherRes.status).toBe(200);
    // 3つ目のテナントは、プロセス全体の上限(2本)で断られる
    const thirdRes = await h.app.request("/tenant/export", { headers: { cookie: third.cookie } });
    expect(thirdRes.status).toBe(429);
    expect(await thirdRes.json()).toEqual({ error: "export_busy" });

    // 読み終えると枠が返る
    unzipSync(new Uint8Array(await first.arrayBuffer()));
    unzipSync(new Uint8Array(await otherRes.arrayBuffer()));
    const again = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(again.status).toBe(200);
    unzipSync(new Uint8Array(await again.arrayBuffer()));
    const thirdAgain = await h.app.request("/tenant/export", { headers: { cookie: third.cookie } });
    expect(thirdAgain.status).toBe(200);
    await thirdAgain.arrayBuffer();

    // 429 の回は監査ログを残さない(何も出していない)
    const logs = await h.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, h.tenantId), eq(auditLogs.action, "tenant.export")));
    expect(logs).toHaveLength(2);
  });

  it("相手が途中で切る(cancel)と枠が返る", async () => {
    const h = await harness();
    const first = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(first.status).toBe(200);
    const reader = first.body!.getReader();
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    expect((await h.app.request("/tenant/export", { headers: { cookie: h.cookie } })).status).toBe(429);

    await reader.cancel();
    const again = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(again.status).toBe(200);
    unzipSync(new Uint8Array(await again.arrayBuffer()));
  });

  it("一度も読まずに切っても枠が返る", async () => {
    const h = await harness();
    const first = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    await first.body!.cancel();
    const again = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(again.status).toBe(200);
    await again.arrayBuffer();
  });

  it("ストリームを作る前の失敗(監査ログの書き込みの例外)では 500 になり、枠を漏らさない", async () => {
    const h = await harness();
    // audit_logs への INSERT だけを失敗させる(ログインのセッションの確認などは通す)
    const failingDb = new Proxy(h.db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop === "insert") {
          return (table: unknown) => {
            if (table === auditLogs) throw new Error("audit write failed");
            return (value as (t: unknown) => unknown).call(target, table);
          };
        }
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const failingApp = createApp({ db: failingDb });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      // 枠を漏らしていれば2回目からは 429 になる
      expect((await failingApp.request("/tenant/export", { headers: { cookie: h.cookie } })).status).toBe(500);
    }
    // 500 の原因は監査ログの書き込み(枠を取った後の失敗)であること
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: "audit write failed" }));
    errors.mockRestore();
    const ok = await h.app.request("/tenant/export", { headers: { cookie: h.cookie } });
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
  });

  it("次を読みに来ないまま時間が過ぎると打ち切り(console.warn)、枠を返す。別のテナントがその後に使える", async () => {
    const h = await harness();
    const slot = tryAcquireTenantExportSlot(h.tenantId);
    if (!slot.ok) throw new Error("slot should be free");
    let released = 0;
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stream } = createTenantExportStream(h.db, {
      tenantId: h.tenantId,
      now: NOW_MINUTES,
      idleTimeoutMs: 50,
      release: () => {
        released += 1;
        slot.release();
      },
    });
    // 1つだけ読んで、あとは読まない
    const reader = stream.getReader();
    expect((await reader.read()).done).toBe(false);
    expect(tryAcquireTenantExportSlot(h.tenantId)).toEqual({ ok: false, reason: "tenant_busy" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(released).toBe(1);
    expect(warns).toHaveBeenCalledWith(expect.stringContaining(`idle timeout`));
    expect(warns).toHaveBeenCalledWith(expect.stringContaining(h.tenantId));
    await expect(reader.read()).rejects.toThrow(/idle timeout/);
    warns.mockRestore();

    const other = await otherTenant(h, "other");
    const res = await h.app.request("/tenant/export", { headers: { cookie: other.cookie } });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });

  it("ゆっくりでも読み続ける相手は、全体の期限で打ち切って枠を返す", async () => {
    const h = await harness();
    let released = 0;
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stream } = createTenantExportStream(h.db, {
      tenantId: h.tenantId,
      now: NOW_MINUTES,
      idleTimeoutMs: 1_000, // 読まれない時間の上限には掛からない
      deadlineMs: 150,
      release: () => (released += 1),
    });
    const reader = stream.getReader();
    let chunks = 0;
    const read = (async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) return "completed";
        chunks += 1;
        await new Promise((resolve) => setTimeout(resolve, 20)); // 20 ミリ秒に1回だけ読む
      }
    })();
    await expect(read).rejects.toThrow(/deadline exceeded/);
    expect(chunks).toBeGreaterThan(1);
    expect(released).toBe(1);
    expect(warns).toHaveBeenCalledWith(expect.stringContaining("deadline exceeded"));
    warns.mockRestore();
  });

  it("途中で失敗するとストリームをエラーにし(壊れたダウンロード)、枠を返す", async () => {
    const h = await harness();
    // 4回目以降の SELECT を失敗させる(README と最初のいくつかのテーブルを流した後で落ちる)
    let selects = 0;
    const failing = new Proxy(h.db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop === "select") {
          return (...args: unknown[]) => {
            selects += 1;
            if (selects > 3) throw new Error("boom");
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let released = 0;
    const { stream } = createTenantExportStream(failing, { tenantId: h.tenantId, now: NOW_MINUTES, release: () => (released += 1) });
    await expect(readAll(stream)).rejects.toThrow("boom");
    expect(released).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("failed while streaming"), expect.any(Error));
    errors.mockRestore();
  });
});
