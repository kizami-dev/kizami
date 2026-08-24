# SSO(OIDC)ログイン

対象バージョン: v1.0(2026-08-24 実装)
関連: [要件定義 §7 テナント・認証・通知](../requirements.md)、[権限カタログ §1.10](./permission-catalog.md)

KIZAMI は自前認証(メール+パスワード)に加えて、**OIDC(OpenID Connect)による SSO ログイン**に
対応する。Google Workspace・Microsoft Entra ID・Okta・Keycloak など、標準的な OIDC の
ディスカバリ(`/.well-known/openid-configuration`)に対応した IdP であれば設定だけで使える。

## 1. 最重要の決定: 自動プロビジョニングをしない

**SSO は「新しい入口」ではなく「既存ユーザーのログイン手段」**として実装する。
コールバックで IdP が返したメールアドレスを、設定されたテナント内の `users.email` と突合し、
**一致するユーザーが居なければログインを拒否する**(`users` 行は作らない)。

多くの SaaS は「IdP のテナントに居れば自動でアカウントを作る」(JIT プロビジョニング)を
既定にしているが、KIZAMI では採らない。理由:

1. **要件と矛盾する。** 登録は招待式のみ(要件 §7、2026-08-23 決定)。自由登録を提供しないと
   決めているのに、SSO だけがその抜け道になるのは筋が通らない。
2. **「IdP に居る」は「この会社の従業員として勤怠を打つ人」を意味しない。** 業務委託先・
   グループ会社の社員・退職手続き中で IdP アカウントだけ残っている人などが混ざる。
   誰を勤怠管理の対象にするかは会社側の決定事項である。
3. **壊れた状態のユーザーが増える。** KIZAMI のユーザーは、部署(承認経路とスコープの土台)・
   権限プリセット・労働時間制(work_policy)の割当が揃って初めて意味を持つ。自動作成された
   ユーザーはそのどれも持たないため、打刻はできても集計も承認も成立しない。

代わりに、突合できなかった場合はログイン画面で
**「このメールアドレスのユーザーが見つかりません。管理者に招待を依頼してください」**
と案内する(`sso_user_not_found`)。管理者が招待すれば、その後は SSO でそのまま入れる。

同じ理由で、**IdP 側のユーザーID(`sub`)を保持する対応表テーブルは持たない**。
突合の材料はメールアドレスだけで、IdP のプロフィール(氏名等)で KIZAMI 側の `users` を
上書きすることもしない。

## 2. 設定(テナント単位)

テーブル `tenant_oidc_settings`(1テナント1行、マイグレーション `0025`)。

| 項目 | 説明 |
| --- | --- |
| `issuer` | IdP の発行者 URL。**https のみ**、クエリ・フラグメント不可(`{issuer}/.well-known/openid-configuration` を単純連結で作るため) |
| `client_id` | IdP で発行されるクライアントID。秘密情報ではないので平文保存・画面表示 |
| `client_secret` | クライアントシークレット。`enc:v1:...` 形式で暗号化して保存(通知の Webhook URL・SMTP パスワード・Slack の Signing Secret と同じ仕組み) |
| `enabled` | SSO ログインを有効にするか。有効化には issuer・client_id・client_secret の3点が揃っている必要がある |
| `allow_unverified_email` | `email_verified` が false でもログインを許すか。**既定 false**(§4 参照) |

管理 UI は `/settings/sso`。権限は専用キー **`tenant_settings.auth.manage`**
(「SSO(OIDC)を設定できる」・テナント全体のみ・危険フラグあり)。

通知チャネル設定(`notification.settings.manage`)の転用にしなかったのは、SSO の設定が
**「誰がこのテナントにログインできるか」を決める操作**であり、通知先の設定とは影響の桁が
違うため(issuer を差し替えれば、別の IdP の利用者が自社のメールアドレスを名乗って
ログインできてしまう)。権限カタログは非エンジニアが業務タスク単位で理解できることを
設計原則にしている(要件 §4)ので、「通知チャネルを設定できる」のチェックボックスに
SSO 設定が隠れる形は採らない。

GET のレスポンスに `client_secret` の平文は含めない。設定済みかどうかの
`clientSecretSet: boolean` だけを返す(Slack の Signing Secret と同じ流儀 —
シークレットは URL と違って「オリジンだけ見せる」のような有意味な部分文字列を持たない)。

## 3. フロー

標準的な認可コードフロー + PKCE(S256)+ state + nonce。

