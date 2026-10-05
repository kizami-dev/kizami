# 外向きの接続の SSRF 対策

テナントの管理者・メンバーが設定できる送り先を踏み台にして、KIZAMI が動いているネットワークの内側
(クラスタの Pod/Service、ノードのメタデータ、ループバック、社内 LAN)へ接続させない、アプリ側の防御。
KIZAMI Cloud ではクラスタの NetworkPolicy(`deploy/k8s-cloud/cloud.yaml`)が一次防御で、これは二次防御。
実装は `apps/api/src/lib/outbound-policy.ts`(判定・環境変数・ランタイム非依存)と
`apps/api/src/lib/outbound-guard.ts`(名前解決と接続・Node 専用)。

## 有効化(既定は無効)

セルフホストでは社内 LAN の SMTP や Webhook を使うのが普通なので、**環境変数で有効にしたときだけ**働く。
未設定なら従来どおりグローバルの fetch と nodemailer をそのまま使い、挙動は一切変わらない。

| 環境変数 | 意味 |
| --- | --- |
| `OUTBOUND_BLOCK_PRIVATE=true` | 下の「拒否する宛先」への接続を拒否する |
| `OUTBOUND_DENY_CIDRS` | 追加で拒否する宛先(CIDR か IP のカンマ区切り)。KIZAMI Cloud ではノードのグローバル IP。**これだけを設定した場合は、その CIDR だけを拒否する**(組み込みのプライベート範囲は拒否しない) |
| `OUTBOUND_ALLOW_HOSTS` | 拒否する宛先に解決されても許可するホスト名(カンマ区切り、`*.example.com` 可。IP リテラルを許可したいときはその文字列) |

優先順位: ① `OUTBOUND_DENY_CIDRS` に一致 → **常に拒否**(許可ホストでも通さない。運用者が明示した拒否が最優先)
→ ② `OUTBOUND_BLOCK_PRIVATE` の範囲に一致 → 許可ホストなら許可、それ以外は拒否 → ③ 許可。
値の形式が不正なら起動時にエラー終了する(設定したつもりで素通し、を避ける)。

## 拒否する宛先

- IPv4: `0.0.0.0/8`(未指定)・`10/8`・`172.16/12`・`192.168/16`(プライベート)・`100.64/10`(CGNAT)・`127/8`(ループバック)・
  `169.254/16`(リンクローカル。クラウドのメタデータ `169.254.169.254` を含む)・`192.0.0.0/24`・`198.18/15`・
  `224/4`(マルチキャスト)・`240/4`(予約。`255.255.255.255` を含む)
- IPv6: `::/128`・`::1/128`・`fc00::/7`(ULA)・`fe80::/10`(リンクローカル)・`fec0::/10`・`ff00::/8`(マルチキャスト)・
  `100::/64`・`2001::/32`(Teredo)・`64:ff9b:1::/48`
- **IPv4 を内包する IPv6**(`::ffff:10.0.0.1` の IPv4 射影・`64:ff9b::/96` の NAT64・`2002::/16` の 6to4・`::/96` の IPv4 互換)は、
  内包する IPv4 を取り出して IPv4 の規則で判定する(`::ffff:127.0.0.1` で素通しにならないように)
- 名前だけで内部と分かるホスト(`localhost`・`*.local`・`*.internal`・`*.lan`・`*.home.arpa` など)は、解決を待たず保存時に即拒否する
- `http` / `https` 以外のスキームは接続しない

## 対象と対象外

| 対象(テナントが設定できる送り先) | 経路 |
| --- | --- |
| テナントの Webhook(Slack/Discord 互換の Incoming Webhook を含む) | `tenantFetchImpl`(`lib/notification-channels.ts`) |
| 個人の Webhook | 同上 |
| テナントの SMTP | `smtpSendFn` を包んだもの(`wrapSmtpSend`) |
| OIDC の discovery・トークン・JWKS の取得 | `oidc.network.fetchImpl` |
| ブラウザプッシュの送信先(購読の endpoint) | `tenantFetchImpl` |

対象外: 運用者が設定する送り先(`SENTRY_DSN`・`SYSTEM_SMTP_URL`・Turnstile・環境変数 `WEBHOOK_URL` のフォールバック)。
Slack のスラッシュコマンドは受信のみで送出が無い。**Workers は対象外**(Workers はプライベートアドレスに届かない)。
Workers のビルドには Node 専用モジュールを持ち込まない(`lib/outbound-guard.ts` は `node.ts` / `worker.ts` だけが読み、
`routes/` は `lib/outbound-policy.ts` の型だけを参照する)。

## DNS rebinding 対策: 検査した IP にそのまま接続する

名前を解決して検査したあと、接続のためにもう一度名前解決させると、2回目だけ内部の IP を返す DNS で検査をすり抜けられる。
そこで**名前解決は1回だけ**行い、その結果の IP を検査し、**検査を通したその IP に接続する**(接続のための再解決をしない)。

- fetch: グローバルの fetch(undici)は接続時に自前で名前解決するため差し込めない。`node:http` / `node:https` で
  `host: <検査済みの IP>` に直接接続し、`Host` ヘッダと TLS の `servername`(SNI・証明書の検証)に元のホスト名を使う。
  **リダイレクトは追わない**(3xx はそのまま返り、呼び出し側は `!res.ok` として失敗扱い)。Webhook・プッシュ・OIDC のどれも
  リダイレクトを前提にしないので、追わないのが最も安全。レスポンスは 5 MiB、時間は 15 秒で打ち切る
- SMTP: nodemailer に渡す `host` を検査済みの IP にし、`servername` に元のホスト名を渡す
  (`SmtpChannelConfig.servername`)。STARTTLS・465 の暗黙 TLS の証明書検証は元のホスト名で行われる
- 解決結果に拒否対象が1つでも混ざれば全体を拒否する。IP リテラルは名前解決が走らないので接続の前に検査する。
  接続に失敗したら検査済みの次の IP を順に試す

## 保存時の検査

Webhook の URL・SMTP のホスト・OIDC の issuer・プッシュの endpoint を保存するとき、同じポリシーで検査して
`400 { error: "outbound_destination_blocked", field }` を返す(画面は 5 言語で説明する)。名前解決に失敗・時間切れ
(3 秒)のときは拒否しない。**DNS は後で変わりうるので、保存時の検査は先回りの親切であって本体ではない** —
接続のたびの検査(上の節)が本体で、保存後に内部の IP へ向け直されても接続時に拒否される。
拒否のエラーメッセージ(テスト送信の結果に出る)には解決された IP を含めない。

## KIZAMI Cloud の設定

`deploy/k8s-cloud/cloud.yaml` の api / worker に `OUTBOUND_BLOCK_PRIVATE=true` と、ノード3台のグローバル IP
(`161.33.2.65/32`・`161.33.46.89/32`・`133.242.209.71/32`)の `OUTBOUND_DENY_CIDRS` を入れている。
NetworkPolicy はグローバル IP 宛て(ノード自身のポート)を塞げないため、そこをアプリ側で塞ぐ。
