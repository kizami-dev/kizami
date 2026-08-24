# ブラウザプッシュ通知(Web Push)

対象バージョン: v1.0(2026-08-24 実装)
関連: [要件定義 §7 テナント・認証・通知](../requirements.md)、[マルチテナントとテナント分離](./multi-tenancy.md)

KIZAMI は、アプリ内通知・メール・個人 Webhook に続く4つ目の**個人チャネル**として
ブラウザのプッシュ通知に対応する。打刻忘れリマインド・36協定アラート・承認依頼などを、
KIZAMI のタブを開いていなくても(PWA をインストールしていれば端末の通知として)受け取れる。

## 1. 最重要の決定: 外部サービスも `web-push` パッケージも使わない

Web Push は「プッシュサービス(Chrome なら FCM、Safari なら Apple、Firefox なら Mozilla)へ
暗号化した本文を POST する」だけの**標準プロトコル**であり、Firebase のようなベンダー SDK も
中継サービスも要らない。KIZAMI は仕様(RFC 8291 / RFC 8292 / RFC 8188)を
`packages/notify/src/web-push.ts` に直接実装している。

npm の `web-push` パッケージも使っていない。理由は `@kizami/notify` の大原則
「ランタイム非依存 — `node:*` を使わず fetch と設定注入だけに依存する」(要件 §8)を守るため:

- `web-push` は `node:crypto` に依存しており、Cloudflare Workers(workerd)では動かない。
  将来スキャンを Workers の Cron から回す構想がある以上、通知チャネルだけが移植できなくなる。
- 必要な素材(ECDH P-256 / HKDF-SHA256 / AES-128-GCM / ECDSA P-256 署名)はすべて
  WebCrypto(`crypto.subtle`)の標準機能で揃う。実装は 200 行程度で、依存を1つ増やすより安い。
  同じ判断で `@kizami/crypto`(保存時暗号化の AES-256-GCM)も `node:crypto` を使っていない。

正しさの担保は「送れたこと」ではなく「**相手が復号できること**」で行う。
`packages/notify/test/web-push.test.ts` はテスト内でブラウザ役の鍵を作り、
送信ボディを実際に復号して JSON が一致することまで確認する。

## 2. VAPID 鍵は運用者が生成し、環境変数で渡す

| 環境変数 | 内容 |
| --- | --- |
| `VAPID_PUBLIC_KEY` | 非圧縮 EC 点 65 バイトの base64url |
| `VAPID_PRIVATE_KEY` | スカラー 32 バイトの base64url |
| `VAPID_SUBJECT` | `mailto:` または `https://` の連絡先(RFC 8292 の `sub`) |

生成は `pnpm generate-vapid`(`scripts/generate-vapid.mjs`)。
`npx web-push generate-vapid-keys` と同じ形式なので、既存の鍵があればそのまま使える。
**`api` と `worker` の両方に同じ値**を設定すること(購読の受付は api、送信は worker が行う)。

### 未設定なら機能ごと消える(フェイルクローズドではなく「無かったことにする」)

`buildVapidFromEnv()`(`apps/api/src/lib/web-push.ts`)は、3つ揃っていない場合・形式が不正な
場合とも `null` を返して警告するだけで、**起動は止めない**。打刻など本体機能はプッシュ通知と
無関係に動き続けるべきであり、鍵のタイポでインスタンス全体が落ちるのは過剰だという判断。

鍵が `null` の配備では:

- `GET /push/vapid-public-key` と `POST /push/subscriptions` が `404 push_unavailable`
  (送れないのに購読だけ貯めても意味が無い)
- `GET /settings/notifications/me` が `pushAvailable: false` を返し、Web UI から購読ボタンも
  カテゴリ別のプッシュ列も消える
- 個人設定で `push: true` になっていても送信チャネルが組み立てられない(静かに送らない)

一方、カテゴリごとの `push` の**値そのものは保存も返却もする**。鍵を後から設定すれば
以前の希望がそのまま復活する(値を握りつぶさない)。

### 鍵の入れ替えは全購読の無効化を意味する

ブラウザは購読時の VAPID 公開鍵にエンドポイントを紐づける。鍵を替えると既存の購読は
プッシュサービス側で拒否され、KIZAMI は `failed_at` を立てて静かに止まる。
全員に再購読してもらう必要があるため、鍵は他の秘密情報と同じ扱い(Secret 経由・
リポジトリに置かない・むやみに再生成しない)にすること。

## 3. データモデル: 希望と宛先を分ける

- **希望**は `user_notification_settings` の `*_push` 列(カテゴリごとに ON/OFF、既定 OFF)。
  `*_email` / `*_webhook` と完全に同じ粒度で、カテゴリの定義は
  `apps/api/src/lib/notification-preferences.ts` に一元化されている。
- **宛先**は `push_subscriptions` テーブル(1ブラウザ1行)。メールでいう `email_address`、
  Webhook でいう `webhook_url` に相当する。

