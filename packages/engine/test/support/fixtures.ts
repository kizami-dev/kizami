/**
 * YAML フィクスチャの読み込み(**node:fs を使わない**)。
 *
 * 判断点(2026-08-27、要件 §9): ゴールデンケースのスイートは「Node と workerd の両方で
 * 同一スイート」を走らせる対象そのものなのに、フィクスチャを `readdirSync`/`readFileSync` で
 * 読んでいたため workerd レグでは読み込みすらできなかった。vitest は Node レグでも workerd
 * レグでも Vite でテストをバンドルするので、`import.meta.glob(..., { query: "?raw" })` に
 * 置き換えれば **両方のランタイムで同じように** フィクスチャを取り込める(ファイルシステムに
 * 触らない)。engine の src がランタイム非依存であるのと同じ原則をテスト側にも通した。
 */

/** `import.meta.glob(..., { query: "?raw", import: "default", eager: true })` の戻り値。 */
export type RawGlob = Record<string, unknown>;

/**
 * glob の結果を `[ファイル名, YAML 本文]` の配列にする(ファイル名昇順)。
 *
 * キーは glob パターンからの相対パス(例 `../fixtures/flex-basic.yaml`)なので、
 * テストの表示名に使いやすいよう basename だけを取り出す。
 */
export function loadYamlFixtures(glob: RawGlob): [file: string, yamlText: string][] {
  return Object.entries(glob)
    .map(([filePath, contents]): [string, string] => [filePath.split("/").pop() as string, contents as string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
