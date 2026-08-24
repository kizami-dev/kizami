# KIZAMI k8s デプロイ資材

素の YAML 一式(Helm 化は v1.0 で検討)。k3s(sakura=amd64 + samurai-watch/samurai-matrix=arm64)への手動適用を想定。

前提:

- StorageClass `local-path` が既定で使えること(k3s 同梱の Local Path Provisioner)
- イメージは `.github/workflows/images.yml` で `ghcr.io/sasagar/kizami-api` / `kizami-web` に `linux/amd64,linux/arm64` マルチアーチ push 済みであること
- SQLite ファイル DB を PVC(RWO)に置くため **replicas は 1 固定**。水平スケールは不可(PostgreSQL 構成にすればこの制約は外れる — 下記「PostgreSQL を使う」節)

## 適用手順

`deployment.yaml` の `api` / `worker` コンテナは起動に `kizami-encryption` Secret を必須で
参照する(`optional: false`)ため、**先に「秘密情報の暗号化鍵」の Secret を作成してから**
`deployment.yaml` を適用すること(未作成のまま適用すると Pod が `CreateContainerConfigError` で起動しない)。

```sh
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/pvc.yaml
kubectl apply -f deploy/k8s/valkey.yaml
# ↓ このあと「秘密情報の暗号化鍵」節の手順で kizami-encryption Secret を作成する
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
```

## 秘密情報の暗号化鍵(KIZAMI_ENCRYPTION_KEY)

テナント通知設定の SMTP パスワードと Webhook URL は、DB には平文ではなく AES-256-GCM で
暗号化して保存する(`packages/crypto`、保存形式 `enc:v1:<iv>:<ciphertext>`)。鍵は
32バイトを base64 で表現した文字列を環境変数 `KIZAMI_ENCRYPTION_KEY` として `api` / `worker`
両コンテナに渡す(**鍵は必須運用** — 未設定のまま Pod を起動することはできない。上記の通り
Secret 参照は `optional: false`)。

鍵を生成する:

```sh
openssl rand -base64 32
```

生成した値で Secret を作成する(**この鍵はクラスタ外で安全に保管しておくこと**。紛失すると
既存の暗号化済み秘密情報は復号できなくなる — その場合もシステム全体は止まらず、該当の通知
チャネルが自動的に無効化されるだけで済む設計になっている):

```sh
kubectl -n kizami create secret generic kizami-encryption \
  --from-literal=key='<openssl rand -base64 32 の出力>'
```

鍵を後から作成/変更(ローテーション)した場合は `api` / `worker` 両コンテナの再起動が必要:

```sh
kubectl -n kizami rollout restart deployment/kizami
```

鍵をローテーションすると、**それまでに暗号化済みだった webhookUrl / smtpPassword は旧鍵でしか
復号できなくなる**(新鍵では「復号できない値」として扱われ、該当の通知チャネルが自動的に
無効化される。エラーにはならず、アプリ内通知など他の機能は動き続ける)。ローテーション後に
テナント側で通知設定画面から webhookUrl / smtpPassword を一度保存し直せば新鍵で再暗号化される。

既存データの移行(この機能をまだ入れていない環境からのアップグレード時):
`tenant_notification_settings` に平文で保存されている既存の webhookUrl / smtpPassword は、
`KIZAMI_ENCRYPTION_KEY` を設定するだけでそのまま読める(`enc:` プレフィクスが無い値は平文と
みなす後方互換)。明示的な一括移行バッチは不要で、各テナントが通知設定を次に保存したタイミング
で自動的に暗号化される。

## ブラウザプッシュ通知(Web Push / VAPID 鍵、任意)

従業員が「打刻忘れ」「承認依頼」などをブラウザのプッシュ通知として受け取れるようにする
(設計は [design/web-push.md](../../docs/design/web-push.md))。外部サービス(Firebase 等)は
使わず、VAPID 鍵さえあれば追加のインフラは不要。**設定しなくても KIZAMI は通常どおり動く**
(その場合、Web UI からプッシュ通知の項目自体が消える)。

鍵を生成する:

```sh
pnpm generate-vapid
# `npx web-push generate-vapid-keys` で作った鍵をそのまま使ってもよい
```

