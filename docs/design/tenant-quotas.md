# テナントごとの利用上限

SaaS 公開前のギャップ4([saas.md](./saas.md))。既存のレート制限は IP / メール軸だけで、テナント軸の上限が無かった。
実装は `apps/api/src/lib/tenant-quotas.ts`。

## 方針

- **配備ごとの環境変数で上限を決める**(全テナント共通の値)。**未設定 = 無制限**で、未設定ならセルフホストの挙動は変わらない。
  テナントごとの個別の上限は Phase 2(課金)で扱う(ここでは作らない)。
- **打刻は止めない**(SaaS の方針)。上限の対象は管理操作と外向きの送信だけで、打刻・修正申請・承認・締めなど勤怠の記録そのものと、
  アプリ内通知・ブラウザプッシュには掛けない。既存の API キーでの打刻も、キー数の上限に達していても通る。
- 値は 0 以上の整数。`0` は「その操作を全部断る」(無制限にしたいときは設定しない)。形式が不正なら起動時にエラー終了する。

## 上限の一覧

| 環境変数 | 上限 | 超えたとき |
| --- | --- | --- |
| `QUOTA_MAX_MEMBERS` | 在籍メンバー数 | `POST /members`(招待)と `POST /members/:id/reactivate` が `409 member_limit_reached`(`limit` つき) |
| `QUOTA_MAX_API_KEYS` | 有効な API キー数(失効・期限切れを除く) | `POST /api-keys` が `409 api_key_limit_reached` |
| `QUOTA_OUTBOUND_NOTIFICATIONS_PER_DAY` | 外向きの通知(Webhook・メール)の1日の送信数 | 送信をやめる(下記) |
| `QUOTA_INVITE_RESET_MAILS_PER_DAY` | 招待・パスワード再設定のメールの1日の送信数 | メールを送らない(下記) |

1日は**日本時間の 0 時区切り**。

### メンバー数に「招待中」を含める

在籍者(`is_active` かつ未消去)で数え、**招待したが未受諾のメンバーも含む**。招待した時点で `users` 行ができて席を占めるため、
受諾を待って数える仕様だと、招待だけ大量に出して上限を回避できる。退職処理(無効化)で席が空き、再有効化は再び席を使う。
数えてから作るので、同時リクエストで数件は超えうる(管理操作で頻度が低く、厳密さより単純さを取った)。

### 外向きの通知

Webhook(テナント共有・個人)とメール(テナントの SMTP 経由の本人宛)の**送信1件ごとに**数える。ブラウザプッシュとアプリ内通知は数えない。
テスト送信(`POST /settings/notifications/test`、`/me/test`)も数える。上限に達したら、送らずに `notification_limit_reached` で失敗させる
(`dispatch` の結果として返るだけで、他のチャネルや業務処理は止まらない)。**その日の最初の1回だけ**、通知設定の管理権限を
tenant スコープで持つ管理者に、アプリ内通知(`quota_notification_limit`)で知らせる。重複して知らせないのは、通知の UNIQUE
(テナント・ユーザー・種別・日付)による。カウンタは日次の1文の UPSERT(`INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit`)で
判定と加算が不可分なので、api と worker が同時に送っても上限を超えない。

### 招待・パスワード再設定のメール

現状でアプリが出すテナント宛のメールは、本人用の「パスワードを忘れた」のメール(システムメール)だけで、招待はリンクを管理者が渡す方式。
本人用再設定の対象テナントごとに数え、上限に達したテナントのアカウントはトークンを発行せずメールにも載せない。
**応答は常に 202 のまま**で、上限に達したことは外から分からない(ユーザー列挙の手掛かりにしない)。

## 保存先

`tenant_usage_counters`(`tenant_id`, `counter_key`, `day`, `count`)。通知は api と worker という別プロセスから送られ、
`/metrics` は api が出すので、プロセス内メモリではなく DB に持つ。`tenant_id` に外部キーは**張らない**(テナントの退会を妨げないため。
退会処理は `deleteTenantUsageCounters` で消せる)。

## メトリクス

`GET /metrics` に `kizami_quota_limit_hits_total{limit="members|api_keys|outbound_notifications|invite_reset_mails"}`(counter)。
**テナントを区別しない全体の累計**で、断るたびに `hit:<上限名>` のカウンタを +1 した合計(4種別は 0 でも常に出る)。
アラートの例: `increase(kizami_quota_limit_hits_total[1h]) > 0` で、上限が小さすぎないかを見る。

## KIZAMI Cloud の値(Closed Beta の目安)

メンバー 50 / API キー 20 / 外向きの通知 1日 2000 / 招待・再設定のメール 1日 200。`deploy/k8s-cloud/cloud.yaml` に置いている。
