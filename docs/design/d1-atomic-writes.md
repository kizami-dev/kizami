# D1 での原子的な書き込み(atomic plan)

2026-10-07 着手。[Cloudflare Workers + D1 対応](./workers-d1.md) の「D1 で動かないもの: 明示トランザクション」を
埋めるための設計と、残りの経路の移行手順。関連コード:

| 場所 | 中身 |
| --- | --- |
| `packages/db/src/atomic.ts` | `AtomicPlan`・`runAtomic`・`insertSelectWhere`・`chunkRowsForInsert` |
| `packages/db/test/atomic.test.ts` | 3レグ(SQLite / PostgreSQL / D1)共通のテストと、`changes()` の前提の固定 |
| `packages/db/src/queries/invitations.ts` | 移行済み: `createInvitation`(A)・`acceptInvitation`(B) |
| `packages/db/src/queries/closings.ts` | 移行済み: `closePeriod`・`reopenPeriod`(B、TOCTOU も解消) |

## 1. 問題

D1 は `BEGIN` / `SAVEPOINT` を拒否し、複数文を原子的に実行できるのは `db.batch([...])` だけ。
batch は「文を全部先に渡してまとめて実行する」形なので、従来の
`db.transaction(async (tx) => { ... })` のように**途中の結果を JS で見て分岐できない**。

KIZAMI の書き込みの多くは楽観ロックで、こういう形をしている:

```ts
await db.transaction(async (tx) => {
  const [row] = await tx.update(invitations).set({ acceptedAt: now })
    .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt))).returning();
  if (!row) return null;            // ← claim が取れなかったら、以降を書いてはいけない
  await tx.insert(authCredentials).values({ ... });
  await insertAuditLog(tx, { ... });
});
```

「claim が取れなかったら依存する書き込みをしない」を batch の**前**に決めることはできない。
一方で node-postgres には batch が無いので、batch へ寄せるだけでは PostgreSQL が壊れる。

## 2. パターン: 計画を組み立て、1単位で実行し、コミット後に結果を見る

書き込みを `AtomicPlan` に積み、`runAtomic(db, plan)` がダイアレクトに合わせて実行する。

| ダイアレクト | 実行方法 |
| --- | --- |
| SQLite(libSQL) | `db.batch(statements)`(1トランザクション。ローカルは同期実行なので同一プロセス内で割り込まれない) |
| D1 | `db.batch(statements)`(D1 が暗黙のトランザクションで流す。途中の失敗で全体がロールバック) |
| PostgreSQL | `db.transaction(tx => 文を順に実行)`(従来と同じ本物のトランザクション) |

```ts
import { AtomicPlan, runAtomic } from "../atomic.js";

const plan = new AtomicPlan();
const claim = plan.add((q) =>
  q.update(invitations).set({ acceptedAt: now })
    .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning(),
);
plan.guard("invitation.claim");                 // claim が 0 行なら、計画全体を失敗させる
plan.add((q) => q.insert(authCredentials).values({ ... }));
plan.add((q) => auditLogInsertQuery(q, { ... }));

const result = await runAtomic(db, plan);
if (!result.ok) return null;                    // result.failedGuard === "invitation.claim"。何も書かれていない
const [updated] = result.get(claim);            // コミット後に文ごとの結果を取り出す
```

要点:

- **文は「ビルダ」ではなく「実行先を受け取ってビルダを返す関数」で渡す**。drizzle のビルダは作った時点の
  セッションに紐づくため、`db` で作ったビルダを PostgreSQL のトランザクション(別の接続)で実行できない。
  `q` は SQLite/D1 では `db`、PostgreSQL では `tx` になる
- 結果を見たい文は `.returning()` を付ける。行の配列という形が3ダイアレクトで一致するのは returning 付きだけ
  (無しの文の戻り値は libSQL の ResultSet / D1Result / pg の QueryResult でばらばら)
