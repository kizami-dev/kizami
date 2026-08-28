# リリース手順とバージョン方針

KIZAMI のリリースは **版タグの push だけ** で完結する。タグを打つ前に
バージョン番号・CHANGELOG・実装が揃っていることを機械的に確かめ、揃っていなければ
リリースを止める。

- バージョンの正: リポジトリルートの `package.json` の `version`
- 変更履歴の正: [CHANGELOG.md](https://github.com/kizami-dev/kizami/blob/main/CHANGELOG.md)([Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式)
- 自動化: `.github/workflows/release.yml`(タグ `v*` の push で起動)

## バージョン番号

[Semantic Versioning](https://semver.org/lang/ja/)。ただし **0.x 系のあいだは
マイナー版の更新に破壊的変更を含むことがある**(SemVer が 0.x に許している範囲)。

実際に 0.7.0 では月次レスポンスの契約を破壊的に再編している。破壊的変更は
CHANGELOG の `### Changed` に「(**破壊的**)」と明示する。

タグの書式は `v<major>.<minor>.<patch>`(例 `v0.7.0`)。`v` の無いタグは使わない
(2種類のタグが並ぶ余地を残さないため、`scripts/release-check.mjs` が拒否する)。

## リリース手順

### 1. バージョンを上げる

```sh
# 例: 0.7.0 → 0.7.1
node -e 'const f="package.json",p=require("fs");const j=JSON.parse(p.readFileSync(f,"utf8"));j.version="0.7.1";p.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
```

`package.json` の `version` だけを変える。各パッケージは private で個別に版を持たない
(モノレポ全体で1つの版を配る方針)。

### 2. CHANGELOG を書く

`## [Unreleased]` に溜めていた内容を `## [0.7.1] - YYYY-MM-DD` に移し、
`## [Unreleased]` は空の見出しとして残す。末尾のリンク参照も更新する。

書くのは **利用者から見た変化** であって、コミットの一覧ではない。
リファクタや内部の整理は、挙動が変わらないなら書かなくてよい。

### 3. 揃っていることを確認する

```sh
pnpm release:check                             # package.json と CHANGELOG 先頭の一致
node scripts/release-check.mjs --tag v0.7.1    # タグまで含めた3点一致
node scripts/release-check.mjs --body          # Release 本文になる部分の下見
```

### 4. コミットしてタグを push する

```sh
git add package.json CHANGELOG.md
git commit -m "chore(release): v0.7.1"
git push origin main

git tag -a v0.7.1 -m "v0.7.1"
git push origin v0.7.1
```

タグは**リリース内容がすべて main に入ったあと**に打つ。タグ push の時点の main が
そのままイメージになる。

### 5. 自動で走ること

| ジョブ | 内容 |
| --- | --- |
| `verify` | タグ / `package.json` / CHANGELOG 先頭の3点一致。Release と GHCR の版タグが未使用であることの確認 |
| `test` | `ci.yml` をそのまま呼ぶ(typecheck / test / docs:build / PostgreSQL レグ / workerd レグ) |
| `build-push` | GHCR へ `ghcr.io/kizami-dev/kizami-{api,web}` の `:<version>` と `:latest` を multi-arch push |
| `release` | CHANGELOG の該当節を本文に GitHub Release を作成 |

テストが1つでも落ちればイメージは push されない。

## 版タグはイミュータブル

**一度 push した版タグは、指す中身を変えない。** 打ち直し(`git tag -f` + force push、
GHCR の同一タグへの再 push)はしない。

理由は単純で、セルフホストの利用者が `KIZAMI_TAG=0.7.1` で固定している以上、
同じタグが別の中身を指すと「動いていたものが黙って変わる」から。
検証済みという前提そのものが壊れる。

`release.yml` の `verify` ジョブが、GitHub Release と GHCR の版タグの両方について
既存を検出したらそこで止める。リリース後に問題が見つかったときは、
**打ち直さずに次のパッチ版を出す**(`v0.7.2`)。

`:latest` だけは毎回動く。これは「最新を追う」ためのタグなので、それが役目。

## `:latest` と版タグの使い分け

| 用途 | 推奨するタグ | 理由 |
| --- | --- | --- |
| セルフホスト(本番) | **版タグ**(`KIZAMI_TAG=0.7.1`) | 再起動やノード入れ替えのタイミングで中身が変わらない。アップグレードは意図した操作としてだけ起きる |
| 動作を試す / デモ | `latest` | 最新機能をすぐ見られる |
| 作者環境・デモ環境 | `latest`(**自己責任**) | `deploy/k8s` と `deploy/k8s-demo` は現状 `:latest` を追う。壊れたら即座に気づける体制が前提 |

`deploy/compose` の `KIZAMI_TAG`、`deploy/helm/kizami` の `image.api.tag` /
`image.web.tag` で固定できる。

```sh
# deploy/compose/.env
KIZAMI_TAG=0.7.1
```

```sh
helm upgrade kizami deploy/helm/kizami \
  --set image.api.tag=0.7.1 --set image.web.tag=0.7.1
```

## マイグレーションの後方互換ポリシー

### 前進のみ。ダウングレードは非対応

マイグレーションは **前進(up)だけを提供する**。down マイグレーションは書かないし、
書く予定もない。

理由: 前進のマイグレーションはしばしば情報を増やす方向の変換で、逆変換は
一意に決まらない(列の追加なら消せばよいが、値の再解釈や行の分割は元に戻せない)。
「動くように見えて実は壊れている down」を持つより、無いほうが安全。

**アップグレードの前にバックアップを取ること。** 戻す手段はバックアップからの復元だけ。

```sh
# SQLite の場合。WAL があるので生 cp は不可
sqlite3 /data/kizami.db ".backup /backup/kizami-$(date +%Y%m%d).db"
```

### 版を飛ばしたアップグレード

マイグレーションは適用済みのものを記録して差分だけを順に流すため、
**技術的には版を飛ばしても差分がまとめて適用される**。

ただし **0.x 系のあいだは1版ずつの連続適用を推奨する**。0.x では
「マイグレーションと同時にアプリ側のデータ移行・シード同期が必要」な変更が入りうる
(例: 0.7.0 の権限カタログ追加は、システムプリセットへ新権限を同期するシード経路の
実行が別途必要だった)。飛ばすとこの種の手当てを取りこぼす。

1.0 以降は、飛ばしたアップグレードの可否を版ごとに CHANGELOG に明記する。

### 前方互換は保証しない

新しいスキーマに対して古いイメージを動かすことは想定していない
(ロールバックすると DB は新しいまま、アプリだけ古くなる)。
そのためにも、アップグレード前のバックアップが唯一の戻り道になる。

### アップグレードの手順

1. バックアップを取る
2. CHANGELOG の該当版を読む(破壊的変更と、必要な手当ての有無)
3. イメージのタグを新しい版に変える
4. 起動する(マイグレーションは起動時に適用される)

## 参考

- [CHANGELOG.md](https://github.com/kizami-dev/kizami/blob/main/CHANGELOG.md)
- `.github/workflows/release.yml` — リリースパイプライン
- `.github/workflows/ci.yml` — テスト定義(リリースからも `workflow_call` で呼ばれる)
- `scripts/release-check.mjs` — 3点一致の検証と Release 本文の抽出
  (`--self-test` でパーサ自体の回帰テストが走る)
