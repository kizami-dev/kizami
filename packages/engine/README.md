# @kizami/engine

労働時間集計エンジン。純関数・ランタイム非依存・DB非依存(要件 §8/§9)。

- 入力(`EngineInput`)は打刻列 + テナント設定(effective-dated timeline)+ 期間、
  出力(`EngineOutput`)は区分別時間数(分単位)。境界の型(`EngineInput`/`EngineOutput`・
  エポック分・`PlainDateString`)は安定した契約として扱い、内部実装の変更で変わらない
- I/O・`Date.now()`・タイムゾーンDB(IANA tz)への暗黙依存を一切持たない。時刻は常に
  UTC エポック分(integer)、日付・時刻文字列は呼び出し側テナントのローカル
  (Asia/Tokyo 想定、固定オフセット)を前提にする(`types.ts` 冒頭のコメント参照)
- Node と workerd(Cloudflare Workers)の両方で同一に動作する

## 依存関係の判断: `temporal-polyfill`(第5波)

`src/date.ts` の内部実装(civil calendar の変換・曜日計算等)は、もともと
Howard Hinnant の civil calendar アルゴリズムを自前実装しており、依存ゼロだった。
第5波でこれを `Temporal.PlainDate` ベースに置き換え、`temporal-polyfill` への
依存を1つ追加した。

**「依存ゼロ」の原則がこの1個ぶんだけ緩む判断をした理由:**

- 自前の civil calendar 実装は初見での正しさの検証コストが高く(Hinnant のアルゴリズムを
  知らないと読めない)、うるう年・世紀年・日付跨ぎの端点(day boundary offset)といった
  「暦の癖」のバグを将来また踏むリスクがある。Temporal は ECMAScript の標準仕様
  (TC39 Stage 3、`temporal-polyfill` はその仕様準拠のポリフィル)であり、暦計算の
  正しさを自前実装で担保し続けるコストをエコシステム側に委ねられる
- `apps/api`(第4波、`apps/api/src/lib/temporal.ts`)で既に同じ判断を行っており、
  ネイティブ優先ローダーのパターンも確立済み。engine 側もそれに追随することで、
  monorepo 全体で日付処理の一枚岩な基盤(Temporal)に揃えられる
- 追加される依存は `temporal-polyfill` 1個のみ(推移依存なし、軽量)

**workerd(Cloudflare Workers)事情:** workerd は本書時点でネイティブ `Temporal` に
未対応。`src/lib/temporal.ts` はネイティブ優先ローダーになっており
(`globalThis.Temporal` があればそれを使い、無ければ `temporal-polyfill` を動的
import する)、workerd 環境では自動的に polyfill 側にフォールバックする設計に
なっている。Node 26 以降のようにネイティブ `Temporal` を持つ環境では polyfill の
読み込み自体を避けられる。

engine は Vite などのバンドル対象ではなく Node(vitest 含む)/ワーカーランタイムから
ESM のまま読み込まれるため、このローダーは top-level await をそのまま使っている
(`apps/api` の TLA パターンを踏襲。詳細は `src/lib/temporal.ts` のコメント参照)。

`src/date.ts` の中でも、UTC エポック分の帯(time band)と暦時刻の重なりを求める
`timeBandOverlapMinutes` / `lateNightOverlapMinutes` は、暦の年月日ではなく
「エポック分の単純な整数演算(Math.floor・剰余)」で完結しており Temporal を挟む
意味がないため、あえて Temporal 化していない(セグメント×日のループで呼ばれる
ホットパスでもある)。判断の詳細は `src/date.ts` 冒頭のコメントを参照。

## 純関数・現在時刻非依存の制約は維持

`Temporal.Now`(現在時刻取得)は一切使わない。エンジンへの入力に現在時刻はそもそも
存在せず(打刻はすべて `ValidPunch.occurredAt` という具体的なエポック分として渡される)、
Temporal 化によってこの制約が緩んだ箇所はない。

## パフォーマンス

`resolveAttendanceDate`(打刻ごとに呼ばれる、月次集計のホットパス)は内部で
epoch日 → `Temporal.PlainDate` の変換をメモ化しており、Temporal オブジェクト生成の
コストを「処理した打刻数」ではなく「処理した日数」のオーダーに抑えている
(詳細は `src/date.ts` の `plainDateByEpochDay` コメント参照)。

50ユーザー × 22営業日 × 4打刻/日(=4400回の `resolveAttendanceDate`)+
同数の `timeBandOverlapMinutes` 呼び出しを想定した簡易ベンチでは、旧実装
(自前 civil calendar)比で約1.16倍(いずれも1ミリ秒未満)。実行環境の Node 24 には
まだネイティブ `Temporal` が無く `temporal-polyfill` にフォールバックしているため、
これはポリフィル込みの数値(ネイティブ `Temporal` を持つ Node 26+ ではさらに縮む見込み)。
月次バッチ計算という用途に対して無視できる差と判断した。
