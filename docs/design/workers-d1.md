# Cloudflare Workers + D1 対応

KIZAMI の HTTP API は **Node(既定)と Cloudflare Workers(workerd)の両方で動く**
(要件 §8)。DB は SQLite / PostgreSQL に加えて **Cloudflare D1** を3つめのダイアレクトとして
サポートする(要件 §9 のテストマトリクス)。

このページは「**何が Workers で動き、何が動かないか**」を先に書く。動かないものを知らずに
配備すると、承認や締めといった業務操作が実行時に失敗する。

## いま何が動くか

| 機能 | Node | Workers + D1 |
| --- | --- | --- |
| HTTP API(打刻・勤怠参照・月次集計・設定・エクスポート) | ✅ | ✅ |
| セッション認証(Cookie + DB)・APIキー認証・権限判定 | ✅ | ✅ |
| 集計エンジン(`@kizami/engine`、Temporal 経由) | ✅ | ✅(polyfill) |
| 秘密情報の暗号化(`@kizami/crypto`, AES-256-GCM) | ✅ | ✅ |
| 通知の組み立て(`@kizami/notify`) | ✅ | ✅ |
| **トランザクションを使う書き込み**(招待・パスワード再設定・修正申請の承認・締め・休暇申請・Slack 連携) | ✅ | ❌ **未対応**(下記) |
| メール送信(SMTP) | ✅ nodemailer | ❌(node:net 依存) |
| Webhook / Slack 通知(fetch ベース) | ✅ | ✅ |
| Web Push | ✅ | ✅(WebCrypto のみ) |
| 定期スキャン(打刻忘れリマインド・36協定アラート・シフト乖離・有休付与提案) | ✅ BullMQ + Valkey | ❌(Cron Triggers + Queues は今後) |

つまり **v1.0 時点の Workers 配備は「読み取りと打刻が中心の API」までが動作保証範囲**で、
承認ワークフローと定期通知を含むフル機能の配備は Node(Docker Compose / Helm)を使う。

## D1 で動かないもの: 明示トランザクション

D1 は `BEGIN TRANSACTION` / `SAVEPOINT` を拒否する。実際に返るエラーはこれ:

```
To execute a transaction, please use the state.storage.transaction() or
state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or
SAVEPOINT statements.
```

drizzle の `db.transaction(async (tx) => …)` は内部で `begin` を発行するため、D1 では必ず
失敗する。KIZAMI で `db.transaction()` を使っているのは次の経路:

| 場所 | 用途 |
| --- | --- |
| `packages/db/src/queries/invitations.ts` | 招待の発行・受諾(ユーザー作成 + 権限付与 + 監査ログ) |
| `packages/db/src/queries/password-resets.ts` | パスワード再設定トークンの発行・使用 |
| `packages/db/src/queries/permissions.ts` | 権限プリセットの割当 |
| `packages/db/src/queries/slack.ts` | Slack ユーザー連携 |
| `apps/api/src/routes/corrections.ts` | 修正申請の承認(打刻の supersede + 状態更新 + 監査ログ) |
| `apps/api/src/routes/closings.ts` | 月次締め・締め解除 |
| `apps/api/src/routes/leave.ts` | 休暇申請の承認・取消 |
| `apps/api/src/routes/members.ts` | メンバーの停止・再開 |
| `apps/api/src/routes/auto-break-waivers.ts` | 自動休憩控除の免除申請 |

D1 が原子的な複数文実行に用意しているのは `batch()` だけで、drizzle の `db.transaction()` の
ような命令的なコールバック API には自動変換できない。`batch()` へ書き換えると今度は
node-postgres が `.batch()` を持たないため PostgreSQL レグが壊れる。したがって
**v1.0 では「D1 配備ではこれらの経路が使えない」と明記する方針を採った**(2026-08-27 の判断)。

