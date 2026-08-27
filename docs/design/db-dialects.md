# DB ダイアレクト(SQLite 既定 / PostgreSQL 選択式)

KIZAMI は **SQLite(libSQL)を既定**とし、**PostgreSQL を選択式**でサポートする(要件 §9)。
切り替えは `DATABASE_URL` のスキームだけで行い、設定項目は増やさない。

3つめのダイアレクトとして **Cloudflare D1** も持つ。D1 は接続 URL ではなく Workers の
バインディングで渡すため切り替えの形が違い、制約も別にあるので
[Cloudflare Workers + D1 対応](./workers-d1.md) に分けて書いてある。

| `DATABASE_URL` | ダイアレクト | ドライバ | マイグレーション |
| --- | --- | --- | --- |
| `file:./kizami.db` / `:memory:` / `libsql://…` | SQLite | `@libsql/client` | `packages/db/migrations/` |
| `postgres://…` / `postgresql://…` | PostgreSQL | `pg`(node-postgres) | `packages/db/migrations-pg/` |

判定は [`packages/db/src/dialect.ts`](https://github.com/sasagar/kizami/blob/main/packages/db/src/dialect.ts) の
`resolveDialect()`。未知のスキームは SQLite 扱いにする(既定が SQLite であること自体が要件のため)。

接続の生成は **Node 専用のサブパス** `@kizami/db/node` にある(`@libsql/client` と `pg` が
`node:net` / `node:fs` に依存していて workerd ではバンドルできないため。
[Workers + D1 対応](./workers-d1.md)を参照)。
スキーマ・クエリ層・型は従来どおり `@kizami/db` から取れる。

```ts
import { createDatabase, migrateDb } from "@kizami/db/node";

// マイグレーションを流して DB ハンドルを得る(apps/api の起動経路と同じ)
const { db, dialect, client } = await migrateDb({ url: process.env.DATABASE_URL });

// マイグレーションなしで接続だけしたいとき
const handle = await createDatabase(process.env.DATABASE_URL);
```

## 全体像

```
src/schema/      … sqlite-core のテーブル定義【単一の正】
      │                                    │
      │ 実行時に読み取って生成               │ そのままクエリ組み立てに使う(両ダイアレクト)
      ▼                                    ▼
src/schema-pg/   … pg-core ミラー          src/queries/  … クエリ層(1本だけ)
      │  【DDL 専用・クエリ層は参照しない】        │
      ▼                                          ▼
migrations-pg/   … drizzle-kit 生成          drizzle(libsql) / drizzle(node-postgres)
```

### 1. スキーマの単一の正は sqlite-core

`packages/db/src/schema/` の `sqliteTable` 定義がスキーマの唯一の正である。
PostgreSQL 用の `pg-core` 定義は **手で書き写さず**、`src/schema-pg/generate.ts` が
sqlite-core のテーブルオブジェクトを読んで実行時に組み立てる(列・NOT NULL・default・
PK・index・FK すべて)。二重管理は必ずズレるため、そもそもズレようがない形にした。

生成器そのもののバグ(型の取りこぼし・index/FK の欠落・default 変換ミス)は
[`test/schema-drift.test.ts`](https://github.com/sasagar/kizami/blob/main/packages/db/test/schema-drift.test.ts)
が両者を突き合わせて検出する(help-content の locale 差分テストと同じ役割)。

`src/schema-pg/` の用途は次の2つだけで、アプリケーションコードからは参照しない。

1. `drizzle.config.pg.ts` が読み込み、`migrations-pg/` の DDL を生成する
2. drift テストが sqlite 側との一致を検証する

### 2. クエリ層は 1 本(両ダイアレクト共通)

`src/queries/` の関数は **SQLite でも PostgreSQL でも sqlite-core のテーブルオブジェクトで**
SQL を組み立てる。ダイアレクトごとに実装を分けたり、テーブルを引数で受け渡したりはしていない。

成立する理由:

- KIZAMI のクエリが使う drizzle の API(`select` / `insert … returning` / `update` /
  `delete` / `onConflictDoUpdate` / `transaction` / 相関サブクエリ)は、SQL 生成の結果が
  両ダイアレクトで一致する。`drizzle-orm/pg-core` の SQL ビルダはテーブル/カラムを
  共通基底(`Table` / `Column`)として扱い、識別子のクォートも同じ `"` である
- 列の**値マッピング**(boolean を 0/1 として読み書きする、JSON は TEXT に自前で
  stringify する、時刻は UTC エポック分の整数)も両ダイアレクトで一致するよう、
  pg 側の DDL を SQLite 側に寄せてある(次節)
- 差が出るのは表記だけ(プレースホルダ `?` と `$1`、省略列の `null` と `default`、
  ON CONFLICT ターゲットの修飾有無)で、いずれも意味は同じ

この前提が崩れていないことは
[`test/dialect-portability.test.ts`](https://github.com/sasagar/kizami/blob/main/packages/db/test/dialect-portability.test.ts)
が、実 DB を使わずに **生成 SQL 文字列そのものを両ダイアレクトで突き合わせて**守っている。

**唯一の例外が JOIN の別名**。drizzle の `PgDialect` は JOIN 句だけ `is(table, PgTable)` で
分岐しており、SQLiteTable の別名はここで else 節に落ちて `left join "superseding"` と
**元テーブル名が消えた SQL** を吐く(FROM 句と相関サブクエリは両ダイアレクト同一実装なので
問題ない)。これは `src/alias.ts` が吸収している — 別名オブジェクトの `getPrototypeOf` だけを
差し替え、drizzle の `is()` から見て「PgTable でも SQLiteTable でもある」ように見せる。
**クエリ層は `drizzle-orm/sqlite-core` の `alias` ではなく `@kizami/db` の `alias` を使うこと。**

> 型について: `Database` 型は libSQL 版(`LibSQLDatabase<typeof schema>`)を代表型として使う。
> PostgreSQL 実体を返すときは `src/migrate.ts` で一度だけキャストしており、
> 呼び出し側(apps/api・src/queries/)はダイアレクトの差を意識しない。

### 3. 型マッピング — SQLite に寄せる

移行時に値の解釈が変わらないことを最優先し、PostgreSQL 側の「らしい」型はあえて使わない。

| sqlite-core | PostgreSQL | 理由 |
| --- | --- | --- |
| `text(…)` | `text` | そのまま |
| `integer(…)` | `integer` | 時刻は UTC エポック**分**。int4 の上限は西暦 6000 年台なので足りる |
| `integer(…, { mode: "boolean" })` | `integer` | **`boolean` にしない**。0/1 のまま両ダイアレクトで同じ値になり、クエリ層も 1 本のままにできる |
| `real(…)` | `double precision` | SQLite の REAL は 8 バイト。pg の `real`(4 バイト)では GPS 座標が丸まる |
| 日付("YYYY-MM-DD") | `text` | `date` 型にすると比較・返り値の型が変わる。文字列比較のまま揃える |
| JSON(`attendance_rate` 等) | `text` | 保存側で `JSON.stringify` している既存実装をそのまま使う。`jsonb` にすると返り値がパース済みオブジェクトになり、クエリ層に分岐が要る |

### 4. マイグレーション

- SQLite: `pnpm --filter @kizami/db generate`(drizzle-kit そのまま)
- PostgreSQL: `pnpm --filter @kizami/db generate:pg`

`generate:pg` は drizzle-kit を呼んだあと、FK 句の `REFERENCES "public"."tenants"("id")` から
**public 決め打ちを剥がす**([`scripts/generate-pg.mjs`](https://github.com/sasagar/kizami/blob/main/packages/db/scripts/generate-pg.mjs))。理由は2つ:

1. **配備**: PostgreSQL 運用では KIZAMI 専用スキーマに入れて `search_path` で切り替えるのが
   普通で、public 決め打ちだとそれができない。非修飾なら `search_path` に従う
2. **テスト**: packages/db のテストは1件ごとに専用スキーマを切って並列に走る

剥がし忘れ(`drizzle-kit` を直接叩いた場合)は `test/migrations-pg.test.ts` が検出する。

マイグレーション適用はどちらも `migrateDb()` の中で自動的に行われる
(apps/api の `node.ts` / `worker.ts` は既存のまま、`DATABASE_URL` を渡すだけ)。

## テスト

`packages/db` の**全テストが両ダイアレクトで走る**。テストファイル自体はダイアレクトを知らず、
分岐は [`test/support/db.ts`](https://github.com/sasagar/kizami/blob/main/packages/db/test/support/db.ts) 1 箇所に閉じている。
vitest の projects 機能で同じテストファイルを 2 レグ走らせる構成:

```bash
# SQLite レグだけ(Docker 不要。TEST_PG_URL 未設定ならこれが走る)
pnpm --filter @kizami/db test

# 両レグ
docker run --rm -d -p 15432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kizami postgres:17-alpine
TEST_PG_URL=postgres://postgres:test@localhost:15432/kizami pnpm --filter @kizami/db test
```

`TEST_PG_URL` が無い環境では PostgreSQL レグが**そもそも作られず**、起動時に理由と
実行方法を出力する(Docker を持たない貢献者でも緑になる)。

PostgreSQL レグは `migrateDb()` 呼び出しごとに専用スキーマ(`kizami_test_*`)を切り、
接続の `search_path` をそこに固定する。走り始めと終わりに残骸をまとめて落とす
(`test/support/pg-global-setup.ts`)。

**apps/api 側は SQLite のまま**で、PostgreSQL は
[`test/postgres-smoke.test.ts`](https://github.com/sasagar/kizami/blob/main/apps/api/test/postgres-smoke.test.ts)
の 1 本だけが「マイグレーション適用 → ログイン → 打刻 → 集計」を通す。API 層はダイアレクトに
一切依存せず(依存するのは packages/db だけ)、そちらは全テストが両ダイアレクトで走っているため、
apps/api では起動経路の疎通確認で足りるという判断(2026-08-24)。

CI は `.github/workflows/ci.yml` の `test-postgres` ジョブが postgres サービスコンテナ付きで
`@kizami/db` と `@kizami/api` のテストを走らせる。

## 既知の差分と注意点

- **ORDER BY のテキスト照合順序**: SQLite は BINARY 固定、PostgreSQL は DB の
  `LC_COLLATE` に従う。KIZAMI が文字列でソートするのは UUIDv7 と `YYYY-MM-DD` だけで、
  どちらも記号位置が揃った ASCII なので実質同じ順序になる。**日本語の氏名などを
  ORDER BY する機能を足すときは、両ダイアレクトで順序が変わることに注意すること**
- **`LIKE` の大文字小文字**: SQLite の `LIKE` は ASCII について大文字小文字を区別しないが、
  PostgreSQL は区別する。現在の唯一の用途(監査ログの `targetType:%` 前方一致)は
  小文字固定の識別子なので影響しない
- **UNIQUE 違反の判定**: `isUniqueConstraintError()` が SQLite の `SQLITE_CONSTRAINT*` と
  PostgreSQL の SQLSTATE `23505` の両方を見る。呼び出し側(修正申請の承認で 409 を返す処理)は
  ダイアレクトを意識しない
- **`pg` の依存宣言**: `apps/api` にも `pg` を直接依存として入れてある。pnpm が
  drizzle-orm の peer(`pg` の有無)ごとに別インスタンスを解決してしまい、
  `packages/db` と `apps/api` で `SQL<unknown>` が別の名前的型になって typecheck が
  落ちるため(2026-08-24)
- **Cloudflare D1**: 3 つ目のダイアレクトとして要件に挙がっているが本対応の範囲外。
  D1 は sqlite-core をそのまま使えるので、`resolveDialect` に分岐を足して
  `drizzle-orm/d1` を選ぶ形で乗る想定

## 配備

- **Compose**: 既定は SQLite のまま。PostgreSQL 構成のサンプルは
  `deploy/compose/compose.yaml` 末尾にコメントアウトで置いてある
- **Kubernetes**: `deploy/k8s/README.md` の「PostgreSQL を使う」節を参照。
  `DATABASE_URL` を Secret で差し替え、SQLite 用の PVC を外すだけ