- 既存の `insertAuditLog` 等は「実行する関数」なので、計画に積むには**ビルダを返す版**を足す
  (例: `auditLogInsertQuery`。既存関数はそれを await するだけの薄い包みにする)
- ID は全テーブルがアプリ側の UUIDv7 なので、依存する行の外部キー(スナップショットの `closing_event_id` 等)は
  計画を組む前に決められる。自動採番の値を後続の文で使う必要は無い

### 2.1 「最新の状態が X なら追記する」型の claim

締め(closing_events)は追記型で、状態は「最新の close/reopen イベント」から導く。UPDATE する行が無いので、
**insert そのものを条件付きにして claim にする**:

```ts
plan.serialize(`closing:${tenantId}:${period}`);      // PostgreSQL の READ COMMITTED 対策(下記)
const inserted = plan.add((q) =>
  insertSelectWhere(q, closingEvents, { id: eventId, event: "close", ... },
    sql`coalesce((${latestCloseOrReopen(q)}), 'reopen') <> 'close'`).returning(),
);
plan.guard("closing.already_closed");
for (const chunk of chunkRowsForInsert(closingSnapshots, snapshots)) plan.add((q) => snapshotInsert(q, chunk));
plan.add((q) => auditLogInsertQuery(q, { ... }));
```

`insertSelectWhere` は `INSERT INTO t (全列) SELECT <値...> WHERE <条件>` を作る(値の埋め方は drizzle の
`values()` と同じ規則 — 既定値・defaultFn・null)。PostgreSQL でもパラメータの型は挿入先の列から推論される
(`TEST_PG_URL` レグで確認済み)。

`serialize(key)` は PostgreSQL でだけ `pg_advisory_xact_lock(hashtextextended(key, 0))` を取る。
READ COMMITTED では2つのトランザクションが互いの未コミットの close を見ずに条件を満たしてしまうため、
同じキーの計画をトランザクション単位で直列化し、後続が先行のコミット済み行を見てから判定するようにする。
SQLite / D1 は書き込みがもともと直列(1ライター)なので no-op。**UPDATE の claim には要らない**
(PostgreSQL は行ロックで後続を待たせ、待ち明けに WHERE を評価し直す)。

## 3. ガードの設計(判断点)

「この実行の claim が成功したか」を依存文に伝える方法として、3案を比べた。

