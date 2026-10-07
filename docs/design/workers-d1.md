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
| **トランザクションを使う書き込み**(招待・パスワード再設定・本人によるパスワード変更・修正申請の承認・締め・休暇申請・Slack 連携) | ✅ | ❌ **未対応**(下記) |
| メール送信(SMTP) | ✅ nodemailer | ❌(node:net 依存) |
| Webhook / Slack 通知(fetch ベース) | ✅ | ✅ |
| Web Push | ✅ | ✅(WebCrypto のみ) |
| 定期スキャン(打刻忘れ・36協定・有給の失効間近/年5日・シフト乖離・有給付与の予告・サインアップの掃除・退会テナントの再通知/物理削除) | ✅ BullMQ + Valkey | ✅ Cron Triggers(**Workers Paid が前提**。下記「定期スキャン」) |
| 定期スキャンが送る通知 | アプリ内・メール・Webhook・プッシュ | アプリ内・Webhook・プッシュ(メールは上の SMTP と同じく無し) |

つまり **Workers 配備は「読み取りと打刻が中心の API」+「定期スキャンによる通知」までが動作保証範囲**で、
承認ワークフローを含むフル機能の配備は Node(Docker Compose / Helm)を使う。

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
| `apps/api/src/routes/tenant-withdrawal.ts` | テナントの退会の申請・取り消し(全データのエクスポートは動く) |
| `packages/db/src/queries/tenant-purge.ts` | テナントの物理削除(既定。`transactional: false` なら D1 でも1文ずつ冪等に動く — [tenant-withdrawal.md](./tenant-withdrawal.md)。Workers の Cron はこのモードで呼ぶ) |

D1 が原子的な複数文実行に用意しているのは `batch()` だけで、drizzle の `db.transaction()` の
ような命令的なコールバック API には自動変換できない。`batch()` へ書き換えると今度は
node-postgres が `.batch()` を持たないため PostgreSQL レグが壊れる。したがって
**v1.0 では「D1 配備ではこれらの経路が使えない」と明記する方針を採った**(2026-08-27 の判断)。

テストでは `packages/db/test/support/db.ts` の `supportsTransactions` フラグで
D1 レグから除外している(`describe.skipIf(!supportsTransactions)`)。将来 D1 が
トランザクションを持つか、クエリ層を `batch()` ベースへ寄せたときに、このフラグを true に
するだけで 34 件のテストが D1 でも走る。

> 2026-10-07: `batch()` で原子的に書く仕組み(atomic plan)を入れ、招待の発行・受諾と月次締め・解除は D1 でも動くようになった。設計と残りの経路の移行手順は [D1 での原子的な書き込み](./d1-atomic-writes.md)。

## 定期スキャン(Cron Triggers、2026-10-07)

Node は `apps/api/src/worker.ts`(BullMQ + Valkey)が全スキャンを1つの repeatable job で
`REMINDER_INTERVAL_MINUTES`(既定 15)分ごとに順に走らせる。Workers は `apps/api/src/workers.ts` の
`scheduled()` が Cron Triggers で起動され、`apps/api/src/workers-cron.ts` の対応表で cron 式からスキャンを選ぶ。
**スキャン本体も1本ずつの実行(失敗の隔離・ログ・心拍・エラー報告)も Node と同じもの**
(`apps/api/src/scheduled-jobs.ts` の `runScanJob`)で、Workers 側に書いたのは対応表と依存の組み立てだけ。
Queues は使わない(判断点: 送出は各スキャンの中で `dispatch()` が直接行い、失敗は次の回の自己修復に任せる —
Node と同じ設計。キューを挟むのは下の「D1 のクエリ数」を超える規模になってから)。

### 対応表

BullMQ の周期は `every`(ミリ秒)で、cron 式でも JST でもない。Cron Triggers は **UTC** で評価されるが、
どれも「15 分ごと」なので時差の換算は要らない。日付の境目(打刻忘れは日界を過ぎた勤怠日、有給の段階は
日本時間の残日数、利用上限の1日は日本時間 0 時区切り)はスキャンの中で `nowMinutes` と JST のオフセットから
求めており、起動の時刻に依存しない。

