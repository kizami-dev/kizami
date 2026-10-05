# KIZAMI Cloud(hosted mode)

対象: ロードマップ「SaaS トラック」(app.kizami.dev)。2026-08-31 設計。サインアップは Phase 1 実装中(2026-10-03)。
要件は [要件定義書 §7](../requirements.md)(マルチテナント)と
[マルチテナントとテナント分離](./multi-tenancy.md) を前提とする。

## 方針 — セルフホストと同じものが動く

KIZAMI Cloud は本リポジトリのコードそのものを運用者がホストして提供する。
SaaS 専用のコードは「登録・課金・テナント運用」の薄い制御レイヤに限定し、
勤怠機能そのものには分岐を作らない。

- **信頼**: 勤怠データは人事情報そのもの。「中身は公開リポジトリで全部読める」ことが
  最大のセキュリティ説明になる。
- **保守**: 単独運用で2系統のコードベースは負債。SaaS がセルフホスト構成の動作保証を兼ねる。
- **ライセンス**: AGPL-3.0 は著作権者自身のホスト提供を制約しない。SaaS レイヤも本体と
  同じ AGPL でこのリポジトリに置く。

### コードの置き場(判断点)

別リポジトリの制御プレーンに切り出す案も検討したが、本体側に管理 API の口を開ける
必要が生じて結局本体が汚れるうえ、単独運用で2リポジトリは負債なので採らない。
**モノレポ内・フラグゲート**とする(Cal.com 等の先例に同じ):

- 既定値はすべて「SaaS 機能 OFF」。`SIGNUP_MODE` や Stripe 系の環境変数が無ければ
  完全に眠り、セルフホスト体験を一切変えない。
- 副産物として、セルフホスト派も「招待制ではなく自由登録制」の運用に同じコードを使える。

## 実行基盤 — Phase 1 は Kubernetes + PostgreSQL

| 案 | 判定 | 理由 |
| --- | --- | --- |
| k8s + PostgreSQL | **採用** | PG ダイアレクトは実装・CI 済み。`DATABASE_URL=postgres://…` を渡すだけで既存イメージが PG で起動し、マイグレーションも自動適用される(`packages/db/src/migrate.ts` の URL ディスパッチ)。 |
| Cloudflare Workers + D1 | 見送り | D1 が `BEGIN` を拒否するため `db.transaction()` を使う全書込系が未対応([Workers + D1 対応](./workers-d1.md))。解消は独立した工事であり、SaaS の立ち上げをそれに賭けない。 |
| 新規 VPS | 見送り | 既存クラスタに対して費用増のみで利点が無い。 |

テナントが増えた時点で Workers + D1 への移行を再評価する。`migrate-data`
(SQLite→PG)の設計は逆方向にも流用できる。

構成要素:

- 専用 namespace(自分用本番・デモとは完全分離)。PG は単一 StatefulSet + PVC で開始
  (HA 構成は現段階では過剰)。
- 暗号化鍵(`KIZAMI_ENCRYPTION_KEY`)は hosted 専用に新規発行し、他環境と共有しない。
- バックアップ: 日次 `pg_dump -Fc` → オブジェクトストレージ、30日保持+月初世代。
  **復旧手順を文書化し、実際に restore を一度通してから公開する。**
- 可用性: 単一ノードである間は SLA を掲げず、規約に「ベストエフォート」を明記する。

## サインアップ

状態: **Phase 1 実装中**(2026-10-03)。環境変数 `SIGNUP_MODE` で有効化する。未設定/`off`(既定)なら
`GET /signup/config`(`{ "mode": "off" }`)以外のサインアップ系エンドポイントはすべて 404 で、
セルフホストの体験を一切変えない。Workers エントリ(`workers.ts`)では常に off。

| `SIGNUP_MODE` | 動作 |
| --- | --- |
| 未設定 / `off` | 無効(既定)。Web のログイン画面に「新規登録」リンクも出ない |
| `invite` | 招待コード必須(Closed Beta)。運用者が `pnpm operator invite-code create` で発行する |
| `open` | 自由登録(Public Launch 以降。セルフホスト派が自由登録制を敷くのにも使える) |

