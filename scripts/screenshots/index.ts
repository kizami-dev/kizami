/**
 * `pnpm screenshots` の本体。
 *
 * 一時的な API・Web を起動 → デモデータを投入 → Playwright で全画面撮影 → 一覧ページ生成 →
 * 後片付け、を1コマンドで行う。禁止事項(git操作・本番接続・packages/apps/api の機能変更)は
 * 一切行わない。apps/api への追加は apps/api/src/dev-screenshot-seed.ts(シード専用の新規
 * スクリプト)のみで、既存の routes/* 等は変更していない。
 *
 * Node 26 前提(mise exec 経由で起動する。package.json の "screenshots" スクリプト参照)。
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { captureAll } from "./capture.js";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_BASE_URL,
  API_PORT,
  OUTPUT_DIR,
  ROOT_DIR,
  TENANT_NAME,
  WEB_BASE_URL,
  WEB_PORT,
  makeRunDir,
  randomEncryptionKey,
} from "./config.js";
import { generateGallery } from "./gallery.js";
import { killPortStragglers, runCommand, startProcess, stopProcess, waitForHttp, type ManagedProcess } from "./procs.js";
import { seedHttp } from "./seed-http.js";
import { addMonths, fmtMonth, jstToday } from "./time.js";

interface ExtraSeedOutput {
  users: Array<{ key: string; id: string; email: string }>;
  departments: { hq: string; sales: string; dev: string };
}

async function main(): Promise<void> {
  const runDir = makeRunDir();
  const dbPath = path.join(runDir, "kizami.db");
  const apiDir = path.join(ROOT_DIR, "apps", "api");
  const webDir = path.join(ROOT_DIR, "apps", "web");

  const commonEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
  };
  const apiEnv: NodeJS.ProcessEnv = {
    ...commonEnv,
    PORT: String(API_PORT),
    CORS_ORIGIN: WEB_BASE_URL,
    COOKIE_SECURE: "false",
    KIZAMI_ENCRYPTION_KEY: randomEncryptionKey(),
  };

  const managed: ManagedProcess[] = [];

  try {
    console.log(`[screenshots] 一時DB: ${dbPath}`);

    console.log("[screenshots] [1/7] 管理者・テナントを投入し、Webを並行ビルド中...");
    await Promise.all([
      runCommand("pnpm", ["--filter", "@kizami/api", "run", "seed"], {
        cwd: ROOT_DIR,
        env: { ...commonEnv, SEED_EMAIL: ADMIN_EMAIL, SEED_PASSWORD: ADMIN_PASSWORD, SEED_TENANT_NAME: TENANT_NAME },
        logPrefix: "[seed]",
      }),
      runCommand("pnpm", ["--filter", "@kizami/web", "build"], {
        cwd: ROOT_DIR,
        env: { ...process.env, WAKU_PUBLIC_API_URL: API_BASE_URL },
        logPrefix: "[web build]",
      }),
    ]);

    console.log("[screenshots] [2/7] 追加ユーザー・部署・通知を直接投入中...");
    const extraSeedStdout = await runCommand("pnpm", ["--filter", "@kizami/api", "run", "dev:seed-screenshots"], {
      cwd: ROOT_DIR,
      env: { ...commonEnv, ADMIN_EMAIL },
      logPrefix: "[extra seed]",
    });
    const jsonLine = extraSeedStdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"))
      .pop();
    if (!jsonLine) throw new Error("dev-screenshot-seed.ts produced no parseable JSON output");
    const extra = JSON.parse(jsonLine) as ExtraSeedOutput;

    console.log("[screenshots] [3/7] APIサーバーを起動中...");
    const api = startProcess("api", "pnpm", ["--filter", "@kizami/api", "exec", "tsx", "src/node.ts"], {
      cwd: ROOT_DIR,
      env: apiEnv,
      logPrefix: "[api]",
    });
    managed.push(api);
    await waitForHttp(`${API_BASE_URL}/healthz`, { timeoutMs: 30_000 });

    console.log("[screenshots] [4/7] Webサーバーを起動中...");
    const web = startProcess("web", "pnpm", ["--filter", "@kizami/web", "exec", "waku", "start", "-p", String(WEB_PORT)], {
      cwd: ROOT_DIR,
      env: { ...process.env },
      logPrefix: "[web]",
    });
    managed.push(web);
    await waitForHttp(WEB_BASE_URL, { timeoutMs: 30_000 });

    console.log("[screenshots] [5/7] デモデータ(打刻・修正申請・有給・設定)を投入中...");
    const { sessionCookie, fixedMemberSessionCookie, inviteToken } = await seedHttp({
      apiBaseUrl: API_BASE_URL,
      extraUsers: extra.users,
      departments: extra.departments,
    });

    console.log("[screenshots] [6/7] Playwright で撮影中...");
    const prevMonth = fmtMonth(addMonths(jstToday(), -1));
    const shots = await captureAll({
      sessionCookie,
      vars: { prevMonth, inviteToken },
      extraSessionCookies: { "fixed-member": fixedMemberSessionCookie },
    });

    console.log("[screenshots] [7/7] 一覧ページを生成中...");
    generateGallery(shots);

    console.log(`[screenshots] 完了: ${shots.length} 枚を ${OUTPUT_DIR} に出力しました。`);
    console.log(`[screenshots] 一覧ページ: ${path.join(OUTPUT_DIR, "index.html")}`);
  } finally {
    console.log("[screenshots] 後片付け中...");
    for (const m of managed) stopProcess(m);
    await new Promise((r) => setTimeout(r, 500));
    await killPortStragglers([API_PORT, WEB_PORT]);
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[screenshots] 一時ディレクトリの削除に失敗しました(${runDir}):`, err);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
