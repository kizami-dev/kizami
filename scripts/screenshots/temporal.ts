/**
 * Temporal のロード窓口(このスクリプト群で1箇所に集約)。
 *
 * `pnpm screenshots` は Node 26 前提(mise exec 経由。package.json 参照)でネイティブ
 * `Temporal` を持つが、念のため無い場合は `temporal-polyfill`(仕様準拠の軽量 polyfill)へ
 * フォールバックする。tsx 実行の素の ESM なので動的 import + top-level await で問題ない。
 *
 * globalThis.Temporal の型は @types/node(26.2.0 時点)にまだ持っていないため、
 * polyfill 側の型をここで使う唯一の Temporal 型として扱う。
 *
 * `Temporal.PlainDate` のような名前空間スタイルの型参照はできない(`Temporal` はここでは値の
 * export であり、TS の型空間には別途 `namespace Temporal` が無いと `Temporal.X` は型として
 * 解決できない)。そのため呼び出し側では個々のインスタンス型をこの下の型 export
 * (`TemporalPlainDate` 等)から使う。
 */
type TemporalNamespace = typeof import("temporal-polyfill").Temporal;

const nativeTemporal = (globalThis as { Temporal?: TemporalNamespace }).Temporal;

export const Temporal: TemporalNamespace = nativeTemporal ?? (await import("temporal-polyfill")).Temporal;

export type TemporalPlainDate = InstanceType<TemporalNamespace["PlainDate"]>;
export type TemporalPlainYearMonth = InstanceType<TemporalNamespace["PlainYearMonth"]>;