### フロー

1. `POST /signup` — 組織名・氏名・メール・(invite のとき)招待コード・Turnstile トークン。
   入力検証 → Turnstile 検証(サーバー側 siteverify、`remoteip` 付き)→ 招待コードの**有効性チェックのみ**
   (消費はしない)→ `pending_signups` に保存 → 確認メール送信。応答は常に `202 { "status": "verification_sent" }`。
   **パスワードはここでは受け取らない**(下記「設計判断」)。
2. `GET /signup/verify/:token` — 確認画面の表示用(組織名・氏名・メール)。
3. `POST /signup/verify/:token` — body `{ "password": "..." }`。パスワードを検証・ハッシュ化したうえで
   **1トランザクション**で「pending 消費 → 招待コードの `used_count` を条件付き UPDATE で +1 →
   `bootstrapTenant`(テナント・同梱プリセット・既定 work policy・管理者)→ 監査ログ `tenant.signup`」を行い、
   セッションを発行してログイン済みで返す(既存のログイン応答と同形)。
4. 初回ログイン後は既存のオンボーディングツアーがそのまま動く。

テナント識別子(slug)はこのリポジトリのスキーマに存在しないので採番の対象は無い(`tenants` は UUIDv7 の id と名前のみ)。
将来 slug を導入する場合は自動採番とし、ユーザーに選ばせない(衝突・商標問題の回避)。

### 設計判断

- **テナントはメール確認後に作る**: 未確認の空テナント(誤入力・ボット)を残さない。確認前は
  `pending_signups` の1行だけで、期限切れから7日経った未消費行はワーカーが削除する(`signup-cleanup.ts`)。
- **パスワードは確認時に設定する**: 登録時に受け取ると「被害者のメール+攻撃者が決めたパスワード」で登録でき、
  被害者が確認リンクを踏んだ時点で攻撃者がパスワードを知るテナントが被害者名義で作られる(乗っ取り)。
  招待受諾と同じ作法で、リンクを踏んだ本人が確認画面で決める。`pending_signups` にパスワード列は無い。
- **確認メールにユーザー入力を入れない**: 未認証で任意の宛先に出せるメールなので、組織名などを本文に入れると
  運用者名義のフィッシングに使える。本文は固定文面+確認 URL のみ。組織名は確認画面で表示する。
- **ユーザー列挙対策**: `POST /signup` は既存ユーザーを引かず、応答は常に同一の 202。KIZAMI は同一メールの
  複数テナント所属を許容している([マルチテナント](./multi-tenancy.md))ので「既存メールは登録不可」にしない
  (確認メールは本人にしか読めない)。招待コード不正・Turnstile 失敗は列挙に関係しないので 400 で明示する。
- **再送スロットル**: 同じメール(trim + 小文字化)宛の登録は**5分に1回**まで。直近の申請があれば何もせず
  (応答は同じ 202、メールも出さない)、それより古ければ未消費 pending を新しいトークンで置き換える
  (古いリンクは無効)。受信者単位の迷惑メール抑止と、他人の確認リンクを置き換えて無効にする妨害の抑止が目的。
  判定と書き込みは部分 UNIQUE(未消費はメールごとに高々1行)+ `INSERT ... ON CONFLICT DO UPDATE ... WHERE` の
  1文で原子的に行う(SQLite / PostgreSQL 共通。アプリ層の SELECT→INSERT は同時リクエストで抜ける)。
- **ログイン CSRF 対策**: `POST /signup` 系は成功時にセッション Cookie を発行するため、全 POST に
  `Content-Type: application/json` を必須(415)とし、`Origin` ヘッダがあれば `APP_BASE_URL` のオリジンと一致を
  要求する(403)。
- **トークン経路のステータス**(招待受諾と同じ): 存在しない・消費済み(二重送信の2回目、同時確認の敗者を含む)は
  404、期限切れ(24時間)は 410。招待コードが確認時点で使えなくなっていたら 409 `invite_code_unavailable`
  (トランザクション全体が巻き戻り、pending は未消費のまま)。
