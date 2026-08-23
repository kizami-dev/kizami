# Contributing to KIZAMI

コントリビューション歓迎です。日本語・英語どちらでも構いません。
Contributions are welcome, in Japanese or English.

## 開発環境

- Node 26(`mise install` で揃います)+ pnpm
- `pnpm install` → `pnpm -r test`(全パッケージのテスト)
- `pnpm typecheck` / `pnpm lint` / `pnpm docs:build`(CI と同じチェック)

## 変更の進め方

- Issue を先に立ててもらえると手戻りが減ります(特に労働法の解釈が絡む変更)
- 集計エンジン(`packages/engine`)は純関数です。I/O・`Date.now()`・タイムゾーン暗黙依存を持ち込まないでください
- 法令に関わる挙動は必ず一次情報(e-Gov 法令検索・通達)を根拠にし、コードコメントに判断理由を書いてください。ゴールデンケース(YAML フィクスチャ)の追加を歓迎します
- 打刻・シフトなどの記録系テーブルは追記専用(supersedes)です。UPDATE で歴史を書き換えない設計を守ってください
- UI 文言は `apps/web/src/lib/i18n/{ja,en,ko,zh}.ts` の4言語すべてに追加してください(型でキーの過不足が検出されます)
- JSDoc / Markdown 内で `[a, b](注)` のような区間表記はリンクと解釈され docs ビルドが落ちます。`a〜b` かコードスパンで書いてください

## テスト

- 新しい挙動には必ずテストを付けてください(`packages/*/test`、`apps/api/test`)
- 通知はテストからモック経由でのみ送ること(実 Webhook・実 SMTP に送らない)

## ライセンス

コントリビューションは [AGPL-3.0](LICENSE) の下で提供されたものとみなします。
