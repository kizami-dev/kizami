/**
 * 定期スキャンの実行(src/scheduled-jobs.ts)と、Workers の Cron の対応表(src/workers-cron.ts)の検査。
 *
 * - 対応表: Node のワーカーが走らせる全スキャンに Workers の cron 式がちょうど1本ずつあること、
 *   apps/api/wrangler.jsonc の `triggers.crons` と対応表のキーが一字一句一致すること
 *   (`controller.cron` は設定の文字列のまま届くので、ずれると黙って何も走らない)
 * - runWorkersCron: cron 式に対応するスキャンだけが走り、予定時刻を「今」にし、同じ予定時刻の再起動で通知が増えないこと
 * - runScanJob: スキャンが例外で終わっても投げず、失敗を返してエラー報告に回すこと
 *
 * workerd + D1 で実物の `scheduled()` を叩く確認は test/workers/scheduled.test.ts(`pnpm test:workers`)。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { insertPunchEvent, listNotifications, listWorkerHeartbeats, type Database } from "@kizami/db";
import { noopErrorReporter, type ErrorReporter } from "../src/lib/error-report.js";
import { runScanJob, SCAN_JOB_ORDER, SCAN_JOBS, type ScanJobContext } from "../src/scheduled-jobs.js";
import { jobsForCron, runWorkersCron, WORKERS_CRON_SCHEDULE, type WorkersCronDeps } from "../src/workers-cron.js";
import { jstMinutes, setupTestDb } from "./support/setup.js";

/** JSONC(コメント・末尾カンマ付きの JSON)を読む。文字列の中の `//` は残す。 */
function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const wranglerPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const wrangler = parseJsonc(readFileSync(wranglerPath, "utf8")) as { triggers?: { crons?: string[] } };

describe("Workers の Cron の対応表", () => {
  it("Node のワーカーが走らせる全スキャンに、Workers の cron 式がちょうど1本ずつある", () => {
    const mapped = Object.values(WORKERS_CRON_SCHEDULE).flat();
    expect([...mapped].sort()).toEqual([...SCAN_JOB_ORDER].sort());
    expect(new Set(mapped).size).toBe(mapped.length);
    // SCAN_JOB_ORDER(Node の順)にも漏れが無い
    expect([...SCAN_JOB_ORDER].sort()).toEqual(Object.values(SCAN_JOBS).sort());
  });

  it("wrangler.jsonc の triggers.crons と対応表のキーが一字一句一致する", () => {
    expect([...(wrangler.triggers?.crons ?? [])].sort()).toEqual(Object.keys(WORKERS_CRON_SCHEDULE).sort());
  });

  it("どれも 15 分ごと(Node の既定の REMINDER_INTERVAL_MINUTES と同じ周期)で、開始の分が重ならない", () => {
    const starts = new Set<number>();
    for (const cron of Object.keys(WORKERS_CRON_SCHEDULE)) {
      const [minute, ...rest] = cron.split(" ");
      expect(rest).toEqual(["*", "*", "*", "*"]);
      const minutes = (minute as string).split(",").map(Number);
      expect(minutes).toHaveLength(4);
      for (let i = 1; i < minutes.length; i++) expect((minutes[i] as number) - (minutes[i - 1] as number)).toBe(15);
      for (const m of minutes) {
        expect(starts.has(m)).toBe(false);
        starts.add(m);
      }
    }
  });

  it("対応の無い cron 式は undefined(継承されたプロパティ名にも反応しない)", () => {
    expect(jobsForCron("*/5 * * * *")).toBeUndefined();
    expect(jobsForCron("constructor")).toBeUndefined();
    expect(jobsForCron("0,15,30,45 * * * *")).toEqual([SCAN_JOBS.reminder]);
  });
});

// JST 2026-04-15 12:00(reminders.test.ts と同じ)
const SCHEDULED_TIME = Date.UTC(2026, 3, 15, 3, 0);
const NOW_MINUTES = Math.floor(SCHEDULED_TIME / 60_000);