```
[ブラウザ]                    [KIZAMI api]                 [IdP]
   |  POST /auth/oidc/start        |                        |
   |  { tenantId }                 |                        |
   |------------------------------>|                        |
   |                               |-- discovery (キャッシュ) -->|
   |  { redirectUrl }              |                        |
   |  + Set-Cookie: kizami_oidc_tx |                        |
   |<------------------------------|                        |
   |                                                        |
   |  GET {authorization_endpoint}?...&code_challenge=...    |
   |------------------------------------------------------->|
   |                                        (ログイン・同意)   |
   |  302 GET /auth/oidc/callback?code&state                 |
   |<-------------------------------------------------------|
   |------------------------------>|                        |
   |                               |-- POST token (code_verifier) -->|
   |                               |<-- id_token ------------|
   |                               |-- JWKS (キャッシュ) ------>|
   |                               | 検証 → メール突合 → セッション作成
   |  302 "/" + Set-Cookie: kizami_session                    |
   |<------------------------------|                        |
```

### エンドポイント

| メソッド | パス | 認証 | 内容 |
| --- | --- | --- | --- |
| POST | `/auth/oidc/start` | 不要 | `{ tenantId }` を受け取り `{ redirectUrl }` を返す。状態 Cookie を発行 |
| GET | `/auth/oidc/callback` | 不要 | `code`・`state` を検証してセッションを張り、`/` へ 302。失敗時は `/login?error=<code>` へ 302 |
| GET | `/auth/oidc/available?email=` | 不要 | ログイン画面が SSO ボタンを出すかの判定用(§5) |

### 状態 Cookie(`kizami_oidc_tx`)

`state`・`nonce`・`code_verifier`・`tenantId`・発行時刻を JSON にし、`@kizami/crypto` の
Encryptor(AES-256-GCM)で暗号化して httpOnly / SameSite=Lax / 10分の Cookie に入れる。

**サーバー側に状態テーブルを持たない**という判断。DB に置くと「放置された行の掃除」という
運用がひとつ増えるが、暗号化 Cookie なら 10 分で自然に消え、レプリカを増やしても共有ストアが
要らない。クライアントは中身を読むことも改竄することもできない(GCM の認証タグで検出される)。

SameSite は Lax。IdP からのコールバックはトップレベルの GET 遷移なので Lax で届く
(None にすると同じ Cookie が任意のクロスサイト POST にも乗るため、必要のない緩和はしない)。

### ディスカバリと JWKS

`{issuer}/.well-known/openid-configuration` と `jwks_uri` はプロセス内メモリに 10 分の TTL で
キャッシュする。ディスカバリ文書の `issuer` が設定値と食い違う場合は拒否する
(OpenID Connect Discovery 1.0 §4.3。ここを緩めると攻撃者の用意した文書で正規 IdP に
なりすませる)。ID トークンの `kid` が JWKS に無い場合(鍵ローテーション直後)だけ、
JWKS を1回だけ強制再取得して再試行する。

### ID トークンの検証

`jose` で検証する。**`jose` は WebCrypto のみに依存し workerd で動く**ため、要件 §8
「コアはランタイム非依存」と将来の Cloudflare Workers 移植を壊さない(node:crypto に依存する
openid-client 等はこの理由で採用しなかった)。

- 署名(JWKS)、`iss`、`aud`、`exp`/`iat` — `jose` に任せる。クロックずれの許容は **60秒**
- 受け入れる alg は RS/PS/ES 系のみ(`none`・HS* を明示的に排除)
- `nonce` が start で発行した値と一致すること
- `aud` が複数ある場合は `azp` が client_id と一致すること(OIDC Core §3.1.3.7)
- `email` があること(無ければ突合できないので `sso_email_missing`)

## 4. email_verified の扱い

既定は **`email_verified` が true でなければ拒否**(`sso_email_unverified`)。

突合の材料がメールアドレスだけである以上、「そのメールアドレスの持ち主であることを IdP が
確認したか」は成りすまし防止の要になる。任意のメールアドレスを自称できる IdP を繋いだ場合、
未検証メールを信じると他人のアカウントへ入れてしまう。

一方で、自前 IdP(Keycloak の一部構成など)は `email_verified` を返さないことがある。
その逃げ道として **テナント単位のスイッチ `allowUnverifiedEmail`(既定 OFF)** を用意した。
既定を OFF にしてあるのは、危険側の設定を「意識して有効にした」状態でしか使わせないため。
UI にも何が起きるかを添えて出している。

## 5. ログイン画面での出し分け

メールアドレス欄から**フォーカスが外れたとき**に `GET /auth/oidc/available?email=` を1回だけ
叩き、該当があれば「SSO でログイン」ボタンを出す。複数テナントに該当する場合は会社ごとの
ボタンを並べる。パスワードで複数テナントに一致したときのテナント選択画面
(`multiple_tenants`)でも、SSO が使える会社の行には SSO ボタンを添える。