| スキャン(`job` ラベル) | Node(worker.ts) | Workers の cron 式(UTC) | 備考 |
| --- | --- | --- | --- |
| 打刻忘れリマインド(`reminder`) | 15 分ごと(全スキャンを順に) | `0,15,30,45 * * * *` | |
| 36協定アラート(`overtime-alert`) | 〃 | `1,16,31,46 * * * *` | 一番重い(月・年度・複数月平均の集計) |
| 有給の失効間近・年5日義務(`leave-alert`) | 〃 | `2,17,32,47 * * * *` | |
| シフト予実乖離(`shift-variance-alert`) | 〃 | `3,18,33,48 * * * *` | |
| 有給付与の予告(`leave-grant-proposal`) | 〃 | `4,19,34,49 * * * *` | |
| サインアップ・再設定スロットルの掃除(`signup-cleanup`) | 〃 | `5,20,35,50 * * * *` | 本人用の再設定は Workers では無効なので表は空 |
| 退会テナントの再通知・物理削除(`tenant-withdrawal`) | 〃 | `6,21,36,51 * * * *` | 削除は `transactional: false`。メールは出さない(システムメールが無い) |

判断点: **スキャン1本に cron 式1本**、開始の分を1分ずつずらす。

- CPU 時間と D1 のクエリ数の上限は**起動ごと**に掛かる(下の「上限」)。7本を1起動に詰めると重い本が他の本の枠まで食う
- 上限で起動ごと打ち切られても巻き込まれるのはその1本だけで、その本の心拍が古くなる(`/metrics` の
  `kizami_worker_last_run_timestamp_seconds` で分かる。心拍の表と `job` ラベルは Node と同じ)
- 開始をずらすのは、同じ D1 へ7本が同時に読みに行かないため

`controller.cron` は設定の文字列のまま届くので、**`wrangler.jsonc` の `triggers.crons` と対応表は一字一句
揃える**(`apps/api/test/scheduled-jobs.test.ts` が食い違いで落ちる。全スキャンに cron 式がちょうど1本ずつ
あることも同じテストが見る)。対応の無い cron 式で起動したら何も走らせず、`noRetry()` してから投げる。
周期を変えるときは両方を直す。

### 冪等と再試行

- スキャンの「今」(`nowMinutes`)は壁時計ではなく **Cron の予定時刻(`controller.scheduledTime`)**。
  再試行・二重起動でも同じ「今」になる
- 通知は notifications の UNIQUE(tenant_id, user_id, type, subject_date)+ `createNotificationIfAbsent` で
  1件だけ作り、外部チャネルへは「新規に作れた通知」だけ送る。退会の再通知は条件付き UPDATE の印、
  物理削除は「削除中」の印 + テーブルごとの冪等な削除。掃除は期限切れの削除なので何度でも同じ
- 1本でも失敗したら `noRetry()` を呼んでから投げる(Cron Events に失敗として残る。成功した本まで巻き込む
  即時の再試行はさせず、次の回 = 15 分後にもう一度走る — Node と同じ)。エラー報告(`SENTRY_DSN`)の送信は
  撃ちっ放しなので `ctx.waitUntil()` に登録し、起動の終わりで打ち切られないようにする
- **残る注意**: 有給付与の予告の行は「有効な予告が無ければ作る」(DB の UNIQUE は無い)ので、**同じスキャンが
  同時に2本**走ると重複しうる(順に走る再試行では重複しない)。心拍の書き込みも「読んで更新」なので、
  同時に走ると累計が1つずれうる。Cron の同時の二重起動はまれなので、v1 では受け入れた(下記「今後の課題」)

### 上限(2026-10 時点の Cloudflare の公開値)

