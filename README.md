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

## License

[AGPL-3.0](LICENSE)
