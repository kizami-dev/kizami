/**
 * テスト専用の最小限アンビエント型宣言。
 *
 * engine の tsconfig は "types": [] で src をランタイム非依存に保つため @types/node を
 * 引き込まない(禁止事項: src への依存追加は devDependency の yaml のみ可)。
 *
 * 2026-08-27: ゴールデンケースのフィクスチャ読み込みを node:fs から `import.meta.glob` へ
 * 移したため(support/fixtures.ts 参照)、node:* のシグネチャ宣言は不要になった。
 * 代わりに Vite が提供する `import.meta.glob` の最小シグネチャをここで宣言する
 * (`vite/client` を types に足すと DOM 型まで引き込まれるため、必要な面だけにとどめる)。
 */

interface ImportMeta {
  url: string;
  glob(
    pattern: string,
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, unknown>;
}
