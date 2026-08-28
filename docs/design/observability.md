# 可観測性(メトリクスとエラー報告)

対象バージョン: v1.0(2026-08-27 実装)
関連: [要件定義 §8 非機能・OSS体裁・技術スタック](../requirements.md)、
[Cloudflare Workers + D1 対応](./workers-d1.md)、[マルチテナントとテナント分離](./multi-tenancy.md)

KIZAMI は「1社1インスタンスのセルフホスト」を前提にした製品なので、運用者は自分で
「動いているか」「壊れていないか」を見る必要がある。そのための面を2つ用意する。

| 面 | 何が分かるか | 有効化 | 既定 |
| --- | --- | --- | --- |
| `GET /metrics` | リクエスト量・遅延・エラー率、規模(テナント/ユーザー/打刻)、定期スキャンの生死 | `METRICS_TOKEN` | **OFF(404)** |
| エラー報告 | 例外の型・メッセージ・スタックトレース(発生箇所) | `SENTRY_DSN` | **OFF(no-op)** |

**どちらも既定で無効**であることが最初の設計判断。セルフホスト製品が既定で外部へ何かを
送るのは論外だし、`/metrics` は「その事業所に何人いて何回打刻しているか」を露出するため、
設定した人にだけ開く。

---

## 1. `GET /metrics`(Prometheus text format 0.0.4)

### 1.1 認証と公開範囲

- `METRICS_TOKEN` が**未設定なら `/metrics` は 404**。ルート自体を生やさない
  (401 を返すと「トークンさえあれば口がある」ことが分かってしまうため、明示的に 404 で返し切る)
- 設定されている場合は `Authorization: Bearer <METRICS_TOKEN>` 必須。不一致は 401。
  比較は定数時間で行う(`apps/api/src/routes/metrics.ts` の `timingSafeEquals`)
- Ingress / Cloudflare Tunnel の公開経路に `/metrics` を載せないこと。
  クラスタ内 Prometheus から Service へ直接引くのが素直

### 1.2 レート制限との関係

公開打刻 API のキー推測対策(`Authorization: Bearer kzm_...` 付きのリクエストを IP ごとに
120回/分)は `authed` サブアプリに付いている。`/metrics` は**それより前に登録**されており、
応答を返し切るので後段のミドルウェアは走らない。したがって:

- 15秒間隔(4回/分)のスクレイプが IC カードリーダー等の打刻枠を食い潰すことはない
- `/metrics` 自体にレート制限は無いが、トークン不一致は文字列比較1回で 401 になるだけなので
  総当たりの的として割に合わない

この性質は `apps/api/test/metrics.test.ts` の「公開打刻APIのレート制限のバケツを消費しない」で
固定してある(130回スクレイプしても打刻 API が 429 にならないことを確認する)。

### 1.3 公開しているメトリクス

| 名前 | 型 | ラベル | 内容 |
| --- | --- | --- | --- |
| `kizami_build_info` | gauge | `version` | 常に 1。版の切り替わりを時系列で見るため |
| `kizami_http_requests_total` | counter | `method`, `route`, `status` | リクエスト数(累積) |
| `kizami_http_request_duration_seconds` | histogram | `method`, `route` | 所要時間。バケットは 0.005 / 0.025 / 0.1 / 0.5 / 1 / +Inf |
| `kizami_process_resident_memory_bytes` | gauge | — | RSS(Node のみ) |
| `kizami_process_uptime_seconds` | gauge | — | プロセス稼働秒数(Node のみ) |
| `kizami_users_total` | gauge | — | 登録ユーザー数(無効化済みを含む) |
| `kizami_tenants_total` | gauge | — | テナント数 |
| `kizami_punches_last24h` | gauge | — | 直近24時間の打刻イベント数 |
| `kizami_worker_last_run_timestamp_seconds` | gauge | `job` | 定期スキャンの最終実行時刻(Unix 秒) |
| `kizami_worker_runs_total` | counter | `job`, `result` | 定期スキャンの実行回数(`result` は success / failure) |

`job` ラベルの値は `reminder` / `overtime-alert` / `leave-alert` / `shift-variance-alert` /
`leave-grant-proposal` の5つ(`apps/api/src/worker.ts` の `SCAN_JOBS`)。

### 1.4 カーディナリティの方針(重要)

**時系列の本数が使う側の入力で増える作りにしない。** 具体的には:

- `route` は Hono が解決した**ルートパターン**(`c.req.routePath`)。`/punches/:id` であって
  `/punches/019abc…` ではない。どのルートにも一致しなかったリクエストは `/*` に畳まれるので、
  存在しない URL を大量に叩かれても時系列は1本も増えない
