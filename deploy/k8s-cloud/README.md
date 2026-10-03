# KIZAMI Cloud(app.kizami.dev)デプロイ資材

hosted mode の運用者環境。設計は [docs/design/saas.md](../../docs/design/saas.md)。
セルフホストの参考構成は [../k8s](../k8s/README.md)(SQLite)を見ること — こちらは
PostgreSQL・サインアップ有効・監視とバックアップ込みの「運用者自身の本番」。

構成(`cloud.yaml` 1ファイル):

| リソース | 役割 |
| --- | --- |
| StatefulSet `postgres` | PostgreSQL 17。local-path PVC 10Gi、削除時も PVC は残す(Retain) |
| Deployment `kizami-cloud` | api + web。PVC を掴まないので RollingUpdate(無停止) |
| Deployment `kizami-cloud-worker` | worker + valkey サイドカー。二重スキャン回避のため 1 固定・Recreate |
| Service NodePort 30097 / 30098 | web / api。`externalTrafficPolicy: Local` |
| CronJob `pg-dump` | JST 3:20 に `pg_dump -Fc` をノードの `/var/backups/kizami-cloud` へ |

全 Pod は samurai-matrix に固定する(ノードをまたぐ Pod 間通信を前提にしないクラスタ方針)。

## Secret の作成(初回のみ、`cloud.yaml` 適用前)

```sh
kubectl create namespace kizami-cloud

PGPASS="$(openssl rand -hex 24)"
kubectl -n kizami-cloud create secret generic kizami-cloud-postgres \
  --from-literal=user=kizami --from-literal=password="$PGPASS" --from-literal=db=kizami
kubectl -n kizami-cloud create secret generic kizami-cloud-database \
  --from-literal=url="postgres://kizami:${PGPASS}@postgres.kizami-cloud.svc:5432/kizami"

# hosted 専用の暗号化鍵。自分用本番・デモと共有しない。**クラスタ外にも控えを保管すること**
kubectl -n kizami-cloud create secret generic kizami-cloud-encryption \
  --from-literal=key="$(openssl rand -base64 32)"

# Turnstile(Cloudflare ダッシュボードで app.kizami.dev 用ウィジェットを作成)
kubectl -n kizami-cloud create secret generic kizami-cloud-turnstile \
  --from-literal=siteKey='<site key>' --from-literal=secretKey='<secret key>'

# システムメール(Cloudflare Email Service の SMTP 送信。kizami.dev を Email Sending の送信ドメインに
# 登録済みであること)。ユーザー名は固定で api_token、パスワードは「Email Sending: Edit」だけを持つ
# API トークン。トークンを変数で受けて echo しないこと
kubectl -n kizami-cloud create secret generic kizami-cloud-mail \
  --from-literal=smtpUrl="smtps://api_token:${CF_EMAIL_TOKEN}@smtp.mx.cloudflare.net:465"

# 任意: メトリクス・エラー報告
kubectl -n kizami-cloud create secret generic kizami-cloud-metrics \
  --from-literal=token="$(openssl rand -hex 32)"
kubectl -n kizami-cloud create secret generic kizami-cloud-sentry --from-literal=dsn='<DSN>'
```

トークンは URL に埋め込むため、`/` `+` `=` などが含まれる場合はパーセントエンコードすること。

送信元を Amazon SES に替える場合も `smtpUrl` を差し替えるだけでよい(アプリは汎用 SMTP として送る)。
kizami.dev は SES 側でもドメイン検証(Easy DKIM)済みで、予備の経路として残してある。

## 適用

```sh
kubectl apply -f deploy/k8s-cloud/cloud.yaml
kubectl -n kizami-cloud rollout status deploy/kizami-cloud
```

マイグレーション(`migrations-pg/`)は api 起動時に自動適用される。

### 適用後のネットワーク分離の確認

`cloud.yaml` 末尾の NetworkPolicy(既定全拒否)が意図どおり効いているかを、公開前に確かめる:

```sh
# 1. 正規経路: samurai-watch(10.10.0.2)からは届く
ssh samurai-watch 'curl -s -o /dev/null -w "%{http_code}\n" http://10.10.0.3:30098/healthz'   # 200
# 2. 直接到達: samurai-matrix 自身の VCN アドレスなど、他の送信元からは届かない(タイムアウト)
# 3. 横移動: 他 namespace の Pod から postgres.kizami-cloud.svc:5432 に届かない
kubectl -n kizami-demo run np-check --rm -it --restart=Never --image=postgres:17-alpine -- \
  pg_isready -h postgres.kizami-cloud.svc -t 5                                                # no response
# 4. SSRF: api コンテナからプライベート帯に出られない
kubectl -n kizami-cloud exec deploy/kizami-cloud -c api -- \
  node -e 'fetch("http://10.10.0.2:9090").then(()=>console.log("REACHABLE"),()=>console.log("blocked"))'  # blocked
```

## 公開経路

Cloudflare Tunnel の ingress(Watcher SV トンネル)に追加する。web イメージは API の
ベース URL をビルド時に `/api`(同一オリジン)で埋め込んでいるため、本番・デモと同じく
パスで振り分ける。**Path あり行を Path なし行より上に**置くこと:

1. `app.kizami.dev` Path `^/api` → `http://10.10.0.3:30098`(api)
2. `app.kizami.dev` Path なし → `http://10.10.0.3:30097`(web)

保存後、Path なし行の hostname が意図どおり `app.kizami.dev` になっているか確認する
(demo で別ホスト名のまま保存されて 404 になった前例がある)。

`/metrics` はトンネルに載せない(Prometheus は WireGuard 経由で 10.10.0.3:30098 を直接引く)。

## 招待コードの発行(Closed Beta)

```sh
kubectl -n kizami-cloud exec deploy/kizami-cloud -c api -- \
  node_modules/.bin/tsx src/operator.ts invite-code create --max-uses 1 --expires-days 30 --note '<相手先>'
```

平文コードはこの1回しか表示されない。

## バックアップと復旧

- **dump**: CronJob `pg-dump`(JST 3:20)→ samurai-matrix の `/var/backups/kizami-cloud/kizami-cloud.dump`
- **転送**: ホストの `r2-backup.sh`(infra リポジトリ `ansible/playbooks/backup-to-r2.yml`、JST 3:45)が
  R2 `backups/kizami-cloud/<date>/` へ。dump が 6時間以上古ければ異常終了し、kuma の push が
  止まって通知される。R2 の認証情報はクラスタに持ち込まない。
- **保持**: 日次は R2 バケット `backups` のライフサイクル(全 prefix 30日)。月初(1日)の dump は
  別バケット `backups-monthly/kizami-cloud/<YYYY-MM>/` にも複製し、**400日**保持(13ヶ月分が常に残る)。
  バケットごと分けているのは、R2 のライフサイクルが prefix の除外を書けないため。

### 復旧手順(公開前に必ず1回通すこと — saas.md「実行基盤」)

```sh
# 1. dump を取得(R2 から、または samurai-matrix のローカルファイル)
rclone copyto r2backups:backups/kizami-cloud/<date>/kizami-cloud.dump ./kizami-cloud.dump

# 2. アプリを止める(復旧中の書き込みを防ぐ)
kubectl -n kizami-cloud scale deploy/kizami-cloud deploy/kizami-cloud-worker --replicas=0

# 3. postgres Pod へ dump を渡して復元(--clean で既存オブジェクトを置き換える)
kubectl -n kizami-cloud cp ./kizami-cloud.dump postgres-0:/tmp/restore.dump
kubectl -n kizami-cloud exec postgres-0 -- sh -c \
  'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump && rm /tmp/restore.dump'

# 4. 再開して確認(ログイン・月次画面・監査ログ)
kubectl -n kizami-cloud scale deploy/kizami-cloud deploy/kizami-cloud-worker --replicas=1
```

リハーサルは本番 DB を壊さないよう、別 namespace に同じ StatefulSet を立てて手順 3 を
流し、テーブル行数を比較する形で行う。