出力の3行を Secret にする(`VAPID_SUBJECT` は運用者の連絡先。`mailto:` か `https://` で始める
必要がある — プッシュサービスが送信元に問い合わせるための情報):

```sh
kubectl -n kizami create secret generic kizami-vapid \
  --from-literal=publicKey='<VAPID_PUBLIC_KEY>' \
  --from-literal=privateKey='<VAPID_PRIVATE_KEY>' \
  --from-literal=subject='mailto:admin@example.com'
kubectl -n kizami rollout restart deployment/kizami
```

`deployment.yaml` は `api` / `worker` 両コンテナでこの Secret を `optional: true` で参照する
(購読の受付は api、実際の送信は worker が行うため**両方に同じ値**が要る)。Secret が無ければ
環境変数が付かず、プッシュ通知が無効なだけの通常運用になる。

注意点:

- **鍵を入れ替えると既存の購読はすべて無効になる。** ブラウザは購読時の公開鍵にエンドポイントを
  紐づけるため、鍵を替えたら全員に設定画面から購読し直してもらう必要がある(KIZAMI 側は
  失効を検知して静かに送信を止めるので、エラーが積み上がることはない)。
- 秘密鍵は `KIZAMI_ENCRYPTION_KEY` と同じ扱い(クラスタ外で安全に保管・リポジトリに置かない)。
- **HTTPS 必須**(Service Worker の要件)。また iOS/iPadOS では「ホーム画面に追加」した
  PWA としてのみプッシュを受け取れる。
- KIZAMI のサーバーからブラウザベンダーのプッシュサービスへ外向きの HTTPS が出られること。
  閉域網の配備では使えない(メール・個人 Webhook を使うこと)。

Pod が Running/Ready になるまで待つ:

```sh
kubectl -n kizami rollout status deployment/kizami-valkey
kubectl -n kizami rollout status deployment/kizami
```

## 通知基盤・打刻忘れリマインド(v0.2 第二弾)

`deployment.yaml` の `kizami` Deployment には `api` / `web` に加えて `worker` コンテナが
含まれる(`apps/api/src/worker.ts`。api と同じイメージで `tsx src/worker.ts` を実行するだけの
差分)。`worker` は BullMQ の repeatable job で `REMINDER_INTERVAL_MINUTES`(既定15分)おきに
`runReminderScan`(`apps/api/src/reminders.ts`)を起動し、打刻忘れ(退勤)を検知してアプリ内通知
(`notifications` テーブル)を作成する。ジョブキューには `valkey.yaml` の Valkey(永続化なし・
`kizami-valkey:6379`)を使う。

- 通知の正しさは DB の定期スキャン(engine の `missing_clock_out` 警告の再計算)と
  `notifications` テーブルの UNIQUE 制約(重複防止)に依存しているため、Valkey は
  「起動トリガー」に過ぎず永続化していない。Pod 再起動で repeatable job の登録がリセットされても、
  worker 起動時に `upsertJobScheduler` が再登録するので実害はない
- `worker` は `api` と同じ PVC 上の SQLite ファイル(`DATABASE_URL=file:/data/kizami.db`)を見る

外部チャネル(Slack/Discord 互換 Webhook)へも送りたい場合は、`kizami-notify` Secret に
`webhookUrl` キーを作成する(未作成でも `worker` は起動でき、アプリ内通知のみが動作する
— `optional: true` 参照):

```sh
kubectl -n kizami create secret generic kizami-notify \
  --from-literal=webhookUrl='https://hooks.slack.com/services/xxx/yyy/zzz'
```

Secret を後から作成/変更した場合は `worker` コンテナだけ再起動すれば反映される:

```sh
kubectl -n kizami rollout restart deployment/kizami
```

(単一 Deployment の全コンテナが再起動するため `api` / `web` も再起動される点に注意。
コンテナ単位の再起動は k8s にはないため、影響を避けたい場合は反映を次回の通常デプロイに合わせること。)

メール(SMTP)チャネルは v0.2 時点で未実装(`packages/notify/src/smtp.ts` はスタブ)。

## 初期シード(管理者ユーザー作成)

Job 実行前に Secret を作成する(値は例。実際のメール/パスワードに置き換えること):

```sh
kubectl -n kizami create secret generic kizami-seed \
  --from-literal=SEED_EMAIL='admin@example.com' \
  --from-literal=SEED_PASSWORD='change-me-please'
```