宛先を別テーブルにしたのは、**1人が複数ブラウザを購読しうる**ため(会社の PC・自宅の PC・
スマートフォンでそれぞれ許可する)。`user_notification_settings` は1ユーザー1行の現在値
テーブルなので、ここに列として持たせることはできない。

### 購読の鍵は暗号化しない

`endpoint` / `keys_p256dh` / `keys_auth` は `webhook_url` や `smtp_password` と違い、
ブラウザが**公開鍵として**発行するもので、漏れても「そのブラウザ向けの暗号文を作れる」以上の
ことはできない(実際に送るには VAPID 秘密鍵も要る)。一方で送信のたびに復号するコストは
購読数ぶん効いてくるため、平文で持つ判断をした。

### 失効した購読は消さずに `failed_at` を立てる(遅延プルーニング)

プッシュサービスが `404` / `410` を返したら、その購読はもう存在しない(購読解除・ブラウザの
データ消去・長期未使用)。KIZAMI は行を削除せず `failed_at` に時刻を入れ、以後の
チャネル組み立て対象から外す。掃除専用のジョブを増やさないほうが運用が単純で、
同じブラウザが再購読すると endpoint も新しくなるため古い行は自然に使われなくなる。
(再購読で endpoint が同じだった場合は upsert が `failed_at` を `null` に戻して復活させる。)

## 4. API

| メソッド | パス | 備考 |
| --- | --- | --- |
| GET | `/push/vapid-public-key` | 購読に必要な公開鍵。鍵未設定なら 404 |
| GET | `/push/subscriptions` | 自分の有効な購読(鍵は返さない) |
| POST | `/push/subscriptions` | `{ subscription }` を endpoint 単位で upsert |
| DELETE | `/push/subscriptions` | `{ endpoint }`。自分の購読のみ |

`/settings/notifications/me` と同じく**権限チェックは行わない**。認証済みユーザーが自分自身の
購読だけを読み書きし、他人の `tenant_id` / `user_id` を指定する経路自体が存在しない。
DELETE も endpoint に加えて必ず `tenant_id` + `user_id` で絞り込むため、endpoint 文字列を
知っているだけでは他人の購読を消せない(テナント分離規約)。

POST は `endpoint` が http(s) URL であること・`p256dh` が 65 バイト・`auth` が 16 バイトで
あることを検証する。壊れた購読を保存すると送信のたびに例外になり、スキャンのログを
汚し続けるため。

## 5. 送信経路

`buildPersonalChannels`(`apps/api/src/lib/notification-channels.ts`)がメール・個人 Webhook と
並べて push チャネルを組み立てる。他の2チャネルと違い、**有効な購読1件につき1チャネル**を返す。
`dispatch()` は `Promise.allSettled` なので、1台への送信失敗が他台を止めない。

送信するペイロードは `{"title","body","url"}` の JSON だけ。サービスワーカー
(`apps/web/public/sw.js`)の `push` ハンドラがこの3つだけを読む契約になっている
(項目を増やすときは両方を同時に直すこと)。`notificationclick` は、既に KIZAMI を開いている
タブがあればそれを前面に出して `url` へ遷移し、無ければ新しく開く。

日次スキャン(打刻忘れ・36協定・有給・シフト予実乖離)は `apps/api/src/worker.ts` の
`resolveChannels` を通るため、この配線だけで全スキャンがプッシュに対応する。
申請の承認・却下や承認依頼(`routes/corrections.ts` など)も同じ `buildPersonalChannels` を
使うので追加の作業は無い。

## 6. Web UI

`/settings/notifications/me`(個人の通知設定)に:

- 「このブラウザでプッシュ通知を受け取る」ボタン
  (`Notification.requestPermission()` → `pushManager.subscribe()` → `POST /push/subscriptions`)
- カテゴリ別のプッシュ列(`pushAvailable` かつブラウザが対応しているときだけ表示)

購読は**ブラウザごと**に必要なので、その旨を画面上に明記する。通知が `denied`(ブロック済み)の
場合、ブラウザは許可ダイアログを二度と出さないため、「アドレスバーの鍵アイコンからサイトの
設定を開き、通知を許可に変える」手順を文言で案内する(4言語とも)。

Service Worker の登録自体は既存の `components/PwaRegister.tsx` が行っており、
`lib/push.ts` は `navigator.serviceWorker.ready` を待つだけ(二重登録しない)。

## 7. 制約

- **iOS/iPadOS は「ホーム画面に追加」した PWA でのみプッシュを受け取れる**(Safari のタブでは
  購読できない)。KIZAMI は PWA として配信しているのでインストールすれば動く。
- HTTPS(または localhost)必須。Service Worker とプッシュ通知の共通要件。
- 送信先はブラウザベンダーのプッシュサービスであり、KIZAMI のサーバーから外向きの HTTPS が
  出られる必要がある。閉域網の配備では使えない(メール・個人 Webhook を使うこと)。