function cronDeps(db: Database, errorReporter: ErrorReporter = noopErrorReporter): WorkersCronDeps {
  return { db, personalChannelOptions: {}, notifyDeps: {}, withdrawalMailer: null, errorReporter };
}

describe("runWorkersCron", () => {
  it("打刻忘れの cron 式で打刻忘れのスキャンだけが走り、予定時刻を「今」にして通知を作る", async () => {
    const { db, tenantId, userId } = await setupTestDb();
    const clockInAt = jstMinutes(2026, 4, 1, 9, 0);
    await insertPunchEvent(db, { tenantId, userId, kind: "clock_in", occurredAt: clockInAt, recordedAt: clockInAt, source: "web", actorId: userId });

    // 偽タイマーは使わない: 壁時計(実時刻)は予定時刻から離れているので、通知の createdAt で scheduledTime が使われたと分かる
    const result = await runWorkersCron({ cron: "0,15,30,45 * * * *", scheduledTime: SCHEDULED_TIME, deps: cronDeps(db) });

    expect(result).toMatchObject({ unknownCron: false, nowMinutes: NOW_MINUTES });
    expect(result.outcomes.map((o) => [o.job, o.ok])).toEqual([[SCAN_JOBS.reminder, true]]);
    expect(result.outcomes[0]?.counts).toEqual({ scanned: 1, created: 1 });
    const notifications = await listNotifications(db, { tenantId, userId });
    expect(notifications.map((n) => [n.type, n.subjectDate, n.createdAt])).toEqual([["missing_clock_out", "2026-04-01", NOW_MINUTES]]);
    expect(await listWorkerHeartbeats(db)).toEqual([
      { jobName: SCAN_JOBS.reminder, lastRunAt: NOW_MINUTES, lastResult: "success", successCount: 1, failureCount: 0 },
    ]);

    // 再試行・二重起動(同じ予定時刻): 通知は増えない
    await runWorkersCron({ cron: "0,15,30,45 * * * *", scheduledTime: SCHEDULED_TIME, deps: cronDeps(db) });
    expect(await listNotifications(db, { tenantId, userId })).toHaveLength(1);
  });

  it("対応の無い cron 式では何も走らせない", async () => {
    const { db } = await setupTestDb();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await runWorkersCron({ cron: "*/5 * * * *", scheduledTime: SCHEDULED_TIME, deps: cronDeps(db) });
      expect(result).toMatchObject({ unknownCron: true, outcomes: [] });
      expect(await listWorkerHeartbeats(db)).toEqual([]);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('no scan is mapped to cron "*/5 * * * *"'));
    } finally {
      errors.mockRestore();
    }
  });
});

describe("runScanJob", () => {
  it("スキャンが例外で終わっても投げず、失敗を返してエラー報告に回す(心拍の書き込みの失敗も握る)", async () => {
    // どの操作でも投げる DB(DB が落ちている状況)
    const brokenDb = new Proxy({}, { get: () => { throw new Error("db is down"); } }) as unknown as Database;
    const captured: Array<{ error: unknown; job: string | undefined }> = [];
    const errorReporter: ErrorReporter = { capture: (error, context) => captured.push({ error, job: context?.job }) };
    const ctx: ScanJobContext = {
      db: brokenDb,
      nowMinutes: NOW_MINUTES,
      resolveChannels: async () => [],
      notifyDeps: {},
      withdrawalMailer: null,
      errorReporter,
      logPrefix: "[test]",
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const job of SCAN_JOB_ORDER) {
        const outcome = await runScanJob(job, ctx);
        expect(outcome).toMatchObject({ job, ok: false });
      }
    } finally {
      errors.mockRestore();
    }
    expect(captured.map((c) => c.job)).toEqual([...SCAN_JOB_ORDER]);
    expect(captured.every((c) => c.error instanceof Error && c.error.message === "db is down")).toBe(true);
  });
});
