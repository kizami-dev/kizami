/**
 * Temporal のロード窓口(このパッケージで1箇所に集約)。
 *
 * apps/api/src/lib/temporal.ts(第4波)と同じパターン: ネイティブの `Temporal` が
 * あればそれを使い、無い実行環境向けにだけ `temporal-polyfill`(仕様準拠の軽量 polyfill)を
 * 動的 import する。engine は Vite などのバンドル対象ではなく Node(vitest 含む)/ワーカー
 * ランタイムから ESM のまま読み込まれるため、top-level await をそのまま使える。
 *
 * workerd(Cloudflare Workers)は本書時点でネイティブ Temporal 未対応であり、apps/api の
 * worker.ts 経由でこのパッケージ(@kizami/engine)を読み込む構成では polyfill 側が使われる
 * ことになる。ネイティブ優先ローダーにしてあるのは、Node 26 のようにネイティブを持つ
 * 環境ではポリフィルの読み込み自体を避けるため。
 *
 * globalThis.Temporal の型は @types/node(26.2.0 時点)にまだ持っていないため、
 * polyfill 側の型をこのパッケージ全体で使う唯一の Temporal 型として扱う
 * (apps/api/src/lib/temporal.ts と同じ理由)。
 */
type TemporalNamespace = typeof import("temporal-polyfill").Temporal;

const nativeTemporal = (globalThis as { Temporal?: TemporalNamespace }).Temporal;

export const Temporal: TemporalNamespace = nativeTemporal ?? (await import("temporal-polyfill")).Temporal;