打鍵ごとのデバウンス照会にしていないのは、この経路が未認証で開放されており IP ごとに
20回/15分のレート制限が掛かっているため(打鍵に比例して呼ぶと正規利用者が自分で上限に触れる)。

### 情報開示の割り切り(判断点)

`/auth/oidc/available` は未認証で叩けるので、素朴に実装すると「そのメールアドレスがどの会社に
存在するか」を漏らす。既存のパスワードログインは、テナント名の開示をパスワード検証の
通過後に限っている(`multiple_tenants`)。ここでは次の2点で開示範囲を絞った:

1. **SSO が有効なテナントしか返さない。** SSO を使っていない会社の存在は一切漏れない
   (= 既存のパスワードログインの開示面を広げない)。
2. **「該当なし」と「メールアドレス自体が存在しない」を区別しない**(どちらも空配列・200)。

そのうえで IP レート制限を掛け、総当たりでの名簿作成を割に合わなくしている。
完全な秘匿は「SSO ボタンの出し分け」という要件と両立しないため、この線で妥協している。

## 6. セキュリティ上の決めごと

| 項目 | 決めごと |
| --- | --- |
| PKCE | S256 必須(plain は使わない) |
| state | 32バイト乱数。Cookie 内の値と定数時間比較。不一致・Cookie 欠落はいずれも `sso_state_mismatch` |
| nonce | 32バイト乱数。ID トークンの `nonce` と一致必須 |
| クロックずれ | 60秒 |
| レート制限 | start / callback / available を IP ごとに 20回/15分(`RATE_LIMITS.oidcPerIp`) |
| Cookie | `kizami_oidc_tx` は httpOnly・SameSite=Lax・暗号化・10分。セッション Cookie は既存の `kizami_session` をそのまま使う |
| 監査ログ | 成功時に `auth.login`(detail `{ method: "oidc", issuer, subject }`)。設定変更は `oidc_settings.update`(シークレット本体は残さない) |
| 秘密情報 | `client_secret` は暗号化必須。鍵が無い環境では保存も SSO 開始も拒否する(平文フォールバックはしない) |

## 7. エラーコード

コールバックは常に `/login?error=<code>` へ 302 で戻る。Web 側(`apps/web/src/lib/i18n/*.ts` の
`login.errors`)が4言語の文言に対応付ける。

| コード | 意味 |
| --- | --- |
| `sso_not_enabled` | そのテナントで SSO が無効 |
| `sso_config_incomplete` | issuer / client_id / client_secret のいずれかが未設定 |
| `sso_discovery_failed` | ディスカバリ・JWKS の取得に失敗、または issuer 不一致 |
| `sso_token_failed` | トークンエンドポイントがエラー、または `id_token` が返らない |
| `sso_invalid_token` | 署名・iss・aud・exp・nonce・azp のいずれかが不正 |
| `sso_state_mismatch` | state 不一致、状態 Cookie の欠落・期限切れ・改竄 |
| `sso_email_missing` | ID トークンに `email` が無い |
| `sso_email_unverified` | `email_verified` が false で、テナントが未検証メールを許可していない |
| `sso_user_not_found` | **そのメールアドレスのユーザーがテナントに居ない**(自動作成はしない) |
| `sso_failed` | IdP 側がエラーを返した(同意拒否など) |
| `encryption_unavailable` | 暗号鍵が未設定・不一致で `client_secret` を復号できない |

## 8. 環境変数

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `KIZAMI_ENCRYPTION_KEY` | (未設定) | 既存。`client_secret` と状態 Cookie の暗号化に使う。**未設定だと SSO は使えない** |
| `APP_BASE_URL` | `CORS_ORIGIN` | 成功時 `/`・失敗時 `/login?error=...` へ戻す Web のベース URL。api と web を同一オリジンで配信する本番では未設定でよい(相対パス) |
| `OIDC_REDIRECT_URI` | リクエスト URL から導出 | IdP に登録した戻り先。前段でホスト名を書き換えている配備では明示する |

## 9. 今後の課題

- **パスワードログインの無効化スイッチ**(「SSO 必須」にする設定)は今回入れていない。
  設定を誤ると全員が締め出されるため、締め出し防止(最後の管理者を守る等)の設計とセットで
  別途扱う。
- **パスワードログインの監査ログ**。現状 `auth.login` を残すのは SSO 経路のみ。
  action と detail の形は将来パスワード側(`method: "password"`)を足せるようにしてある。
- IdP 側でのログアウト連携(RP-Initiated Logout)、グループ→権限プリセットの同期は未対応。