テストでは `packages/db/test/support/db.ts` の `supportsTransactions` フラグで
D1 レグから除外している(`describe.skipIf(!supportsTransactions)`)。将来 D1 が
トランザクションを持つか、クエリ層を `batch()` ベースへ寄せたときに、このフラグを true に
するだけで 34 件のテストが D1 でも走る。

## パッケージの分割: `@kizami/db` と `@kizami/db/node`

`@libsql/client` と `pg` は `node:net` / `node:fs` に依存しており、workerd ではバンドルすら
できない。そこで `@kizami/db` のエントリを2つに割った(2026-08-27):

| エントリ | 中身 | 実行環境 |
| --- | --- | --- |
| `@kizami/db` | スキーマ・クエリ層・型・エラー判定・UUIDv7・`createD1Database()` | Node / workerd 両方 |
| `@kizami/db/node` | 上の全部 + `createDatabase()` / `migrateDb()`(libSQL・pg ドライバ) | Node のみ |

`verbatimModuleSyntax` を有効にしているため `import { type Database } from "…"` でも
import 文自体は残る。型だけを借りている箇所が `src/migrate.ts` を指していると、それだけで
pg が Workers バンドルに引きずり込まれる。型は `src/types.ts` に集約してあるので、
**クエリ層と apps/api は `src/migrate.ts` を(型でも)参照しないこと**。

```ts
// Node(apps/api/src/node.ts)
import { migrateDb } from "@kizami/db/node";
const { db } = await migrateDb({ url: process.env.DATABASE_URL });

// Workers(apps/api/src/workers.ts)
import { createD1Database } from "@kizami/db";
const { db } = createD1Database(env.DB);
```

## マイグレーションはデプロイ時に流す

Workers はリクエスト単位の実行モデルで「起動時に1回だけ DDL を流す」場所が無い。同時に
走る多数のアイソレートが一斉に DDL を投げるのも危険なので、**D1 では実行時マイグレーションを
持たない**。

- 本番: `npx wrangler d1 migrations apply kizami --remote`(`apps/api/wrangler.jsonc` の
  `migrations_dir` が `packages/db/migrations` を指す — SQLite レグと同じ `.sql` をそのまま使う)
- テスト: `@cloudflare/vitest-pool-workers` の `applyD1Migrations()` が同じ `.sql` を流す

`migrateDb()`(Node 専用)は D1 ハンドルを受け取った場合に **何もせず返す**。
node:fs 依存のマイグレータへ落ちないための安全弁で、これが「実行時マイグレーションを skip する」
実装上の表現になっている。

## CI カバレッジ

`pnpm test:workers`(リポジトリルートの `vitest.workers.config.ts`)が workerd レグの実体で、
CI の `test-workerd` ジョブが毎 PR で走る。Docker もクラウド接続も要らない
(miniflare がローカルで workerd と D1 エミュレータを起動する)ので、PostgreSQL レグのような
環境変数ゲートは設けていない。

| 対象 | 収録範囲 | 備考 |
| --- | --- | --- |
| `@kizami/engine` / `crypto` / `notify` / `law` / `leave` / `authz` | **Node レグと同一スイート丸ごと** | 「ランタイム非依存」を謳っているパッケージ。ここが赤くなったら看板が嘘になる |
| `@kizami/db` | **Node レグと同一スイート**を D1 で(`vitest.d1.config.ts`) | トランザクション依存の 34 件は skip。ドライバを直接読む3ファイルは除外 |
| `apps/api` | 起動スモーク(`test/workers/smoke.test.ts`) | 本体スイート 700 件超は移植しない(下記) |
| Workers バンドル | `wrangler deploy --dry-run` | `node:*` がアプリ経路に紛れ込むとここで落ちる |

### なぜ apps/api の本体スイートを workerd へ持ち込まないか