| 項目 | Workers Free | Workers Paid | KIZAMI への影響 |
| --- | --- | --- | --- |
| Cron Triggers の数 | アカウントあたり 5 | アカウントあたり 250 | 7本使うので **Free では配備できない**(`triggers` を消せば HTTP API だけは載る) |
| CPU 時間(Cron) | 10 ms | 30 秒(周期 1 時間未満)/ 15 分(周期 1 時間以上) | 15 分周期なので 30 秒。D1 の待ち時間は数えない。`limits.cpu_ms`(既定 30 秒・最大 5 分)は公開値の表では HTTP リクエストの上限として書かれており、Cron に効くかは明記が無いので当てにしない(`wrangler.jsonc` にも書いていない) |
| 実行時間(壁時計、Cron) | 15 分 | 15 分 | |
| D1 のクエリ数 | 1 起動あたり 50 | 1 起動あたり 1000 | **一番効く上限**。スキャンは利用者ごとに数本のクエリを投げるので、利用者がおおむね数百人を超えると途中で打ち切られる |
| 同時の外向き接続 | 6 | 6 | スキャンは1本ずつ順に走らせ、送出も利用者ごとに順に行う |

上限に当たったら: 重いスキャンを 1 時間周期の cron 式(例 `7 * * * *`)へ移すと CPU が 15 分になる
(対応表と `wrangler.jsonc` の両方を直す)。D1 のクエリ数は周期では変わらないので、テナント・利用者の
範囲で起動を分ける(Queues で分割する)のが次の段階。

### ローカルで試す

```sh
cd apps/api
npx wrangler dev                         # D1 はローカルの miniflare
# 別の端末で(cron 式の空白は + にする)
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0,15,30,45+*+*+*+*"
# 予定時刻も指定できる(ミリ秒。スキャンの「今」になる)
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=6,21,36,51+*+*+*+*&time=1776222000000"
```

古い wrangler では `wrangler dev --test-scheduled` + `/__scheduled?cron=...` だった(wrangler 4 系は
`/cdn-cgi/local/scheduled` が既定で生える)。テストは `apps/api/test/workers/scheduled.test.ts` が
`createScheduledController()` で cron 式ごとに `scheduled()` を叩き、心拍・通知の行・D1 での物理削除を確かめる。

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
| `apps/api` | 起動スモーク(`test/workers/smoke.test.ts`)・Cron の `scheduled()`(`test/workers/scheduled.test.ts`) | 本体スイート 700 件超は移植しない(下記) |
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
   `triggers.crons`(定期スキャン)も同時に登録される。**Workers Paid が前提**(上の「定期スキャン」の上限)。

### 今後の課題

- **定期スキャンの規模**(2026-10-07 に Cron Triggers で動かした — 上の「定期スキャン」): 1 起動あたりの
  D1 のクエリ数(Paid で 1000)が利用者数の実質の上限になる。超える規模では、テナント・利用者の範囲で起動を
  分ける(Cloudflare Queues にテナントごとのメッセージを積んで consumer で走らせる)必要がある。スキャン本体は
  `nowMinutes` と DB だけを受け取る関数なので、分割は呼び出し側の変更で済む
- **定期スキャンの同時の二重起動**: 有給付与の予告の行と心拍の累計は「読んでから書く」ので、同じスキャンが
  同時に2本走るとずれうる(上の「冪等と再試行」)。厳密にするなら予告の表に部分 UNIQUE を足すか、
  (job, 予定時刻)を主キーにした起動の記録の表で1本に絞る
- **メール送信**: `@kizami/notify` の `createSmtpChannel(config, sendFn)` は送信関数を注入する
  形なので、fetch ベースのメール API(Cloudflare Email Service / Resend 等)の `SmtpSendFn` を
  1本書けば Workers でも送れる。`packages/notify` 側の変更は不要。
- **レート制限**: `apps/api/src/lib/rate-limit.ts` のカウンタはプロセス内メモリで、
  Workers ではアイソレートごとに分かれるため実効的な制限が Node よりずっと緩い。
  厳密にやるなら Durable Object か KV に載せ替える(差し替え点はファイル冒頭に明記してある)。
- **トランザクション**: 上記「D1 で動かないもの」を参照。
