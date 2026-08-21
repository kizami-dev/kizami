/**
 * テスト専用の最小限アンビエント型宣言。
 *
 * engine の tsconfig は "types": [] で src をランタイム非依存に保つため @types/node を
 * 引き込まない(禁止事項: src への依存追加は devDependency の yaml のみ可)。
 * ゴールデンケースを読むテストコードだけが node:fs 等を使うので、その範囲の最小シグネチャを
 * ここで宣言する(パッケージは追加しない)。
 */

declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf-8" | "utf8"): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

interface ImportMeta {
  url: string;
}
