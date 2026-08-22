# @kizami/mcp — KIZAMI MCP サーバー

Claude Desktop / Claude Code のようなAIアシスタントから、KIZAMI の**打刻・勤怠照会・修正申請の参照**ができる
[MCP](https://modelcontextprotocol.io/)(Model Context Protocol)サーバーです(stdio トランスポート、
`docs/requirements.md` §3 打刻手段5)。

## 設計方針

- **独立したパッケージ**として KIZAMI 本体(`apps/api`)とは別プロセスで動きます。DB には一切触らず、
  **公開打刻API(`docs/external-api/index.md`)を HTTP 経由で叩くだけ**の薄いクライアントです。
- **認証は公開打刻APIキー**(`kzm_...`)です。このMCPサーバー自身は権限を持たず、
  **キーに設定したスコープがそのままこのMCPサーバーの権限**になります。
  - `punch` スコープのキー → 打刻の作成・参照ができます
  - `read` スコープのキー → 参照のみ(打刻の作成はできません)
  - 両方のスコープを持たせることもできます
- **書き込み操作は打刻のみ**提供します。承認・締め・テナント設定変更のツールは、そもそもAPIキーの
  スコープ上できませんが、**ツールとしても意図的に定義していません**(安全側に倒す設計)。

## なぜ「修正申請の作成」ツールが無いのか

`list_corrections`(申請の一覧参照)はありますが、**申請を作成するツール(`create_correction`)は
意図的に提供していません。** これはこのMCPサーバー実装における明確な判断です。

打刻の修正申請は「いつ・何を・なぜ直すか」という**理由を伴う人間の判断**です。誤打刻の経緯を
本人以外(AI)が正確に把握することは難しく、AIが本人に代わって理由を作文して申請してしまうと、
勤怠記録の正当性そのものが損なわれかねません。そのため、申請の作成・承認・却下・取り下げは
**常にKIZAMIの画面から人間が行う**ものとし、MCPサーバーからは参照のみ許可しています。

同じ理由で、`punch` ツールも「打刻を取り消す」機能は持ちません。打刻は実行しますが
(要件どおり実際にKIZAMIへ記録されます)、取り消しが必要になった場合は必ずKIZAMIの画面から
修正申請を行ってください。

## 前提

- KIZAMI の API サーバー(`apps/api`)が動いていること
- KIZAMI にログインし、`/settings/api-keys`(設定 > APIキー)で**公開打刻APIキーを発行済み**であること
  - 用途に応じて `punch`(打刻したい)または `read`(参照のみでよい)スコープを選んでください
  - 発行手順の詳細は [`docs/external-api/index.md`](../../docs/external-api/index.md) を参照してください
  - 発行直後にのみ表示される `kzm_` から始まるトークンをコピーしておきます(二度と表示されません)

## セットアップ

環境変数は2つだけです。

| 環境変数 | 内容 |
|---|---|
| `KIZAMI_API_URL` | KIZAMI API のベースURL(例: `http://localhost:3001`) |
| `KIZAMI_API_KEY` | 発行した公開打刻APIキー(`kzm_...`) |

### Claude Code

```bash
claude mcp add kizami \
  --env KIZAMI_API_URL=http://localhost:3001 \
  --env KIZAMI_API_KEY=kzm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -- pnpm --dir /path/to/kizami/apps/mcp exec tsx src/index.ts
```

`/path/to/kizami` はこのリポジトリをクローンしたパスに置き換えてください。`pnpm install` を
リポジトリルートで済ませておく必要があります(`tsx` は `apps/mcp` の devDependency です)。

### Claude Desktop

設定ファイル(`claude_desktop_config.json`)の `mcpServers` に追記します。

