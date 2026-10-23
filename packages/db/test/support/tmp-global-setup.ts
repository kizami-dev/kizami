/**
 * テストが作る一時ファイル(使い捨ての SQLite など)の置き場所を、実行ごとの専用ディレクトリにする。
 *
 * テストは `join(tmpdir(), "kizami-*-test-<uuid>.db")` に DB を作るが、個々のテストで消していない
 * ため、何度も走らせると OS の一時ディレクトリに数万個たまる(2026-10-23、約 18GB でディスクが
 * 埋まった)。テスト側に後始末を足して回るより確実なので、ここで実行全体を囲む:
 * 走り始めに専用ディレクトリを作って TMPDIR を向け(ワーカーは起動時に環境変数を引き継ぐので
 * `os.tmpdir()` がそこを返す)、終わったらディレクトリごと消す。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string | undefined;
let originalTmpdir: string | undefined;

export function setup(): void {
  originalTmpdir = process.env.TMPDIR;
  dir = mkdtempSync(join(tmpdir(), "kizami-vitest-"));
  process.env.TMPDIR = dir;
}

export function teardown(): void {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
}