- `/api` プレフィクス付きの配信(`node.ts` は同じアプリを `/` と `/api` の2箇所にマウントする)は
  同じ `route` に畳む
- `method` は既知の動詞のみ。想定外は `other`
- `status` は**ステータスクラス**(`2xx` / `4xx` / `5xx`)。個別のコードは持たない
- ヒストグラムには `status` を付けない(ルート数 × バケット数 × ステータスの掛け算を避ける)
- **`tenant` / `user` ラベルは付けない。** マルチテナント配備でテナントごとの内訳が欲しく
  なる気持ちは分かるが、テナント数ぶん全メトリクスが倍加するうえ、Prometheus に
  「どの会社がどれだけ打刻したか」が溜まる。業務的な内訳は KIZAMI の画面と CSV 出力の担当

結果として時系列の本数は「ルート数 × (メソッド数 + バケット数)」程度で頭打ちになる。

### 1.5 ドメインゲージは 60秒キャッシュ

`kizami_users_total` / `kizami_tenants_total` / `kizami_punches_last24h` と
ワーカーの心拍は、スクレイプのたびに DB を読む。ただし結果を **60秒キャッシュ**するので、
スクレイプ間隔を 15秒にしても 5秒にしても DB への負荷は 1分あたり数クエリで頭打ちになる。

クエリは**索引に当たる COUNT だけ**に限る。`kizami_punches_last24h` のために
`punch_events(occurred_at)` の索引を1本追加した(既存の複合索引は `tenant_id` 先頭なので、
テナントを跨ぐ `occurred_at` の範囲検索には効かない)。`occurred_at` はほぼ単調増加するため、
B-tree の右端に追記され続けるだけで打刻の書き込みコストはほとんど増えない。

**ここに重い集計(月次の再計算・36協定の判定など)を足さないこと。** 監視のための読み取りが
本体の性能を食い始めたら本末転倒になる。

DB が読めなかった場合、`/metrics` は **200 のまま**でドメインゲージだけが欠測する
(監視エンドポイントが 500 を返すと、DB の一時的な失敗が「アプリが落ちた」ように見え、
さらにエラー報告まで発火してノイズになる)。欠測は Prometheus 側の `absent()` で拾える。

### 1.6 ワーカーの心拍をテーブルで受け渡す理由

定期スキャン(`apps/api/src/worker.ts`)は api とは**別プロセス**なので、状態をメモリで
共有できない。選択肢は2つあった:

1. ワーカーが自前の HTTP サーバーを立て、Prometheus が2つのターゲットを叩く
2. ワーカーが DB に心拍を書き、api の `/metrics` がそれを読んで出す(**採用**)

1 はポートを1つ増やし、k8s では Service と追加の scrape 設定、Compose ではポート公開が要る。
KIZAMI では「api と worker が同じ DB を見る」ことが既に前提(ワーカーはスキャンのために DB を
読む)なので、2 なら**配備物を一切増やさずに**単一のスクレイプ先で完結する。

テーブルは `worker_heartbeats`(migration `0030`)。`job_name` を主キーに、最終実行時刻と
成功/失敗の累計を持つ。累計を DB に持つのは、Prometheus の counter がプロセス再起動を
またいで連続してほしいため(メモリだと再起動のたびに 0 に戻り、「再起動を繰り返している」
という最も知りたい状態が見えなくなる)。

この表は**テナントを持たない**。業務データではなくプロセスの運用状態であり、ワーカーは
全テナントを横断してスキャンするため、`tenant_id` を持たせても意味のある列にならない
([マルチテナントとテナント分離](./multi-tenancy.md)の「全テーブルに tenant_id」規約の
明示的な例外)。

### 1.7 prom-client を使わない理由

必要なのはカウンタ1本・ヒストグラム1本・ゲージ数本だけで、レジストリや集約といった
prom-client の主要な価値をほとんど使わない。それに加えて決定的だったのが
**API が workerd でも動く**という要件(§8、[Workers + D1 対応](./workers-d1.md)):

- prom-client の `collectDefaultMetrics` は `perf_hooks` とイベントループ計測・GC フックに
  依存しており、workerd では動かない
- `/metrics` が Node でしか生えないのは配布物として一貫しない(Workers に載せたセルフホスターが
  監視できない、という状態を作りたくない)

