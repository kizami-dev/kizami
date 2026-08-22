/**
 * 子プロセス(API/Web サーバー)の起動・生存確認・後片付けヘルパ。
 *
 * `pnpm --filter ... exec ...` は内部でさらに子プロセスを起動する(pnpm → tsx/waku → node)。
 * 素朴に「起動時に受け取った PID を kill」するだけでは孫プロセスが生き残ることがある
 * (実装時に手元で確認済み)。そのため `detached: true` で専用のプロセスグループを作り、
 * 終了時は `process.kill(-pid)` でグループごと止める。念のため、最後にポート番号ベースの
 * 掃除(lsof)もフォールバックとして行う。
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ManagedProcess {
  name: string;
  child: ChildProcess;
}

export function startProcess(name: string, command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; logPrefix?: string }): ManagedProcess {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = opts.logPrefix ?? `[${name}]`;
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`${prefix} ${chunk.toString()}`.replace(/\n$/, "\n"));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`${prefix} ${chunk.toString()}`.replace(/\n$/, "\n"));
  });
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`${prefix} exited with code ${code} (signal ${signal ?? "none"})`);
    }
  });
  return { name, child };
}

/** 一度実行して終了を待つコマンド(seed 投入・ビルド等)。非0終了は例外にする。 */
export async function runCommand(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; logPrefix: string },
): Promise<string> {
  console.log(`${opts.logPrefix} $ ${command} ${args.join(" ")}`);
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (stderr) process.stderr.write(stderr);
    if (stdout) process.stdout.write(stdout);
    return stdout;
  } catch (err) {
    console.error(`${opts.logPrefix} command failed: ${command} ${args.join(" ")}`);
    throw err;
  }
}

/** HTTP でヘルスチェックできるようになるまで待つ。タイムアウトで例外を投げる。 */
export async function waitForHttp(url: string, opts: { timeoutMs: number; intervalMs?: number }): Promise<void> {
  const interval = opts.intervalMs ?? 300;
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`timed out waiting for ${url} to become ready: ${String(lastError)}`);
}

/** プロセスグループごと止める。detached で起動していない場合は通常の kill にフォールバックする。 */
export function stopProcess(managed: ManagedProcess): void {
  const pid = managed.child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      managed.child.kill("SIGTERM");
    } catch {
      // すでに終了している等は無視
    }
  }
}

/** SIGTERM で止まらなかった場合の保険。指定ポートを掴んでいるプロセスを lsof で探して SIGKILL する。 */
export async function killPortStragglers(ports: number[]): Promise<void> {
  for (const port of ports) {
    try {
      const { stdout } = await execFileAsync("lsof", ["-ti", `:${port}`]);
      const pids = stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {
          // 既に終了している等は無視
        }
      }
    } catch {
      // lsof が何も見つけられない(該当プロセス無し)場合は ENOENT 相当のエラーになるので無視
    }
  }
}
