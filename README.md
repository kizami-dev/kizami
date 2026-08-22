# KIZAMI

日本の労働法制に準拠した、セルフホスト可能な出退勤打刻型の勤怠管理システム。

**Status: pre-alpha** — 要件定義フェーズ完了、v0.1(フレックスタイム制の自分打刻)を開発中。

## なぜ KIZAMI か

既存のセルフホスト勤怠OSS(Kimai、solidtime など)は工数トラッキング寄りで、日本の勤怠慣行をカバーするものがありません。KIZAMI は次を最初から設計の中心に置きます。

- **1分単位の労働時間把握**(名前の由来。労働者不利な丸めは実装しない)
- 法定内/法定時間外/深夜/法定休日/月60時間超の**時間区分算出**
- **フレックスタイム制**の清算期間集計(v0.1)、固定時間制(v1.0)、シフト制(以降)
- 有給休暇の付与(法定・基準日方式)と**年5日取得義務の追跡**
- **36協定**の上限アラート
- 修正申請→承認+**不可変監査ログ**

## 設計の要点

- 集計エンジン(`packages/engine`)は純関数・ランタイム非依存・DB非依存
- Node と Cloudflare Workers の両対応(動作保証は v1.0 要件)
- DB は SQLite 既定+PostgreSQL/D1 選択式(Drizzle)
- 権限は AWS IAM 風のプリセット方式(permission × scope、加算のみ)
- スタック: TypeScript / Hono / Waku / Drizzle / Vite / Vitest / VitePress

詳細は [docs/requirements.md](docs/requirements.md) を参照。

## スクリーンショット

<p align="center">
  <img src="docs/public/readme/dashboard-light.png" width="49%" alt="ダッシュボード(ライト)" />
  <img src="docs/public/readme/punch-light.png" width="49%" alt="打刻画面(ライト)" />
</p>
<p align="center">
  <img src="docs/public/readme/monthly-dark.png" width="49%" alt="月次(ダーク・締め済み)" />
  <img src="docs/public/readme/leave-light.png" width="49%" alt="有給休暇(ライト)" />
</p>

全画面(ログイン〜設定の各画面)をライト/ダーク・デスクトップ/モバイルで並べた一覧は
`pnpm screenshots` を実行すると `docs/public/screenshots/index.html` に生成されます
(手順は [撮り直す手順](#スクリーンショットの撮り直し) を参照)。

## リポジトリ構成

```
apps/api           Hono API サーバー
apps/web           Waku (React) フロントエンド
packages/engine    労働時間集計エンジン(純関数・ランタイム非依存)
packages/help-content  コンテキストヘルプ文言(UI・docs 共通の単一ソース)
docs               VitePress ドキュメント+要件定義
```

## 開発

```sh
pnpm install
pnpm test
```

### スクリーンショットの撮り直し

```sh
pnpm screenshots
```

一時的な DB・API・Web サーバーを起動し、見栄えのするデモデータ(数日分の打刻・有給の
付与と取得・修正申請・通知・部署とメンバー・カスタム権限プリセット・月次締め等)を投入した
うえで、[Playwright](https://playwright.dev/) が全画面をライト/ダーク × デスクトップ/モバイルで
撮影します。撮影後はプロセス停止・一時 DB 削除まで自動で行われ、本番環境
(kizami.bktsk.com 等)には一切接続しません。Node 26 が必要です([mise](https://mise.jdx.dev/)
等で用意してください)。

- 出力先: `docs/public/screenshots/`(`.gitignore` 対象。撮り直すたびに再生成される生成物のため)
- 一覧ページ: `docs/public/screenshots/index.html` をブラウザで開くと、画面ごとにライト/ダークを
  並べて確認・拡大表示できます(デスクトップ/モバイルはタブで切り替え)
- README に載せる画像を更新したい場合は、生成された PNG から良いものを選んで
  `docs/public/readme/`(こちらはコミット対象)へ上書きコピーしてください

## License

[AGPL-3.0](LICENSE)
