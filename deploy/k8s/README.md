# KIZAMI k8s デプロイ資材

素の YAML 一式(Helm 化は v1.0 で検討)。k3s(sakura=amd64 + samurai-watch/samurai-matrix=arm64)への手動適用を想定。

前提:

- StorageClass `local-path` が既定で使えること(k3s 同梱の Local Path Provisioner)
- イメージは `.github/workflows/images.yml` で `ghcr.io/sasagar/kizami-api` / `kizami-web` に `linux/amd64,linux/arm64` マルチアーチ push 済みであること
- SQLite ファイル DB を PVC(RWO)に置くため **replicas は 1 固定**。水平スケールは不可

## 適用手順

```sh
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/pvc.yaml
kubectl apply -f deploy/k8s/valkey.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
```

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

`apps/api/src/seed.ts` は `SEED_EMAIL` のユーザーが既に存在する場合は何もせずスキップする(冪等)ので、誤って複数回流しても安全。

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

## 既知の制約 / 将来課題

- API コンテナは `tsx` でソース(TypeScript)を直接実行している(ビルド済み JS を実行する本来のパイプラインは未整備)。`tsx` は `apps/api/package.json` の `dependencies` に含めてある(詳細は `docker/api.Dockerfile` 冒頭コメント参照)
- Helm chart 化、HPA/PDB、Ingress 化(NodePort → ClusterIP + Ingress Controller)は v1.0 以降の検討事項
