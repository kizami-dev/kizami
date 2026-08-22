# 外部連携(公開打刻API)

KIZAMI はブラウザのセッションCookieに加えて、**APIキー認証による公開打刻API**を提供します。
ICカードリーダー・Slack bot・MCPサーバー・自作クライアントなど、セッションCookieを持てない
外部クライアントから打刻・自分の勤怠参照ができるようにするための入口です(v0.4)。

## 1. APIキーを発行する

1. KIZAMI にログインし、「設定 > APIキー」(`/settings/api-keys`)を開きます。**権限は不要**です
   ―自分のキーは誰でも発行・一覧・失効できます(打刻の主体を明確にするため、キーは常に
   「発行した本人として」動作します。他人の代わりに打刻することはできません)。
2. 「名前」に用途がわかる名前(例: `2F入口ICカードリーダー`)、「スコープ」に用途に応じた権限
   (下記参照)、必要であれば「有効期限」を指定して発行します。
3. 発行直後の画面にのみ、`kzm_` から始まる平文のAPIキーが1度だけ表示されます。
   **この値は二度と表示されません。** 安全な場所(パスワードマネージャー等)に保管し、
   接続先クライアントの設定に貼り付けてください。

キーが不要になった・漏洩した疑いがある場合は、一覧画面の「失効させる」から即座に無効化できます。
失効は取り消せません(そのキーを使っている連携は動作しなくなります)。

## 2. スコープ

キーには用途を絞るための **スコープ** を1つ以上指定します。テナントの全権限を継承するわけでは
なく、指定したスコープの範囲でしか使えません。

| スコープ | できること |
|---|---|
| `punch` | 自分の打刻の作成・参照 |
| `read` | 自分の勤怠(打刻・月次集計・有給残高)の参照のみ |

## 3. エンドポイント一覧

APIキーでアクセスできるのは次のエンドポイントのみです。**これ以外のエンドポイント
(テナント設定・承認・締め・メンバー管理などの変更操作を含む)はAPIキーでは一切アクセスできません**
―安全側に倒した設計です。設定変更やメンバー管理はブラウザからセッションCookieでログインして
行ってください。

| メソッド | パス | 必要なスコープ(いずれか) |
|---|---|---|
| `POST` | `/punches` | `punch` |
| `GET` | `/punches` | `punch` または `read` |
| `GET` | `/attendance/status` | `punch` または `read` |
| `GET` | `/attendance/monthly` | `read` |
| `GET` | `/leave/balance` | `read` |

スコープが不足している、またはこの一覧に無いエンドポイントにアクセスすると
`403 { "error": "insufficient_api_key_scope" }` が返ります。

## 4. 使い方(curl の例)

認証は `Authorization: Bearer <キー>` ヘッダで行います。

```bash
# 出勤打刻
curl -X POST https://<your-kizami-host>/api/punches \
  -H "Authorization: Bearer kzm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"kind":"clock_in"}'

# 退勤打刻
curl -X POST https://<your-kizami-host>/api/punches \
  -H "Authorization: Bearer kzm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"kind":"clock_out"}'

# 現在の状態(出勤中/休憩中/退勤済み)を確認
curl https://<your-kizami-host>/api/attendance/status \
  -H "Authorization: Bearer kzm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 期間を指定して打刻を参照(from/to は UTC エポック分)
curl "https://<your-kizami-host>/api/punches?from=1750000000&to=1750100000" \
  -H "Authorization: Bearer kzm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

APIキーで作成された打刻は、記録上の `source`(打刻手段)が `api` になります。Web画面や他の
打刻手段(`web` / `slack` / `mcp` 等)と区別して監査・集計できます。

`kind` に指定できる値は `clock_in` / `clock_out` / `break_start` / `break_end` です
(取消を表す `void` は申請者が直接指定できません)。`occurredAt`(UTC エポック分)を省略すると
サーバー受信時刻が使われます。

## 5. セキュリティ上の注意

- **平文のAPIキーはサーバーに保存されません。** 発行時に1度だけ表示される値のハッシュ
  (SHA-256)のみをKIZAMI側で保持します。表示された値をその場でメモしそこねると、
  同じキーは二度と取得できません(その場合は失効させて新しいキーを発行してください)。
- **漏洩した・使わなくなったキーは即座に失効させてください。** 「設定 > APIキー」から
  いつでも失効できます。失効は行を消さず記録として残るため、後から「いつ・どのキーを
  失効させたか」を追跡できます。
- **用途ごとにキーを分けることを推奨します。** 1つのキーを複数のクライアントで使い回すと、
  漏洩時の影響範囲や失効時の影響範囲が広がります。名前を見て用途がわかるようにしておくと、
  不要になったキーを見つけやすくなります。
- **必要なスコープだけを付与してください。** 打刻専用のクライアント(ICカードリーダー等)には
  `punch` スコープのみを、参照専用のクライアント(ダッシュボード等)には `read` スコープのみを
  付与してください。
- **可能であれば有効期限を設定してください。** 無期限のキーは失効を忘れると使われ続けます。
  一覧画面では各キーの最終使用日時が確認できるため、定期的に見直し、長期間使われていない
  キーは失効させることを推奨します。
- APIキーは発行したユーザー本人としてのみ動作します。他のユーザーの代わりに打刻することは
  できません(打刻の主体を明確にするための設計です)。

## 6. 他人のキーを管理する(管理者向け)

自分のキーはセルフサービスで管理できますが、**他のメンバーのAPIキーの一覧・発行・失効**には
権限プリセットの `api_key.manage`(テナント全体スコープのみ)が必要です。退職者のキーを一括で
確認・失効させたい場合などに使います。権限カタログの詳細は
[権限カタログ](/design/permission-catalog)を参照してください。
