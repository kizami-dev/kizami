/**
 * Temporal のロード窓口(このパッケージで1箇所に集約)。
 *
 * apps/api は Node(apps/api/src/node.ts)と Cloudflare Workers/workerd
 * (apps/api/src/worker.ts)の双方で動く。どちらも ESM(top-level await 対応)なので、
 * ネイティブの `Temporal` が無い実行環境向けにだけ `temporal-polyfill`(仕様準拠の軽量
 * polyfill)を動的 import する — ネイティブがある場合(Node 26 は搭載済み)は polyfill の
 * ロード自体を避けられる。
 *
 * globalThis.Temporal の型は @types/node(26.2.0 時点)にまだ持っていないため、
 * polyfill 側の型をこのパッケージ全体で使う唯一の Temporal 型として扱う。
 */
type TemporalNamespace = typeof import("temporal-polyfill").Temporal;

const nativeTemporal = (globalThis as { Temporal?: TemporalNamespace }).Temporal;

export const Temporal: TemporalNamespace = nativeTemporal ?? (await import("temporal-polyfill")).Temporal;
