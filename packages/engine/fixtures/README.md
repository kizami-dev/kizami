# 法令ゴールデンケース

集計エンジンの正しさを担保する宣言的フィクスチャ置き場(要件 §9)。

- 1ファイル=1ケース。「入力: 打刻列+テナント設定」→「期待: 区分別時間数」
- 法改正時はフィクスチャの追加・更新で追随する
- 各ケースは VitePress ドキュメントから根拠として相互参照される

フィクスチャのスキーマは v0.1 のデータモデル設計で確定する(サンプル: `flex-basic.yaml`)。

必須ケース群(要件 §9): フレックス月枠の過不足 / 日界跨ぎ / 深夜帯 /
休憩の打刻・自動控除 / 法定休日判定 / 有給日の枠算入 / 36協定の各閾値 /
月境界・うるう年 / 期間中の制度・設定切替(effective-dated 適用)

## shift/ サブディレクトリ

`shift/` 配下は monthly_variable(1ヶ月単位の変形労働時間制、docs/design/shift-work.md)の
フィクスチャ置き場。トップレベルのフィクスチャ(`golden.test.ts` が読む、flex 専用の
`RawFixture` スキーマ)とは入力の形が違う(shifts・period_start_day 等)ため、
`test/shift-golden.test.ts` が別ローダーで読む。サブディレクトリに置いているのは、
`golden.test.ts` の `readdirSync(fixturesDir)` がトップレベルの `.yaml` しか拾わない
(ディレクトリはフィルタで自然に除外される)ことを利用して、既存ローダーでの
誤パースを避けるため。

## flex-contract/ サブディレクトリ

`flex-contract/` 配下は、フレックスの**契約上の枠**(所定労働日数 × 標準労働時間)と
**不足の翌月繰越**のフィクスチャ置き場(2026-10-05、docs/design/work-systems.md
「フレックスの契約上の枠と不足の繰越」)。`test/flex-contract-golden.test.ts` が
`test/support/load-flex-contract-fixture.ts` で読む。トップレベルのスキーマと違い、

- `calendar`(所定休日のカレンダー)を持ち、所定労働日はエンジンの `listScheduledWorkDates` で数える
- `months` に複数の月を並べられ、前の月の繰越(carry_out)を次の月の受け入れ(carry_in)に、
  次の月の上乗せの余地を前の月の送り出しの上限に、順に渡して計算する
- 打刻は `work`(日付の集合 × 出退勤・休憩)で生成できる

既定(法定の枠)の制度が従来と1分も変わらないことは、`11-statutory-basis-unchanged.yaml` と
`test/flex-contract.test.ts`(トップレベルの全フィクスチャで再確認)が固定している。
