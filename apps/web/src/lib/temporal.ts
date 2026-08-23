/**
 * Temporal のロード窓口(このパッケージで1箇所に集約)。
 *
 * ネイティブの `Temporal`(Node 26 は搭載済み。2026-08 時点でブラウザはまだ広くは対応していない)
 * があればそれを使い、無ければ `temporal-polyfill`(仕様準拠の軽量 polyfill)にフォールバックする。
 *
 * ここだけ静的 import + 同期的な分岐にしている(動的 import + top-level await にはしていない):
 * apps/web の Storybook ビルド(vite 5 系、esbuild のデフォルト target が ES2020 baseline)は
 * top-level await を変換できずビルドが壊れる。waku 本体のビルド(vite 8 系、baseline-widely-
 * available = chrome111/safari16.4/firefox114 以降)は top-level await に対応しているが、
 * 同じ apps/web パッケージ内でビルドパイプラインごとに挙動を変える理由がないため、
 * どちらでも安全な同期的パターンに統一する。
 *
 * globalThis.Temporal の型は @types/node(26.2.0 時点)にまだ持っていないため、
 * polyfill 側の型をこのパッケージ全体で使う唯一の Temporal 型として扱う。
 *
 * `Temporal.Instant` のような名前空間スタイルの型参照はできない(`Temporal` はここでは値の
 * export であり、TS の型空間には別途 `namespace Temporal` が無いと `Temporal.X` は型として
 * 解決できない — `export const` と `export type` を同名で両立させることも TS の制約上できない)。
 * そのため呼び出し側では個々のインスタンス型をこの下の型 export(`TemporalInstant` 等)から
 * 使う。
 */
import { Temporal as PolyfillTemporal } from "temporal-polyfill";

type TemporalNamespace = typeof PolyfillTemporal;

const nativeTemporal = (globalThis as { Temporal?: TemporalNamespace }).Temporal;

export const Temporal: TemporalNamespace = nativeTemporal ?? PolyfillTemporal;

export type TemporalInstant = InstanceType<TemporalNamespace["Instant"]>;
export type TemporalPlainDate = InstanceType<TemporalNamespace["PlainDate"]>;
export type TemporalPlainDateTime = InstanceType<TemporalNamespace["PlainDateTime"]>;
export type TemporalZonedDateTime = InstanceType<TemporalNamespace["ZonedDateTime"]>;
export type TemporalPlainYearMonth = InstanceType<TemporalNamespace["PlainYearMonth"]>;