そのため `apps/api/src/lib/metrics.ts` にレンダリングだけを持つ小さなレジストリを置いた
(200行程度)。プロセス固有の値(RSS・uptime)は実行時に存在確認し、取れない環境では
その2行が消えるだけで `/metrics` は変わらず 200 を返す。Web Push の VAPID 自前実装や
レート制限と同じ方針(小さくて枯れている処理は依存を増やさず自前で持つ)。

### 1.8 スクレイプ設定の例

```yaml
scrape_configs:
  - job_name: kizami
    scrape_interval: 15s
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: "<METRICS_TOKEN と同じ値>"
    static_configs:
      - targets: ["kizami-api.kizami.svc.cluster.local:3001"]
```

Compose 構成では前段の Caddy が `/api/*` を api へ通すので、`metrics_path: /api/metrics` で
`http://<host>:8080` を指す形でもよい(その場合は公開ポートに `/api/metrics` を出さないよう
前段でアクセス元を絞ること)。

すぐ効くアラートの例:

```text
# 定期スキャンが 1時間動いていない(既定の周期は 15分)
time() - kizami_worker_last_run_timestamp_seconds > 3600

# スキャンが失敗し続けている
rate(kizami_worker_runs_total{result="failure"}[30m]) > 0

# 5xx が出ている
sum(rate(kizami_http_requests_total{status="5xx"}[5m])) > 0

# ドメインゲージが取れていない(= DB 読み取りに失敗している)
absent(kizami_users_total)
```

---

## 2. エラー報告(Sentry プロトコル互換)

### 2.1 送り先

想定しているのは**セルフホストの受け口**: 自前の sentry-relay → GlitchTip / Bugsink。
Sentry SaaS も同じ DSN 形式で受けられるが、KIZAMI 本体としては「既定で外部へ送らない」
ことを守る(`SENTRY_DSN` 未設定なら完全な no-op で、`fetch` は一度も呼ばれない)。

| 環境変数 | 内容 |
| --- | --- |
| `SENTRY_DSN` | `https://<publicKey>@<host>[/<path>]/<projectId>`。未設定なら無効 |
| `SENTRY_SERVER_NAME` | `server_name`。省略時は `HOSTNAME`(k8s なら Pod 名) |
| `SENTRY_ENVIRONMENT` | `environment`。省略時は `NODE_ENV` |

DSN はサブパス配下の受け口(`https://key@relay.example.com/sentry/ingest/7`)にも対応する
(→ `https://relay.example.com/sentry/ingest/api/7/store/`)。

### 2.2 @sentry/node を使わない理由

- `@sentry/node` は `http` / `https` / `async_hooks` などのグローバルにパッチを当てる。
  **打刻という監査対象の処理系**に、観測のためだけにそこまで踏み込ませたくない
- 推移的に数十パッケージ増える。KIZAMI は Compose 一発で動く配布物であることを優先している
- workerd でも同じコードを動かしたい(§8)。SDK のランタイム分岐に付き合うより、必要な機能
  (例外1件を store API へ POST する)だけを自前で持つほうが小さい

実装は `apps/api/src/lib/error-report.ts`(約 300 行)。**やらないことも明示しておく**:
パフォーマンス計測(traces)、ブレッドクラム、セッション追跡、ソースマップのアップロード、
グローバル例外フックの自動登録。必要になったらそのとき改めて SDK 導入を検討する。

### 2.3 送信のかたち

- **store API**(`POST <origin>/api/<projectId>/store/`)に JSON を1件 POST する。
  envelope API ではなく store API なのは、sentry-relay / GlitchTip / Bugsink のいずれもが
  受けられる最小公倍数だから
- 認証は `X-Sentry-Auth: Sentry sentry_version=7, sentry_client=kizami/<release>, sentry_key=<publicKey>`
- **gzip しない**(`Content-Encoding: identity` を明示する)。判断点: 筆者の自前 sentry-relay が
  gzip されたペイロードを取りこぼすバグを踏んだ実績があり(2026-06)、イベント1件は高々数 KB で
  圧縮の利得がほぼ無い。壊れやすさと引き換えにする価値がない
- **撃ちっ放し**。`capture()` は同期に戻り、送信は 3秒でタイムアウトする。送信失敗は
  呼び出し元に伝えない(エラー報告の失敗でリクエストを壊さない)

### 2.4 エラーの嵐でプロセスを潰さない

2段構えで頭を押さえる。

1. **重複除去**: `例外の型 | メッセージ | 最も原因に近いフレーム` が同じイベントは
   60秒に1件しか送らない。同じバグが毎リクエスト踏まれても送信は毎分1件
