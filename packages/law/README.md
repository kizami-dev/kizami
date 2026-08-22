# @kizami/law

法令ルールの版管理パッケージ。テナント設定に適用している「適用開始日付きの版
(effective-dated)」の考え方を、**法令そのもの**にも適用する。

ランタイム非依存・依存ゼロの純粋なデータ+関数。`node:*` も外部ライブラリも使わない。
`packages/engine` の `CalcSettings` / `SettingsSpan` と同じ流儀。

## なぜ必要か

法令由来の値(週法定労働時間、深夜帯、36協定の閾値、有給の法定付与日数テーブル等)を
コード中の定数として各所に散らしてしまうと、法改正があったときに「いつから変わったか」が
失われ、過去期間を再計算すると当時と違う結果になってしまう。

このパッケージは、法令改正を**施行前に書いておき、施行日が来たら自動的に切り替わる**
版の配列として管理する。

## 使い方

```ts
import { resolveLawRules, buildLawTimeline, listUpcomingChanges } from "@kizami/law";

// ある日・あるテナントで有効な法令ルールを1つ得る
const rules = resolveLawRules("2023-05-01", { isSmallOrMediumEnterprise: true });

// 期間内で法令が変わる日をすべて洗い出す(engine の SettingsSpan と同じ形)
const timeline = buildLawTimeline("2023-03-01", "2023-05-31", {
  isSmallOrMediumEnterprise: true,
});
// => [{ from: "2023-03-01", law: {...} }, { from: "2023-04-01", law: {...} }]

// 施行前に入れてある将来の改正を確認する(運用・UI 用)
const upcoming = listUpcomingChanges("2026-08-22", { isSmallOrMediumEnterprise: false });
```

## 法改正が来たときの追加手順

1. `src/versions.ts` の `LAW_VERSIONS` 配列に **新しい版を1つ追加する**。
   - `effectiveFrom`: 施行日("YYYY-MM-DD")。まだ施行されていない将来の日付でもよい
     — その日が来るまでは自動的に無視され、既存の値が使われ続ける
   - `basis`: 根拠条文・通達番号を必ず書く
   - `appliesTo`: 企業規模など、テナント属性によって施行日が異なる改正のときだけ指定する
     (省略時は全テナントに適用)
   - `rules`: 前の版からの差分。`LawRules` の**トップレベルのキー単位**で上書きする
     (例えば `agreement36` だけ変える場合、その版の `rules.agreement36` は
     サブフィールドも含めて完全なオブジェクトを書く — 深いマージはしない)
2. `test/resolve.test.ts` にテストを書く(または既存のテストを拡張する)。
   最低限、施行日の前後で値が切り替わることを確認する。
3. `pnpm --filter @kizami/law test` と `typecheck` を通す。

これだけで、施行日を迎えた瞬間に `resolveLawRules` / `buildLawTimeline` の返す値が
自動的に切り替わる。呼び出し側(engine・API 等)のコード変更は不要。

## 原則: 過去の版は絶対に書き換えない

**既存の版(`LAW_VERSIONS` に既にある要素)は、内容もタイミングも、追加後は編集しない。**
書き換えると、その版が有効だった過去期間の再計算結果が変わってしまい、締め済み期間の
整合性が壊れる。

- 内容の誤りに気づいた場合: 新しい訂正版を、正しい施行日(通常は「今」)から追加する
  (過去に遡って直したい場合は、対象システム側の締め処理・監査ログの方針に従うこと。
  このパッケージ自体は「版を追加する」以外の変更経路を持たない)
- 未来の施行日を持つ版を先に書いておくのは問題ない(むしろ推奨される使い方)。
  施行日が来るまでは効果を持たないため安全
- 版を配列から削除しない。過去のある日を計算するには、その日に有効だった版が
  ずっと参照可能である必要がある

## 型

- `TenantLawProfile`: テナントの属性
  - `isSmallOrMediumEnterprise`: 同じ改正でも企業規模で施行日が違う場合の判定に使う
    (施行日ベースの版の `appliesTo` で分岐)
  - `isSpecialProvisionWorkplace`: 特例措置対象事業場(商業・映画演劇業・保健衛生業・接客娯楽業で
    常時9人以下)かどうか。週40時間制が完全実施された現在も週44時間が法定労働時間となる現行制度
    (労基法40条、労基法施行規則25条の2)。過去の経過措置ではなく、施行日を持たない恒常的な
    事業場属性のため、版(`LawVersion`)ではなく `resolveLawRules` 内の解決後の上書きとして
    実装している(`src/resolve.ts` の `applySpecialProvisionWorkplaceOverride`)。
    `isSmallOrMediumEnterprise` とは独立した軸で、組み合わせても両方が正しく反映される。
    フレックスの月間総枠(`floor(週法定労働時間 × 暦日数 / 7)`)に直接効く
    — 例: 30日の月で通常 `floor(2400×30/7) = 10285`分、特例措置対象事業場は
    `floor(2640×30/7) = 11314`分
- `LawRules`: ある時点で有効な、完全な法令ルールの集合
- `LawVersion`: `effectiveFrom` + `appliesTo`(省略可) + `basis` + `rules`(差分) の1版

## 関数

- `resolveLawRules(date, profile)`: その日に有効な版を新しい順(実装上は古い順に畳み込み)で
  解決し、完全な `LawRules` を返す
- `buildLawTimeline(fromDate, toDate, profile)`: 期間内で法令が変わる日をすべて洗い出し、
  `{ from, law }` の配列(`from` 昇順)を返す。期間初日以前に有効な版を必ず1つ含む
- `listUpcomingChanges(afterDate, profile)`: `afterDate` より後に施行される、まだ発効していない
  版の一覧を返す(施行前に書いておいた将来の改正を確認する用途)

## 定義済みの版・史実として要確認の箇所

`src/versions.ts` の各版の `basis` フィールドと、要所のコードコメントに「要確認」と
明記している。特に:

- 基準版の `effectiveFrom: "2000-01-01"` は各条文の実際の施行日ではなく、本パッケージが
  計算対象にする起点として置いた「システム基準日」
- 2000-01-01時点の36協定上限(月45h・年360h)の直接の根拠とされる労働省告示の
  公布日・施行日そのものは特定できていない
- 2019-04-01/2020-04-01 の大企業/中小企業分離(36協定の罰則付き上限)は、指示された
  「最低限」の版一覧を超えて本パッケージが独自に追加した区分。日付の確度は高いと
  判断しているが、猶予根拠の附則条番号までは確認できていない