Job を適用(namespace/pvc/deployment/service とは違い **自動適用の対象外**。手動実行専用):

```sh
kubectl apply -f deploy/k8s/seed-job.yaml
kubectl -n kizami logs job/kizami-seed
```

再実行したい場合(パスワード変更など)は先に既存 Job を消してから再適用する:

```sh
kubectl -n kizami delete job kizami-seed
kubectl apply -f deploy/k8s/seed-job.yaml
```

`apps/api/src/seed.ts` は `SEED_EMAIL` のユーザーが既に存在する場合は新規作成をスキップする(冪等)ので、誤って複数回流しても安全。スキップ時も同梱(システム)プリセットの権限だけは最新のカタログに合わせて追記される。

## 2社目以降のテナントを作る(マルチテナント)

同じインスタンス(同じ DB)に複数のテナント(会社)を同居させられる。**テナントの作成は運用者の作業**で、セルフサインアップ(自由登録)は提供しない(`docs/requirements.md` §7)。2社目以降は Pod の中で `create-tenant` を実行する(初期シードと同じ考え方):

```sh
kubectl -n kizami exec -it deployment/kizami -c api -- \
  env TENANT_NAME='株式会社サンプル' ADMIN_EMAIL='admin@sample.example.com' ADMIN_PASSWORD='change-me-please' \
  node_modules/.bin/tsx src/create-tenant.ts
```

(`DATABASE_URL` は api コンテナに既に設定されているため指定不要。`command` の書式は `seed-job.yaml` と同じ — イメージの作業ディレクトリが `apps/api` になっている。)

- 作られるもの: テナント / 既定のテナント設定版 / 既定の労働時間制(標準フレックス・月清算) / 同梱プリセット3種(管理者・マネージャー・メンバー) / 管理者ユーザー1名
- 以降のメンバー追加はその管理者でログインし、Web の招待フロー(`POST /members`)で行う
- 冪等: `TENANT_NAME` のテナントに `ADMIN_EMAIL` のユーザーが既に居れば何もしない。同名テナントが存在するのに `ADMIN_EMAIL` が居ない場合は取り違え防止のためエラーで止まる(意図的に同名の別テナントを作る場合のみ `ALLOW_DUPLICATE_TENANT_NAME=true`)
- パスワードをシェル履歴に残したくない場合は Secret 経由の Job(`seed-job.yaml` の `command` を `["node_modules/.bin/tsx", "src/create-tenant.ts"]` に、env を `TENANT_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` に差し替えた形)にしてもよい

同一メールアドレスが複数テナントに存在してもよい(顧問社労士など)。その場合ログイン時にテナント選択を挟む(`409 multiple_tenants` → `tenantId` を添えて再ログイン)。

## イメージ更新の反映

`latest` タグを使っているため、CI が新しいイメージを push しても Deployment は自動では追従しない。更新を反映するには:

```sh
kubectl -n kizami rollout restart deployment/kizami
```

## Cloudflare Tunnel でのパス振り分け

`cloudflared` は samurai-watch 上で稼働している(このクラスタとは別ホスト)。Cloudflare Zero Trust ダッシュボードの当該トンネルの Public Hostname 設定に、`kizami.<domain>` 向けの Additional application settings → Path ルールとして以下の 2 ルートを追加する(**Path が長い/具体的なものを上に**、`/` は最後にフォールバックとして置くこと):

| Hostname | Path | Service |
| --- | --- | --- |
| `kizami.<domain>` | `/api/*` | `http://localhost:30094` |
| `kizami.<domain>` | `/` | `http://localhost:30093` |

- `30094` は `kizami-api` Service の NodePort、`30093` は `kizami-web` Service の NodePort(このクラスタは 30088/30090/30091/30092 を既に使用しているため、それらと衝突しない番号を採番した)。
- `apps/api/src/node.ts` は `/api` プレフィクス付きリクエストもプレフィクス無しと同じアプリで受けられる実装になっているため、トンネル側でパスを書き換える(strip prefix する)設定は不要。
- `apps/web` の本番ビルドは `WAKU_PUBLIC_API_URL=/api` を焼き込んでいる(`docker/web.Dockerfile` 参照)ため、ブラウザからは常に同一オリジンの `/api/*` を叩く。API を別オリジンで公開する場合はこの前提が崩れるので web イメージの再ビルドが必要。
- `localhost:3009x` は cloudflared が動く samurai-watch ホストから見た宛先である想定(NodePort はクラスタの全ノードで待受けるため、samurai-watch がクラスタのいずれかのノードに到達できればよい。到達できない場合は cloudflared 側のトンネル先ホスト/IP を該当ノードの IP に置き換えること)。