`apps/api/test/support/setup.ts` は **テストごとに一時ファイルの SQLite を作る**前提で書かれて
いる。D1 は Worker あたり1バインディング = 1データベースなので、この前提がそのままでは
成り立たない。700 件超のセットアップを書き換える対価に対して、得られる情報は
「ルート層の分岐はランタイムに依存しない」という既に自明なことだけなので、
**起動経路のスモーク1本**に留めた(PostgreSQL レグで `postgres-smoke.test.ts` 1本に
留めたのと同じ判断)。

スモークは `SELF.fetch()` で **配備するのと同じ `src/workers.ts` の default export** を叩き、
ログイン → 打刻 → 勤務状態 → 月次集計まで通ることを見る。

### ゴールデンケースも workerd で走る

`packages/engine` の法令ゴールデンケース(YAML フィクスチャ)は元々 `node:fs` でフィクスチャを
読んでいたため workerd では動かなかった。`import.meta.glob(…, { query: "?raw" })` に
置き換えて、**Node レグと workerd レグの両方で同じフィクスチャが走る**ようにしてある
(2026-08-27。`packages/engine/test/support/fixtures.ts`)。

## ローカルでの走らせ方

```sh
# workerd レグ(ランタイム非依存パッケージ + D1 + apps/api スモーク)
pnpm test:workers

# @kizami/db の D1 レグだけ
pnpm --filter @kizami/db exec vitest run --config vitest.d1.config.ts

# Workers バンドルがビルドできるか(デプロイはしない)
pnpm --filter @kizami/api build:workers
```

## 配備の素描(未実施)

このリポジトリからの自動デプロイは用意していない。手順の骨子だけ残す。

1. **D1 を作る**
   ```sh
   npx wrangler d1 create kizami
   ```
   出力された `database_id` を `apps/api/wrangler.jsonc` の `d1_databases[0].database_id` に入れる。
2. **マイグレーションを適用する**
   ```sh
   npx wrangler d1 migrations apply kizami --remote
   ```
3. **secret を入れる**(`vars` に書くのは秘密でない設定だけ)
   ```sh
   npx wrangler secret put KIZAMI_ENCRYPTION_KEY   # 32バイトの base64
   npx wrangler secret put VAPID_PRIVATE_KEY       # Web Push を使うなら
   ```
   `wrangler.jsonc` の `vars` に置くもの: `COOKIE_SECURE` / `TRUST_PROXY` /
   `CORS_ORIGIN` / `APP_BASE_URL` / `OIDC_REDIRECT_URI` / `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT`。
   名前と意味は `apps/api/src/node.ts` が読む環境変数と一対一に揃えてある。
4. **デプロイ**
   ```sh
   npx wrangler deploy
   ```

### 今後の課題

- **キュー/スケジューラ**: Node は Valkey + BullMQ(`apps/api/src/worker.ts`)。Workers 側は
  Cron Triggers でスキャンを起動し、通知の送出を Cloudflare Queues に載せる形になる。
  スキャン本体(`reminders.ts` / `overtime-alerts.ts` / `shift-variance-alerts.ts` /
  `leave-alerts.ts` / `leave-grant-proposals.ts`)は既に BullMQ にも `node:*` にも依存しない
  純関数なので、**呼び出し側だけを書けばよい**状態にはなっている。中途半端な実装を入れないため
  v1.0 のこのパスでは着手していない。
- **メール送信**: `@kizami/notify` の `createSmtpChannel(config, sendFn)` は送信関数を注入する
  形なので、fetch ベースのメール API(Cloudflare Email Service / Resend 等)の `SmtpSendFn` を
  1本書けば Workers でも送れる。`packages/notify` 側の変更は不要。
- **レート制限**: `apps/api/src/lib/rate-limit.ts` のカウンタはプロセス内メモリで、
  Workers ではアイソレートごとに分かれるため実効的な制限が Node よりずっと緩い。
  厳密にやるなら Durable Object か KV に載せ替える(差し替え点はファイル冒頭に明記してある)。
- **トランザクション**: 上記「D1 で動かないもの」を参照。
