/**
 * リリース版(`0.7.0` 等)の解決。**このモジュールは Node 専用**(node:fs を静的 import する)。
 *
 * 用途は observability だけ: `/metrics` の `kizami_build_info{version=...}` と、
 * エラー報告のタグ `release`。どちらも「どの版で起きたか」を突き合わせるためのもの。
 *
 * 版の単一の正はリポジトリルートの package.json(scripts/release-check.mjs が
 * タグ・CHANGELOG と一致を検証している)。配布イメージ(docker/api.Dockerfile)は
 * ルートの package.json を `/app/package.json` に、アプリを `/app/apps/api/` に置くので、
 * ここからの相対位置は開発時と配布時で同じになる。
 *
 * 読めなかった場合は `KIZAMI_RELEASE` 環境変数、それも無ければ "unknown" に落ちる
 * (版が分からないことでプロセスを止めはしない)。Workers 版(src/workers.ts)は
 * ファイルを読めないので `env.KIZAMI_RELEASE` をそのまま使う。
 */

import { readFileSync } from "node:fs";

/** apps/api/src/lib/version.ts から見たリポジトリルートの package.json。 */
const ROOT_PACKAGE_JSON = new URL("../../../../package.json", import.meta.url);

let cached: string | undefined;

/**
 * リリース版を返す。`KIZAMI_RELEASE` が設定されていればそれを優先し(配備側で
 * イメージタグを渡したい場合の逃げ道)、無ければルートの package.json を読む。
 */
export function resolveRelease(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.KIZAMI_RELEASE;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  if (cached !== undefined) return cached;

  try {
    const parsed: unknown = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, "utf8"));
    const version = (parsed as { version?: unknown }).version;
    cached = typeof version === "string" && version !== "" ? version : "unknown";
  } catch {
    cached = "unknown";
  }
  return cached;
}