## 認証系のレート制限(TRUST_PROXY)

ログイン総当たり・招待/リセットトークンの推測対策として、認証系エンドポイントに
レート制限を入れている(`apps/api/src/lib/rate-limit.ts`、2026-08-24 追加)。上限は:

| 対象 | キー | 上限 |
| --- | --- | --- |
| `POST /auth/login` | クライアント IP + メールアドレス(小文字化) | 10回 / 15分 |
| `POST /auth/login` | クライアント IP のみ | 30回 / 15分 |
| `/invitations/*`, `/password-resets/*`(GET の検証を含む) | クライアント IP のみ | 20回 / 15分 |
| 公開打刻 API(`Authorization: Bearer kzm_...` 付きのリクエストのみ) | クライアント IP のみ | 120回 / 分 |

超過すると `429 {"error":"rate_limited","retryAfterSeconds":N}` と `Retry-After` ヘッダを返す。
セッション Cookie 認証の通常リクエスト(Web UI からの打刻など)は打刻 API の制限の対象外なので、
オフィスの共有グローバル IP から多数の従業員が打刻しても巻き添えにならない。

**カウンタは API プロセスのメモリ上にしか無い**(外部ストア不要=依存を増やさない判断)。
この配備は SQLite ファイル DB を RWO PVC に置く都合で **replicas=1 固定**なので現状は正しく効くが、
**レプリカを増やす・水平スケールする・Cloudflare Workers へ載せる場合は実効の上限がプロセス数倍に
なる**(そのときは共有ストア実装への差し替えが必要。`RateLimiter` インタフェースを差し替え口として
用意してある)。API を再起動するとカウンタは消える。

クライアント IP の判定は `CF-Connecting-IP` →(無ければ)`X-Forwarded-For` の先頭ホップ →
TCP のソースアドレス、の順(`apps/api/src/lib/client-ip.ts`)。**これらのヘッダを信用できるのは、
到達経路が Cloudflare Tunnel に限られているという前提があるからに過ぎない**(Cloudflare の
エッジが `CF-Connecting-IP` を必ず上書きする)。API を直接インターネットへ晒す配備では
環境変数 `TRUST_PROXY=false` を `api` コンテナに設定すること — ヘッダを一切見ず、
TCP のソースアドレスのみでレート制限をかけるようになる(設定しないと、攻撃者が
`CF-Connecting-IP` を毎回変えて送るだけで制限を回避できてしまう)。

この k8s 配備は上表の Cloudflare Tunnel 経由が前提なので、`TRUST_PROXY` は未設定
(=既定 true)のままでよい。

## 社内規定ドキュメント(docs-local/)

VitePress サイト(`docs/`、`pnpm docs:build`)は、この `deploy/k8s/` 一式には**現時点で
含まれていない**(`kizami-api` / `kizami-web` のみを配布する)。KIZAMI をフォークせずに
自社のドキュメントサイトを Docker/k8s 上でホストする場合は、以下のいずれかの方法で
`docs-local/`(リポジトリルート直下、ビルド時に `docs/company/` へ取り込まれ VitePress
サイドバーの「社内規定」セクションに出る — `scripts/sync-company-docs.mjs` 参照)を
差し込む。

**フォーク不要でアップグレードと衝突しない**ことが要件なので、`docs-local/*.md` を
イメージに `COPY` で焼き込む(=独自イメージをビルドし直す)のではなく、ビルド時または
実行時にボリュームとして差し込む方式を推奨する。

### Docker(単体コンテナでビルド)

`docs-local/` をコンテナへバインドマウントしてから `pnpm docs:build` を実行する:

```sh
docker run --rm \
  -v "$(pwd)":/work -w /work \
  -v "$(pwd)/docs-local":/work/docs-local:ro \
  node:22 sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm docs:build"
```

生成された `docs/.vitepress/dist/` を任意の静的配信コンテナ(nginx 等)にコピーして配信する。