- **レート制限**: `POST /signup` は IP ごとに 5回/15分(`signupPerIp`)、確認リンクの GET/POST は招待・リセットと
  同じトークン経路の上限(`tokenPerIp`、20回/15分)。
- **システムメール**: 既存の SMTP はテナント単位の通知チャネル設定なので使えない。運用者名義の
  `SYSTEM_SMTP_URL` / `SYSTEM_MAIL_FROM`(汎用 SMTP。運用者環境では Cloudflare Email Service の SMTP 送信 `smtp.mx.cloudflare.net:465` を使う)を別に持つ。
- **起動時 fail-fast**: `SIGNUP_MODE` が off 以外なのに必須の環境変数が欠けていれば、`node.ts` が起動時に
  欠けている変数名を列挙してエラー終了する(登録フォームは出るのに誰も完了できない状態を公開後に発見しないため)。
  `SIGNUP_MODE` の綴り間違いも黙って off にせずエラーにする。

### 本人用のパスワード再設定(システムメールがある配備でだけ有効)

状態: 実装済み(2026-10-04)。**システムメール(`SYSTEM_SMTP_URL` / `SYSTEM_MAIL_FROM` / `APP_BASE_URL`)が
3つ揃っている配備でだけ有効**で、**`SIGNUP_MODE` とは独立**(サインアップを使わないセルフホストでも、
システムメールを設定すれば使える)。揃っていなければ `GET /password-resets/config` が
`{ "selfService": false }`、`POST /password-resets` は 404 で、**セルフホストの体験は変わらない**
(従来どおり管理者発行+リンク手渡し)。Workers エントリでは常に無効。システムメール設定の解析は
`lib/system-mail-config.ts` に独立していて、signup はそれを使う(`SIGNUP_MODE` が off 以外で欠けていれば
起動時に落とす fail-fast は従来のまま。本人用の再設定は落とさず、値が不正なら起動時に警告だけ出す)。

- `GET /password-resets/config` → `{ selfService, turnstileSiteKey? }`(ログイン画面の「パスワードをお忘れの場合」リンクの判定)。
- `POST /password-resets` — `{ email, turnstileToken? }`。**結果に関係なく常に 202 + 同一ボディ**。
  Origin 検証・`Content-Type: application/json` 必須は signup と同じ(`lib/json-post-guard.ts`)。
  Turnstile は `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` の両方がある配備で必須、無ければ不要。
  IP ごとに 5回/15分(`passwordResetRequestPerIp`)。
- **応答時間を該当者の有無から独立させる**: 応答の前は、入力検証・ガード・Turnstile・**メール単位スロットルの取得**
  (全メール共通の1回の書き込み)までで、対象の探索・トークン発行・メール送信はすべて応答の後のバックグラウンド。
  スロットル行(`password_reset_requests`)は実在しないメールにも作られるので、定期ジョブ(`signup-cleanup.ts`)が1日で掃除する。
- **メール単位のスロットル**: 同じメール(trim + 小文字化)宛は5分に1回。`INSERT ... ON CONFLICT (email_key) DO UPDATE
  ... WHERE requested_at <= 閾値` の1文で原子的(同時リクエストでもメールは1通)。signup の pending と同じ方式だが、
  メール単位・複数テナント横断の上限が要るため、ユーザー単位の `password_reset_tokens` ではなく専用のシステム表にした。
- **対象**: そのメールを持つ有効な(退職処理されていない)ユーザーで、パスワード資格情報を持つ人を全テナントから探す
  (`users.email` の完全一致 — ログインと同じ)。該当者がいなければメールは送らない。
- **トークン**: 管理者発行と同じ `password_reset_tokens` を流用し、`source` 列(`admin` / `self`)で発行経路を区別する
  (`created_by` は本人)。**TTL は1時間**(管理者発行は24時間): 要求は第三者でも出せ、リンクが宛先のメールボックスに
  平文で残るため、漂流する時間を短くする。同じユーザーの本人発行の古いトークンは失効し、管理者発行のトークンには触れない。
  監査ログ `password_reset.self_request`。
