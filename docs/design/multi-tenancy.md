# マルチテナントとテナント分離

対象: v1.0「マルチテナント有効化」(2026-08-24)。要件は [要件定義書 §7](../requirements.md) を参照。

## 何が「有効化」されたのか

データモデルは v0.1 から全テーブルが `tenant_id` を持つ設計だったが、テナントを作る経路が
開発用シード(`apps/api/src/seed.ts`)しかなく、実質的に1インスタンス1社の運用しかできなかった。
v1.0 で次の2つを揃え、**1インスタンスに複数社を同居させられる状態**にした。

1. 運用者がテナントを作れる CLI(`pnpm create-tenant`)
2. テナント間分離の網羅的な監査テスト(`apps/api/test/tenant-isolation.test.ts`)

セルフサインアップ(自由登録)は**既定では提供しない**。テナントの作成は運用者の作業であり、
テナント内のメンバー追加は招待フロー(`POST /members`)で行う。SaaS 形態では環境変数
`SIGNUP_MODE` を `invite` / `open` にした場合だけ、メール確認後にテナントが自己申込みで作られる
([KIZAMI Cloud](./saas.md)「サインアップ」。2026-10-03 実装中)。

## テナントの作り方

```sh
TENANT_NAME='株式会社サンプル' ADMIN_EMAIL='admin@example.com' ADMIN_PASSWORD='...' \
  pnpm --filter @kizami/api create-tenant
```

作られるもの(`apps/api/src/lib/tenant-bootstrap.ts` の `bootstrapTenant`):

| 対象 | 内容 |
| --- | --- |
| `tenants` | 1行(社名) |
| `tenant_setting_versions` | 既定版(日界0時・法定休日=日曜・休憩は打刻方式・GPS 無効) |
| `work_policies` / `work_policy_versions` | 標準フレックス・月清算・所定1日480分 |
| `permission_presets` | 同梱プリセット3種(管理者・マネージャー・メンバー、`is_system=true`) |
| `users` / `auth_credentials` / `user_policy_assignments` | 管理者1名(「管理者」プリセット割当済み) |

`seed`(開発用)と `create-tenant`(運用)は同じ `tenant-bootstrap.ts` を共有する。同梱プリセットの
権限表(`ADMIN_GRANTS` ほか)もここが唯一の定義で、権限カタログに項目が増えたときは
`syncSystemPresetGrants` が既存テナントへ追記する(削除はしない)。

## 分離の原則(実装規約)

1. **すべての読み書きは `tenant_id` で絞る。** クエリ層のヘルパは原則 `{ tenantId, id }` を受け取る形にする
   (`getUserById` / `getPresetById` / `getShiftPlanById` など)。`id` だけを受け取る既存ヘルパ
   (`getCorrectionRequest` / `getLeaveRequest` / `getAutoBreakWaiverById`)を使う場合は、
   呼び出し側で必ず `row.tenantId !== actor.tenantId` を確認して 404 にする。
2. **スコープ判定は分離の代わりにならない。** `resolveAccessibleUserIds` は tenant スコープの actor に
   対して `"all"` を返す。これは「自テナント全員」の意味なので、リクエストで渡された
   ユーザーIDが自テナントに実在することの確認を別途行うこと(この取り違えが実際の穴になった。下記)。
3. **他テナントのIDは 404 に倒す。** 403 と使い分けない — 「権限が無い」と「存在しない」を区別すると、
   他テナントのIDの当たり/外れが漏れる。空配列の 200 も返さない(同じ理由)。
4. **セッション・APIキーはテナントに紐づく。** 同じメールが複数テナントに存在しうるため、ログインは
   パスワード一致が複数テナントにまたがる場合にテナント選択を挟む(`409 multiple_tenants` →
   `tenantId` を添えて再ログイン)。APIキー認証は `api_keys.tenant_id` と `users.tenant_id` の
   一致を必ず確認する。

## システム表の例外

上の原則1は「テナントに属するデータ」の規約で、**テナントを持たない運用上の表**は対象外とする。
該当するのは次の3つだけで、`tenant_id` を持たず、テナント向けのクエリ・ルートからは触らない
(アクセス経路を限定する)。

| テーブル | 用途 | アクセス経路 |
| --- | --- | --- |
| `worker_heartbeats` | 定期スキャンワーカーの最終実行時刻(`/metrics` 用) | ワーカー・`GET /metrics` |
| `signup_invite_codes` | セルフサインアップの招待コード(コードは運用者のものでテナントのものではない) | 運用者 CLI・`POST /signup` 系 |
| `pending_signups` | メール確認待ちの登録申請(確認されるまでテナントが存在しない) | `POST /signup` 系・掃除ジョブ |

`pending_signups.tenant_id` は「確認完了後に作られたテナントの記録」であり、行の所有者を表さない
(参照のみ。NULL 許容)。システム表には平文のコード・トークンを保存せず SHA-256 のみ持つ。

## 2026-08-24 の監査で見つかった穴

`apps/api/test/tenant-isolation.test.ts` はこの3件のリグレッションテストを含む。

| 箇所 | 症状 | 修正 |
| --- | --- | --- |
| `POST /shifts/plans` | 他テナントのユーザーIDを受け付け、`tenant_id=自社 / user_id=他社ユーザー` のシフト計画を作れた(原則2の取り違え) | `isUserInShiftManageScope` で対象ユーザーの自テナント実在確認を追加 |
| `POST /api-keys`(`GET /api-keys?userId=` も) | 同様に他テナントのユーザー宛のAPIキー行を作れた(打刻自体は認証時の tenant 不一致で 401 になるが、行が残るのは不正) | 宛先ユーザーの自テナント実在確認を追加 |
| `GET /corrections?userId=` / `GET /leave/requests?userId=` / `GET /auto-break-waivers?userId=` | 他テナントのユーザーIDに 200(空配列)を返していた(原則3違反) | 実在確認を追加して 404 に統一 |

監査でカバーしている経路: 月次勤怠・打刻・修正申請・休暇申請・有給残高・付与予告・休憩控除の
打ち消し申請・シフト・メンバー管理(更新/招待/パスワードリセット/無効化/制度)・権限プリセット・
部署・APIキー・通知・監査ログ・月次締め・CSVエクスポート・テナント設定・ログインのテナント選択。