### k8s(initContainer + PVC でビルドしてから配信)

k8s で VitePress サイトを継続的に配信したい場合は、次の形の Deployment を自前で追加する
(`deployment.yaml` には含まれていない):

1. **`docs-local` 用の PVC**(または ConfigMap。文書量が ConfigMap の1MiB制限に収まるなら
   ConfigMap で十分)を作成し、社内文書の Markdown をそこに配置する
2. `initContainer` で KIZAMI のソース一式(git clone や ConfigMap 経由)を取得し、
   1. の `docs-local` をマウントしたうえで `pnpm docs:build` を実行、結果を
   `emptyDir`(ビルド成果物用)へ書き出す
3. メインコンテナ(nginx 等の静的配信サーバー)が同じ `emptyDir` をマウントして配信する

```yaml
volumes:
  - name: docs-local
    persistentVolumeClaim:
      claimName: kizami-docs-local
  - name: docs-dist
    emptyDir: {}
initContainers:
  - name: docs-build
    image: node:22
    workingDir: /work
    command: ["sh", "-c", "corepack enable && pnpm install --frozen-lockfile && pnpm docs:build && cp -r docs/.vitepress/dist/. /dist"]
    volumeMounts:
      - { name: docs-local, mountPath: /work/docs-local, readOnly: true }
      - { name: docs-dist, mountPath: /dist }
containers:
  - name: docs
    image: nginx:alpine
    volumeMounts:
      - { name: docs-dist, mountPath: /usr/share/nginx/html, readOnly: true }
```

`docs-local` の中身を更新したら、Pod を再作成(`kubectl rollout restart`)して
initContainer を再実行すれば反映される。

## PostgreSQL を使う(任意 / 既定は SQLite)

KIZAMI は `DATABASE_URL` のスキームだけでダイアレクトを切り替える
(設計は [docs/design/db-dialects.md](../../docs/design/db-dialects.md))。
`postgres://` を渡せば PostgreSQL に、それ以外なら従来どおり SQLite になる。
マイグレーション(`migrations-pg/`)は Pod 起動時に自動適用されるので追加の Job は要らない。

**SQLite のままでよい場合はこの節を読み飛ばしてよい**(既定は変わっていない)。

移行/切り替えの手順:

1. PostgreSQL を用意する(クラスタ内に立てる、あるいはマネージドを使う)。
   バージョンは 15 以降を推奨(CI は 17 で検証している)
2. 接続文字列を Secret に入れる:

   ```sh
   kubectl -n kizami create secret generic kizami-database \
     --from-literal=url='postgres://kizami:<password>@postgres.kizami.svc:5432/kizami'
   ```

3. `deployment.yaml` の `api` / `worker` 両コンテナの `DATABASE_URL` を、
   固定値(`file:/data/kizami.db`)から Secret 参照に差し替える:

   ```yaml
   - name: DATABASE_URL
     valueFrom:
       secretKeyRef: { name: kizami-database, key: url }
   ```

   `seed-job.yaml`(初期管理者作成)とテナント作成 Job も同様に差し替えること。
   差し替え漏れがあると、その Job だけ空の SQLite を作ってしまう

4. SQLite 用の PVC マウント(`data` volume と `volumeMounts`)を外す。
   `pvc.yaml` 自体も不要になる

5. **replicas 1 固定の制約が外れる**のはこのときだけ。SQLite + RWO PVC のときは
   1 固定だが、PostgreSQL なら api を水平スケールできる
   (worker は日次スキャンの二重実行を避けるため 1 のままにすること)

既存の SQLite からのデータ移行ツールは用意していない(スキーマは両ダイアレクトで一致するが、
ダンプ変換は運用側の作業)。

## 既知の制約 / 将来課題

- API コンテナは `tsx` でソース(TypeScript)を直接実行している(ビルド済み JS を実行する本来のパイプラインは未整備)。`tsx` は `apps/api/package.json` の `dependencies` に含めてある(詳細は `docker/api.Dockerfile` 冒頭コメント参照)
- Helm chart 化、HPA/PDB、Ingress 化(NodePort → ClusterIP + Ingress Controller)は v1.0 以降の検討事項
- SQLite → PostgreSQL のデータ移行ツールは未提供(スキーマは一致するのでダンプ変換で移せる)