2. **窓あたりの上限**: 種類の違うエラーが同時多発しても、60秒あたり 30件で打ち止め
   (これが無いと「全リクエストが別々の理由で失敗する」障害時に送信が積み上がる)

どちらも `apps/api/test/error-report.test.ts` で固定してある。

### 2.5 エラー報告に載せないもの(プライバシー)

イベントに載せてよいのは次だけ:

- 例外の型 / メッセージ / スタックトレース(= コードに書かれた文字列)
- `route`(**ルートパターン**)と HTTP メソッド → `transaction: "POST /punches"`
- `tenant`(テナントID の **SHA-256 先頭8桁のみ**。生の ID は決して載せない)
- `runtime` / `release` / `server_name` / `environment`
- ワーカー起因なら `job`(スキャン名)

**載せないもの**: リクエストボディ・クエリ文字列・ヘッダ・Cookie・メールアドレス・
氏名・ユーザーID・打刻の位置情報。Sentry の `request` / `user` / `breadcrumbs` フィールドは
**そもそも組み立てない**(「うっかり入る」余地を型ごと消してある)。`Error` 以外の値が
投げられた場合も中身を `JSON.stringify` せず `non-Error thrown: object` とだけ記録する
(ボディを含むオブジェクトが投げられたときの流出を防ぐため)。

これは方針表明ではなくテストで固定してある: `apps/api/test/error-report.test.ts` の
「500 の応答は従来どおりで、リクエストボディ・ヘッダはイベントに載らない」が、
秘密の目印を入れたボディとヘッダで実際に 500 を起こし、送信ペイロードに現れないことを確認する。

**この一覧を増やすときは、必ずこの節と該当テストを同時に更新すること。**

### 2.6 何を報告するか

- **HTTP**: `app.onError` の最終分岐(= 想定外の例外 → 500)だけ。`ForbiddenError`(403)や
  `MonthClosedError`(409)は**想定内の分岐**なので報告しない — これらを送ると、権限が無い人が
  ボタンを押しただけでアラートが鳴る
- **ワーカー**: 5本のスキャンそれぞれの失敗。文脈はスキャン名だけを渡す
- 報告の有無にかかわらず、**API の応答は変わらない**(`{"error":"internal_error"}` の 500)。
  これもテストで固定してある

---

## 3. ランタイムごとの差

| | Node(`src/node.ts` / `src/worker.ts`) | Workers(`src/workers.ts`) |
| --- | --- | --- |
| `/metrics` | 出る | 出る(`METRICS_TOKEN` を `wrangler secret put`) |
| プロセスメトリクス | RSS / uptime あり | **無し**(2行が消えるだけ) |
| ワーカーの心拍 | `worker.ts` が書く | 定期スキャン自体が未実装([workers-d1.md](./workers-d1.md)) |
| エラー報告 | あり(タグ `runtime=node`) | あり(タグ `runtime=workerd`) |
| リリース版 | ルートの `package.json` から読む | `KIZAMI_RELEASE`(vars)。未設定なら `unknown` |

---

## 4. 配備

- k8s: [`deploy/k8s/README.md`](https://github.com/kizami-dev/kizami/blob/main/deploy/k8s/README.md) の
  「メトリクスとエラー報告(監視、任意)」節。`kizami-metrics` / `kizami-sentry` Secret を
  `optional: true` で参照する
- Helm: `values.yaml` の `observability.metricsSecret` / `observability.sentrySecret`
  (どちらも `name: ""` が既定 = 無効)
- Compose: `.env` の `KIZAMI_METRICS_TOKEN` / `KIZAMI_SENTRY_DSN`(既定は空 = 無効)
- Workers: `wrangler secret put METRICS_TOKEN` / `wrangler secret put SENTRY_DSN`

## 5. 実装の在り処

| ファイル | 役割 |
| --- | --- |
| `apps/api/src/lib/metrics.ts` | 自前の最小レジストリ(カウンタ / ヒストグラム / ゲージ、text format 出力) |
| `apps/api/src/routes/metrics.ts` | `GET /metrics`(トークン検証・60秒キャッシュ) |
| `apps/api/src/lib/error-report.ts` | DSN 解析・イベント組み立て・重複除去・撃ちっ放し送信 |
| `apps/api/src/lib/version.ts` | リリース版の解決(Node 専用) |
| `packages/db/src/schema/worker-heartbeats.ts` | `worker_heartbeats` テーブル |
| `packages/db/src/queries/observability.ts` | ドメインゲージの COUNT と心拍の読み書き |
| `apps/api/test/metrics.test.ts` / `apps/api/test/error-report.test.ts` | 上記の振る舞いの固定 |