- **メール本文にユーザー入力もテナント名も入れない**: テナント名(組織名)は攻撃者が決められる自由入力で、本文に入れると
  運用者名義のフィッシングの踏み台になる。固定文面+リンクのみで、複数テナントに該当すれば「アカウント1」「アカウント2」と
  番号付きでリンクを並べる。どの組織のアカウントかはリンク先の受諾画面(`GET /password-resets/:token` の `tenantName`)で見せる。
- **受諾**: 既存の `/reset/:token` 画面と `POST /password-resets/:token/use` をそのまま使う。使用すると**全セッションと、
  そのユーザーの他の未使用・未失効トークン(発行元を問わず)が失効**する。**2FA は解除しない**: 2FA 利用者には使用直後の
  セッションを発行せず(`{ passwordUpdated: true, status: "login_required" }`)、ログイン画面からパスワード+TOTP で入り直させる
  (メールを読めるだけでは 2FA を迂回できないようにするため)。

### 環境変数

| 変数 | 必須 | 内容 |
| --- | --- | --- |
| `SIGNUP_MODE` | — | `off`(既定)/ `invite` / `open` |
| `TURNSTILE_SECRET_KEY` | off 以外で必須 | Cloudflare Turnstile のシークレットキー(サーバー側 siteverify) |
| `TURNSTILE_SITE_KEY` | off 以外で必須 | Turnstile のサイトキー(`GET /signup/config` で Web へ渡す) |
| `SYSTEM_SMTP_URL` | off 以外で必須 | システムメールの接続先(`smtp://user:pass@host:587` / `smtps://...:465`) |
| `SYSTEM_MAIL_FROM` | off 以外で必須 | システムメールの差出人(`KIZAMI <noreply@example.com>`) |
| `APP_BASE_URL` | off 以外で必須 | Web のベース URL(`https://app.example.com`)。確認リンクの組み立てと Origin 検証に使う。開発時は Web の URL(`http://localhost:3000`) |

開発・テストの Turnstile は Cloudflare 公式のテスト用ダミーキーを使う(実際のチャレンジは出ず、結果が固定される):

| 用途 | キー |
| --- | --- |
| サイトキー(常に通る) | `1x00000000000000000000AA` |
| シークレットキー(常に成功) | `1x0000000000000000000000000000000AA` |
| シークレットキー(常に失敗) | `2x0000000000000000000000000000000AA` |

自動テストは siteverify の fetch とメール送信関数を注入した偽実装で行うので、これらのキーも SMTP も不要。

### 運用者 CLI

```sh
pnpm --filter @kizami/api operator invite-code create [--max-uses N] [--expires-days D] [--note TEXT]
pnpm --filter @kizami/api operator invite-code list
pnpm --filter @kizami/api operator invite-code revoke <id>
pnpm --filter @kizami/api operator tenant list
pnpm --filter @kizami/api operator tenant purge <tenant-id> [--confirm <tenant-id>] [--after-restore]
pnpm --filter @kizami/api operator tenant purges
pnpm --filter @kizami/api operator tenant sync-presets
```

- 招待コードは `XXXX-XXXX-XXXX-XXXX`(紛らわしい文字を除いた32文字・80ビットの乱数)。**平文は `create` の
  出力に1度だけ**表示され、DB には SHA-256 のみ保存される(`list` に平文は出ない)。既定は1回限り・無期限。
- 消費は確認完了のトランザクション内の条件付き UPDATE(失効・期限・上限を WHERE に含める)なので、
  同じコードを持つ pending が複数あっても、作られるテナント数は `max_uses` を超えない。
- `tenant list` は id・名前・作成日・有効ユーザー数・退会手続き中なら削除予定。suspend・プラン上書きは Phase 2(課金)で作る。
- `tenant purge` は退会を申請したテナントを予定を待たずに削除する(テナント id の再入力で確認)。
  `tenant purges` は削除の記録の一覧。`tenant sync-presets` は全テナントの同梱プリセットに、権限カタログに
  増えた権限(例 `tenant.withdraw`)を足す(デプロイの後に1回流す)。[テナントの退会](./tenant-withdrawal.md)

