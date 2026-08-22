# 社内規定ドキュメント(docs-local/)の置き方

このファイル自体(`README.example.md`)は KIZAMI にコミットされている**唯一の例外**です。
`docs-local/` 配下の他のファイルは `.gitignore` で除外されます — このディレクトリは、
KIZAMI を導入した企業が自社の文書を置くための場所であり、KIZAMI プロジェクトの
リポジトリにコミットされるべきものではないためです。

## 何をするための場所か

`pnpm docs:build`(または `pnpm docs:company` 単体)を実行すると、`docs-local/*.md`
(この `README.example.md` を除く)が VitePress サイトへ取り込まれ、サイドバーの
「**社内規定**」セクションに表示されます。KIZAMI 本体をフォークせずに、自社の運用文書を
制度ガイドと並べて見せられます。

アプリ内のヘルプに出す短い追記(有給の申請期限など)は `/settings/help` 画面(DB に保存)
の役割です。`docs-local/` は、それよりまとまった分量の文書(運用マニュアル・FAQ・
就業規則の抜粋など)を置く場所として使い分けてください。

## 使い方

1. `docs-local/` ディレクトリの直下に Markdown ファイルを置く(サブディレクトリは対応していません)
2. ファイル名がそのままページのスラッグになります(例: `remote-work-policy.md` →
   `/company/remote-work-policy`)
3. 各ファイルの最初の `# 見出し` がサイドバーの表示名になります
4. `pnpm docs:build` を実行するとサイドバーに反映されます

```
docs-local/
├── README.example.md      # このファイル(コミット対象・編集不要)
├── remote-work-policy.md  # 例: リモートワーク規程の抜粋
└── expense-rules.md       # 例: 経費精算のルール
```

## 書き方

- KIZAMI 組み込みのヘルプ(法令・KIZAMIの仕様)の内容を書き写さないでください。
  法改正で KIZAMI 側だけが更新され、ここに古い記述が残って矛盾する原因になります
- 就業規則そのものの代わりにはなりません。正式な規程集は別途 PDF 等で管理し、
  `/settings/help` 画面の「就業規則へのリンク」からリンクしてください
- 自社で決めたことだけを書いてください(期限・窓口・例外の扱いなど)

## Docker / Kubernetes での差し込み方

コンテナ環境では、ビルド時ではなくボリュームマウントで `docs-local/` を差し込みます。
手順は `deploy/k8s/README.md` の「社内規定ドキュメント(docs-local/)」を参照してください。