```json
{
  "mcpServers": {
    "kizami": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/kizami/apps/mcp", "exec", "tsx", "src/index.ts"],
      "env": {
        "KIZAMI_API_URL": "http://localhost:3001",
        "KIZAMI_API_KEY": "kzm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

設定後、Claude Desktop / Claude Code を再起動すると、下記のツールが使えるようになります。

## 提供するツール

| ツール | 必要スコープ | 内容 |
|---|---|---|
| `punch` | `punch` | 打刻する(`clock_in` / `clock_out` / `break_start` / `break_end`)。実行前に現在の勤務状態を自動確認し、無効な遷移(例: 勤務外の状態での退勤)はAPIを呼ばずにエラーを返します |
| `get_status` | `punch` または `read` | 現在の勤務状態(勤務外/勤務中/休憩中)と今日の打刻一覧を参照します |
| `get_monthly_summary` | `read` | 指定月(省略時は当月)の実労働・時間外・深夜・フレックス収支・警告を参照します |
| `get_leave_balance` | `read` | 有給休暇の残高と年5日取得義務の状況を参照します |
| `list_corrections` | `read` | 修正申請の一覧を参照します(**参照のみ**。作成・承認・却下・取下げは提供しません) |

いずれのツールも出力は人間が読める形式(日時・時間は整形済み)で返します。生のJSONはそのまま
出力しません。

## 打刻について、特に注意してほしいこと

- `punch` ツールは**実際にKIZAMIに打刻を記録します**。取り消すにはKIZAMIの画面から修正申請を
  行う必要があります(このMCPサーバーからは取り消せません)。
- 実行前に `GET /attendance/status` を自動的に呼び、現在の状態から見て無効な遷移
  (勤務外の状態での退勤・勤務中の状態での再度の出勤など)であれば、実際の打刻APIを呼び出す前に
  エラーメッセージを返します。ただし、これはあくまで直前に取得した状態に基づく事前チェックであり、
  ほぼ同時に他のクライアント(Web画面・ICカードリーダー等)から打刻された場合のレースまでは
  防げません。

## 「今日の打刻一覧」について(get_status)

`get_status` の「今日の打刻一覧」は、KIZAMI のテナント設定にある「日界(1日の区切り時刻)」を
考慮せず、**JST 0時区切りの概算**で計算しています。公開APIにはテナントの日界設定を取得する手段が
なく(APIキーのスコープ外)、このMCPサーバーは薄いHTTPクライアントに徹する方針のためです。
日界を0時以外に設定しているテナントでは、KIZAMI 画面の「今日」の表示と数時間ずれることがあります
(判断点)。現在の勤務状態(`state`)自体はサーバー(`GET /attendance/status`)の判定をそのまま
使っているため、この近似の影響を受けません。

## トラブルシューティング

エラーは KIZAMI API の生のエラーコードではなく、人間向けのメッセージに変換して返します。

| よくあるメッセージ | 原因 |
|---|---|
| APIキーが無効か失効しています | `KIZAMI_API_KEY` が間違っている・失効している。「設定 > APIキー」で再発行してください |
| このAPIキーにはこの操作を行う権限(スコープ)がありません | `punch` したいのに `read` スコープのキーを使っている、など。必要なスコープを持つキーを発行し直してください |
| KIZAMI API に接続できませんでした | `KIZAMI_API_URL` が間違っている、または API サーバーが起動していない |
| 対象の月は既に締め処理済みです | 締め済み月には打刻や一部の操作ができません。KIZAMIの画面から修正申請を行ってください |

## 開発・テスト

```bash
pnpm --filter @kizami/mcp typecheck
pnpm --filter @kizami/mcp test
```

`test/client.test.ts` は fetch をモックしたエラー変換のテスト、`test/tools.test.ts` は
`KizamiApiClient` をモックしたツールハンドラのテスト(出力の整形・無効な打刻遷移が実行前に
止まることを含む)、`test/punch-transition.test.ts` と `test/time.test.ts` は状態遷移・日時計算の
純粋ロジックのテストです。

実装時には、これとは別に実際に `apps/api` を起動し(`DATABASE_URL` に一時DB、シード投入、
APIキー発行)、公式SDK(`@modelcontextprotocol/sdk`)のクライアントでこのサーバーを stdio 起動して
`tools/list` / `tools/call` を実プロトコルで叩く検証も行っています(打刻が実際にAPI側へ記録される
ことを含む)。検証用スクリプトは一時的なものだったため恒久的なテストとしては残していません。