### システム表

`signup_invite_codes` / `pending_signups` は `tenant_id` を持たない**システム表**
([マルチテナントの「システム表の例外」](./multi-tenancy.md))。

### 公開前に残っていること

- 同一メールで確認済みの既存アカウントへの「すでに登録があります」通知メール(現状は常に同じ確認メールを出す)
- 規約・プライバシーポリシーへの同意チェック(法務ページ、フェーズ計画の Phase 2)
- ~~既存の `POST /auth/login` 等には Origin 検証が無い~~ — **対応済み(2026-10-05)**。セッション Cookie を発行する未認証の POST
  (`POST /auth/login`・`/auth/login/totp`・`/auth/oidc/start`・`/invitations/:token/accept`・`/password-resets/:token/use`)にも
  同じ Origin 検証 + JSON 必須化を掛けた(`app.ts` の `authPostOrigins`)。許可オリジンは**明示された** `APP_BASE_URL` と
  `CORS_ORIGIN`(どちらも未設定の配備は従来どおり検証しない)。Bearer(API キー)の経路・OIDC の callback(IdP からの GET)・
  Slack の署名検証の経路・認証済みの POST には掛けない。**`APP_BASE_URL` を設定した配備では、ユーザーがアクセスする
  オリジンと一致させること**(別名のホストでアクセスすると 403 になる)

## 課金 — Stripe Checkout + Customer Portal + Webhook

カード情報は一切保持しない。アプリ内に決済フォームは作らず、加入は Stripe Checkout、
変更・解約・カード更新は Customer Portal に委ねる。自前実装は Webhook 受信と
状態機械のみ。

- **シート計測**: 「有効(deactivate されていない)ユーザー数」。metered ではなく
  licensed quantity を日次ジョブ+メンバー増減イベントで同期する(単純・請求が予測可能)。
- **プラン構造**: 機能制限プランは作らない。法定機能(36協定アラート等)を上位プランに
  閉じ込めるのは「労働者に不利な実装をしない」という本製品の方針と衝突する。
  差別化は無料枠の人数・サポート水準・専有インスタンスで行う。具体の価格は運用者の
  事業判断でありこの文書の範囲外。
- **テーブル**: `billing_customers` / `billing_subscriptions`(tenant_id、Stripe ID 群、
  plan、seats、status、猶予期限)。Webhook は event id を記録して冪等化。

### 執行(enforcement)— 打刻は止めない

勤怠は業務クリティカルで、支払いトラブルの巻き添えで労働時間の記録が欠けるのは
「1分を刻む」という製品思想に反する。制限は管理機能側に寄せる。

| 状態 | 従業員(打刻・本人閲覧・申請) | 管理者(承認・締め・設定・招待) |
| --- | --- | --- |
| 正常 / トライアル中 | ○ | ○ |
| 支払い失敗(猶予期間) | ○ | ○ + 全画面バナー |
| 猶予超過 / 無料枠超過 | ○(記録は守る) | ロック(閲覧のみ)。招待不可 |
| 解約後 | エクスポート案内 → 一定期間後にテナント削除([テナントの退会](./tenant-withdrawal.md)の流れに乗せる) | エクスポートのみ可 |

## 法務・運用の要件

- 必須ページ: 利用規約 / プライバシーポリシー / 特定商取引法に基づく表記 /
  セキュリティ説明(暗号化・分離・バックアップ・監査ログ)。
- 個人情報の整理: テナント企業が個人情報取扱事業者、運用者は委託先相当。
  `@kizami/privacy-template`(テナント→従業員向け雛形)の対になる
  「運用者→テナント」文書が要る。
- データポータビリティ: CSV / API / 給与ソフト向けエクスポートは実装済み。
- 監視は既存の [可観測性](./observability.md) の構成に hosted 環境を追加する。
  テナント数・シート数もメトリクス化する。