| 案 | 中身 | 評価 |
| --- | --- | --- |
| (1) 自己条件付き文 + claim トークン列 | claim 行に実行ごとに一意なトークンを書き、依存文を `INSERT ... SELECT ... WHERE EXISTS(SELECT 1 FROM t WHERE id = ? AND claim_token = ?)` に書き換える | SQL が3ダイアレクトで同一。ただし claim する表ごとに列を足すマイグレーションが要り(招待・再設定トークン・各申請・退会…)、依存文を1つずつ書き換える。**1つ条件を書き忘れると黙って書き込みが残る**(fail-open) |
| (1') 自己条件付き文 + 既存列の再利用 | `accepted_at = <この要求の時刻>` 等で claim を識別する | 時刻は分単位で、同時の2要求が同じ値を書きうる。一意でないので不採用 |
| **(2) ガード文(採用)** | claim の直後に「直前の文が0行なら計画全体を失敗させる」文を挟む | 依存文は素の insert/update のまま。失敗すると**ガードより前の文も含めて**全部巻き戻る(fail-closed)。スキーマ変更なし |

採用した (2) の実装:

- **SQLite / D1**: `SELECT json_extract('{}', CASE WHEN changes() = 0 THEN 'kizami-atomic-guard:<label>' ELSE '$' END)`。
  `changes()` は同じ接続で直前に完了した INSERT/UPDATE/DELETE の変更行数。0 なら不正な JSON パスとして
  エラーになり、batch ごとロールバックされる。`runAtomic` はエラー文言(`bad JSON path` と印)だけを識別して
  `{ ok: false, failedGuard }` に変え、それ以外のエラー(UNIQUE 違反など)はそのまま投げる
- **PostgreSQL**: トランザクションの中で直前の文の結果行数(returning なら配列長、無しなら `rowCount`)を JS で見て、
  0 なら内部例外でロールバックする。従来の `if (!row) throw` と同じ挙動

PostgreSQL に `changes()` は無いので SQL としては可搬でないが、**計画(どの文の後にガードがあるか)としては可搬**で、
ダイアレクトごとの実装は `runAtomic` の中に閉じている。(1) の「同じ SQL がどこでも動く」利点より、
「依存文に手を入れない・書き忘れても安全側に倒れる・スキーマを変えない」を重く見た。

### 3.1 `changes()` の spike 結果

workerd(miniflare の D1)と libSQL の両方で、batch の中の `changes()` は次のとおりに振る舞った
(`test/atomic.test.ts` の最後の describe で固定):

| batch の中の文 | 直後の `SELECT changes()` |
| --- | --- |
| `UPDATE ... RETURNING`(1行一致) | 1 |
| (その後に) `SELECT * FROM tenants` | 1(SELECT では上書きされない) |
| 2行の `INSERT` | 2 |
| 0行一致の `UPDATE` | 0 |

`CASE` の中の定数式が前もって評価されてしまう(定数の括り出し)心配も確認した — 0 行のときだけエラーになり、
1 行以上なら `'{}'` を返すだけで通る。エラーは D1 では `D1_ERROR: bad JSON path: 'kizami-atomic-guard:…': SQLITE_ERROR`、
libSQL では `LibsqlBatchError`(cause が `SqliteError: bad JSON path: …`)で返る。

**依存している前提**(壊れたら atomic.test.ts が3レグのどれかで落ちる):

- D1 が batch の文を1接続で順に流し、文の間に別の書き込み文を挟まない(公開文書には書かれていない実装依存)
- 不正な JSON パスの文言(SQLite 3.45 以降 `bad JSON path`、それ以前 `JSON path error` の両方を見ている)

## 4. 制約

| 制約 | 中身 | 対処 |
| --- | --- | --- |
| バインド変数は1文 100 個まで(D1) | 複数行の insert はすぐ超える(closing_snapshots は 6 列 → 16 行で上限、users は 11 列 → 9 行) | `chunkRowsForInsert(table, rows)` で割り、塊ごとに `plan.add`。全列ぶんで見積もる(drizzle は values に無い列を既定値のパラメータで埋めることがある) |
| 文の長さは 100 KB まで(D1) | 長い JSON を持つ行の塊 | 塊を小さくする |
| 1呼び出しあたりのクエリ数(D1: Paid 1000 / Free 50) | batch 1回がサブリクエスト1つか文の数で数えるかは公開文書で明確でない | 安全側に**文の数**で見積もる。締めは「ユーザー数 × 区分数 ÷ 16(切り上げ)+ 3」文(イベント・ガード・監査。30人 × 8区分で 18 文)。1000人規模の締めは Free プランでは超えうる — json_each で1文にまとめる案は §7 |
| 計画の中で前の文の結果を読めない(read-your-writes 不可) | 書いた行を読み直して次の値を決める処理は計画にできない | 読み取りは計画の前に済ませる。依存する値はアプリ側で先に決める(UUIDv7 の ID 等)か、サブクエリで SQL 側に寄せる。どうしても読み直すものは §6(C) |
| ガードは書き込み文の直後だけ | SELECT の後に置くと `changes()` が手前の書き込みを指して意味が変わる | `AtomicPlan.guard` / `runAtomic` が、直前が insert/update/delete でなければ例外にする |
| `changes()` はトリガーと外部キーの連鎖削除を数えない | KIZAMI にトリガーは無い | claim を連鎖削除で表さない |
| ガードのラベルは `[a-z0-9_.-]{1,64}` | SQL に文字列リテラルで埋め込むため | 検査して例外 |
| drizzle 0.45 の D1 batch はパラメータ付きの生 SQL(`db.run(sql\`...${x}\`)`)を扱えない | `SQLiteRaw` に stmt が無く `reading 'bind'` で落ちる(spike で確認) | 計画にはビルダ(insert/update/delete/select、`insert().select(sql)` を含む)だけを積む。ガード文はパラメータ無しで組んである |
| `runAtomic` はトランザクションの中から呼べない | PostgreSQL 経路は自分で `db.transaction()` を開く | 外側のトランザクションに乗せたい既存経路(members.ts の招待発行)は `*InTx` 版を残す |

## 5. 移行チェックリスト(残りの経路を1つずつ移すとき)

1. **読み取りを計画の前へ出す**。トランザクション内の SELECT(事前判定・before 値の読み取り・getOrCreate)を外へ。
   事前判定は残してよい(早期の 404/409 のため)が、正しさは計画側の条件付き文で担保する
2. **書き込みを「ビルダを返す関数」にする**。`insertXxx(db, …)` が実行まで行う関数なら、ビルダを返す
   `xxxInsertQuery(q, …)` を足し、元の関数はそれを await する包みにする(既存の呼び出し側は変えない)
3. **claim を条件付き文にしてガードを置く**。
   - UPDATE の claim: `WHERE` に期待する状態(`status = 'pending'`・`used_at IS NULL` 等)を全部入れ、`.returning()`、直後に `plan.guard("<表>.<意味>")`
   - 追記型の claim: `insertSelectWhere(q, table, row, <状態の条件>)` + `plan.serialize(key)`(PostgreSQL 用)+ ガード
   - 「起きてはいけない0行」(`if (!cred) throw new Error(...)`)もガードにし、`failedGuard` のラベルで例外に戻す
4. **ガードごとに応答を対応づける**。ラベルが複数あるとき(signup の「pending 消費」と「招待コード消費」)は
   `result.failedGuard` で 404 / 409 を分ける
5. **複数行の insert を `chunkRowsForInsert` で割る**
6. **戻り値はコミット後に `result.get(ref)` から作る**。通知・メール・セッション発行など計画の外の副作用は、
   `result.ok` を見てから行う(今と同じ順序)
7. **UNIQUE 違反は今までどおり** `isUniqueConstraintError(err)`(`runAtomic` は通常のエラーをそのまま投げる)
8. **テスト**: その経路の db 層テストから `supportsTransactions` のゲートを外し、3レグで走らせる。
   最低限「同時の2要求で勝つのは1つ・負けた側は何も書かない」「claim できない状態では何も書かない」を足す。
   `db.transaction()` を直接使うテストだけはゲートを残す
9. [workers-d1.md](./workers-d1.md) の表から外し、下の監査表の「状態」を更新する

## 6. 監査表(`.transaction(` の 27 か所)

判定:
**A** = 途中の結果で分岐しない書き込みの列(そのまま計画に積む)/
**B** = claim(楽観ロック・条件付き追記)+ 依存する書き込み(ガードを置く)/
**C** = 計画の中で書いた行を読み直して再計算する(締め後修正の amend。フェーズ2)。

| # | 場所 | 処理 | 判定 | 状態 / 移行時の注意 |
| --- | --- | --- | --- | --- |
| 1 | `packages/db/src/queries/invitations.ts` `createInvitation` | 未決着の招待の revoke → 新規発行 | A | ✅ 移行済み |
| 2 | `packages/db/src/queries/invitations.ts` `acceptInvitation` | 招待の claim → 資格情報 → 監査 | B | ✅ 移行済み |
| 3 | `packages/db/src/queries/password-resets.ts` `createPasswordResetToken` | 未決着トークンの revoke → 新規発行 | A | #1 と同形 |
| 4 | `packages/db/src/queries/password-resets.ts` `usePasswordResetToken` | トークンの claim → パスワード更新 → 全セッション失効 → 他トークン失効 → 監査 | B | ガード2つ(`password_reset.claim`、資格情報の update の後に `password_reset.credential` — 後者の失敗は例外に戻す) |
| 5 | `packages/db/src/queries/password-self-service.ts` `changeOwnPassword` | 資格情報の update(0行なら false)→ 他セッション失効 → トークン失効 → 監査 | B | 資格情報の update が claim |
| 6 | `packages/db/src/queries/password-self-service.ts` `issueSelfServicePasswordResetToken` | 本人発行トークンの revoke → 発行 → 監査 | A | |
| 7 | `packages/db/src/queries/permissions.ts` `replacePresetAssignmentsForUser` | 割当の全削除 → 挿入 | A | 挿入を `chunkRowsForInsert` で割る |
| 8 | `packages/db/src/queries/slack.ts` `linkSlackUser` | 既存の連携の削除 → 挿入 | A | |
| 9 | `packages/db/src/queries/tenant-purge.ts` `purgeTenant` | テナントの物理削除 | — | D1 は既存の `transactional: false`(1文ずつ冪等)で動く。移行不要 |
| 10 | `apps/api/src/routes/tenant-withdrawal.ts` 退会の申請 | 退会の claim(条件付き update)→ 監査 | B | |
| 11 | `apps/api/src/routes/tenant-withdrawal.ts` 退会の取り消し | before の読み取り → 取り消しの claim → 監査 | B | before の読み取りは計画の前へ(監査の detail 用。claim が通れば値は同じ) |
| 12 | `apps/api/src/routes/closings.ts` 締め | 状態の再確認 → close 追記 → スナップショット → 監査 | B | ✅ 移行済み(`closePeriod`)。PostgreSQL の TOCTOU も解消 |
| 13 | `apps/api/src/routes/closings.ts` 締め解除 | 状態の再確認 → reopen 追記 → 監査 | B | ✅ 移行済み(`reopenPeriod`) |
| 14 | `apps/api/src/routes/corrections.ts` 修正申請の承認 | 締め状態の確認 → 打刻の supersede/追加 → 状態 claim → 監査 →(締め済みなら)月次を再計算して amend | **C**(締め済み月) / B(それ以外) | 締め前の月は B で移せる。tx 内の `assertAmendAllowed`(締め状態の再確認)は、claim の前に「その月が close でない」を条件にした文 + ガードで表す。UNIQUE(supersedes_id)の 409 は従来どおり |
| 15 | `apps/api/src/routes/corrections.ts` 修正申請の却下 | 状態 claim → 監査 | B | |
| 16 | `apps/api/src/routes/leave.ts` 休暇申請の承認 | 締め状態の確認 → 状態 claim → 監査 →(締め済みなら)再計算して amend | **C** / B | #14 と同じ |
| 17 | `apps/api/src/routes/leave.ts` 付与予告の承認 | 付与の insert → 予告の claim → 監査 | B | claim が2文目でもよい(ガード失敗で手前の付与の insert ごと巻き戻る)。付与 ID は先に決める |
| 18 | `apps/api/src/routes/auto-break-waivers.ts` 免除申請の承認 | 締め状態の確認 → 状態 claim → 監査 →(締め済みなら)再計算して amend | **C** / B | #14 と同じ。部分 UNIQUE の 409 は従来どおり |
| 19 | `apps/api/src/routes/auto-break-waivers.ts` 免除申請の却下 | 状態 claim → 監査 | B | |
| 20 | `apps/api/src/routes/auth-totp.ts` 2FA の有効化 | TOTP の有効化 → リカバリコードの置き換え → 監査 | A | リカバリコードの挿入を割る |
| 21 | `apps/api/src/routes/auth-totp.ts` 2FA の無効化 | TOTP の削除 → 監査 | A | |
| 22 | `apps/api/src/routes/auth-totp.ts` リカバリコードの再生成 | 置き換え → 監査 | A | |
| 23 | `apps/api/src/routes/members.ts` メンバー作成と招待 | ユーザー作成 → 所属 → 制度の割当(getOrCreate)→ 招待 → 監査 → プリセット | A | `getOrCreateTenantWorkPolicy` は tx 内で読む — 計画の前で get、無ければ作る側を計画に積む(同時作成は名前の UNIQUE か `onConflictDoNothing`)。メール重複の UNIQUE → 409 は従来どおり |
| 24 | `apps/api/src/routes/members.ts` 退職処理 | 無効化 → セッション・招待・トークンの失効 → 監査 | A | |
| 25 | `apps/api/src/routes/members.ts` 2FA のリセット | TOTP の削除 → 監査 → 通知 | A | `createNotificationIfAbsent` をビルダ版に |
| 26 | `apps/api/src/routes/members.ts` 個人データの消去 | users の匿名化(0行なら例外)→ 多数の削除 → 監査(削除件数入り) | B | users の update にガード。Slack 連携トークンの削除は「連携の削除結果」を使っている(read-your-writes)ので、連携の削除より**前**に `slack_user_id IN (SELECT ... FROM slack_user_links ...)` のサブクエリで消す。監査の detail の件数は計画の後でしか分からない — 計画の前に数える(管理者の明示操作で同時実行は事実上無い)か、件数を監査から外す判断が要る |
| 27 | `apps/api/src/routes/signup.ts` 申し込みの確定 | pending の claim → 招待コードの claim → テナント一式の作成 → 記録 → 監査 | B | ガード2つ(`signup.pending` → 404、`signup.invite_code` → 409)。`bootstrapTenant` をビルダの列に |

対象外: `packages/db/src/migrate-data.ts`(SQLite → PostgreSQL のデータ移行ツール。Node 専用で D1 では走らない)。

### 6.1 C(締め後修正)の扱い — フェーズ2

#14・#16・#18 は、締め済み月に影響する承認のとき、**同じトランザクションで書いた打刻・申請の状態を読み直して**
対象ユーザーの月次を再計算し(`computeMonthlyOutputForUser(tx, …)`)、その結果をスナップショットの新世代として保存する。
計画の中では書いた行を読めないので、そのままでは atomic plan にできない。

フェーズ2の方針: **書く予定の行を読み取り結果へ重ねる(in-memory overlay)**。計画を組む前に月次の入力
(打刻・申請・設定)を読み、そこへ「これから書く行」(新しい打刻イベント・supersede・承認済みになる申請)を
メモリ上で適用してから再計算する。再計算の結果(スナップショット行・amend イベント・監査)を計画に積み、
claim(申請の状態)と「その月がまだ close のまま」の条件付き文にガードを置く。前提が崩れていれば
(同時に別の承認・解除が入った)ガードで全体が失敗するので、overlay の読み取りが古くても不整合な世代は残らない。

**それまでの暫定**: D1 配備で締め済み月に影響する承認は、`db.transaction()` に入る前に
**409 と明確なエラーコード**(例: `amend_unsupported_on_d1`)で断る(いまは `BEGIN` が拒否されて 500 になる)。
締め前の月の承認は B として先に移す。

## 7. 今後の候補

- `serialize` のキーを持たない「状態の条件付き追記」が他にも出たら、同じく `serialize` を足す(PostgreSQL のみ効く)
- 締めのスナップショットが大きいテナント(Free プランで 50 クエリを超える規模)は、SQLite / D1 だけ
  `INSERT ... SELECT ... FROM json_each(?)` で1文にまとめる(PostgreSQL は `json_array_elements`)。
  ダイアレクトごとに SQL が分かれるので、必要になってから
- D1 の batch で `changes()` が直前の文を指さなくなった場合の退路は、§3 の (1)(claim トークン列 + 自己条件付き文)。
  `AtomicPlan` / `runAtomic` の形はそのまま使えるが、claim する表への列追加と依存文の書き換えが要る
