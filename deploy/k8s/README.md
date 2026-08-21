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
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
```

Pod が Running/Ready になるまで待つ:

```sh
kubectl -n kizami rollout status deployment/kizami
```

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