- 運用者コンソールはまず CLI(テナント一覧・suspend・プラン上書き・退会処理)。
  管理 UI は必要になってから。

## フェーズ計画

1. **Closed Beta(課金なし・招待コード制)** — PG デプロイ+バックアップ/復旧手順、
   self-serve signup(実装中、上記「サインアップ」)、監視配線。出口条件: 運用者以外のテナントが実勤怠を1ヶ月回して
   締めまで通ること。
2. **Billing** — `packages/billing`(Checkout / Portal / Webhook / シート同期 / 執行)、
   法務ページ、トライアル・無料枠。
3. **Public Launch** — テナント退会(下記ギャップ1、対応済み)、招待コード撤廃、
   テナント別クォータ。

## 公開前に塞ぐべき既知のギャップ

1. ~~**テナント一括削除(退会)が未実装**~~ — **対応済み(2026-10-05)**。申請 → 30日の猶予 → 物理削除。
   猶予期間は全データのエクスポートと取り消しだけができ、管理者以外のログイン・打刻・通知は止まる。
   削除は worker の定期ジョブ(または運用者 CLI の `tenant purge`)が、tenant_id を持つ全テーブルを
   外部キーの子から親の順に1トランザクションで消し、個人情報を含まない記録だけを残す。
   全データのエクスポート(JSON + 勤怠の CSV の zip)は通常の状態でも使える。
   R2 のバックアップには削除済みのテナントが期限(最長400日)まで残るので、復元したときは削除し直す
   (`deploy/k8s-cloud/README.md`「復旧手順」)。プライバシーポリシーに書く事項も含め、設計は
   [テナントの退会](./tenant-withdrawal.md)。
2. ~~**人ごとの所定労働時間(時短勤務)**~~ — **対応済み(固定時間制、2026-10-05)**。
   労働時間制の制度を名前付きで複数持てるようにし(例:「固定(8時間)」「固定・時短(6時間)」)、
   メンバーには制度を割り当てる形にした(`/settings/work-policies`、勤怠ルール画面の
   「労働時間制の制度」)。月次・有給・締め・エクスポートが割当から所定を解決していることを確認し、
   時短と一般が同じ月に混在するケースを結合テストで固定した。設計は
   [労働時間制と時間外の判定](./work-systems.md)「名前付きの制度と時短勤務」。
   シフト制は所定が日単位なので元から対応可能。フレックスは下記3で対応した。
3. ~~**時短フレックス(清算期間の契約枠が法定枠より短い)**~~ — **対応済み(2026-10-05)**。
   制度の版に「総労働時間の決め方」(法定の枠 / 所定日数 × 標準時間)と「不足を翌月に繰り越す」を
   持たせ、契約上の枠を選んだ制度は過不足を契約上の枠と比べ、契約上の枠〜法定の枠を法定内超過、
   法定の枠超を法定外とする3段で計算する。所定労働日は新設の所定休日のカレンダー
   (曜日・国民の祝日・個別の追加と除外、版つき)で数える。既定は法定の枠で、既存のテナントの
   数字は変わらない。締めのスナップショット・CSV・給与ソフト形式に契約上の枠・繰越・確定した不足を
   足した。設計は [work-systems.md](./work-systems.md)「フレックスの契約上の枠と不足の繰越」。
   複数月の清算期間(3か月まで)は対象外。
4. ~~**テナント別クォータ**~~ — **対応済み(2026-10-05、配備共通の値)**。環境変数 `QUOTA_*` で、メンバー数(招待中を含む)・
   API キー数・外向きの通知の1日の送信数・管理者の招待/再設定リンクの1日の発行数に上限を掛けた。**未設定は無制限**、**打刻は止めない**。
   あわせて、テナントが設定できる送り先を踏み台にした SSRF へのアプリ側の対策(`OUTBOUND_*`、既定は無効)を入れた。
   設計は [テナントごとの利用上限](./tenant-quotas.md)・[外向きの接続の SSRF 対策](./outbound-ssrf.md)。
   テナントごとの個別の上限は Phase 2(課金)で扱う。
